use super::*;

fn network_evidence(n: &mut Node, fields: &Value) {
    if n.kind == "Network interface" {
        let name = text(&n.fields, "BSD Name")
            .or_else(|| text(&n.fields, "interface"))
            .unwrap_or_default();
        let profiles: Vec<_> = objects(&fields["SPNetworkDataType"])
            .into_iter()
            .filter(|v| text(v, "interface").as_deref() == Some(&name))
            .collect();
        if profiles.len() == 1 {
            let p = profiles[0];
            let prefix = match text(p, "hardware").as_deref() {
                Some("AirPort") => "Wi-Fi",
                Some("Ethernet") => "Ethernet",
                _ => "Network",
            };
            let product = raw_name(p);
            let identified = if product.ends_with(&format!("({name})")) {
                product.clone()
            } else {
                format!("{product} ({name})")
            };
            n.label = if product == prefix {
                format!("{prefix} · {name}")
            } else if product.starts_with(prefix) {
                identified
            } else {
                format!("{prefix} · {identified}")
            };
            n.observations.push(evidence(
                p,
                "System Profiler · network",
                "Exact BSD interface identifier",
            ));
        }
        for state in objects(&fields["NetworkInterfaceReport"]["fields"]) {
            if text(state, "interface").as_deref() == Some(&name) {
                n.observations.push(evidence(
                    state,
                    "ifconfig · interface status",
                    "Exact BSD interface identifier; passive link-state query",
                ));
            }
        }
    }
    for child in &mut n.children {
        network_evidence(child, fields);
    }
}

pub(super) fn mac_connections(roots: &mut Vec<Node>, fields: &Value) {
    let mut network = vec![];
    for (i, entry) in objects(&fields["IORegistryNetworkReport"]["fields"])
        .iter()
        .enumerate()
    {
        for n in hardware(
            entry,
            &format!("network/{i}"),
            0,
            "IORegistry · network interfaces",
        ) {
            if let Some(existing) = find_mut(roots, &n.id) {
                existing.observations.extend(n.observations);
            } else {
                network.push(n);
            }
        }
    }
    // A configured service alone is not a present interface. Fallback entries
    // require a current ifconfig row with the same explicit BSD identifier.
    let mut present = vec![];
    each(roots, &mut present);
    each(&network, &mut present);
    let known: HashSet<_> = present
        .into_iter()
        .filter(|n| n.kind == "Network interface")
        .filter_map(|n| text(&n.fields, "BSD Name"))
        .collect();
    for state in objects(&fields["NetworkInterfaceReport"]["fields"]) {
        let Some(name) = text(state, "interface") else {
            continue;
        };
        if !known.contains(&name)
            && objects(&fields["SPNetworkDataType"])
                .iter()
                .any(|p| text(p, "interface").as_deref() == Some(&name))
        {
            let mut n = node(
                format!("network-interface:{name}"),
                name,
                "Network interface",
                state,
                "ifconfig · interface status",
            );
            n.observations[0].relation =
                "Present BSD interface; USB ancestry is not reported".into();
            network.push(n);
        }
    }
    if !network.is_empty() {
        let mut group = node(
            "network-interfaces".into(),
            "Other network interfaces".into(),
            "Report",
            &Value::Null,
            "IORegistry · network interfaces",
        );
        group.observations.clear();
        group.children = network;
        roots.push(group);
    }
    for n in roots.iter_mut() {
        network_evidence(n, fields);
    }
    for (i, entry) in objects(&fields["IORegistryTransportReport"]["fields"])
        .iter()
        .enumerate()
    {
        let transport = text(entry, "TransportTypeDescription").unwrap_or_default();
        let port = number(entry, "ParentBuiltInPortNumber").filter(|_| {
            text(entry, "ParentBuiltInPortTypeDescription").as_deref() == Some("USB-C")
        });
        let parent = port.and_then(|p| find_mut(roots, &format!("usb-c:{p}")));
        if ["DisplayPort", "HDMI"].contains(&transport.as_str()) {
            let mut n = node(
                number(entry, "IORegistryEntryID")
                    .map(|n| format!("registry:{n}"))
                    .unwrap_or_else(|| format!("display-output:{i}")),
                format!("{transport} output"),
                "Display output",
                entry,
                "IORegistry · port transport",
            );
            n.observations[0].relation = if port.is_some() {
                "Explicit built-in USB-C port number; downstream adapter connector is not reported"
            } else {
                "Host-reported transport; physical parent not reported"
            }
            .into();
            if let Some(parent) = parent {
                parent.children.push(n);
            } else {
                roots.push(n);
            }
        } else if let Some(parent) = parent {
            parent.observations.push(evidence(
                entry,
                "IORegistry · port transport",
                "Explicit built-in USB-C port number",
            ));
        }
    }
    let mut displays = vec![];
    for (i, gpu) in objects(&fields["SPDisplaysDataType"]).iter().enumerate() {
        for (j, display) in objects(&gpu["spdisplays_ndrvs"]).iter().enumerate() {
            let internal = text(display, "spdisplays_connection_type").as_deref()
                == Some("spdisplays_internal");
            let mut n = node(
                format!("display:{i}/{j}"),
                raw_name(display),
                if internal {
                    "Internal display"
                } else {
                    "Connected display"
                },
                display,
                "System Profiler · displays",
            );
            n.observations[0].relation =
                "Reported GPU/display relationship; no USB hub ancestry is assumed".into();
            displays.push(n);
        }
    }
    if !displays.is_empty() {
        let mut group = node(
            "displays".into(),
            "Displays".into(),
            "Report",
            &Value::Null,
            "System Profiler · displays",
        );
        group.observations.clear();
        group.children = displays;
        roots.push(group);
    }
}

pub(super) fn linux_connections(roots: &mut Vec<Node>, fields: &Value) {
    for (key, label, kind) in [
        (
            "NetworkInterfaces",
            "Other network interfaces",
            "Network interface",
        ),
        ("DisplayConnectors", "Display outputs", "Display output"),
    ] {
        let mut unassigned = vec![];
        for (i, entry) in objects(&fields[key]).iter().enumerate() {
            let mut n = node(
                format!("linux-connection:{key}/{i}"),
                text(entry, "sysfsName").unwrap_or_else(|| kind.into()),
                kind,
                entry,
                "Linux sysfs · connection status",
            );
            let mut all = vec![];
            each(roots, &mut all);
            let parent = text(entry, "deviceSysfsPath").and_then(|device| {
                all.into_iter()
                    .filter_map(|node| {
                        text(&node.fields, "sysfsPath")
                            .filter(|path| {
                                device == *path || device.starts_with(&(path.to_owned() + "/"))
                            })
                            .map(|path| (path.len(), node.id.clone()))
                    })
                    .max_by_key(|(length, _)| *length)
                    .map(|(_, id)| id)
            });
            if let Some(parent) = parent.and_then(|id| find_mut(roots, &id)) {
                n.observations[0].relation = "Canonical sysfs device ancestry".into();
                parent.children.push(n);
            } else {
                n.observations[0].relation =
                    "Physical parent not present in the reported hierarchy".into();
                unassigned.push(n);
            }
        }
        if !unassigned.is_empty() {
            let mut group = node(
                format!("linux-connections:{key}"),
                label.into(),
                "Report",
                &Value::Null,
                "Linux sysfs",
            );
            group.observations.clear();
            group.children = unassigned;
            roots.push(group);
        }
    }
}
