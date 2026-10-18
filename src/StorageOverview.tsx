import { ByteValue } from "./ByteValue";
import { Icon } from "./Icon";
import { timestamp } from "./data";
import { observationLabel } from "./UnavailableMediaView";
import type { Discovery } from "./types";

export function StorageOverview({
  snapshot,
  disabled,
  refresh,
  openDevice,
  openObservation,
  images,
  acquire,
  simple = false,
}: {
  snapshot: Discovery | null;
  disabled: boolean;
  refresh: () => void;
  openDevice: (id: string) => void;
  openObservation: (id: string) => void;
  images: () => void;
  acquire: () => void;
  simple?: boolean;
}) {
  const observations = snapshot?.unavailableMedia ?? [];
  return (
    <div className={`storage-overview ${simple ? "simple-storage" : ""}`}>
      <div className="storage-summary">
        <dl>
          <div>
            <dt>Disks</dt>
            <dd>{snapshot?.devices.length ?? "—"}</dd>
          </div>
          <div>
            <dt>Partitions</dt>
            <dd>
              {snapshot?.devices.reduce(
                (sum, disk) => sum + disk.partitions.length,
                0,
              ) ?? "—"}
            </dd>
          </div>
          <div data-hint="Host detections without a listed physical disk source. Their metadata can be inspected separately.">
            <dt>Without a disk source</dt>
            <dd>{snapshot ? observations.length : "—"}</dd>
          </div>
        </dl>
        <button className="button" disabled={disabled} onClick={refresh}>
          <Icon name="refresh" size={14} />
          Refresh devices
        </button>
      </div>
      <section aria-labelledby="storage-disks-heading">
        <div className="section-heading">
          <h3 id="storage-disks-heading">Disks</h3>
          <span className="source-label">
            {snapshot
              ? `Snapshot ${timestamp(snapshot.observedAt)}`
              : "No snapshot"}
          </span>
        </div>
        {snapshot?.devices.length ? (
          <div className="storage-device-list">
            {snapshot.devices.map((disk) => (
              <button
                key={disk.token}
                className="storage-device-row"
                onClick={() => openDevice(disk.id)}
                data-hint="Open device readings, partition layout and collected reports. This page is available in both modes; opening it does not start a query or sector read."
              >
                <span className="storage-device-symbol">
                  <Icon name="drive" size={22} />
                </span>
                <span className="storage-device-name">
                  <strong>{disk.name}</strong>
                  <code>/dev/{disk.id}</code>
                </span>
                <span className="storage-device-connection">
                  {disk.protocol ?? "Transport not reported"}
                  <small>
                    {disk.internal === true
                      ? "Internal"
                      : disk.internal === false
                        ? "External"
                        : "Location not reported"}
                    {disk.metadataOnly ? " · Metadata only" : ""}
                  </small>
                </span>
                <span className="storage-device-capacity">
                  <ByteValue value={disk.sizeBytes} />
                </span>
                <Icon name="chevron" size={12} />
              </button>
            ))}
          </div>
        ) : (
          <p className="storage-empty">
            {snapshot
              ? "No physical disks in this snapshot."
              : "Refresh devices to collect a storage snapshot."}
          </p>
        )}
      </section>
      {observations.length > 0 && (
        <section aria-labelledby="storage-observations-heading">
          <div className="section-heading">
            <h3 id="storage-observations-heading">
              Detected without a disk source
            </h3>
          </div>
          <div className="storage-device-list">
            {observations.map((item) => (
              <button
                key={item.id}
                className="storage-device-row"
                onClick={() => openObservation(item.id)}
                data-hint="Open the reported connection stage and complete original host fields."
              >
                <span className="storage-device-symbol">
                  <Icon name="usb" size={22} />
                </span>
                <span className="storage-device-name">
                  <strong>{item.name}</strong>
                  <small>{observationLabel(item.stage)}</small>
                </span>
                <span className="storage-device-connection">
                  {item.transport ?? "Transport not reported"}
                </span>
                <span className="storage-device-capacity">
                  <ByteValue value={item.sizeBytes} />
                </span>
                <Icon name="chevron" size={12} />
              </button>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="storage-images-heading">
        <div className="section-heading">
          <h3 id="storage-images-heading">Disk images</h3>
        </div>
        <div className="storage-image-actions">
          <button className="inspector-link" onClick={images}>
            <Icon name="folder" />
            <span>
              Open a disk image
              <small>Browse file entries and extract selected files</small>
            </span>
            <Icon name="chevron" size={12} />
          </button>
          <button className="inspector-link" onClick={acquire}>
            <Icon name="copy" />
            <span>
              Create a disk image
              <small>Review the source, destination and read settings</small>
            </span>
            <Icon name="chevron" size={12} />
          </button>
        </div>
      </section>
    </div>
  );
}
