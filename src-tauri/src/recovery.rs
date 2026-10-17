//! Evidence-led recovery checks. Alternative routes are tried before block access is rejected.
use crate::model::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub device: Option<Device>,
    pub observation: Option<UnavailableMedia>,
    pub port: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub direct_scsi: bool,
    pub reconnect_usb: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub code: String,
    pub title: String,
    pub detail: String,
    pub scope: String,
    pub evidence: Box<Value>,
}
impl Issue {
    pub fn new(
        code: &str,
        title: &str,
        detail: impl Into<String>,
        scope: &str,
        evidence: Value,
    ) -> Self {
        Self {
            code: code.into(),
            title: title.into(),
            detail: detail.into(),
            scope: scope.into(),
            evidence: Box::new(evidence),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub key: String,
    pub label: String,
    pub state: String,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub detail: String,
    pub evidence: Value,
    pub issue: Option<Issue>,
    pub command_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub target: Target,
    pub options: Options,
    pub state: String,
    pub started_at: u64,
    pub updated_at: u64,
    pub steps: Vec<Step>,
    pub issue: Option<Issue>,
    pub source: Option<Device>,
}
#[derive(Default)]
pub struct Manager {
    pub active: AtomicBool,
    pub cancel: AtomicBool,
    targets: Mutex<HashMap<String, Target>>,
    records: Mutex<Vec<String>>,
}
impl Manager {
    pub fn begin(&self) -> Result<(), String> {
        self.records.lock().map_err(|e| e.to_string())?.clear();
        self.cancel.store(false, Ordering::SeqCst);
        self.active.store(true, Ordering::SeqCst);
        Ok(())
    }
    pub fn record_id(&self, id: &str) {
        if self.is_active() {
            if let Ok(mut ids) = self.records.lock() {
                ids.push(id.into());
            }
        }
    }
    pub fn command_ids(&self) -> Vec<String> {
        self.records.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub fn targets(&self, values: Vec<Target>) -> Result<Vec<Target>, String> {
        *self.targets.lock().map_err(|e| e.to_string())? =
            values.iter().map(|t| (t.key.clone(), t.clone())).collect();
        Ok(values)
    }
    pub fn target(&self, key: &str) -> Result<Target, String> {
        self.targets
            .lock()
            .map_err(|e| e.to_string())?
            .get(key)
            .cloned()
            .ok_or(
                "Recovery target expired. Open Recovery again to select a current target.".into(),
            )
    }
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
}
pub fn new_run(target: Target, options: Options) -> Run {
    Run {
        id: unique_id("recovery"),
        target,
        options,
        state: "running".into(),
        started_at: now_ms(),
        updated_at: now_ms(),
        steps: [
            ("detection", "Refresh host observations"),
            ("usb", "Test live USB response"),
            ("scsi", "Try direct USB / SCSI access"),
            ("reconnect", "Retry the connection"),
            ("address", "Resolve a disk source"),
            ("tools", "Check imaging tools"),
            ("access", "Open source read-only"),
            ("sample", "Read a small sample"),
        ]
        .into_iter()
        .map(|(key, label)| Step {
            key: key.into(),
            label: label.into(),
            state: "pending".into(),
            started_at: None,
            finished_at: None,
            detail: String::new(),
            evidence: Value::Null,
            issue: None,
            command_ids: vec![],
        })
        .collect(),
        issue: None,
        source: None,
    }
}
#[derive(Clone, Debug)]
pub enum Resolved {
    Disk(Box<Device>),
    Observation(Box<UnavailableMedia>),
    Missing,
}
fn registry_id(v: &Value) -> Option<String> {
    string_field(v, "IORegistryEntryID")
}
fn usb_equal(a: &Value, b: &Value) -> bool {
    ["idVendor", "idProduct", "USB Serial Number"]
        .into_iter()
        .all(|k| a.get(k) == b.get(k))
}
fn flatten_registry<'a>(v: &'a Value, out: &mut Vec<&'a Value>, depth: usize) {
    if depth > 64 {
        return;
    }
    if let Some(a) = v.as_array() {
        for c in a {
            flatten_registry(c, out, depth + 1)
        }
    } else if v.is_object() {
        out.push(v);
        flatten_registry(&v["IORegistryEntryChildren"], out, depth + 1)
    }
}
/// A model name, port number or BSD number alone never rebinds a selected disk.
pub fn resolve(target: &Target, inventory: &Discovery, after_reconnect: bool) -> Resolved {
    if let Some(original) = &target.device {
        return inventory
            .devices
            .iter()
            .find(|d| d.id == original.id && d.identity_key == original.identity_key)
            .cloned()
            .map(|d| Resolved::Disk(Box::new(d)))
            .unwrap_or(Resolved::Missing);
    }
    let Some(original) = &target.observation else {
        return Resolved::Missing;
    };
    let original_usb = &original.fields["usb"];
    if let Some(current) = inventory
        .unavailable_media
        .iter()
        .find(|m| m.id == original.id && usb_equal(original_usb, &m.fields["usb"]))
    {
        return Resolved::Observation(Box::new(current.clone()));
    }
    let mut usb_entries = vec![];
    flatten_registry(
        &inventory.enumeration["DRCHostMetadata"]["usbServices"],
        &mut usb_entries,
        0,
    );
    let candidates: Vec<_> = usb_entries
        .into_iter()
        .filter(|u| {
            let is_usb = u["IOObjectClass"] == "IOUSBHostDevice";
            let same_id = registry_id(u).is_some() && registry_id(u) == registry_id(original_usb);
            let serial =
                string_field(original_usb, "USB Serial Number").is_some_and(|s| !s.is_empty());
            is_usb && usb_equal(original_usb, u) && (same_id || (after_reconnect && serial))
        })
        .collect();
    if candidates.len() != 1 {
        return Resolved::Missing;
    }
    let usb = candidates[0];
    // Rebinding after a requested reconnect still requires one matching USB serial descriptor.
    let mut branch = vec![];
    flatten_registry(usb, &mut branch, 0);
    let original_media = registry_id(&original.fields["media"]);
    let media: Vec<_> = branch
        .iter()
        .filter(|m| {
            m["IOObjectClass"] == "IOMedia"
                && m["Whole"] == true
                && (after_reconnect || original_media.is_none() || registry_id(m) == original_media)
        })
        .collect();
    if let Some(id) = media
        .first()
        .filter(|_| media.len() == 1)
        .and_then(|m| string_field(m, "BSD Name"))
    {
        if let Some(d) = inventory.devices.iter().find(|d| {
            d.id == id
                && original
                    .size_bytes
                    .as_ref()
                    .is_none_or(|s| Some(s) == d.size_bytes.as_ref())
        }) {
            return Resolved::Disk(Box::new(d.clone()));
        }
    }
    // New registry identifiers are accepted only following an explicit reconnect and an
    // unambiguous serial/vendor/product match, never an unrelated new USB device.
    if after_reconnect {
        let candidates: Vec<_> = inventory
            .unavailable_media
            .iter()
            .filter(|m| {
                usb_equal(original_usb, &m.fields["usb"])
                    && registry_id(&m.fields["usb"]) == registry_id(usb)
            })
            .collect();
        if candidates.len() == 1 {
            return Resolved::Observation(Box::new(candidates[0].clone()));
        }
    }
    Resolved::Missing
}

pub trait Host {
    fn discover(&mut self) -> Result<Discovery, Issue>;
    fn usb(&mut self, observation: &UnavailableMedia) -> Result<Value, Issue>;
    fn scsi(&mut self, observation: &UnavailableMedia) -> Result<Value, Issue>;
    fn reconnect(&mut self, target: &Target, current: &Resolved) -> Result<Value, Issue>;
    fn tools(&mut self) -> Result<Value, Issue>;
    fn access(&mut self, device: &Device) -> Result<Value, Issue>;
    fn sample(&mut self, device: &Device) -> Result<Value, Issue>;
    fn command_ids(&self) -> Vec<String>;
}
fn cancelled() -> Issue {
    Issue::new(
        "CANCELLED",
        "Stopped by the user",
        "No subsequent check was started after the cancellation request.",
        "user-request",
        Value::Null,
    )
}
fn route_result(result: Result<Value, Issue>) -> Result<(), Issue> {
    match result {
        Err(e)
            if matches!(
                e.code.as_str(),
                "REPORT_SAVE_FAILED" | "CANCELLED" | "PROCESS_CAPTURE_FAILED"
            ) =>
        {
            Err(e)
        }
        _ => Ok(()),
    }
}
fn checkpoint(
    run: &mut Run,
    sink: &mut dyn FnMut(&Run) -> Result<(), String>,
) -> Result<(), Issue> {
    run.updated_at = now_ms();
    sink(run).map_err(|e| {
        Issue::new(
            "REPORT_SAVE_FAILED",
            "Cannot save the recovery report",
            e,
            "application-storage",
            Value::Null,
        )
    })
}
fn checked(
    run: &mut Run,
    index: usize,
    host: &mut dyn Host,
    cancel: &AtomicBool,
    sink: &mut dyn FnMut(&Run) -> Result<(), String>,
    action: impl FnOnce(&mut dyn Host) -> Result<Value, Issue>,
) -> Result<Value, Issue> {
    if cancel.load(Ordering::SeqCst) {
        return Err(cancelled());
    }
    run.steps[index].state = "running".into();
    run.steps[index].started_at = Some(now_ms());
    checkpoint(run, sink)?;
    let before = host.command_ids().len();
    let mut result = action(host);
    if cancel.load(Ordering::SeqCst) {
        result = Err(cancelled());
    }
    let step = &mut run.steps[index];
    step.finished_at = Some(now_ms());
    step.command_ids = host.command_ids().into_iter().skip(before).collect();
    match &result {
        Ok(evidence) => {
            step.state = "passed".into();
            step.evidence = evidence.clone();
            step.detail = evidence["summary"]
                .as_str()
                .unwrap_or("Check completed. See the observed result and original commands.")
                .into();
        }
        Err(issue) => {
            step.state = "failed".into();
            step.detail = issue.detail.clone();
            step.evidence = (*issue.evidence).clone();
            step.issue = Some(issue.clone());
        }
    }
    checkpoint(run, sink)?;
    result
}
fn skip(
    run: &mut Run,
    i: usize,
    why: &str,
    sink: &mut dyn FnMut(&Run) -> Result<(), String>,
) -> Result<(), Issue> {
    run.steps[i].state = "skipped".into();
    run.steps[i].detail = why.into();
    checkpoint(run, sink)
}
fn run_checks(
    run: &mut Run,
    host: &mut dyn Host,
    cancel: &AtomicBool,
    sink: &mut dyn FnMut(&Run) -> Result<(), String>,
) -> Result<(), Issue> {
    let mut inventory = None;
    checked(run, 0, host, cancel, sink, |h| {
        let d = h.discover()?;
        let v = json!({"platform":d.platform,"observedAt":d.observed_at,"physicalDisks":d.devices.iter().map(|d|d.id.clone()).collect::<Vec<_>>(),"unavailableMedia":d.unavailable_media,"warnings":d.warnings});
        inventory = Some(d);
        Ok(v)
    })?;
    // The device can re-enumerate between selection and this first snapshot.
    // An explicitly enabled connection retry permits a unique serial/vendor/product
    // rebind here too; subsequent requests still use the fresh registry entry.
    let mut resolved = resolve(
        &run.target,
        inventory.as_ref().unwrap(),
        run.options.reconnect_usb,
    );
    if let Resolved::Observation(o) = &resolved {
        if o.size_bytes.as_deref() == Some("494206451712")
            || string_field(&o.fields["usb"], "USB Product Name")
                .is_some_and(|s| s.to_lowercase().contains("sandisk"))
        {
            return Err(Issue::new("METADATA_ONLY_SOURCE","This medium is protected","The personal flash remains metadata-only; direct access and connection changes were not attempted.","application-policy",Value::Null));
        }
        let o = o.clone();
        let result = checked(run, 1, host, cancel, sink, |h| h.usb(&o));
        if cancel.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        route_result(result)?;
        if run.options.direct_scsi {
            let result = checked(run, 2, host, cancel, sink, |h| h.scsi(&o));
            if cancel.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            route_result(result)?;
        } else {
            skip(
                run,
                2,
                "Direct USB / SCSI access is off. It may quiesce the OS storage driver.",
                sink,
            )?;
        }
    } else {
        skip(
            run,
            1,
            if matches!(resolved, Resolved::Disk(_)) {
                "The OS already publishes a disk; avoid additional USB requests."
            } else {
                "No matching current USB device is published. A stale registry ID is not used."
            },
            sink,
        )?;
        skip(
            run,
            2,
            "No current unaddressed USB storage target for direct USB / SCSI access.",
            sink,
        )?;
    }
    if run.options.reconnect_usb && !matches!(resolved, Resolved::Disk(_)) {
        let target = run.target.clone();
        let current = resolved.clone();
        let mut post = None;
        let result = checked(run, 3, host, cancel, sink, |h| {
            let attempt = h.reconnect(&target, &current);
            if let Err(e) = &attempt {
                if matches!(
                    e.code.as_str(),
                    "REPORT_SAVE_FAILED" | "CANCELLED" | "PROCESS_CAPTURE_FAILED"
                ) {
                    return Err(e.clone());
                }
            }
            let accepted = attempt.is_ok();
            let mut snapshots = vec![];
            for i in 0..if accepted { 10 } else { 1 } {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                if i > 0 {
                    for _ in 0..20 {
                        if cancel.load(Ordering::SeqCst) {
                            return Err(cancelled());
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
                let next = h.discover()?;
                let r = resolve(&target, &next, accepted);
                snapshots.push(json!({"attempt":i+1,"observedAt":next.observed_at,"physicalDiskIds":next.devices.iter().map(|d|d.id.clone()).collect::<Vec<_>>(),"unavailableMedia":next.unavailable_media,"warnings":next.warnings}));
                // A USB/media object can reappear before its BSD source is ready.
                // Preserve every observation and use the remaining bounded retries.
                let found = matches!(r, Resolved::Disk(_));
                post = Some(r);
                if found {
                    break;
                }
            }
            match attempt {
                Ok(v) => {
                    let summary = match post.as_ref() {
                        Some(Resolved::Disk(d)) => format!("The host accepted the request and now publishes disk {}. Source checks follow.", d.id),
                        Some(Resolved::Observation(o)) => format!("The host accepted the request. The same USB target returned with stage '{}', but no usable disk source appeared during {} observations.", o.stage, snapshots.len()),
                        _ => format!("The host accepted the request, but the selected target was not published during {} subsequent observations.", snapshots.len()),
                    };
                    Ok(json!({"summary":summary,"apiResult":v,"postRetryObservations":snapshots}))
                }
                Err(mut e) => {
                    let original = (*e.evidence).clone();
                    e.evidence =
                        Box::new(json!({"apiResult":original,"postRetryObservations":snapshots}));
                    Err(e)
                }
            }
        });
        route_result(result)?;
        if cancel.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        if let Some(next) = post {
            resolved = next;
        }
    } else {
        skip(
            run,
            3,
            if matches!(resolved, Resolved::Disk(_)) {
                "A disk is already listed; no reconnect is necessary."
            } else {
                "Connection-changing actions are off."
            },
            sink,
        )?;
    }
    let current = resolved.clone();
    let mut source = None;
    let target_key = run.target.key.clone();
    let host_port = run.target.port.clone();
    let connection_issue = run.steps[3].issue.clone();
    checked(run, 4, host, cancel, sink, |_| {
        match current {
        Resolved::Disk(d)=>{crate::policy::require_acquisition(&d,&d.info).map_err(|e|Issue::new("SOURCE_POLICY_BLOCKED","The selected source is excluded by policy",e,"source-precondition",json!({"deviceId":d.id})))?;let value=json!({"deviceId":d.id,"sizeBytes":d.size_bytes,"identityKey":d.identity_key});source=Some(*d);Ok(value)},
        Resolved::Observation(o)=>Err(Issue::new("BLOCK_SOURCE_UNAVAILABLE","No usable disk source after the attempted routes",format!("The host reports {} with stage '{}', but no matching physical disk is currently listed. The imaging adapter cannot open a /dev source. The hardware cause has not been established.",o.name,o.stage),"host-enumeration",json!({"observation":o}))),
        Resolved::Missing if host_port.is_some()=>Err(Issue::new("HOST_PORT_SOURCE_UNAVAILABLE","No imaging source from the host-port attempt",format!("No verified storage source was established for this host-port selection. {} Select a current storage observation or physical disk when it appears; the port alone does not identify a disk.",connection_issue.as_ref().map(|e|e.detail.as_str()).unwrap_or("The connection probe was not enabled.")),"host-enumeration",json!({"selectedTarget":target_key,"hostPort":host_port,"connectionIssue":connection_issue}))),
        Resolved::Missing=>Err(Issue::new("TARGET_NOT_PUBLISHED","The selected target is not currently published","No matching storage object or physical disk was found after the selected attempts. A connected cable or powered enclosure cannot be addressed as a disk until a host access route is available. No hardware cause is inferred.","host-enumeration",json!({"selectedTarget":target_key}))),
    }
    })?;
    let source = source.unwrap();
    checked(run, 5, host, cancel, sink, |h| h.tools())?;
    checked(run, 6, host, cancel, sink, |h| h.access(&source))?;
    checked(run, 7, host, cancel, sink, |h| h.sample(&source))?;
    run.source = Some(source);
    Ok(())
}
pub fn execute(
    mut run: Run,
    host: &mut dyn Host,
    cancel: &AtomicBool,
    sink: &mut dyn FnMut(&Run) -> Result<(), String>,
) -> Run {
    match run_checks(&mut run, host, cancel, sink) {
        Ok(()) => run.state = "ready".into(),
        Err(issue) => {
            run.state = if issue.code == "CANCELLED" {
                "cancelled"
            } else {
                "stopped"
            }
            .into();
            run.issue = Some(issue);
        }
    }
    for step in &mut run.steps {
        if step.state == "running" && run.state != "running" {
            step.state = "failed".into();
            step.finished_at = Some(now_ms());
            step.issue = run.issue.clone();
        }
        if step.state == "pending" {
            step.state = "not-run".into();
            step.detail = "A prerequisite stopped the workflow.".into();
        }
    }
    if let Err(issue) = checkpoint(&mut run, sink) {
        run.state = "stopped".into();
        run.issue = Some(issue);
        let _ = sink(&run);
    }
    run
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    fn device(uuid: &str) -> Device {
        let info = json!({"DeviceIdentifier":"disk9","DiskUUID":uuid,"MediaName":"Fixture SSD","TotalSize":"256060514304","DeviceBlockSize":"512","WholeDisk":true,"Internal":false});
        Device {
            id: "disk9".into(),
            token: format!("fixture:{uuid}"),
            identity_key: crate::platform::identity_key(&info),
            name: "Fixture SSD".into(),
            size_bytes: Some("256060514304".into()),
            internal: Some(false),
            protocol: Some("USB".into()),
            content: None,
            partitions: vec![],
            info,
            layout: Value::Null,
            info_error: None,
            observed_at: 1,
            metadata_only: false,
            protection_reason: None,
        }
    }
    fn observation() -> UnavailableMedia {
        UnavailableMedia {
            id: "observed:102".into(),
            name: "Fixture SSD".into(),
            stage: "media-unassigned".into(),
            size_bytes: Some("256060514304".into()),
            bsd_name: None,
            transport: Some("USB".into()),
            observed_at: 1,
            fields: json!({"usb":{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"100","idVendor":"1","idProduct":"2","USB Serial Number":"fixture-serial"},"media":{"IORegistryEntryID":"102"}}),
        }
    }
    fn target(o: UnavailableMedia) -> Target {
        Target {
            key: o.id.clone(),
            name: o.name.clone(),
            kind: "observation".into(),
            device: None,
            observation: Some(o),
            port: None,
        }
    }
    fn inventory(devices: Vec<Device>, observations: Vec<UnavailableMedia>) -> Discovery {
        Discovery {
            devices,
            unavailable_media: observations,
            observed_at: 1,
            platform: "fixture".into(),
            enumeration: Value::Null,
            warnings: vec![],
        }
    }
    fn promoted() -> Discovery {
        let mut d = inventory(vec![device("same")], vec![]);
        d.enumeration = json!({"DRCHostMetadata":{"usbServices":[{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"200","idVendor":"1","idProduct":"2","USB Serial Number":"fixture-serial","IORegistryEntryChildren":[{"IOObjectClass":"IOMedia","IORegistryEntryID":"202","Whole":true,"BSD Name":"disk9"}]}]}});
        d
    }
    struct Mock<'a> {
        snapshots: VecDeque<Discovery>,
        calls: Vec<&'static str>,
        cancel_on_usb: Option<&'a AtomicBool>,
        deny_access: bool,
    }
    impl Host for Mock<'_> {
        fn discover(&mut self) -> Result<Discovery, Issue> {
            self.calls.push("discover");
            Ok(self.snapshots.pop_front().unwrap())
        }
        fn usb(&mut self, _: &UnavailableMedia) -> Result<Value, Issue> {
            self.calls.push("usb");
            if let Some(c) = self.cancel_on_usb {
                c.store(true, Ordering::SeqCst);
            }
            Err(Issue::new(
                "ACCESS_ROUTE_REJECTED",
                "USB request rejected",
                "Original host API result",
                "host-api",
                json!({"ioReturn":"0xe00002c7"}),
            ))
        }
        fn scsi(&mut self, _: &UnavailableMedia) -> Result<Value, Issue> {
            self.calls.push("scsi");
            Err(Issue::new(
                "ACCESS_ROUTE_REJECTED",
                "SCSI interface unavailable",
                "Original host API result",
                "host-api",
                json!({"ioReturn":"0xe00002c7"}),
            ))
        }
        fn reconnect(&mut self, _: &Target, _: &Resolved) -> Result<Value, Issue> {
            self.calls.push("reconnect");
            Ok(json!({"requestAccepted":true}))
        }
        fn tools(&mut self) -> Result<Value, Issue> {
            self.calls.push("tools");
            Ok(Value::Null)
        }
        fn access(&mut self, _: &Device) -> Result<Value, Issue> {
            self.calls.push("access");
            if self.deny_access {
                Err(Issue::new(
                    "SOURCE_ACCESS_REFUSED",
                    "Read-only open refused",
                    "Permission denied (os error 13)",
                    "source-precondition",
                    json!({"errno":13}),
                ))
            } else {
                Ok(Value::Null)
            }
        }
        fn sample(&mut self, _: &Device) -> Result<Value, Issue> {
            self.calls.push("sample");
            Ok(json!({"readBytes":"65536"}))
        }
        fn command_ids(&self) -> Vec<String> {
            self.calls.iter().map(|s| s.to_string()).collect()
        }
    }
    fn mock(d: Vec<Discovery>) -> Mock<'static> {
        Mock {
            snapshots: d.into(),
            calls: vec![],
            cancel_on_usb: None,
            deny_access: false,
        }
    }
    #[test]
    fn unavailable_media_try_a_route_then_stop_with_evidence_without_opening_a_disk() {
        let o = observation();
        let mut h = mock(vec![inventory(vec![], vec![o.clone()])]);
        let c = AtomicBool::new(false);
        let mut events = vec![];
        let r = execute(
            new_run(target(o), Options::default()),
            &mut h,
            &c,
            &mut |r| {
                events.push(r.clone());
                Ok(())
            },
        );
        assert_eq!(r.issue.as_ref().unwrap().code, "BLOCK_SOURCE_UNAVAILABLE");
        assert_eq!(r.steps[1].state, "failed");
        assert_eq!(r.steps[4].state, "failed");
        assert_eq!(r.steps[7].state, "not-run");
        assert_eq!(h.calls, ["discover", "usb"]);
        assert!(events.iter().any(|e| e.steps[1].state == "running"));
        assert!(r.source.is_none());
    }
    #[test]
    fn rejected_routes_do_not_prevent_a_successful_explicit_reconnect_and_bounded_read() {
        let o = observation();
        let mut h = mock(vec![inventory(vec![], vec![o.clone()]), promoted()]);
        let c = AtomicBool::new(false);
        let r = execute(
            new_run(
                target(o),
                Options {
                    direct_scsi: true,
                    reconnect_usb: true,
                },
            ),
            &mut h,
            &c,
            &mut |_| Ok(()),
        );
        assert_eq!(r.state, "ready");
        assert_eq!(r.steps[1].state, "failed");
        assert_eq!(r.steps[2].state, "failed");
        assert_eq!(r.steps[7].evidence["readBytes"], "65536");
        assert!(r.source.is_some());
        assert_eq!(
            h.calls,
            [
                "discover",
                "usb",
                "scsi",
                "reconnect",
                "discover",
                "tools",
                "access",
                "sample"
            ]
        );
    }
    #[test]
    fn reconnect_waits_for_disk_after_usb_media_reappears() {
        let o = observation();
        let mut returned = o.clone();
        returned.id = "observed:200".into();
        returned.fields["usb"]["IORegistryEntryID"] = json!("200");
        returned.fields["media"]["IORegistryEntryID"] = json!("202");
        let mut first = inventory(vec![], vec![returned.clone()]);
        first.enumeration = promoted().enumeration;
        let mut h = mock(vec![first.clone(), first, promoted()]);
        let r = execute(
            new_run(
                target(o),
                Options {
                    direct_scsi: false,
                    reconnect_usb: true,
                },
            ),
            &mut h,
            &AtomicBool::new(false),
            &mut |_| Ok(()),
        );
        assert_eq!(r.state, "ready");
        assert!(h.calls.contains(&"usb"));
        assert!(h.calls.contains(&"reconnect"));
        assert_eq!(
            r.steps[3].evidence["postRetryObservations"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(h.calls.iter().filter(|c| **c == "discover").count(), 3);
    }
    #[test]
    fn reconnected_interface_without_media_stays_visible_but_is_never_a_disk() {
        let original = observation();
        let mut current = original.clone();
        current.id = "observed:200".into();
        current.stage = "interface-only".into();
        current.size_bytes = None;
        current.fields["usb"]["IORegistryEntryID"] = json!("200");
        current.fields["media"] = Value::Null;
        let mut d = inventory(vec![], vec![current]);
        d.enumeration = json!({"DRCHostMetadata":{"usbServices":[{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"200","idVendor":"1","idProduct":"2","USB Serial Number":"fixture-serial"}]}});
        assert!(matches!(
            resolve(&target(original.clone()), &d, false),
            Resolved::Missing
        ));
        let Resolved::Observation(o) = resolve(&target(original), &d, true) else {
            panic!("A matching returned USB interface must remain visible")
        };
        assert_eq!(o.stage, "interface-only");
        assert!(o.size_bytes.is_none());
    }
    #[test]
    fn a_published_host_port_without_a_pinned_disk_is_not_reported_as_a_missing_port() {
        let t = Target {
            key: "port:1".into(),
            name: "USB-C port 1".into(),
            kind: "port".into(),
            device: None,
            observation: None,
            port: Some(json!({"number":"1","entries":[]})),
        };
        let mut h = mock(vec![inventory(vec![], vec![])]);
        let r = execute(
            new_run(t, Options::default()),
            &mut h,
            &AtomicBool::new(false),
            &mut |_| Ok(()),
        );
        assert_eq!(r.issue.unwrap().code, "HOST_PORT_SOURCE_UNAVAILABLE");
        assert_eq!(h.calls, ["discover"]);
    }
    #[test]
    fn cancellation_stops_before_another_route_or_sample() {
        let o = observation();
        let c = AtomicBool::new(false);
        let mut h = Mock {
            snapshots: vec![inventory(vec![], vec![o.clone()])].into(),
            calls: vec![],
            cancel_on_usb: Some(&c),
            deny_access: false,
        };
        let r = execute(
            new_run(
                target(o),
                Options {
                    direct_scsi: true,
                    reconnect_usb: true,
                },
            ),
            &mut h,
            &c,
            &mut |_| Ok(()),
        );
        assert_eq!(r.state, "cancelled");
        assert_eq!(h.calls, ["discover", "usb"]);
    }
    #[test]
    fn persistent_evidence_failure_blocks_the_next_effect_and_has_no_running_terminal_steps() {
        let o = observation();
        let c = AtomicBool::new(false);
        let mut h = mock(vec![inventory(vec![], vec![o.clone()])]);
        let mut n = 0;
        let r = execute(
            new_run(
                target(o),
                Options {
                    direct_scsi: true,
                    reconnect_usb: true,
                },
            ),
            &mut h,
            &c,
            &mut |_| {
                n += 1;
                if n >= 3 {
                    Err("disk full".into())
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(r.issue.as_ref().unwrap().code, "REPORT_SAVE_FAILED");
        assert_eq!(h.calls, ["discover"]);
        assert!(r.steps.iter().all(|s| s.state != "running"));
    }
    #[test]
    fn changing_serial_or_reusing_a_disk_number_never_rebinds_a_source() {
        let o = observation();
        let mut changed = promoted();
        changed.enumeration["DRCHostMetadata"]["usbServices"][0]["USB Serial Number"] =
            json!("different");
        assert!(matches!(
            resolve(&target(o), &changed, true),
            Resolved::Missing
        ));
        let old = device("old");
        let t = Target {
            key: "d".into(),
            name: old.name.clone(),
            kind: "device".into(),
            device: Some(old),
            observation: None,
            port: None,
        };
        assert!(matches!(
            resolve(&t, &inventory(vec![device("new")], vec![]), false),
            Resolved::Missing
        ));
    }
    #[test]
    fn protected_personal_flash_and_system_sources_never_reach_a_read() {
        let mut o = observation();
        o.size_bytes = Some("494206451712".into());
        let mut h = mock(vec![inventory(vec![], vec![o.clone()])]);
        let c = AtomicBool::new(false);
        let r = execute(
            new_run(
                target(o),
                Options {
                    direct_scsi: true,
                    reconnect_usb: true,
                },
            ),
            &mut h,
            &c,
            &mut |_| Ok(()),
        );
        assert_eq!(r.issue.unwrap().code, "METADATA_ONLY_SOURCE");
        assert_eq!(h.calls, ["discover"]);
        let mut d = device("system");
        d.internal = Some(true);
        let mut h = mock(vec![inventory(vec![d.clone()], vec![])]);
        let t = Target {
            key: "system".into(),
            name: d.name.clone(),
            kind: "device".into(),
            device: Some(d),
            observation: None,
            port: None,
        };
        let r = execute(new_run(t, Options::default()), &mut h, &c, &mut |_| Ok(()));
        assert_eq!(r.issue.unwrap().code, "SOURCE_POLICY_BLOCKED");
        assert_eq!(h.calls, ["discover"]);
    }
    #[test]
    fn read_access_error_keeps_the_exact_os_evidence_and_does_not_become_a_controller_diagnosis() {
        let d = device("same");
        let mut h = mock(vec![inventory(vec![d.clone()], vec![])]);
        h.deny_access = true;
        let t = Target {
            key: "source".into(),
            name: d.name.clone(),
            kind: "device".into(),
            device: Some(d),
            observation: None,
            port: None,
        };
        let c = AtomicBool::new(false);
        let r = execute(new_run(t, Options::default()), &mut h, &c, &mut |_| Ok(()));
        assert_eq!(r.issue.unwrap().evidence["errno"], 13);
        assert!(!h.calls.contains(&"sample"));
        assert_eq!(r.steps[7].state, "not-run");
    }
}
