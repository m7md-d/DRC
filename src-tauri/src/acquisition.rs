use crate::{
    model::{now_ms, CommandRecord, Device},
    mount_guard::{MountGuard, SourcePresence},
    policy::{self, FileIdentity},
    rates::{self, ProgressReport, ProgressSample, RateReport},
    store::Store,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::{
    fs::OpenOptionsExt,
    io::AsRawFd,
    process::{CommandExt, ExitStatusExt},
};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
    process::{ChildStdin, Command, Stdio},
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
    #[serde(default)]
    pub reverse: bool,
    pub timeout_seconds: u32,
    pub max_read_rate: Option<String>,
    #[serde(default)]
    pub cluster_sectors: Option<u32>,
    #[serde(default)]
    pub max_read_errors: Option<u32>,
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
    #[serde(default = "zero_bytes")]
    pub unmapped_bytes: String,
    pub blocks: Vec<MapBlock>,
}

fn zero_bytes() -> String {
    "0".into()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSource {
    pub attempt: u32,
    pub opened_at: u64,
    pub source: Source,
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
    #[serde(default)]
    pub attempt_sources: Vec<AttemptSource>,
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
    pub previous_source: Option<Source>,
}

fn resume_source_review(source: &Source, previous: &Job) -> Result<Option<Source>, String> {
    match (source, &previous.source) {
        (Source::Physical { device: current }, Source::Physical { device: original }) => {
            if current.size_bytes != original.size_bytes
                || current.size_bytes.as_deref() != Some(&previous.source_size)
            {
                return Err("The current source capacity differs from the saved acquisition. Resume refused.".into());
            }
            let block_size = |device: &Device| {
                device
                    .info
                    .get("DeviceBlockSize")
                    .or_else(|| device.info.get("log-sec"))
                    .cloned()
            };
            if block_size(current).is_none() || block_size(current) != block_size(original) {
                return Err(
                    "The current logical sector size differs or is unavailable. Resume refused."
                        .into(),
                );
            }
            for field in ["DiskUUID", "SerialNumber", "serial", "wwn", "WWN"] {
                let value = |device: &Device| {
                    crate::model::string_field(&device.info, field)
                        .filter(|value| !value.trim().is_empty())
                };
                if let (Some(old), Some(new)) = (value(original), value(current)) {
                    if old != new {
                        return Err(format!("The source's reported {field} differs from the saved source. Resume refused."));
                    }
                }
            }
            Ok((current.identity_key != original.identity_key).then(|| previous.source.clone()))
        }
        (
            Source::Image {
                identity: current, ..
            },
            Source::Image {
                identity: original, ..
            },
        ) if current == original => Ok(None),
        _ => {
            Err("The current source does not match the saved acquisition type or identity.".into())
        }
    }
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
    let packaged = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("drc-ddrescue")));
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(concat!("drc-ddrescue-", env!("DRC_BUILD_TARGET")));
    packaged
        .into_iter()
        .chain(std::iter::once(development))
        .chain(
            [
                "/opt/homebrew/bin/ddrescue",
                "/usr/local/bin/ddrescue",
                "/usr/bin/ddrescue",
            ]
            .into_iter()
            .map(std::path::PathBuf::from),
        )
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
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
    if settings
        .cluster_sectors
        .is_some_and(|n| !(1..=2048).contains(&n))
    {
        return Err("Read cluster size must be 1–2048 logical sectors, or tool default.".into());
    }
    if settings
        .max_read_errors
        .is_some_and(|n| !(1..=100_000).contains(&n))
    {
        return Err("The read-error limit must be 1–100000, or left unset.".into());
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
    if settings.reverse {
        args.push("--reverse".into());
    }
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
    if let Some(sectors) = settings.cluster_sectors {
        args.push(format!("--cluster-size={sectors}"));
    }
    if let Some(errors) = settings.max_read_errors {
        args.push(format!("--max-read-errors={errors}"));
    }
    args.extend(["--".into(), input.into(), output.into(), map.into()]);
    args
}

