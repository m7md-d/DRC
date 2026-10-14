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
        fn DADissenterCreate(allocator: CF, status: i32, message: CF) -> CF;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFRunLoopDefaultMode: CF;
        fn CFRunLoopGetCurrent() -> CF;
        fn CFRunLoopRun();
        fn CFRelease(object: CF);
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
        };
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
}

pub struct MountGuard {
    id: String,
}
impl MountGuard {
    pub fn acquire(id: &str) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            mac::add(id)?;
            Ok(Self { id: id.into() })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = id;
            Err("Source mount protection is not implemented on this host.".into())
        }
    }
}
impl Drop for MountGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        mac::remove(&self.id);
    }
}
