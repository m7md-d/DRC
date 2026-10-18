import { useState } from "react";
import { FieldTable } from "./FieldTable";
import { Plot } from "./Plot";
import { Select } from "./Select";
import { observedGrowth } from "./chartMath";
import { sampleDuration } from "./acquisitionTiming";
import type { AcquisitionJob, Json } from "./types";

const names: Record<string, string> = {
  rate: "Read rate",
  progressRate: "Finished-byte growth (map)",
  progress: "Finished bytes (map)",
  position: "Input position",
  errors: "Bad size",
  areas: "Bad areas",
};
export function AcquisitionCharts({ job }: { job: AcquisitionJob }) {
  const reports = job.rateReports ?? [];
  const progressReports = job.progressReports ?? [];
  const [attempt, setAttempt] = useState<string | null>(null);
  const [chosenMetric, setMetric] = useState<string | null>(null);
  const attempts = Array.from(
    new Set([...reports, ...progressReports].map((r) => r.attempt)),
  ).sort((a, b) => a - b);
  const selectedAttempt = attempts.includes(Number(attempt))
    ? Number(attempt)
    : attempts.at(-1);
  const report = reports.find((r) => r.attempt === selectedAttempt);
  const progress = progressReports.find((r) => r.attempt === selectedAttempt);
  const metric =
    chosenMetric ?? (report?.samples.length ? "rate" : "progressRate");
  const fromMap = metric === "progress" || metric === "progressRate";
  const points = fromMap
    ? (progress?.samples.map((s, i) => {
        const previous = progress.samples[i - 1];
        const growth = observedGrowth(previous, s);
        return {
          x: s.elapsedMs,
          label: `Attempt ${progress.attempt} · ${s.elapsedMs}ms${metric === "progressRate" && growth ? ` · Δ${growth.delta} bytes / ${growth.interval}ms` : ""}`,
          values: [
            metric === "progress" ? s.rescuedBytes : (growth?.rate ?? null),
          ],
          breakBefore:
            !!previous &&
            BigInt(s.elapsedMs) - BigInt(previous.elapsedMs) > 2500n,
        };
      }) ?? [])
    : (report?.samples.map((s) => ({
        x: s.timeSeconds,
        label: `Attempt ${report.attempt} · ${s.timeSeconds}s · source byte ${s.inputPosition}`,
        breakBefore: s.breakBefore,
        values:
          metric === "rate"
            ? [s.currentRate, s.averageRate]
            : [
                metric === "position"
                  ? s.inputPosition
                  : metric === "errors"
                    ? s.badBytes
                    : s.badAreas,
              ],
      })) ?? []);
  return (
    <section className="acquisition-charts">
      <div className="section-heading">
        <h3>Recorded measurements</h3>
        <span className="small-tag">DDRESCUE</span>
      </div>
      {!attempts.length ? (
        <p className="panel-description">
          No measurement history was recorded for this saved acquisition. New
          attempts record measurements; earlier readings are not reconstructed.
        </p>
      ) : (
        <>
          <div className="measurement-controls">
            <Select
              label="Measurement attempt"
              value={String(selectedAttempt)}
              onChange={setAttempt}
              options={attempts.map((n) => ({
                value: String(n),
                label: `Attempt ${n}`,
              }))}
            />
            <Select
              label="Measurement to plot"
              value={metric}
              onChange={setMetric}
              options={Object.entries(names).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
          <Plot
            key={`${selectedAttempt}:${metric}`}
            title={names[metric]}
            description={
              fromMap
                ? "ddrescue mapfile observations · DRC monotonic elapsed timer"
                : "GNU ddrescue --log-rates · original tool measurements"
            }
            points={points}
            live={job.state === "running" && selectedAttempt === job.attempts}
            intervalMs={
              points.length >= 2
                ? sampleDuration(
                    Number(points.at(-2)!.x) * (fromMap ? 1 : 1000),
                    Number(points.at(-1)!.x) * (fromMap ? 1 : 1000),
                  )
                : 0
            }
            series={
              metric === "rate"
                ? [
                    { label: "Current rate", color: "var(--selection)" },
                    { label: "Average rate", color: "var(--information)" },
                  ]
                : [{ label: names[metric], color: "var(--selection)" }]
            }
            unit={
              metric === "rate" || metric === "progressRate"
                ? "bytes/s"
                : metric === "areas"
                  ? "count"
                  : "bytes"
            }
            xLabel="Elapsed time in this attempt · seconds"
            xFormat={fromMap ? (n) => `${Number(n) / 1000}s` : (n) => `${n}s`}
          />
          <p className="source-label">
            {fromMap
              ? "Map growth is the observed change in finished bytes, including map-save intervals; it is not device read throughput. Rate display uses whole bytes/s = 1000 × Δfinished / Δelapsed_ms. Exact deltas and intervals are shown above. Missing intervals are gaps."
              : "Current/average rates belong to this run. The tool can buffer its log until the attempt stops; map observations provide live progress. Missing intervals are gaps. Bad size / areas retain the tool's Bad_size / Bad_areas columns."}
          </p>
          {progress && (
            <details className="measurement-source">
              <summary>
                Map observations · {progress.samples.length} samples
              </summary>
              <FieldTable
                title="Recorded map observations"
                source="All byte counts are exact decimal strings; each attempt has an independent timer"
                value={progress as unknown as Json}
              />
            </details>
          )}
          {report?.pendingLine && (
            <p className="source-label">
              An incomplete log row is waiting for the tool to finish writing
              it.
            </p>
          )}
          {report?.warnings.map((warning, i) => (
            <p className="error-box" key={i}>
              {warning}
            </p>
          ))}
          {report && (
            <details className="measurement-source">
              <summary>
                Samples and original rate log · {report.samples.length} rows
              </summary>
              <code className="artifact-path">{report.path}</code>
              <FieldTable
                title="Original rate-log columns"
                source="Column names and tokens in source order; hexadecimal positions retained"
                value={
                  {
                    columns: report.columns,
                    rows: report.samples.map((s) => ({
                      line: s.line,
                      values: s.values,
                    })),
                  } as unknown as Json
                }
              />
              <pre className="raw-map" tabIndex={0}>
                {report.raw || "The tool has not flushed its rate log yet."}
              </pre>
              <p className="source-label">
                Original bytes are preserved as base64 in the saved acquisition.
                UTF-8 valid: {String(report.utf8Valid)}.
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
