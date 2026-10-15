use crate::model::*;
#[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
use crate::Runtime;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
mod macos;
#[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
pub use macos::setup;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    discovery: Option<Discovery>,
    connection: Option<QueryResult>,
    invalidated_at: Option<u64>,
    activity: Option<String>,
    smart_reports: HashMap<String, QueryResult>,
}
#[derive(Default)]
pub struct Cache(Mutex<Snapshot>);

pub fn discovered(app: &tauri::AppHandle, value: &Discovery) {
    if let Ok(mut cached) = app.state::<Cache>().0.lock() {
        cached.discovery = Some(value.clone());
        cached.invalidated_at = None;
    }
    let _ = app.emit("live-discovery", value);
    changed(app);
}
pub fn connected(app: &tauri::AppHandle, value: &QueryResult) {
    if let Ok(mut cached) = app.state::<Cache>().0.lock() {
        cached.connection = Some(value.clone());
    }
    let _ = app.emit("live-connection", value);
    changed(app);
}
pub fn invalidate(app: &tauri::AppHandle) {
    if let Ok(mut cached) = app.state::<Cache>().0.lock() {
        cached.invalidated_at = Some(now_ms());
    }
    changed(app);
}
pub fn smart(app: &tauri::AppHandle, key: String, report: &QueryResult) {
    if let Ok(mut cached) = app.state::<Cache>().0.lock() {
        cached.smart_reports.insert(key, report.clone());
    }
    changed(app);
}

fn changed(_app: &tauri::AppHandle) {
    #[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
    {
        let app = _app.clone();
        tauri::async_runtime::spawn_blocking(move || macos::publish_snapshot(&app));
    }
}
#[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
fn current_activity(app: &tauri::AppHandle) -> Option<String> {
    let state = app.state::<Runtime>();
    state
        .acquisition
        .active_id()
        .map(|_| "Acquisition in progress".into())
        .or_else(|| {
            state
                .extraction
                .active_id()
                .map(|_| "File extraction in progress".into())
        })
}
#[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
pub fn menu_bar_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let mut snapshot = app
        .state::<Cache>()
        .0
        .lock()
        .map_err(|_| "Live cache unavailable")?
        .clone();
    snapshot.activity = current_activity(&app);
    Ok(snapshot)
}

#[cfg(target_os = "macos")]
pub fn menu_bar_hide(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
    macos::hide();
    let _ = app;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn menu_bar_open(
    app: tauri::AppHandle,
    section: String,
    device_id: Option<String>,
) -> Result<(), String> {
    if !["overview", "device", "ports", "acquisition"].contains(&section.as_str()) {
        return Err("Unknown workspace section".into());
    }
    // Route only a currently observed id. This never prepares an operation.
    if let Some(id) = &device_id {
        let cache = app.state::<Cache>();
        let cache = cache.0.lock().map_err(|_| "Live cache unavailable")?;
        if !cache
            .discovery
            .as_ref()
            .is_some_and(|d| d.devices.iter().any(|d| &d.id == id))
        {
            return Err("This disk is no longer in the live snapshot. Refresh first.".into());
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        main.unminimize().map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        main.emit(
            "menu-bar-navigate",
            serde_json::json!({"section":section,"deviceId":device_id}),
        )
        .map_err(|e| e.to_string())?;
    }
    menu_bar_hide(app)
}