pub fn resume_settings(job: &Job, mut requested: Settings) -> Result<Settings, String> {
    if requested.offset != job.settings.offset
        || requested.length != job.settings.length
        || requested.sector_size != job.settings.sector_size
    {
        return Err("A resumed image must retain its original offset, length and logical sector size. Only direction, read phases, retries, timeout, cluster size, error limit and rate cap may change.".into());
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
        if matches!(&source, Source::Physical { .. })
            && (!total.is_multiple_of(u64::from(settings.sector_size))
                || !decimal(settings.length.as_deref().unwrap(), "Length")?
                    .is_multiple_of(u64::from(settings.sector_size)))
        {
            return Err("Physical source capacity and range length must align with its reported logical sector size. No partial-sector physical read is admitted.".into());
        }
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
        let previous_source = resume
            .map(|job| resume_source_review(&source, job))
            .transpose()?
            .flatten();
        let confirmation = match (&source, &previous_source) {
            (Source::Physical { device: current }, Some(Source::Physical { device: original })) => {
                if original.id == current.id {
                    format!("CONFIRM RESUME {}", current.id)
                } else {
                    format!("RESUME {} AS {}", original.id, current.id)
                }
            }
            (Source::Image { .. }, _) => "ACQUIRE IMAGE".into(),
            (Source::Physical { device }, _) => format!("ACQUIRE {}", device.id),
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
            previous_source,
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
                attempt_sources: Vec::new(),
            };
            (job, directory)
        };
        let lock = open_lock(Path::new(&job.directory))?;
        job.attempts += 1;
        job.attempt_sources.push(AttemptSource {
            attempt: job.attempts,
            opened_at: now_ms(),
            source: prepared.plan.source.clone(),
        });
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
            let guard = prepared.guard;
            let lock = lock;
            let mut job = job;
            let record = run(
                &mut job,
                prepared.input,
                directory,
                (
                    &lock,
                    guard.as_ref().map(|guard| guard as &dyn SourcePresence),
                ),
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
                if let Err(local_error) = store.save_job(&job.id, &job) {
                    job.message = Some(format!(
                        "{}; local journal error: {local_error}",
                        job.message.as_deref().unwrap_or("Operation stopped")
                    ));
                }
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
    // The local journal must retain the final state even if the external
    // destination disappears. No external path is touched before admission.
    store.save_job(&job.id, job)?;
    let current = policy::path_identity(Path::new(&job.directory))?;
    if current.device != job.directory_identity.device
        || current.inode != job.directory_identity.inode
    {
        return Err(
            "The acquisition directory was moved or replaced. Artifact writes are blocked.".into(),
        );
    }
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
    protection: (&File, Option<&dyn SourcePresence>),
    stop: Arc<AtomicBool>,
    store: &Store,
    sink: &Sink,
) -> CommandRecord {
    let (lock, guard) = protection;
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
        stdin: None,
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
            // Set up both transcripts before the tool can start reading data.
            let stdout_files = open_spool(Path::new(&job.stdout_path), job.attempts)?;
            let stderr_files = open_spool(Path::new(&job.stderr_path), job.attempts)?;
            let mut command = Command::new(&program);
            command
                .args(&record.arguments)
                .env("LC_ALL", "C")
                .stdin(Stdio::piped())
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
            let control = Arc::new(MapAbortControl {
                input: Mutex::new(
                    child
                        .stdin
                        .take()
                        .ok_or("Missing acquisition control input")?,
                ),
                tail: Mutex::new(Vec::new()),
                supplied: Mutex::new(String::new()),
            });
            let stdout = child.stdout.take().ok_or("Missing acquisition stdout")?;
            let stderr = child.stderr.take().ok_or("Missing acquisition stderr")?;
            let io_errors = Arc::new(Mutex::new(Vec::<String>::new()));
            let out = spool(
                stdout,
                stdout_files,
                "stdout",
                stop.clone(),
                io_errors.clone(),
                None,
            );
            let err = spool(
                stderr,
                stderr_files,
                "stderr",
                stop.clone(),
                io_errors.clone(),
                Some(control.clone()),
            );
            let mut signalled = false;
            let mut last = Instant::now();
            let mut save_failure: Option<String> = None;
            let mut source_failure: Option<String> = None;
            loop {
                if stop.load(Ordering::SeqCst) && !signalled {
                    if unsafe { libc::kill(child.id() as i32, libc::SIGINT) } != 0 {
                        save_failure = Some(std::io::Error::last_os_error().to_string());
                    }
                    signalled = true;
                    job.state = "pausing".into();
                    let reason = io_errors
                        .lock()
                        .ok()
                        .filter(|e| !e.is_empty())
                        .map(|e| format!("Log persistence failed: {}. ", e.join("; ")))
                        .unwrap_or_default();
                    let source_reason = source_failure
                        .as_ref()
                        .map(|error| format!("Source access changed: {error}. "))
                        .unwrap_or_default();
                    job.message=Some(format!("{source_reason}{reason}SIGINT requested. Waiting for ddrescue to save its mapfile and exit; kernel I/O can delay this."));
                    job.updated_at = now_ms();
                    sink(job.clone(), None);
                }
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    record.exit_code = status.code();
                    record.termination_signal = status.signal();
                    job.exit_code = record.exit_code;
                    break;
                }
                if last.elapsed() >= Duration::from_secs(1) {
                    if source_failure.is_none() {
                        if let Some(guard) = guard {
                            if let Err(error) = guard.check_source() {
                                source_failure = Some(error);
                                stop.store(true, Ordering::SeqCst);
                            }
                        }
                    }
                    if update_artifacts(job) {
                        sample_progress(job, started.elapsed().as_millis() as u64);
                    }
                    update_rates(job, true);
                    record.duration_ms = started.elapsed().as_millis() as u64;
                    update_record(&mut record, job);
                    record.stdin = control.supplied_input();
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
            let mut persistence_errors = Vec::new();
            if source_failure.is_none() && record.exit_code != Some(0) {
                source_failure = guard.and_then(|guard| guard.check_source().err());
            }
            for (name, reader) in [("stdout", out), ("stderr", err)] {
                match reader.join() {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => persistence_errors.push(e),
                    Err(_) => persistence_errors.push(format!(
                        "{name} spool thread failed; original output may be incomplete"
                    )),
                }
            }
            record.stdin = control.supplied_input();
            let flush = policy::open_readonly(Path::new(&job.image_path))
                .and_then(|image| image.sync_all().map_err(|e| e.to_string()));
            // Harvest and seal readable artifacts even when a transcript or
            // image flush failed. A persistence failure still prevents success.
            let fresh_artifacts = match observe_after_flush(job, flush) {
                Ok(fresh) => fresh,
                Err(error) => {
                    persistence_errors.push(error);
                    false
                }
            };
            if fresh_artifacts {
                sample_progress(job, started.elapsed().as_millis() as u64);
            }
            update_rates(job, false);
            if let Some(error) = save_failure {
                persistence_errors.push(format!("Acquisition persistence failed: {error}"));
            }
            if !persistence_errors.is_empty() {
                return Err(format!("{}. Readable image/map artifacts were retained for review; transcript bytes may be incomplete. No automatic resume.", persistence_errors.join("; ")));
            }
            if !fresh_artifacts {
                return Err("The final mapfile and original image destination could not be verified. Previous observations cannot establish completion.".into());
            }
            if record.exit_code == Some(0)
                && !job
                    .image_identity
                    .as_ref()
                    .is_some_and(|image| image.size == job.source_size)
            {
                job.map_digest = None;
                return Err("The output image length differs from the reviewed source capacity. Completion and resume are blocked; the map alone cannot verify the image.".into());
            }
            if let Source::Image { identity, .. } = &job.source {
                if &policy::file_identity(&input)? != identity {
                    return Err("The source image changed during acquisition. The output cannot be marked complete.".into());
                }
            }
            job.exit_code = record.exit_code;
            let complete = completion_verified(job, fresh_artifacts);
            job.state = if complete && record.exit_code == Some(0) && source_failure.is_none() {
                "completed"
            } else if (signalled || source_failure.is_some()) && job.map_digest.is_some() {
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
                Some(source_failure.map(|error| format!("Source access changed: {error}. The image and saved mapfile were retained. Reconnect the source, refresh devices and review resume; finished map regions are not copied again.")).unwrap_or_else(|| "Stopped with a saved mapfile. Resume requires a new source/destination review.".into()))
            } else if job
                .map
                .as_ref()
                .is_some_and(|map| map.unmapped_bytes != "0")
            {
                Some(format!("{} bytes in the reviewed range are outside the recorded map. No copied status is assigned to them. Review the map and original output before resuming.", job.map.as_ref().unwrap().unmapped_bytes))
            } else {
                Some("Inspect the exit status, mapfile and original output. No automatic retry or reconnect is performed.".into())
            };
        }
        Ok(())
    })();
    update_record(&mut record, job);
    if let Err(error) = outcome {
        record.launch_error = Some(error.clone());
        job.state = "failed".into();
        job.message = Some(match (record.exit_code, record.stderr.trim()) {
            (Some(code), stderr) if !stderr.is_empty() => {
                let stderr: String = stderr.chars().take(4096).collect();
                format!("ddrescue exited with status {code}: {stderr}\n{error}")
            }
            _ => error,
        });
    }
    update_rates(job, false);
    record.duration_ms = started.elapsed().as_millis() as u64;
    job.updated_at = now_ms();
    record
}

