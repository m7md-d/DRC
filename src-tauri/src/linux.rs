//! Linux metadata and backing resolution. No mount, probe, repair or write commands.
use crate::{
    model::*,
    platform::PlatformBackend,
    query::{self, ReadQuery},
};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

pub struct LinuxBackend;
static GENERATION: AtomicU64 = AtomicU64::new(1);
pub const COLUMNS: &str = "NAME,KNAME,TYPE,SIZE,LOG-SEC,PHY-SEC,RO,RM,HOTPLUG,TRAN,VENDOR,MODEL,SERIAL,WWN,FSTYPE,FSVER,LABEL,UUID,PTTYPE,MOUNTPOINTS,PKNAME,MAJ:MIN";
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && !id.starts_with('-')
}
pub fn json_result(record: &CommandRecord) -> Result<Value, String> {
    if record.timed_out || record.launch_error.is_some() || record.exit_code != Some(0) {
        return Err(format!(
            "Metadata query failed: {}. Original output is retained.",
            record.launch_error.as_deref().unwrap_or(&record.stderr)
        ));
    }
    serde_json::from_str(&record.stdout)
        .map(exact_json)
        .map_err(|e| e.to_string())
}
fn properties(text: &str) -> Value {
    let fields = text
        .lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.into(), Value::String(v.into())))
        .collect();
    Value::Object(fields)
}
pub fn descriptor(row: &Value, udev: Value, path: String) -> Value {
    let mut value = row.clone();
    if let Some(fields) = value.as_object_mut() {
        fields.remove("children");
        fields.insert("udev".into(), udev);
        fields.insert("sysfsPath".into(), Value::String(path));
    }
    value
}
pub fn read_info(id: &str, sink: &mut dyn FnMut(CommandRecord)) -> Result<Value, String> {
    let result = query::execute(ReadQuery::LinuxInfo(id.into()))?;
    let parsed = json_result(&result);
    sink(result);
    let parsed = parsed?;
    let row = parsed
        .get("blockdevices")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .find(|v| string_field(v, "kname").as_deref() == Some(id))
        })
        .ok_or("The selected block device disappeared.")?;
    let response = query::execute(ReadQuery::LinuxProperties(id.into()))?;
    let udev = if response.exit_code == Some(0) && !response.timed_out {
        properties(&response.stdout)
    } else {
        Value::Null
    };
    sink(response);
    let sysfs =
        std::fs::canonicalize(Path::new("/sys/class/block").join(id)).map_err(|e| e.to_string())?;
    let mut info = descriptor(row, udev, sysfs.to_string_lossy().into_owned());
    let system = system_stores();
    info["drcObservation"] = match system {
        Ok(stores) => {
            serde_json::json!({"systemBacking":stores.iter().any(|store|store==id),"source":"resolved sysfs backing for system paths and active swap"})
        }
        Err(error) => serde_json::json!({"systemBacking":null,"resolutionError":error}),
    };
    Ok(info)
}
fn descendants(row: &Value, out: &mut Vec<Value>) {
    if let Some(children) = row.get("children").and_then(Value::as_array) {
        for child in children {
            out.push(child.clone());
            descendants(child, out);
        }
    }
}
impl PlatformBackend for LinuxBackend {
    fn discover(&self, sink: &mut dyn FnMut(CommandRecord)) -> Result<Discovery, String> {
        // Non-root operation prevents lsblk from falling back to privileged raw probing.
        if unsafe { libc::geteuid() } == 0 {
            return Err(
                "Run DRC as your desktop user, not root. Device access is checked per operation."
                    .into(),
            );
        }
        let result = query::execute(ReadQuery::LinuxList)?;
        let enumeration = json_result(&result);
        sink(result);
        let enumeration = enumeration?;
        let rows = enumeration
            .get("blockdevices")
            .and_then(Value::as_array)
            .ok_or("lsblk returned no blockdevices array.")?;
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
        let mut devices = Vec::new();
        for row in rows
            .iter()
            .filter(|r| string_field(r, "type").as_deref() == Some("disk"))
        {
            let Some(id) = string_field(row, "kname").filter(|id| valid_id(id)) else {
                continue;
            };
            let observed_at = now_ms();
            let (info, info_error) = match read_info(&id, sink) {
                Ok(v) => (v, None),
                Err(e) => (Value::Null, Some(e)),
            };
            let mut partitions = Vec::new();
            descendants(row, &mut partitions);
            let vendor = string_field(&info, "vendor")
                .unwrap_or_default()
                .trim()
                .to_owned();
            let model = string_field(&info, "model")
                .unwrap_or_default()
                .trim()
                .to_owned();
            let name = if model.is_empty() {
                id.clone()
            } else if vendor.is_empty() || model.to_lowercase().starts_with(&vendor.to_lowercase())
            {
                model
            } else {
                format!("{vendor} {model}")
            };
            let protocol = string_field(&info, "tran").filter(|s| !s.is_empty());
            // USB is positively external only if it backs no protected system path/swap.
            // Other transports remain unknown; HOTPLUG alone does not establish location.
            let internal = if protocol.as_deref() == Some("usb") {
                match system_stores() {
                    Ok(stores) => Some(stores.contains(&id)),
                    Err(_) => None,
                }
            } else {
                None
            };
            devices.push(Device {
                id: id.clone(),
                token: format!("{generation}:{id}"),
                identity_key: crate::platform::identity_key(&info),
                name,
                size_bytes: string_field(&info, "size").or_else(|| string_field(row, "size")),
                internal,
                protocol,
                content: string_field(row, "pttype"),
                partitions,
                layout: row.clone(),
                info,
                info_error,
                observed_at,
                metadata_only: false,
                protection_reason: None,
            });
        }
        Ok(Discovery {
            devices,
            observed_at: now_ms(),
            platform: "Linux".into(),
            enumeration,
            warnings: vec![],
        })
    }
    fn connections(&self, _sink: &mut dyn FnMut(CommandRecord)) -> Result<QueryResult, String> {
        let record = query::execute(ReadQuery::LinuxConnections)?;
        let mut devices = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/sys/bus/usb/devices") {
            for entry in entries.flatten() {
                let mut fields = serde_json::Map::new();
                fields.insert(
                    "sysfsName".into(),
                    Value::String(entry.file_name().to_string_lossy().into_owned()),
                );
                if let Ok(path) = entry.path().canonicalize() {
                    fields.insert("sysfsPath".into(), Value::String(path.to_string_lossy().into_owned()));
                    if let Some(parent) = path.parent().and_then(Path::file_name) {
                        fields.insert("parentSysfsName".into(), Value::String(parent.to_string_lossy().into_owned()));
                    }
                }
                for key in [
                    "idVendor",
                    "idProduct",
                    "manufacturer",
                    "product",
                    "serial",
                    "speed",
                    "bMaxPower",
                    "bcdUSB",
                    "busnum",
                    "devnum",
                    "devpath",
                    "bDeviceClass",
                    "bNumInterfaces",
                    "bNumConfigurations",
                    "maxchild",
                    "authorized",
                    "power/runtime_status",
                    "power/control",
                ] {
                    if let Ok(value) = std::fs::read_to_string(entry.path().join(key)) {
                        fields.insert(key.into(), Value::String(value));
                    }
                }
                if fields.len() > 1 {
                    devices.push(Value::Object(fields));
                }
            }
        }
        let mut thunderbolt = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/sys/bus/thunderbolt/devices") {
            for entry in entries.flatten() {
                let mut fields = serde_json::Map::new();
                fields.insert(
                    "sysfsName".into(),
                    Value::String(entry.file_name().to_string_lossy().into_owned()),
                );
                if let Ok(path) = entry.path().canonicalize() {
                    fields.insert("sysfsPath".into(), Value::String(path.to_string_lossy().into_owned()));
                    if let Some(parent) = path.parent().and_then(Path::file_name) {
                        fields.insert("parentSysfsName".into(), Value::String(parent.to_string_lossy().into_owned()));
                    }
                }
                for key in [
                    "vendor_name",
                    "device_name",
                    "generation",
                    "rx_speed",
                    "tx_speed",
                    "authorized",
                    "unique_id",
                ] {
                    if let Ok(value) = std::fs::read_to_string(entry.path().join(key)) {
                        fields.insert(key.into(), Value::String(value));
                    }
                }
                if fields.len() > 1 {
                    thunderbolt.push(Value::Object(fields));
                }
            }
        }
        thunderbolt.sort_by_key(|v| string_field(v, "sysfsName"));
        devices.sort_by_key(|v| string_field(v, "sysfsName"));
        Ok(QueryResult {
            record,
            fields: Some(
                serde_json::json!({"USBDevices":devices,"ThunderboltDevices":thunderbolt,"measurementScope":"sysfs declared USB properties and lsusb topology; no live current measurement"}),
            ),
            parse_error: None,
        })
    }
    fn smart(
        &self,
        device: &Device,
        sink: &mut dyn FnMut(CommandRecord),
    ) -> Result<QueryResult, String> {
        let fresh = read_info(&device.id, sink)?;
        if crate::platform::identity_key(&fresh) != device.identity_key {
            return Err("The device descriptor changed. Refresh and select it again.".into());
        }
        let executable = crate::platform::smart_path()
            .ok_or("Install smartmontools to read SMART information.")?;
        let record = query::execute(ReadQuery::SmartInfo {
            executable,
            device: device.id.clone(),
        })?;
        let parsed = serde_json::from_str::<Value>(&record.stdout).map(exact_json);
        let (fields, parse_error) = match parsed {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(e.to_string())),
        };
        Ok(QueryResult {
            record,
            fields,
            parse_error,
        })
    }
}

