//! One-shot macOS authorization: pass one O_RDONLY source descriptor to the
//! unprivileged app. The helper never reads sectors, opens a destination,
//! changes device permissions, or starts the acquisition tool.
use crate::model::{now_ms, CommandRecord};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    ffi::{c_char, c_void, CStr, CString},
    fs::{File, OpenOptions},
    io::{Read, Write},
    mem,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            ffi::OsStrExt,
            fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
            net::{UnixListener, UnixStream},
            process::ExitStatusExt,
        },
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const HELPER: &str = "--drc-open-readonly-source";
type CF = *const c_void;
#[link(name = "DiskArbitration", kind = "framework")]
unsafe extern "C" {
    fn DASessionCreate(allocator: CF) -> CF;
    fn DADiskCreateFromBSDName(allocator: CF, session: CF, name: *const c_char) -> CF;
    fn DADiskCopyDescription(disk: CF) -> CF;
    fn DADiskCopyIOMedia(disk: CF) -> u32;
    static kDADiskDescriptionDeviceInternalKey: CF;
    static kDADiskDescriptionMediaWholeKey: CF;
    static kDADiskDescriptionMediaSizeKey: CF;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(object: CF);
    fn CFDictionaryGetValue(dictionary: CF, key: CF) -> CF;
    fn CFGetTypeID(value: CF) -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: CF) -> bool;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(value: CF, kind: i32, result: *mut c_void) -> bool;
}
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IORegistryEntryGetRegistryEntryID(entry: u32, result: *mut u64) -> i32;
    fn IOObjectRelease(entry: u32) -> i32;
}
struct OwnedCF(CF);
impl Drop for OwnedCF {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}
fn owned(value: CF, label: &str) -> Result<OwnedCF, String> {
    if value.is_null() {
        Err(format!("macOS did not provide {label}."))
    } else {
        Ok(OwnedCF(value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Binding {
    id: String,
    registry_id: u64,
    size: u64,
    raw_device: u64,
}
pub(crate) fn check_presence(expected: &Binding) -> Result<(), String> {
    if describe(&expected.id)? != *expected {
        return Err("The source is no longer published with its reviewed IOMedia identity.".into());
    }
    Ok(())
}
fn valid_id(id: &str) -> bool {
    id.strip_prefix("disk")
        .is_some_and(|n| !n.is_empty() && n.len() <= 10 && n.bytes().all(|b| b.is_ascii_digit()))
}
fn describe(id: &str) -> Result<Binding, String> {
    if !valid_id(id) {
        return Err("A whole disk identifier is required.".into());
    }
    let name = CString::new(format!("/dev/{id}")).map_err(|e| e.to_string())?;
    let session = owned(
        unsafe { DASessionCreate(std::ptr::null()) },
        "a Disk Arbitration session",
    )?;
    let disk = owned(
        unsafe { DADiskCreateFromBSDName(std::ptr::null(), session.0, name.as_ptr()) },
        "the selected disk",
    )?;
    let description = owned(
        unsafe { DADiskCopyDescription(disk.0) },
        "the disk description",
    )?;
    for (key, expected, label) in unsafe {
        [
            (
                kDADiskDescriptionDeviceInternalKey,
                false,
                "external device",
            ),
            (kDADiskDescriptionMediaWholeKey, true, "whole medium"),
        ]
    } {
        let value = unsafe { CFDictionaryGetValue(description.0, key) };
        if value.is_null()
            || unsafe {
                CFGetTypeID(value) != CFBooleanGetTypeID() || CFBooleanGetValue(value) != expected
            }
        {
            return Err(format!(
                "macOS has not identified {id} as an {label}. Source access refused."
            ));
        }
    }
    let value = unsafe { CFDictionaryGetValue(description.0, kDADiskDescriptionMediaSizeKey) };
    let mut size: i64 = 0;
    if value.is_null()
        || unsafe {
            CFGetTypeID(value) != CFNumberGetTypeID()
                || !CFNumberGetValue(value, 4, (&mut size as *mut i64).cast())
        }
        || size <= 0
    {
        return Err("The selected medium has no positive reported capacity.".into());
    }
    let media = unsafe { DADiskCopyIOMedia(disk.0) };
    if media == 0 {
        return Err("The selected IOMedia object is unavailable.".into());
    }
    let mut registry_id = 0;
    let result = unsafe { IORegistryEntryGetRegistryEntryID(media, &mut registry_id) };
    unsafe {
        IOObjectRelease(media);
    }
    if result != 0 || registry_id == 0 {
        return Err(format!(
            "Cannot bind the selected IOMedia object: 0x{:08x}.",
            result as u32
        ));
    }
    let metadata = std::fs::symlink_metadata(format!("/dev/r{id}")).map_err(|e| e.to_string())?;
    if !metadata.file_type().is_char_device() {
        return Err("The raw source is not a character device.".into());
    }
    Ok(Binding {
        id: id.into(),
        registry_id,
        size: size as u64,
        raw_device: metadata.rdev(),
    })
}
fn require_unmounted(id: &str) -> Result<(), String> {
    let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, libc::MNT_NOWAIT) };
    if count < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut mounts = vec![unsafe { mem::zeroed::<libc::statfs>() }; count as usize + 16];
    let count = unsafe {
        libc::getfsstat(
            mounts.as_mut_ptr(),
            mem::size_of_val(mounts.as_slice()) as i32,
            libc::MNT_NOWAIT,
        )
    };
    if count < 0 || count as usize >= mounts.len() {
        return Err("Mounted-volume enumeration failed or changed.".into());
    }
    let source = format!("/dev/{id}");
    for mount in mounts.iter().take(count as usize) {
        let from = unsafe { CStr::from_ptr(mount.f_mntfromname.as_ptr()) }.to_string_lossy();
        if from == source
            || from
                .strip_prefix(&source)
                .is_some_and(|suffix| suffix.starts_with('s'))
        {
            return Err(format!(
                "Source volume {from} is mounted. Read-only authorization does not unmount it."
            ));
        }
    }
    Ok(())
}
fn readonly(file: &File) -> Result<(), String> {
    let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFL) };
    if flags < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if flags & libc::O_ACCMODE != libc::O_RDONLY {
        return Err("Source descriptor is not read-only.".into());
    }
    Ok(())
}
fn readonly_source(file: File) -> Result<File, String> {
    if readonly(&file).is_ok() {
        return Ok(file);
    }
    let before = file.metadata().map_err(|e| e.to_string())?;
    let mut source_path = [0 as c_char; libc::MAXPATHLEN as usize];
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, source_path.as_mut_ptr()) } < 0 {
        return Err(format!(
            "Cannot resolve the source for read-only reopening: {}",
            std::io::Error::last_os_error()
        ));
    }
    let source_path = unsafe { CStr::from_ptr(source_path.as_ptr()) };
    let reopened = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(std::ffi::OsStr::from_bytes(source_path.to_bytes()))
        .map_err(|e| format!("Cannot reopen the source read-only: {e}"))?;
    let after = reopened.metadata().map_err(|e| e.to_string())?;
    if (
        before.dev(),
        before.ino(),
        before.rdev(),
        before.mode() & u32::from(libc::S_IFMT),
    ) != (
        after.dev(),
        after.ino(),
        after.rdev(),
        after.mode() & u32::from(libc::S_IFMT),
    ) {
        return Err("The source identity changed while reopening it read-only.".into());
    }
    readonly(&reopened)?;
    Ok(reopened)
}
fn validate(file: &File, expected: &Binding) -> Result<(), String> {
    readonly(file)?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.file_type().is_char_device() || metadata.rdev() != expected.raw_device {
        return Err("The source descriptor does not match the reviewed raw device.".into());
    }
    if describe(&expected.id)? != *expected {
        return Err("The source changed while read-only access was being authorized.".into());
    }
    require_unmounted(&expected.id)
}
fn peer(stream: &UnixStream) -> Result<(libc::uid_t, libc::pid_t), String> {
    let mut uid = 0;
    let mut gid = 0;
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut pid: libc::pid_t = 0;
    let mut size = mem::size_of_val(&pid) as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut size,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok((uid, pid))
}
fn send(stream: &UnixStream, file: &File, nonce: &[u8]) -> Result<(), String> {
    let mut control = [0usize; 8];
    let mut iov = libc::iovec {
        iov_base: nonce.as_ptr() as *mut c_void,
        iov_len: nonce.len(),
    };
    let mut message: libc::msghdr = unsafe { mem::zeroed() };
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = unsafe { libc::CMSG_SPACE(mem::size_of::<i32>() as u32) } as _;
    unsafe {
        let header = libc::CMSG_FIRSTHDR(&message);
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(mem::size_of::<i32>() as u32) as _;
        std::ptr::write_unaligned(libc::CMSG_DATA(header).cast::<i32>(), file.as_raw_fd());
    }
    if unsafe { libc::sendmsg(stream.as_raw_fd(), &message, 0) } != nonce.len() as isize {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}
fn receive(stream: &UnixStream, nonce: &[u8]) -> Result<File, String> {
    let mut payload = [0u8; 64];
    let mut control = [0usize; 16];
    let mut iov = libc::iovec {
        iov_base: payload.as_mut_ptr().cast(),
        iov_len: payload.len(),
    };
    let mut message: libc::msghdr = unsafe { mem::zeroed() };
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = mem::size_of_val(&control) as _;
    let received = unsafe { libc::recvmsg(stream.as_raw_fd(), &mut message, libc::MSG_WAITALL) };
    if received < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut files = Vec::new();
    let mut invalid = message.msg_flags & (libc::MSG_CTRUNC | libc::MSG_TRUNC) != 0;
    unsafe {
        let mut header = libc::CMSG_FIRSTHDR(&message);
        while !header.is_null() {
            let end = message.msg_control as usize + message.msg_controllen as usize;
            let start = header as usize;
            if start + mem::size_of::<libc::cmsghdr>() > end
                || (*header).cmsg_len < libc::CMSG_LEN(0)
                || start + (*header).cmsg_len as usize > end
            {
                invalid = true;
                break;
            }
            if (*header).cmsg_level == libc::SOL_SOCKET && (*header).cmsg_type == libc::SCM_RIGHTS {
                let bytes =
                    ((*header).cmsg_len as usize).saturating_sub(libc::CMSG_LEN(0) as usize);
                invalid |= !bytes.is_multiple_of(mem::size_of::<i32>());
                for index in 0..bytes / mem::size_of::<i32>() {
                    let fd =
                        std::ptr::read_unaligned(libc::CMSG_DATA(header).cast::<i32>().add(index));
                    if fd >= 0 {
                        files.push(File::from_raw_fd(fd));
                    } else {
                        invalid = true;
                    }
                }
            } else {
                invalid = true;
            }
            header = libc::CMSG_NXTHDR(&message, header);
        }
    }
    if invalid
        || received as usize != nonce.len()
        || payload.get(..received as usize) != Some(nonce)
        || files.len() != 1
    {
        return Err(
            "The source authorization reply is invalid; received descriptors were closed.".into(),
        );
    }
    let file = readonly_source(files.pop().unwrap())?;
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    readonly(&file)?;
    Ok(file)
}
fn send_confirmed(stream: &UnixStream, file: &File, nonce: &[u8]) -> Result<(), String> {
    send(stream, file, nonce)?;
    // LOCAL_PEERPID becomes unavailable after the sender exits on macOS.
    // Keep the authorized process alive until the app has authenticated it,
    // validated the descriptor, and acknowledged this request.
    let mut acknowledgement = [0u8; 64];
    let mut connection = stream;
    connection
        .read_exact(&mut acknowledgement)
        .map_err(|e| format!("Source descriptor acknowledgement failed: {e}"))?;
    if acknowledgement.as_slice() != nonce {
        return Err("The source descriptor acknowledgement does not match the request.".into());
    }
    Ok(())
}
fn receive_confirmed(
    stream: &UnixStream,
    nonce: &[u8],
    verify: impl FnOnce(&File) -> Result<(), String>,
) -> Result<File, String> {
    let file = receive(stream, nonce)?;
    verify(&file)?;
    let mut connection = stream;
    connection
        .write_all(nonce)
        .map_err(|e| format!("Cannot acknowledge the read-only source descriptor: {e}"))?;
    Ok(file)
}
fn accept_source(stream: &UnixStream, nonce: &[u8], expected: &Binding) -> Result<File, String> {
    let (uid, pid) = peer(stream)
        .map_err(|e| format!("Cannot authenticate the source authorization helper: {e}"))?;
    if uid != 0 || pid <= 0 {
        return Err(format!(
            "Source authorization reply refused: peer uid {uid}, pid {pid}; an authorized root helper is required."
        ));
    }
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    receive_confirmed(stream, nonce, |file| validate(file, expected))
}
struct AuthorizationChild(Option<std::process::Child>);
impl Drop for AuthorizationChild {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
struct SocketDirectory(PathBuf);
impl Drop for SocketDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.0.join("open.sock"));
        let _ = std::fs::remove_dir(&self.0);
    }
}
fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    if unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn applescript_literal(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

pub(crate) fn open(
    id: &str,
    emit: &mut dyn FnMut(CommandRecord),
) -> Result<(File, Binding), String> {
    let expected = describe(id)?;
    require_unmounted(id)?;
    match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(format!("/dev/r{id}"))
    {
        Ok(file) => {
            validate(&file, &expected)?;
            return Ok((file, expected));
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {}
        Err(error) => return Err(format!("Cannot open /dev/r{id} read-only: {error}")),
    }
    let nonce = random_hex()?;
    let directory_path = Path::new("/private/tmp").join(format!("drc-source-{}", &nonce[..32]));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory_path)
        .map_err(|e| e.to_string())?;
    let directory = SocketDirectory(directory_path);
    let socket = directory.0.join("open.sock");
    let listener = UnixListener::bind(&socket).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let words = [
        executable
            .to_str()
            .ok_or("The application path is not UTF-8.")?
            .into(),
        HELPER.into(),
        id.into(),
        expected.registry_id.to_string(),
        expected.size.to_string(),
        expected.raw_device.to_string(),
        unsafe { libc::getuid() }.to_string(),
        std::process::id().to_string(),
        socket.to_string_lossy().into_owned(),
        "1".into(),
        nonce.clone(),
    ];
    let script = format!(
        "do shell script {} with administrator privileges without altering line endings",
        applescript_literal(
            &words
                .iter()
                .map(|word| shell_quote(word))
                .collect::<Vec<_>>()
                .join(" ")
        )
    );
    let args = vec!["-e".into(), script];
    let started = Instant::now();
    let at = now_ms();
    let result = (|| -> Result<(File, std::process::Output), String> {
        let mut child = AuthorizationChild(Some(
            Command::new("/usr/bin/osascript")
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?,
        ));
        let deadline = Instant::now() + Duration::from_secs(120);
        let mut input = None;
        let mut access_error = None;
        loop {
            match listener.accept() {
                Ok((stream, _)) => match accept_source(&stream, nonce.as_bytes(), &expected) {
                    Ok(file) => input = Some(file),
                    Err(error) => access_error = Some(error),
                },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) => {
                    access_error = Some(error.to_string());
                }
            }
            if child
                .0
                .as_mut()
                .unwrap()
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                break;
            }
            if Instant::now() >= deadline || access_error.is_some() {
                let _ = child.0.as_mut().unwrap().kill();
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        // Drain a reply sent immediately before helper exit.
        if input.is_none() && access_error.is_none() {
            if let Ok((stream, _)) = listener.accept() {
                match accept_source(&stream, nonce.as_bytes(), &expected) {
                    Ok(file) => input = Some(file),
                    Err(error) => access_error = Some(error),
                }
            }
        }
        let output = child
            .0
            .take()
            .unwrap()
            .wait_with_output()
            .map_err(|e| e.to_string())?;
        let record = CommandRecord {
            id: crate::model::unique_id("source-authorization"),
            program: "/usr/bin/osascript".into(),
            arguments: args.clone(),
            started_at: at,
            duration_ms: started.elapsed().as_millis() as u64,
            exit_code: output.status.code(),
            termination_signal: output.status.signal(),
            timed_out: started.elapsed() >= Duration::from_secs(120),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            stdout_utf8_valid: std::str::from_utf8(&output.stdout).is_ok(),
            stderr_utf8_valid: std::str::from_utf8(&output.stderr).is_ok(),
            stdout_base64: base64::engine::general_purpose::STANDARD.encode(&output.stdout),
            stderr_base64: base64::engine::general_purpose::STANDARD.encode(&output.stderr),
            launch_error: None,
            stdout_artifact: None,
            stdin: None,
        };
        emit(record);
        if started.elapsed() >= Duration::from_secs(120) {
            return Err("macOS read-only source authorization timed out after 120 seconds. No acquisition started.".into());
        }
        if let Some(error) = access_error {
            return Err(error);
        }
        if !output.status.success() {
            return Err(format!(
                "macOS read-only source authorization failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok((input.ok_or("macOS authorization ended without a read-only source descriptor. No acquisition started.")?, output))
    })();
    result.map(|(file, _)| (file, expected))
}

struct Request {
    binding: Binding,
    uid: libc::uid_t,
    pid: libc::pid_t,
    socket: PathBuf,
    nonce: String,
}
fn parse_request(args: &[String]) -> Result<Request, String> {
    if args.len() != 9
        || !valid_id(&args[0])
        || args[8].len() != 64
        || !args[8].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid read-only source request.".into());
    }
    let number = |index: usize| {
        args[index]
            .parse::<u64>()
            .map_err(|_| "Invalid source binding.".to_string())
    };
    let expected = Binding {
        id: args[0].clone(),
        registry_id: number(1)?,
        size: number(2)?,
        raw_device: number(3)?,
    };
    let uid = libc::uid_t::try_from(number(4)?).map_err(|e| e.to_string())?;
    let pid = libc::pid_t::try_from(number(5)?).map_err(|e| e.to_string())?;
    let socket = Path::new(&args[6]);
    // args[7] is reserved for protocol version; do not accept arbitrary paths.
    if args[7] != "1" {
        return Err("Unsupported source authorization protocol.".into());
    }
    let parent = socket.parent().ok_or("Missing source socket parent.")?;
    let name = parent
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if parent.parent() != Some(Path::new("/private/tmp"))
        || socket.file_name().and_then(|name| name.to_str()) != Some("open.sock")
        || name.len() != 43
        || !name
            .strip_prefix("drc-source-")
            .is_some_and(|suffix| suffix.bytes().all(|b| b.is_ascii_hexdigit()))
        || uid == 0
        || pid <= 0
    {
        return Err("Invalid private source socket.".into());
    }
    if name != format!("drc-source-{}", &args[8][..32]) {
        return Err("The source socket does not match the authorization nonce.".into());
    }
    if expected.registry_id == 0 || expected.size == 0 {
        return Err("An established source identity and nonzero capacity are required.".into());
    }
    Ok(Request {
        binding: expected,
        uid,
        pid,
        socket: socket.to_path_buf(),
        nonce: args[8].clone(),
    })
}
fn helper(args: &[String]) -> Result<(), String> {
    if unsafe { libc::geteuid() } != 0 {
        return Err("Read-only source helper requires macOS administrator authorization.".into());
    }
    let Request {
        binding: expected,
        uid,
        pid,
        socket,
        nonce,
    } = parse_request(args)?;
    let parent = socket.parent().ok_or("Missing source socket parent.")?;
    let parent_meta = std::fs::symlink_metadata(parent).map_err(|e| e.to_string())?;
    let socket_meta = std::fs::symlink_metadata(&socket).map_err(|e| e.to_string())?;
    if !parent_meta.is_dir()
        || parent_meta.uid() != uid
        || parent_meta.mode() & 0o777 != 0o700
        || !socket_meta.file_type().is_socket()
        || socket_meta.uid() != uid
        || socket_meta.mode() & 0o777 != 0o600
    {
        return Err("The source socket is not private to the requesting user.".into());
    }
    if describe(&expected.id)? != expected {
        return Err("The selected source changed before authorization.".into());
    }
    require_unmounted(&expected.id)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(format!("/dev/r{}", expected.id))
        .map_err(|e| {
            if e.raw_os_error() == Some(libc::EPERM) {
                format!("MACOS_SOURCE_POLICY_DENIED: macOS refused /dev/r{} after administrator authorization: {e}", expected.id)
            } else { format!("Cannot open the authorized source read-only: {e}") }
        })?;
    validate(&file, &expected)?;
    let stream = UnixStream::connect(&socket).map_err(|e| e.to_string())?;
    if peer(&stream)? != (uid, pid) {
        return Err("The source requester changed during authorization.".into());
    }
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    send_confirmed(&stream, &file, nonce.as_bytes())
}

/// Executed before any GUI/runtime initialization. An invalid helper request
/// never falls through to a root GUI or an alternate command.
pub fn helper_entry() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == HELPER) {
        return Some(match helper(&args[1..]) {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("{error}");
                1
            }
        });
    }
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("Run DRC as a normal desktop user.");
        return Some(1);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptor_sender_process() {
        let Some(socket) = std::env::var_os("DRC_TEST_SOURCE_SOCKET") else {
            return;
        };
        let stream = UnixStream::connect(socket).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let file = File::open("/dev/null").unwrap();
        send_confirmed(&stream, &file, "a".repeat(64).as_bytes()).unwrap();
    }
    #[test]
    fn sender_waits_for_authenticated_receiver_before_exiting() {
        let path =
            Path::new("/private/tmp").join(format!("drc-source-test-{}", random_hex().unwrap()));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        let directory = SocketDirectory(path);
        let socket = directory.0.join("open.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "mac_source::tests::descriptor_sender_process",
                "--nocapture",
            ])
            .env("DRC_TEST_SOURCE_SOCKET", &socket)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let (stream, _) = listener.accept().unwrap();
        // Deliberately receive after the sender has delivered the descriptor.
        std::thread::sleep(Duration::from_millis(150));
        assert!(child.try_wait().unwrap().is_none());
        assert_eq!(
            peer(&stream).unwrap(),
            (unsafe { libc::getuid() }, child.id() as libc::pid_t)
        );
        let file = receive_confirmed(&stream, "a".repeat(64).as_bytes(), readonly).unwrap();
        readonly(&file).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[test]
    fn refused_descriptor_is_never_acknowledged() {
        let (sender, receiver) = UnixStream::pair().unwrap();
        sender
            .set_read_timeout(Some(Duration::from_millis(100)))
            .unwrap();
        let thread = std::thread::spawn(move || {
            send_confirmed(
                &sender,
                &File::open("/dev/null").unwrap(),
                "a".repeat(64).as_bytes(),
            )
        });
        let error = receive_confirmed(&receiver, "a".repeat(64).as_bytes(), |_| {
            Err("Binding changed".into())
        })
        .unwrap_err();
        assert_eq!(error, "Binding changed");
        drop(receiver);
        assert!(thread
            .join()
            .unwrap()
            .unwrap_err()
            .contains("acknowledgement failed"));
    }
    #[test]
    fn rejects_partition_paths_and_shell_input() {
        for id in [
            "disk0s1", "rdisk1", "disk", "../disk2", "disk2;id", "disk2\n",
        ] {
            assert!(!valid_id(id));
        }
        assert!(valid_id("disk14"));
        assert_eq!(shell_quote("a'b;$()"), "'a'\\''b;$()'");
        assert_eq!(applescript_literal("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }
    #[test]
    fn transfers_readonly_descriptor_normalizes_writable_handle_and_rejects_wrong_nonce() {
        for (writable, wrong_nonce) in [(false, false), (false, true), (true, false)] {
            let file = OpenOptions::new()
                .read(true)
                .write(writable)
                .open("/dev/null")
                .unwrap();
            let (left, right) = UnixStream::pair().unwrap();
            assert_eq!(
                peer(&right).unwrap(),
                (unsafe { libc::getuid() }, std::process::id() as libc::pid_t)
            );
            let nonce = "a".repeat(64);
            send(&left, &file, nonce.as_bytes()).unwrap();
            let expected = if wrong_nonce { "b".repeat(64) } else { nonce };
            let result = receive(&right, expected.as_bytes());
            if wrong_nonce {
                assert!(result.is_err());
            } else {
                let file = result.unwrap();
                assert_eq!(
                    unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC,
                    libc::FD_CLOEXEC
                );
                assert_eq!(
                    unsafe { libc::write(file.as_raw_fd(), b"x".as_ptr().cast(), 1) },
                    -1
                );
            }
        }
    }
    #[test]
    fn helper_protocol_rejects_arbitrary_paths_partitions_and_mismatched_socket() {
        let nonce = "a".repeat(64);
        let request: Vec<String> = [
            "disk7",
            "123",
            "1048576",
            "42",
            "501",
            "100",
            &format!("/private/tmp/drc-source-{}/open.sock", &nonce[..32]),
            "1",
            &nonce,
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let parsed = parse_request(&request).unwrap();
        assert_eq!(parsed.binding.id, "disk7");
        for (index, value) in [
            (0, "disk7s1"),
            (1, "0"),
            (2, "0"),
            (4, "0"),
            (5, "0"),
            (6, "/tmp/other.sock"),
            (7, "2"),
            (8, "short"),
        ] {
            let mut invalid = request.clone();
            invalid[index] = value.into();
            assert!(parse_request(&invalid).is_err());
        }
        assert!(parse_request(&request[..8]).is_err());
    }
}
