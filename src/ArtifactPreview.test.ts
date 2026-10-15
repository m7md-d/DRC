import { expect, it } from "vitest";
import { hexPage } from "./ArtifactPreview";
import { transcript } from "./data";
import type { CommandRecord } from "./types";
it("shows binary bytes and exact offsets above JavaScript's safe integer range", () => {
  const result = hexPage({
    offset: "9007199254740993",
    totalBytes: "9007199254741000",
    bytesBase64: btoa(String.fromCharCode(0, 65, 255, 10)),
  });
  expect(result).toContain("0020000000000001");
  expect(result).toContain("00 41 ff 0a");
  expect(result).toContain("|.A..|");
});
it("identifies file-backed stdout separately and retains supplied input and signal status", () => {
  const record: CommandRecord = {
    id: "test",
    program: "drc-tsk",
    arguments: ["icat"],
    startedAt: 1,
    durationMs: 2,
    exitCode: null,
    terminationSignal: 25,
    stdin: "q\nq\n",
    timedOut: false,
    stdout: "",
    stderr: "original error",
    stdoutBase64: "",
    stderrBase64: "",
    stdoutUtf8Valid: false,
    stderrUtf8Valid: true,
    launchError: null,
    stdoutArtifact: {
      path: "/test/output",
      bytes: "5",
      sha256: "testhash",
      operationId: "job",
      entryIndex: 0,
      identity: {
        device: "1",
        inode: "2",
        size: "5",
        modifiedSeconds: 0,
        modifiedNanoseconds: 0,
      },
    },
  };
  expect(transcript(record)).toContain(
    "DRC storage record: original stdout is stored in /test/output",
  );
  expect(transcript(record)).toContain("signal=25");
  expect(transcript(record)).toContain("original error");
  expect(transcript(record)).toContain("[stdin supplied]\n\nq\nq\n");
  expect(record.stderr).toBe("original error");
});
