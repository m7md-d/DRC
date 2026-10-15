use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
pub fn unique_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}-{}",
        now_ms(),
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub id: String,
    pub program: String,
    pub arguments: Vec<String>,
    pub started_at: u64,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub stdout_base64: String,
    pub stderr_base64: String,
    pub stdout_utf8_valid: bool,
    pub stderr_utf8_valid: bool,
    pub launch_error: Option<String>,
    #[serde(default)]
    pub stdout_artifact: Option<StreamArtifact>,
    #[serde(default)]
    pub termination_signal: Option<i32>,
    #[serde(default)]
    pub stdin: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamArtifact {
    pub path: String,
    pub bytes: String,
    pub sha256: String,
    pub identity: crate::policy::FileIdentity,
    pub operation_id: String,
    pub entry_index: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub token: String,
    pub identity_key: String,
    pub name: String,
    pub size_bytes: Option<String>,
    pub internal: Option<bool>,
    pub protocol: Option<String>,
    pub content: Option<String>,
    pub partitions: Vec<Value>,
    pub info: Value,
    pub layout: Value,
    pub info_error: Option<String>,
    pub observed_at: u64,
    #[serde(default)]
    pub metadata_only: bool,
    #[serde(default)]
    pub protection_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub devices: Vec<Device>,
    pub observed_at: u64,
    pub platform: String,
    pub enumeration: Value,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub key: String,
    pub name: String,
    pub path: Option<String>,
    pub available: bool,
    pub implemented: bool,
    pub purpose: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub record: CommandRecord,
    pub fields: Option<Value>,
    pub parse_error: Option<String>,
}
impl Serialize for QueryResult {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let topology = crate::topology::connection_nodes(self.fields.as_ref());
        let mut map = serializer.serialize_map(Some(if topology.is_some() { 4 } else { 3 }))?;
        map.serialize_entry("record", &self.record)?;
        map.serialize_entry("fields", &self.fields)?;
        map.serialize_entry("parseError", &self.parse_error)?;
        if let Some(nodes) = topology {
            map.serialize_entry("topology", &nodes)?;
        }
        map.end()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEvent {
    pub observed_at: u64,
    pub line: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartRequest {
    pub token: String,
    #[serde(default)]
    pub device_type: Option<String>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Protocol numbers travel as decimal strings; the original bytes remain in the transcript.
pub fn exact_json(value: Value) -> Value {
    match value {
        Value::Number(number) => Value::String(number.to_string()),
        Value::Array(values) => Value::Array(values.into_iter().map(exact_json).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, exact_json(value)))
                .collect(),
        ),
        other => other,
    }
}

pub fn plist_json(value: plist::Value) -> Value {
    match value {
        plist::Value::Array(values) => Value::Array(values.into_iter().map(plist_json).collect()),
        plist::Value::Dictionary(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, plist_json(value)))
                .collect(),
        ),
        plist::Value::Boolean(value) => Value::Bool(value),
        plist::Value::String(value) => Value::String(value),
        plist::Value::Integer(value) => Value::String(
            value
                .as_signed()
                .map(|v| v.to_string())
                .or_else(|| value.as_unsigned().map(|v| v.to_string()))
                .unwrap_or_default(),
        ),
        plist::Value::Real(value) => Value::String(value.to_string()),
        plist::Value::Date(value) => Value::String(value.to_xml_format()),
        plist::Value::Data(value) => {
            use base64::Engine;
            serde_json::json!({ "$type": "data", "base64": base64::engine::general_purpose::STANDARD.encode(value) })
        }
        plist::Value::Uid(value) => {
            serde_json::json!({ "$type": "uid", "value": value.get().to_string() })
        }
        _ => Value::Null,
    }
}

pub fn parse_plist(bytes: &[u8]) -> Result<Value, String> {
    plist::Value::from_reader(std::io::Cursor::new(bytes))
        .map(plist_json)
        .map_err(|e| format!("Cannot parse the tool's property list: {e}"))
}

pub fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_unknown_fields_and_integers_above_javascript_precision() {
        let input = br#"{"vendor_extension":{"counter":18446744073709551615,"flags":0},"unknown":null,"supported":false}"#;
        let exact = exact_json(serde_json::from_slice(input).unwrap());
        assert_eq!(exact["vendor_extension"]["counter"], "18446744073709551615");
        assert_eq!(exact["vendor_extension"]["flags"], "0");
        assert_eq!(exact["supported"], false);
        assert!(exact["unknown"].is_null());
    }

    #[test]
    fn plist_retains_zero_false_empty_collections_and_vendor_fields() {
        let value = parse_plist(br#"<?xml version="1.0"?><plist version="1.0"><dict><key>Size</key><integer>18446744073709551615</integer><key>VendorFlag</key><integer>0</integer><key>Internal</key><false/><key>Extra</key><array/></dict></plist>"#).unwrap();
        assert_eq!(value["Size"], "18446744073709551615");
        assert_eq!(value["VendorFlag"], "0");
        assert_eq!(value["Internal"], false);
        assert_eq!(value["Extra"], serde_json::json!([]));
    }
}
