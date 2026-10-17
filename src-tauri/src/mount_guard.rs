//! A per-operation Disk Arbitration mount veto, not a system-wide write blocker.
#[cfg(target_os = "macos")]
mod mac {
    use std::{
        collections::HashSet,
        ffi::{c_char, c_void, CStr},
        sync::{mpsc, Mutex, OnceLock},
    };
    type CF = *const c_void;
    static TARGETS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    static USB_TARGETS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    static STARTED: OnceLock<Result<(), String>> = OnceLock::new();
    #[link(name = "DiskArbitration", kind = "framework")]
    unsafe extern "C" {
        fn DASessionCreate(allocator: CF) -> CF;
        fn DASessionScheduleWithRunLoop(session: CF, runloop: CF, mode: CF);
        fn DARegisterDiskMountApprovalCallback(
            session: CF,
            filter: CF,
            callback: unsafe extern "C" fn(CF, *mut c_void) -> CF,
            context: *mut c_void,
        );
        fn DADiskCopyWholeDisk(disk: CF) -> CF;
        fn DADiskGetBSDName(disk: CF) -> *const c_char;
        fn DADiskCopyIOMedia(disk: CF) -> u32;
        fn DADissenterCreate(allocator: CF, status: i32, message: CF) -> CF;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFRunLoopDefaultMode: CF;
        fn CFRunLoopGetCurrent() -> CF;
        fn CFRunLoopRun();
        fn CFRelease(object: CF);
        fn CFPropertyListCreateData(
            allocator: CF,
            value: CF,
            format: isize,
            options: usize,
            error: *mut CF,
        ) -> CF;
        fn CFDataGetLength(data: CF) -> isize;
        fn CFDataGetBytePtr(data: CF) -> *const u8;
    }
    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IORegistryEntryCreateCFProperties(
            entry: u32,
            properties: *mut CF,
            allocator: CF,
            options: u32,
        ) -> i32;
        fn IORegistryEntryGetParentEntry(entry: u32, plane: *const c_char, parent: *mut u32)
            -> i32;
        fn IOObjectRelease(entry: u32) -> i32;
    }
    fn denied_usb(disk: CF) -> bool {
        if USB_TARGETS
            .get()
            .and_then(|v| v.lock().ok())
            .is_none_or(|v| v.is_empty())
        {
            return false;
        }
        let mut entry = unsafe { DADiskCopyIOMedia(disk) };
        if entry == 0 {
            return true;
        }
        for _ in 0..64 {
            let mut properties = std::ptr::null();
            if unsafe {
                IORegistryEntryCreateCFProperties(entry, &mut properties, std::ptr::null(), 0)
            } != 0
            {
                unsafe {
                    IOObjectRelease(entry);
                };
                return true;
            }
            let data = unsafe {
                CFPropertyListCreateData(std::ptr::null(), properties, 100, 0, std::ptr::null_mut())
            };
            unsafe {
                CFRelease(properties);
            };
            if data.is_null() {
                unsafe {
                    IOObjectRelease(entry);
                };
                return true;
            }
            let bytes = unsafe {
                std::slice::from_raw_parts(CFDataGetBytePtr(data), CFDataGetLength(data) as usize)
            };
            let parsed = crate::model::parse_plist(bytes);
            unsafe {
                CFRelease(data);
            };
            if let Ok(value) = parsed {
                let keys = [
                    super::usb_key(&value).ok(),
                    crate::model::string_field(&value, "UsbCPortNumber")
                        .map(|n| format!("host-port:{n}")),
                ];
                for key in keys.into_iter().flatten() {
                    let denied = USB_TARGETS
                        .get()
                        .and_then(|v| v.lock().ok())
                        .is_none_or(|v| v.contains(&key));
                    if denied {
                        unsafe {
                            IOObjectRelease(entry);
                        };
                        return true;
                    }
                }
            } else {
                unsafe {
                    IOObjectRelease(entry);
                };
                return true;
            }
            let mut parent = 0;
            let result =
                unsafe { IORegistryEntryGetParentEntry(entry, c"IOService".as_ptr(), &mut parent) };
            unsafe {
                IOObjectRelease(entry);
            };
            if result != 0 || parent == 0 {
                return false;
            }
            entry = parent;
        }
        unsafe {
            IOObjectRelease(entry);
        };
        true
    }
    unsafe extern "C" fn approve(disk: CF, _context: *mut c_void) -> CF {
        // SAFETY: Disk Arbitration supplies a valid disk. Copy owns a CF reference.
        let whole = unsafe { DADiskCopyWholeDisk(disk) };
        if whole.is_null() {
            return std::ptr::null();
        }
        let name = unsafe { DADiskGetBSDName(whole) };
        let denied = if name.is_null() {
            false
        } else {
            let name = unsafe { CStr::from_ptr(name) }.to_string_lossy();
            TARGETS
                .get()
                .and_then(|s| s.lock().ok())
                .is_some_and(|s| s.contains(name.as_ref()))
        } || denied_usb(whole);
        unsafe { CFRelease(whole) };
        if denied {
            unsafe { DADissenterCreate(std::ptr::null(), 0xF8DA0008u32 as i32, std::ptr::null()) }
        } else {
            std::ptr::null()
        }
    }
    pub fn start() -> Result<(), String> {
        STARTED
            .get_or_init(|| {
                TARGETS.get_or_init(|| Mutex::new(HashSet::new()));
                USB_TARGETS.get_or_init(|| Mutex::new(HashSet::new()));
                let (tx, rx) = mpsc::sync_channel(1);
                std::thread::spawn(move || unsafe {
                    let session = DASessionCreate(std::ptr::null());
                    if session.is_null() {
                        let _ =
                            tx.send(Err("Disk Arbitration mount guard could not start.".into()));
                        return;
                    }
                    DARegisterDiskMountApprovalCallback(
                        session,
                        std::ptr::null(),
                        approve,
                        std::ptr::null_mut(),
                    );
                    DASessionScheduleWithRunLoop(
                        session,
                        CFRunLoopGetCurrent(),
                        kCFRunLoopDefaultMode,
                    );
                    let _ = tx.send(Ok(()));
                    CFRunLoopRun();
                    CFRelease(session);
                });
                rx.recv_timeout(std::time::Duration::from_secs(5))
                    .map_err(|e| e.to_string())?
            })
            .clone()
    }
    pub fn add(id: &str) -> Result<(), String> {
        start()?;
        TARGETS
            .get()
            .unwrap()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.into());
        Ok(())
    }
    pub fn remove(id: &str) {
        if let Some(s) = TARGETS.get() {
            if let Ok(mut s) = s.lock() {
                s.remove(id);
            }
        }
    }
    pub fn add_usb(key: &str) -> Result<(), String> {
        start()?;
        USB_TARGETS
            .get()
            .unwrap()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(key.into());
        Ok(())
    }
    pub fn remove_usb(key: &str) {
        if let Some(values) = USB_TARGETS.get() {
            if let Ok(mut values) = values.lock() {
                values.remove(key);
            }
        }
    }
}

