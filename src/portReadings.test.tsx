import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { allPortReadings, portReadingGroups } from "./portReadings";
import { portMeasurements, type PortNode } from "./portTopology";
import { FieldTable } from "./FieldTable";

const node: PortNode = {
  id: "registry:100",
  label: "USB hub",
  kind: "USB hub",
  source: "IORegistry",
  fields: null,
  diskIds: [],
  children: [],
  observations: [
    {
      source: "IORegistry · host ports",
      rawName: "USB hub",
      relation: "Host tree",
      fields: {
        IORegistryEntryID: "100",
        "Device Speed": "3",
        counter: "18446744073709551615",
      },
    },
    {
      source: "IORegistry · USB devices",
      rawName: "USB hub",
      relation: "USB plane",
      fields: { IORegistryEntryID: "100", "Device Speed": "3", counter: "0" },
    },
    {
      source: "IORegistry · USB services",
      rawName: "USB hub",
      relation: "Service plane",
      fields: {
        IORegistryEntryID: "100",
        "Device Speed": "3",
        kUSBWakePortCurrentLimit: "900",
      },
    },
    {
      source: "System Profiler · USB",
      rawName: "USB hub",
      relation: "USB location",
      fields: { bus_power_used: "224" },
    },
  ],
};
describe("port source presentation", () => {
  it("offers one registry source, retains conflicting originals and reads all sources without switching", () => {
    const groups = portReadingGroups(node);
    expect(groups).toHaveLength(2);
    expect(groups[0].readings).toHaveLength(3);
    expect(groups[0].variants).toContain("counter");
    expect(groups[0].fields).not.toHaveProperty("counter");
    expect(groups[0].readings[0].fields).toHaveProperty(
      "counter",
      "18446744073709551615",
    );
    const values = portMeasurements(allPortReadings(node, groups));
    expect(values.find((v) => v.label === "Link / speed")?.value).toBe(
      "SuperSpeed · 5 Gb/s",
    );
    expect(values.find((v) => v.label === "Power requested")?.value).toBe(
      "224 mA",
    );
    expect(values.find((v) => v.label === "Power available")?.value).toBe(
      "900 mA",
    );
  });
  it("keeps different registry IDs as separate lanes and does not choose one conflicting speed", () => {
    const lane = {
      ...node,
      observations: node.observations!.slice(0, 2).map((o, i) => ({
        ...o,
        fields: {
          IORegistryEntryID: String(i),
          DataRateDescription: i ? "5 Gbps" : "480 Mbps",
        },
      })),
    };
    expect(portReadingGroups(lane)).toHaveLength(2);
    expect(
      portMeasurements(allPortReadings(lane)).find(
        (v) => v.label === "Link / speed",
      )?.value,
    ).toBe("480 Mbps / 5 Gbps");
  });
  it("shows an inactive network link independently of its administrative flags", () => {
    const network = {
      ...node,
      kind: "Network interface",
      fields: {
        linkStatus: "inactive",
        flags: "UP",
        media: "autoselect (none)",
      },
      observations: [],
    };
    expect(
      portMeasurements(network).find((v) => v.label === "Link status")?.value,
    ).toBe("inactive");
    expect(
      portMeasurements(network).some((v) => v.label === "Power available"),
    ).toBe(false);
  });
  it("does not expose a layout switch for a single group, while retaining exact fields", () => {
    const html = renderToStaticMarkup(
      <FieldTable
        value={{ counter: "18446744073709551615", speed: "5000" }}
        source="Fixture"
      />,
    );
    expect(html).not.toContain("Flat paths");
    expect(html).not.toContain("Expand all");
    expect(html).not.toContain("Top-level fields");
    expect(html).toContain("18446744073709551615");
    expect(
      renderToStaticMarkup(
        <FieldTable
          value={{
            first: { value: "1", extra: "a" },
            second: { value: "2", extra: "b" },
          }}
          source="Fixture"
        />,
      ),
    ).toContain("Flat paths");
  });
});
