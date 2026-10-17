//! One hardware tree shared by the main window and native menu. Reports stay intact.
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub source: String,
    pub raw_name: String,
    pub relation: String,
    pub fields: Value,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub source: String,
    pub fields: Value,
    pub observations: Vec<Observation>,
    pub children: Vec<Node>,
    pub disk_ids: Vec<String>,
}
fn text(v: &Value, key: &str) -> Option<String> {
    match &v[key] {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().into()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
fn number(v: &Value, key: &str) -> Option<u64> {
    let s = text(v, key)?;
    let s = s.split('/').next()?.split_whitespace().next()?;
    if let Some(hex) = s.strip_prefix("0x") {
        u64::from_str_radix(hex, 16).ok()
    } else {
        s.parse().ok()
    }
}
fn objects(v: &Value) -> Vec<&Value> {
    match v {
        Value::Array(a) => a.iter().filter(|x| x.is_object()).collect(),
        Value::Object(_) => vec![v],
        _ => vec![],
    }
}
fn properties(v: &Value) -> Value {
    let mut fields = v.clone();
    if let Some(map) = fields.as_object_mut() {
        for key in ["_items", "Media", "volumes", "IORegistryEntryChildren"] {
            map.remove(key);
        }
    }
    fields
}
fn raw_name(v: &Value) -> String {
    [
        "USB Product Name",
        "_name",
        "IORegistryEntryName",
        "product",
        "device_name",
        "sysfsName",
    ]
    .iter()
    .find_map(|k| text(v, k))
    .unwrap_or_else(|| "Unnamed entry".into())
}
fn evidence(v: &Value, source: &str, relation: &str) -> Observation {
    Observation {
        source: source.into(),
        raw_name: raw_name(v),
        relation: relation.into(),
        fields: properties(v),
    }
}
fn node(id: String, label: String, kind: &str, v: &Value, source: &str) -> Node {
    let disk_ids = ["bsd_name", "BSD Name", "DeviceIdentifier", "kname"]
        .iter()
        .filter_map(|k| text(v, k))
        .collect();
    Node {
        id,
        label,
        kind: kind.into(),
        source: source.into(),
        fields: properties(v),
        observations: vec![evidence(v, source, "Reported hierarchy")],
        children: vec![],
        disk_ids,
    }
}
fn find_mut<'a>(nodes: &'a mut [Node], id: &str) -> Option<&'a mut Node> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(found) = find_mut(&mut n.children, id) {
            return Some(found);
        }
    }
    None
}
fn each<'a>(nodes: &'a [Node], out: &mut Vec<&'a Node>) {
    for n in nodes {
        out.push(n);
        each(&n.children, out);
    }
}
fn descendants<'a>(v: &'a Value, key: &str, out: &mut Vec<&'a Value>, depth: usize) {
    if depth >= 64 {
        return;
    }
    for c in objects(&v[key]) {
        out.push(c);
        descendants(c, key, out, depth + 1);
    }
}
fn whole(v: &Value) -> bool {
    v["Whole"].as_bool() == Some(true) || text(v, "Whole").as_deref() == Some("true")
}
fn hardware(v: &Value, path: &str, depth: usize) -> Vec<Node> {
    if depth >= 64 {
        return vec![];
    }
    let class = text(v, "IOObjectClass").unwrap_or_default();
    let children: Vec<Node> = objects(&v["IORegistryEntryChildren"])
        .iter()
        .enumerate()
        .flat_map(|(i, c)| hardware(c, &format!("{path}/{i}"), depth + 1))
        .collect();
    let is_usb = class == "IOUSBHostDevice" || class == "IOUSBDevice";
    let is_media = class == "IOMedia" && whole(v);
    if !is_usb && !is_media {
        return children;
    }
    let id = number(v, "IORegistryEntryID")
        .map(|x| format!("registry:{x}"))
        .unwrap_or_else(|| format!("registry-path:{path}"));
    let raw = raw_name(v);
    let storage = is_media
        || children
            .iter()
            .any(|n| !n.disk_ids.is_empty() || n.kind == "Storage media");
    let hub = number(v, "bDeviceClass") == Some(9) || raw.to_lowercase().contains("hub");
    let (label, kind) = if is_media {
        (
            format!(
                "Storage media · {}",
                text(v, "BSD Name").unwrap_or_else(|| "unassigned".into())
            ),
            "Storage media",
        )
    } else if hub {
        (
            if number(v, "bcdUSB").is_some_and(|x| x >= 0x300) {
                "USB 3 hub"
            } else {
                "USB hub"
            }
            .into(),
            "USB hub",
        )
    } else if storage {
        (format!("USB storage · {raw}"), "USB storage device")
    } else if raw == "USB Type-C Digital AV Adapter" {
        ("USB-C display adapter".into(), "USB adapter")
    } else {
        (raw.clone(), "USB device")
    };
    let mut n = node(id, label, kind, v, "IORegistry · USB host hierarchy");
    n.children = children;
    vec![n]
}
fn sp_media(v: &Value, path: &str, depth: usize) -> Vec<Node> {
    if depth >= 64 {
        return vec![];
    }
    let mut out = vec![];
    for (i, c) in objects(&v["Media"])
        .into_iter()
        .chain(objects(&v["volumes"]))
        .enumerate()
    {
        let id = text(c, "bsd_name")
            .map(|x| format!("media:{x}"))
            .unwrap_or_else(|| format!("{path}/media/{i}"));
        let label = text(c, "bsd_name")
            .map(|id| format!("{} · {id}", raw_name(c)))
            .unwrap_or_else(|| raw_name(c));
        let mut n = node(id, label, "Reported volume", c, "System Profiler · storage");
        n.children = sp_media(c, &format!("{path}/{i}"), depth + 1);
        out.push(n);
    }
    out
}
fn append_media(n: &mut Node, media: Node) {
    let existing = media.disk_ids.first().and_then(|id| {
        let mut all = vec![];
        each(&n.children, &mut all);
        all.into_iter()
            .find(|c| c.disk_ids.contains(id))
            .map(|c| c.id.clone())
    });
    if let Some(id) = existing {
        if let Some(target) = find_mut(&mut n.children, &id) {
            target.observations.extend(media.observations);
            target.children.extend(media.children);
        }
    } else {
        n.children.push(media);
    }
}
fn thunderbolt_device(v: &Value, path: &str, depth: usize) -> Node {
    let mut n = node(
        format!("thunderbolt:{path}"),
        raw_name(v),
        "Thunderbolt device",
        v,
        "System Profiler · Thunderbolt",
    );
    if depth < 64 {
        for (i, c) in objects(&v["_items"]).iter().enumerate() {
            n.children
                .push(thunderbolt_device(c, &format!("{path}/{i}"), depth + 1));
        }
        n.children.extend(sp_media(v, path, depth));
    }
    n
}
fn compatible(a: &Value, b: &Value) -> bool {
    if let (Some(a), Some(b)) = (text(a, "USB Serial Number"), text(b, "serial_num")) {
        if a != b {
            return false;
        }
    }
    for (ak, bk) in [("idVendor", "vendor_id"), ("idProduct", "product_id")] {
        if let (Some(a), Some(b)) = (number(a, ak), number(b, bk)) {
            if a != b {
                return false;
            }
        }
    }
    true
}
fn sp_usb(
    v: &Value,
    path: &str,
    parent: Option<&str>,
    roots: &mut Vec<Node>,
    matches: &HashMap<u64, Vec<String>>,
    sp_counts: &HashMap<u64, usize>,
    depth: usize,
) {
    if depth >= 64 {
        return;
    }
    let location = number(v, "location_id");
    // A bus heading is evidence about a controller, not a second physical connector.
    let is_device = location.is_some() || v.get("vendor_id").is_some() || v.get("Media").is_some();
    let mut current = parent.map(str::to_owned);
    if is_device {
        let matched = location
            .filter(|l| sp_counts.get(l) == Some(&1))
            .and_then(|l| matches.get(&l))
            .filter(|ids| ids.len() == 1)
            .and_then(|ids| {
                let id = &ids[0];
                let n = find_mut(roots, id)?;
                compatible(&n.fields, v).then_some(id.clone())
            });
        if let Some(id) = matched {
            if let Some(n) = find_mut(roots, &id) {
                n.observations.push(evidence(
                    v,
                    "System Profiler · USB",
                    "Unique USB location ID and compatible vendor/product IDs",
                ));
                for media in sp_media(v, path, 0) {
                    append_media(n, media);
                }
                if !n.children.is_empty()
                    && n.children.iter().any(|c| !c.disk_ids.is_empty())
                    && n.kind == "USB device"
                {
                    n.kind = "USB storage device".into();
                    n.label = format!("USB storage · {}", raw_name(v));
                }
            }
            current = Some(id);
        } else {
            let id = location
                .map(|l| format!("usb-location:{l}:{path}"))
                .unwrap_or_else(|| format!("usb-report:{path}"));
            let hub = raw_name(v).to_lowercase().contains("hub");
            let storage = !objects(&v["Media"]).is_empty();
            let label = if hub {
                "USB hub".into()
            } else if storage {
                format!("USB storage · {}", raw_name(v))
            } else {
                raw_name(v)
            };
            let mut n = node(
                id.clone(),
                label,
                if hub {
                    "USB hub"
                } else if storage {
                    "USB storage device"
                } else {
                    "USB device"
                },
                v,
                "System Profiler · USB",
            );
            n.children = sp_media(v, path, 0);
            if let Some(p) = parent.and_then(|id| find_mut(roots, id)) {
                p.children.push(n)
            } else {
                roots.push(n)
            }
            current = Some(id);
        }
    }
    for (i, c) in objects(&v["_items"]).iter().enumerate() {
        sp_usb(
            c,
            &format!("{path}/{i}"),
            current.as_deref(),
            roots,
            matches,
            sp_counts,
            depth + 1,
        )
    }
}
fn mac(fields: &Value) -> Vec<Node> {
    let ports = objects(&fields["IORegistryPortReport"]["fields"]);
    let mut nested = vec![];
    for p in &ports {
        descendants(p, "IORegistryEntryChildren", &mut nested, 0);
    }
    let nested_ids: HashSet<_> = nested
        .into_iter()
        .filter_map(|n| number(n, "IORegistryEntryID"))
        .collect();
    let mut groups: BTreeMap<u64, Node> = BTreeMap::new();
    let mut roots = vec![];
    for (i, p) in ports.iter().enumerate() {
        if number(p, "IORegistryEntryID").is_some_and(|id| nested_ids.contains(&id)) {
            continue;
        }
        let physical = number(p, "UsbCPortNumber").filter(|p| *p > 0);
        let id = physical.map(|n| format!("usb-c:{n}")).unwrap_or_else(|| {
            number(p, "IORegistryEntryID")
                .map(|n| format!("host-port:{n}"))
                .unwrap_or_else(|| format!("host-port-path:{i}"))
        });
        let mut children = hardware(p, &format!("host/{i}"), 0);
        if let Some(port) = physical {
            let n = groups.entry(port).or_insert_with(|| Node {
                id: id.clone(),
                label: format!("USB-C port {port}"),
                kind: "Host connector".into(),
                source: "macOS host port number".into(),
                fields: Value::Null,
                observations: vec![],
                children: vec![],
                disk_ids: vec![],
            });
            n.observations.push(evidence(
                p,
                "IORegistry · USB host port",
                "Explicit UsbCPortNumber on a host-port root",
            ));
            n.children.append(&mut children);
        } else {
            let mut n = node(
                id,
                format!("USB host port {}", i + 1),
                "Host port",
                p,
                "IORegistry · USB host port",
            );
            n.children = children;
            roots.push(n);
        }
    }
    roots.extend(groups.into_values());
    // The USB plane can expose devices absent from a partial host-port report. Registry IDs
    // identify shared entries; model names and serial-number similarity never join branches.
    let mut registry_nodes = vec![];
    for (i, p) in objects(&fields["IORegistryUSBReport"]["fields"])
        .iter()
        .enumerate()
    {
        registry_nodes.extend(hardware(p, &format!("usb/{i}"), 0));
    }
    fn merge_registry(n: Node, roots: &mut Vec<Node>, parent: Option<&str>) {
        if let Some(existing) = find_mut(roots, &n.id) {
            if n.kind == "USB storage device" {
                existing.kind = n.kind.clone();
                existing.label = n.label.clone();
            }
            existing.observations.extend(n.observations);
        } else {
            let mut copy = n.clone();
            copy.children.clear();
            if let Some(p) = parent.and_then(|id| find_mut(roots, id)) {
                p.children.push(copy)
            } else {
                roots.push(copy)
            }
        }
        for c in n.children {
            merge_registry(c, roots, Some(&n.id))
        }
    }
    for n in registry_nodes {
        merge_registry(n, &mut roots, None)
    }
    for (i, p) in objects(&fields["IORegistryStorageReport"]["fields"])
        .iter()
        .enumerate()
    {
        for n in hardware(p, &format!("storage-service/{i}"), 0) {
            merge_registry(n, &mut roots, None);
        }
    }
    let mut flat = vec![];
    each(&roots, &mut flat);
    let mut matches: HashMap<u64, Vec<String>> = HashMap::new();
    for n in flat {
        if n.kind.starts_with("USB") {
            if let Some(loc) = number(&n.fields, "locationID") {
                matches.entry(loc).or_default().push(n.id.clone());
            }
        }
    }
    let usb = objects(&fields["SPUSBDataType"]);
    let mut all_sp = vec![];
    for p in &usb {
        all_sp.push(*p);
        descendants(p, "_items", &mut all_sp, 0);
    }
    let mut counts = HashMap::new();
    for p in all_sp {
        if let Some(loc) = number(p, "location_id") {
            *counts.entry(loc).or_insert(0) += 1;
        }
    }
    for (i, p) in usb.iter().enumerate() {
        sp_usb(p, &i.to_string(), None, &mut roots, &matches, &counts, 0);
    }
    // Thunderbolt observations use their own route hierarchy. A unique host receptacle
    // number can enrich an existing USB-C connector; a bus label is never another port.
    let mut tb_counts = HashMap::new();
    let tb = objects(&fields["SPThunderboltDataType"]);
    for bus in &tb {
        if let Some(m) = bus.as_object() {
            for (k, p) in m {
                if k.starts_with("receptacle_") && k.ends_with("_tag") {
                    if let Some(id) = number(p, "receptacle_id_key") {
                        *tb_counts.entry(id).or_insert(0) += 1;
                    }
                }
            }
        }
    }
    for (i, bus) in tb.iter().enumerate() {
        let receptacles: Vec<_> = bus
            .as_object()
            .into_iter()
            .flat_map(|m| m.iter())
            .filter(|(k, _)| k.starts_with("receptacle_") && k.ends_with("_tag"))
            .collect();
        let children = objects(&bus["_items"]);
        for (key, p) in receptacles {
            let num = number(p, "receptacle_id_key");
            let candidate = num
                .filter(|n| tb_counts.get(n) == Some(&1))
                .map(|n| format!("usb-c:{n}"));
            if let Some(n) = candidate.as_deref().and_then(|id| find_mut(&mut roots, id)) {
                let mut observation = evidence(
                    p,
                    "System Profiler · Thunderbolt port",
                    "Unique host receptacle number matches UsbCPortNumber",
                );
                observation.raw_name = key.clone();
                n.observations.push(observation);
                n.observations.push(evidence(
                    bus,
                    "System Profiler · Thunderbolt controller",
                    "Reported parent of this receptacle",
                ));
            } else {
                roots.push(node(
                    format!("tb:{i}/{key}"),
                    num.map(|n| format!("Thunderbolt port {n}"))
                        .unwrap_or_else(|| "Thunderbolt port".into()),
                    "Thunderbolt connector",
                    p,
                    "System Profiler · Thunderbolt",
                ));
            }
        }
        if !children.is_empty() {
            // Without an explicit per-child receptacle ID, retain one bus subtree rather
            // than arbitrarily moving a connected device beneath a physical connector.
            let mut n = node(
                format!("tb-devices:{i}"),
                format!("Thunderbolt devices · controller {}", i + 1),
                "Thunderbolt route",
                bus,
                "System Profiler · Thunderbolt",
            );
            for (j, c) in children.iter().enumerate() {
                n.children
                    .push(thunderbolt_device(c, &format!("{i}/{j}"), 0));
            }
            roots.push(n);
        }
    }
    for (i, controller) in objects(&fields["SPNVMeDataType"]).iter().enumerate() {
        if objects(&controller["_items"]).is_empty() {
            roots.push(node(
                format!("nvme-controller:{i}"),
                format!("Storage controller {}", i + 1),
                "NVMe controller",
                controller,
                "System Profiler · NVMe",
            ));
        }
        for (j, drive) in objects(&controller["_items"]).iter().enumerate() {
            let disk = text(drive, "bsd_name");
            let label = disk
                .as_ref()
                .map(|id| format!("NVMe drive · {id}"))
                .unwrap_or_else(|| "NVMe drive".into());
            let mut n = node(
                disk.map(|id| format!("storage:{id}"))
                    .unwrap_or_else(|| format!("nvme:{i}/{j}")),
                label,
                "NVMe storage",
                drive,
                "System Profiler · NVMe",
            );
            n.observations.push(evidence(
                controller,
                "System Profiler · NVMe controller",
                "Reported storage controller",
            ));
            n.children = sp_media(drive, &n.id, 0);
            roots.push(n);
        }
    }
    roots
}
fn linux(fields: &Value) -> Vec<Node> {
    let mut roots = vec![];
    for (key, prefix) in [("USBDevices", "USB"), ("ThunderboltDevices", "Thunderbolt")] {
        let entries = objects(&fields[key]);
        let by_name: HashMap<String, &Value> = entries
            .iter()
            .filter_map(|v| text(v, "sysfsName").map(|n| (n, *v)))
            .collect();
        let parent_of = |v: &Value| -> Option<String> {
            let parent = text(v, "parentSysfsName")?;
            let mut cursor = Some(parent.clone());
            let mut seen = HashSet::from([text(v, "sysfsName")?]);
            while let Some(id) = cursor {
                if !seen.insert(id.clone()) {
                    return None;
                }
                cursor = by_name.get(&id).and_then(|v| text(v, "parentSysfsName"));
            }
            by_name.contains_key(&parent).then_some(parent)
        };
        fn make(
            v: &Value,
            entries: &[&Value],
            parent_of: &dyn Fn(&Value) -> Option<String>,
            prefix: &str,
            depth: usize,
        ) -> Node {
            let name = text(v, "sysfsName").unwrap_or_default();
            let hub = number(v, "bDeviceClass") == Some(9)
                || text(v, "bDeviceClass").as_deref() == Some("09");
            let label = if name.starts_with("usb") {
                format!("USB controller {}", name.trim_start_matches("usb"))
            } else if hub {
                "USB hub".into()
            } else {
                text(v, "product")
                    .or_else(|| text(v, "device_name"))
                    .unwrap_or_else(|| format!("{prefix} device · {name}"))
            };
            let mut n = node(
                format!("sysfs:{}", text(v, "sysfsPath").unwrap_or(name.clone())),
                label,
                if hub { "USB hub" } else { "Connected device" },
                v,
                "Linux sysfs",
            );
            if depth < 64 {
                for c in entries {
                    if parent_of(c).as_deref() == Some(&name) {
                        if prefix == "USB" && text(c, "sysfsName").is_some_and(|s| s.contains(':'))
                        {
                            n.observations.push(evidence(
                                c,
                                "Linux sysfs · USB interface",
                                "Explicit interface parent; not a second physical device",
                            ));
                        } else {
                            n.children
                                .push(make(c, entries, parent_of, prefix, depth + 1));
                        }
                    }
                }
            }
            n
        }
        for v in &entries {
            if parent_of(v).is_none() {
                roots.push(make(v, &entries, &parent_of, prefix, 0));
            }
        }
    }
    for block in objects(&fields["BlockNodes"]) {
        let Some(path) = text(block, "sysfsPath") else {
            continue;
        };
        let mut flat = vec![];
        each(&roots, &mut flat);
        let parent = flat
            .into_iter()
            .filter_map(|n| {
                text(&n.fields, "sysfsPath")
                    .filter(|p| path.starts_with(&(p.clone() + "/")))
                    .map(|p| (p.len(), n.id.clone()))
            })
            .max();
        if let Some((_, id)) = parent {
            if let Some(n) = find_mut(&mut roots, &id) {
                let disk = text(block, "sysfsName").unwrap_or_default();
                let mut b = node(
                    format!("block:{path}"),
                    format!("Storage drive · {disk}"),
                    "Storage media",
                    block,
                    "Linux sysfs · block ancestry",
                );
                b.disk_ids = vec![disk];
                n.children.push(b);
            }
        }
    }
    roots
}
pub fn connection_nodes(fields: Option<&Value>) -> Option<Vec<Node>> {
    let f = fields?;
    if [
        "SPUSBDataType",
        "SPThunderboltDataType",
        "SPNVMeDataType",
        "IORegistryUSBReport",
        "IORegistryPortReport",
        "IORegistryStorageReport",
    ]
    .iter()
    .any(|k| f.get(k).is_some())
    {
        Some(mac(f))
    } else if f.get("USBDevices").is_some() || f.get("ThunderboltDevices").is_some() {
        Some(linux(f))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn usb_service_plane_adds_unassigned_media_without_duplicating_its_bridge() {
        let bridge = json!({"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"100","USB Product Name":"Fixture SSD"});
        let mut service = bridge.clone();
        service["IORegistryEntryChildren"] = json!([{"IOObjectClass":"IOUSBMassStorageUASDriver","IORegistryEntryChildren":[{"IOObjectClass":"IOMedia","IORegistryEntryID":"102","Whole":true,"Size":"256060514304"}]}]);
        let f = json!({"IORegistryUSBReport":{"fields":[bridge]},"IORegistryStorageReport":{"fields":[service]}});
        let nodes = connection_nodes(Some(&f)).unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].kind, "USB storage device");
        assert_eq!(nodes[0].children.len(), 1);
        assert_eq!(nodes[0].children[0].fields["Size"], "256060514304");
        assert!(nodes[0].children[0].disk_ids.is_empty());
    }
    #[test]
    fn usb_interfaces_enrich_one_linux_device_instead_of_creating_duplicate_hardware() {
        let f = json!({"USBDevices":[{"sysfsName":"1-1","product":"USB bridge"},{"sysfsName":"1-1:1.0","parentSysfsName":"1-1","authorized":"1"},{"sysfsName":"1-1:1.1","parentSysfsName":"1-1","future":"x"}]});
        let roots = connection_nodes(Some(&f)).unwrap();
        assert_eq!(roots.len(), 1);
        assert!(roots[0].children.is_empty());
        assert_eq!(roots[0].observations.len(), 3);
        assert_eq!(roots[0].observations[2].fields["future"], "x");
    }
    #[test]
    fn old_reports_get_the_shared_tree_without_changing_the_original_fields() {
        let original = json!({"record":{"id":"fixture","program":"system_profiler","arguments":[],"startedAt":1,"durationMs":1,"exitCode":0,"timedOut":false,"stdout":"original","stderr":"","stdoutBase64":"b3JpZ2luYWw=","stderrBase64":"","stdoutUtf8Valid":true,"stderrUtf8Valid":true,"launchError":null},"fields":{"IORegistryPortReport":{"fields":[{"UsbCPortNumber":"1","future":"18446744073709551615"}]}},"parseError":null,"topology":[{"obsolete":true}]});
        let report: crate::model::QueryResult = serde_json::from_value(original.clone()).unwrap();
        let rendered = serde_json::to_value(report).unwrap();
        assert_eq!(rendered["fields"], original["fields"]);
        assert_eq!(
            rendered["record"],
            serde_json::to_value(
                serde_json::from_value::<crate::model::CommandRecord>(original["record"].clone())
                    .unwrap()
            )
            .unwrap()
        );
        assert_eq!(rendered["topology"][0]["label"], "USB-C port 1");
    }
    #[test]
    fn one_connector_has_both_usb_paths_and_thunderbolt_without_losing_properties() {
        let f = json!({"IORegistryPortReport":{"fields":[{"UsbCPortNumber":"1","IORegistryEntryID":"10","IORegistryEntryName":"usb-drd0-port-hs","kUSBWakePortCurrentLimit":"3000"},{"UsbCPortNumber":"1","IORegistryEntryID":"11","IORegistryEntryName":"usb-drd0-port-ss","link-error-count":"0"}]},"SPThunderboltDataType":[{"_name":"thunderboltusb4_bus_0","receptacle_1_tag":{"receptacle_id_key":"1","receptacle_status_key":"receptacle_no_devices_connected"}}]});
        let roots = connection_nodes(Some(&f)).unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].label, "USB-C port 1");
        assert_eq!(roots[0].observations.len(), 4);
        assert!(roots[0].fields.is_null());
        assert_eq!(
            roots[0].observations[0].fields["kUSBWakePortCurrentLimit"],
            "3000"
        );
        assert_eq!(roots[0].observations[1].fields["link-error-count"], "0");
    }
    #[test]
    fn device_in_three_reports_is_one_node_with_exact_original_evidence() {
        let usb = json!({"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"9007199254740993","locationID":"2097152","USB Product Name":"Bridge","idVendor":"1234"});
        let f = json!({"IORegistryPortReport":{"fields":[{"UsbCPortNumber":"1","IORegistryEntryChildren":[usb.clone()]}]},"IORegistryUSBReport":{"fields":[usb]},"SPUSBDataType":[{"_name":"USB31Bus","_items":[{"_name":"Bridge","location_id":"0x00200000 / 3","vendor_id":"1234","bus_power_used":"224","future":"18446744073709551615"}]}]});
        let roots = connection_nodes(Some(&f)).unwrap();
        let mut all = vec![];
        each(&roots, &mut all);
        let matching: Vec<_> = all
            .iter()
            .filter(|n| n.id == "registry:9007199254740993")
            .collect();
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].observations.len(), 3);
        assert_eq!(
            matching[0].observations[2].fields["future"],
            "18446744073709551615"
        );
        assert!(matching[0].disk_ids.is_empty());
    }
    #[test]
    fn names_alone_and_ambiguous_or_changed_locations_never_merge() {
        let f = json!({"IORegistryUSBReport":{"fields":[{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"1","locationID":"5","idVendor":"1","USB Product Name":"Same"},{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"2","locationID":"5","USB Product Name":"Same"}]},"SPUSBDataType":[{"_name":"Same","location_id":"5","vendor_id":"2"}]});
        let roots = connection_nodes(Some(&f)).unwrap();
        assert_eq!(roots.len(), 3);
        assert!(roots.iter().all(|n| n.observations.len() == 1));
        let different_vendor = json!({"IORegistryUSBReport":{"fields":[{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"1","locationID":"5","idVendor":"1","USB Product Name":"Same"}]},"SPUSBDataType":[{"_name":"Same","location_id":"0x00000005 / 3","vendor_id":"0x0002 (Different vendor)"}]});
        assert_eq!(connection_nodes(Some(&different_vendor)).unwrap().len(), 2);
    }
    #[test]
    fn distinct_ports_and_media_without_readable_namespace_are_preserved() {
        let f = json!({"IORegistryPortReport":{"fields":[{"UsbCPortNumber":"1"},{"UsbCPortNumber":"2","IORegistryEntryChildren":[{"IOObjectClass":"IOUSBHostDevice","IORegistryEntryID":"99","USB Product Name":"USB bridge"}]}]}});
        let roots = connection_nodes(Some(&f)).unwrap();
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[1].children.len(), 1);
        assert!(roots[1].children[0].disk_ids.is_empty());
        assert!(roots[1].children[0].children.is_empty());
    }
    #[test]
    fn sysfs_ancestry_does_not_match_similar_prefixes_or_cycles() {
        let f = json!({"USBDevices":[{"sysfsName":"usb1","sysfsPath":"/sys/usb1"},{"sysfsName":"1-1","parentSysfsName":"usb1","sysfsPath":"/sys/usb1/1-1"},{"sysfsName":"a","parentSysfsName":"b"},{"sysfsName":"b","parentSysfsName":"a"}],"BlockNodes":[{"sysfsName":"sdc","sysfsPath":"/sys/usb1/1-1/storage/block/sdc"},{"sysfsName":"sdd","sysfsPath":"/sys/usb1/1-10/storage/block/sdd"}]});
        let roots = connection_nodes(Some(&f)).unwrap();
        let mut all = vec![];
        each(&roots, &mut all);
        assert_eq!(all.iter().filter(|n| n.disk_ids == ["sdc"]).count(), 1);
        let port = all
            .iter()
            .find(|n| text(&n.fields, "sysfsName").as_deref() == Some("1-1"))
            .unwrap();
        assert_eq!(port.children.len(), 1);
        assert_eq!(port.children[0].disk_ids, ["sdc"]);
        assert_eq!(all.len(), 6);
    }
}
