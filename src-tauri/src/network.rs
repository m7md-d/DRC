//! Parsing passive interface status. No sockets, packets or configuration changes.
use serde_json::{json, Value};
use std::path::Path;

pub fn sysfs_entries(base: &Path, keys: &[&str]) -> Vec<Value> {
    let mut rows = vec![];
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
            let path = entry.path();
            let mut row = json!({"sysfsName":entry.file_name().to_string_lossy()});
            if let Ok(canonical) = path.canonicalize() {
                row["sysfsPath"] = json!(canonical.to_string_lossy());
            }
            if let Ok(device) = path.join("device").canonicalize() {
                row["deviceSysfsPath"] = json!(device.to_string_lossy());
            }
            let mut errors = serde_json::Map::new();
            let mut found = false;
            for key in keys {
                match std::fs::read_to_string(path.join(key)) {
                    Ok(value) => {
                        row[*key] = json!(value.trim());
                        found = true;
                    }
                    Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                        errors.insert((*key).into(), json!(error.to_string()));
                    }
                    Err(_) => {}
                }
            }
            if found {
                row["readErrors"] = Value::Object(errors);
                rows.push(row);
            }
        }
    }
    rows.sort_by(|a, b| a["sysfsName"].as_str().cmp(&b["sysfsName"].as_str()));
    rows
}

pub fn parse_ifconfig(output: &str) -> Vec<Value> {
    let mut interfaces: Vec<Value> = vec![];
    for line in output.lines() {
        if !line.starts_with(char::is_whitespace) {
            if let Some((name, flags)) = line.split_once(": flags=") {
                if !name.is_empty()
                    && name
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
                {
                    interfaces.push(json!({"interface":name,"flags":flags,"raw":line}));
                }
            }
        } else if let Some(row) = interfaces.last_mut() {
            let raw = row["raw"].as_str().unwrap_or_default().to_owned();
            row["raw"] = json!(format!("{raw}\n{line}"));
            for (prefix, key) in [("status:", "linkStatus"), ("media:", "media")] {
                if let Some(value) = line.trim().strip_prefix(prefix) {
                    row[key] = json!(value.trim());
                }
            }
        }
    }
    interfaces
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_is_reported_not_inferred_from_flags_or_configured_service() {
        let rows = parse_ifconfig("en5: flags=8863<UP,BROADCAST> mtu 1500\n\tmedia: autoselect (none)\n\tstatus: inactive\nen0: flags=8863<UP> mtu 1500\n\tstatus: active\nutun9: flags=8051<UP> mtu 1500\n");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["linkStatus"], "inactive");
        assert_eq!(rows[1]["linkStatus"], "active");
        assert!(rows[2].get("linkStatus").is_none());
        assert!(rows[0]["raw"]
            .as_str()
            .unwrap()
            .contains("status: inactive"));
    }
}
