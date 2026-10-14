use crate::{
    model::{now_ms, CommandRecord, Device},
    mount_guard::MountGuard,
    policy::{self, FileIdentity},
    rates::{self, ProgressReport, ProgressSample, RateReport},
    store::Store,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::{fs::OpenOptionsExt, io::AsRawFd, process::CommandExt};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Source {
    Image {
        path: String,
        identity: FileIdentity,
    },
    Physical {
        device: Box<Device>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub offset: String,
    pub length: Option<String>,
    pub sector_size: u32,
    pub retry_passes: u8,
    pub copying_only: bool,
    pub timeout_seconds: u32,
    pub max_read_rate: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBlock {
    pub position: String,
    pub size: String,
    pub status: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSummary {
    pub rescued_bytes: String,
    pub non_tried_bytes: String,
    pub non_trimmed_bytes: String,
    pub non_scraped_bytes: String,
    pub bad_sector_bytes: String,
    pub domain_bytes: String,
    pub blocks: Vec<MapBlock>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub session_id: String,
    pub source: Source,
    pub source_size: String,
    pub directory: String,
    pub directory_identity: FileIdentity,
    pub image_path: String,
    pub map_path: String,
    pub stdout_path: String,
    pub stderr_path: String,
    pub settings: Settings,
    pub state: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
    pub map: Option<MapSummary>,
    pub image_identity: Option<FileIdentity>,
    pub map_digest: Option<String>,
    pub attempts: u32,
    pub tool_version: String,
    pub latest_record: Option<CommandRecord>,
    #[serde(default)]
    pub rate_reports: Vec<RateReport>,
    #[serde(default)]
    pub progress_reports: Vec<ProgressReport>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub ticket: String,
    pub expires_at: u64,
    pub source: Source,
    pub source_size: String,
    pub destination_directory: String,
    pub free_bytes: String,
    pub settings: Settings,
    pub program: String,
    pub arguments: Vec<String>,
    pub confirmation: String,
    pub resume_job: Option<String>,
}

struct Prepared {
    plan: Plan,
    input: File,
    directory: File,
    directory_identity: FileIdentity,
    guard: Option<MountGuard>,
}

pub type Sink = Arc<dyn Fn(Job, Option<CommandRecord>) + Send + Sync>;
#[derive(Default)]
pub struct Manager {
    prepared: Mutex<HashMap<String, Prepared>>,
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
    gate: Mutex<()>,
}

pub fn executable() -> Result<String, String> {
    [
        "/opt/homebrew/bin/ddrescue",
        "/usr/local/bin/ddrescue",
        "/usr/bin/ddrescue",
    ]
    .into_iter()
    .find(|p| Path::new(p).is_file())
    .map(str::to_owned)
    .ok_or("GNU ddrescue is not installed at a supported location.".into())
}

pub fn decimal(value: &str, label: &str) -> Result<u64, String> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("{label} must be an unsigned decimal byte count."));
    }
    value
        .parse()
        .map_err(|_| format!("{label} exceeds the supported integer range."))
}

fn validate_settings(settings: &mut Settings, total: u64) -> Result<(), String> {
    if total > i64::MAX as u64 {
        return Err("The source capacity exceeds this host's signed file-offset range.".into());
    }
    let offset = decimal(&settings.offset, "Offset")?;
    let length = match &settings.length {
        Some(n) => decimal(n, "Length")?,
        None => total
            .checked_sub(offset)
            .ok_or("Offset exceeds source size")?,
    };
    if length == 0
        || offset
            .checked_add(length)
            .filter(|end| *end <= total)
            .is_none()
    {
        return Err("The selected range is empty or outside the source capacity.".into());
    }
    if !matches!(settings.sector_size, 512 | 1024 | 2048 | 4096) {
        return Err("Sector size must be 512, 1024, 2048 or 4096 bytes.".into());
    }
    if offset % u64::from(settings.sector_size) != 0 {
        return Err("The input offset must align with the selected logical sector size.".into());
    }
    if settings.retry_passes > 5 || !(1..=3600).contains(&settings.timeout_seconds) {
        return Err("Retries must be 0–5 and the read-success timeout 1–3600 seconds.".into());
    }
    if settings.copying_only && settings.retry_passes > 0 {
        return Err("Retry passes require full rescue phases. Disable Copying phase only or set retries to zero.".into());
    }
    if let Some(rate) = &settings.max_read_rate {
        if decimal(rate, "Maximum read rate")? == 0 {
            return Err(
                "Maximum read rate must be greater than zero, or left empty for no cap.".into(),
            );
        }
    }
    settings.length = Some(length.to_string());
    Ok(())
}

pub fn arguments(
    settings: &Settings,
    total: &str,
    input: &str,
    output: &str,
    map: &str,
    rates: &str,
) -> Vec<String> {
    let mut args = vec![
        format!("--input-position={}", settings.offset),
        format!("--output-position={}", settings.offset),
        format!("--size={}", settings.length.as_deref().unwrap_or(total)),
        format!("--sector-size={}", settings.sector_size),
        format!("--retry-passes={}", settings.retry_passes),
        format!("--timeout={}s", settings.timeout_seconds),
        "--mapfile-interval=1s,5s".into(),
        "--synchronous".into(),
        format!("--log-rates={rates}"),
        format!("--extend-outfile={total}"),
    ];
    if settings.copying_only {
        args.extend([
            "--no-trim".into(),
            "--no-sweep".into(),
            "--no-scrape".into(),
        ]);
    }
    if let Some(rate) = &settings.max_read_rate {
        args.push(format!("--max-read-rate={rate}"));
    }
    args.extend(["--".into(), input.into(), output.into(), map.into()]);
    args
}

pub fn resume_settings(job: &Job, mut requested: Settings) -> Result<Settings, String> {
    if requested.offset != job.settings.offset
        || requested.length != job.settings.length
        || requested.sector_size != job.settings.sector_size
    {
        return Err("A resumed image must retain its original offset, length and logical sector size. Only read phases, retries, timeout and rate cap may change.".into());
    }
    validate_settings(&mut requested, decimal(&job.source_size, "Source size")?)?;
    Ok(requested)
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
        let (current, flag) = active.as_ref().ok_or("No acquisition is running.")?;
        if current != id {
            return Err("This operation is not the running acquisition.".into());
        }
        flag.store(true, Ordering::SeqCst);
        Ok(())
    }
    pub fn cancel_plan(&self, ticket: &str) {
        if let Ok(mut p) = self.prepared.lock() {
            p.remove(ticket);
        }
    }
    pub fn plan(&self, ticket: &str) -> Result<Plan, String> {
        self.prepared
            .lock()
            .map_err(|e| e.to_string())?
            .get(ticket)
            .map(|p| p.plan.clone())
            .ok_or("The reviewed plan expired.".into())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        self: &Arc<Self>,
        source: Source,
        input: File,
        guard: Option<MountGuard>,
        destination: &Path,
        mut settings: Settings,
        total: u64,
        resume: Option<&Job>,
        admitted_directory: Option<FileIdentity>,
    ) -> Result<Plan, String> {
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        if self.is_active() {
            return Err("An acquisition already holds the source/destination lock.".into());
        }
        validate_settings(&mut settings, total)?;
        #[cfg(unix)]
        if unsafe { libc::fcntl(input.as_raw_fd(), libc::F_GETFL) } & libc::O_ACCMODE
            != libc::O_RDONLY
        {
            return Err("The acquisition source handle is not read-only.".into());
        }
        if !destination.is_absolute() || destination.starts_with("/dev") {
            return Err(
                "Choose an existing destination folder; raw device destinations are not enabled."
                    .into(),
            );
        }
        let canonical = destination.canonicalize().map_err(|e| e.to_string())?;
        if canonical.to_str().is_none() {
            return Err("The destination path cannot be represented faithfully as UTF-8.".into());
        }
        let directory = policy::open_readonly(&canonical)?;
        if !directory.metadata().map_err(|e| e.to_string())?.is_dir() {
            return Err("The destination must be a directory.".into());
        }
        let directory_identity = policy::file_identity(&directory)?;
        if admitted_directory.as_ref().is_some_and(|d| {
            d.device != directory_identity.device || d.inode != directory_identity.inode
        }) {
            return Err("The destination changed while being admitted.".into());
        }
        let free = policy::available_bytes(&directory)?;
        policy::require_image_capacity(&directory, total)?;
        let needed = if let Some(job) = resume {
            verify_resume(job, &directory_identity)?;
            let rescued = job
                .map
                .as_ref()
                .and_then(|m| m.rescued_bytes.parse::<u64>().ok())
                .unwrap_or(0);
            total.saturating_sub(rescued)
        } else {
            total
        };
        if free < needed.saturating_add(16 * 1024 * 1024) {
            return Err(format!("Insufficient destination space: {free} bytes available; at least {needed} image bytes plus a 16 MiB log reserve are required."));
        }
        let program = executable()?;
        let ticket = crate::model::unique_id("plan");
        let input_label = match &source {
            Source::Image { path, .. } => path.clone(),
            Source::Physical { device } => format!("/dev/r{}", device.id),
        };
        let output_label = resume.map(|j| j.image_path.clone()).unwrap_or_else(|| {
            canonical
                .join(format!(
                    "DRC-{}/image.raw",
                    ticket.replace("plan-", "acquisition-")
                ))
                .to_string_lossy()
                .into_owned()
        });
        let map_label = resume.map(|j| j.map_path.clone()).unwrap_or_else(|| {
            canonical
                .join(format!(
                    "DRC-{}/rescue.map",
                    ticket.replace("plan-", "acquisition-")
                ))
                .to_string_lossy()
                .into_owned()
        });
        let confirmation = match &source {
            Source::Image { .. } => "ACQUIRE IMAGE".into(),
            Source::Physical { device } => format!("ACQUIRE {}", device.id),
        };
        let plan = Plan {
            ticket: ticket.clone(),
            expires_at: now_ms() + 120_000,
            source,
            source_size: total.to_string(),
            destination_directory: canonical.to_string_lossy().into_owned(),
            free_bytes: free.to_string(),
            settings: settings.clone(),
            program,
            arguments: arguments(
                &settings,
                &total.to_string(),
                &input_label,
                &output_label,
                &map_label,
                &Path::new(&map_label)
                    .with_file_name(format!(
                        "rates-attempt-{}.log",
                        resume.map_or(1, |j| j.attempts + 1)
                    ))
                    .to_string_lossy(),
            ),
            confirmation,
            resume_job: resume.map(|j| j.id.clone()),
        };
        let mut prepared = self.prepared.lock().map_err(|e| e.to_string())?;
        prepared.clear(); // one reviewable plan; a new plan releases the previous guard/handles
        prepared.insert(
            ticket.clone(),
            Prepared {
                plan: plan.clone(),
                input,
                directory,
                directory_identity,
                guard,
            },
        );
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(121));
            if let Some(manager) = weak.upgrade() {
                manager.cancel_plan(&ticket);
            }
        });
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
            return Err("Another acquisition is running.".into());
        }
        let prepared = self
            .prepared
            .lock()
            .map_err(|e| e.to_string())?
            .remove(ticket)
            .ok_or("The reviewed plan expired. Prepare it again.")?;
        if prepared.plan.expires_at < now_ms() || confirmation != prepared.plan.confirmation {
            return Err("The plan expired or its source confirmation does not match.".into());
        }
        if let Source::Image { identity, .. } = &prepared.plan.source {
            if &policy::file_identity(&prepared.input)? != identity {
                return Err("The source image changed after review.".into());
            }
        }
        let directory_identity = policy::file_identity(&prepared.directory)?;
        if directory_identity.device != prepared.directory_identity.device
            || directory_identity.inode != prepared.directory_identity.inode
        {
            return Err("The destination directory changed after review.".into());
        }
        let needed = if let Some(id) = &prepared.plan.resume_job {
            let old = store
                .jobs::<Job>()?
                .into_iter()
                .find(|j| &j.id == id)
                .ok_or("Saved acquisition was not found")?;
            acquisition_remaining(&old)?
        } else {
            decimal(&prepared.plan.source_size, "Source size")?
        };
        if policy::available_bytes(&prepared.directory)? < needed.saturating_add(16 * 1024 * 1024) {
            return Err("Destination space decreased after review; prepare the plan again.".into());
        }
        let version = Command::new(&prepared.plan.program)
            .arg("--version")
            .output()
            .map_err(|e| e.to_string())?;
        if !version.status.success() {
            return Err("Unable to verify GNU ddrescue version.".into());
        }
        let version = String::from_utf8_lossy(&version.stdout).into_owned();
        if version.lines().next() != Some("GNU ddrescue 1.30") {
            return Err("This adapter is verified with GNU ddrescue 1.30; a different version requires validation.".into());
        }
        let (mut job, directory) = if let Some(id) = &prepared.plan.resume_job {
            let job = store
                .jobs::<Job>()?
                .into_iter()
                .find(|j| &j.id == id)
                .ok_or("The saved acquisition was not found")?;
            verify_resume(&job, &directory_identity)?;
            (job, prepared.directory)
        } else {
            let id = prepared.plan.ticket.replace("plan-", "acquisition-");
            let parent = Path::new(&prepared.plan.destination_directory);
            let path = parent.join(format!("DRC-{id}"));
            // mkdirat pins the already reviewed parent; no existing directory is reused.
            #[cfg(unix)]
            {
                let name =
                    std::ffi::CString::new(format!("DRC-{id}")).map_err(|e| e.to_string())?;
                if unsafe { libc::mkdirat(prepared.directory.as_raw_fd(), name.as_ptr(), 0o700) }
                    != 0
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                prepared.directory.sync_all().map_err(|e| e.to_string())?;
            }
            let directory = policy::open_readonly(&path)?;
            let mut output = OpenOptions::new();
            output.read(true).write(true).create_new(true);
            #[cfg(unix)]
            output.mode(0o600).custom_flags(libc::O_NOFOLLOW);
            let image = output
                .open(path.join("image.raw"))
                .map_err(|e| e.to_string())?;
            image.sync_all().map_err(|e| e.to_string())?;
            let job = Job {
                id,
                session_id: store.current_id()?,
                source: prepared.plan.source.clone(),
                source_size: prepared.plan.source_size.clone(),
                directory: path.to_string_lossy().into_owned(),
                directory_identity: policy::file_identity(&directory)?,
                image_path: path.join("image.raw").to_string_lossy().into_owned(),
                map_path: path.join("rescue.map").to_string_lossy().into_owned(),
                stdout_path: path.join("stdout.bin").to_string_lossy().into_owned(),
                stderr_path: path.join("stderr.bin").to_string_lossy().into_owned(),
                settings: prepared.plan.settings.clone(),
                state: "prepared".into(),
                created_at: now_ms(),
                updated_at: now_ms(),
                exit_code: None,
                message: None,
                map: None,
                image_identity: Some(policy::file_identity(&image)?),
                map_digest: None,
                attempts: 0,
                tool_version: version,
                latest_record: None,
                rate_reports: Vec::new(),
                progress_reports: Vec::new(),
            };
            (job, directory)
        };
        let lock = open_lock(Path::new(&job.directory))?;
        job.attempts += 1;
        job.settings = prepared.plan.settings.clone();
        job.state = "running".into();
        job.updated_at = now_ms();
        job.exit_code = None;
        job.message = None;
        save_job(&store, &job)?;
        let stop = Arc::new(AtomicBool::new(false));
        *self.active.lock().map_err(|e| e.to_string())? = Some((job.id.clone(), stop.clone()));
        sink(job.clone(), None);
        let manager = self.clone();
        let result = job.clone();
        std::thread::spawn(move || {
            let _guard = prepared.guard;
            let lock = lock;
            let mut job = job;
            let record = run(
                &mut job,
                prepared.input,
                directory,
                &lock,
                stop,
                &store,
                &sink,
            );
            job.latest_record = Some(record.clone());
            if let Err(error) = save_job(&store, &job) {
                job.message = Some(format!(
                    "{}; persistence error: {error}",
                    job.message.as_deref().unwrap_or("Operation stopped")
                ));
                job.state = "failed".into();
            }
            if let Ok(mut active) = manager.active.lock() {
                *active = None;
            }
            sink(job, Some(record));
        });
        Ok(result)
    }
}

