mod acquisition;
pub mod contracts;
mod extraction;
mod host_evidence;
mod images;
mod linux;
mod menu_bar;
mod model;
mod mount_guard;
mod platform;
mod policy;
mod query;
mod rates;
#[cfg(target_os = "macos")]
mod registry_watch;
mod storage_observations;
mod store;
mod topology;

use acquisition::{Job, Manager as AcquisitionManager, Plan, Settings, Source};
use model::*;

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::Mutex;
use store::{SessionData, SessionSummary, Store};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Runtime {
    devices: Mutex<HashMap<String, Device>>,
    discovery: Mutex<()>,
    watcher: Mutex<Option<Child>>,
    acquisition: Arc<AcquisitionManager>,
    images: images::Manager,
    extraction: Arc<extraction::Manager>,
}

fn require_host() -> Result<(), String> {
    if cfg!(any(target_os = "macos", target_os = "linux")) {
        Ok(())
    } else {
        Err("This build supports macOS and Linux. Windows integration is not implemented.".into())
    }
}

fn emit_record(app: &tauri::AppHandle, record: CommandRecord) {
    if let Err(error) = app.state::<Arc<Store>>().append("command", &record) {
        let _ = app.emit("persistence-error", error);
    }
    let _ = app.emit("command-record", record);
}

#[tauri::command]
async fn read_host_evidence(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    kind: String,
) -> Result<QueryResult, String> {
    if !cfg!(target_os = "linux") {
        return Err("Use the macOS host connection report on this platform. Advanced host evidence currently targets Linux.".into());
    }
    // Kernel-ring-buffer reads neither probe the source nor share a device-query gate.
    let _gate = if kind == "kernel" {
        None
    } else {
        require_idle(&state)?;
        Some(
            state
                .discovery
                .try_lock()
                .map_err(|_| "A query is already running")?,
        )
    };
    let result = host_evidence::collect(&kind)?;
    emit_record(&app, result.record.clone());
    app.state::<Arc<Store>>().append("hostEvidence", &result)?;
    Ok(result)
}

#[tauri::command]
async fn discover_devices(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
) -> Result<Discovery, String> {
    require_host()?;
    require_idle(&state)?;
    let state = state.inner();
    // A refresh and a user query cannot overlap on the same metadata source.
    let _guard = state
        .discovery
        .try_lock()
        .map_err(|_| "A metadata query is already running.")?;
    let mut result = platform::backend().discover(&mut |record| emit_record(&app, record))?;
    let store = app.state::<Arc<Store>>();
    for device in &mut result.devices {
        policy::apply_protection(&store, device)?;
    }
    store.append("snapshot", &result)?;
    let mut devices = state
        .devices
        .lock()
        .map_err(|_| "Device registry is unavailable")?;
    devices.clear();
    for device in &result.devices {
        devices.insert(device.token.clone(), device.clone());
    }
    menu_bar::discovered(&app, &result);
    Ok(result)
}

#[tauri::command]
async fn read_smart(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    request: SmartRequest,
) -> Result<QueryResult, String> {
    require_host()?;
    require_idle(&state)?;
    let _guard = state
        .discovery
        .try_lock()
        .map_err(|_| "A metadata query is already running.")?;
    let device = state
        .devices
        .lock()
        .map_err(|_| "Device registry is unavailable")?
        .get(&request.token)
        .cloned()
        .ok_or("The device selection expired. Refresh the device list.")?;
    if device.metadata_only {
        return Err(device
            .protection_reason
            .unwrap_or("This medium permits discovery metadata only.".into()));
    }
    if !query::valid_smart_type(request.device_type.as_deref()) {
        return Err("Unsupported SMART transport. Choose an offered read-information mode.".into());
    }
    let result =
        platform::backend().smart(&device, request.device_type.as_deref(), &mut |record| {
            emit_record(&app, record)
        })?;
    emit_record(&app, result.record.clone());
    app.state::<Arc<Store>>().append(
        "smart",
        &serde_json::json!({"identityKey":device.identity_key,"result":result}),
    )?;
    menu_bar::smart(&app, device.identity_key, &result);
    Ok(result)
}

