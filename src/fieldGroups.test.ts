import { describe, expect, it } from "vitest";
import { groupFields } from "./fieldGroups";
import { flatten } from "./data";
import type { Json } from "./types";

describe("readings organized without loss", () => {
  it("assigns each source field once, retaining unknown keys and exact values", () => {
    const source: Json = {
      DeviceIdentifier: "disk7",
      TotalSize: "18446744073709551615",
      Mounted: false,
      BusProtocol: "USB",
      Writable: false,
      "TotalSize.vendor": { future: "opaque" },
      vendor: { counter: "0", extra: [] },
      empty: {},
      missing: null,
    };
    for (const mode of ["device", "branches"] as const) {
      const grouped = groupFields(source, mode).flatMap((g) => g.fields);
      expect(grouped.sort((a, b) => a.path.localeCompare(b.path))).toEqual(
        flatten(source).sort((a, b) => a.path.localeCompare(b.path)),
      );
      expect(new Set(grouped.map((f) => f.path)).size).toBe(grouped.length);
    }
    expect(
      groupFields(source, "device")
        .find((g) => g.id === "other")!
        .fields.map((f) => f.path),
    ).toContain('["TotalSize.vendor"].future');
  });
  it("retains empty structures, primitive sources and ambiguous root names", () => {
    for (const source of [
      {},
      [],
      null,
      false,
      { a: { b: "one" }, "a.b": "two", "[0]": 0 },
    ] as Json[]) {
      expect(
        groupFields(source)
          .flatMap((g) => g.fields)
          .sort((a, b) => a.path.localeCompare(b.path)),
      ).toEqual(flatten(source).sort((a, b) => a.path.localeCompare(b.path)));
    }
  });
});
