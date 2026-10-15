use crate::model::{now_ms, parse_plist};
use serde_json::{json, Value};
use std::{
    ffi::{c_char, c_void, CStr},
    mem, ptr,
    sync::OnceLock,
    time::Instant,
};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    Manager,
};

type Cf = *const c_void;
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: Cf);
    fn CFStringCreateWithCString(allocator: Cf, text: *const c_char, encoding: u32) -> Cf;
    fn CFPropertyListCreateData(
        allocator: Cf,
        value: Cf,
        format: isize,
        options: usize,
        error: *mut Cf,
    ) -> Cf;
    fn CFDataGetLength(value: Cf) -> isize;
    fn CFDataGetBytePtr(value: Cf) -> *const u8;
    fn CFArrayGetCount(value: Cf) -> isize;
    fn CFArrayGetValueAtIndex(value: Cf, index: isize) -> Cf;
}
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const c_char) -> Cf;
    fn IOServiceGetMatchingServices(port: u32, matching: Cf, iterator: *mut u32) -> i32;
    fn IOIteratorNext(iterator: u32) -> u32;
    fn IOObjectRelease(object: u32) -> i32;
    fn IOObjectConformsTo(object: u32, class: *const c_char) -> u32;
    fn IORegistryEntryGetRegistryEntryID(entry: u32, id: *mut u64) -> i32;
    fn IORegistryEntryCreateCFProperty(entry: u32, key: Cf, allocator: Cf, options: u32) -> Cf;
    fn IORegistryEntryCreateIterator(
        entry: u32,
        plane: *const c_char,
        options: u32,
        iterator: *mut u32,
    ) -> i32;
    fn IOPSCopyPowerSourcesInfo() -> Cf;
    fn IOPSCopyPowerSourcesList(info: Cf) -> Cf;
    fn IOPSGetPowerSourceDescription(info: Cf, source: Cf) -> Cf;
}
#[link(name = "System")]
unsafe extern "C" {
    fn mach_host_self() -> u32;
    fn mach_task_self() -> u32;
    fn mach_port_deallocate(task: u32, name: u32) -> i32;
}

// All handles here are created by Copy/Create APIs; borrowed descriptions are never released.
struct OwnedCf(Cf);
impl Drop for OwnedCf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}
struct Io(u32);
impl Drop for Io {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe {
                IOObjectRelease(self.0);
            }
        }
    }
}

fn plist(value: Cf) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    unsafe {
        let mut error = ptr::null();
        let data = OwnedCf(CFPropertyListCreateData(
            ptr::null(),
            value,
            100,
            0,
            &mut error,
        ));
        let _error = OwnedCf(error);
        if data.0.is_null() {
            return Value::Null;
        }
        let length = CFDataGetLength(data.0);
        if !(1..=4_194_304).contains(&length) {
            return Value::Null;
        }
        parse_plist(std::slice::from_raw_parts(
            CFDataGetBytePtr(data.0),
            length as usize,
        ))
        .unwrap_or(Value::Null)
    }
}
fn property(entry: u32, key: &CStr) -> Value {
    unsafe {
        let key = OwnedCf(CFStringCreateWithCString(
            ptr::null(),
            key.as_ptr(),
            0x08000100,
        ));
        if key.0.is_null() {
            return Value::Null;
        }
        let value = OwnedCf(IORegistryEntryCreateCFProperty(
            entry,
            key.0,
            ptr::null(),
            0,
        ));
        plist(value.0)
    }
}
fn sysctl<T: Copy>(key: &CStr) -> Option<T> {
    let mut value = mem::MaybeUninit::<T>::uninit();
    let mut size = mem::size_of::<T>();
    // Only fixed typed keys below reach this helper; no user-supplied names or new values.
    let result = unsafe {
        libc::sysctlbyname(
            key.as_ptr(),
            value.as_mut_ptr().cast(),
            &mut size,
            ptr::null_mut(),
            0,
        )
    };
    (result == 0 && size == mem::size_of::<T>()).then(|| unsafe { value.assume_init() })
}
fn sysctl_text(key: &CStr) -> Option<String> {
    let mut buffer = [0u8; 256];
    let mut size = buffer.len();
    if unsafe {
        libc::sysctlbyname(
            key.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut size,
            ptr::null_mut(),
            0,
        )
    } != 0
    {
        return None;
    }
    CStr::from_bytes_until_nul(&buffer[..size.min(buffer.len())])
        .ok()?
        .to_str()
        .ok()
        .map(str::to_owned)
}

