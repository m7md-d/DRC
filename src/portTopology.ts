import { getField, displayValue } from "./data";
import type { Json } from "./types";
export interface PortNode {
  id: string;
  label: string;
  kind: string;
  source: string;
  fields: Json;
  children: PortNode[];
  diskIds: string[];
  observations?: {
    source: string;
    rawName: string;
    relation: string;
    fields: Json;
  }[];
}
const text = (v: Json | undefined) =>
  typeof v === "string" ? v.trim() : undefined;
const objects = (v: Json | undefined): Json[] =>
  Array.isArray(v)
    ? v.filter((n) => n !== null && typeof n === "object" && !Array.isArray(n))
    : v && typeof v === "object"
      ? [v]
      : [];
function reportedIds(fields: Json): string[] {
  // Only explicit device identifiers, never model/serial heuristics.
  const ids = ["bsd_name", "BSD Name", "DeviceIdentifier", "kname"].map((k) =>
    text(getField(fields, k)),
  );
  return [...new Set(ids.filter((id): id is string => !!id))];
}
function profiler(
  nodes: Json[],
  source: string,
  path: string,
  kind = "Reported device",
): PortNode[] {
  return nodes.map((fields, index) => {
    const id = `${path}/${index}`;
    const children = [
      ...profiler(objects(getField(fields, "_items")), source, `${id}/items`),
      ...profiler(
        objects(getField(fields, "Media")),
        source,
        `${id}/media`,
        "Reported media",
      ),
      ...profiler(
        objects(getField(fields, "volumes")),
        source,
        `${id}/volumes`,
        "Reported volume",
      ),
    ];
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      for (const [key, port] of Object.entries(fields))
        if (
          /^receptacle_.*_tag$/.test(key) &&
          port &&
          typeof port === "object"
        ) {
          children.push({
            id: `${id}/${key}`,
            label: `Port ${text(getField(port, "receptacle_id_key")) ?? key}`,
            kind: "Reported port",
            source,
            fields: port,
            children: [],
            diskIds: reportedIds(port),
          });
        }
    }
    return {
      id,
      label:
        text(getField(fields, "_name")) ??
        text(getField(fields, "device_name_key")) ??
        kind,
      kind,
      source,
      fields,
      children,
      diskIds: reportedIds(fields),
    };
  });
}
function registry(
  nodes: Json[],
  path: string,
  source = "IORegistry · IOUSB plane",
): PortNode[] {
  return nodes.map((fields, index) => ({
    id: `${path}/${index}`,
    label:
      text(getField(fields, "USB Product Name")) ??
      text(getField(fields, "IORegistryEntryName")) ??
      "Registry entry",
    kind: text(getField(fields, "IOObjectClass")) ?? "Registry entry",
    source,
    fields,
    children: registry(
      objects(getField(fields, "IORegistryEntryChildren")),
      `${path}/${index}`,
      source,
    ),
    diskIds: [],
  }));
}
function linux(
  nodes: Json[],
  source: string,
  path: string,
  blockNodes: Json[],
): PortNode[] {
  const entries = nodes.map(
    (fields, index) =>
      ({
        id: `${path}/${index}`,
        label:
          text(getField(fields, "product")) ??
          text(getField(fields, "device_name")) ??
          text(getField(fields, "sysfsName")) ??
          "Sysfs entry",
        kind: text(getField(fields, "sysfsName")) ?? "Sysfs entry",
        source,
        fields,
        children: [],
        diskIds: [],
      }) as PortNode,
  );
  const byName = new Map(
    entries.map((n) => [text(getField(n.fields, "sysfsName")), n]),
  );
  const roots: PortNode[] = [];
  for (const n of entries) {
    const parent = byName.get(text(getField(n.fields, "parentSysfsName")));
    // Reject a cycle before linking any edge. Imported observations may be untrusted.
    let cursor = parent;
    const seen = new Set([n]);
    let cycle = false;
    while (cursor) {
      if (seen.has(cursor)) {
        cycle = true;
        break;
      }
      seen.add(cursor);
      cursor = byName.get(text(getField(cursor.fields, "parentSysfsName")));
    }
    if (parent && !cycle) parent.children.push(n);
    else roots.push(n);
  }
  for (const fields of blockNodes) {
    const sysfs = text(getField(fields, "sysfsPath"));
    if (!sysfs) continue;
    const parent = entries
      .filter((n) => {
        const p = text(getField(n.fields, "sysfsPath"));
        return p && sysfs.startsWith(p + "/");
      })
      .sort(
        (a, b) =>
          String(getField(b.fields, "sysfsPath")).length -
          String(getField(a.fields, "sysfsPath")).length,
      )[0];
    if (parent)
      parent.children.push({
        id: `${parent.id}/disk/${text(getField(fields, "sysfsName"))}`,
        label: `/dev/${text(getField(fields, "sysfsName"))}`,
        kind: "Reported block device",
        source: "Linux sysfs · current block-node ancestry",
        fields,
        children: [],
        diskIds: [text(getField(fields, "sysfsName")) ?? ""],
      });
  }
  return roots;
}
export function portTopology(fields: Json | null): PortNode[] {
  const groups: PortNode[] = [];
  const group = (
    id: string,
    label: string,
    source: string,
    children: PortNode[],
  ) => {
    if (children.length)
      groups.push({
        id,
        label,
        source,
        kind: "Report",
        fields: null,
        children,
        diskIds: [],
      });
  };
  group(
    "usb",
    "USB devices",
    "System Profiler",
    profiler(
      objects(getField(fields, "SPUSBDataType")),
      "System Profiler · USB",
      "usb",
      "Reported bus",
    ),
  );
  group(
    "thunderbolt",
    "Thunderbolt / USB4",
    "System Profiler",
    profiler(
      objects(getField(fields, "SPThunderboltDataType")),
      "System Profiler · Thunderbolt",
      "thunderbolt",
      "Reported bus",
    ),
  );
  group(
    "nvme",
    "NVMe storage",
    "System Profiler",
    profiler(
      objects(getField(fields, "SPNVMeDataType")),
      "System Profiler · NVMe",
      "nvme",
      "Reported controller / media",
    ),
  );
  group(
    "registry",
    "USB registry",
    "IORegistry",
    registry(
      objects(getField(getField(fields, "IORegistryUSBReport"), "fields")),
      "registry",
    ),
  );
  group(
    "usb-ports",
    "USB host ports",
    "IORegistry",
    registry(
      objects(getField(getField(fields, "IORegistryPortReport"), "fields")),
      "usb-ports",
      "IORegistry · AppleUSBHostPort",
    ),
  );
  group(
    "linux-usb",
    "USB devices",
    "Linux sysfs",
    linux(
      objects(getField(fields, "USBDevices")),
      "Linux sysfs · USB",
      "linux-usb",
      objects(getField(fields, "BlockNodes")),
    ),
  );
  group(
    "linux-tb",
    "Thunderbolt devices",
    "Linux sysfs",
    linux(
      objects(getField(fields, "ThunderboltDevices")),
      "Linux sysfs · Thunderbolt",
      "linux-tb",
      objects(getField(fields, "BlockNodes")),
    ),
  );
  return groups;
}
export function portMeasurements(node: PortNode) {
  const sources = [
    node.fields,
    ...(node.observations ?? []).map((o) => o.fields),
  ];
  const reported = (fields: Json, key: string) =>
    key === "IOPowerManagement.CurrentPowerState"
      ? getField(getField(fields, "IOPowerManagement"), "CurrentPowerState")
      : getField(fields, key);
  const speedNames: Record<string, string> = {
    low_speed: "Up to 1.5 Mb/s",
    full_speed: "Up to 12 Mb/s",
    high_speed: "Up to 480 Mb/s",
    super_speed: "Up to 5 Gb/s",
    super_speed_plus: "Up to 10 Gb/s",
    super_speed_plus_by_2: "Up to 20 Gb/s",
    super_speed_limited: "Limited to 5 Gb/s",
  };
  const measurement = (label: string, keys: string[], hint: string) => {
    const key = keys.find((key) =>
      sources.some((fields) => reported(fields, key) !== undefined),
    );
    const values = key
      ? [
          ...new Map(
            sources
              .map((fields) => reported(fields, key))
              .filter((value): value is Json => value !== undefined)
              .map((value) => [JSON.stringify(value), value]),
          ).values(),
        ]
      : [];
    const format = (value: Json) => {
      const original = displayValue(value);
      if (key === "Device Speed")
        return (
          [
            "Low speed · 1.5 Mb/s",
            "Full speed · 12 Mb/s",
            "High speed · 480 Mb/s",
            "SuperSpeed · 5 Gb/s",
            "SuperSpeed+ · 10 Gb/s",
            "SuperSpeed+ · 20 Gb/s",
          ][Number(original)] ?? original
        );
      if (key === "device_speed") return speedNames[original] ?? original;
      if (key === "Active" && typeof value === "boolean")
        return value ? "Active" : "Inactive";
      if (key === "spdisplays_online")
        return original === "spdisplays_yes" ? "Online" : original;
      if (key === "speed" && /^\d+(\.\d+)?$/.test(original))
        return `${original} Mb/s`;
      if (
        key &&
        [
          "bus_power",
          "bus_power_used",
          "bus_power_available",
          "kUSBWakePortCurrentLimit",
          "kUSBSleepPortCurrentLimit",
          "kUSBBusCurrentAllocation",
        ].includes(key) &&
        /^\d+$/.test(original)
      )
        return `${original} mA`;
      return original;
    };
    return {
      label,
      key,
      value: values.length
        ? [...new Set(values.map(format))].join(" / ")
        : "Not reported",
      hint,
    };
  };
  if (node.kind.toLowerCase().includes("network"))
    return [
      measurement(
        "Link status",
        ["linkStatus", "operstate"],
        "Passive interface status from ifconfig or sysfs. An UP flag alone does not establish a connected cable.",
      ),
      measurement(
        "Media / speed",
        ["media", "speed"],
        "Reported interface media or negotiated link speed. This is not measured traffic throughput.",
      ),
      measurement(
        "Carrier",
        ["carrier"],
        "Original sysfs carrier value, when provided by the driver.",
      ),
    ].filter((m) => m.label !== "Carrier" || m.key !== undefined);
  if (node.kind.toLowerCase().includes("display"))
    return [
      measurement(
        "Reported activity",
        ["Active", "spdisplays_online", "status"],
        "Host-reported display transport or connector state.",
      ),
      measurement(
        "Link / resolution",
        [
          "LinkRateDescription",
          "_spdisplays_resolution",
          "spdisplays_resolution",
          "spdisplays_pixelresolution",
        ],
        "Reported transport link or display resolution. No signal-quality test is performed.",
      ),
      measurement(
        "Hot-plug state",
        ["HPD_StateDescription"],
        "Original host hot-plug state. Unknown is preserved as unknown.",
      ),
      measurement(
        "Lane count",
        ["LaneCount"],
        "Current host-reported display transport lane count. It does not identify an adapter's downstream connector.",
      ),
    ].filter((m) => m.key !== undefined);
  return [
    measurement(
      "Link / speed",
      [
        "DataRateDescription",
        "device_speed",
        "speed",
        "Device Speed",
        "USBSpeed",
        "current_speed_key",
        "current_link_speed",
      ],
      "Reported link or descriptor value. Multiple values retain distinct source readings; this is not disk throughput.",
    ),
    measurement(
      "Power requested",
      [
        "bus_power_used",
        "kUSBBusCurrentAllocation",
        "bMaxPower",
        "USB Power Requested",
      ],
      "Declared or host-allocated USB budget; not measured electrical consumption. bMaxPower is retained in its source units.",
    ),
    measurement(
      "Power available",
      [
        "bus_power",
        "bus_power_available",
        "kUSBWakePortCurrentLimit",
        "kUSBSleepPortCurrentLimit",
      ],
      "Host current limit or budget. It does not establish electrical delivery inside the enclosure.",
    ),
    measurement(
      "Port / power state",
      [
        "Active",
        "port-status",
        "IOPowerManagement.CurrentPowerState",
        "receptacle_status_key",
        "power/runtime_status",
        "IOServiceState",
        "authorized",
      ],
      "Original port, runtime or authorization state; hardware cause is not inferred.",
    ),
  ];
}

export function driverStateDurations(
  fields: Json,
): { key: string; milliseconds: string; original: string }[] | null {
  const value = getField(
    getField(fields, "port-statistics"),
    "kPortStatPowerStateTime",
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length) return null;
  const parsed = entries.map(([key, original]) => {
    const match =
      typeof original === "string"
        ? /^(\d+)ms(?: \(\d+%\))?$/.exec(original)
        : null;
    return match
      ? { key, milliseconds: match[1], original: original as string }
      : null;
  });
  // Never hide an unknown format and normalize the remaining states as a full set.
  return parsed.every((entry) => entry !== null) ? parsed : null;
}
