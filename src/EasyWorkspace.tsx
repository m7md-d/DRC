import { useState, type ReactNode } from "react";
import { FieldTable } from "./FieldTable";
import { Icon } from "./Icon";
import { getField, displayValue, timestamp } from "./data";
import { ByteValue } from "./ByteValue";
import { PartitionChart } from "./PartitionChart";
import { AcquisitionCharts } from "./AcquisitionCharts";
import type { AcquisitionJob, Device, QueryResult, ToolReport } from "./types";
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
  navigation,
  platform,
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
  navigation?: ReactNode;
  platform: string;
  reference: () => void;
}) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
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
  const access = !device
    ? "No selection"
    : device.metadataOnly
      ? "Metadata only"
      : system
        ? "System media"
        : "Read only";
  return (
    <div className="easy-workspace">
      <div className="easy-content">
        <header className="overview-heading">
          <div className="source-symbol">
            <Icon name="drive" size={27} />
          </div>
          <div className="overview-heading-title">
            <h1>{device?.name ?? "Storage overview"}</h1>
            <p>
              {device ? (
                <>
                  <code>/dev/{device.id}</code>
                  <span>
                    {" "}
                    · {device.protocol ?? "Transport not reported"} · Observed{" "}
                    {timestamp(device.observedAt)}
                  </span>
                </>
              ) : (
                "Select a connected device, or work from an existing image."
              )}
            </p>
          </div>
          {device && (
            <div className="overview-capacity">
              <strong>
                <ByteValue value={device.sizeBytes} />
              </strong>
              <span>Reported capacity</span>
            </div>
          )}
        </header>
        {navigation}
        <dl className="overview-readings">
          <div data-hint="Returned in the most recent metadata snapshot. This does not test sector readability.">
            <dt>Connection</dt>
            <dd>
              <span
                className={`status-dot ${device && !device.infoError ? "live" : ""}`}
              />
              {device
                ? device.infoError
                  ? "Metadata error"
                  : "Observed"
                : "No selection"}
            </dd>
          </div>
          <div data-hint="Original SMART result. A passed status does not prove all data is readable.">
            <dt>SMART status</dt>
            <dd>
              {typeof passed === "boolean"
                ? passed
                  ? "Passed"
                  : "Failed"
                : smart
                  ? "Not reported"
                  : "Not queried"}
            </dd>
          </div>
          <div data-hint="Device-reported temperature from an explicit SMART query.">
            <dt>Temperature</dt>
            <dd>
              {temperature !== undefined
                ? `${displayValue(temperature)} °C`
                : "Not reported"}
            </dd>
          </div>
          <div data-hint="System and metadata-only devices cannot be physical imaging sources.">
            <dt>Source access</dt>
            <dd>
              <Icon name="shield" size={13} />
              {access}
            </dd>
          </div>
        </dl>
        <div hidden={!fieldsOpen} className="overview-original-fields">
          {device && (
            <FieldTable
              value={device.info}
              grouping="device"
              title="All device fields"
              source={`${platform === "Linux" ? "lsblk / udev" : "diskutil info -plist"} ${device.id} · exact numeric strings`}
            />
          )}
        </div>
        <div className="overview-columns">
          <section className="task-section">
            <div className="easy-section-heading">
              <h2>Disk actions</h2>
              <button
                className="text-button"
                onClick={() => setFieldsOpen((value) => !value)}
                aria-expanded={fieldsOpen}
                disabled={!device}
                data-hint="Show the original device fields below the overview. No query is started."
              >
                All readings
                <Icon name="chevron" size={12} />
              </button>
            </div>
            <div className="task-list">
              <div className="task-row">
                <span className="task-symbol">
                  <Icon name="chart" size={19} />
                </span>
                <div>
                  <h3>Inspect disk</h3>
                  <p>Read SMART information and temperature.</p>
                  <small>
                    {device?.metadataOnly
                      ? "Metadata-only source"
                      : !smartTool?.available
                        ? "Requires smartmontools"
                        : "Information query · no self-test"}
                  </small>
                </div>
                <button
                  className="button"
                  disabled={
                    disabled ||
                    !device ||
                    device.metadataOnly ||
                    !smartTool?.available
                  }
                  onClick={inspect}
                >
                  Inspect
                </button>
              </div>
              <div className="task-row">
                <span className="task-symbol">
                  <Icon name="copy" size={19} />
                </span>
                <div>
                  <h3>Create disk image</h3>
                  <p>Copy raw sectors with a resumable read map.</p>
                  <small>
                    {!copier?.available
                      ? "Requires GNU ddrescue"
                      : "Review source and destination before copying"}
                  </small>
                </div>
                <button
                  className="button"
                  disabled={disabled || !copier?.available}
                  onClick={acquire}
                >
                  Create image…
                </button>
              </div>
              <div className="task-row">
                <span className="task-symbol">
                  <Icon name="folder" size={19} />
                </span>
                <div>
                  <h3>Recover files from an image</h3>
                  <p>Browse the image and extract selected files.</p>
                  <small>
                    {reader?.available
                      ? "Image remains read only"
                      : "Image reader unavailable"}
                  </small>
                </div>
                <button
                  className="button"
                  disabled={disabled || !reader?.available}
                  onClick={images}
                >
                  Open image…
                </button>
              </div>
            </div>
          </section>
          <aside className="overview-inspector">
            <h2>Connection & tools</h2>
            <button
              className="inspector-link"
              disabled={disabled}
              onClick={connections}
            >
              <Icon name="hub" />
              <span>
                Ports & enclosures
                <small>Inspect the complete connection path</small>
              </span>
              <Icon name="chevron" size={12} />
            </button>
            <button className="inspector-link" onClick={reference}>
              <Icon name="file" />
              <span>
                Command reference
                <small>Tools, flags and installation commands</small>
              </span>
              <Icon name="chevron" size={12} />
            </button>
            <p className="inspector-note">
              <Icon name="shield" size={14} />
              DRC commands keep the source read only. Protection limits are
              available in the toolbar.
            </p>
          </aside>
        </div>
        {device && (
          <section className="easy-observations">
            <div className="easy-section-heading">
              <div>
                <h2>Reported partitions</h2>
              </div>
              <button
                className="button subtle"
                onClick={() => setFieldsOpen((value) => !value)}
                aria-expanded={fieldsOpen}
                data-hint="Show the original device fields below the overview. No query is started."
              >
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
                <span className="eyebrow">Latest disk image</span>
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
              {job.map && BigInt(job.map.unmappedBytes ?? "0") > 0n && (
                <div data-hint="These bytes belong to the reviewed range but have no block entry in the saved map. No successful or failed-read status is invented for them.">
                  <span>Outside recorded map</span>
                  <strong>
                    <ByteValue value={job.map.unmappedBytes} />
                  </strong>
                </div>
              )}
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
