//! Read-only Apple Silicon telemetry. Private APIs are optional and fail closed.
//! ABI/state-table research: macmon v0.7.2 (MIT); see THIRD-PARTY-NOTICES.md.
use super::*;
use std::sync::Mutex;

unsafe extern "C" {
    fn CFStringGetCString(s: Cf, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
    fn CFDictionaryGetValue(d: Cf, key: Cf) -> Cf;
    fn CFDictionaryCreateMutableCopy(a: Cf, count: isize, d: Cf) -> Cf;
    fn CFGetTypeID(v: Cf) -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFDataGetTypeID() -> usize;
    fn CFPropertyListCreateWithData(
        a: Cf,
        data: Cf,
        flags: usize,
        format: *mut isize,
        error: *mut Cf,
    ) -> Cf;
    fn CFDataCreate(a: Cf, bytes: *const u8, count: isize) -> Cf;
    fn IORegistryEntryGetName(entry: u32, name: *mut c_char) -> i32;
    fn IOHIDEventSystemClientCreate(a: Cf) -> Cf;
    fn IOHIDEventSystemClientSetMatching(client: Cf, matching: Cf) -> i32;
    fn IOHIDEventSystemClientCopyServices(client: Cf) -> Cf;
    fn IOHIDServiceClientCopyProperty(service: Cf, key: Cf) -> Cf;
    fn IOHIDServiceClientCopyEvent(service: Cf, event_type: i64, options: i32, timeout: i64) -> Cf;
    fn IOHIDEventGetFloatValue(event: Cf, field: i64) -> f64;
}
fn cf_string(value: &CStr) -> OwnedCf {
    OwnedCf(unsafe { CFStringCreateWithCString(ptr::null(), value.as_ptr(), 0x0800_0100) })
}
fn string(v: Cf) -> Option<String> {
    if v.is_null() {
        return None;
    }
    let mut buffer = [0i8; 512];
    (unsafe { CFStringGetCString(v, buffer.as_mut_ptr(), buffer.len() as isize, 0x0800_0100) } != 0)
        .then(|| {
            unsafe { CStr::from_ptr(buffer.as_ptr()) }
                .to_string_lossy()
                .into_owned()
        })
}
fn dict(v: Cf, key: &CStr) -> Cf {
    if v.is_null() {
        return ptr::null();
    }
    let key = cf_string(key);
    unsafe { CFDictionaryGetValue(v, key.0) }
}
fn temperatures() -> Vec<Value> {
    unsafe {
        let client = OwnedCf(IOHIDEventSystemClientCreate(ptr::null()));
        if client.0.is_null() {
            return vec![];
        }
        let xml=b"<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>PrimaryUsagePage</key><integer>65280</integer><key>PrimaryUsage</key><integer>5</integer></dict></plist>";
        let data = OwnedCf(CFDataCreate(ptr::null(), xml.as_ptr(), xml.len() as isize));
        let matching = OwnedCf(CFPropertyListCreateWithData(
            ptr::null(),
            data.0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        ));
        if matching.0.is_null() {
            return vec![];
        }
        IOHIDEventSystemClientSetMatching(client.0, matching.0);
        let services = OwnedCf(IOHIDEventSystemClientCopyServices(client.0));
        if services.0.is_null() {
            return vec![];
        }
        let key = cf_string(c"Product");
        let mut out = vec![];
        for i in 0..CFArrayGetCount(services.0) {
            let service = CFArrayGetValueAtIndex(services.0, i);
            if service.is_null() {
                continue;
            }
            let name = OwnedCf(IOHIDServiceClientCopyProperty(service, key.0));
            let Some(name) = string(name.0) else {
                continue;
            };
            if !name.starts_with("pACC MTR Temp Sensor")
                && !name.starts_with("eACC MTR Temp Sensor")
            {
                continue;
            }
            let event = OwnedCf(IOHIDServiceClientCopyEvent(service, 15, 0, 0));
            if event.0.is_null() {
                continue;
            }
            let value = IOHIDEventGetFloatValue(event.0, 15 << 16);
            if value.is_finite() && value > 0.0 && value <= 150.0 {
                out.push(json!({"name":name,"celsius":value,"source":"IOHID temperature event"}));
            }
        }
        out
    }
}
type CopyChannels = unsafe extern "C" fn(Cf, Cf, u64, u64, u64) -> Cf;
type Subscribe = unsafe extern "C" fn(Cf, Cf, *mut Cf, u64, Cf) -> Cf;
type ReadSample = unsafe extern "C" fn(Cf, Cf, Cf) -> Cf;
type Delta = unsafe extern "C" fn(Cf, Cf, Cf) -> Cf;
type Count = unsafe extern "C" fn(Cf) -> i32;
type StateName = unsafe extern "C" fn(Cf, i32) -> Cf;
type Residency = unsafe extern "C" fn(Cf, i32) -> i64;
type ChannelName = unsafe extern "C" fn(Cf) -> Cf;
struct Api {
    library: *mut c_void,
    copy: CopyChannels,
    subscribe: Subscribe,
    read: ReadSample,
    delta: Delta,
    count: Count,
    state_name: StateName,
    residency: Residency,
    channel_name: ChannelName,
}
impl Api {
    unsafe fn new() -> Option<Self> {
        let library = libc::dlopen(
            c"/usr/lib/libIOReport.dylib".as_ptr(),
            libc::RTLD_LAZY | libc::RTLD_LOCAL,
        );
        if library.is_null() {
            return None;
        }
        macro_rules! symbol {
            ($name:literal,$typ:ty) => {{
                let p = libc::dlsym(library, concat!($name, "\0").as_ptr().cast());
                if p.is_null() {
                    libc::dlclose(library);
                    return None;
                }
                mem::transmute::<*mut c_void, $typ>(p)
            }};
        }
        Some(Self {
            library,
            copy: symbol!("IOReportCopyChannelsInGroup", CopyChannels),
            subscribe: symbol!("IOReportCreateSubscription", Subscribe),
            read: symbol!("IOReportCreateSamples", ReadSample),
            delta: symbol!("IOReportCreateSamplesDelta", Delta),
            count: symbol!("IOReportStateGetCount", Count),
            state_name: symbol!("IOReportStateGetNameForIndex", StateName),
            residency: symbol!("IOReportStateGetResidency", Residency),
            channel_name: symbol!("IOReportChannelGetChannelName", ChannelName),
        })
    }
}
impl Drop for Api {
    fn drop(&mut self) {
        unsafe {
            libc::dlclose(self.library);
        }
    }
}
struct Frequency {
    channels: OwnedCf,
    subscription: OwnedCf,
    previous: Option<(OwnedCf, Instant)>,
    efficiency: Vec<u32>,
    performance: Vec<u32>,
    api: Api,
}
// All IOReport/CF objects are only accessed while the single sampler mutex is held.
unsafe impl Send for Frequency {}
fn table(entry: u32, key: &CStr) -> Option<Vec<u32>> {
    let key = cf_string(key);
    let data = OwnedCf(unsafe { IORegistryEntryCreateCFProperty(entry, key.0, ptr::null(), 0) });
    if data.0.is_null() || unsafe { CFGetTypeID(data.0) != CFDataGetTypeID() } {
        return None;
    }
    let length = unsafe { CFDataGetLength(data.0) };
    if !(8..=1024).contains(&length) || length % 8 != 0 {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(CFDataGetBytePtr(data.0), length as usize) };
    let values: Vec<_> = bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(b[..4].try_into().unwrap()) / 1_000_000)
        .collect();
    (values.iter().all(|x| (100..=6000).contains(x)) && values.windows(2).all(|w| w[1] >= w[0]))
        .then_some(values)
}
impl Frequency {
    fn new() -> Option<Self> {
        let chip = sysctl_text(c"machdep.cpu.brand_string")?;
        // Known Hz-based DVFS table layout on M1–M3. Unknown chips are unavailable,
        // rather than presenting a maximum/static clock as the current frequency.
        if !["M1", "M2", "M3"].iter().any(|name| chip.contains(name)) {
            return None;
        }
        let mut iterator = 0;
        if unsafe {
            IOServiceGetMatchingServices(
                0,
                IOServiceMatching(c"AppleARMIODevice".as_ptr()),
                &mut iterator,
            )
        } != 0
        {
            return None;
        }
        let iterator = Io(iterator);
        let mut tables = None;
        loop {
            let entry = Io(unsafe { IOIteratorNext(iterator.0) });
            if entry.0 == 0 {
                break;
            }
            let mut name = [0i8; 128];
            if unsafe { IORegistryEntryGetName(entry.0, name.as_mut_ptr()) } == 0
                && unsafe { CStr::from_ptr(name.as_ptr()) } == c"pmgr"
            {
                tables = table(entry.0, c"voltage-states1-sram")
                    .zip(table(entry.0, c"voltage-states5-sram"));
                break;
            }
        }
        let (efficiency, performance) = tables?;
        unsafe {
            let api = Api::new()?;
            let group = cf_string(c"CPU Stats");
            let subgroup = cf_string(c"CPU Core Performance States");
            let original = OwnedCf((api.copy)(group.0, subgroup.0, 0, 0, 0));
            if original.0.is_null() {
                return None;
            }
            let channels = OwnedCf(CFDictionaryCreateMutableCopy(ptr::null(), 0, original.0));
            if channels.0.is_null() {
                return None;
            }
            let mut subscribed = ptr::null();
            let subscription = OwnedCf((api.subscribe)(
                ptr::null(),
                channels.0,
                &mut subscribed,
                0,
                ptr::null(),
            ));
            let subscribed = OwnedCf(subscribed);
            if subscription.0.is_null() {
                return None;
            }
            let channels = if subscribed.0.is_null() {
                channels
            } else {
                subscribed
            };
            Some(Self {
                channels,
                subscription,
                previous: None,
                efficiency,
                performance,
                api,
            })
        }
    }
    fn sample(&mut self) -> Vec<Value> {
        let now = Instant::now();
        let current =
            OwnedCf(unsafe { (self.api.read)(self.subscription.0, self.channels.0, ptr::null()) });
        if current.0.is_null() {
            return vec![];
        }
        let previous = self.previous.replace((current, now));
        let Some((previous, time)) = previous else {
            return vec![];
        };
        let elapsed = now.duration_since(time).as_millis();
        if elapsed == 0 || elapsed > 10_000 {
            return vec![];
        }
        let current = &self.previous.as_ref().unwrap().0;
        let delta = OwnedCf(unsafe { (self.api.delta)(previous.0, current.0, ptr::null()) });
        if delta.0.is_null() {
            return vec![];
        }
        let channels = dict(delta.0, c"IOReportChannels");
        if channels.is_null() || unsafe { CFGetTypeID(channels) != CFArrayGetTypeID() } {
            return vec![];
        }
        let mut out = vec![];
        for i in 0..unsafe { CFArrayGetCount(channels) } {
            let channel = unsafe { CFArrayGetValueAtIndex(channels, i) };
            let Some(name) = string(unsafe { (self.api.channel_name)(channel) }) else {
                continue;
            };
            let (cluster, table) = if name.starts_with("ECPU") {
                ("Efficiency", &self.efficiency)
            } else if name.starts_with("PCPU") {
                ("Performance", &self.performance)
            } else {
                continue;
            };
            let count = unsafe { (self.api.count)(channel) };
            if !(1..=128).contains(&count) {
                continue;
            }
            let mut active = vec![];
            let mut raw = vec![];
            for state in 0..count {
                let label =
                    string(unsafe { (self.api.state_name)(channel, state) }).unwrap_or_default();
                let residency = unsafe { (self.api.residency)(channel, state) };
                raw.push(json!({"state":label,"residency":residency.to_string()}));
                if !["IDLE", "DOWN", "OFF"].contains(&label.as_str()) {
                    active.push(residency);
                }
            }
            if let Some(frequency) = weighted_frequency(&active, table) {
                out.push(json!({"channel":name,"cluster":cluster,"mhz":frequency,"intervalMs":elapsed.to_string(),"states":raw,"frequencyTableMHz":table}));
            }
        }
        out
    }
}
fn weighted_frequency(residencies: &[i64], table: &[u32]) -> Option<f64> {
    if residencies.len() != table.len() || residencies.iter().any(|r| *r < 0) {
        return None;
    }
    let total: u128 = residencies.iter().map(|r| *r as u128).sum();
    if total == 0 {
        return None;
    }
    Some(
        residencies
            .iter()
            .zip(table)
            .map(|(r, f)| *r as f64 / total as f64 * *f as f64)
            .sum(),
    )
}
pub fn sample() -> Value {
    static FREQUENCY: OnceLock<Mutex<Option<Frequency>>> = OnceLock::new();
    let frequencies = FREQUENCY
        .get_or_init(|| Mutex::new(Frequency::new()))
        .lock()
        .ok()
        .and_then(|mut f| f.as_mut().map(Frequency::sample))
        .unwrap_or_default();
    let temperatures = temperatures();
    let mean = (!temperatures.is_empty()).then(|| {
        temperatures
            .iter()
            .filter_map(|s| s["celsius"].as_f64())
            .sum::<f64>()
            / temperatures.len() as f64
    });
    json!({"temperatureCelsius":mean,"temperatureSensors":temperatures,"frequencies":frequencies,"frequencyScope":"Active-residency weighted MHz for the last sampling interval, per reported E/P channel; not an instantaneous or maximum clock","temperatureScope":"Arithmetic mean of available eACC/pACC CPU thermal-zone sensors; not per-core temperatures"})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frequency_never_fills_idle_or_mismatched_state_tables_with_a_guessed_clock() {
        assert_eq!(weighted_frequency(&[1, 3], &[1000, 2000]), Some(1750.0));
        assert_eq!(weighted_frequency(&[0, 0], &[1000, 2000]), None);
        assert_eq!(weighted_frequency(&[-1, 2], &[1000, 2000]), None);
        assert_eq!(weighted_frequency(&[1], &[1000, 2000]), None);
    }
    #[test]
    fn live_cpu_telemetry_is_read_only_and_preserves_sensor_names() {
        let _ = sample();
        std::thread::sleep(std::time::Duration::from_millis(150));
        let sample = sample();
        println!("CPU telemetry: {sample}");
        assert!(sample["frequencies"].is_array());
        if let Some(t) = sample["temperatureCelsius"].as_f64() {
            assert!(t > 0.0 && t <= 150.0);
        }
    }
}
