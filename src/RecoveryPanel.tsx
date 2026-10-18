import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { WorkspacePanel } from "./WorkspacePanel";
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
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [run.id]);
  const active =
    run.steps.find((s) => s.key === selected) ??
    run.steps.find((s) => s.state === "running") ??
    run.steps.filter((s) => s.state === "failed").at(-1) ??
    run.steps.filter((s) => s.state === "passed").at(-1) ??
    run.steps[0];
  const duration = (step: RecoveryRun["steps"][number]) =>
    step.startedAt == null
      ? "—"
      : `${(Math.max(0, (step.finishedAt ?? now) - step.startedAt) / 1000).toFixed(1)} s`;
  return (
    <div className="recovery-results">
      <div className="recovery-progress-section">
        <div className="recovery-progress-label">
          <strong>
            {run.state === "running"
              ? "Checking recovery access"
              : run.state === "ready"
                ? "Source sample read"
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
        >
          <span
            style={{
              width: `${run.steps.length ? (processed / run.steps.length) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="recovery-progress-note">
          Steps processed · disk coverage is not measured here
        </p>
        {run.issue && (
          <div className="recovery-issue" role="alert">
            <Icon name="info" size={17} />
            <div>
              <strong>{run.issue.title}</strong>
              <details>
                <summary>
                  Error details · <code>{run.issue.code}</code>
                </summary>
                <p>{run.issue.detail}</p>
                <p>Scope: {run.issue.scope}</p>
                <pre>{JSON.stringify(run.issue.evidence, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
        {run.state === "ready" && (
          <div className="inline-note">
            <Icon name="shield" />
            <span>
              The sample was read successfully. The remaining disk has not been
              checked. Select a destination and review the command to create an image.
            </span>
          </div>
        )}
      </div>
      <div className="recovery-detail-layout">
        <section className="recovery-check-list" aria-label="Recovery checks">
          <div className="list-column-heading">
            <span>Check</span>
            <span>Duration</span>
          </div>
          <ol className="recovery-steps">
            {run.steps.map((step, index) => (
              <li key={step.key} data-state={step.state}>
                <button
                  className={active?.key === step.key ? "selected" : ""}
                  aria-pressed={active?.key === step.key}
                  onClick={() => setSelected(step.key)}
                  data-hint={`${step.label}: ${stateLabels[step.state]}. Select to inspect its observed result and original commands.`}
                >
                  <span className="recovery-step-icon">
                    {step.state === "running" ? (
                      <Icon name="refresh" className="spin" size={14} />
                    ) : step.state === "passed" ? (
                      <Icon name="check" size={14} />
                    ) : step.state === "failed" ? (
                      <Icon name="info" size={14} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="recovery-step-title">
                    <strong>{step.label}</strong>
                    <small>{stateLabels[step.state]}</small>
                  </span>
                  <code>{duration(step)}</code>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section
          className="recovery-step-inspector"
          aria-label="Selected check details"
        >
          {run.steps.map((step, index) => (
            <article key={step.key} hidden={active?.key !== step.key}>
              <div className="inspector-kicker">
                Check {index + 1} of {run.steps.length}
                <span data-state={step.state}>{stateLabels[step.state]}</span>
              </div>
              <h3>{step.label}</h3>
              <p className="step-result">
                {step.detail ||
                  (step.state === "running"
                    ? "Operation in progress…"
                    : "Waiting for its prerequisite.")}
              </p>
              <dl className="step-timing">
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(step)}</dd>
                </div>
                <div>
                  <dt>Commands</dt>
                  <dd>{step.commandIds.length}</dd>
                </div>
              </dl>
              {step.issue && (
                <div className="recovery-step-error">
                  <strong>{step.issue.title}</strong>
                  <code>{step.issue.code}</code>
                  {step.issue.detail !== step.detail && (
                    <p>{step.issue.detail}</p>
                  )}
                </div>
              )}
              {step.commandIds.length > 0 && (
                <div className="recovery-command-links">
                  <h4>Original commands</h4>
                  {step.commandIds.map((id) => (
                    <button
                      className="command-link"
                      key={id}
                      onClick={() => showCommand(id)}
                    >
                      <Icon name="terminal" size={14} />
                      <span>{id}</span>
                      <Icon name="arrow" size={13} />
                    </button>
                  ))}
                </div>
              )}
              {step.evidence != null && (
                <details className="step-evidence" open>
                  <summary>Check details</summary>
                  <pre>{JSON.stringify(step.evidence, null, 2)}</pre>
                </details>
              )}
            </article>
          ))}
        </section>
      </div>
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
    run ? [run.target] : [],
  );
  const [key, setKey] = useState(
    (historical || running) && run ? run.target.key : (initialKey ?? ""),
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
    <WorkspacePanel
      title="Recovery checks"
      subtitle="Check detection, source access and sample reads."
      close={close}
      wide
      className="recovery-modal"
      footer={
        <>
          <span className="footer-note">
            <Icon name="shield" size={13} />
            {running
              ? "Checks continue if this window is closed."
              : "Checks and command output are saved in this session."}
          </span>
          <button className="button" onClick={close}>
            Close
          </button>
          {running ? (
            <button className="button" onClick={stop} disabled={!!stopping}>
              <Icon name="power" />
              {stopping ? "Stopping…" : "Stop checks"}
            </button>
          ) : !historical && run?.state === "ready" && run.source ? (
            <button
              className="button primary"
              onClick={() => continueToImage(run.source!)}
            >
              Choose destination…
              <Icon name="arrow" />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={!key || loading || historical}
              onClick={() =>
                void start(key, options).catch((e) => setError(String(e)))
              }
            >
              <Icon name="shield" />
              Run checks
            </button>
          )}
        </>
      }
    >
      <details className="recovery-configuration" open={!run}>
        <summary data-hint="Select the target and optional access routes for the next check. These settings are separate from the last saved run.">
          <strong>{running ? "Current target" : "Next check target"}</strong>
          <span>
            {target?.name ??
              (loading ? "Reading targets…" : "No target selected")}
          </span>
          <small>Configure…</small>
        </summary>
        <div className="recovery-source-bar">
          <Icon name="drive" size={23} />
          <div className="recovery-target-field">
            <label>Next check target</label>
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
          </div>
          <div className="recovery-target-capacity">
            <span>Reported capacity</span>
            <ByteValue
              value={
                target?.device?.sizeBytes ?? target?.observation?.sizeBytes
              }
            />
          </div>
          <button
            className="toolbar-icon"
            aria-label="Refresh recovery targets"
            onClick={() => void loadTargets()}
            disabled={running || loading || historical}
          >
            <Icon name="refresh" className={loading ? "spin" : ""} />
          </button>
        </div>
        <details className="recovery-options">
          <summary data-hint="Optional access routes are off by default. They can interrupt the USB connection or pause a host driver.">
            Access options
            <span>
              {options.directScsi || options.reconnectUsb
                ? "Custom routes enabled"
                : "Standard read-only checks"}
            </span>
          </summary>
          <div className="recovery-option-fields">
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
                  macOS · request exclusive storage interfaces and fixed SCSI
                  information commands. May pause the OS driver.
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
                  macOS · reconnect the identified USB device, or probe the
                  selected empty host port. Interrupts the USB connection.
                </small>
              </span>
            </label>
          </div>
          <p>
            Access checks keep the source read-only.
          </p>
        </details>
      </details>
      {historical && (
        <div className="inline-note">
          Historical report · return to a live session before running checks or
          creating an image.
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {stopping && (
        <div className="inline-note" role="status">
          {stopping}
        </div>
      )}
      <section className="recovery-report" aria-label="Recovery check results">
        {run ? (
          <>
            <div className="recovery-report-target">
              <strong>
                {run.state === "running" ? "Current run" : "Last run"} ·{" "}
                {run.target.name}
              </strong>
              <code data-hint={`Run ID: ${run.id}`}>
                {new Date(run.startedAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </code>
            </div>
            <RecoveryResults run={run} showCommand={showCommand} />
          </>
        ) : (
          <div className="recovery-intro">
            <Icon name="shield" size={28} />
            <h3>Check access before imaging</h3>
            <p>
              Select a device or port. Each check shows its result and command output.
            </p>
            <ol>
              <li>
                <strong>Detect</strong>
                <span>Refresh device and host observations</span>
              </li>
              <li>
                <strong>Verify access</strong>
                <span>Try enabled routes and validate identity</span>
              </li>
              <li>
                <strong>Read a sample</strong>
                <span>Test a bounded range through a read-only handle</span>
              </li>
              <li>
                <strong>Create an image</strong>
                <span>Choose a destination and review the copy command</span>
              </li>
            </ol>
          </div>
        )}
        {target?.kind === "port" && !run && (
          <details className="port-properties">
            <summary>Original selected host-port properties</summary>
            <FieldTable
              value={target.port}
              source="IORegistry · current target snapshot"
            />
          </details>
        )}
      </section>
    </WorkspacePanel>
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
