import type { AcquisitionJob } from "./types";

export const count = (value: string | undefined | null) =>
  value && /^\d+$/.test(value) ? BigInt(value) : 0n;

// Only the presentation interpolates. Reports, exports and hover values retain
// the original integer strings; no reading is projected beyond the last sample.
export function interpolatedCount(from: string, to: string, fraction: number) {
  const scale = 1_000_000n;
  const t = BigInt(
    Math.round(Math.max(0, Math.min(1, fraction)) * Number(scale)),
  );
  return String(count(from) + ((count(to) - count(from)) * t) / scale);
}
export function sampleDuration(previous: number | undefined, current: number) {
  const interval = previous === undefined ? 1000 : current - previous;
  return interval >= 250 && interval <= 2500 ? interval : 0;
}
export function acquisitionProgress(job: AcquisitionJob, now: number) {
  const total =
    count(job.map?.domainBytes ?? job.settings.length) ||
    count(job.sourceSize) - count(job.settings.offset);
  const finished = count(job.map?.rescuedBytes);
  const remaining = total > finished ? total - finished : 0n;
  const report = job.progressReports?.find((r) => r.attempt === job.attempts);
  const samples = report?.samples ?? [];
  const last = samples.at(-1);
  const live = job.state === "running";
  const fresh =
    !!last && now >= last.observedAt && now - last.observedAt <= 3500;
  const window = last
    ? samples.filter(
        (s) => count(s.elapsedMs) + 15000n >= count(last.elapsedMs),
      )
    : [];
  let valid = window.length >= 4 && fresh;
  for (let i = 1; i < window.length; i++) {
    const delta = count(window[i].elapsedMs) - count(window[i - 1].elapsedMs);
    if (
      delta <= 0n ||
      delta > 2500n ||
      count(window[i].rescuedBytes) < count(window[i - 1].rescuedBytes)
    )
      valid = false;
  }
  const first = window[0];
  const elapsed =
    last && first ? count(last.elapsedMs) - count(first.elapsedMs) : 0n;
  const delta =
    last && first ? count(last.rescuedBytes) - count(first.rescuedBytes) : 0n;
  const rate =
    valid && elapsed >= 3000n && delta >= 0n ? (delta * 1000n) / elapsed : null;
  const progressing =
    samples.length >= 2 &&
    last &&
    count(last.rescuedBytes) > count(samples.at(-2)!.rescuedBytes);
  const etaSeconds =
    live && progressing && rate !== null && rate > 0n
      ? Number((remaining + rate - 1n) / rate)
      : job.state === "completed"
        ? 0
        : null;
  let elapsedMs = 0;
  for (const attempt of job.progressReports ?? []) {
    const sample = attempt.samples.at(-1);
    if (!sample) continue;
    elapsedMs += Number(sample.elapsedMs);
    if (
      ["running", "pausing"].includes(job.state) &&
      attempt.attempt === job.attempts
    )
      elapsedMs += Math.max(0, now - sample.observedAt);
  }
  const interval = last
    ? sampleDuration(samples.at(-2)?.observedAt, last.observedAt)
    : 0;
  return {
    total: String(total),
    finished: String(finished),
    remaining: String(remaining),
    elapsedMs,
    etaSeconds,
    rate: live && fresh ? (rate === null ? null : String(rate)) : null,
    interval,
    observedAt: last?.observedAt ?? job.updatedAt,
  };
}
export function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds),
    h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}