#[tauri::command]
async fn read_connections(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
) -> Result<QueryResult, String> {
    require_host()?;
    require_idle(&state)?;
    let _guard = state
        .discovery
        .try_lock()
        .map_err(|_| "A metadata query is already running.")?;
    let result = platform::backend().connections(&mut |record| emit_record(&app, record))?;
    emit_record(&app, result.record.clone());
    app.state::<Arc<Store>>().append("connection", &result)?;
    menu_bar::connected(&app, &result);
    Ok(result)
}

#[tauri::command]
fn installed_tools() -> Vec<ToolReport> {
    platform::tool_inventory()
}

#[tauri::command]
async fn open_image(app: tauri::AppHandle, path: String) -> Result<images::ImageSource, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Runtime>();
        require_idle(&state)?;
        let _gate = state
            .discovery
            .try_lock()
            .map_err(|_| "Another query is running.")?;
        let admitted = admit_path(&app, &state, Path::new(&path), None, false)?;
        let source = state.images.open(Path::new(&path))?;
        if source.identity != admitted {
            state.images.close()?;
            return Err("The image changed during path admission.".into());
        }
        Ok(source)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn close_image(state: tauri::State<'_, Runtime>) -> Result<(), String> {
    state.images.close()
}

#[tauri::command]
async fn read_image(
    app: tauri::AppHandle,
    request: images::Request,
) -> Result<images::Report, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Runtime>();
        require_idle(&state)?;
        let _gate = state
            .discovery
            .try_lock()
            .map_err(|_| "Another query is running.")?;
        let report = state.images.query(request)?;
        emit_record(&app, report.record.clone());
        app.state::<Arc<Store>>().append("imageReport", &report)?;
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn start_device_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
) -> Result<(), String> {
    require_host()?;
    let mut watcher = state
        .watcher
        .lock()
        .map_err(|_| "Connection watcher is unavailable")?;
    if let Some(child) = watcher.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(());
        }
        *watcher = None;
    }
    // diskutil activity subscribes to Disk Arbitration events; it does not scan sectors.
    let (program, args) = if cfg!(target_os = "linux") {
        (
            "/usr/bin/udevadm",
            vec!["monitor", "--udev", "--subsystem-match=block"],
        )
    } else {
        ("/usr/sbin/diskutil", vec!["activity"])
    };
    let mut child = Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Connection watcher has no stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Connection watcher has no stderr")?;
    let stdout_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    let event = DeviceEvent {
                        observed_at: now_ms(),
                        line,
                    };
                    menu_bar::invalidate(&stdout_app);
                    if let Err(error) = stdout_app.state::<Arc<Store>>().append("event", &event) {
                        let _ = stdout_app.emit("persistence-error", error);
                    }
                    let _ = stdout_app.emit("device-event", event);
                }
                Err(error) => {
                    let _ = stdout_app.emit("watch-error", error.to_string());
                    break;
                }
            }
        }
        let _ = stdout_app.emit("watch-stopped", ());
    });
    #[cfg(target_os = "macos")]
    registry_watch::start(app.clone());
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    let _ = app.emit("watch-error", line);
                }
                Err(_) => break,
            }
        }
    });
    *watcher = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_device_watch(state: tauri::State<'_, Runtime>) -> Result<(), String> {
    stop_watcher(state.inner());
    Ok(())
}