pub fn backing_from(root: &Path, node: &str) -> Result<Vec<String>, String> {
    fn visit(
        root: &Path,
        node: &str,
        active: &mut BTreeSet<String>,
        out: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if !valid_id(node) || !active.insert(node.into()) {
            return Err("Invalid or cyclic block-device backing graph.".into());
        }
        let path = std::fs::canonicalize(root.join(node)).map_err(|e| e.to_string())?;
        if path.join("partition").exists() {
            let parent = path
                .parent()
                .and_then(Path::file_name)
                .and_then(|s| s.to_str())
                .ok_or("Partition parent is unresolved")?;
            visit(root, parent, active, out)?;
        } else {
            let slaves = std::fs::read_dir(path.join("slaves"))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            if !slaves.is_empty() {
                for slave in slaves {
                    visit(root, &slave.file_name().to_string_lossy(), active, out)?;
                }
            } else {
                if !path.join("device").exists() {
                    return Err("Backing is virtual, networked or unresolved. Choose a local hardware-backed volume.".into());
                }
                out.insert(node.into());
            }
        }
        active.remove(node);
        Ok(())
    }
    let mut out = BTreeSet::new();
    visit(root, node, &mut BTreeSet::new(), &mut out)?;
    Ok(out.into_iter().collect())
}
#[cfg(target_os = "linux")]
pub fn path_stores(path: &Path) -> Result<Vec<String>, String> {
    use std::os::unix::fs::MetadataExt;
    let dev = std::fs::metadata(path).map_err(|e| e.to_string())?.dev();
    let link = std::path::PathBuf::from(format!(
        "/sys/dev/block/{}:{}",
        libc::major(dev),
        libc::minor(dev)
    ));
    let node = std::fs::canonicalize(link)
        .map_err(|e| format!("Local block backing is unresolved: {e}"))?
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("Backing identifier unavailable")?
        .to_owned();
    backing_from(Path::new("/sys/class/block"), &node)
}
#[cfg(not(target_os = "linux"))]
pub fn path_stores(_path: &Path) -> Result<Vec<String>, String> {
    Err("Linux backing is unavailable on this host.".into())
}
fn system_stores() -> Result<Vec<String>, String> {
    let mut stores = BTreeSet::new();
    for path in ["/", "/boot", "/usr", "/var", "/home"] {
        if Path::new(path).exists() {
            stores.extend(path_stores(Path::new(path))?);
        }
    }
    for line in std::fs::read_to_string("/proc/swaps")
        .map_err(|e| e.to_string())?
        .lines()
        .skip(1)
    {
        let path = line
            .split_whitespace()
            .next()
            .ok_or("Invalid swap descriptor")?;
        if let Some(node) = path.strip_prefix("/dev/") {
            let resolved = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
            let node = resolved
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(node);
            stores.extend(backing_from(Path::new("/sys/class/block"), node)?);
        } else {
            stores.extend(path_stores(Path::new(path))?);
        }
    }
    Ok(stores.into_iter().collect())
}
#[cfg(target_os = "linux")]
pub fn require_unmounted(id: &str) -> Result<(), String> {
    for line in std::fs::read_to_string("/proc/self/mountinfo")
        .map_err(|e| e.to_string())?
        .lines()
    {
        let Some(dev) = line.split_whitespace().nth(2) else {
            return Err("Invalid mountinfo".into());
        };
        let Ok(path) = std::fs::canonicalize(format!("/sys/dev/block/{dev}")) else {
            continue;
        };
        let Some(node) = path.file_name().and_then(|s| s.to_str()) else {
            return Err("Mount backing is unresolved".into());
        };
        if backing_from(Path::new("/sys/class/block"), node)?
            .iter()
            .any(|s| s == id)
        {
            return Err("Source or a dependent volume is mounted. DRC does not unmount or flush it automatically.".into());
        }
    }
    if system_stores()?.iter().any(|s| s == id) {
        return Err("Source backs a system path or active swap.".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptor_retains_unknown_fields_and_exact_capacity() {
        let row = serde_json::json!({"kname":"sdb","size":"9007199254740993","vendorExtra":{"x":true},"children":[]});
        let descriptor = descriptor(
            &row,
            properties("ID_SERIAL=A=B\nUNKNOWN=value"),
            "/sys/devices/one".into(),
        );
        assert_eq!(descriptor["size"], "9007199254740993");
        assert_eq!(descriptor["vendorExtra"]["x"], true);
        assert_eq!(descriptor["udev"]["ID_SERIAL"], "A=B");
    }
    #[test]
    fn node_identifiers_reject_paths_options_and_shell_text() {
        for bad in ["", "../sda", "/dev/sda", "-sda", "sda;rm", "sda p1"] {
            assert!(!valid_id(bad));
        }
        for good in ["sda", "nvme0n1p1", "mmcblk0", "dm-0"] {
            assert!(valid_id(good));
        }
    }
    #[test]
    fn backing_resolves_partition_and_shared_layered_stores_and_refuses_virtual_media() {
        use std::{fs, os::unix::fs::symlink};
        let temp = std::env::temp_dir().join(unique_id("drc-linux-backing"));
        let root = temp.join("class");
        let devices = temp.join("devices");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&devices).unwrap();
        for id in ["sda", "sdb", "dm-0", "loop0"] {
            let path = devices.join(id);
            fs::create_dir_all(path.join("slaves")).unwrap();
            symlink(&path, root.join(id)).unwrap();
        }
        for id in ["sda", "sdb"] {
            fs::create_dir(devices.join(id).join("device")).unwrap();
        }
        let partition = devices.join("sda/sda1");
        fs::create_dir_all(&partition).unwrap();
        fs::write(partition.join("partition"), "1\n").unwrap();
        symlink(&partition, root.join("sda1")).unwrap();
        symlink(root.join("sda1"), devices.join("dm-0/slaves/sda1")).unwrap();
        symlink(root.join("sdb"), devices.join("dm-0/slaves/sdb")).unwrap();
        assert_eq!(backing_from(&root, "sda1").unwrap(), vec!["sda"]);
        assert_eq!(backing_from(&root, "dm-0").unwrap(), vec!["sda", "sdb"]);
        assert!(backing_from(&root, "loop0").is_err());
        symlink(root.join("dm-0"), devices.join("dm-0/slaves/dm-0")).unwrap();
        assert!(backing_from(&root, "dm-0").is_err());
        fs::remove_dir_all(temp).unwrap();
    }
}
