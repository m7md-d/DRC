import { expect, it } from "vitest";
import { isImageReport } from "./ImagePanel";
import type { Json } from "./types";
it("retains unsupported imported reports for field display without attaching filesystem actions", () => {
  const cases: Json[] = [
    null,
    [],
    { id: "future", vendor: { large: "18446744073709551615" } },
    {
      id: "malformed",
      source: { path: "file", token: "t" },
      request: { action: "directory" },
    },
  ];
  for (const report of cases) {
    expect(isImageReport(report)).toBe(false);
  }
  const base = {
    id: "r",
    source: { path: "/test/image", token: "t" },
    request: {
      action: "directory",
      geometry: { offsetSectors: "0", sectorSize: 512, filesystem: null },
      entries: "all",
    },
    record: {
      stdout: "",
      stderr: "",
      program: "drc-tsk",
      arguments: [],
      startedAt: 1,
      exitCode: 0,
      launchError: null,
    },
    files: [],
    partitions: [],
    warnings: [],
    unparsedLines: [],
    vendor: { exact: "18446744073709551615" },
  } satisfies Json;
  expect(isImageReport(base)).toBe(true);
  expect(
    isImageReport({
      ...base,
      request: {
        ...base.request,
        geometry: {
          ...base.request.geometry,
          filesystem: { unexpected: true },
        },
      },
    }),
  ).toBe(false);
});
