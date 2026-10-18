use crate::model::*;
use crate::query::{execute, valid_device_id, ReadQuery};
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

pub trait PlatformBackend: Send + Sync {
    fn discover(&self, record: &mut dyn FnMut(CommandRecord)) -> Result<Discovery, String>;
    fn connections(&self, record: &mut dyn FnMut(CommandRecord)) -> Result<QueryResult, String>;
    fn smart(
        &self,
        device: &Device,
        device_type: Option<&str>,
        record: &mut dyn FnMut(CommandRecord),
    ) -> Result<QueryResult, String>;
}

pub struct MacOsBackend;
static GENERATION: AtomicU64 = AtomicU64::new(1);

pub fn successful_plist(record: &CommandRecord) -> Result<Value, String> {
    if record.timed_out {
        return Err("Metadata command exceeded its time limit; partial output is retained in the transcript.".into());
    }
    if let Some(error) = &record.launch_error {
        return Err(error.clone());
    }
    if record.exit_code != Some(0) {
        return Err(format!(
            "{} exited with {:?}: {}",
            record.program,
            record.exit_code,
            record.stderr.trim()
        ));
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&record.stdout_base64)
        .map_err(|e| e.to_string())?;
    // ioreg -a returns zero bytes with exit 0 when no services match.
    // Other tools and failed/timed-out queries must still report their errors.
    if record.program == "/usr/sbin/ioreg"
        && record.arguments.iter().any(|a| a == "-a")
        && bytes.is_empty()
    {
        return Ok(serde_json::json!([]));
    }
    let value = parse_plist(&bytes)?;
    if value.get("Error") == Some(&Value::Bool(true))
        || string_field(&value, "ExitCode").is_some_and(|code| code != "0")
    {
        return Err(string_field(&value, "ErrorMessage").unwrap_or(
            "diskutil returned an error property list; original output is retained.".into(),
        ));
    }
    Ok(value)
}

pub fn identity_key(info: &Value) -> String {
    // This is an observed descriptor, not a claim of unique hardware identity.
    let keys = if info.get("kname").is_some() {
        vec![
            "kname",
            "maj:min",
            "sysfsPath",
            "size",
            "log-sec",
            "model",
            "serial",
            "wwn",
            "tran",
        ]
    } else {
        vec![
            "DeviceIdentifier",
            "DeviceTreePath",
            "DiskUUID",
            "MediaName",
            "TotalSize",
            "DeviceBlockSize",
            "Internal",
        ]
    };
    let fields: Vec<Value> = keys
        .iter()
        .map(|key| info.get(*key).cloned().unwrap_or(Value::Null))
        .collect();
    serde_json::to_string(&fields).unwrap_or_default()
}

pub fn smart_path() -> Option<String> {
    [
        "/opt/homebrew/bin/smartctl",
        "/usr/local/bin/smartctl",
        "/usr/bin/smartctl",
        "/usr/sbin/smartctl",
    ]
    .into_iter()
    .find(|path| Path::new(path).is_file())
    .map(str::to_owned)
}