fn power_sources() -> Vec<Value> {
    unsafe {
        let info = OwnedCf(IOPSCopyPowerSourcesInfo());
        if info.0.is_null() {
            return vec![];
        }
        let sources = OwnedCf(IOPSCopyPowerSourcesList(info.0));
        if sources.0.is_null() {
            return vec![];
        }
        (0..CFArrayGetCount(sources.0))
            .map(|i| {
                plist(IOPSGetPowerSourceDescription(
                    info.0,
                    CFArrayGetValueAtIndex(sources.0, i),
                ))
            })
            .collect()
    }
}
fn disk_counters() -> Vec<Value> {
    let mut iterator = 0;
    // Reads already published registry properties. No disk handle or SMART command is opened.
    if unsafe {
        IOServiceGetMatchingServices(
            0,
            IOServiceMatching(c"IOBlockStorageDriver".as_ptr()),
            &mut iterator,
        )
    } != 0
    {
        return vec![];
    }
    let iterator = Io(iterator);
    let mut counters = vec![];
    loop {
        let driver = Io(unsafe { IOIteratorNext(iterator.0) });
        if driver.0 == 0 {
            break;
        }
        let statistics = property(driver.0, c"Statistics");
        let mut registry_id = 0;
        if unsafe { IORegistryEntryGetRegistryEntryID(driver.0, &mut registry_id) } != 0 {
            continue;
        }
        let mut children = 0;
        if unsafe {
            IORegistryEntryCreateIterator(driver.0, c"IOService".as_ptr(), 1, &mut children)
        } != 0
        {
            continue;
        }
        let children = Io(children);
        loop {
            let child = Io(unsafe { IOIteratorNext(children.0) });
            if child.0 == 0 {
                break;
            }
            if unsafe { IOObjectConformsTo(child.0, c"IOMedia".as_ptr()) } == 0
                || property(child.0, c"Whole") != Value::Bool(true)
            {
                continue;
            }
            let id = property(child.0, c"BSD Name");
            if id.as_str().is_some() {
                counters.push(json!({"deviceId":id,"registryId":registry_id.to_string(),"statistics":statistics}));
            }
        }
    }
    counters
}

pub fn host() -> Value {
    static START: OnceLock<Instant> = OnceLock::new();
    let mut cpu: libc::host_cpu_load_info = unsafe { mem::zeroed() };
    let mut vm: libc::vm_statistics64 = unsafe { mem::zeroed() };
    let mut cpu_count = libc::HOST_CPU_LOAD_INFO_COUNT;
    let mut vm_count = libc::HOST_VM_INFO64_COUNT;
    let host = unsafe { mach_host_self() };
    let cpu_ok = unsafe {
        libc::host_statistics(
            host,
            libc::HOST_CPU_LOAD_INFO,
            (&mut cpu as *mut libc::host_cpu_load_info).cast(),
            &mut cpu_count,
        )
    } == 0
        && cpu_count >= libc::HOST_CPU_LOAD_INFO_COUNT;
    let required_vm_count = (mem::offset_of!(libc::vm_statistics64, compressor_page_count)
        + mem::size_of::<u32>())
        / mem::size_of::<i32>();
    let vm_ok = unsafe {
        libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            (&mut vm as *mut libc::vm_statistics64).cast(),
            &mut vm_count,
        )
    } == 0
        && vm_count as usize >= required_vm_count;
    unsafe {
        mach_port_deallocate(mach_task_self(), host);
    }
    let page_size = sysctl::<u64>(c"hw.pagesize");
    // hw.pagesize is a 32-bit integer on macOS, unlike hw.memsize.
    let page_size = page_size.or_else(|| sysctl::<u32>(c"hw.pagesize").map(u64::from));
    let memory = if vm_ok {
        page_size.map(|page| {
            json!({
                "activeBytes": (u64::from(vm.active_count) * page).to_string(),
                "wiredBytes": (u64::from(vm.wire_count) * page).to_string(),
                "compressedBytes": (u64::from(vm.compressor_page_count) * page).to_string(),
                "inactiveBytes": (u64::from(vm.inactive_count) * page).to_string(),
                "freeBytes": (u64::from(vm.free_count) * page).to_string(),
                "pageSize":page.to_string(),"returnedCount":vm_count
            })
        })
    } else {
        None
    };
    let boot = sysctl::<libc::timeval>(c"kern.boottime");
    let mut load = [0.0f64; 3];
    let load = (unsafe { libc::getloadavg(load.as_mut_ptr(), 3) } == 3).then_some(load);
    json!({
        "observedAt":now_ms(), "monotonicMs":START.get_or_init(Instant::now).elapsed().as_millis().to_string(),
        "model":sysctl_text(c"hw.model"),"chip":sysctl_text(c"machdep.cpu.brand_string"),
        "osVersion":sysctl_text(c"kern.osproductversion"),"logicalCores":sysctl::<u32>(c"hw.logicalcpu"),
        "memoryBytes":sysctl::<u64>(c"hw.memsize").map(|v|v.to_string()),"memory":memory,
        "cpuTicks":cpu_ok.then(||cpu.cpu_ticks.map(|v|v.to_string())),"loadAverage":load,
        "uptimeSeconds":boot.and_then(|v| (v.tv_sec >= 0).then(|| (now_ms()/1000).saturating_sub(v.tv_sec as u64).to_string())),
        "powerSources":power_sources(),"diskCounters":disk_counters(),
        "source":"macOS sysctl · Mach host statistics · IOKit published registry counters · IOPowerSources"
    })
}