fn usb_key(value: &serde_json::Value) -> Result<String, String> {
    let parts: Option<Vec<_>> = ["idVendor", "idProduct", "USB Serial Number"]
        .into_iter()
        .map(|k| crate::model::string_field(value, k).filter(|s| !s.is_empty()))
        .collect();
    serde_json::to_string(&parts.ok_or("USB identity lacks vendor, product or serial")?)
        .map_err(|e| e.to_string())
}
pub struct UsbMountGuard {
    #[cfg(target_os = "macos")]
    key: String,
}
impl UsbMountGuard {
    pub fn acquire(value: &serde_json::Value) -> Result<Self, String> {
        Self::acquire_key(usb_key(value)?)
    }
    pub fn acquire_port(number: &str) -> Result<Self, String> {
        let n = number
            .parse::<u8>()
            .ok()
            .filter(|n| (1..=64).contains(n))
            .ok_or("Invalid host-port number")?;
        Self::acquire_key(format!("host-port:{n}"))
    }
    fn acquire_key(key: String) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            mac::add_usb(&key)?;
            Ok(Self { key })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = key;
            Err("USB reconnect mount veto is implemented on macOS only".into())
        }
    }
}
impl Drop for UsbMountGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        mac::remove_usb(&self.key);
    }
}

pub struct MountGuard {
    #[cfg(target_os = "macos")]
    id: String,
    #[cfg(target_os = "linux")]
    input: std::fs::File,
}
impl MountGuard {
    pub fn acquire(id: &str) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            mac::add(id)?;
            Ok(Self { id: id.into() })
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::{FileTypeExt, OpenOptionsExt};
            if !crate::linux::valid_id(id) {
                return Err("Invalid block device identifier".into());
            }
            let input=match std::fs::OpenOptions::new().read(true).custom_flags(libc::O_EXCL | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC).open(format!("/dev/{id}")) {
                Ok(file)=>file,
                Err(error) if error.kind()==std::io::ErrorKind::PermissionDenied=>udisks_readonly(id)?,
                Err(error)=>return Err(format!("Exclusive read-only source access denied: {error}. DRC does not unmount a source.")),
            };
            if !input
                .metadata()
                .map_err(|e| e.to_string())?
                .file_type()
                .is_block_device()
            {
                return Err("Source is not a block device".into());
            }
            validate_readonly_node(&input, id)?;
            Ok(Self { input })
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = id;
            Err("Source mount protection is not implemented on this host.".into())
        }
    }
    pub fn open_source(&self) -> Result<std::fs::File, String> {
        #[cfg(target_os = "macos")]
        {
            crate::policy::open_readonly(std::path::Path::new(&format!("/dev/r{}", self.id)))
        }
        #[cfg(target_os = "linux")]
        {
            self.input.try_clone().map_err(|e| e.to_string())
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            Err("Physical source access unavailable".into())
        }
    }
}
impl Drop for MountGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        mac::remove(&self.id);
    }
}

