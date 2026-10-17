import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { Icon } from "./Icon";
import { ByteValue } from "./ByteValue";
import { FieldTable } from "./FieldTable";
import type {
  RecoveryRun,
  RecoveryOptions,
  RecoveryTarget,
  Device,
} from "./types";

const stateLabels: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  passed: "Completed",
  failed: "Attempt failed",
  skipped: "Skipped",
  "not-run": "Not run",
};
export function RecoveryResults({
  run,
  showCommand,
}: {
  run: RecoveryRun;
  showCommand: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (run.state !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [run.state]);
  const processed = run.steps.filter((s) =>
    ["passed", "failed", "skipped"].includes(s.state),
  ).length;
  return (
    <div className="recovery-results">
      <div className="recovery-progress-label">
        <strong>
          {run.state === "running"
            ? "Checking recovery access"
            : run.state === "ready"
              ? "Ready to choose an image destination"
              : run.state === "interrupted"
                ? "Saved run has no completion record"
                : run.state === "cancelled"
                  ? "Checks cancelled"
                  : "Recovery checks stopped"}
        </strong>
        <span>
          {processed} / {run.steps.length} steps processed
        </span>
      </div>
      <div
        className="recovery-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuenow={processed}
        aria-valuemax={run.steps.length}
        aria-label="Recovery workflow steps processed"
      ><span style={{width: `${run.steps.length ? processed / run.steps.length * 100 : 0}%`}} /></div>
      <p className="recovery-progress-note">
        Workflow progress · not disk coverage, recovered data, or a health score
      </p>
      {run.issue && (
        <div className="recovery-issue" role="alert">
          <span className="eyebrow">OBSERVED STOP / {run.issue.scope}</span>
          <h3>{run.issue.title}</h3>
          <code>{run.issue.code}</code>
          <p>{run.issue.detail}</p>
          <details>
            <summary>Exact stop evidence</summary>
            <pre>{JSON.stringify(run.issue.evidence, null, 2)}</pre>
          </details>
        </div>
      )}
      {run.state === "ready" && (
        <div className="inline-note">
          <Icon name="shield" />
          <span>
            The reported sample was read through a pinned read-only handle. The
            rest of the disk has not been tested. Creating an image still
            requires a destination and command review.
          </span>
        </div>
      )}
      <ol className="recovery-steps">
        {run.steps.map((step, index) => (
          <li key={step.key} data-state={step.state}>
            <div className="recovery-step-icon">
              {step.state === "running" ? (
                <Icon name="refresh" className="spin" />
              ) : step.state === "passed" ? (
                <Icon name="check" />
              ) : step.state === "failed" ? (
                <Icon name="info" />
              ) : (
                <span>{index + 1}</span>
              )}
            </div>
            <div className="recovery-step-body">
              <div className="recovery-step-title">
                <h3>{step.label}</h3>
                <span>{stateLabels[step.state]}</span>
              </div>
              <p>
                {step.detail ||
                  (step.state === "running"
                    ? "Waiting for the current operation to return an observed result…"
                    : "Waiting for its prerequisite.")}
              </p>
              {step.startedAt != null && (
                <small>
                  {(
                    Math.max(0, (step.finishedAt ?? now) - step.startedAt) /
                    1000
                  ).toFixed(1)}{" "}
                  s {step.finishedAt == null ? "elapsed" : "duration"}
                </small>
              )}
              {step.issue && (
                <div className="recovery-step-error">
                  <code>{step.issue.code}</code>
                  <strong>{step.issue.title}</strong>
                </div>
              )}
              {(step.evidence != null || step.commandIds.length > 0) && (
                <details>
                  <summary>Observed result & original commands</summary>
                  <pre>{JSON.stringify(step.evidence, null, 2)}</pre>
                  <div className="recovery-command-links">
                    {step.commandIds.map((id) => (
                      <button
                        className="button subtle"
                        key={id}
                        onClick={() => showCommand(id)}
                      >
                        <Icon name="terminal" />
                        {id}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
export function RecoveryPanel({
  run,
  running,
  stopping,
  initialKey,
  platform,
  historical,
  close,
  start,
  stop,
  continueToImage,
  showCommand,
}: {
  run: RecoveryRun | null;
  running: boolean;
  stopping: string | null;
  initialKey: string | null;
  platform: string;
  historical: boolean;
  close: () => void;
  start: (key: string, options: RecoveryOptions) => Promise<void>;
  stop: () => void;
  continueToImage: (source: Device) => void;
  showCommand: (id: string) => void;
}) {
  const [targets, setTargets] = useState<RecoveryTarget[]>(
    running && run ? [run.target] : [],
  );
  const [key, setKey] = useState(
    running && run ? run.target.key : (initialKey ?? ""),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<RecoveryOptions>({
    directScsi: false,
    reconnectUsb: false,
  });
  async function loadTargets() {
    setLoading(true);
    setError(null);
    try {
      const next = await bridge.recoveryTargets();
      next.sort((a, b) => priority(a) - priority(b));
      setTargets(next);
      setKey((current) =>
        next.some((t) => t.key === current) ? current : (next[0]?.key ?? ""),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!running && !historical) void loadTargets();
  }, []);
  useEffect(() => {
    if (running && run) {
      setOptions(run.options);
      setKey(run.target.key);
      setTargets((current) =>
        current.some((t) => t.key === run.target.key)
          ? current
          : [run.target, ...current],
      );
    }
  }, [running, run?.id]);
  const target = targets.find((t) => t.key === key);
  return (
    <Modal
      title="Start recovery"
      subtitle="VERIFY ACCESS → TRY ENABLED ROUTES → CREATE AN IMAGE"
      close={close}
      wide
      className="recovery-modal"
    >
      <div className="recovery-layout">
        <section className="recovery-setup">
          <div className="recovery-launch-symbol">
            <Icon name="shield" size={32} />
          </div>
          <h3>Find a path to your data</h3>
          <p>
            Run the checks in order and inspect every result. No format,
            filesystem repair, write command, or SMART self-test is part of this
            workflow.
          </p>
          {historical && (
            <div className="inline-note">
              Historical report · return to a live session before running checks
              or creating an image.
            </div>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <Select
            label="Recovery target"
            value={key}
            disabled={running || loading || historical}
            onChange={setKey}
            options={targets.map((t) => ({
              value: t.key,
              label: t.name,
              detail:
                t.kind === "port"
                  ? "Host-port metadata / probe only"
                  : t.kind === "observation"
                    ? "Detected storage without a usable disk"
                    : `${t.device?.id} · ${t.device?.internal ? "Internal / excluded" : "Physical disk"}`,
            }))}
          />
          {(target?.device?.sizeBytes ?? target?.observation?.sizeBytes) && (
            <p>
              Reported capacity: <ByteValue value={(target?.device?.sizeBytes ?? target?.observation?.sizeBytes)!} />
            </p>
          )}
          <button
            className="button subtle"
            onClick={() => void loadTargets()}
            disabled={running || loading || historical}
          >
            <Icon name="refresh" />
            {loading ? "Reading targets…" : "Refresh targets"}
          </button>
          <button
            className="recovery-start-button"
            disabled={!key || running || loading || historical}
            onClick={() =>
              void start(key, options).catch((e) => setError(String(e)))
            }
          >
            <Icon
              name={running ? "refresh" : "shield"}
              className={running ? "spin" : ""}
              size={22}
            />
            <span>
              {running ? "Recovery checks running…" : "Start recovery checks"}
              <small>Read-only source · observed results</small>
            </span>
            <Icon name="arrow" />
          </button>
          <div className="recovery-options">
            <span className="eyebrow">OPTIONAL ACCESS ROUTES</span>
            <label className="check-field">
              <input
                type="checkbox"
                checked={options.directScsi}
                disabled={running || historical || platform !== "macOS"}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, directScsi: e.target.checked }))
                }
              />
              <span>
                Try direct USB / SCSI access
                <small>
                  macOS · request exclusive storage interfaces and run fixed
                  SCSI information commands when supported. May pause the OS driver.
                </small>
              </span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={options.reconnectUsb}
                disabled={running || historical || platform !== "macOS"}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, reconnectUsb: e.target.checked }))
                }
              />
              <span>
                Allow a connection retry
                <small>
                  macOS · reconnect the identified USB device, or request a
                  probe of the selected empty host port. This interrupts the USB
                  connection and is off by default.
                </small>
              </span>
            </label>
          </div>
          {running && (
            <button className="button" onClick={stop}>
              <Icon name="power" />
              Stop after terminating the current command
            </button>
          )}
          {stopping && (
            <div className="inline-note" role="status">
              {stopping}
            </div>
          )}
          {!historical && run?.state === "ready" && run.source && (
            <button
              className="button primary"
              onClick={() => continueToImage(run.source!)}
            >
              <Icon name="drive" />
              Choose destination & create image
            </button>
          )}
          <p className="source-label">
            Closing this window preserves the run. Detailed results and command
            output are saved with the session.
          </p>
        </section>
        <section
          className="recovery-report"
          aria-label="Recovery check results"
        >
          {run ? (
            <>
              <div className="recovery-report-target">
                <span className="eyebrow">{run.id}</span>
                <h2>{run.target.name}</h2>
              </div>
              <RecoveryResults run={run} showCommand={showCommand} />
            </>
          ) : (
            <div className="recovery-intro">
              <Icon name="drive" size={48} />
              <h2>One run. Every attempted route.</h2>
              <p>
                The report shows what ran, what returned, what was skipped, and
                the exact prerequisite that stopped progress. A failed access
                route can be followed by another enabled route.
              </p>
              <ul>
                <li>Refresh the current device and host observations</li>
                <li>Try applicable USB / SCSI access routes</li>
                <li>Validate identity, source policy and tool availability</li>
                <li>Read a bounded sample, then open image acquisition</li>
              </ul>
            </div>
          )}
          {target?.kind === "port" && !run && (
            <details>
              <summary>Original selected host-port properties</summary>
              <FieldTable
                value={target.port}
                source="IORegistry · current target snapshot"
              />
            </details>
          )}
        </section>
      </div>
    </Modal>
  );
}
function priority(t: RecoveryTarget) {
  return t.kind === "observation"
    ? 0
    : t.kind === "device" && t.device?.internal === false
      ? 1
      : t.kind === "port"
        ? 2
        : 3;
}