pub(crate) fn discover_mac(
    record: &mut dyn FnMut(CommandRecord),
    mut run: impl FnMut(ReadQuery) -> Result<CommandRecord, String>,
) -> Result<Discovery, String> {
    let listing = run(ReadQuery::ListPhysical)?;
    let parsed = successful_plist(&listing);
    record(listing);
    let mut warnings = Vec::new();
    let mut enumeration = match parsed {
        Ok(value) => value,
        Err(error) => {
            warnings.push(format!("Physical disk enumeration unavailable: {error}"));
            serde_json::json!({})
        }
    };
    let listing_ok = enumeration
        .get("AllDisksAndPartitions")
        .and_then(Value::as_array)
        .is_some();
    if !listing_ok && warnings.is_empty() {
        warnings.push("diskutil did not return AllDisksAndPartitions; registry observations remain available.".into());
    }
    let entries = enumeration
        .get("AllDisksAndPartitions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let mut devices = Vec::new();
    for layout in &entries {
        let Some(id) = string_field(layout, "DeviceIdentifier").filter(|id| valid_device_id(id))
        else {
            warnings.push("A layout entry had no valid DeviceIdentifier; it remains in the complete enumeration.".into());
            continue;
        };
        let response = run(ReadQuery::DeviceInfo(id.clone()))?;
        let info_result = successful_plist(&response);
        let observed_at = response.started_at;
        record(response);
        let (info, info_error) = match info_result {
            Ok(value) => (value, None),
            Err(error) => (Value::Null, Some(error)),
        };
        let name = string_field(&info, "MediaName")
            .or_else(|| string_field(&info, "IORegistryEntryName"))
            .unwrap_or_else(|| id.clone());
        devices.push(Device {
            id: id.clone(),
            token: format!("{generation}:{id}"),
            identity_key: identity_key(&info),
            name,
            size_bytes: string_field(&info, "TotalSize").or_else(|| string_field(layout, "Size")),
            internal: info.get("Internal").and_then(Value::as_bool),
            protocol: string_field(&info, "BusProtocol"),
            content: string_field(layout, "Content"),
            partitions: layout
                .get("Partitions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            layout: layout.clone(),
            info,
            info_error,
            observed_at,
            metadata_only: false,
            protection_reason: None,
        });
    }
    // IORegistry publishes interfaces and media before Disk Arbitration necessarily
    // creates a usable disk. Read properties only; never probe or open that medium.
    let mut host = serde_json::Map::new();
    for (key, query) in [
        ("usbServices", ReadQuery::UsbStorageServices),
        ("media", ReadQuery::MediaRegistry),
    ] {
        let response = run(query)?;
        let fields = match successful_plist(&response) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(format!("{key} metadata unavailable: {error}"));
                Value::Null
            }
        };
        host.insert(key.into(), fields);
        record(response);
    }
    let observed_at = now_ms();
    let listed = devices.iter().map(|d| d.id.clone()).collect();
    let unavailable_media = crate::storage_observations::unavailable(
        &host["usbServices"],
        &host["media"],
        &listed,
        listing_ok,
        observed_at,
    );
    if !enumeration.is_object() {
        enumeration = serde_json::json!({"OriginalPhysicalEnumeration":enumeration});
    }
    enumeration["DRCHostMetadata"] = Value::Object(host);
    Ok(Discovery {
        devices,
        unavailable_media,
        observed_at,
        platform: "macOS".into(),
        enumeration,
        warnings,
    })
}

impl PlatformBackend for MacOsBackend {
    fn discover(&self, record: &mut dyn FnMut(CommandRecord)) -> Result<Discovery, String> {
        discover_mac(record, execute)
    }

    fn connections(&self, sink: &mut dyn FnMut(CommandRecord)) -> Result<QueryResult, String> {
        let record = execute(ReadQuery::Connections)?;
        let parsed = serde_json::from_str::<Value>(&record.stdout).map(exact_json);
        let (mut fields, parse_error) = match parsed {
            Ok(fields) => (Some(fields), None),
            Err(error) => (None, Some(error.to_string())),
        };
        if fields.as_ref().is_none_or(|value| !value.is_object()) {
            fields = Some(serde_json::json!({"SystemProfilerOriginal":fields}));
        }
        for (key, query) in [
            ("IORegistryUSBReport", ReadQuery::UsbRegistry),
            ("IORegistryPortReport", ReadQuery::UsbHostPorts),
            ("IORegistryStorageReport", ReadQuery::UsbStorageServices),
            ("IORegistryNetworkReport", ReadQuery::NetworkRegistry),
            ("IORegistryTransportReport", ReadQuery::PortTransports),
        ] {
            let registry = execute(query)?;
            let (properties, registry_error) = match successful_plist(&registry) {
                Ok(value) => (Some(value), None),
                Err(error) => (None, Some(error)),
            };
            fields.as_mut().unwrap()[key] = serde_json::json!({"fields":properties,"parseError":registry_error,"record":registry});
            sink(registry);
        }
        let network = execute(ReadQuery::NetworkStatus)?;
        let network_error =
            (network.exit_code != Some(0) || network.timed_out || network.launch_error.is_some())
                .then(|| {
                    format!(
                        "Interface query failed: exit {:?}; timeout {}; launch {:?}",
                        network.exit_code, network.timed_out, network.launch_error
                    )
                });
        let interfaces = if network_error.is_none() {
            crate::network::parse_ifconfig(&network.stdout)
        } else {
            vec![]
        };
        fields.as_mut().unwrap()["NetworkInterfaceReport"] =
            serde_json::json!({"fields":interfaces,"parseError":network_error,"record":network});
        sink(network);
        Ok(QueryResult {
            record,
            fields,
            parse_error,
        })
    }