#[cfg(target_os = "linux")]
fn udisks_readonly(id: &str) -> Result<std::fs::File, String> {
    use gio::{glib, prelude::*};
    // Fixed service, method, mode and flags; no formatter/restore API or shell.
    let escaped: String = id
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() {
                (b as char).to_string()
            } else {
                format!("_{b:02x}")
            }
        })
        .collect();
    let connection =
        gio::bus_get_sync(gio::BusType::System, None::<&gio::Cancellable>).map_err(|e| {
            format!(
                "Read-only access requires UDisks2 and an active desktop authorization agent: {e}"
            )
        })?;
    connection.set_exit_on_close(false);
    let options = std::collections::HashMap::from([(
        "flags",
        (libc::O_EXCL | libc::O_CLOEXEC | libc::O_NONBLOCK).to_variant(),
    )]);
    let parameters = ("r", options).to_variant();
    let (reply,descriptors)=connection.call_with_unix_fd_list_sync(Some("org.freedesktop.UDisks2"),&format!("/org/freedesktop/UDisks2/block_devices/{escaped}"),"org.freedesktop.UDisks2.Block","OpenDevice",Some(&parameters),Some(glib::VariantTy::new("(h)").map_err(|e|e.to_string())?),gio::DBusCallFlags::ALLOW_INTERACTIVE_AUTHORIZATION,120_000,None::<&gio::UnixFDList>,None::<&gio::Cancellable>).map_err(|e|format!("UDisks2 denied exclusive read-only access: {e}. The application stays unprivileged."))?;
    let index = reply
        .get::<(glib::variant::Handle,)>()
        .ok_or("UDisks2 returned an invalid descriptor handle")?
        .0
         .0;
    let fd = descriptors.get(index).map_err(|e| e.to_string())?;
    // g_unix_fd_list_get returns a new descriptor owned by its caller.
    use std::os::fd::FromRawFd;
    if fd < 0 {
        return Err("UDisks2 returned an invalid descriptor".into());
    }
    Ok(unsafe { std::fs::File::from_raw_fd(fd) })
}
#[cfg(target_os = "linux")]
fn validate_readonly_node(file: &std::fs::File, id: &str) -> Result<(), String> {
    use std::os::unix::{
        fs::{FileTypeExt, MetadataExt},
        io::AsRawFd,
    };
    let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFL) };
    if flags < 0 || flags & libc::O_ACCMODE != libc::O_RDONLY {
        return Err("Source access is not read-only".into());
    }
    let bound = file.metadata().map_err(|e| e.to_string())?;
    if !bound.file_type().is_block_device() {
        return Err("Source descriptor is not a block device".into());
    }
    let current = std::fs::symlink_metadata(format!("/dev/{id}")).map_err(|e| e.to_string())?;
    if !bound.file_type().is_block_device()
        || !current.file_type().is_block_device()
        || bound.rdev() != current.rdev()
    {
        return Err("Source descriptor does not match the reviewed block-device node".into());
    }
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[test]
    fn broker_result_rejects_writable_and_regular_handles() {
        let path = std::env::temp_dir().join(crate::model::unique_id("drc-broker-fd"));
        let writable = std::fs::File::create(&path).unwrap();
        assert!(validate_readonly_node(&writable, "sda")
            .unwrap_err()
            .contains("read-only"));
        let readonly = std::fs::File::open(&path).unwrap();
        assert!(validate_readonly_node(&readonly, "sda")
            .unwrap_err()
            .contains("not a block device"));
        std::fs::remove_file(path).unwrap();
    }
}