unsafe extern "C" {
    fn drc_native_menu_install(callback: extern "C" fn(i32, *const c_char));
    fn drc_native_menu_show();
    fn drc_native_menu_hide();
    fn drc_native_menu_receive(json: *const c_char);
}
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SAMPLING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn visible() -> bool {
    VISIBLE.load(std::sync::atomic::Ordering::Acquire)
}
fn send(value: Value) {
    // Swift copies the UTF-8 buffer synchronously, then updates AppKit on its main queue.
    if let Ok(text) = std::ffi::CString::new(value.to_string()) {
        unsafe {
            drc_native_menu_receive(text.as_ptr());
        }
    }
}
pub fn publish_snapshot(app: &tauri::AppHandle) {
    if !visible() {
        return;
    }
    match super::menu_bar_snapshot(app.clone()) {
        Ok(snapshot) => send(json!({"kind":"snapshot","value":snapshot})),
        Err(error) => send(json!({"kind":"query","error":error,"busy":null})),
    }
}
pub fn hide() {
    unsafe {
        drc_native_menu_hide();
    }
}

extern "C" fn native_action(action: i32, pointer: *const c_char) {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    // The pointer is borrowed from Swift.withCString and is copied before returning.
    let payload = if pointer.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .ok()
            .filter(|s| s.len() <= 4096)
            .map(str::to_owned)
    };
    if action == 7 {
        VISIBLE.store(
            payload.as_deref() == Some("1"),
            std::sync::atomic::Ordering::Release,
        );
        return;
    }
    match action {
        1 => {
            tauri::async_runtime::spawn_blocking(move || publish_snapshot(&app));
        }
        2 => {
            if !visible() || SAMPLING.swap(true, std::sync::atomic::Ordering::AcqRel) {
                return;
            }
            tauri::async_runtime::spawn_blocking(move || {
                let sample = host();
                if visible() {
                    let activity = super::current_activity(&app);
                    send(json!({"kind":"host","value":sample,"activity":activity}));
                }
                SAMPLING.store(false, std::sync::atomic::Ordering::Release);
            });
        }
        3 | 4 => {
            tauri::async_runtime::spawn(async move {
                // Reuse the same discovery lock, protection rules, command recording and store.
                let result = if action == 3 {
                    crate::discover_devices(app.clone(), app.state::<crate::Runtime>())
                        .await
                        .map(|_| ())
                } else {
                    crate::read_connections(app.clone(), app.state::<crate::Runtime>())
                        .await
                        .map(|_| ())
                };
                send(json!({"kind":"query","busy":null,"error":result.err()}));
                publish_snapshot(&app);
            });
        }
        5 => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Open {
                section: String,
                device_id: Option<String>,
            }
            if let Some(request) = payload.and_then(|s| serde_json::from_str::<Open>(&s).ok()) {
                let target = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Err(error) =
                        super::menu_bar_open(target, request.section, request.device_id)
                    {
                        send(json!({"kind":"query","busy":null,"error":error}));
                    }
                });
            }
        }
        6 => app.exit(0),
        _ => (),
    }
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let _ = APP.set(app.handle().clone());
    // A single SwiftUI/AppKit surface inside this executable; no secondary app or webview.
    unsafe {
        drc_native_menu_install(native_action);
    }
    let main_menu = Menu::default(app.handle())?;
    let quick = MenuItem::with_id(
        app,
        "quick-look",
        "Quick Look",
        true,
        Some("CmdOrCtrl+Shift+M"),
    )?;
    main_menu.append(&Submenu::with_items(app, "Monitor", true, &[&quick])?)?;
    app.set_menu(main_menu)?;
    app.on_menu_event(|_, event| {
        if event.id.as_ref() == "quick-look" {
            unsafe {
                drc_native_menu_show();
            }
        }
    });
    if let Some(main) = app.get_webview_window("main") {
        let weak = main.clone();
        main.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = weak.hide();
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_host_counters_are_exact_and_do_not_open_storage() {
        // Metadata APIs only. No disk descriptor, self-test, sector read or benchmark.
        let sample = host();
        assert!(
            sample["memoryBytes"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap()
                > 0
        );
        assert_eq!(sample["cpuTicks"].as_array().unwrap().len(), 4);
        assert!(sample["memory"]["wiredBytes"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .is_ok());
        assert!(sample["model"].as_str().is_some());
        for disk in sample["diskCounters"].as_array().unwrap() {
            assert!(crate::query::valid_device_id(
                disk["deviceId"].as_str().unwrap()
            ));
            assert!(disk["registryId"].as_str().unwrap().parse::<u64>().is_ok());
            assert!(disk["statistics"]["Bytes (Read)"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .is_ok());
        }
    }
}
