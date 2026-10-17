//! Published host metadata for storage that has not become a listed block device.
//! These observations deliberately never create Device tokens or /dev paths.
use crate::model::{string_field, UnavailableMedia};
use serde_json::{json, Value};
use std::collections::HashSet;

fn children(v: &Value) -> impl Iterator<Item = &Value> {
    v["IORegistryEntryChildren"]
        .as_array()
        .into_iter()
        .flatten()
}
fn roots(v: &Value) -> impl Iterator<Item = &Value> {
    v.as_array().into_iter().flatten()
}
fn class(v: &Value) -> &str {
    v["IOObjectClass"].as_str().unwrap_or("")
}
fn properties(v: &Value) -> Value {
    let mut copy = v.clone();
    if let Some(map) = copy.as_object_mut() {
        map.remove("IORegistryEntryChildren");
    }
    copy
}
fn descendants<'a>(v: &'a Value, out: &mut Vec<&'a Value>, depth: usize) {
    if depth >= 64 {
        return;
    }
    for c in children(v) {
        // Each nested USB device owns its own storage branch, including devices on a hub.
        if matches!(class(c), "IOUSBHostDevice" | "IOUSBDevice") {
            continue;
        }
        out.push(c);
        descendants(c, out, depth + 1);
    }
}
fn whole(v: &Value) -> bool {
    class(v) == "IOMedia" && v["Whole"].as_bool() == Some(true)
}
fn id(v: &Value) -> Option<String> {
    string_field(v, "IORegistryEntryID")
}
fn observation(
    usb: Option<&Value>,
    media: Option<&Value>,
    chain: &[&Value],
    at: u64,
    suffix: &str,
    listing_ok: bool,
) -> UnavailableMedia {
    let bsd_name = media
        .and_then(|m| string_field(m, "BSD Name"))
        .filter(|s| !s.is_empty());
    let stage = if media.is_none() {
        "interface-only"
    } else if bsd_name.is_none() {
        "media-unassigned"
    } else if listing_ok {
        "not-listed"
    } else {
        "enumeration-unavailable"
    };
    let name = usb
        .and_then(|u| {
            string_field(u, "USB Product Name").or_else(|| string_field(u, "IORegistryEntryName"))
        })
        .or_else(|| media.and_then(|m| string_field(m, "IORegistryEntryName")))
        .unwrap_or_else(|| "Observed storage".into());
    let uas = chain
        .iter()
        .any(|v| string_field(v, "bInterfaceProtocol").as_deref() == Some("98"));
    let bulk = chain
        .iter()
        .any(|v| string_field(v, "bInterfaceProtocol").as_deref() == Some("80"));
    UnavailableMedia {
        id: format!(
            "observed:{}",
            media
                .and_then(id)
                .or_else(|| usb.and_then(id))
                .unwrap_or_else(|| suffix.into())
        ),
        name,
        stage: stage.into(),
        size_bytes: media.and_then(|m| string_field(m, "Size")),
        bsd_name,
        transport: usb.map(|_| {
            if uas {
                "USB · UAS interface reported"
            } else if bulk {
                "USB · bulk-only interface reported"
            } else {
                "USB"
            }
            .into()
        }),
        observed_at: at,
        fields: json!({"usb":usb.map(properties),"media":media.map(properties),"driverChain":chain.iter().map(|v|properties(v)).collect::<Vec<_>>()}),
    }
}
pub fn unavailable(
    usb_services: &Value,
    media_registry: &Value,
    listed: &HashSet<String>,
    listing_ok: bool,
    at: u64,
) -> Vec<UnavailableMedia> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    fn walk(
        v: &Value,
        listed: &HashSet<String>,
        listing_ok: bool,
        at: u64,
        out: &mut Vec<UnavailableMedia>,
        seen: &mut HashSet<String>,
        depth: usize,
    ) {
        if depth >= 64 {
            return;
        }
        if matches!(class(v), "IOUSBHostDevice" | "IOUSBDevice") {
            if id(v).is_some_and(|key| !seen.insert(format!("usb:{key}"))) {
                return;
            }
            let mut chain = vec![];
            descendants(v, &mut chain, 0);
            let media: Vec<_> = chain.iter().copied().filter(|v| whole(v)).collect();
            let storage = !media.is_empty()
                || chain
                    .iter()
                    .any(|v| string_field(v, "bInterfaceClass").as_deref() == Some("8"));
            if storage {
                if media.is_empty() {
                    out.push(observation(
                        Some(v),
                        None,
                        &chain,
                        at,
                        &format!("usb-{}", out.len()),
                        listing_ok,
                    ));
                }
                for m in media {
                    if let Some(key) = id(m) {
                        seen.insert(key);
                    }
                    if string_field(m, "BSD Name").is_some_and(|s| listed.contains(&s)) {
                        continue;
                    }
                    out.push(observation(
                        Some(v),
                        Some(m),
                        &chain,
                        at,
                        &format!("media-{}", out.len()),
                        listing_ok,
                    ));
                }
            }
        }
        for c in children(v) {
            walk(c, listed, listing_ok, at, out, seen, depth + 1);
        }
    }
    for v in roots(usb_services) {
        walk(v, listed, listing_ok, at, &mut out, &mut seen, 0);
    }
    // Covers non-USB media too; do not confuse normal synthesized APFS disks with omissions
    // from diskutil's physical-only listing. A BSD name on an isolated node is insufficient.
    for m in roots(media_registry).filter(|m| whole(m)) {
        if string_field(m, "BSD Name").is_some_and(|s| !s.is_empty()) {
            continue;
        }
        if id(m).is_some_and(|key| seen.contains(&key)) {
            continue;
        }
        let mut chain = vec![];
        descendants(m, &mut chain, 0);
        out.push(observation(
            None,
            Some(m),
            &chain,
            at,
            &format!("isolated-{}", out.len()),
            listing_ok,
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn media(bsd: Option<&str>) -> Value {
        let mut m = json!({"IOObjectClass":"IOMedia","Whole":true,"Size":"256060514304","Preferred Block Size":"512","IORegistryEntryID":"102","IORegistryEntryName":"Fixture SSD Media","Open":true,"IOServiceBusyState":"1"});
        if let Some(bsd) = bsd {
            m["BSD Name"] = json!(bsd);
        }
        m
    }
    fn usb(m: Value) -> Value {
        json!([{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"100","USB Product Name":"Fixture SSD","IORegistryEntryChildren":[{"IOObjectClass":"IOUSBHostInterface","bInterfaceClass":"8","bInterfaceProtocol":"98","IORegistryEntryChildren":[m]}]}])
    }
    #[test]
    fn nested_usb_matches_returned_again_as_roots_are_not_duplicate_media() {
        let u = usb(media(None));
        let hub = json!({"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"99","IORegistryEntryChildren":u});
        let mut roots = vec![hub];
        roots.extend(u.as_array().unwrap().clone());
        assert_eq!(
            unavailable(&json!(roots), &Value::Null, &HashSet::new(), true, 1).len(),
            1
        );
    }
    #[test]
    fn real_case_shape_unassigned_media_is_visible_once_with_exact_capacity() {
        let m = media(None);
        let a = unavailable(&usb(m.clone()), &json!([m]), &HashSet::new(), true, 7);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].stage, "media-unassigned");
        assert_eq!(a[0].size_bytes.as_deref(), Some("256060514304"));
        assert!(a[0].bsd_name.is_none());
        assert_eq!(a[0].fields["media"]["Open"], true);
        assert_eq!(a[0].observed_at, 7);
    }
    #[test]
    fn promotion_to_a_listed_disk_removes_unavailable_observation() {
        assert!(unavailable(
            &usb(media(Some("disk9"))),
            &Value::Null,
            &HashSet::from(["disk9".into()]),
            true,
            1
        )
        .is_empty());
        assert_eq!(
            unavailable(
                &usb(media(Some("disk9"))),
                &Value::Null,
                &HashSet::new(),
                true,
                1
            )[0]
            .stage,
            "not-listed"
        );
        assert_eq!(
            unavailable(
                &usb(media(Some("disk9"))),
                &Value::Null,
                &HashSet::new(),
                false,
                1
            )[0]
            .stage,
            "enumeration-unavailable"
        );
    }
    #[test]
    fn interface_without_media_is_distinct_from_usb_device_and_hub() {
        let a = unavailable(&usb(Value::Null), &Value::Null, &HashSet::new(), true, 1);
        assert_eq!(a[0].stage, "interface-only");
        assert!(a[0].size_bytes.is_none());
        let hub = json!([{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"99","IORegistryEntryChildren":usb(media(None))}]);
        assert_eq!(
            unavailable(&hub, &Value::Null, &HashSet::new(), true, 1).len(),
            1
        );
        assert!(unavailable(
            &json!([{"IOObjectClass":"IOUSBHostDevice","USB Product Name":"Camera"}]),
            &Value::Null,
            &HashSet::new(),
            true,
            1
        )
        .is_empty());
    }
    #[test]
    fn non_usb_unassigned_media_kept_and_synthetic_disks_ignored() {
        let a = unavailable(
            &Value::Null,
            &json!([media(None),media(Some("disk3")),{"Whole":true}]),
            &HashSet::new(),
            true,
            1,
        );
        assert_eq!(a.len(), 1);
        assert!(a[0].transport.is_none());
    }
}
