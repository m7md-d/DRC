import { describe, expect, it } from "vitest";
import {
  flatten,
  humanBytes,
  smartStatus,
  terminalText,
  displayValue,
} from "./data";

describe("complete field display", () => {
  it("retains unknown fields, zero, false, null and empty structures", () => {
    const rows = flatten({
      vendor: { counter: "18446744073709551615", flag: "0", extra: [] },
      supported: false,
      absent: null,
      nested: {},
    });
    expect(rows.map((row) => row.path)).toEqual([
      "vendor.counter",
      "vendor.flag",
      "vendor.extra",
      "supported",
      "absent",
      "nested",
    ]);
    expect(rows[0].value).toBe("18446744073709551615");
    expect(displayValue(false)).toBe("false");
    expect(displayValue(null)).toBe("null");
    expect(displayValue(undefined)).toBe("Not reported");
  });
  it("distinguishes keys containing dots from nested fields", () => {
    expect(
      flatten({ "a.b": "one", a: { b: "two" } }).map((row) => row.path),
    ).toEqual(['["a.b"]', "a.b"]);
  });
});

describe("byte counts and source-reported status", () => {
  it("does not treat zero as unavailable and uses integer arithmetic", () => {
    expect(humanBytes("0")).toBe("0 B");
    expect(humanBytes(null)).toBe("Not reported");
    expect(humanBytes("18446744073709551615")).toBe("18.44 EB");
    expect(humanBytes("1000204886016")).toBe("1.00 TB");
  });
  it("decodes independent smartctl flags without suppressing the report", () => {
    expect(smartStatus(72)).toHaveLength(2);
    expect(smartStatus(72)[0]).toContain("Bit 3");
    expect(smartStatus(72)[1]).toContain("Bit 6");
  });
});

it("neutralizes terminal escape sequences while retaining printable output", () => {
  expect(terminalText("\x1b]52;c;clipboard\x07\nVendor")).toBe(
    "\\x1b]52;c;clipboard\\x07\r\nVendor",
  );
});