fn open_lock(directory: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    let file = options
        .open(directory.join("operation.lock"))
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("The operation files are locked by another process. DRC will not start a second writer.".into());
    }
    Ok(file)
}

fn acquisition_remaining(job: &Job) -> Result<u64, String> {
    let size = decimal(&job.source_size, "Source size")?;
    let rescued = job
        .map
        .as_ref()
        .map(|m| decimal(&m.rescued_bytes, "Rescued bytes"))
        .transpose()?
        .unwrap_or(0);
    Ok(size.saturating_sub(rescued))
}

fn verify_resume(job: &Job, directory: &FileIdentity) -> Result<(), String> {
    if matches!(job.state.as_str(), "running" | "pausing" | "completed") {
        return Err("This operation is running or already complete.".into());
    }
    if directory.device != job.directory_identity.device
        || directory.inode != job.directory_identity.inode
    {
        return Err("The saved destination directory was replaced.".into());
    }
    let image = policy::open_readonly(Path::new(&job.image_path))?;
    if !image.metadata().map_err(|e| e.to_string())?.is_file()
        || Some(policy::file_identity(&image)?) != job.image_identity
    {
        return Err(
            "The destination image changed outside this acquisition. Resume is blocked.".into(),
        );
    }
    let bytes = read_regular(Path::new(&job.map_path))?;
    if Some(policy::digest(&bytes)) != job.map_digest {
        return Err("The saved mapfile was replaced or modified. Resume is blocked.".into());
    }
    parse_map(&bytes, &job.settings, &job.source_size)?;
    let _lock = open_lock(Path::new(&job.directory))?;
    Ok(())
}

