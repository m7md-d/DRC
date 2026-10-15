use crate::{
    acquisition::decimal,
    images::{self, FileEntry, ImageSource, Request},
    model::{now_ms, unique_id, CommandRecord, StreamArtifact},
    policy::{self, FileIdentity},
    store::Store,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::{
    io::AsRawFd,
    io::FromRawFd,
    process::{CommandExt, ExitStatusExt},
};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub entry: FileEntry,
    pub filename: String,
    pub maximum_bytes: String,
    pub state: String,
    pub written_bytes: String,
    pub record: Option<CommandRecord>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub session_id: String,
    pub source: ImageSource,
    pub request: Request,
    pub directory: String,
    pub directory_identity: FileIdentity,
    pub items: Vec<Item>,
    pub state: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub message: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub ticket: String,
    pub expires_at: u64,
    pub source: ImageSource,
    pub request: Request,
    pub destination: String,
    pub destination_identity: FileIdentity,
    pub free_bytes: String,
    pub items: Vec<Item>,
    pub confirmation: String,
}
struct Prepared {
    plan: Plan,
    input: File,
    directory: File,
}
pub type Sink = Arc<dyn Fn(Job, Option<CommandRecord>) + Send + Sync>;
#[derive(Default)]
pub struct Manager {
    prepared: Mutex<HashMap<String, Prepared>>,
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
    gate: Mutex<()>,
}
fn safe_filename(index: usize, entry: &FileEntry) -> String {
    let name: String = entry
        .name
        .chars()
        .map(|c| {
            if c.is_control() || ['/', '\\', ':', '?', '*', '"', '<', '>', '|'].contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = name.trim_matches([' ', '.']);
    let shortened: String = trimmed
        .chars()
        .scan(0usize, |bytes, c| {
            *bytes += c.len_utf8();
            (*bytes <= 200).then_some(c)
        })
        .collect();
    format!(
        "{:04}_{}",
        index + 1,
        if shortened.is_empty() {
            format!("metadata-{}.bin", entry.inode)
        } else {
            shortened
        }
    )
}
impl Manager {
    pub fn is_active(&self) -> bool {
        self.active.lock().map(|a| a.is_some()).unwrap_or(true)
    }
    pub fn active_id(&self) -> Option<String> {
        self.active
            .lock()
            .ok()
            .and_then(|a| a.as_ref().map(|a| a.0.clone()))
    }
    pub fn stop(&self, id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(|e| e.to_string())?;
        let (current, flag) = active
            .as_ref()
            .filter(|(current, _)| current == id)
            .ok_or("This extraction is not running.")?;
        let _ = current;
        flag.store(true, Ordering::SeqCst);
        Ok(())
    }
    pub fn plan(&self, ticket: &str) -> Result<Plan, String> {
        self.prepared
            .lock()
            .map_err(|e| e.to_string())?
            .get(ticket)
            .map(|p| p.plan.clone())
            .ok_or("Prepare an extraction first.".into())
    }
    pub fn cancel(&self, ticket: &str) {
        if let Ok(mut p) = self.prepared.lock() {
            p.remove(ticket);
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &self,
        source: ImageSource,
        input: File,
        request: Request,
        files: Vec<FileEntry>,
        destination: &Path,
        admitted: &FileIdentity,
    ) -> Result<Plan, String> {
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        if self.is_active() {
            return Err("An extraction is already running.".into());
        }
        let canonical = destination.canonicalize().map_err(|e| e.to_string())?;
        let directory = policy::open_readonly(&canonical)?;
        if !directory.metadata().map_err(|e| e.to_string())?.is_dir()
            || &policy::file_identity(&directory)? != admitted
        {
            return Err("The destination directory changed during admission.".into());
        }
        let mut total = 0u64;
        let mut items = Vec::new();
        for (index, entry) in files.into_iter().enumerate() {
            let size = decimal(&entry.size, "Reported file size")?;
            if size > i64::MAX as u64 {
                return Err("A selected file exceeds this host's signed file-size limit.".into());
            }
            policy::require_image_capacity(&directory, size)?;
            total = total
                .checked_add(size)
                .ok_or("Selected sizes overflow the supported range.")?;
            items.push(Item {
                filename: safe_filename(index, &entry),
                maximum_bytes: size.to_string(),
                entry,
                state: "pending".into(),
                written_bytes: "0".into(),
                record: None,
            });
        }
        let free = policy::available_bytes(&directory)?;
        if free < total.saturating_add(16 * 1024 * 1024) {
            return Err(
                "The destination does not have room for the reported sizes and extraction records."
                    .into(),
            );
        }
        let plan = Plan {
            ticket: unique_id("extract-plan"),
            expires_at: now_ms() + 120000,
            source,
            request,
            destination: canonical.to_string_lossy().into_owned(),
            destination_identity: admitted.clone(),
            free_bytes: free.to_string(),
            items,
            confirmation: "EXTRACT IMAGE".into(),
        };
        let mut prepared = self.prepared.lock().map_err(|e| e.to_string())?;
        prepared.clear();
        prepared.insert(
            plan.ticket.clone(),
            Prepared {
                plan: plan.clone(),
                input,
                directory,
            },
        );
        Ok(plan)
    }
    pub fn start(
        self: &Arc<Self>,
        ticket: &str,
        confirmation: &str,
        store: Arc<Store>,
        sink: Sink,
    ) -> Result<Job, String> {
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        if self.is_active() {
            return Err("An extraction is already running.".into());
        }
        let prepared = self
            .prepared
            .lock()
            .map_err(|e| e.to_string())?
            .remove(ticket)
            .ok_or("The extraction plan expired. Prepare it again.")?;
        let plan = &prepared.plan;
        if now_ms() > plan.expires_at || confirmation != plan.confirmation {
            return Err("The plan expired or the source confirmation differs.".into());
        }
        if policy::file_identity(&prepared.input)? != plan.source.identity {
            return Err("The source image changed after review.".into());
        }
        let current = policy::file_identity(&prepared.directory)?;
        if current.device != plan.destination_identity.device
            || current.inode != plan.destination_identity.inode
        {
            return Err("The destination changed after review.".into());
        }
        let total = plan
            .items
            .iter()
            .try_fold(0u64, |sum, item| {
                sum.checked_add(decimal(&item.maximum_bytes, "Output limit").ok()?)
            })
            .ok_or("Output size overflow")?;
        if policy::available_bytes(&prepared.directory)? < total.saturating_add(16 * 1024 * 1024) {
            return Err("Available space changed after review.".into());
        }
        let id = unique_id("extraction");
        let path = Path::new(&plan.destination).join(format!("DRC-{id}"));
        let parent = policy::path_identity(Path::new(&plan.destination))?;
        if parent.device != current.device || parent.inode != current.inode {
            return Err("The reviewed destination path was replaced.".into());
        }
        let directory = private_directory(&prepared.directory, &format!("DRC-{id}"))?;
        let pinned = policy::file_identity(&directory)?;
        let named = policy::path_identity(&path)?;
        if pinned.device != named.device || pinned.inode != named.inode {
            return Err("Destination path changed while the private directory was created.".into());
        }
        let job = Job {
            id: id.clone(),
            session_id: store.current_id()?,
            source: plan.source.clone(),
            request: plan.request.clone(),
            directory: path.to_string_lossy().into_owned(),
            directory_identity: policy::file_identity(&directory)?,
            items: plan.items.clone(),
            state: "running".into(),
            created_at: now_ms(),
            updated_at: now_ms(),
            message: None,
        };
        save(&store, &job, &directory)?;
        let stop = Arc::new(AtomicBool::new(false));
        *self.active.lock().map_err(|e| e.to_string())? = Some((id, stop.clone()));
        sink(job.clone(), None);
        let result = job.clone();
        let manager = self.clone();
        std::thread::spawn(move || {
            let mut job = job;
            let outcome = run(&mut job, &prepared.input, &directory, stop, &store, &sink);
            if let Err(error) = outcome {
                job.state = "failed".into();
                job.message = Some(error);
            }
            job.updated_at = now_ms();
            if let Err(error) = save(&store, &job, &directory) {
                job.state = "failed".into();
                job.message = Some(format!("Extraction persistence failed: {error}"));
            }
            if let Ok(mut active) = manager.active.lock() {
                *active = None;
            }
            sink(job, None);
        });
        Ok(result)
    }
}
#[cfg(unix)]
fn relative_file(directory: &File, name: &str, flags: i32) -> Result<File, String> {
    let name = std::ffi::CString::new(name).map_err(|e| e.to_string())?;
    // SAFETY: a new descriptor is owned on success; no path traversal is accepted by callers.
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn private_directory(parent: &File, name: &str) -> Result<File, String> {
    #[cfg(unix)]
    {
        let c = std::ffi::CString::new(name).map_err(|e| e.to_string())?;
        if unsafe { libc::mkdirat(parent.as_raw_fd(), c.as_ptr(), 0o700) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        relative_file(parent, name, libc::O_RDONLY | libc::O_DIRECTORY)
    }
    #[cfg(not(unix))]
    {
        let _ = (parent, name);
        Err("Pinned directories are unavailable on this host.".into())
    }
}
fn save(store: &Store, job: &Job, directory: &File) -> Result<(), String> {
    store.save_extraction(&job.id, job)?;
    let current = policy::path_identity(Path::new(&job.directory))?;
    let pinned = policy::file_identity(directory)?;
    if current.device != pinned.device
        || current.inode != pinned.inode
        || pinned.device != job.directory_identity.device
        || pinned.inode != job.directory_identity.inode
    {
        return Err("Extraction directory identity changed. Artifact writes blocked.".into());
    }
    #[cfg(unix)]
    {
        let temporary = unique_id("manifest");
        let mut file = relative_file(
            directory,
            &temporary,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        )?;
        file.write_all(&serde_json::to_vec_pretty(job).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        let old = std::ffi::CString::new(temporary).map_err(|e| e.to_string())?;
        let new = c"manifest.json";
        if unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                old.as_ptr(),
                directory.as_raw_fd(),
                new.as_ptr(),
            )
        } != 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        directory.sync_all().map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        Err("Pinned artifact persistence is unavailable on this host.".into())
    }
}
struct ChildGuard(std::process::Child);
impl std::ops::Deref for ChildGuard {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for ChildGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPage {
    pub offset: String,
    pub total_bytes: String,
    pub bytes_base64: String,
}
pub fn read_artifact(
    job: &Job,
    index: usize,
    offset: &str,
    length: usize,
) -> Result<ArtifactPage, String> {
    if length == 0 || length > 65536 {
        return Err("Choose a page of 1–65536 bytes.".into());
    }
    let artifact = job
        .items
        .get(index)
        .and_then(|item| item.record.as_ref())
        .and_then(|record| record.stdout_artifact.as_ref())
        .ok_or("No sealed stdout artifact was recorded for this entry.")?;
    let directory = policy::open_readonly(Path::new(&job.directory))?;
    let identity = policy::file_identity(&directory)?;
    if identity.device != job.directory_identity.device
        || identity.inode != job.directory_identity.inode
    {
        return Err("The extraction directory was replaced.".into());
    }
    #[cfg(unix)]
    let mut file = relative_file(&directory, &job.items[index].filename, libc::O_RDONLY)?;
    #[cfg(not(unix))]
    return Err("Pinned artifact reads are unavailable on this host.".into());
    #[cfg(unix)]
    {
        if !file.metadata().map_err(|e| e.to_string())?.is_file()
            || policy::file_identity(&file)? != artifact.identity
        {
            return Err("The recorded output was changed or replaced. Preview is blocked.".into());
        }
        let start = decimal(offset, "Artifact byte offset")?;
        let total = decimal(&artifact.bytes, "Artifact size")?;
        if start > total {
            return Err("Byte offset is beyond this artifact.".into());
        }
        let mut bytes = vec![0; length.min((total - start).min(65536) as usize)];
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        if policy::file_identity(&file)? != artifact.identity {
            return Err("Output identity changed during preview.".into());
        }
        Ok(ArtifactPage {
            offset: start.to_string(),
            total_bytes: total.to_string(),
            bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        })
    }
}
fn fingerprint(file: &mut File) -> Result<(String, bool), String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 1024 * 1024];
    let mut utf8 = true;
    let mut tail = Vec::new();
    loop {
        let n = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
        if utf8 {
            tail.extend_from_slice(&bytes[..n]);
            match std::str::from_utf8(&tail) {
                Ok(_) => tail.clear(),
                Err(e) if e.error_len().is_none() => {
                    let partial = tail.split_off(e.valid_up_to());
                    tail = partial;
                }
                Err(_) => {
                    utf8 = false;
                    tail.clear();
                }
            }
        }
    }
    Ok((format!("{:x}", hash.finalize()), utf8 && tail.is_empty()))
}
fn run(
    job: &mut Job,
    input: &File,
    directory: &File,
    stop: Arc<AtomicBool>,
    store: &Store,
    sink: &Sink,
) -> Result<(), String> {
    #[cfg(not(unix))]
    {
        let _ = (job, input, directory, stop, store, sink);
        return Err("Pinned extraction is not implemented on this host.".into());
    }
    #[cfg(unix)]
    {
        let fd = input.as_raw_fd();
        let directoryfd = directory.as_raw_fd();
        if unsafe { libc::fcntl(fd, libc::F_GETFL) } & libc::O_ACCMODE != libc::O_RDONLY {
            return Err("The source handle is not read only.".into());
        }
        for index in 0..job.items.len() {
            if stop.load(Ordering::SeqCst) {
                job.state = "stopped".into();
                job.message = Some(
                    "Stopped before the next file. Completed and partial outputs are retained."
                        .into(),
                );
                return Ok(());
            }
            if policy::file_identity(input)? != job.source.identity {
                return Err("The source image changed during extraction.".into());
            }
            let item = job.items[index].clone();
            let output_path = Path::new(&job.directory).join(&item.filename);
            let output_name =
                std::ffi::CString::new(item.filename.clone()).map_err(|e| e.to_string())?;
            let outputfd = unsafe {
                libc::openat(
                    directoryfd,
                    output_name.as_ptr(),
                    libc::O_RDWR
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if outputfd < 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            use std::os::unix::io::FromRawFd;
            // SAFETY: openat returned a new owned descriptor in the pinned private directory.
            let mut output = unsafe { File::from_raw_fd(outputfd) };
            let program = images::executable()?;
            let args = vec![
                "icat".into(),
                fd.to_string(),
                job.request.geometry.sector_size.to_string(),
                job.request.geometry.offset_sectors.clone(),
                job.request
                    .geometry
                    .filesystem
                    .clone()
                    .unwrap_or("auto".into()),
                "all".into(),
                item.entry.inode.clone(),
            ];
            let start = Instant::now();
            let cap = decimal(&item.maximum_bytes, "Output size limit")?;
            let mut record = CommandRecord {
                id: unique_id("file-extraction"),
                program: program.clone(),
                arguments: args.clone(),
                started_at: now_ms(),
                duration_ms: 0,
                exit_code: None,
                timed_out: false,
                stdout: String::new(),
                stderr: String::new(),
                stdout_base64: String::new(),
                stderr_base64: String::new(),
                stdout_utf8_valid: false,
                stderr_utf8_valid: true,
                launch_error: None,
                stdout_artifact: None,
                termination_signal: None,
                stdin: None,
            };
            let mut command = Command::new(program);
            command
                .args(args)
                .env("LC_ALL", "C")
                .stdin(Stdio::null())
                .stdout(Stdio::from(output.try_clone().map_err(|e| e.to_string())?))
                .stderr(Stdio::piped());
            if job.request.geometry.utc {
                command.env("TZ", "UTC");
            }
            // SAFETY: only async-signal-safe POSIX calls; RLIMIT_FSIZE bounds the
            // child's stdout file. The inherited input remains O_RDONLY.
            unsafe {
                command.pre_exec(move || {
                    let limit = libc::rlimit {
                        rlim_cur: cap,
                        rlim_max: cap,
                    };
                    if libc::fchdir(directoryfd) != 0
                        || libc::fcntl(fd, libc::F_SETFD, 0) != 0
                        || libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0
                    {
                        Err(std::io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
            job.items[index].state = "running".into();
            save(store, job, directory)?;
            sink(job.clone(), None);
            let mut child = match command.spawn() {
                Ok(child) => ChildGuard(child),
                Err(error) => {
                    record.launch_error = Some(error.to_string());
                    job.items[index].state = "failed".into();
                    job.items[index].record = Some(record.clone());
                    sink(job.clone(), Some(record));
                    return Err(error.to_string());
                }
            };
            let mut stderr = child.stderr.take().ok_or("No extraction stderr pipe")?;
            let err = std::thread::spawn(move || {
                let mut bytes = Vec::new();
                stderr.read_to_end(&mut bytes).map(|_| bytes)
            });
            let mut signalled = false;
            let mut signalled_at = None;
            let mut persistence_error = None;
            let mut last = Instant::now();
            loop {
                if stop.load(Ordering::SeqCst) && !signalled {
                    unsafe { libc::kill(child.id() as i32, libc::SIGINT) };
                    signalled = true;
                    signalled_at = Some(Instant::now());
                    job.state = "stopping".into();
                }
                if start.elapsed() > Duration::from_secs(3600) && !signalled {
                    record.timed_out = true;
                    let _ = child.kill();
                    signalled = true;
                }
                if signalled_at.is_some_and(|at: Instant| at.elapsed() > Duration::from_secs(5)) {
                    let _ = child.kill();
                }
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    record.exit_code = status.code();
                    record.termination_signal = status.signal();
                    record.duration_ms = start.elapsed().as_millis() as u64;
                    break;
                }
                if last.elapsed() > Duration::from_secs(1) {
                    job.items[index].written_bytes = output
                        .metadata()
                        .map_err(|e| e.to_string())?
                        .len()
                        .to_string();
                    job.updated_at = now_ms();
                    if let Err(error) = save(store, job, directory) {
                        stop.store(true, Ordering::SeqCst);
                        persistence_error = Some(error);
                    }
                    sink(job.clone(), None);
                    last = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            let errors = err
                .join()
                .map_err(|_| "Extraction stderr reader failed")?
                .map_err(|e| e.to_string())?;
            record.stderr_utf8_valid = std::str::from_utf8(&errors).is_ok();
            record.stderr = String::from_utf8_lossy(&errors).into_owned();
            record.stderr_base64 = base64::engine::general_purpose::STANDARD.encode(errors);
            let flush_error = output.sync_all().err().map(|e| e.to_string());
            let (digest, utf8) = fingerprint(&mut output)?;
            record.stdout_utf8_valid = utf8;
            let identity = policy::file_identity(&output)?;
            record.stdout_artifact = Some(StreamArtifact {
                path: output_path.to_string_lossy().into_owned(),
                bytes: identity.size.clone(),
                sha256: digest,
                identity: identity.clone(),
                operation_id: job.id.clone(),
                entry_index: index,
            });
            job.items[index].written_bytes = identity.size;
            let changed = policy::file_identity(input)? != job.source.identity;
            job.items[index].state = if record.exit_code == Some(0)
                && !record.timed_out
                && !changed
                && flush_error.is_none()
                && persistence_error.is_none()
            {
                "copied"
            } else {
                "partial"
            }
            .into();
            job.items[index].record = Some(record.clone());
            job.updated_at = now_ms();
            sink(job.clone(), Some(record.clone()));
            save(store, job, directory)?;
            if let Some(error) = persistence_error.or(flush_error) {
                return Err(error);
            }
            if changed {
                return Err(
                    "The source image changed during this file. Original stdout remains retained."
                        .into(),
                );
            }
            if signalled || stop.load(Ordering::SeqCst) {
                job.state = "stopped".into();
                job.message = Some(
                    "Stopped with completed/partial output streams retained. No automatic retry."
                        .into(),
                );
                return Ok(());
            }
            if record.exit_code != Some(0) {
                job.state = "failed".into();
                job.message=Some("The content reader did not exit successfully. Inspect its status and retained stdout/stderr; output is not labeled copied.".into());
                return Ok(());
            }
        }
        job.state = "completed".into();
        job.message=Some("Every selected content-reader invocation exited with status 0. This records process completion; it does not assess recovered data quality.".into());
        Ok(())
    }
}
pub fn recover(store: &Store) -> Result<(), String> {
    for mut job in store.extractions::<Job>()? {
        if matches!(job.state.as_str(), "running" | "stopping") {
            job.state = "interrupted".into();
            job.message=Some("DRC exited before recording completion. No external artifacts were accessed and no operation was resumed.".into());
            store.save_extraction(&job.id, &job)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::images::{Action, Geometry};
    fn fixture() -> (
        std::path::PathBuf,
        images::Manager,
        ImageSource,
        Arc<Store>,
        Request,
    ) {
        let root = std::env::temp_dir().join(unique_id("drc-extract-test"));
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/make_fat_fixture.py");
        assert!(Command::new("python3")
            .arg(script)
            .arg(&root)
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success());
        let store = Arc::new(Store::open(&root.join("state")).unwrap());
        let reader = images::Manager::default();
        let source = reader.open(&root.join("fat16-volume.img")).unwrap();
        let request = Request {
            token: source.token.clone(),
            action: Action::Directory,
            geometry: Geometry {
                sector_size: 512,
                offset_sectors: "0".into(),
                filesystem: Some("fat16".into()),
                utc: true,
            },
            inode: None,
            entries: "all".into(),
        };
        (root, reader, source, store, request)
    }
    fn wait(manager: &Manager, store: &Store, id: &str) -> Job {
        let deadline = Instant::now();
        while manager.is_active() && deadline.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!manager.is_active(), "Extraction exceeded test deadline");
        store
            .extractions::<Job>()
            .unwrap()
            .into_iter()
            .find(|job| job.id == id)
            .unwrap()
    }
    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
    #[test]
    fn real_extraction_keeps_allocated_deleted_unicode_and_binary_streams_exact() {
        let (root, reader, source, store, request) = fixture();
        let original = std::fs::read(&source.path).unwrap();
        let expected: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("expected.json")).unwrap()).unwrap();
        let report = reader.query(request.clone()).unwrap();
        let selected: Vec<_> = report
            .files
            .iter()
            .enumerate()
            .filter(|(_, file)| {
                file.name == "HELLO.TXT" || file.deleted || file.name == "Recovery Ω.txt"
            })
            .map(|(i, _)| i)
            .collect();
        assert_eq!(selected.len(), 3);
        let (source, input, req, files) = reader.extraction_source(&report.id, &selected).unwrap();
        let manager = Arc::new(Manager::default());
        let plan = manager
            .prepare(
                source,
                input,
                req,
                files,
                &root,
                &policy::path_identity(&root).unwrap(),
            )
            .unwrap();
        let job = manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let job = wait(&manager, &store, &job.id);
        assert_eq!(job.state, "completed");
        for (index, item) in job.items.iter().enumerate() {
            let key = if item.entry.deleted {
                "deleted"
            } else {
                &item.entry.name
            };
            let bytes = std::fs::read(Path::new(&job.directory).join(&item.filename)).unwrap();
            assert_eq!(hex(&bytes), expected["files"][key].as_str().unwrap());
            let record = item.record.as_ref().unwrap();
            let artifact = record.stdout_artifact.as_ref().unwrap();
            assert_eq!(artifact.sha256, policy::digest(&bytes));
            assert_eq!(artifact.bytes, bytes.len().to_string());
            assert!(record.stdout.is_empty() && record.stdout_base64.is_empty());
            let page = read_artifact(&job, index, "1", 16).unwrap();
            assert_eq!(
                base64::engine::general_purpose::STANDARD
                    .decode(page.bytes_base64)
                    .unwrap(),
                bytes[1..17]
            );
        }
        let docs = report.files.iter().find(|f| f.name == "DOCS").unwrap();
        let mut nested = request;
        nested.inode = Some(docs.inode.clone());
        let report = reader.query(nested).unwrap();
        let index = report
            .files
            .iter()
            .position(|f| f.name == "NESTED.BIN")
            .unwrap();
        let (source, input, req, files) = reader.extraction_source(&report.id, &[index]).unwrap();
        let plan = manager
            .prepare(
                source,
                input,
                req,
                files,
                &root,
                &policy::path_identity(&root).unwrap(),
            )
            .unwrap();
        let job = manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let job = wait(&manager, &store, &job.id);
        assert_eq!(job.state, "completed");
        assert!(!job.items[0].record.as_ref().unwrap().stdout_utf8_valid);
        assert_eq!(
            hex(&std::fs::read(Path::new(&job.directory).join(&job.items[0].filename)).unwrap()),
            expected["files"]["DOCS/NESTED.BIN"].as_str().unwrap()
        );
        assert_eq!(std::fs::read(&job.source.path).unwrap(), original);
        std::fs::write(
            Path::new(&job.directory).join(&job.items[0].filename),
            b"changed",
        )
        .unwrap();
        assert!(read_artifact(&job, 0, "0", 256).is_err());
        assert!(read_artifact(&job, 0, "0", 65537).is_err());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn output_limit_retains_partial_stdout_and_never_labels_it_copied() {
        let (root, reader, _, store, req) = fixture();
        let report = reader.query(req).unwrap();
        let index = report
            .files
            .iter()
            .position(|f| f.name == "HELLO.TXT")
            .unwrap();
        let (source, input, req, files) = reader.extraction_source(&report.id, &[index]).unwrap();
        let manager = Arc::new(Manager::default());
        let plan = manager
            .prepare(
                source,
                input,
                req,
                files,
                &root,
                &policy::path_identity(&root).unwrap(),
            )
            .unwrap();
        manager
            .prepared
            .lock()
            .unwrap()
            .get_mut(&plan.ticket)
            .unwrap()
            .plan
            .items[0]
            .maximum_bytes = "5".into();
        let job = manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let job = wait(&manager, &store, &job.id);
        assert_eq!(job.state, "failed");
        assert_eq!(job.items[0].state, "partial");
        assert!(job.items[0].written_bytes.parse::<u64>().unwrap() <= 5);
        assert_ne!(job.items[0].record.as_ref().unwrap().exit_code, Some(0));
        assert!(job.items[0]
            .record
            .as_ref()
            .unwrap()
            .stdout_artifact
            .is_some());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn changed_source_and_destination_block_review_and_names_cannot_escape_or_exceed_host_limit() {
        let (root, reader, source, store, req) = fixture();
        let report = reader.query(req).unwrap();
        let index = report
            .files
            .iter()
            .position(|f| f.name == "HELLO.TXT")
            .unwrap();
        assert!(reader
            .extraction_source(&report.id, &[index, index])
            .is_err());
        let directory_index = report.files.iter().position(|f| f.name == "DOCS").unwrap();
        assert!(reader
            .extraction_source(&report.id, &[directory_index])
            .is_err());
        let (src, input, req, mut files) = reader.extraction_source(&report.id, &[index]).unwrap();
        files[0].name = format!("../../{}", "界".repeat(300));
        let manager = Arc::new(Manager::default());
        let destination = root.join("destination");
        std::fs::create_dir(&destination).unwrap();
        let plan = manager
            .prepare(
                src,
                input,
                req,
                files,
                &destination,
                &policy::path_identity(&destination).unwrap(),
            )
            .unwrap();
        assert!(plan.items[0].filename.len() < 255);
        assert!(!plan.items[0].filename.contains('/'));
        std::fs::rename(&destination, root.join("renamed")).unwrap();
        std::fs::create_dir(&destination).unwrap();
        assert!(manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                Arc::new(|_, _| {})
            )
            .is_err());
        let (src, input, req, files) = reader.extraction_source(&report.id, &[index]).unwrap();
        let plan = manager
            .prepare(
                src,
                input,
                req,
                files,
                &destination,
                &policy::path_identity(&destination).unwrap(),
            )
            .unwrap();
        std::fs::write(&source.path, b"changed image").unwrap();
        assert!(manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                Arc::new(|_, _| {})
            )
            .is_err());
        assert!(!manager.is_active());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