    fn smart(
        &self,
        device: &Device,
        device_type: Option<&str>,
        record_sink: &mut dyn FnMut(CommandRecord),
    ) -> Result<QueryResult, String> {
        if device.info.is_null() {
            return Err(
                "Device identity is unavailable. Refresh metadata before requesting SMART.".into(),
            );
        }
        let check = execute(ReadQuery::DeviceInfo(device.id.clone()))?;
        let fresh = successful_plist(&check);
        record_sink(check);
        if identity_key(&fresh?) != device.identity_key {
            return Err(
                "The reported device descriptor changed. Refresh and select the device again."
                    .into(),
            );
        }
        let executable =
            smart_path().ok_or("smartctl is not installed at a supported location.")?;
        let record = execute(ReadQuery::SmartInfo {
            executable,
            device: device.id.clone(),
            device_type: device_type.map(str::to_owned),
        })?;
        // smartctl exit status is a bitmask: retain JSON even when the exit code is nonzero.
        let parsed = serde_json::from_str::<Value>(&record.stdout).map(exact_json);
        let (fields, parse_error) = match parsed {
            Ok(fields) => (Some(fields), None),
            Err(error) => (None, Some(error.to_string())),
        };
        Ok(QueryResult {
            record,
            fields,
            parse_error,
        })
    }
}

pub fn tool_inventory() -> Vec<ToolReport> {
    let mut definitions = vec![
        (
            "diskutil",
            "diskutil",
            true,
            "Device metadata and partition layouts",
        ),
        (
            "system_profiler",
            "System Profiler",
            true,
            "USB / Thunderbolt host connection reports",
        ),
        (
            "ioreg",
            "IORegistry",
            true,
            "USB registry hierarchy and reported device/controller properties",
        ),
        (
            "smartctl",
            "smartmontools",
            true,
            "SMART / NVMe information on explicit request",
        ),
        (
            "ddrescue",
            "GNU ddrescue",
            true,
            "Raw acquisition with a resumable mapfile",
        ),
        (
            "drc-tsk",
            "The Sleuth Kit image reader",
            true,
            "Read-only image partitions, filesystem metadata, file browsing and extraction",
        ),
        (
            "testdisk",
            "TestDisk",
            false,
            "Partition inspection and supported recovery operations",
        ),
        ("photorec", "PhotoRec", false, "File signature carving"),
    ];
    if cfg!(target_os = "linux") {
        definitions
            .retain(|(key, _, _, _)| !matches!(*key, "diskutil" | "system_profiler" | "ioreg"));
        definitions.extend([
            ("lsblk", "util-linux", true, "sysfs / udev block metadata"),
            (
                "udevadm",
                "udev",
                true,
                "Device properties and block connection events",
            ),
            (
                "lsusb",
                "usbutils",
                true,
                "USB topology and sysfs connection properties",
            ),
        ]);
    }
    definitions
        .into_iter()
        .map(|(key, name, implemented, purpose)| {
            let paths = [
                format!("/usr/sbin/{key}"),
                format!("/usr/bin/{key}"),
                format!("/opt/homebrew/bin/{key}"),
                format!("/usr/local/bin/{key}"),
            ];
            let path = if key == "drc-tsk" {
                crate::images::executable().ok()
            } else if key == "ddrescue" {
                crate::acquisition::executable().ok()
            } else {
                paths.into_iter().find(|path| Path::new(path).is_file())
            };
            ToolReport {
                key: key.into(),
                name: name.into(),
                available: path.is_some(),
                path,
                implemented,
                purpose: purpose.into(),
            }
        })
        .collect()
}

