import { getField } from "./data";
import type { Json } from "./types";
import type { PortNode } from "./portTopology";

type Observation = NonNullable<PortNode["observations"]>[number];
export interface PortReadingGroup {
  label: string;
  rawName: string;
  fields: Json;
  readings: Observation[];
  variants: string[];
}
function mergeFields(readings: Observation[]) {
  const values: Record<string, Json> = {};
  const variants = new Set<string>();
  for (const reading of readings) {
    if (
      !reading.fields ||
      typeof reading.fields !== "object" ||
      Array.isArray(reading.fields)
    )
      continue;
    for (const [key, value] of Object.entries(reading.fields)) {
      if (
        key in values &&
        JSON.stringify(values[key]) !== JSON.stringify(value)
      )
        variants.add(key);
      else if (!variants.has(key)) values[key] = value;
    }
  }
  for (const key of variants) delete values[key];
  return { fields: values, variants: [...variants] };
}

// Repeated snapshots of one registry ID are one source choice. Conflicting
// properties remain in the original readings and are never selected arbitrarily.
export function portReadingGroups(node: PortNode): PortReadingGroup[] {
  const grouped = new Map<string, PortReadingGroup>();
  const readings = node.observations?.length
    ? node.observations
    : node.fields !== null
      ? [
          {
            source: node.source,
            rawName: node.label,
            relation: "Reported node properties",
            fields: node.fields,
          },
        ]
      : [];
  for (const reading of readings) {
    const family = reading.source.startsWith("IORegistry")
      ? "IORegistry"
      : reading.source;
    const id = getField(reading.fields, "IORegistryEntryID");
    const key = `${family}:${id ?? reading.rawName}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        label: family,
        rawName: reading.rawName,
        fields: {},
        readings: [],
        variants: [],
      };
      grouped.set(key, group);
    }
    if (
      !group.readings.some(
        (r) =>
          r.source === reading.source &&
          JSON.stringify(r.fields) === JSON.stringify(reading.fields),
      )
    )
      group.readings.push(reading);
  }
  for (const group of grouped.values()) {
    Object.assign(group, mergeFields(group.readings));
  }
  return [...grouped.values()];
}

export function allPortReadings(
  node: PortNode,
  groups = portReadingGroups(node),
): PortNode {
  const readings = groups.flatMap((g) => g.readings);
  return {
    ...node,
    fields: readings.length ? mergeFields(readings).fields : node.fields,
    observations: readings,
  };
}
