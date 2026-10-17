use crate::{
    model::*,
    recovery::{Host, Issue, Resolved, Target},
    store::Store,
    Runtime,
};
use serde_json::{json, Value};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tauri::{Emitter, Manager};

pub fn failure(
    code: &str,
    title: &str,
    detail: impl Into<String>,
    scope: &str,
    evidence: Value,
) -> Issue {
    Issue::new(code, title, detail, scope, evidence)
}
fn registry_list(v: &Value, out: &mut Vec<Value>, depth: usize) {
    if depth > 64 {
        return;
    }
    if let Some(a) = v.as_array() {
        for c in a {
            registry_list(c, out, depth + 1)
        }
    } else if v.is_object() {
        out.push(v.clone());
        registry_list(&v["IORegistryEntryChildren"], out, depth + 1);
    }
}
fn port_roots(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|v| v.get("UsbCPortNumber").is_some())
        .collect()
}
pub fn targets(app: &tauri::AppHandle) -> Result<Vec<Target>, String> {
    let mut values = vec![];
    if let Some(discovery) = crate::menu_bar::latest_discovery(app) {
        for item in discovery.unavailable_media {
            values.push(Target {
                key: format!("observation:{}", item.id),
                name: item.name.clone(),
                kind: "observation".into(),
                device: None,
                observation: Some(item),
                port: None,
            });
        }
        for device in discovery.devices {
            values.push(Target {
                key: format!("device:{}", device.token),
                name: device.name.clone(),
                kind: "device".into(),
                device: Some(device),
                observation: None,
                port: None,
            });
        }
    }
    if cfg!(target_os = "macos") {
        let record = crate::query::execute(crate::query::ReadQuery::UsbHostPorts)?;
        let fields = crate::platform::successful_plist(&record);
        crate::emit_record(app, record);
        let fields = fields?;
        let mut ports = std::collections::BTreeMap::new();
        for p in port_roots(&fields) {
            if let Some(number) = string_field(&p, "UsbCPortNumber") {
                ports.entry(number).or_insert_with(Vec::new).push(p);
            }
        }
        for (number, entries) in ports {
            values.push(Target {
                key: format!("port:{number}"),
                name: format!("USB-C port {number}"),
                kind: "port".into(),
                device: None,
                observation: None,
                port: Some(json!({"number":number,"entries":entries})),
            });
        }
    }
    app.state::<Runtime>().recovery.targets(values)
}
pub struct LiveHost {
    app: tauri::AppHandle,
    ids: Vec<String>,
    input: Option<std::fs::File>,
    _guard: Option<crate::mount_guard::MountGuard>,
    _usb_guard: Option<crate::mount_guard::UsbMountGuard>,
}
impl LiveHost {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            ids: vec![],
            input: None,
            _guard: None,
            _usb_guard: None,
        }
    }
    fn protect_usb(&mut self, o: &UnavailableMedia) -> Result<(), Issue> {
        let mut entries = vec![];
        registry_list(&o.fields["driverChain"], &mut entries, 0);
        if o.bsd_name.is_some()
            || entries
                .iter()
                .any(|v| string_field(v, "BSD Name").is_some_and(|s| !s.is_empty()))
        {
            return Err(failure("BSD_MEDIA_REQUIRES_REVIEW","An existing disk identifier requires review","The branch already contains a BSD disk identifier. Select that disk and establish an unmounted source before requesting driver-exclusive access or a reconnect.","source-precondition",Value::Null));
        }
        if self._usb_guard.is_none() {
            self._usb_guard = Some(
                crate::mount_guard::UsbMountGuard::acquire(&o.fields["usb"]).map_err(|e| {
                    failure(
                        "USB_MOUNT_PROTECTION_UNAVAILABLE",
                        "Cannot establish the operation's mount veto",
                        e,
                        "source-precondition",
                        Value::Null,
                    )
                })?,
            );
        }
        Ok(())
    }
    fn record(&mut self, record: CommandRecord) -> Result<CommandRecord, Issue> {
        self.app
            .state::<Arc<Store>>()
            .append("command", &record)
            .map_err(|e| {
                failure(
                    "REPORT_SAVE_FAILED",
                    "Cannot save command evidence",
                    e,
                    "application-storage",
                    Value::Null,
                )
            })?;
        self.ids.push(record.id.clone());
        self.app.state::<Runtime>().recovery.record_id(&record.id);
        let _ = self.app.emit("command-record", &record);
        Ok(record)
    }
    fn command(
        &mut self,
        program: String,
        args: Vec<String>,
        timeout: u64,
        input: Option<std::fs::File>,
    ) -> Result<CommandRecord, Issue> {
        let state = self.app.state::<Runtime>();
        if state.recovery.cancel.load(Ordering::SeqCst) {
            return Err(failure(
                "CANCELLED",
                "Stopped by user",
                "No new command was started.",
                "user-request",
                Value::Null,
            ));
        }
        let app = self.app.clone();
        let r=crate::query::execute_process(program,args,Duration::from_secs(timeout),input,&state.recovery.cancel,&mut ||{let _=app.emit("recovery-stopping","The command exceeded its deadline or was cancelled. Termination was requested; DRC keeps the source locked until the process exits.");})
            .map_err(|e|failure("PROCESS_CAPTURE_FAILED","Cannot capture command evidence",e,"application-process",Value::Null))?;
        self.record(r)
    }
    fn checked_record(&self, r: &CommandRecord) -> Result<(), Issue> {
        let proof = json!({"commandId":r.id,"program":r.program,"arguments":r.arguments,"exitCode":r.exit_code,"signal":r.termination_signal,"deadlineExceeded":r.timed_out,"durationMs":r.duration_ms,"stderr":r.stderr,"launchError":r.launch_error});
        if r.timed_out {
            return Err(failure("COMMAND_DEADLINE_EXCEEDED","Command exceeded its time limit","DRC requested termination after the configured deadline. This is a timeout observation, not a diagnosis of the SSD.","process-timeout",proof));
        }
        if let Some(e) = &r.launch_error {
            return Err(failure(
                "COMMAND_LAUNCH_FAILED",
                "The command could not start",
                e,
                "application-process",
                proof,
            ));
        }
        if r.exit_code != Some(0) {
            return Err(failure("COMMAND_EXIT_FAILED","The command reported failure",format!("{} exited with {:?}. See its original output and exact API or operating-system error.",r.program,r.exit_code),"tool-result",proof));
        }
        Ok(())
    }
    fn usb_args(o: &UnavailableMedia) -> Result<Vec<String>, Issue> {
        let u = &o.fields["usb"];
        let mut a = vec![];
        for k in [
            "IORegistryEntryID",
            "idVendor",
            "idProduct",
            "USB Serial Number",
        ] {
            a.push(string_field(u,k).filter(|s|!s.is_empty()).ok_or_else(||failure("USB_IDENTITY_INCOMPLETE","Cannot pin the USB target",format!("The current USB observation does not report {k}. Direct requests are not sent to an ambiguous device."),"selection",json!({"usb":u})))?);
        }
        Ok(a)
    }
    fn helper(&mut self, action: &str, mut args: Vec<String>) -> Result<Value, Issue> {
        let helper = crate::images::executable().map_err(|e| {
            failure(
                "ADAPTER_MISSING",
                "Recovery adapter is unavailable",
                e,
                "installation",
                Value::Null,
            )
        })?;
        args.insert(0, action.into());
        let r = self.command(helper, args, 25, None)?;
        if r.timed_out || r.launch_error.is_some() {
            self.checked_record(&r)?;
        }
        let mut value: Value = serde_json::from_str(&r.stdout).map_err(|e| {
            failure(
                "ADAPTER_OUTPUT_INVALID",
                "The adapter did not return a complete result",
                e.to_string(),
                "tool-result",
                json!({"commandId":r.id,"exitCode":r.exit_code}),
            )
        })?;
        value["commandId"] = json!(r.id);
        if r.exit_code != Some(0) || value["ok"] == false {
            let rows = value["results"].as_array();
            let failed = rows.and_then(|v| {
                v.iter().find(|v| {
                    v["ioReturn"] != "0x00000000"
                        || v.get("scsiStatus").is_some_and(|s| s != "0")
                        || v.get("requestedBytes")
                            .is_some_and(|n| v.get("transferredBytes") != Some(n))
                })
            });
            let detail=failed.map(|v| {
                let mut text=format!("{} returned {}: {}.",v["phase"].as_str().unwrap_or("Adapter"),v["ioReturn"].as_str().unwrap_or("not reported"),v["message"].as_str().unwrap_or("not reported"));
                for (key,label) in [("scsiStatus","SCSI status"),("senseKey","Sense key"),("asc","ASC"),("ascq","ASCQ"),("requestedBytes","Requested bytes"),("transferredBytes","Transferred bytes")] {
                    if let Some(value)=string_field(v,key) { text.push_str(&format!(" {label}: {value}.")); }
                }
                text.push_str(" This is the returned API/command result; the hardware cause is not established.");
                text
            })
                .unwrap_or_else(||format!("The adapter exited with {:?}; no complete successful access result was reported.",r.exit_code));
            return Err(failure(
                "ACCESS_ROUTE_REJECTED",
                "The access route returned an error",
                detail,
                "host-api",
                value,
            ));
        }
        Ok(value)
    }
}
impl Host for LiveHost {
    fn discover(&mut self) -> Result<Discovery, Issue> {
        let mut records = vec![];
        let result = if cfg!(target_os = "macos") {
            let state = self.app.state::<Runtime>();
            let app = self.app.clone();
            crate::platform::discover_mac(&mut |r| records.push(r), |q| {
                let (p, a) = q.command()?;
                crate::query::execute_process(
                    p,
                    a,
                    Duration::from_secs(15),
                    None,
                    &state.recovery.cancel,
                    &mut || {
                        let _=app.emit("recovery-stopping","Metadata command termination requested; waiting for the process to exit.");
                    },
                )
            })
        } else {
            crate::platform::backend().discover(&mut |r| records.push(r))
        };
        for r in records {
            self.record(r)?;
        }
        let mut result = result.map_err(|e| {
            failure(
                "DISCOVERY_FAILED",
                "Host discovery failed",
                e,
                "host-query",
                Value::Null,
            )
        })?;
        let store = self.app.state::<Arc<Store>>();
        for d in &mut result.devices {
            crate::policy::apply_protection(&store, d).map_err(|e| {
                failure(
                    "SOURCE_POLICY_UNAVAILABLE",
                    "Cannot establish source policy",
                    e,
                    "application-policy",
                    Value::Null,
                )
            })?;
        }
        store.append("snapshot", &result).map_err(|e| {
            failure(
                "REPORT_SAVE_FAILED",
                "Cannot save host observations",
                e,
                "application-storage",
                Value::Null,
            )
        })?;
        *self.app.state::<Runtime>().devices.lock().map_err(|e| {
            failure(
                "SOURCE_REGISTRY_UNAVAILABLE",
                "Cannot update source selection",
                e.to_string(),
                "application",
                Value::Null,
            )
        })? = result
            .devices
            .iter()
            .map(|d| (d.token.clone(), d.clone()))
            .collect();
        crate::menu_bar::discovered(&self.app, &result);
        Ok(result)
    }
    fn usb(&mut self, o: &UnavailableMedia) -> Result<Value, Issue> {
        if !cfg!(target_os = "macos") {
            return Err(failure(
                "ROUTE_NOT_IMPLEMENTED",
                "Direct USB request unavailable",
                "This access route currently targets macOS.",
                "platform",
                Value::Null,
            ));
        }
        self.helper("--mac-usb-status", Self::usb_args(o)?)
    }
    fn scsi(&mut self, o: &UnavailableMedia) -> Result<Value, Issue> {
        self.protect_usb(o)?;
        let a = Self::usb_args(o)?;
        let mut nodes = vec![];
        registry_list(&o.fields["driverChain"], &mut nodes, 0);
        let ids: Vec<_> = nodes
            .iter()
            .filter(|v| v["IOObjectClass"] == "IOSCSIPeripheralDeviceType00")
            .filter_map(|v| string_field(v, "IORegistryEntryID"))
            .collect();
        let scsi = if ids.len() == 1 {
            let mut args = a.clone();
            args.push(ids[0].clone());
            self.helper("--mac-scsi-check", args)
        } else {
            Err(failure("SCSI_SERVICE_UNAVAILABLE","No unambiguous SCSI service",format!("The current branch reports {} candidate SCSI peripheral services. No arbitrary service was opened.",ids.len()),"host-enumeration",Value::Null))
        };
        let issue = match scsi {
            Ok(v) => return Ok(v),
            Err(e)
                if matches!(
                    e.code.as_str(),
                    "REPORT_SAVE_FAILED" | "CANCELLED" | "PROCESS_CAPTURE_FAILED"
                ) =>
            {
                return Err(e)
            }
            Err(e) => e,
        };
        match self.helper("--mac-usb-interface-check", a) {
            Ok(v) => Ok(
                json!({"summary":"The USB storage interface opened and closed. No block/data command was sent through it; this does not establish an imaging source.","scsiAttempt":issue,"usbInterfaceAttempt":v}),
            ),
            Err(e)
                if matches!(
                    e.code.as_str(),
                    "REPORT_SAVE_FAILED" | "CANCELLED" | "PROCESS_CAPTURE_FAILED"
                ) =>
            {
                Err(e)
            }
            Err(e) => Err(failure(
                "DIRECT_STORAGE_ROUTES_REJECTED",
                "Direct storage access did not become available",
                format!(
                    "SCSI route: {} USB interface route: {}",
                    issue.detail, e.detail
                ),
                "host-api",
                json!({"scsiAttempt":issue,"usbInterfaceAttempt":e}),
            )),
        }
    }
    fn reconnect(&mut self, target: &Target, current: &Resolved) -> Result<Value, Issue> {
        if let Resolved::Observation(o) = current {
            self.protect_usb(o)?;
            return self.helper("--mac-usb-reconnect", Self::usb_args(o)?);
        }
        let Some(port) = &target.port else {
            return Err(failure("NO_CURRENT_USB_TARGET","No current USB device to reconnect","The selected device is not published. A stale registry ID cannot address hardware. Select a host port to attempt its supported probe API.","host-enumeration",Value::Null));
        };
        let number = string_field(port, "number").ok_or_else(|| {
            failure(
                "PORT_ID_MISSING",
                "Host port identity is missing",
                "Select a current host port.",
                "selection",
                Value::Null,
            )
        })?;
        self._usb_guard = Some(
            crate::mount_guard::UsbMountGuard::acquire_port(&number).map_err(|e| {
                failure(
                    "PORT_MOUNT_PROTECTION_UNAVAILABLE",
                    "Cannot establish the host-port mount veto",
                    e,
                    "source-precondition",
                    Value::Null,
                )
            })?,
        );
        let mut outcomes = vec![];
        for entry in port["entries"].as_array().into_iter().flatten() {
            if let Some(id) = string_field(entry, "IORegistryEntryID") {
                match self.helper("--mac-port-probe", vec![id, number.clone()]) {
                    Ok(v) => outcomes.push(v),
                    Err(e) => outcomes.push(json!({"issue":e})),
                }
            }
        }
        if outcomes.iter().any(|v| v["ok"] == true) {
            Ok(json!({"portProbeResults":outcomes}))
        } else {
            Err(failure(
                "HOST_PORT_PROBE_REJECTED",
                "The host-port probe was rejected",
                format!(
                    "{} host-port probe attempts failed. {}",
                    outcomes.len(),
                    outcomes
                        .iter()
                        .filter_map(|v| v["issue"]["detail"].as_str())
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .collect::<Vec<_>>()
                        .join(" ")
                ),
                "host-api",
                json!({"portProbeResults":outcomes}),
            ))
        }
    }
    fn tools(&mut self) -> Result<Value, Issue> {
        let program = crate::acquisition::executable().map_err(|e| {
            failure(
                "IMAGING_TOOL_MISSING",
                "GNU ddrescue is unavailable",
                e,
                "installation",
                Value::Null,
            )
        })?;
        let r = self.command(program, vec!["--version".into()], 10, None)?;
        self.checked_record(&r)?;
        let adapter = crate::images::executable().map_err(|e| {
            failure(
                "ADAPTER_MISSING",
                "Read adapter is unavailable",
                e,
                "installation",
                Value::Null,
            )
        })?;
        Ok(json!({"imagingTool":r.program,"versionOutput":r.stdout,"readAdapter":adapter}))
    }
    fn access(&mut self, d: &Device) -> Result<Value, Issue> {
        let state = self.app.state::<Runtime>();
        let (_,input,guard)=crate::physical_source(&self.app,&state,&d.token).map_err(|e|failure("SOURCE_ACCESS_REFUSED","Source access preflight refused",e,"source-precondition",json!({"deviceId":d.id,"policy":"read-only; whole non-system source; unmounted; fresh descriptor"})))?;
        self.input = Some(input);
        self._guard = Some(guard);
        Ok(json!({"deviceId":d.id,"readOnly":true,"descriptorPinned":true,"noUnmount":true}))
    }
    fn sample(&mut self, d: &Device) -> Result<Value, Issue> {
        let size = d
            .size_bytes
            .as_deref()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let sector = string_field(&d.info, "DeviceBlockSize")
            .or_else(|| string_field(&d.info, "log-sec"))
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|n| matches!(n, 512 | 1024 | 2048 | 4096))
            .ok_or_else(|| {
                failure(
                    "BLOCK_SIZE_UNAVAILABLE",
                    "Logical block size is unavailable",
                    "A small aligned read cannot be formed from an unknown block size.",
                    "host-metadata",
                    Value::Null,
                )
            })?;
        let length = (65536u64.min(size) / sector) * sector;
        if length == 0 {
            return Err(failure(
                "SAMPLE_RANGE_INVALID",
                "No valid sample range",
                "The reported capacity is smaller than a logical block.",
                "host-metadata",
                Value::Null,
            ));
        }
        let file = self
            .input
            .as_ref()
            .ok_or_else(|| {
                failure(
                    "SOURCE_HANDLE_MISSING",
                    "The source handle is unavailable",
                    "Read-only source access did not complete.",
                    "application",
                    Value::Null,
                )
            })?
            .try_clone()
            .map_err(|e| {
                failure(
                    "SOURCE_HANDLE_DUPLICATION_FAILED",
                    "Cannot pass the source handle",
                    e.to_string(),
                    "operating-system",
                    json!({"errno":e.raw_os_error()}),
                )
            })?;
        let program = crate::images::executable().map_err(|e| {
            failure(
                "ADAPTER_MISSING",
                "Read adapter is unavailable",
                e,
                "installation",
                Value::Null,
            )
        })?;
        let r = self.command(
            program,
            vec!["--read-check".into(), "0".into(), length.to_string()],
            15,
            Some(file),
        )?;
        if r.timed_out || r.launch_error.is_some() {
            self.checked_record(&r)?;
        }
        let result: Value = serde_json::from_str(&r.stdout).map_err(|e| {
            failure(
                "READ_RESULT_INVALID",
                "The read adapter did not return a complete result",
                e.to_string(),
                "tool-result",
                json!({"commandId":r.id,"exitCode":r.exit_code}),
            )
        })?;
        if r.exit_code != Some(0) {
            let errno = result["errno"].as_i64().unwrap_or(0);
            let detail = format!("Read at offset {} returned {} of {} requested bytes. errno {}: {}. This result applies only to the attempted sample.", string_field(&result,"offsetBytes").unwrap_or_default(), string_field(&result,"readBytes").unwrap_or_default(), string_field(&result,"requestedBytes").unwrap_or_default(), errno, if errno==0 { "no operating-system error returned (short read)".into() } else { string_field(&result,"error").unwrap_or_else(||"no error text returned".into()) });
            return Err(failure(
                if errno == 0 {
                    "SHORT_READ"
                } else {
                    "SOURCE_READ_FAILED"
                },
                "The sample read did not complete",
                detail,
                "operating-system",
                result,
            ));
        }
        Ok(
            json!({"sample":result,"scope":"Only this prefix was read. This does not establish readability of the rest of the disk."}),
        )
    }
    fn command_ids(&self) -> Vec<String> {
        self.app.state::<Runtime>().recovery.command_ids()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    #[test]
    fn actual_adapter_reads_only_a_bounded_prefix_from_a_readonly_inherited_fixture() {
        let path = std::env::temp_dir().join(unique_id("read-check"));
        let bytes = vec![0x5a; 131072];
        std::fs::write(&path, &bytes).unwrap();
        let input = std::fs::File::open(&path).unwrap();
        let mut stopped = false;
        let r = crate::query::execute_process(
            crate::images::executable().unwrap(),
            vec!["--read-check".into(), "0".into(), "65536".into()],
            Duration::from_secs(5),
            Some(input),
            &AtomicBool::new(false),
            &mut || stopped = true,
        )
        .unwrap();
        assert_eq!(r.exit_code, Some(0));
        assert!(!stopped);
        let fields: Value = serde_json::from_str(&r.stdout).unwrap();
        assert_eq!(fields["readBytes"], "65536");
        assert_eq!(fields["errno"], 0);
        assert!(r.stdout.len() < 300);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let writable = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        let r = crate::query::execute_process(
            crate::images::executable().unwrap(),
            vec!["--read-check".into(), "0".into(), "512".into()],
            Duration::from_secs(5),
            Some(writable),
            &AtomicBool::new(false),
            &mut || {},
        )
        .unwrap();
        assert_eq!(r.exit_code, Some(2));
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn subprocess_deadline_and_prelaunch_cancellation_retain_actual_process_state() {
        let mut stopped = false;
        let r = crate::query::execute_process(
            "/bin/sleep".into(),
            vec!["2".into()],
            Duration::from_millis(30),
            None,
            &AtomicBool::new(false),
            &mut || stopped = true,
        )
        .unwrap();
        assert!(stopped && r.timed_out);
        assert_eq!(r.termination_signal, Some(9));
        assert!(r.duration_ms < 1500);
        let r = crate::query::execute_process(
            "/this-path-must-never-be-launched".into(),
            vec![],
            Duration::from_secs(1),
            None,
            &AtomicBool::new(true),
            &mut || {},
        )
        .unwrap();
        assert!(r.launch_error.unwrap().contains("Cancelled before"));
        assert!(r.termination_signal.is_none());
    }
}