pub fn backend() -> &'static dyn PlatformBackend {
    if cfg!(target_os = "linux") {
        &crate::linux::LinuxBackend
    } else {
        &MacOsBackend
    }
}
pub fn read_info(id: &str, sink: &mut dyn FnMut(CommandRecord)) -> Result<Value, String> {
    if cfg!(target_os = "linux") {
        crate::linux::read_info(id, sink)
    } else {
        let result = execute(ReadQuery::DeviceInfo(id.into()))?;
        let parsed = successful_plist(&result);
        sink(result);
        parsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_record(value: Value, timed_out: bool) -> CommandRecord {
        use base64::Engine;
        let mut bytes = vec![];
        plist::to_writer_xml(&mut bytes, &value).unwrap();
        serde_json::from_value(serde_json::json!({"id":"fixture","program":"fixture","arguments":[],"startedAt":1,"durationMs":0,"exitCode":if timed_out {None} else {Some(0)},"timedOut":timed_out,"stdout":String::from_utf8_lossy(&bytes),"stderr":"","stdoutBase64":base64::engine::general_purpose::STANDARD.encode(&bytes),"stderrBase64":"","stdoutUtf8Valid":true,"stderrUtf8Valid":true,"launchError":null})).unwrap()
    }
    #[test]
    fn failed_diskutil_enumeration_still_returns_registry_observations_and_records() {
        let mut records = vec![];
        let result = discover_mac(&mut |r| records.push(r), |q| Ok(match q {
            ReadQuery::ListPhysical => fixture_record(serde_json::json!({}), true),
            ReadQuery::UsbStorageServices => fixture_record(serde_json::json!([{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"100","USB Product Name":"Fixture SSD","IORegistryEntryChildren":[{"IOObjectClass":"IOMedia","IORegistryEntryID":"102","Whole":true,"Size":"256060514304"}]}]),false),
            ReadQuery::MediaRegistry => fixture_record(serde_json::json!([]),false),
            _ => panic!("Must not issue per-device or SMART queries without listed devices"),
        })).unwrap();
        assert!(result.devices.is_empty());
        assert_eq!(result.unavailable_media.len(), 1);
        assert_eq!(result.unavailable_media[0].stage, "media-unassigned");
        assert_eq!(records.len(), 3);
        assert!(records[0].timed_out);
        assert_eq!(result.warnings.len(), 1);
    }
    #[test]
    fn successful_empty_ioreg_is_no_matching_services_but_other_empty_results_are_errors() {
        let mut r = fixture_record(serde_json::json!([]), false);
        r.stdout.clear();
        r.stdout_base64.clear();
        r.program = "/usr/sbin/ioreg".into();
        r.arguments = vec![
            "-a".into(),
            "-r".into(),
            "-c".into(),
            "IOUSBHostDevice".into(),
        ];
        assert_eq!(successful_plist(&r).unwrap(), serde_json::json!([]));
        r.exit_code = Some(1);
        assert!(successful_plist(&r).is_err());
        r.exit_code = Some(0);
        r.timed_out = true;
        assert!(successful_plist(&r).is_err());
        r.timed_out = false;
        r.program = "/usr/sbin/diskutil".into();
        assert!(successful_plist(&r).is_err());
    }
    #[test]
    fn identity_changes_when_reused_disk_number_has_different_descriptor() {
        let original =
            serde_json::json!({"DeviceIdentifier":"disk3", "DiskUUID":"one", "TotalSize":"512"});
        let replacement =
            serde_json::json!({"DeviceIdentifier":"disk3", "DiskUUID":"two", "TotalSize":"512"});
        assert_ne!(identity_key(&original), identity_key(&replacement));
    }

    #[test]
    fn nonzero_smart_status_does_not_discard_reported_values() {
        let report: Value = serde_json::from_str(r#"{"smartctl":{"exit_status":8},"ata_smart_attributes":{"table":[{"id":200,"raw":{"value":18446744073709551615}}]}}"#).unwrap();
        let exact = exact_json(report);
        assert_eq!(exact["smartctl"]["exit_status"], "8");
        assert_eq!(
            exact["ata_smart_attributes"]["table"][0]["raw"]["value"],
            "18446744073709551615"
        );
    }
}
