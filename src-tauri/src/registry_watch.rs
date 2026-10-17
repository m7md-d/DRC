//! Event subscription only: USB/media can exist before Disk Arbitration publishes a disk.
use crate::{
    model::{now_ms, DeviceEvent},
    store::Store,
};
use std::sync::Arc;
use std::{
    ffi::{c_char, c_void},
    sync::{
        atomic::{AtomicBool, Ordering},
        Once,
    },
};
use tauri::{Emitter, Manager};
type Cf = *const c_void;
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IONotificationPortCreate(port: u32) -> *mut c_void;
    fn IONotificationPortDestroy(port: *mut c_void);
    fn IONotificationPortGetRunLoopSource(port: *mut c_void) -> Cf;
    fn IOServiceMatching(name: *const c_char) -> Cf;
    fn IOServiceAddMatchingNotification(
        port: *mut c_void,
        kind: *const c_char,
        matching: Cf,
        callback: unsafe extern "C" fn(*mut c_void, u32),
        context: *mut c_void,
        iterator: *mut u32,
    ) -> i32;
    fn IOIteratorNext(iterator: u32) -> u32;
    fn IOObjectRelease(object: u32) -> i32;
    fn IORegistryEntryGetRegistryEntryID(object: u32, id: *mut u64) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopDefaultMode: Cf;
    fn CFRunLoopGetCurrent() -> Cf;
    fn CFRunLoopAddSource(loop_: Cf, source: Cf, mode: Cf);
    fn CFRunLoopRun();
}
static START: Once = Once::new();
static ENABLED: AtomicBool = AtomicBool::new(false);
struct Context {
    app: tauri::AppHandle,
    label: String,
}
fn drain(iterator: u32) -> Vec<u64> {
    let mut ids = vec![];
    loop {
        let object = unsafe { IOIteratorNext(iterator) };
        if object == 0 {
            break;
        }
        let mut id = 0;
        if unsafe { IORegistryEntryGetRegistryEntryID(object, &mut id) } == 0 {
            ids.push(id);
        }
        unsafe {
            IOObjectRelease(object);
        }
    }
    ids
}
unsafe extern "C" fn changed(context: *mut c_void, iterator: u32) {
    let ids = drain(iterator); // Always empty the iterator to re-arm notifications.
    if ids.is_empty() || !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let context = unsafe { &*(context as *const Context) };
    let event = DeviceEvent {
        observed_at: now_ms(),
        line: format!("IORegistry · {} · registry IDs {ids:?}", context.label),
    };
    crate::menu_bar::invalidate(&context.app);
    if let Err(error) = context.app.state::<Arc<Store>>().append("event", &event) {
        let _ = context.app.emit("persistence-error", error);
    }
    let _ = context.app.emit("device-event", event);
}
pub fn start(app: tauri::AppHandle) {
    ENABLED.store(true, Ordering::Relaxed);
    START.call_once(|| {
        std::thread::spawn(move || {
            let port = unsafe { IONotificationPortCreate(0) };
            if port.is_null() {
                let _ = app.emit("watch-error", "USB/media event subscription unavailable");
                return;
            }
            let source = unsafe { IONotificationPortGetRunLoopSource(port) };
            if source.is_null() {
                unsafe {
                    IONotificationPortDestroy(port);
                }
                let _ = app.emit("watch-error", "USB/media event source unavailable");
                return;
            }
            let mut subscriptions = Vec::new();
            for class in [c"IOUSBHostDevice", c"IOMedia"] {
                for (kind, label) in [
                    (c"IOServicePublish", "published"),
                    (c"IOServiceTerminate", "terminated"),
                ] {
                    let mut context = Box::new(Context {
                        app: app.clone(),
                        label: format!("{} {label}", class.to_string_lossy()),
                    });
                    let mut iterator = 0;
                    let status = unsafe {
                        IOServiceAddMatchingNotification(
                            port,
                            kind.as_ptr(),
                            IOServiceMatching(class.as_ptr()),
                            changed,
                            (&mut *context as *mut Context).cast(),
                            &mut iterator,
                        )
                    };
                    if status == 0 {
                        drain(iterator); // Existing entries arm the subscription; they are not new events.
                        subscriptions.push((iterator, context));
                    } else {
                        let _ = app.emit(
                            "watch-error",
                            format!("USB/media subscription failed ({status})"),
                        );
                    }
                }
            }
            if !subscriptions.is_empty() {
                unsafe {
                    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
                    CFRunLoopRun();
                }
            }
            for (iterator, _) in subscriptions {
                unsafe {
                    IOObjectRelease(iterator);
                }
            }
            unsafe {
                IONotificationPortDestroy(port);
            }
        });
    });
}
pub fn stop() {
    ENABLED.store(false, Ordering::Relaxed);
}