fn open_spool(path: &Path, attempt: u32) -> Result<[File; 2], String> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    let file = options.open(path).map_err(|e| e.to_string())?;
    // Each attempt keeps its own original bytes; aggregate stream files retain all attempts.
    let attempt_path = path.with_file_name(format!(
        "{}-attempt-{attempt}.bin",
        path.file_stem().unwrap_or_default().to_string_lossy()
    ));
    let mut separate_options = OpenOptions::new();
    separate_options.write(true).create_new(true);
    #[cfg(unix)]
    separate_options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    let separate = separate_options
        .open(attempt_path)
        .map_err(|e| e.to_string())?;
    Ok([file, separate])
}

// Keep draining after a persistence failure so SIGINT can reach the tool and
// it can save its map. Retain any still-writable transcript; never grow memory
// without bound or silently claim that a failed transcript is complete.
fn drain_stream<R: Read>(
    mut input: R,
    mut persist: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let mut first_error = None;
    let mut bytes = [0; 8192];
    loop {
        let n = match input.read(&mut bytes) {
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(first_error.unwrap_or_else(|| e.to_string())),
            Ok(n) => n,
        };
        if n == 0 {
            break;
        }
        if let Err(e) = persist(&bytes[..n]) {
            first_error.get_or_insert(e);
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn spool<R: Read + Send + 'static>(
    input: R,
    files: [File; 2],
    label: &'static str,
    stop: Arc<AtomicBool>,
    errors: Arc<Mutex<Vec<String>>>,
    control: Option<Arc<MapAbortControl>>,
) -> std::thread::JoinHandle<Result<(), String>> {
    std::thread::spawn(move || {
        let mut files = files.map(Some);
        let outcome = drain_stream(input, |bytes| {
            let mut failed = Vec::new();
            if let Some(control) = &control {
                match control.observe(bytes) {
                    Ok(0) => {}
                    Ok(_) => failed.push(
                        "ddrescue could not save its mapfile; q+Enter supplied to abort the prompt"
                            .into(),
                    ),
                    Err(e) => failed.push(format!("Mapfile-abort control failed: {e}")),
                }
            }
            for (index, target) in files.iter_mut().enumerate() {
                if let Some(file) = target {
                    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_data()) {
                        failed.push(format!(
                            "{label} {} log write/flush failed: {e}",
                            if index == 0 { "aggregate" } else { "attempt" }
                        ));
                        *target = None;
                    }
                }
            }
            if !failed.is_empty() {
                if let Ok(mut saved) = errors.lock() {
                    saved.extend(failed.clone());
                }
                stop.store(true, Ordering::SeqCst);
                return Err(failed.join("; "));
            }
            Ok(())
        });
        if outcome.is_err() {
            stop.store(true, Ordering::SeqCst);
        }
        for file in files.into_iter().flatten() {
            if let Err(e) = file.sync_all() {
                return Err(format!("{label} final log flush failed: {e}"));
            }
        }
        outcome
    })
}

const MAP_ABORT_PROMPT: &[u8] = b"or Q+ENTER to abort.\n";

fn map_abort_requests(tail: &mut Vec<u8>, bytes: &[u8]) -> usize {
    tail.extend_from_slice(bytes);
    let matches = tail
        .windows(MAP_ABORT_PROMPT.len())
        .filter(|w| *w == MAP_ABORT_PROMPT)
        .count();
    let keep = tail.len().min(MAP_ABORT_PROMPT.len() - 1);
    tail.drain(..tail.len() - keep);
    matches
}

struct MapAbortControl {
    input: Mutex<ChildStdin>,
    tail: Mutex<Vec<u8>>,
    supplied: Mutex<String>,
}

impl MapAbortControl {
    fn observe(&self, bytes: &[u8]) -> Result<usize, String> {
        let requests = {
            let mut tail = self.tail.lock().map_err(|e| e.to_string())?;
            map_abort_requests(&mut tail, bytes)
        };
        if requests > 0 {
            let mut input = self.input.lock().map_err(|e| e.to_string())?;
            let mut supplied = self.supplied.lock().map_err(|e| e.to_string())?;
            for _ in 0..requests {
                input.write_all(b"q\n").map_err(|e| e.to_string())?;
                supplied.push_str("q\n");
            }
            input.flush().map_err(|e| e.to_string())?;
        }
        Ok(requests)
    }
    fn supplied_input(&self) -> Option<String> {
        self.supplied
            .lock()
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| s.clone())
    }
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

/// A completed requested range requires a fresh valid map and the exact
/// extended output length. This does not establish the source's true nominal
/// capacity, the correctness of successful device responses, or full-disk scope.
fn completion_verified(job: &Job, fresh: bool) -> bool {
    fresh
        && job.map_digest.is_some()
        && job
            .map
            .as_ref()
            .is_some_and(|map| map.rescued_bytes == map.domain_bytes)
        && job
            .image_identity
            .as_ref()
            .is_some_and(|image| image.size == job.source_size)
}

fn observe_after_flush(job: &mut Job, flush: Result<(), String>) -> Result<bool, String> {
    let fresh = update_artifacts(job);
    if let Err(error) = flush {
        // Readable map observations do not establish durability of data whose
        // flush failed. Preserve them, but block completion and trusted resume.
        job.map_digest = None;
        return Err(format!(
            "Image flush failed: {error}. Image durability is unverified; resume seal cleared"
        ));
    }
    Ok(fresh)
}
fn update_artifacts(job: &mut Job) -> bool {
    let observation = (|| -> Result<(MapSummary, String, FileIdentity), String> {
        let current = policy::path_identity(Path::new(&job.directory))?;
        if current.device != job.directory_identity.device
            || current.inode != job.directory_identity.inode
        {
            return Err(
                "Acquisition directory identity changed; artifact reads are blocked.".into(),
            );
        }
        let image = policy::open_readonly(Path::new(&job.image_path))?;
        if !image.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("The image destination is not a regular file.".into());
        }
        // Read the map before sampling image metadata. During a live copy,
        // the output can grow between these observations; an older image length
        // must not be compared with a newer completed-map frontier.
        let bytes = read_regular(Path::new(&job.map_path))?;
        let map = parse_map(&bytes, &job.settings, &job.source_size)?;
        let identity = policy::file_identity(&image)?;
        let previous = job
            .image_identity
            .as_ref()
            .ok_or("No original image destination identity was recorded.")?;
        if identity.device != previous.device || identity.inode != previous.inode {
            return Err("The original image destination was replaced.".into());
        }
        if decimal(&identity.size, "Current image size")?
            < decimal(&previous.size, "Previously observed image size")?
        {
            return Err("The image destination was truncated after data had been recorded.".into());
        }
        let start = decimal(&job.settings.offset, "Domain offset")?;
        let end = start
            .checked_add(decimal(
                job.settings
                    .length
                    .as_deref()
                    .ok_or("Domain length missing")?,
                "Domain length",
            )?)
            .ok_or("Domain overflow")?;
        let mut required_length = 0;
        for block in &map.blocks {
            let position = decimal(&block.position, "Map position")?;
            let block_end = position
                .checked_add(decimal(&block.size, "Map size")?)
                .ok_or("Map end overflow")?;
            if block.status == "+" && position < end && block_end > start {
                required_length = required_length.max(block_end.min(end));
            }
        }
        if decimal(&identity.size, "Image size")? < required_length {
            return Err("The map marks copied bytes beyond the current image's length. Completion and resume cannot be verified.".into());
        }
        Ok((map, policy::digest(&bytes), identity))
    })();
    job.updated_at = now_ms();
    match observation {
        Ok((map, digest, identity)) => {
            job.map = Some(map);
            job.map_digest = Some(digest);
            job.image_identity = Some(identity);
            true
        }
        Err(error) => {
            // Preserve the last bound image identity for strict resume admission,
            // but never reuse an old map as a fresh completion observation.
            job.map = None;
            job.map_digest = None;
            job.message = Some(format!("Acquisition artifact verification failed: {error}"));
            false
        }
    }
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
        if size == 0 || position < last_end || (!blocks.is_empty() && position != last_end) {
            return Err(
                "Mapfile contains overlapping, unordered, empty or internally gapped blocks".into(),
            );
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
    if !header || blocks.is_empty() {
        return Err("Mapfile contains no valid block observations".into());
    }
    Ok(MapSummary {
        rescued_bytes: sums[0].to_string(),
        non_tried_bytes: sums[1].to_string(),
        non_trimmed_bytes: sums[2].to_string(),
        non_scraped_bytes: sums[3].to_string(),
        bad_sector_bytes: sums[4].to_string(),
        domain_bytes: length.to_string(),
        unmapped_bytes: (length - covered).to_string(),
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
            reverse: false,
            timeout_seconds: 30,
            max_read_rate: None,
            cluster_sectors: None,
            max_read_errors: None,
        }
    }
    #[test]
    fn map_statuses_do_not_confuse_process_success_with_full_recovery() {
        let map=parse_map(b"# map\n0x0 ? 1\n0x0 0x200 +\n0x200 0x100 ?\n0x300 0x80 *\n0x380 0x40 /\n0x3c0 0x40 -\n",&settings(),"1024").unwrap();
        assert_eq!(map.rescued_bytes, "512");
        assert_eq!(map.non_tried_bytes, "256");
        assert_eq!(map.bad_sector_bytes, "64");
        assert!(parse_map(b"0 ? 1\n0 512 +\n256 512 +", &settings(), "1024").is_err());
        let short = parse_map(b"0 ? 1\n0 512 +", &settings(), "1024").unwrap();
        assert_eq!(short.rescued_bytes, "512");
        assert_eq!(short.domain_bytes, "1024");
        assert_eq!(short.unmapped_bytes, "512");
        assert!(parse_map(b"0 ? 1\n0 256 +\n512 512 ?", &settings(), "1024").is_err());
    }

    #[test]
    fn map_abort_prompt_survives_every_split_and_does_not_match_partial_text() {
        for split in 0..=MAP_ABORT_PROMPT.len() {
            let mut tail = Vec::new();
            let before = map_abort_requests(&mut tail, &MAP_ABORT_PROMPT[..split]);
            let after = map_abort_requests(&mut tail, &MAP_ABORT_PROMPT[split..]);
            assert_eq!(before + after, 1);
            assert!(tail.len() < MAP_ABORT_PROMPT.len());
            assert_eq!(map_abort_requests(&mut tail, b"unrelated output\n"), 0);
        }
        let mut tail = Vec::new();
        let two = [MAP_ABORT_PROMPT, MAP_ABORT_PROMPT].concat();
        assert_eq!(map_abort_requests(&mut tail, &two), 2);
        assert_eq!(map_abort_requests(&mut tail, b"or Q+ENTER to abor"), 0);
    }

    #[test]
    #[cfg(unix)]
    fn map_abort_control_answers_repeated_prompts_and_records_exact_input() {
        let root = std::env::temp_dir().join(crate::model::unique_id("drc-map-control"));
        std::fs::create_dir(&root).unwrap();
        // A bounded, generated protocol peer; no storage device is opened.
        let mut child = Command::new("/bin/sh").args(["-c", "for n in 1 2; do printf 'or Q+ENTER to abort.\\n' >&2; IFS= read -r answer; [ \"$answer\" = q ] || exit 9; done"])
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().unwrap();
        let control = Arc::new(MapAbortControl {
            input: Mutex::new(child.stdin.take().unwrap()),
            tail: Mutex::new(Vec::new()),
            supplied: Mutex::new(String::new()),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let reader = spool(
            child.stderr.take().unwrap(),
            open_spool(&root.join("stderr.bin"), 1).unwrap(),
            "stderr",
            stop.clone(),
            Arc::new(Mutex::new(Vec::new())),
            Some(control.clone()),
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("Map control did not answer its bounded peer");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        assert!(status.success());
        assert!(reader.join().unwrap().is_err());
        assert!(stop.load(Ordering::SeqCst));
        assert_eq!(control.supplied_input().as_deref(), Some("q\nq\n"));
        assert_eq!(
            std::fs::read(root.join("stderr-attempt-1.bin")).unwrap(),
            [MAP_ABORT_PROMPT, MAP_ABORT_PROMPT].concat()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn partial_map_retains_finished_prefix_without_inventing_tail_status() {
        let (root, mut job) = artifact_fixture(1024, "0 + 1\n0 512 +\n");
        assert!(update_artifacts(&mut job));
        let map = job.map.as_ref().unwrap();
        assert_eq!(map.rescued_bytes, "512");
        assert_eq!(map.unmapped_bytes, "512");
        assert_eq!(map.non_tried_bytes, "0");
        assert_eq!(map.blocks.len(), 1);
        assert!(!completion_verified(&job, true));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_image_flush_retains_readings_but_blocks_completion_and_resume() {
        let (root, mut job) = artifact_fixture(1024, "0 + 1\n0 1024 +\n");
        job.state = "failed".into();
        assert!(observe_after_flush(&mut job, Ok(())).unwrap());
        assert!(verify_resume(&job, &job.directory_identity).is_ok());
        assert!(completion_verified(&job, true));
        assert!(observe_after_flush(&mut job, Err("injected EIO".into())).is_err());
        assert_eq!(job.map.as_ref().unwrap().rescued_bytes, "1024");
        assert!(job.map_digest.is_none());
        assert!(!completion_verified(&job, true));
        assert!(verify_resume(&job, &job.directory_identity).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn destination_replacement_keeps_local_failure_state_without_writing_replacement() {
        let (root, mut job) = artifact_fixture(1024, "0 + 1\n0 512 +\n512 512 ?\n");
        let journal = std::env::temp_dir().join(crate::model::unique_id("drc-local-journal"));
        let store = Store::open(&journal).unwrap();
        job.state = "failed".into();
        job.message = Some("Destination unavailable".into());
        let moved = root.with_extension("original");
        std::fs::rename(&root, &moved).unwrap();
        std::fs::create_dir(&root).unwrap();
        assert!(save_job(&store, &job).is_err());
        let saved = store.jobs::<Job>().unwrap().remove(0);
        assert_eq!(saved.state, "failed");
        assert_eq!(saved.message.as_deref(), Some("Destination unavailable"));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        drop(store);
        for dir in [root, moved, journal] {
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn failed_transcript_requests_stop_but_drains_and_preserves_healthy_copy() {
        let root = std::env::temp_dir().join(crate::model::unique_id("drc-spool-fault"));
        std::fs::create_dir(&root).unwrap();
        let broken = root.join("readonly-log.bin");
        let healthy = root.join("attempt-log.bin");
        std::fs::write(&broken, b"original log").unwrap();
        let payload = vec![b'x'; 1024 * 1024];
        let stop = Arc::new(AtomicBool::new(false));
        let errors = Arc::new(Mutex::new(Vec::new()));
        let reader = spool(
            std::io::Cursor::new(payload.clone()),
            [
                File::open(&broken).unwrap(),
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&healthy)
                    .unwrap(),
            ],
            "stdout",
            stop.clone(),
            errors.clone(),
            None,
        );
        assert!(reader.join().unwrap().is_err());
        assert!(stop.load(Ordering::SeqCst));
        assert_eq!(errors.lock().unwrap().len(), 1);
        assert_eq!(std::fs::read(&healthy).unwrap(), payload);
        assert_eq!(std::fs::read(&broken).unwrap(), b"original log");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_controls_are_bounded_and_do_not_change_resume_domain() {
        let mut config = settings();
        config.cluster_sectors = Some(1);
        config.max_read_errors = Some(5);
        validate_settings(&mut config, 1024).unwrap();
        let args = arguments(
            &config,
            "1024",
            "/dev/fd/3",
            "image.raw",
            "rescue.map",
            "rates.log",
        );
        assert!(args.contains(&"--cluster-size=1".into()));
        assert!(args.contains(&"--max-read-errors=5".into()));
        for n in [0, 2049, u32::MAX] {
            let mut invalid = config.clone();
            invalid.cluster_sectors = Some(n);
            assert!(validate_settings(&mut invalid, 1024).is_err());
        }
        for n in [0, 100001, u32::MAX] {
            let mut invalid = config.clone();
            invalid.max_read_errors = Some(n);
            assert!(validate_settings(&mut invalid, 1024).is_err());
        }
        let (root, job) = artifact_fixture(1024, "0 + 1\n0 1024 +\n");
        assert!(resume_settings(&job, config.clone()).is_ok());
        config.length = Some("512".into());
        assert!(resume_settings(&job, config).is_err());
        std::fs::remove_dir_all(root).unwrap();
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
    fn inherited_readonly_source_remains_readable_when_path_cannot_be_reopened() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(crate::model::unique_id("drc-pinned-permission"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("generated.img");
        let bytes: Vec<u8> = (0..1048576).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        let (_, input, identity) = policy::existing_regular_source(&path).unwrap();
        let source = Source::Image {
            path: path.to_string_lossy().into_owned(),
            identity,
        };
        let store = Arc::new(Store::open(&root.join("store")).unwrap());
        let manager = Arc::new(Manager::default());
        let mut config = settings();
        config.length = Some(bytes.len().to_string());
        let plan = manager
            .prepare(
                source,
                input,
                None,
                &root,
                config,
                bytes.len() as u64,
                None,
                None,
            )
            .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o0)).unwrap();
        if unsafe { libc::geteuid() } != 0 {
            assert!(
                File::open(&path).is_err(),
                "The fixture must deny a new path open"
            );
        }
        let job = manager
            .start(
                &plan.ticket,
                &plan.confirmation,
                store.clone(),
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while manager.is_active() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert!(!manager.is_active());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let finished = store
            .jobs::<Job>()
            .unwrap()
            .into_iter()
            .find(|j| j.id == job.id)
            .unwrap();
        assert_eq!(finished.state, "completed", "{:?}", finished.message);
        assert!(
            std::fs::read(&finished.image_path).unwrap() == bytes,
            "Image bytes differ"
        );
        assert!(
            std::fs::read(&path).unwrap() == bytes,
            "Source bytes changed"
        );
        std::fs::remove_dir_all(root).unwrap();
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
    fn artifact_fixture(image_length: usize, map: &str) -> (std::path::PathBuf, Job) {
        let root = std::env::temp_dir().join(crate::model::unique_id("drc-artifact-test"));
        std::fs::create_dir(&root).unwrap();
        let source_path = root.join("source.img");
        std::fs::write(&source_path, vec![7; 1024]).unwrap();
        let image_path = root.join("image.raw");
        std::fs::write(&image_path, vec![7; image_length]).unwrap();
        let map_path = root.join("rescue.map");
        std::fs::write(&map_path, map).unwrap();
        let job = Job {
            id: "fixture".into(),
            session_id: "fixture".into(),
            source: Source::Image {
                path: source_path.to_string_lossy().into_owned(),
                identity: policy::path_identity(&source_path).unwrap(),
            },
            source_size: "1024".into(),
            directory: root.to_string_lossy().into_owned(),
            directory_identity: policy::path_identity(&root).unwrap(),
            image_path: image_path.to_string_lossy().into_owned(),
            map_path: map_path.to_string_lossy().into_owned(),
            stdout_path: root.join("stdout.bin").to_string_lossy().into_owned(),
            stderr_path: root.join("stderr.bin").to_string_lossy().into_owned(),
            settings: settings(),
            state: "running".into(),
            created_at: now_ms(),
            updated_at: now_ms(),
            exit_code: None,
            message: None,
            map: None,
            image_identity: Some(policy::path_identity(&image_path).unwrap()),
            map_digest: None,
            attempts: 1,
            tool_version: "fixture".into(),
            latest_record: None,
            rate_reports: vec![],
            progress_reports: vec![],
            attempt_sources: vec![],
        };
        (root, job)
    }
    #[test]
    fn missing_or_replaced_artifacts_never_reuse_a_cached_complete_map() {
        let (root, mut job) = artifact_fixture(1024, "0 + 1\n0 1024 +\n");
        assert!(update_artifacts(&mut job));
        assert!(completion_verified(&job, true));
        let original = job.image_identity.clone().unwrap();
        std::fs::remove_file(&job.map_path).unwrap();
        assert!(!update_artifacts(&mut job));
        assert!(job.map.is_none() && job.map_digest.is_none());
        assert!(!completion_verified(&job, true));
        std::fs::write(&job.map_path, "0 + 1\n0 1024 +\n").unwrap();
        assert!(update_artifacts(&mut job));
        std::fs::rename(&job.image_path, root.join("original.raw")).unwrap();
        std::fs::write(&job.image_path, vec![0; 1024]).unwrap();
        assert!(!update_artifacts(&mut job));
        assert_eq!(job.image_identity, Some(original));
        assert!(!completion_verified(&job, true));
        std::fs::remove_dir_all(root).unwrap();
    }
    fn physical_fixture(id: &str, serial: &str) -> Source {
        let info = serde_json::json!({"DeviceIdentifier":id,"DeviceTreePath":format!("test/{id}"),"MediaName":"Generated source fixture","TotalSize":"1024","DeviceBlockSize":"512","Internal":false,"WholeDisk":true,"SerialNumber":serial});
        Source::Physical {
            device: Box::new(Device {
                id: id.into(),
                token: format!("fixture:{id}"),
                identity_key: crate::platform::identity_key(&info),
                name: "Generated source fixture".into(),
                size_bytes: Some("1024".into()),
                internal: Some(false),
                protocol: Some("USB".into()),
                content: None,
                partitions: vec![],
                info,
                layout: serde_json::json!({}),
                info_error: None,
                observed_at: now_ms(),
                metadata_only: false,
                protection_reason: None,
            }),
        }
    }
    #[test]
    fn changed_source_node_requires_binding_review_and_conflicting_identity_is_rejected() {
        let (root, mut job) = artifact_fixture(1024, "0 ? 1\n0 512 +\n512 512 ?\n");
        job.source = physical_fixture("disk4", "fixture-serial");
        job.state = "paused".into();
        assert!(update_artifacts(&mut job));
        let current = physical_fixture("disk9", "fixture-serial");
        assert!(resume_source_review(&job.source, &job).unwrap().is_none());
        assert!(resume_source_review(&current, &job).unwrap().is_some());
        let manager = Arc::new(Manager::default());
        let plan = manager
            .prepare(
                current.clone(),
                policy::open_readonly(Path::new(&job.image_path)).unwrap(),
                None,
                &root,
                job.settings.clone(),
                1024,
                Some(&job),
                None,
            )
            .unwrap();
        assert_eq!(plan.confirmation, "RESUME disk4 AS disk9");
        assert!(plan.previous_source.is_some());
        manager.cancel_plan(&plan.ticket);
        assert!(
            resume_source_review(&physical_fixture("disk9", "different-serial"), &job).is_err()
        );
        let Source::Physical { mut device } = current else {
            unreachable!()
        };
        device.size_bytes = Some("2048".into());
        assert!(resume_source_review(
            &Source::Physical {
                device: device.clone()
            },
            &job
        )
        .is_err());
        device.size_bytes = Some("1024".into());
        device.info["DeviceBlockSize"] = serde_json::json!("4096");
        assert!(resume_source_review(&Source::Physical { device }, &job).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn observed_source_disappearance_saves_map_and_resumes_generated_bytes_exactly() {
        struct LostSource;
        impl SourcePresence for LostSource {
            fn check_source(&self) -> Result<(), String> {
                Err("Injected source disappearance: ENODEV".into())
            }
        }
        // This witness uses ordinary generated files and a probe; no hardware
        // is enumerated, disconnected, read or written.
        let (root, mut job) = artifact_fixture(0, "0 ? 1\n0 1024 ?\n");
        let bytes: Vec<u8> = (0u32..4 * 1024 * 1024).flat_map(u32::to_le_bytes).collect();
        let source_path = root.join("source.img");
        std::fs::write(&source_path, &bytes).unwrap();
        job.source = Source::Image {
            path: source_path.to_string_lossy().into_owned(),
            identity: policy::path_identity(&source_path).unwrap(),
        };
        job.source_size = bytes.len().to_string();
        job.settings.length = Some(bytes.len().to_string());
        job.settings.max_read_rate = Some("1048576".into());
        job.session_id = "generated-disconnect".into();
        std::fs::remove_file(&job.map_path).unwrap();
        let store = Arc::new(Store::open(&root.join("store")).unwrap());
        let sink: Sink = Arc::new(|_, _| {});
        let input = policy::open_readonly(&source_path).unwrap();
        let directory = policy::open_readonly(&root).unwrap();
        let lock = open_lock(&root).unwrap();
        let record = run(
            &mut job,
            input,
            directory,
            (&lock, Some(&LostSource)),
            Arc::new(AtomicBool::new(false)),
            &store,
            &sink,
        );
        assert_eq!(job.state, "paused", "{:?}", job.message);
        assert!(job.message.as_ref().unwrap().contains("ENODEV"));
        let rescued = job
            .map
            .as_ref()
            .unwrap()
            .rescued_bytes
            .parse::<usize>()
            .unwrap();
        assert!(rescued > 0 && rescued < bytes.len());
        assert!(job.map_digest.is_some());
        job.latest_record = Some(record);
        save_job(&store, &job).unwrap();
        drop(lock);
        let manager = Arc::new(Manager::default());
        let mut settings = job.settings.clone();
        settings.max_read_rate = None;
        let plan = manager
            .prepare(
                job.source.clone(),
                policy::open_readonly(&source_path).unwrap(),
                None,
                &root,
                settings,
                bytes.len() as u64,
                Some(&job),
                None,
            )
            .unwrap();
        manager
            .start(&plan.ticket, &plan.confirmation, store.clone(), sink)
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while manager.is_active() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert!(!manager.is_active());
        let completed = store
            .jobs::<Job>()
            .unwrap()
            .into_iter()
            .find(|next| next.id == job.id)
            .unwrap();
        assert_eq!(completed.state, "completed", "{:?}", completed.message);
        assert_eq!(completed.attempts, 2);
        assert_eq!(std::fs::read(&completed.image_path).unwrap(), bytes);
        assert_eq!(std::fs::read(&source_path).unwrap(), bytes);
        drop(store);
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn truncated_or_short_images_cannot_satisfy_finished_map_regions() {
        let (root, mut job) = artifact_fixture(1024, "0 + 1\n0 1024 +\n");
        assert!(update_artifacts(&mut job));
        std::fs::write(&job.image_path, vec![7; 512]).unwrap();
        assert!(!update_artifacts(&mut job));
        assert!(!completion_verified(&job, true));
        std::fs::remove_dir_all(root).unwrap();
        let (root, mut job) = artifact_fixture(512, "0 + 1\n0 1024 +\n");
        assert!(!update_artifacts(&mut job));
        assert!(job.map_digest.is_none());
        std::fs::remove_dir_all(root).unwrap();
        let (root, mut job) = artifact_fixture(512, "0 ? 1\n0 512 +\n512 512 ?\n");
        assert!(update_artifacts(&mut job));
        assert!(!completion_verified(&job, true));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn actual_ddrescue_simulated_read_errors_preserve_partial_data_and_resume_only_remaining_ranges(
    ) {
        // GNU's test mode simulates EIO on ordinary generated files. This never
        // enumerates or accesses a physical device, including the personal flash.
        let root = std::env::temp_dir().join(crate::model::unique_id("drc-simulated-eio"));
        std::fs::create_dir(&root).unwrap();
        let length = 2 * 1024 * 1024usize;
        let bytes: Vec<u8> = (0..length).map(|i| ((i % 251) + 1) as u8).collect();
        let source = root.join("source.img");
        std::fs::write(&source, &bytes).unwrap();
        let domain = root.join("simulated-errors.map");
        let bad_start = 65536usize;
        let bad_size = 16384usize;
        let bad_end = bad_start + bad_size;
        std::fs::write(
            &domain,
            format!(
                "0 ? 1\n0 {bad_start} +\n{bad_start} {bad_size} -\n{bad_end} {} +\n",
                length - bad_end
            ),
        )
        .unwrap();
        let image = root.join("image.raw");
        let map = root.join("rescue.map");
        let mut config = settings();
        config.length = Some(length.to_string());
        let run_test = |config: &Settings, attempt: u32| {
            let arguments = arguments(
                config,
                &length.to_string(),
                source.to_str().unwrap(),
                image.to_str().unwrap(),
                map.to_str().unwrap(),
                root.join(format!("rates-{attempt}.log")).to_str().unwrap(),
            );
            Command::new(executable().unwrap())
                .arg(format!("--test-mode={}", domain.display()))
                .args(arguments)
                .stdin(Stdio::null())
                .output()
                .unwrap()
        };
        let first = run_test(&config, 1);
        assert!(
            first.status.success(),
            "{}",
            String::from_utf8_lossy(&first.stderr)
        );
        let report =
            parse_map(&std::fs::read(&map).unwrap(), &config, &length.to_string()).unwrap();
        assert_ne!(report.rescued_bytes, report.domain_bytes);
        assert_eq!(
            report.bad_sector_bytes, "0",
            "Copying-only errors need not yet be classified as bad sectors"
        );
        assert!(report.non_trimmed_bytes.parse::<u64>().unwrap() > 0);
        assert_eq!(
            std::fs::metadata(&image).unwrap().len(),
            length as u64,
            "Image length alone does not establish completeness"
        );
        let partial = std::fs::read(&image).unwrap();
        for block in report.blocks.iter().filter(|b| b.status == "+") {
            let start = block.position.parse::<usize>().unwrap();
            let end = start + block.size.parse::<usize>().unwrap();
            assert_eq!(partial[start..end], bytes[start..end]);
        }
        assert!(partial[bad_start..bad_end].iter().all(|b| *b == 0));
        std::fs::write(&domain, format!("0 + 1\n0 {length} +\n")).unwrap();
        config.copying_only = false;
        config.retry_passes = 1;
        let second = run_test(&config, 2);
        assert!(
            second.status.success(),
            "{}",
            String::from_utf8_lossy(&second.stderr)
        );
        let report =
            parse_map(&std::fs::read(&map).unwrap(), &config, &length.to_string()).unwrap();
        assert_eq!(report.rescued_bytes, report.domain_bytes);
        assert_eq!(std::fs::read(&image).unwrap(), bytes);
        assert_eq!(std::fs::read(&source).unwrap(), bytes);
        std::fs::remove_dir_all(root).unwrap();
    }
}
