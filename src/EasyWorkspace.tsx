import { Icon } from "./Icon";
import { getField, displayValue, timestamp } from "./data";
import { ByteValue } from "./ByteValue";
import { PartitionChart } from "./PartitionChart";
import { AcquisitionCharts } from "./AcquisitionCharts";
import type { AcquisitionJob, Device, QueryResult, ToolReport } from "./types";
function CapacityRing({ device }: { device?: Device }) {
  const total =
    device?.sizeBytes && /^\d+$/.test(device.sizeBytes)
      ? BigInt(device.sizeBytes)
      : 0n;
  const values =
    device?.partitions.map((p) => getField(p, "Size") ?? getField(p, "size")) ??
    [];
  const valid =
    total > 0n && values.every((v) => typeof v === "string" && /^\d+$/.test(v));
  const parts = valid ? values.map((v) => BigInt(v as string)) : [];
  const sum = parts.reduce((a, b) => a + b, 0n);
  const domain = sum > total ? sum : total;
  let offset = 0;
  const colors = [
    "var(--selection)",
    "var(--information)",
    "var(--policy)",
    "var(--warning)",
  ];
  return (
    <div
      className="easy-capacity-ring"
      data-hint="The ring shows reported partition proportions, not free space, health or imaging progress."
    >
      <svg
        viewBox="0 0 120 120"
        role="img"
        aria-label="Reported partition proportions"
      >
        <circle cx="60" cy="60" r="49" className="ring-track" />
        {valid &&
          parts.map((p, i) => {
            const fraction = Number((p * 1000000n) / domain) / 10000;
            const start = offset;
            offset += fraction;
            return (
              <circle
                key={i}
                cx="60"
                cy="60"
                r="49"
                pathLength="100"
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth="8"
                strokeDasharray={`${fraction} ${100 - fraction}`}
                strokeDashoffset={-start}
                transform="rotate(-90 60 60)"
              />
            );
          })}
      </svg>
      <Icon name="drive" size={34} />
    </div>
  );
}
export function EasyWorkspace({
  device,
  smart,
  jobs,
  tools,
  disabled,
  inspect,
  connections,
  acquire,
  images,
  details,
  reference,
}: {
  device?: Device;
  smart?: QueryResult;
  jobs: AcquisitionJob[];
  tools: ToolReport[];
  disabled: boolean;
  inspect: () => void;
  connections: () => void;
  acquire: () => void;
  images: () => void;
  details: () => void;
  reference: () => void;
}) {
  const job =
    jobs.find((j) => ["running", "pausing"].includes(j.state)) ?? jobs[0];
  const passed = getField(
    getField(smart?.fields ?? null, "smart_status"),
    "passed",
  );
  const temperature =
    getField(getField(smart?.fields ?? null, "temperature"), "current") ??
    getField(
      getField(smart?.fields ?? null, "nvme_smart_health_information_log"),
      "temperature",
    );
  const reader = tools.find((t) => t.key === "drc-tsk"),
    copier = tools.find((t) => t.key === "ddrescue"),
    smartTool = tools.find((t) => t.key === "smartctl");
  const system =
    device?.internal === true ||
    getField(getField(device?.info, "drcObservation"), "systemBacking") ===
      true;
  const access = device?.metadataOnly
    ? "Metadata only"
    : system
      ? "System media"
      : "Read only";
  return (
    <div className="easy-workspace">
      <div className="easy-content">
        <div className="easy-title">
          <div>
            <span className="eyebrow">RECOVERY WORKSPACE</span>
            <h1>Your disk. Your next step.</h1>
          </div>
          <span
            className="easy-policy"
            data-hint="DRC does not write to the source. Open the read-only policy for operating-system protection limits."
          >
            <Icon name="shield" />
            Source read only
          </span>
        </div>
        <div className="easy-overview">
          <article className="easy-disk-card">
            <CapacityRing device={device} />
            <div className="easy-disk-info">
              <span className="eyebrow">
                {device ? "SELECTED DISK" : "GET STARTED"}
              </span>
              <h2>{device?.name ?? "Select a disk, or open an image"}</h2>
              <p>
                {device
                  ? `/dev/${device.id} · ${device.protocol ?? "Transport not reported"}`
                  : "Connected media appear in the device list. Existing images can be opened below."}
              </p>
              <div className="easy-capacity">
                <ByteValue value={device?.sizeBytes} />
                <span>Reported capacity</span>
              </div>
              <small>
                {device
                  ? `Observed ${timestamp(device.observedAt)} · ${device.partitions.length} listed entries`
                  : "No disk selected"}
              </small>
            </div>
          </article>
          <div className="easy-readings">
            <article data-hint="Whether the selected device was returned in the last metadata snapshot. This does not test sector readability.">
              <Icon name="usb" />
              <span>Connection</span>
              <strong>
                {device
                  ? device.infoError
                    ? "Metadata error"
                    : "Observed"
                  : "No selection"}
              </strong>
            </article>
            <article data-hint="The tool's reported SMART status, without a DRC health score. A passed status does not prove every file is intact.">
              <Icon name="chart" />
              <span>SMART · tool reported</span>
              <strong>
                {typeof passed === "boolean"
                  ? passed
                    ? "Passed"
                    : "Failed"
                  : smart
                    ? "Not reported"
                    : "Not queried"}
              </strong>
            </article>
            <article data-hint="Device-reported temperature from the explicit SMART/NVMe query. This is not ambient or externally measured temperature.">
              <Icon name="temperature" />
              <span>Temperature</span>
              <strong>
                {temperature !== undefined
                  ? `${displayValue(temperature)} °C`
                  : "Not reported"}
              </strong>
            </article>
            <article data-hint="Metadata-only and system media cannot be physical imaging sources. Image files on resolved local storage remain available.">
              <Icon name="shield" />
              <span>Source access</span>
              <strong>{access}</strong>
            </article>
          </div>
        </div>
        <div className="easy-section-heading">
          <h2>What would you like to do?</h2>
          <button className="button subtle" onClick={reference}>
            <Icon name="file" />
            Command reference
          </button>
        </div>
        <div className="easy-actions">
          <article className="easy-action inspect">
            <div className="easy-action-icon">
              <Icon name="chart" size={25} />
            </div>
            <div className="easy-action-text">
              <span className="eyebrow">INSPECT</span>
              <h3>Inspect disk</h3>
              <p>Read the disk's reported status and temperature.</p>
            </div>
            <div className="easy-action-controls">
              <button
                className="button primary"
                disabled={
                  disabled ||
                  !device ||
                  device.metadataOnly ||
                  !smartTool?.available
                }
                onClick={inspect}
              >
                Inspect disk
                <Icon name="arrow" />
              </button>
              <button
                className="button subtle"
                disabled={disabled}
                onClick={connections}
              >
                <Icon name="hub" />
                Ports & enclosures
              </button>
            </div>
            <small>
              {device?.metadataOnly
                ? "This disk allows reported metadata only."
                : !smartTool?.available
                  ? "smartmontools is required. See Command reference."
                  : "No self-test. Every query is your choice."}
            </small>
          </article>
          <article className="easy-action image">
            <div className="easy-action-icon">
              <Icon name="copy" size={25} />
            </div>
            <div className="easy-action-text">
              <span className="eyebrow">SAVE AN IMAGE</span>
              <h3>Copy the disk safely</h3>
              <p>Save raw sectors and a map of what has been read.</p>
            </div>
            <div className="easy-action-controls">
              <button
                className="button primary"
                disabled={disabled || !copier?.available}
                onClick={acquire}
              >
                Create disk image
                <Icon name="arrow" />
              </button>
            </div>
            <small>
              {!copier?.available
                ? "GNU ddrescue is required. See Command reference."
                : "Choose a destination and review before copying."}
            </small>
          </article>
          <article className="easy-action explore">
            <div className="easy-action-icon">
              <Icon name="folder" size={25} />
            </div>
            <div className="easy-action-text">
              <span className="eyebrow">RECOVER FILES</span>
              <h3>Explore an image</h3>
              <p>Browse an existing image and save selected files.</p>
            </div>
            <div className="easy-action-controls">
              <button
                className="button primary"
                disabled={disabled || !reader?.available}
                onClick={images}
              >
                Browse an image
                <Icon name="arrow" />
              </button>
            </div>
            <small>
              {reader?.available
                ? "The source image stays read only."
                : "Image reader unavailable in this installation."}
            </small>
          </article>
        </div>
        {device && (
          <section className="easy-observations">
            <div className="easy-section-heading">
              <div>
                <span className="eyebrow">DISK LAYOUT</span>
                <h2>Reported partitions</h2>
              </div>
              <button className="button subtle" onClick={details}>
                All readings
                <Icon name="arrow" />
              </button>
            </div>
            <PartitionChart device={device} />
          </section>
        )}
        {job && (
          <section className="easy-job">
            <div className="easy-section-heading">
              <div>
                <span className="eyebrow">LATEST DISK IMAGE</span>
                <h2>{job.state.replaceAll("_", " ")}</h2>
                <code>
                  {job.source.kind === "image"
                    ? job.source.path
                    : `/dev/${job.source.device.id}`}
                </code>
              </div>
              <button className="button" onClick={acquire}>
                Progress, pause and resume
              </button>
            </div>
            <div className="easy-job-counts">
              <div>
                <span>Finished · mapfile</span>
                <strong>
                  <ByteValue value={job.map?.rescuedBytes} />
                </strong>
              </div>
              <div>
                <span>Bad sectors · mapfile</span>
                <strong>
                  <ByteValue value={job.map?.badSectorBytes} />
                </strong>
              </div>
              {job.map && BigInt(job.map.unmappedBytes ?? "0") > 0n && <div data-hint="These bytes belong to the reviewed range but have no block entry in the saved map. No successful or failed-read status is invented for them.">
                <span>Outside recorded map</span>
                <strong><ByteValue value={job.map.unmappedBytes}/></strong>
              </div>}
              <div>
                <span>Image path</span>
                <code>{job.imagePath}</code>
              </div>
            </div>
            {job.message && <p className="panel-description">{job.message}</p>}
            <AcquisitionCharts job={job} />
          </section>
        )}
      </div>
    </div>
  );
}