pub fn read_regular(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = policy::open_readonly(path)?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("The operation artifact is not a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn save_job(store: &Store, job: &Job) -> Result<(), String> {
    let current = policy::path_identity(Path::new(&job.directory))?;
    if current.device != job.directory_identity.device
        || current.inode != job.directory_identity.inode
    {
        return Err(
            "The acquisition directory was moved or replaced. Artifact writes are blocked.".into(),
        );
    }
    store.save_job(&job.id, job)?;
    let temp = Path::new(&job.directory).join("manifest.tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    let mut f = options.open(&temp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec_pretty(job).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    std::fs::rename(&temp, Path::new(&job.directory).join("manifest.json"))
        .map_err(|e| e.to_string())?;
    policy::open_readonly(Path::new(&job.directory))?
        .sync_all()
        .map_err(|e| e.to_string())
}

fn run(
    job: &mut Job,
    input: File,
    directory: File,
    lock: &File,
    stop: Arc<AtomicBool>,
    store: &Store,
    sink: &Sink,
) -> CommandRecord {
    let started = Instant::now();
    let at = now_ms();
    let program = executable().unwrap_or_default();
    let mut record = CommandRecord {
        id: format!("{}-attempt-{}", job.id, job.attempts),
        program: program.clone(),
        arguments: Vec::new(),
        started_at: at,
        duration_ms: 0,
        exit_code: None,
        timed_out: false,
        stdout: String::new(),
        stderr: String::new(),
        stdout_base64: String::new(),
        stderr_base64: String::new(),
        stdout_utf8_valid: true,
        stderr_utf8_valid: true,
        launch_error: None,
        stdout_artifact: None,
        termination_signal: None,
    };
    let outcome = (|| -> Result<(), String> {
        #[cfg(not(unix))]
        return Err("Pinned acquisition handles are not implemented on this host.".into());
        #[cfg(unix)]
        {
            let inputfd = input.as_raw_fd();
            let directoryfd = directory.as_raw_fd();
            let lockfd = lock.as_raw_fd();
            let rate_name = format!("rates-attempt-{}.log", job.attempts);
            let rate_path = Path::new(&job.directory).join(&rate_name);
            // ddrescue overwrites its rate log. Reserve a new, private file for
            // each attempt so previous measurements cannot be overwritten.
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&rate_path)
                .map_err(|e| e.to_string())?;
            job.rate_reports.push(rates::report(
                job.attempts,
                at,
                rate_path.to_string_lossy().into_owned(),
                b"",
                true,
            ));
            job.progress_reports.push(ProgressReport {
                attempt: job.attempts,
                started_at: at,
                samples: Vec::new(),
            });
            record.arguments = arguments(
                &job.settings,
                &job.source_size,
                &format!("/dev/fd/{inputfd}"),
                "image.raw",
                "rescue.map",
                &rate_name,
            );
            let mut command = Command::new(&program);
            command
                .args(&record.arguments)
                .env("LC_ALL", "C")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            // SAFETY: pre_exec only makes async-signal-safe POSIX calls. The source
            // remains O_RDONLY; cwd is the reviewed private destination directory.
            unsafe {
                command.pre_exec(move || {
                    if libc::fchdir(directoryfd) != 0
                        || libc::fcntl(inputfd, libc::F_SETFD, 0) != 0
                        || libc::fcntl(lockfd, libc::F_SETFD, 0) != 0
                    {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            let stdout = child.stdout.take().ok_or("Missing acquisition stdout")?;
            let stderr = child.stderr.take().ok_or("Missing acquisition stderr")?;
            let out = match spool(stdout, Path::new(&job.stdout_path), job.attempts) {
                Ok(reader) => reader,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            let err = match spool(stderr, Path::new(&job.stderr_path), job.attempts) {
                Ok(reader) => reader,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = out.join();
                    return Err(error);
                }
            };
            let mut signalled = false;
            let mut last = Instant::now();
            let mut save_failure: Option<String> = None;
            loop {
                if stop.load(Ordering::SeqCst) && !signalled {
                    if unsafe { libc::kill(child.id() as i32, libc::SIGINT) } != 0 {
                        save_failure = Some(std::io::Error::last_os_error().to_string());
                    }
                    signalled = true;
                    job.state = "pausing".into();
                    job.message=Some("SIGINT requested. Waiting for ddrescue to save its mapfile and exit; kernel I/O can delay this.".into());
                    job.updated_at = now_ms();
                    sink(job.clone(), None);
                }
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    record.exit_code = status.code();
                    break;
                }
                if last.elapsed() >= Duration::from_secs(1) {
                    if update_artifacts(job) {
                        sample_progress(job, started.elapsed().as_millis() as u64);
                    }
                    update_rates(job, true);
                    record.duration_ms = started.elapsed().as_millis() as u64;
                    update_record(&mut record, job);
                    job.latest_record = Some(record.clone());
                    if let Err(e) = save_job(store, job) {
                        save_failure = Some(e);
                        stop.store(true, Ordering::SeqCst);
                    }
                    sink(job.clone(), Some(record.clone()));
                    last = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let out_result = out.join().map_err(|_| "stdout spool failed")?;
            let err_result = err.join().map_err(|_| "stderr spool failed")?;
            out_result?;
            err_result?;
            policy::open_readonly(Path::new(&job.image_path))?
                .sync_all()
                .map_err(|e| e.to_string())?;
            if update_artifacts(job) {
                sample_progress(job, started.elapsed().as_millis() as u64);
            }
            update_rates(job, false);
            if let Source::Image { identity, .. } = &job.source {
                if &policy::file_identity(&input)? != identity {
                    return Err("The source image changed during acquisition. The output cannot be marked complete.".into());
                }
            }
            job.exit_code = record.exit_code;
            let complete = job
                .map
                .as_ref()
                .is_some_and(|m| m.rescued_bytes == m.domain_bytes);
            job.state = if complete && record.exit_code == Some(0) {
                "completed"
            } else if signalled && job.map_digest.is_some() {
                "paused"
            } else if record.exit_code == Some(0) && job.map.is_some() {
                "incomplete"
            } else {
                "failed"
            }
            .into();
            job.message = if job.state == "completed" {
                Some("The mapfile marks every byte in the requested range as finished (+).".into())
            } else if job.state == "paused" {
                Some("Stopped with a saved mapfile. Resume requires a new source/destination review.".into())
            } else {
                Some("Inspect the exit status, mapfile and original output. No automatic retry or reconnect is performed.".into())
            };
            if let Some(error) = save_failure {
                return Err(format!("Acquisition persistence failed: {error}"));
            }
        }
        Ok(())
    })();
    if let Err(error) = outcome {
        record.launch_error = Some(error.clone());
        job.state = "failed".into();
        job.message = Some(error);
    }
    update_record(&mut record, job);
    update_rates(job, false);
    record.duration_ms = started.elapsed().as_millis() as u64;
    job.updated_at = now_ms();
    record
}

fn spool<R: Read + Send + 'static>(
    mut input: R,
    path: &Path,
    attempt: u32,
) -> Result<std::thread::JoinHandle<Result<(), String>>, String> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    // Each attempt keeps its own original bytes; aggregate stream files retain all attempts.
    let attempt_path = path.with_file_name(format!(
        "{}-attempt-{attempt}.bin",
        path.file_stem().unwrap_or_default().to_string_lossy()
    ));
    let mut separate = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(attempt_path)
        .map_err(|e| e.to_string())?;
    Ok(std::thread::spawn(move || {
        let mut bytes = [0; 8192];
        loop {
            let n = input.read(&mut bytes).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            file.write_all(&bytes[..n]).map_err(|e| e.to_string())?;
            separate.write_all(&bytes[..n]).map_err(|e| e.to_string())?;
            file.sync_data().map_err(|e| e.to_string())?;
        }
        separate.sync_all().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())
    }))
}

fn update_record(record: &mut CommandRecord, job: &Job) {
    for (path, text, b64, valid) in [
        (
            &job.stdout_path,
            &mut record.stdout,
            &mut record.stdout_base64,
            &mut record.stdout_utf8_valid,
        ),
        (
            &job.stderr_path,
            &mut record.stderr,
            &mut record.stderr_base64,
            &mut record.stderr_utf8_valid,
        ),
    ] {
        let p = Path::new(path);
        let attempt = p.with_file_name(format!(
            "{}-attempt-{}.bin",
            p.file_stem().unwrap_or_default().to_string_lossy(),
            job.attempts
        ));
        if let Ok(bytes) = read_regular(&attempt) {
            *valid = std::str::from_utf8(&bytes).is_ok();
            *text = String::from_utf8_lossy(&bytes).into_owned();
            *b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        }
    }
}

fn update_artifacts(job: &mut Job) -> bool {
    if !policy::path_identity(Path::new(&job.directory)).is_ok_and(|d| {
        d.device == job.directory_identity.device && d.inode == job.directory_identity.inode
    }) {
        job.message =
            Some("Acquisition directory identity changed; artifact reads are blocked.".into());
        return false;
    }
    let mut observed = false;
    if let Ok(bytes) = read_regular(Path::new(&job.map_path)) {
        match parse_map(&bytes, &job.settings, &job.source_size) {
            Ok(map) => {
                observed = true;
                job.map = Some(map);
                job.map_digest = Some(policy::digest(&bytes));
            }
            Err(error) => {
                job.message = Some(format!(
                    "Mapfile parse error; original bytes retained: {error}"
                ));
                job.map = None;
                job.map_digest = None;
            }
        }
    }
    if let Ok(file) = policy::open_readonly(Path::new(&job.image_path)) {
        job.image_identity = policy::file_identity(&file).ok();
    }
    job.updated_at = now_ms();
    observed
}

fn update_rates(job: &mut Job, live: bool) {
    if !policy::path_identity(Path::new(&job.directory)).is_ok_and(|d| {
        d.device == job.directory_identity.device && d.inode == job.directory_identity.inode
    }) {
        return;
    }
    if let Some(previous) = job
        .rate_reports
        .last_mut()
        .filter(|r| r.attempt == job.attempts)
    {
        match read_regular(Path::new(&previous.path)) {
            Ok(bytes) => {
                *previous = rates::report(
                    previous.attempt,
                    previous.started_at,
                    previous.path.clone(),
                    &bytes,
                    live,
                )
            }
            Err(error) => {
                previous.warnings = vec![format!(
                    "Rate log could not be read: {error}. Last recorded samples retained."
                )]
            }
        }
    }
}

fn sample_progress(job: &mut Job, elapsed_ms: u64) {
    let Some(map) = job.map.as_ref() else {
        return;
    };
    let Some(report) = job
        .progress_reports
        .last_mut()
        .filter(|r| r.attempt == job.attempts)
    else {
        return;
    };
    if report
        .samples
        .last()
        .is_some_and(|s| s.elapsed_ms.parse::<u64>().is_ok_and(|n| n >= elapsed_ms))
    {
        return;
    }
    report.samples.push(ProgressSample {
        elapsed_ms: elapsed_ms.to_string(),
        observed_at: now_ms(),
        rescued_bytes: map.rescued_bytes.clone(),
        non_tried_bytes: map.non_tried_bytes.clone(),
        non_trimmed_bytes: map.non_trimmed_bytes.clone(),
        non_scraped_bytes: map.non_scraped_bytes.clone(),
        bad_sector_bytes: map.bad_sector_bytes.clone(),
        domain_bytes: map.domain_bytes.clone(),
    });
}

pub fn parse_map(bytes: &[u8], settings: &Settings, total: &str) -> Result<MapSummary, String> {
    let text = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
    let offset = decimal(&settings.offset, "Offset")?;
    let length = decimal(settings.length.as_deref().unwrap_or(total), "Length")?;
    let end = offset.checked_add(length).ok_or("Map range overflow")?;
    let mut sums = [0u64; 5];
    let mut blocks = Vec::new();
    let mut last_end = 0;
    let mut covered = 0;
    let number = |s: &str| -> Result<u64, String> {
        if let Some(n) = s.strip_prefix("0x") {
            u64::from_str_radix(n, 16).map_err(|e| e.to_string())
        } else {
            decimal(s, "Map count")
        }
    };
    let mut header = false;
    for line in text
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
    {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 3 {
            return Err("Mapfile row does not have three fields".into());
        }
        if !header {
            number(fields[0])?;
            if !matches!(fields[1], "?" | "*" | "/" | "-" | "+" | "F" | "G") {
                return Err("Invalid map status header".into());
            }
            number(fields[2])?;
            header = true;
            continue;
        }
        let position = number(fields[0])?;
        let size = number(fields[1])?;
        let block_end = position.checked_add(size).ok_or("Map block overflow")?;
        if size == 0 || position < last_end {
            return Err("Mapfile contains overlapping, unordered or empty blocks".into());
        }
        last_end = block_end;
        let index = match fields[2] {
            "+" => 0,
            "?" => 1,
            "*" => 2,
            "/" => 3,
            "-" => 4,
            _ => return Err("Unknown map block status".into()),
        };
        let amount = block_end.min(end).saturating_sub(position.max(offset));
        sums[index] = sums[index]
            .checked_add(amount)
            .ok_or("Map total overflow")?;
        covered += amount;
        blocks.push(MapBlock {
            position: position.to_string(),
            size: size.to_string(),
            status: fields[2].into(),
        });
    }
    if !header || blocks.is_empty() || covered != length {
        return Err("Mapfile does not cover the requested range exactly".into());
    }
    Ok(MapSummary {
        rescued_bytes: sums[0].to_string(),
        non_tried_bytes: sums[1].to_string(),
        non_trimmed_bytes: sums[2].to_string(),
        non_scraped_bytes: sums[3].to_string(),
        bad_sector_bytes: sums[4].to_string(),
        domain_bytes: length.to_string(),
        blocks,
    })
}

pub fn recover_jobs(store: &Store) -> Result<(), String> {
    for mut job in store.jobs::<Job>()? {
        if matches!(job.state.as_str(), "running" | "pausing") {
            job.state = "interrupted".into();
            job.message=Some("DRC exited before recording completion. No automatic resume; verify the source and saved artifacts.".into());
            // A destination path may refer to different media after restart.
            // Never read or write external artifacts before fresh path admission.
            store.save_job(&job.id, &job)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn settings() -> Settings {
        Settings {
            offset: "0".into(),
            length: Some("1024".into()),
            sector_size: 512,
            retry_passes: 0,
            copying_only: true,
            timeout_seconds: 30,
            max_read_rate: None,
        }
    }
    #[test]
    fn map_statuses_do_not_confuse_process_success_with_full_recovery() {
        let map=parse_map(b"# map\n0x0 ? 1\n0x0 0x200 +\n0x200 0x100 ?\n0x300 0x80 *\n0x380 0x40 /\n0x3c0 0x40 -\n",&settings(),"1024").unwrap();
        assert_eq!(map.rescued_bytes, "512");
        assert_eq!(map.non_tried_bytes, "256");
        assert_eq!(map.bad_sector_bytes, "64");
        assert!(parse_map(b"0 ? 1\n0 512 +\n256 512 +", &settings(), "1024").is_err());
        assert!(parse_map(b"0 ? 1\n0 512 +", &settings(), "1024").is_err());
    }
    #[test]
    fn fixed_arguments_never_enable_writes_to_source_or_overwrite_devices() {
        let args = arguments(
            &settings(),
            "1024",
            "/dev/fd/3",
            "image.raw",
            "rescue.map",
            "rates-attempt-1.log",
        );
        for forbidden in [
            "--force",
            "--truncate",
            "--fill-mode",
            "--generate-mode",
            "--same-file",
            "--reopen-on-error",
        ] {
            assert!(!args.iter().any(|s| s.starts_with(forbidden)));
        }
        assert!(args.contains(&"--no-trim".into()));
        assert!(args.contains(&"--retry-passes=0".into()));
        assert!(args.contains(&"--log-rates=rates-attempt-1.log".into()));
        let mut bad = settings();
        bad.offset = "1025".into();
        assert!(validate_settings(&mut bad, 1024).is_err());
        bad = settings();
        bad.length = Some("18446744073709551615".into());
        assert!(validate_settings(&mut bad, 1024).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn real_ddrescue_stops_resumes_preserves_source_and_rejects_modified_artifacts() {
        // This integration check only creates ordinary files in a disposable temp
        // directory. It never enumerates, opens, reads or writes a physical disk.
        let root = std::env::temp_dir().join(format!(
            "drc-rescue-test-{}-{}",
            now_ms(),
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("source.img");
        let bytes: Vec<u8> = (0..8388608).map(|i| (i % 251) as u8).collect();
        std::fs::write(&source_path, &bytes).unwrap();
        let store = Arc::new(Store::open(&root.join("store")).unwrap());
        let manager = Arc::new(Manager::default());
        let (path, input, identity) = policy::existing_regular_source(&source_path).unwrap();
        let original_identity = identity.clone();
        let source = Source::Image {
            path: path.to_string_lossy().into_owned(),
            identity,
        };
        let mut config = settings();
        config.length = Some(bytes.len().to_string());
        config.max_read_rate = Some("1048576".into());
        let sink: Sink = Arc::new(|_, _| {});
        let plan = manager
            .prepare(
                source.clone(),
                input,
                None,
                &root,
                config.clone(),
                bytes.len() as u64,
                None,
                None,
            )
            .unwrap();
        assert!(manager
            .start(
                &plan.ticket,
                "wrong confirmation",
                store.clone(),
                sink.clone()
            )
            .is_err());
        assert!(!root
            .join(format!(
                "DRC-{}",
                plan.ticket.replace("plan-", "acquisition-")
            ))
            .exists());
        let (_, input, _) = policy::existing_regular_source(&source_path).unwrap();
        let plan = manager
            .prepare(
                source.clone(),
                input,
                None,
                &root,
                config.clone(),
                bytes.len() as u64,
                None,
                None,
            )
            .unwrap();
        let first = manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                sink.clone(),
            )
            .unwrap();
        assert!(manager
            .prepare(
                source.clone(),
                policy::open_readonly(&source_path).unwrap(),
                None,
                &root,
                config.clone(),
                bytes.len() as u64,
                None,
                None,
            )
            .is_err());
        std::thread::sleep(Duration::from_millis(1500));
        manager.stop(&first.id).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while manager.is_active() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert!(!manager.is_active(), "The test acquisition did not stop");
        let paused = store
            .jobs::<Job>()
            .unwrap()
            .into_iter()
            .find(|j| j.id == first.id)
            .unwrap();
        assert_eq!(paused.state, "paused", "{:?}", paused.message);
        assert!(paused
            .map
            .as_ref()
            .is_some_and(|m| m.rescued_bytes != m.domain_bytes));
        let mut edited = paused.settings.clone();
        edited.max_read_rate = None;
        assert!(resume_settings(&paused, edited.clone())
            .unwrap()
            .max_read_rate
            .is_none());
        edited.offset = "512".into();
        assert!(resume_settings(&paused, edited).is_err());
        assert_eq!(
            policy::file_identity(&policy::open_readonly(&source_path).unwrap()).unwrap(),
            original_identity
        );
        let resume = manager
            .prepare(
                source.clone(),
                policy::open_readonly(&source_path).unwrap(),
                None,
                Path::new(&paused.directory),
                config.clone(),
                bytes.len() as u64,
                Some(&paused),
                None,
            )
            .unwrap();
        manager
            .start(
                &resume.ticket,
                &resume.confirmation,
                store.clone(),
                sink.clone(),
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(12);
        while manager.is_active() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert!(!manager.is_active(), "The test acquisition did not finish");
        let complete = store
            .jobs::<Job>()
            .unwrap()
            .into_iter()
            .find(|j| j.id == first.id)
            .unwrap();
        assert_eq!(complete.state, "completed", "{:?}", complete.message);
        assert_eq!(complete.rate_reports.len(), 2);
        assert_eq!(complete.progress_reports.len(), 2);
        assert!(complete
            .progress_reports
            .iter()
            .all(|r| !r.samples.is_empty()));
        assert_eq!(
            complete.progress_reports[1]
                .samples
                .last()
                .unwrap()
                .rescued_bytes,
            bytes.len().to_string()
        );
        assert!(!complete.rate_reports[0].samples.is_empty());
        assert!(!complete.rate_reports[1].samples.is_empty());
        assert_ne!(complete.rate_reports[0].path, complete.rate_reports[1].path);
        for r in &complete.rate_reports {
            assert_eq!(
                std::fs::read(&r.path).unwrap(),
                base64::engine::general_purpose::STANDARD
                    .decode(&r.raw_base64)
                    .unwrap()
            );
            assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        }
        assert_eq!(std::fs::read(&complete.image_path).unwrap(), bytes);
        assert_eq!(std::fs::read(&source_path).unwrap(), bytes);
        assert_eq!(
            policy::file_identity(&policy::open_readonly(&source_path).unwrap()).unwrap(),
            original_identity
        );
        let mut modified = complete.clone();
        modified.state = "paused".into();
        let map = std::fs::read(&modified.map_path).unwrap();
        std::fs::write(&modified.map_path, b"0 ? 1\n0 8388608 +\n").unwrap();
        assert!(manager
            .prepare(
                source.clone(),
                policy::open_readonly(&source_path).unwrap(),
                None,
                Path::new(&modified.directory),
                config.clone(),
                bytes.len() as u64,
                Some(&modified),
                None,
            )
            .is_err());
        std::fs::write(&modified.map_path, &map).unwrap();
        let mut image = OpenOptions::new()
            .write(true)
            .open(&modified.image_path)
            .unwrap();
        image.write_all(b"changed").unwrap();
        image.sync_all().unwrap();
        assert!(manager
            .prepare(
                source,
                policy::open_readonly(&source_path).unwrap(),
                None,
                Path::new(&modified.directory),
                config,
                bytes.len() as u64,
                Some(&modified),
                None,
            )
            .is_err());
        drop(image);
        drop(manager);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
