import { expect, it } from "vitest";
import {
  acquisitionProgress,
  interpolatedCount,
  sampleDuration,
  durationLabel,
} from "./acquisitionTiming";
import type { AcquisitionJob, ProgressReport } from "./types";

function fixture(): AcquisitionJob {
  const report: ProgressReport = {
    attempt: 1,
    startedAt: 100000,
    samples: Array.from({ length: 6 }, (_, i) => ({
      elapsedMs: String(i * 1000),
      observedAt: 100000 + i * 1000,
      rescuedBytes: String(i * 1000),
      nonTriedBytes: String(10000 - i * 1000),
      nonTrimmedBytes: "0",
      nonScrapedBytes: "0",
      badSectorBytes: "0",
      domainBytes: "10000",
    })),
  };
  return {
    id: "fixture",
    state: "running",
    attempts: 1,
    updatedAt: 105000,
    sourceSize: "10000",
    settings: { offset: "0", length: "10000" },
    map: { rescuedBytes: "5000", domainBytes: "10000" },
    progressReports: [report],
  } as AcquisitionJob;
}
it("keeps remaining bytes exact and estimates from fresh progress within one attempt", () => {
  const job = fixture(),
    original = JSON.stringify(job);
  expect(acquisitionProgress(job, 105500)).toMatchObject({
    remaining: "5000",
    rate: "1000",
    etaSeconds: 5,
    elapsedMs: 5500,
    interval: 1000,
  });
  expect(JSON.stringify(job)).toBe(original);
  job.map!.domainBytes = "18446744073709551615";
  expect(acquisitionProgress(job, 105000).remaining).toBe(
    "18446744073709546615",
  );
});
it("does not give a completion estimate for paused, stale, stalled, reset or discontinuous observations", () => {
  for (const alter of [
    (job: AcquisitionJob) => {
      job.state = "paused";
    },
    (job: AcquisitionJob) => {
      job.progressReports![0].samples.at(-1)!.rescuedBytes = "4000";
    },
    (job: AcquisitionJob) => {
      job.progressReports![0].samples[3].elapsedMs = "500";
    },
    (job: AcquisitionJob) => {
      job.progressReports![0].samples[3].elapsedMs = "9999";
    },
  ]) {
    const job = fixture();
    alter(job);
    expect(acquisitionProgress(job, 105000).etaSeconds).toBeNull();
  }
  expect(acquisitionProgress(fixture(), 115000).etaSeconds).toBeNull();
});
it("excludes pause time and preserves the elapsed duration of earlier attempts", () => {
  const job = fixture();
  job.state = "paused";
  expect(acquisitionProgress(job, 500000).elapsedMs).toBe(5000);
  const second = structuredClone(job.progressReports![0]);
  second.attempt = 2;
  for (const s of second.samples) s.observedAt += 400000;
  job.progressReports!.push(second);
  job.attempts = 2;
  job.state = "running";
  expect(acquisitionProgress(job, 505500).elapsedMs).toBe(10500);
});
it("interpolates large integer readouts without inventing future progress or bridging long intervals", () => {
  expect(
    interpolatedCount("18446744073709550000", "18446744073709550100", 0.5),
  ).toBe("18446744073709550050");
  expect(interpolatedCount("0", "50", 2)).toBe("50");
  expect(interpolatedCount("0", "50", -1)).toBe("0");
  expect(sampleDuration(1000, 2050)).toBe(1050);
  expect(sampleDuration(1000, 9000)).toBe(0);
  expect(sampleDuration(1000, 0)).toBe(0);
  expect(durationLabel(3661)).toBe("1h 1m 1s");
});
