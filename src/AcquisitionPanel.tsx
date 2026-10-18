import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, native } from "./bridge";
import { ModeDetails } from "./ModeDetails";
import { WorkspacePanel } from "./WorkspacePanel";
import { Icon } from "./Icon";
import { FieldTable } from "./FieldTable";
import { Select } from "./Select";
import { AcquisitionCharts } from "./AcquisitionCharts";
import { ByteValue } from "./ByteValue";
import { commandLine, canAcquireDevice, humanBytes } from "./data";
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
  clusterSectors: null,
  maxReadErrors: null,
};
const sourceLabel = (source: AcquisitionJob["source"], platform = "macOS") =>
  source.kind === "image"
    ? source.path
    : `/dev/${platform === "macOS" ? "r" : ""}${source.device.id} · ${source.device.name}`;
export function AcquisitionPanel({
  device,
  simple = false,
  preferPhysical = false,
  platform = "macOS",
  jobs,
  busy,
  close,
  started,
}: {
  device?: Device;
  simple?: boolean;
  preferPhysical?: boolean;
  platform?: string;
  jobs: AcquisitionJob[];
  busy: boolean;
  close: () => void;
  started: (job: AcquisitionJob) => void;
}) {
  const unavailableSource = device?.infoError
    ? `Source metadata query failed: ${device.infoError}`
    : platform === "macOS" && device?.internal === true
      ? "Internal disks are excluded from copying on macOS. Select an external disk or an existing image."
      : "This device is unavailable as a physical source. Select another disk or an existing image.";
  const mounted = useRef(true);
  const [kind, setKind] = useState<"image" | "physical">(
    (simple || preferPhysical) && canAcquireDevice(device)
      ? "physical"
      : "image",
  );
  const [step, setStep] = useState<"source" | "destination">("source");
  const [image, setImage] = useState("");
  const [destination, setDestination] = useState("");
  const [settings, setSettings] = useState<AcquisitionSettings>({
    ...defaults,
    sectorSize:
      (simple || preferPhysical) && canAcquireDevice(device)
        ? Number(
            (device.info as Record<string, Json>)?.DeviceBlockSize ??
              (device.info as Record<string, Json>)?.["log-sec"] ??
              512,
          )
        : 512,
  });
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (planRef.current) void bridge.cancelPlan(planRef.current.ticket);
    };
  }, []);
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
              reverse: settings.reverse ?? false,
              retryPasses: settings.retryPasses,
              timeoutSeconds: settings.timeoutSeconds,
              maxReadRate: settings.maxReadRate,
              clusterSectors: settings.clusterSectors ?? null,
              maxReadErrors: settings.maxReadErrors ?? null,
            }
          : resume.settings
        : settings,
      resumeJob: resume?.id ?? null,
    });
    if (!mounted.current) {
      await bridge.cancelPlan(next.ticket);
      return;
    }
    planRef.current = next;
    setPlan(next);
    setConfirmation("");
  }
  return (
    <WorkspacePanel
      title={simple ? "Create a disk image" : "Raw acquisition"}
      subtitle="Read-only source · disk image and resume map"
      close={dismiss}
      wide
      className={simple ? `simple-acquisition ${job ? "has-copy" : ""}` : ""}
    >
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {simple && (
        <ol className="workflow-steps" aria-label="Create image steps">
          <li data-current={!plan && step === "source"}>
            <button
              onClick={() => {
                if (!plan) setStep("source");
              }}
              disabled={!!plan}
            >
              1 <span>Choose source</span>
            </button>
          </li>
          <li data-current={!plan && step === "destination"}>
            <button
              disabled={
                !!plan ||
                (kind === "image" ? !image.trim() : !canAcquireDevice(device))
              }
              onClick={() => setStep("destination")}
            >
              2 <span>Save location</span>
            </button>
          </li>
          <li data-current={!!plan}>
            3 <span>Review and copy</span>
          </li>
        </ol>
      )}
      <div className="acquisition-layout">
        <section className="acquisition-form">
          <div className="section-heading">
            <h3>
              {plan
                ? "Review acquisition"
                : simple
                  ? step === "source"
                    ? "What do you want to copy?"
                    : "Where should the image be saved?"
                  : "Source and destination"}
            </h3>
            <span className="small-tag">NO SOURCE WRITES</span>
          </div>
          {plan ? (
            <>
              <div className="review-fact">
                <span className="eyebrow">READ-ONLY SOURCE</span>
                <code>{sourceLabel(plan.source, platform)}</code>
                <span>
                  <ByteValue value={plan.sourceSize} />
                </span>
              </div>
              <div className="review-fact">
                <span className="eyebrow">DESTINATION FOLDER</span>
                <code>{plan.destinationDirectory}</code>
                <span>
                  <ByteValue value={plan.freeBytes} /> available
                </span>
              </div>
              <div className="review-fact">
                <span className="eyebrow">
                  REQUESTED RANGE / ORIGINAL OFFSETS RETAINED
                </span>
                <code>
                  <ByteValue value={plan.settings.offset} /> +{" "}
                  <ByteValue value={plan.settings.length} />
                </code>
                <span>
                  The image retains source byte offsets and extends to{" "}
                  <ByteValue value={plan.sourceSize} />. Mapfile gaps identify
                  unread data.
                </span>
              </div>
              <ModeDetails simple={simple} title="Exact copy settings">
                <FieldTable
                  title="Acquisition settings"
                  value={plan.settings as unknown as Json}
                  source="Explicit execution parameters"
                />
              </ModeDetails>
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
                Physical sources require no mounted volumes and{" "}
                {platform === "Linux"
                  ? "an exclusive read-only block-device handle"
                  : "an active Disk Arbitration mount veto"}
                . This does not establish a hardware or system-wide write block.
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
              <section hidden={simple && step !== "source"}>
                <div className="source-choice">
                  <button
                    className={kind === "image" ? "active" : ""}
                    aria-pressed={kind === "image"}
                    disabled={working || active}
                    onClick={() => setKind("image")}
                  >
                    <Icon name="file" />
                    <span>
                      Image file
                      {simple && <small>Copy an existing raw disk image</small>}
                    </span>
                  </button>
                  <button
                    className={kind === "physical" ? "active" : ""}
                    aria-pressed={kind === "physical"}
                    disabled={
                      working ||
                      active ||
                      !device ||
                      device.metadataOnly ||
                      !canAcquireDevice(device)
                    }
                    onClick={() => {
                      setKind("physical");
                      setSettings((s) => ({
                        ...s,
                        sectorSize: Number(
                          (device?.info as Record<string, Json>)
                            ?.DeviceBlockSize ??
                            (device?.info as Record<string, Json>)?.[
                              "log-sec"
                            ] ??
                            512,
                        ),
                      }));
                    }}
                  >
                    <Icon name="drive" />
                    <span>
                      {simple ? "Connected disk" : "Selected physical device"}
                      {simple && (
                        <small>
                          {device?.name ?? "Select a disk in the sidebar"}
                        </small>
                      )}
                    </span>
                  </button>
                </div>
                {device?.metadataOnly && (
                  <div className="inline-note">
                    <Icon name="shield" />
                    <span>
                      {device.protectionReason} Choose an existing image file or
                      select another external source.
                    </span>
                  </div>
                )}
                {device &&
                  !device.metadataOnly &&
                  !canAcquireDevice(device) && (
                    <p className="panel-description">
                      {simple
                        ? unavailableSource
                        : "The selected device is not positively identified as an external source on macOS or a resolved non-system Linux disk. Physical acquisition is unavailable for this selection; you can still choose an image file."}
                    </p>
                  )}
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
                      /dev/{platform === "macOS" ? "r" : ""}
                      {device?.id} · {device?.name}
                    </code>
                    <span>
                      <ByteValue value={device?.sizeBytes} /> · observed
                      descriptor, not unique hardware identification
                    </span>
                  </div>
                )}
                {kind === "physical" && device?.metadataOnly && (
                  <div className="inline-note">
                    <Icon name="shield" />
                    {device.protectionReason}
                  </div>
                )}
                {simple && (
                  <div className="panel-actions">
                    <button
                      className="button primary"
                      disabled={
                        working ||
                        active ||
                        (kind === "image"
                          ? !image.trim()
                          : !canAcquireDevice(device))
                      }
                      onClick={() => setStep("destination")}
                    >
                      Continue to save location{" "}
                      <Icon name="chevron" size={12} />
                    </button>
                  </div>
                )}
              </section>
              <section hidden={simple && step !== "destination"}>
                {simple && (
                  <div className="copy-source-summary">
                    <Icon name="drive" />
                    <div>
                      <span>Copy from</span>
                      <strong>{kind === "image" ? image : device?.name}</strong>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setStep("source")}
                    >
                      Change source
                    </button>
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
                {simple && (
                  <dl
                    className="copy-settings-summary"
                    aria-label="Current copy settings"
                  >
                    <div>
                      <dt>Read range</dt>
                      <dd>
                        Offset <ByteValue value={settings.offset} /> ·{" "}
                        {settings.length ? (
                          <ByteValue value={settings.length} />
                        ) : (
                          "to end of source"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Read phases</dt>
                      <dd>
                        {settings.copyingOnly
                          ? "Copying phase only"
                          : "All read phases"}{" "}
                        · {settings.retryPasses} retry passes ·{" "}
                        {settings.reverse ? "Backwards" : "Forwards"}
                      </dd>
                    </div>
                    <div>
                      <dt>Read limits</dt>
                      <dd>
                        {settings.timeoutSeconds} s without a successful read ·{" "}
                        {settings.maxReadRate ? (
                          <>
                            <ByteValue value={settings.maxReadRate} />
                            /s
                          </>
                        ) : (
                          "No rate cap"
                        )}{" "}
                        ·{" "}
                        {settings.maxReadErrors === null ||
                        settings.maxReadErrors === undefined
                          ? "No error-count limit"
                          : `Stop after errors exceed ${settings.maxReadErrors}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Read size</dt>
                      <dd>
                        {settings.sectorSize} B sectors ·{" "}
                        {settings.clusterSectors
                          ? `${settings.clusterSectors} sectors per request`
                          : "Tool-default request size"}
                      </dd>
                    </div>
                  </dl>
                )}
                <ModeDetails simple={simple} title="Change copy settings">
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
                    <div
                      className="form-field"
                      data-hint="Controls the maximum sectors per copying request. Smaller requests can help when large reads fail or take too long, and may reduce throughput. It does not limit a blocked kernel call. Applied only after review."
                    >
                      <span>Read request size · logical sectors</span>
                      <Select
                        label="Read request size · logical sectors"
                        value={String(settings.clusterSectors ?? "default")}
                        disabled={working || active}
                        onChange={(value) =>
                          setSettings((s) => ({
                            ...s,
                            clusterSectors:
                              value === "default" ? null : Number(value),
                          }))
                        }
                        options={[
                          {
                            value: "default",
                            label: "Tool default",
                            detail: "ddrescue's default cluster size",
                          },
                          ...[1, 8, 32, 128, 512, 2048].map((n) => ({
                            value: String(n),
                            label: `${n} ${n === 1 ? "sector" : "sectors"}`,
                            detail: `${humanBytes(String(n * settings.sectorSize))} · ${n * settings.sectorSize} bytes per copying request`,
                          })),
                        ]}
                      />
                    </div>
                    <div
                      className="form-field"
                      data-hint="Stops the attempt after the selected number of read errors is exceeded. This counts read errors, not bad sectors. The image and saved map remain available for review. No automatic restart."
                    >
                      <span>Stop after read errors exceed</span>
                      <Select
                        label="Stop after read errors exceed"
                        value={String(settings.maxReadErrors ?? "none")}
                        disabled={working || active}
                        onChange={(value) =>
                          setSettings((s) => ({
                            ...s,
                            maxReadErrors:
                              value === "none" ? null : Number(value),
                          }))
                        }
                        options={[
                          { value: "none", label: "No error-count limit" },
                          ...[1, 5, 20, 100, 1000].map((n) => ({
                            value: String(n),
                            label: String(n),
                            detail: "Maximum read errors for this attempt",
                          })),
                        ]}
                      />
                    </div>
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
                        Skips ddrescue trimming, sweeping and scraping. All
                        flags appear in the command preview.
                      </small>
                    </span>
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.reverse ?? false}
                      disabled={working || active}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          reverse: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Read backwards
                      <small>
                        Explicit reverse direction for the requested range. Kept
                        in the command preview and saved parameters.
                      </small>
                    </span>
                  </label>
                </ModeDetails>
                <p className="panel-description">
                  The read-success timeout belongs to ddrescue; it cannot
                  guarantee an immediate return from a blocked operating-system
                  I/O call. Disk destinations and source writes are unavailable.{" "}
                  {platform === "Linux"
                    ? "Source preparation may open the system authorization dialog to request a read-only handle for this device; DRC stays unprivileged."
                    : "Privilege elevation is unavailable in this adapter."}
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
                    : simple
                      ? "Check source and review copy"
                      : "Prepare and review"}
                </button>
              </section>
            </>
          )}
        </section>
        <section className="acquisition-history">
          <div className="section-heading">
            <h3>
              {simple ? "Copy progress and history" : "Saved acquisitions"}
            </h3>
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
                <code data-hint={item.id}>
                  {simple ? sourceLabel(item.source, platform) : item.id}
                </code>
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
                <span>
                  Exit status: {job.exitCode ?? "not available"} · Signal:{" "}
                  {job.latestRecord?.terminationSignal ?? "none"}
                </span>
              </div>
              <code className="artifact-path">
                {sourceLabel(job.source, platform)}
              </code>
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
                      Uses the form's phases, retries, timeout, request size,
                      error limit and rate cap. Source, destination and range
                      remain fixed; review shows every setting.
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
                        ["unmapped", job.map.unmappedBytes ?? "0"],
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
                        ["Outside recorded map", job.map.unmappedBytes ?? "0"],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <ByteValue value={n} />
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary>Map blocks · {job.map.blocks.length} rows</summary>
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
    </WorkspacePanel>
  );
}
