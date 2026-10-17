import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecoveryResults } from "./RecoveryPanel";
import type { RecoveryRun } from "./types";
const run: RecoveryRun = {
  id: "recovery-fixture",
  target: {
    key: "port:2",
    name: "USB-C port 2",
    kind: "port",
    device: null,
    observation: null,
    port: null,
  },
  options: { directScsi: false, reconnectUsb: true },
  state: "stopped",
  startedAt: 1,
  updatedAt: 4,
  source: null,
  issue: {
    code: "TARGET_NOT_PUBLISHED",
    title: "No published target",
    detail:
      "No matching USB device was published. Hardware cause is not established.",
    scope: "host-enumeration",
    evidence: { apiResult: "0xe00002c7" },
  },
  steps: [
    {
      key: "detection",
      label: "Refresh host observations",
      state: "passed",
      startedAt: 1,
      finishedAt: 2,
      detail: "Metadata returned",
      evidence: { devices: [] },
      issue: null,
      commandIds: ["query-fixture"],
    },
    {
      key: "retry",
      label: "Retry the connection",
      state: "failed",
      startedAt: 2,
      finishedAt: 3,
      detail: "Unsupported function",
      evidence: { ioReturn: "0xe00002c7" },
      issue: null,
      commandIds: [],
    },
    {
      key: "read",
      label: "Read a small sample",
      state: "not-run",
      startedAt: null,
      finishedAt: null,
      detail: "Prerequisite missing",
      evidence: null,
      issue: null,
      commandIds: [],
    },
  ],
};
describe("recovery progress", () => {
  it("retains exact errors, unexecuted steps and original commands without implying full progress", () => {
    const html = renderToStaticMarkup(
      <RecoveryResults run={run} showCommand={() => {}} />,
    );
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemax="3"');
    expect(html).toContain("0xe00002c7");
    expect(html).toContain("Not run");
    expect(html).toContain("query-fixture");
    expect(html).toContain("not disk coverage");
    expect(html).not.toContain("Ready to choose");
  });
  it("a successful sample is explicitly limited to its observed range", () => {
    const html = renderToStaticMarkup(
      <RecoveryResults
        run={{ ...run, state: "ready", issue: null }}
        showCommand={() => {}}
      />,
    );
    expect(html).toContain("The rest of the disk has not been tested");
    expect(html).toContain("destination and command review");
  });
});
