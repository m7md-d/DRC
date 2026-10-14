import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, native } from "./bridge";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { FieldTable } from "./FieldTable";
import { Select } from "./Select";
import { AcquisitionCharts } from "./AcquisitionCharts";
import { humanBytes, commandLine } from "./data";
import type {
  AcquisitionJob,
  AcquisitionPlan,
  AcquisitionSettings,
  Device,
  Json,
} from "./types";

const defaults: AcquisitionSettings = {
  offset: "0",
  length: null,
  sectorSize: 512,
  retryPasses: 0,
  copyingOnly: true,
  timeoutSeconds: 30,
  maxReadRate: null,
};
const sourceLabel = (source: AcquisitionJob["source"]) =>
  source.kind === "image"
    ? source.path
    : `/dev/r${source.device.id} · ${source.device.name}`;
export function AcquisitionPanel({
  device,
  jobs,
  busy,
  close,
  started,
}: {
  device?: Device;
  jobs: AcquisitionJob[];
  busy: boolean;
  close: () => void;
  started: (job: AcquisitionJob) => void;
}) {
  const [kind, setKind] = useState<"image" | "physical">("image");
  const [image, setImage] = useState("");
  const [destination, setDestination] = useState("");
  const [settings, setSettings] = useState<AcquisitionSettings>(defaults);
  const [plan, setPlan] = useState<AcquisitionPlan | null>(null);
  const planRef = useRef<AcquisitionPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(jobs[0]?.id ?? null);
  const [rawMap, setRawMap] = useState<string | null>(null);
  const [editedResume, setEditedResume] = useState(false);
  const job = jobs.find((j) => j.id === chosen) ?? jobs[0];
  const active = jobs.some((j) => ["running", "pausing"].includes(j.state));
  const discard = useCallback(() => {
    if (planRef.current) void bridge.cancelPlan(planRef.current.ticket);
    planRef.current = null;
    setPlan(null);
    setConfirmation("");
  }, []);
  const dismiss = useCallback(() => {
    discard();
    close();
  }, [discard, close]);
  useEffect(
    () => () => {
      if (planRef.current) void bridge.cancelPlan(planRef.current.ticket);
    },
    [],
  );
  async function action(fn: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  async function prepare(resume?: AcquisitionJob) {
    discard();
    const source = resume?.source;
    const next = await bridge.prepareAcquisition({
      kind: source?.kind ?? kind,
      imagePath: source?.kind === "image" ? source.path : image || null,
      deviceToken: device?.token ?? null,
      destination,
      settings: resume
        ? editedResume
          ? {
              ...resume.settings,
              copyingOnly: settings.copyingOnly,
              retryPasses: settings.retryPasses,
              timeoutSeconds: settings.timeoutSeconds,
              maxReadRate: settings.maxReadRate,
            }
          : resume.settings
        : settings,
      resumeJob: resume?.id ?? null,
    });
    planRef.current = next;
    setPlan(next);
    setConfirmation("");
  }
  return (
    <Modal
      title="Raw acquisition"
      subtitle="SOURCE READ ONLY → NEW IMAGE + RESUME MAP"
      close={dismiss}
      wide
    >
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="acquisition-layout">
        <section className="acquisition-form">
          <div className="section-heading">
            <h3>{plan ? "Review acquisition" : "Source and destination"}</h3>
            <span className="small-tag">NO SOURCE WRITES</span>
          </div>
          {plan ? (
            <>
              <div className="review-fact">
                <span className="eyebrow">READ-ONLY SOURCE</span>
                <code>{sourceLabel(plan.source)}</code>
                <span>
                  {plan.sourceSize} bytes · {humanBytes(plan.sourceSize)}
                </span>
              </div>
              <div className="review-fact">
                <span className="eyebrow">DESTINATION FOLDER</span>
                <code>{plan.destinationDirectory}</code>
                <span>{plan.freeBytes} bytes available</span>
              </div>
              <div className="review-fact">
                <span className="eyebrow">
                  REQUESTED RANGE / ORIGINAL OFFSETS RETAINED
                </span>
                <code>
                  {plan.settings.offset} + {plan.settings.length} bytes
                </code>
                <span>
                  The image retains source byte offsets and extends to{" "}
                  {plan.sourceSize} bytes. Mapfile gaps identify unread data.
                </span>
              </div>
              <FieldTable
                title="Every acquisition setting"
                value={plan.settings as unknown as Json}
                source="Explicit execution parameters"
              />
              <div className="command-preview acquisition-command">
                <span className="eyebrow">COMMAND PREVIEW</span>
                <code>
                  {commandLine({
                    program: plan.program,
                    arguments: plan.arguments,
                  })}
                </code>
              </div>
              <p className="panel-description">
                Execution binds the input to an already opened read-only handle.
                Physical sources require no mounted volumes and an active Disk
                Arbitration mount veto. This does not establish a hardware or
                system-wide write block.
              </p>
              <label className="form-field">
                Type <code>{plan.confirmation}</code> to confirm the source
                <input
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <div className="panel-actions">
                <button className="button" disabled={working} onClick={discard}>
                  Back
                </button>
                <button
                  className="button primary"
                  disabled={
                    working || confirmation !== plan.confirmation || active
                  }
                  onClick={() =>
                    void action(async () => {
                      const next = await bridge.startAcquisition(
                        plan.ticket,
                        confirmation,
                      );
                      planRef.current = null;
                      setPlan(null);
                      setChosen(next.id);
                      started(next);
                    })
                  }
                >
                  <Icon name="drive" />
                  {plan.resumeJob ? "Resume acquisition" : "Start acquisition"}
                </button>
              </div>
              <p className="source-label">
                Plan expires{" "}
                {new Date(plan.expiresAt).toLocaleTimeString("en-GB")} · No
                automatic reconnect or resume.
              </p>
            </>
          ) : (
            <>
              <div className="source-choice">
                <button
                  className={kind === "image" ? "active" : ""}
                  aria-pressed={kind === "image"}
                  disabled={working || active}
                  onClick={() => setKind("image")}
                >
                  <Icon name="file" />
                  Image file
                </button>
                <button
                  className={kind === "physical" ? "active" : ""}
                  aria-pressed={kind === "physical"}
                  disabled={
                    working ||
                    active ||
                    !device ||
                    device.metadataOnly ||
                    device.internal !== false
                  }
                  onClick={() => {
                    setKind("physical");
                    setSettings((s) => ({
                      ...s,
                      sectorSize: Number(
                        (device?.info as Record<string, Json>)
                          ?.DeviceBlockSize ?? 512,
                      ),
                    }));
                  }}
                >
                  <Icon name="drive" />
                  Selected physical device
                </button>
              </div>
              {kind === "image" ? (
                <label className="form-field">
                  Source image
                  <div className="path-field">
                    <input
                      value={image}
                      placeholder="Absolute path to a regular image file"
                      disabled={working || active}
                      onChange={(e) => setImage(e.target.value)}
                    />
                    <button
                      className="button"
                      disabled={working || active}
                      onClick={() =>
                        void action(async () => {
                          const path = await bridge.pick("sourceImage");
                          if (path) setImage(path);
                        })
                      }
                    >
                      Choose…
                    </button>
                  </div>
                </label>
              ) : (
                <div className="review-fact">
                  <code>
                    /dev/r{device?.id} · {device?.name}
                  </code>
                  <span>
                    {device?.sizeBytes} bytes · observed descriptor, not unique
                    hardware identification
                  </span>
                </div>
              )}
              {kind === "physical" && device?.metadataOnly && (
                <div className="inline-note">
                  <Icon name="shield" />
                  {device.protectionReason}
                </div>
              )}
              <label className="form-field">
                Destination folder
                <div className="path-field">
                  <input
                    value={destination}
                    placeholder="A new DRC acquisition folder will be created here"
                    disabled={working || active}
                    onChange={(e) => setDestination(e.target.value)}
                  />
                  <button
                    className="button"
                    disabled={working || active}
                    onClick={() =>
                      void action(async () => {
                        const path = await bridge.pick("destination");
                        if (path) setDestination(path);
                      })
                    }
                  >
                    Choose…
                  </button>
                </div>
              </label>
              <div className="form-grid">
                <label className="form-field">
                  Input offset · bytes
                  <input
                    inputMode="numeric"
                    value={settings.offset}
                    disabled={working || active}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, offset: e.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  Length · bytes
                  <input
                    inputMode="numeric"
                    placeholder="Remaining source bytes"
                    value={settings.length ?? ""}
                    disabled={working || active}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        length: e.target.value || null,
                      }))
                    }
                  />
                </label>
                <div className="form-field">
                  <span>Logical sector size · bytes</span>
                  <Select
                    label="Logical sector size · bytes"
                    value={String(settings.sectorSize)}
                    disabled={working || active}
                    onChange={(value) =>
                      setSettings((s) => ({
                        ...s,
                        sectorSize: Number(value),
                      }))
                    }
                    options={[512, 1024, 2048, 4096].map((n) => ({
                      value: String(n),
                      label: String(n),
                      detail: `${n} bytes per logical sector`,
                    }))}
                  />
                </div>
                <label className="form-field">
                  Retry passes · 0–5
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={settings.retryPasses}
                    disabled={working || active}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        retryPasses: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="form-field">
                  Time since last successful read · seconds
                  <input
                    type="number"
                    min="1"
                    max="3600"
                    value={settings.timeoutSeconds}
                    disabled={working || active}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        timeoutSeconds: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="form-field">
                  Maximum read rate · bytes/s
                  <input
                    inputMode="numeric"
                    placeholder="No cap"
                    value={settings.maxReadRate ?? ""}
                    disabled={working || active}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        maxReadRate: e.target.value || null,
                      }))
                    }
                  />
                </label>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={settings.copyingOnly}
                  disabled={working || active}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      copyingOnly: e.target.checked,
                    }))
                  }
                />
                <span>
                  Copying phase only
                  <small>
                    Skips ddrescue trimming, sweeping and scraping. All flags
                    appear in the command preview.
                  </small>
                </span>
              </label>
              <p className="panel-description">
                The read-success timeout belongs to ddrescue; it cannot
                guarantee an immediate return from a blocked macOS I/O call.
                Disk destinations, source writes and privilege elevation are
                unavailable.
              </p>
              <button
                className="button primary"
                disabled={
                  !native ||
                  working ||
                  busy ||
                  active ||
                  !destination ||
                  (kind === "image" && !image)
                }
                onClick={() => void action(() => prepare())}
              >
                <Icon name="shield" />
                {working
                  ? "Checking source and destination…"
                  : "Prepare and review"}
              </button>
            </>
          )}
        </section>
        <section className="acquisition-history">
          <div className="section-heading">
            <h3>Saved acquisitions</h3>
            <span className="count-tag">{jobs.length}</span>
          </div>
          <div className="job-list">
            {jobs.map((item) => (
              <button
                key={item.id}
                className={`job-row ${job?.id === item.id ? "active" : ""}`}
                onClick={() => {
                  setChosen(item.id);
                  setRawMap(null);
                }}
              >
                <code>{item.id}</code>
                <span>
                  {item.state} · attempt {item.attempts}
                </span>
              </button>
            ))}
          </div>
          {!job && (
            <p className="panel-description">
              No acquisition has been created. Reading metadata does not start a
              copy or sector scan.
            </p>
          )}
          {job && (
            <>
              <div className="job-state" data-state={job.state}>
                <strong>{job.state}</strong>
                <span>Exit status: {job.exitCode ?? "not available"}</span>
              </div>
              <code className="artifact-path">{sourceLabel(job.source)}</code>
              <p className="panel-description">{job.message}</p>
              <AcquisitionCharts key={job.id} job={job} />
              {!["running", "pausing", "completed"].includes(job.state) && (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={editedResume}
                    onChange={(e) => setEditedResume(e.target.checked)}
                    disabled={working || active}
                  />
                  <span>
                    Use the edited read settings on resume
                    <small>
                      Uses the form's phases, retries, timeout and rate cap.
                      Source, destination and range remain fixed; review shows
                      every setting.
                    </small>
                  </span>
                </label>
              )}
              <div className="panel-actions">
                {["running", "pausing"].includes(job.state) ? (
                  <button
                    className="button"
                    disabled={working || job.state === "pausing"}
                    onClick={() =>
                      void action(() => bridge.pauseAcquisition(job.id))
                    }
                  >
                    Stop and save map
                  </button>
                ) : (
                  <button
                    className="button"
                    disabled={
                      working ||
                      busy ||
                      active ||
                      job.state === "completed" ||
                      (job.source.kind === "physical" &&
                        (!device || device.metadataOnly))
                    }
                    onClick={() => void action(() => prepare(job))}
                  >
                    Review resume
                  </button>
                )}
                <button
                  className="button"
                  disabled={!job.map || working}
                  onClick={() =>
                    void action(async () =>
                      setRawMap(await bridge.acquisitionMap(job.id)),
                    )
                  }
                >
                  Original mapfile
                </button>
              </div>
              {job.map && (
                <>
                  <div
                    className="map-meter"
                    aria-label="Mapfile status by byte count"
                  >
                    {(
                      [
                        ["+", job.map.rescuedBytes],
                        ["?", job.map.nonTriedBytes],
                        ["*", job.map.nonTrimmedBytes],
                        ["/", job.map.nonScrapedBytes],
                        ["-", job.map.badSectorBytes],
                      ] as const
                    )
                      .filter(([, n]) => BigInt(n) > 0n)
                      .map(([status, n]) => (
                        <span
                          key={status}
                          data-map-status={status}
                          title={`${status}: ${n} bytes`}
                          style={{
                            flexGrow:
                              Number(
                                (BigInt(n) * 10000n) /
                                  BigInt(job.map!.domainBytes),
                              ) || 0.01,
                          }}
                        />
                      ))}
                  </div>
                  <div className="map-counts">
                    {(
                      [
                        ["Finished (+)", job.map.rescuedBytes],
                        ["Non-tried (?)", job.map.nonTriedBytes],
                        ["Non-trimmed (*)", job.map.nonTrimmedBytes],
                        ["Non-scraped (/)", job.map.nonScrapedBytes],
                        ["Bad-sector (-)", job.map.badSectorBytes],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <code>{n} bytes</code>
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary>
                      Every map block · {job.map.blocks.length} rows
                    </summary>
                    <FieldTable
                      title="All map blocks"
                      value={job.map.blocks as unknown as Json}
                      source="ddrescue mapfile · original positions, lengths and statuses"
                    />
                  </details>
                </>
              )}
              {rawMap !== null && (
                <pre className="raw-map" tabIndex={0}>
                  {rawMap}
                </pre>
              )}
              <details>
                <summary>Saved paths and parameters</summary>
                <div className="artifact-fields">
                  {[
                    ["IMAGE", job.imagePath],
                    ["MAPFILE", job.mapPath],
                    ["STDOUT", job.stdoutPath],
                    ["STDERR", job.stderrPath],
                  ].map(([label, path]) => (
                    <div key={label}>
                      <span className="eyebrow">{label}</span>
                      <code>{path}</code>
                    </div>
                  ))}
                </div>
                <FieldTable
                  title="Saved settings"
                  value={job.settings as unknown as Json}
                  source={job.toolVersion.split("\n")[0]}
                />
              </details>
              <p className="source-label">
                Original command output streams are shown in Command output and
                retained on disk.
              </p>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
