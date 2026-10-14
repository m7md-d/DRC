//! On-request host metadata still available when no block device enumerates.
use crate::{
    model::*,
    query::{execute, ReadQuery},
};
use serde_json::Value;
use std::path::Path;
fn sysfs_entries(root: &Path, keys: &[&str]) -> Value {
    let mut entries = Vec::new();
    if let Ok(list) = std::fs::read_dir(root) {
        for entry in list.flatten() {
            let mut fields = serde_json::Map::new();
            fields.insert(
                "sysfsName".into(),
                Value::String(entry.file_name().to_string_lossy().into_owned()),
            );
            let mut errors = serde_json::Map::new();
            for key in keys {
                match std::fs::read(entry.path().join(key)) {
                    Ok(bytes) => {
                        use base64::Engine;
                        fields.insert((*key).into(),serde_json::json!({"text":String::from_utf8_lossy(&bytes),"base64":base64::engine::general_purpose::STANDARD.encode(&bytes),"utf8Valid":std::str::from_utf8(&bytes).is_ok()}));
                    }
                    Err(e) => {
                        errors.insert((*key).into(), Value::String(e.to_string()));
                    }
                }
            }
            fields.insert("readErrors".into(), Value::Object(errors));
            entries.push(Value::Object(fields));
        }
    }
    entries.sort_by_key(|v| string_field(v, "sysfsName"));
    Value::Array(entries)
}
pub fn collect(kind: &str) -> Result<QueryResult, String> {
    let (record, fields, parse_error) = match kind {
        "topology" => {
            let record = execute(ReadQuery::LinuxPci)?;
            let fields = serde_json::json!({"scope":"Host metadata only. No device reset, power-state change, firmware update or namespace creation.","NVMeControllers":sysfs_entries(Path::new("/sys/class/nvme"),&["state","model","serial","firmware_rev","transport","address","subsysnqn"]),"PCIeDevices":sysfs_entries(Path::new("/sys/bus/pci/devices"),&["class","vendor","device","current_link_speed","current_link_width","max_link_speed","max_link_width","power/runtime_status","power/control","d3cold_allowed"]),"lspci":record.stdout});
            (record, Some(fields), None)
        }
        "kernel" => {
            let record = execute(ReadQuery::LinuxKernel)?;
            let parsed = serde_json::from_str::<Value>(&record.stdout).map(exact_json);
            let (fields, error) = match parsed {
                Ok(v) => (Some(v), None),
                Err(e) => (None, Some(e.to_string())),
            };
            (record, fields, error)
        }
        _ => return Err("Unknown host-evidence query".into()),
    };
    Ok(QueryResult {
        record,
        fields,
        parse_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn controller_metadata_survives_without_any_block_device_and_retains_non_utf8_bytes() {
        let root = std::env::temp_dir().join(unique_id("drc-no-namespace"));
        std::fs::create_dir_all(root.join("nvme0")).unwrap();
        std::fs::write(root.join("nvme0/state"), b"dead\n").unwrap();
        std::fs::write(root.join("nvme0/model"), [0xff, 0x00, 0x41]).unwrap();
        let fields = sysfs_entries(&root, &["state", "model", "missing"]);
        assert_eq!(fields[0]["state"]["text"], "dead\n");
        assert_eq!(fields[0]["model"]["utf8Valid"], false);
        assert_eq!(fields[0]["model"]["base64"], "/wBB");
        assert!(fields[0]["readErrors"]["missing"].is_string());
        assert!(collect("kernel; reset").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
