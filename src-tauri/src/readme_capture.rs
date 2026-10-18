//! Opt-in capture of the app's own UI, with a separate store and generated image.
//! The normal device/reader commands retain every admission check.
use serde_json::Value;

#[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
fn context() -> Result<Option<(std::path::PathBuf, std::path::PathBuf)>, String> {
    let Some(directory) = std::env::var_os("DRC_CAPTURE_DIR") else {
        return Ok(None);
    };
    if std::env::var_os("DRC_CAPTURE_STORE").is_none() {
        return Err("Capture requires an isolated session store.".into());
    }
    let directory = std::path::PathBuf::from(directory);
    let image = std::path::PathBuf::from(
        std::env::var_os("DRC_CAPTURE_IMAGE").ok_or("Capture image missing")?,
    );
    if !directory.is_absolute() || !image.is_absolute() || !directory.is_dir() || !image.is_file() {
        return Err(
            "Capture requires an existing absolute output directory and generated image.".into(),
        );
    }
    Ok(Some((directory, image)))
}
#[tauri::command]
pub fn readme_capture_context() -> Result<Option<Value>, String> {
    #[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
    {
        Ok(context()?.map(|(_, image)| serde_json::json!({"image": image})))
    }
    #[cfg(not(all(target_os = "macos", feature = "macos-menu-bar")))]
    {
        Ok(None)
    }
}
#[tauri::command]
pub async fn readme_capture_frame(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if !["overview", "image-files", "command-reference"].contains(&name.as_str()) {
        return Err("Unknown documentation frame".into());
    }
    #[cfg(all(target_os = "macos", feature = "macos-menu-bar"))]
    {
        use std::{
            ffi::{c_char, c_void, CStr, CString},
            sync::mpsc,
            time::Duration,
        };
        use tauri::Manager;
        type Reply = mpsc::SyncSender<Result<(), String>>;
        extern "C" fn complete(error: *const c_char, context: *mut c_void) {
            let sender = unsafe { Box::from_raw(context as *mut Reply) };
            let result = if error.is_null() {
                Ok(())
            } else {
                Err(unsafe { CStr::from_ptr(error) }
                    .to_string_lossy()
                    .into_owned())
            };
            let _ = sender.send(result);
        }
        unsafe extern "C" {
            fn drc_readme_snapshot(
                window: *mut c_void,
                path: *const c_char,
                context: *mut c_void,
                callback: extern "C" fn(*const c_char, *mut c_void),
            );
        }
        let (directory, _) = context()?.ok_or("Documentation capture is not enabled")?;
        let path = CString::new(
            directory
                .join(format!("{name}.png"))
                .to_string_lossy()
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
        let (sender, receiver) = mpsc::sync_channel(1);
        let main = app.get_webview_window("main").ok_or("Workspace missing")?;
        let reply = Box::into_raw(Box::new(sender)) as usize;
        if let Err(error) = app.run_on_main_thread(move || match main.ns_window() {
            Ok(window) => unsafe {
                drc_readme_snapshot(window, path.as_ptr(), reply as *mut c_void, complete);
            },
            Err(error) => {
                let sender = unsafe { Box::from_raw(reply as *mut Reply) };
                let _ = sender.send(Err(error.to_string()));
            }
        }) {
            unsafe {
                drop(Box::from_raw(reply as *mut Reply));
            }
            return Err(error.to_string());
        }
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(Duration::from_secs(20))
                .map_err(|e| e.to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(all(target_os = "macos", feature = "macos-menu-bar")))]
    {
        let _ = app;
        Err("Native documentation capture requires macOS".into())
    }
}
#[tauri::command]
pub fn readme_capture_finish(app: tauri::AppHandle, error: Option<String>) -> Result<(), String> {
    if readme_capture_context()?.is_none() {
        return Err("Documentation capture is not enabled".into());
    }
    if let Some(error) = &error {
        eprintln!("Screenshot capture: {error}");
    }
    app.exit(if error.is_some() { 1 } else { 0 });
    Ok(())
}
