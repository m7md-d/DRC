import { useEffect, useState } from "react";
import { acquisitionProgress, count, durationLabel } from "./acquisitionTiming";
import { useAnimatedCount } from "./useAnimatedCount";
import { humanBytes } from "./data";
import type { AcquisitionJob } from "./types";

export function AcquisitionProgress({ job }: { job: AcquisitionJob }) {
  const [, setClock] = useState(0);
  const active = ["running", "pausing"].includes(job.state);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active, job.id, job.attempts]);
  // A newly received sample can be newer than the previous one-second tick.
  const now = Date.now();
  const stats = acquisitionProgress(job, now);
  const shown = useAnimatedCount(
    stats.finished,
    stats.interval,
    job.state === "running",
    `${job.id}:${job.attempts}`,
  );
  const shownRemaining = String(
    count(stats.total) > count(shown) ? count(stats.total) - count(shown) : 0n,
  );
  const shownRate = useAnimatedCount(
    stats.rate ?? "0",
    stats.interval,
    job.state === "running" && stats.rate !== null,
    `${job.id}:${job.attempts}:rate`,
    false,
  );
  const percentage = count(stats.total)
    ? Number((count(shown) * 10000n) / count(stats.total)) / 100
    : 0;
  const finishAt =
    stats.etaSeconds !== null && stats.etaSeconds <= 365 * 86400
      ? new Date(now + stats.etaSeconds * 1000).toLocaleString("en-GB", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <section
      className="copy-progress"
      aria-label="Disk image progress"
      data-state={job.state}
    >
      <div className="copy-progress-heading">
        <strong>
          {job.state === "running"
            ? "Creating disk image"
            : job.state === "paused"
              ? "Copy paused"
              : job.state === "completed"
                ? "Image complete"
                : job.state === "pausing"
                  ? "Saving the resume map…"
                  : "Copy stopped"}
        </strong>
        <span
          data-hint={`${stats.finished} of ${stats.total} bytes marked finished in the saved map`}
        >
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div
        className="copy-progress-track"
        role="progressbar"
        aria-label="Finished image bytes"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percentage)}
        aria-valuetext={`${stats.finished} of ${stats.total} bytes`}
      >
        <i style={{ width: `${Math.min(100, percentage)}%` }} />
      </div>
      <div className="copy-progress-caption">
        <span
          data-hint={`${stats.finished} bytes exactly · latest map observation`}
        >
          {humanBytes(shown)} of {humanBytes(stats.total)}
        </span>
        <span data-hint="Recent growth in finished map bytes, averaged over up to 15 seconds. Original device read rates remain in the charts.">
          {stats.rate !== null
            ? `${humanBytes(shownRate)}/s`
            : active
              ? "Waiting for progress"
              : job.state}
        </span>
      </div>
      <dl className="copy-timing">
        <div
          data-hint={`${stats.remaining} bytes not marked finished (+), including unread and bad-sector ranges.`}
        >
          <dt>Remaining</dt>
          <dd>{humanBytes(shownRemaining)}</dd>
        </div>
        <div
          data-hint={`${Math.floor(stats.elapsedMs)} ms in recorded copying attempts. Paused time is excluded.`}
        >
          <dt>Elapsed</dt>
          <dd>{durationLabel(stats.elapsedMs / 1000)}</dd>
        </div>
        <div data-hint="Estimate from recent finished-byte growth. Read errors and connection changes can alter it; paused or stale readings have no estimate.">
          <dt>Estimated time left</dt>
          <dd>
            {stats.etaSeconds === null ? "—" : durationLabel(stats.etaSeconds)}
          </dd>
        </div>
        <div data-hint="Estimated completion in the computer's local time zone.">
          <dt>Estimated finish</dt>
          <dd>{job.state === "running" ? (finishAt ?? "—") : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