fn stop_watcher(state: &Runtime) {
    #[cfg(target_os = "macos")]
    registry_watch::stop();
    if let Ok(mut watcher) = state.watcher.lock() {
        if let Some(mut child) = watcher.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn require_idle(state: &Runtime) -> Result<(), String> {
    if state.acquisition.is_active() || state.extraction.is_active() {
        Err("A copy operation holds the operation lock. Device/SMART polling is suspended until it stops.".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn current_session(app: tauri::AppHandle) -> Result<SessionData, String> {
    let store = app.state::<Arc<Store>>();
    session_with_operations(&store, &store.current_id()?)
}
fn session_with_operations(store: &Store, id: &str) -> Result<SessionData, String> {
    let mut session = store.load(id)?;
    for job in store.jobs::<Job>()? {
        if job.session_id == id {
            if let Some(record) = job.latest_record {
                if !session.command_records.iter().any(|r| r.id == record.id) {
                    session.command_records.push(record);
                }
            }
        }
    }
    for job in store.extractions::<extraction::Job>()? {
        if job.session_id == id {
            for item in job.items {
                if let Some(record) = item.record {
                    if !session.command_records.iter().any(|r| r.id == record.id) {
                        session.command_records.push(record);
                    }
                }
            }
        }
    }
    session
        .command_records
        .sort_by_key(|record| record.started_at);
    Ok(session)
}
#[tauri::command]
async fn list_sessions(app: tauri::AppHandle) -> Result<Vec<SessionSummary>, String> {
    app.state::<Arc<Store>>().list()
}
#[tauri::command]
async fn load_session(app: tauri::AppHandle, id: String) -> Result<SessionData, String> {
    session_with_operations(&app.state::<Arc<Store>>(), &id)
}
#[tauri::command]
async fn new_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
) -> Result<SessionData, String> {
    require_idle(&state)?;
    let _gate = state
        .discovery
        .try_lock()
        .map_err(|_| "A query is already running")?;
    let store = app.state::<Arc<Store>>();
    let id = store.new_session()?;
    store.load(&id)
}

#[tauri::command]
async fn pick_path(app: tauri::AppHandle, kind: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let file = match kind.as_str() {
            "sourceImage" => dialog
                .set_title("Choose source image — read only")
                .blocking_pick_file(),
            "destination" => dialog
                .set_title("Choose destination folder — a new acquisition folder will be created")
                .blocking_pick_folder(),
            "importSession" => dialog
                .set_title("Import DRC session JSON")
                .add_filter("DRC session", &["json"])
                .blocking_pick_file(),
            "exportSession" => dialog
                .set_title("Export complete DRC session — new file only")
                .set_file_name("DRC-session.json")
                .add_filter("DRC session", &["json"])
                .blocking_save_file(),
            _ => return Err("Unsupported file selection operation.".into()),
        };
        file.map(|p| {
            p.into_path().map_err(|e|e.to_string()).and_then(|p|p.into_os_string().into_string().map_err(|_|"The selected path contains non-UTF-8 bytes. It cannot be represented faithfully in this build.".into()))
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

fn path_stores(app: &tauri::AppHandle, path: &Path) -> Result<Vec<String>, String> {
    if !path.is_absolute() {
        return Err("A local absolute path is required.".into());
    }
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        linux::path_stores(path)
    }
    #[cfg(target_os = "macos")]
    {
        let query = {
            use std::os::unix::ffi::OsStrExt;
            let path =
                std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
            let mut filesystem = std::mem::MaybeUninit::<libc::statfs>::uninit();
            if unsafe { libc::statfs(path.as_ptr(), filesystem.as_mut_ptr()) } != 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let filesystem = unsafe { filesystem.assume_init() };
            let from = unsafe { std::ffi::CStr::from_ptr(filesystem.f_mntfromname.as_ptr()) }
                .to_str()
                .map_err(|e| e.to_string())?;
            let id = from
                .strip_prefix("/dev/")
                .filter(|id| query::valid_device_id(id))
                .ok_or("Only local volumes with resolvable physical backing are admitted.")?;
            query::ReadQuery::DeviceInfo(id.into())
        };
        let record = query::execute(query)?;
        let result = platform::successful_plist(&record);
        emit_record(app, record);
        policy::physical_stores(&result?)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (app, path);
        Err("Path backing is unavailable on this host.".into())
    }
}

fn admit_path(
    app: &tauri::AppHandle,
    state: &Runtime,
    path: &Path,
    source_id: Option<&str>,
    writing: bool,
) -> Result<policy::FileIdentity, String> {
    let before = policy::path_identity(path)?;
    let stores = path_stores(app, path)?;
    let registry = state.devices.lock().map_err(|e| e.to_string())?.clone();
    for id in &stores {
        if source_id == Some(id.as_str()) {
            return Err(
                "The destination is backed by the source medium. Choose another physical disk."
                    .into(),
            );
        }
        let device=registry.values().find(|d|&d.id==id).ok_or("This path's backing medium is absent from the live inventory. Refresh before proceeding.")?;
        if device.info.is_null() || device.info_error.is_some() {
            return Err(
                "The backing medium has no resolved descriptor. Refresh before accessing files."
                    .into(),
            );
        }
        let fresh = platform::read_info(id, &mut |record| emit_record(app, record))?;
        if platform::identity_key(&fresh) != device.identity_key {
            return Err("The path's backing medium changed since discovery. Refresh before accessing files.".into());
        }
        if device.metadata_only {
            return Err(device
                .protection_reason
                .clone()
                .unwrap_or("This path belongs to metadata-only media.".into()));
        }
        if writing
            && app
                .state::<Arc<Store>>()
                .jobs::<Job>()?
                .iter()
                .any(|job| match &job.source {
                    Source::Physical { device: source } => {
                        policy::protection_key(source) == policy::protection_key(device)
                    }
                    _ => false,
                })
        {
            return Err("This medium is recorded as a read-only acquisition source. Choose another destination.".into());
        }
    }
    let after = policy::path_identity(path)?;
    if before.device != after.device || before.inode != after.inode {
        return Err(
            "The path changed while its backing medium was being checked. Prepare it again.".into(),
        );
    }
    Ok(after)
}

#[tauri::command]
async fn export_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    id: String,
    path: String,
) -> Result<(), String> {
    require_idle(&state)?;
    let _gate = state
        .discovery
        .try_lock()
        .map_err(|_| "A query is already running")?;
    let target = PathBuf::from(path);
    if target.starts_with("/dev") {
        return Err("A new regular JSON file is required.".into());
    }
    let parent = target
        .parent()
        .ok_or("Export folder is missing")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    admit_path(&app, &state, &parent, None, true)?;
    let store = app.state::<Arc<Store>>();
    let data = session_with_operations(&store, &id)?;
    let export = serde_json::json!({"schemaVersion":"0.2","exportedAt":now_ms(),"applicationPolicy":"source-read-only","id":data.id,"createdAt":data.created_at,"updatedAt":data.updated_at,"snapshot":data.snapshot,"commandRecords":data.command_records,"connectionEvents":data.connection_events,"smartReports":data.smart_reports,"connectionReport":data.connection_report,"imageReports":data.image_reports,"hostEvidence":data.host_evidence,"originalImport":data.original_import});
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(parent.join(target.file_name().ok_or("Export filename is missing")?))
        .map_err(|e| format!("Export creates new files only: {e}"))?;
    file.write_all(&serde_json::to_vec_pretty(&export).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    path: String,
) -> Result<String, String> {
    require_idle(&state)?;
    let _gate = state
        .discovery
        .try_lock()
        .map_err(|_| "A query is already running")?;
    let path = Path::new(&path);
    admit_path(&app, &state, path, None, false)?;
    let bytes = acquisition::read_regular(path)?;
    import_payload(&app, &bytes)
}

#[tauri::command]
async fn import_session_json(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    json: String,
) -> Result<String, String> {
    require_idle(&state)?;
    let _gate = state
        .discovery
        .try_lock()
        .map_err(|_| "A query is already running")?;
    import_payload(&app, json.as_bytes())
}

fn import_payload(app: &tauri::AppHandle, bytes: &[u8]) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if !matches!(value["schemaVersion"].as_str(), Some("0.1" | "0.2")) {
        return Err("Unsupported DRC session schema.".into());
    }
    let mut payload = value;
    let object = payload
        .as_object_mut()
        .ok_or("Session JSON must be an object")?;
    object.entry("id").or_insert(serde_json::json!("import"));
    object
        .entry("createdAt")
        .or_insert(serde_json::json!(now_ms()));
    object
        .entry("updatedAt")
        .or_insert(serde_json::json!(now_ms()));
    let mut data: SessionData = serde_json::from_value(payload).map_err(|e| e.to_string())?;
    data.original_import = Some(
        std::str::from_utf8(bytes)
            .map_err(|e| e.to_string())?
            .into(),
    );
    // Reject inconsistent byte encodings rather than silently repairing an imported transcript.
    use base64::Engine;
    for record in &data.command_records {
        for (encoded, text, valid) in [
            (
                &record.stdout_base64,
                &record.stdout,
                record.stdout_utf8_valid,
            ),
            (
                &record.stderr_base64,
                &record.stderr,
                record.stderr_utf8_valid,
            ),
        ] {
            let raw = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|e| e.to_string())?;
            if valid && std::str::from_utf8(&raw).map_err(|e| e.to_string())? != text {
                return Err("Imported text differs from the original encoded stream.".into());
            }
        }
    }
    app.state::<Arc<Store>>().import(data)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcquireRequest {
    kind: String,
    image_path: Option<String>,
    device_token: Option<String>,
    destination: String,
    settings: Settings,
    resume_job: Option<String>,
}

fn physical_source(
    app: &tauri::AppHandle,
    state: &Runtime,
    token: &str,
) -> Result<(Device, std::fs::File, mount_guard::MountGuard), String> {
    let device = state
        .devices
        .lock()
        .map_err(|e| e.to_string())?
        .get(token)
        .cloned()
        .ok_or("The selected device token expired. Refresh and select it again.")?;
    if device.metadata_only {
        return Err(device
            .protection_reason
            .clone()
            .unwrap_or("Metadata-only medium".into()));
    }
    policy::require_acquisition(&device, &device.info)?;
    validate_physical(app, &device)?;
    let guard = mount_guard::MountGuard::acquire(&device.id)?;
    validate_physical(app, &device)?;
    let input = guard.open_source()?;
    validate_physical(app, &device)?;
    Ok((device, input, guard))
}

fn validate_physical(app: &tauri::AppHandle, device: &Device) -> Result<(), String> {
    let fresh = platform::read_info(&device.id, &mut |record| emit_record(app, record))?;
    policy::require_acquisition(device, &fresh)?;
    #[cfg(target_os = "linux")]
    linux::require_unmounted(&device.id)?;
    // Inspect mounted volumes through metadata, including APFS physical stores.
    // No unmount/repair is performed automatically because unmount itself may flush writes.
    #[cfg(target_os = "macos")]
    {
        let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, libc::MNT_NOWAIT) };
        if count < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut mounts = vec![unsafe { std::mem::zeroed::<libc::statfs>() }; count as usize + 16];
        let count = unsafe {
            libc::getfsstat(
                mounts.as_mut_ptr(),
                (mounts.len() * std::mem::size_of::<libc::statfs>()) as i32,
                libc::MNT_NOWAIT,
            )
        };
        if count < 0 || count as usize >= mounts.len() {
            return Err(
                "Mounted-volume enumeration changed or failed. Prepare the source again.".into(),
            );
        }
        for mount in mounts.iter().take(count as usize) {
            let from =
                unsafe { std::ffi::CStr::from_ptr(mount.f_mntfromname.as_ptr()) }.to_string_lossy();
            if !from.starts_with("/dev/disk") {
                continue;
            }
            let path =
                unsafe { std::ffi::CStr::from_ptr(mount.f_mntonname.as_ptr()) }.to_string_lossy();
            let stores = path_stores(app, Path::new(path.as_ref()))?;
            if stores.contains(&device.id) {
                return Err(format!("Source volume is mounted at {path}. DRC will not acquire a mounted source or unmount it automatically. Prepare an unmounted source outside the acquisition operation."));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn prepare_acquisition(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    request: AcquireRequest,
) -> Result<Plan, String> {
    require_host()?;
    require_idle(&state)?;
    let _gate = state
        .discovery
        .try_lock()
        .map_err(|_| "A query is already running")?;
    let store = app.state::<Arc<Store>>();
    let old = if let Some(id) = &request.resume_job {
        Some(
            store
                .jobs::<Job>()?
                .into_iter()
                .find(|j| &j.id == id)
                .ok_or("Saved acquisition was not found")?,
        )
    } else {
        None
    };
    let (source, input, guard, total) = match request.kind.as_str() {
        "image" => {
            let path = request
                .image_path
                .as_deref()
                .ok_or("Choose a source image")?;
            let admitted = admit_path(&app, &state, Path::new(path), None, false)?;
            let (canonical, input, identity) = policy::existing_regular_source(Path::new(path))?;
            if admitted != identity {
                return Err("The source image changed while being admitted.".into());
            }
            if let Some(job) = &old {
                match &job.source {
                    Source::Image {
                        identity: prior, ..
                    } if &identity == prior => {}
                    _ => {
                        return Err(
                            "The original source identity does not match the resume source.".into(),
                        )
                    }
                }
            }
            let size = acquisition::decimal(&identity.size, "Source size")?;
            (
                Source::Image {
                    path: canonical.to_string_lossy().into_owned(),
                    identity,
                },
                input,
                None,
                size,
            )
        }
        "physical" => {
            let token = request
                .device_token
                .as_deref()
                .ok_or("Select a current external source")?;
            let (device, input, guard) = physical_source(&app, &state, token)?;
            if old.is_none()
                && device
                    .info
                    .get("DeviceBlockSize")
                    .or_else(|| device.info.get("log-sec"))
                    .and_then(serde_json::Value::as_str)
                    .and_then(|s| s.parse::<u32>().ok())
                    != Some(request.settings.sector_size)
            {
                return Err("Physical acquisition sector size must match the source's reported logical block size.".into());
            }
            if let Some(job) = &old {
                match &job.source { Source::Physical{device:prior} if device.identity_key==prior.identity_key=>{},_=>return Err("The original source descriptor does not match. DRC will not automatically rebind a reconnect to a saved image.".into()) }
            }
            let size = acquisition::decimal(
                device
                    .size_bytes
                    .as_deref()
                    .ok_or("Source size is missing")?,
                "Source size",
            )?;
            (
                Source::Physical {
                    device: Box::new(device),
                },
                input,
                Some(guard),
                size,
            )
        }
        _ => return Err("Unsupported acquisition source type".into()),
    };
    let destination = old
        .as_ref()
        .map(|j| j.directory.as_str())
        .unwrap_or(&request.destination);
    let source_id = match &source {
        Source::Physical { device } => Some(device.id.as_str()),
        _ => None,
    };
    let admitted = admit_path(&app, &state, Path::new(destination), source_id, true)?;
    let settings = if let Some(job) = &old {
        acquisition::resume_settings(job, request.settings)?
    } else {
        request.settings
    };
    state.acquisition.prepare(
        source,
        input,
        guard,
        Path::new(destination),
        settings,
        total,
        old.as_ref(),
        Some(admitted),
    )
}

#[tauri::command]
fn cancel_acquisition_plan(state: tauri::State<'_, Runtime>, ticket: String) {
    state.acquisition.cancel_plan(&ticket);
}

#[tauri::command]
async fn start_acquisition(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    ticket: String,
    confirmation: String,
) -> Result<Job, String> {
    require_idle(&state)?;
    let _gate = state
        .discovery
        .try_lock()
        .map_err(|_| "A query is already running")?;
    let plan = state.acquisition.plan(&ticket)?;
    if let Source::Physical { device } = &plan.source {
        let live = state
            .devices
            .lock()
            .map_err(|e| e.to_string())?
            .get(&device.token)
            .cloned()
            .ok_or("The inventory changed after review. Prepare the source again.")?;
        validate_physical(&app, &live)?;
    }
    let store = app.state::<Arc<Store>>().inner().clone();
    let sink: acquisition::Sink = Arc::new(move |job, record| {
        if let Some(record) = record {
            if !matches!(job.state.as_str(), "running" | "pausing") {
                emit_record(&app, record);
            } else {
                let _ = app.emit("command-record", record);
            }
        }
        let _ = app.emit("acquisition-update", job);
    });
    state.acquisition.start(&ticket, &confirmation, store, sink)
}

#[tauri::command]
fn pause_acquisition(state: tauri::State<'_, Runtime>, id: String) -> Result<(), String> {
    state.acquisition.stop(&id)
}
#[tauri::command]
async fn list_acquisitions(app: tauri::AppHandle) -> Result<Vec<Job>, String> {
    app.state::<Arc<Store>>().jobs()
}
#[tauri::command]
async fn acquisition_map(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    id: String,
) -> Result<String, String> {
    let job = app
        .state::<Arc<Store>>()
        .jobs::<Job>()?
        .into_iter()
        .find(|j| j.id == id)
        .ok_or("Acquisition was not found")?;
    let admitted = admit_path(&app, &state, Path::new(&job.directory), None, false)?;
    if admitted.device != job.directory_identity.device
        || admitted.inode != job.directory_identity.inode
    {
        return Err("The saved acquisition directory was replaced.".into());
    }
    String::from_utf8(acquisition::read_regular(Path::new(&job.map_path))?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn prepare_extraction(
    app: tauri::AppHandle,
    report_id: String,
    indices: Vec<usize>,
    destination: String,
) -> Result<extraction::Plan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Runtime>();
        require_idle(&state)?;
        let _gate = state
            .discovery
            .try_lock()
            .map_err(|_| "Another query is running.")?;
        let (source, input, request, files) =
            state.images.extraction_source(&report_id, &indices)?;
        let admitted = admit_path(&app, &state, Path::new(&destination), None, true)?;
        state.extraction.prepare(
            source,
            input,
            request,
            files,
            Path::new(&destination),
            &admitted,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn cancel_extraction_plan(state: tauri::State<'_, Runtime>, ticket: String) {
    state.extraction.cancel(&ticket);
}
#[tauri::command]
async fn start_extraction(
    app: tauri::AppHandle,
    ticket: String,
    confirmation: String,
) -> Result<extraction::Job, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Runtime>();
        require_idle(&state)?;
        let _gate = state
            .discovery
            .try_lock()
            .map_err(|_| "Another query is running.")?;
        let plan = state.extraction.plan(&ticket)?;
        let admitted = admit_path(&app, &state, Path::new(&plan.destination), None, true)?;
        if admitted.device != plan.destination_identity.device
            || admitted.inode != plan.destination_identity.inode
        {
            return Err("Destination changed after review.".into());
        }
        let store = app.state::<Arc<Store>>().inner().clone();
        let events = app.clone();
        let sink: extraction::Sink = Arc::new(move |job, record| {
            if let Some(record) = record {
                emit_record(&events, record);
            }
            let _ = events.emit("extraction-update", job);
        });
        state.extraction.start(&ticket, &confirmation, store, sink)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn stop_extraction(state: tauri::State<'_, Runtime>, id: String) -> Result<(), String> {
    state.extraction.stop(&id)
}
#[tauri::command]
fn list_extractions(app: tauri::AppHandle) -> Result<Vec<extraction::Job>, String> {
    app.state::<Arc<Store>>().extractions()
}
#[tauri::command]
async fn extraction_bytes(
    app: tauri::AppHandle,
    id: String,
    index: usize,
    offset: String,
    length: usize,
) -> Result<extraction::ArtifactPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Runtime>();
        require_idle(&state)?;
        let _gate = state
            .discovery
            .try_lock()
            .map_err(|_| "Another query is running.")?;
        let job = app
            .state::<Arc<Store>>()
            .extractions::<extraction::Job>()?
            .into_iter()
            .find(|j| j.id == id)
            .ok_or("The extraction was not found in this application's job store.")?;
        let admitted = admit_path(&app, &state, Path::new(&job.directory), None, false)?;
        if admitted.device != job.directory_identity.device
            || admitted.inode != job.directory_identity.inode
        {
            return Err("The extraction directory was replaced.".into());
        }
        extraction::read_artifact(&job, index, &offset, length)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(Runtime::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let store = Arc::new(Store::open(&root).map_err(std::io::Error::other)?);
            acquisition::recover_jobs(&store).map_err(std::io::Error::other)?;
            extraction::recover(&store).map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(menu_bar::Cache::default());
            #[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
            menu_bar::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            read_smart,
            read_connections,
            read_host_evidence,
            open_image,
            close_image,
            read_image,
            prepare_extraction,
            cancel_extraction_plan,
            start_extraction,
            stop_extraction,
            list_extractions,
            extraction_bytes,
            installed_tools,
            start_device_watch,
            stop_device_watch,
            current_session,
            list_sessions,
            load_session,
            new_session,
            pick_path,
            export_session,
            import_session,
            import_session_json,
            prepare_acquisition,
            cancel_acquisition_plan,
            start_acquisition,
            pause_acquisition,
            list_acquisitions,
            acquisition_map
        ])
        .build(tauri::generate_context!())
        .expect("Cannot start DRC");
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = &event {
            let _ = menu_bar::menu_bar_open(app.clone(), "overview".into(), None);
        }
        let mut deferred = false;
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            let state = app.state::<Runtime>();
            if let Some(id) = state.acquisition.active_id() {
                deferred = true;
                api.prevent_exit();
                let _ = state.acquisition.stop(&id);
                let _ = app.emit("exit-deferred", "Acquisition stop requested. DRC will remain open until ddrescue exits and the mapfile is saved. Quit again after it stops.");
            }
            if let Some(id) = state.extraction.active_id() {
                deferred = true;
                api.prevent_exit();
                let _ = state.extraction.stop(&id);
                let _ = app.emit("exit-deferred", "File extraction stop requested. DRC remains open until the reader exits and its output is saved. Quit again after it stops.");
            }
            #[cfg(target_os = "macos")]
            if deferred {
                let _ = menu_bar::menu_bar_open(app.clone(), "overview".into(), None);
            }
        }
        if !deferred && matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            stop_watcher(&app.state::<Runtime>());
        }
    });
}
