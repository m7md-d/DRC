import { ByteValue } from "./ByteValue";
import { FieldTable } from "./FieldTable";
import { Icon } from "./Icon";
import { getField, displayValue, timestamp } from "./data";
import type { UnavailableMedia } from "./types";

export function observationLabel(stage: UnavailableMedia["stage"]): string {
  return {
    "interface-only": "Storage interface detected",
    "media-unassigned": "Media detected · no disk identifier",
    "not-listed": "Disk identifier absent from disk list",
    "enumeration-unavailable": "Disk list unavailable",
  }[stage];
}
export function UnavailableMediaView({
  item,
  refresh,
  ports,
  disabled,
  recover,
}: {
  item: UnavailableMedia;
  refresh: () => void;
  ports: () => void;
  disabled: boolean;
  recover?: () => void;
}) {
  const usb = getField(item.fields, "usb");
  const media = getField(item.fields, "media");
  const chain = getField(item.fields, "driverChain");
  const drivers = Array.isArray(chain)
    ? chain.filter(
        (entry) => getField(entry, "IOObjectClass") === "IOBlockStorageDriver",
      )
    : [];
  // Multiple LUNs may have different drivers. Show a summary only for an unambiguous one.
  const statistics =
    drivers.length === 1 ? getField(drivers[0], "Statistics") : undefined;
  const hasUsb = usb != null;
  const hasMedia = media != null;
  const steps = [
    {
      label: "USB device",
      value: hasUsb ? "Reported" : "Not part of this observation",
      present: hasUsb,
      hint: "A published USB device entry. This does not measure electrical current delivered to the SSD.",
    },
    {
      label: "Storage media",
      value: hasMedia ? "Reported" : "Not reported",
      present: hasMedia,
      hint: "An IOMedia entry reported in the host registry. Its capacity is a descriptor, not a successful sector read.",
    },
    {
      label: "Disk identifier",
      value: item.bsdName ?? "Not assigned",
      present: !!item.bsdName,
      hint: "A BSD Name such as disk4 is needed to address a physical disk through the operating system.",
    },
    {
      label: "Physical disk list",
      value:
        item.stage === "enumeration-unavailable"
          ? "Query unavailable"
          : "Not listed",
      present: false,
      hint: "The result of diskutil list -plist physical in this snapshot. Queries are sequential; connection changes can happen between observations.",
    },
  ];
  return (
    <section className="unavailable-view">
      <div className="unavailable-heading">
        <div>
          <span className="eyebrow">
            HOST OBSERVATION / NO ACQUISITION SOURCE
          </span>
          <h1>{item.name}</h1>
          <p>{observationLabel(item.stage)}</p>
        </div>
        <div className="unavailable-capacity">
          <strong>
            <ByteValue value={item.sizeBytes} />
          </strong>
          <small>Reported capacity</small>
        </div>
      </div>
      <ol className="detection-stages" aria-label="Storage detection stages">
        {steps.map((step) => (
          <li
            key={step.label}
            data-present={step.present}
            data-hint={step.hint}
          >
            <Icon name={step.present ? "check" : "info"} />
            <span>
              {step.label}
              <strong>{step.value}</strong>
            </span>
          </li>
        ))}
      </ol>
      <div className="unavailable-explanation">
        <Icon name="info" />
        <div>
          <h2>Detected, awaiting a usable disk</h2>
          <p>
            DRC can show the published properties below. Imaging and SMART are
            unavailable for this observation because it is not a current
            physical disk source. No sector reads have been performed to obtain
            these readings.
          </p>
          <p>
            A visible USB interface, reported capacity, busy flag or power state
            does not establish the cause of failure or prove that data can be
            read.
          </p>
        </div>
      </div>
      <div className="unavailable-facts">
        <div>
          <span>Transport</span>
          <strong>{item.transport ?? "Not reported"}</strong>
        </div>
        <div>
          <span>Preferred block size · bytes</span>
          <strong>
            {displayValue(getField(media ?? null, "Preferred Block Size"))}
          </strong>
        </div>
        <div data-hint="Original IOServiceBusyState on the media node. Preserve its value; do not interpret it as a hardware diagnosis.">
          <span>Media busy state · raw</span>
          <strong>
            {displayValue(getField(media ?? null, "IOServiceBusyState"))}
          </strong>
        </div>
        <div>
          <span>Observed</span>
          <strong>{timestamp(item.observedAt)} · snapshot</strong>
        </div>
      </div>
      {statistics != null && (
        <section className="unavailable-driver-readings">
          <h2>Host driver counters</h2>
          <p>
            Snapshot · all applications · cumulative for this driver instance.
            These are observations, not a DRC scan or a diagnosis.
          </p>
          <div className="unavailable-facts">
            {["Operations (Read)", "Errors (Read)", "Retries (Read)"].map(
              (key) => (
                <div key={key}>
                  <span>{key}</span>
                  <strong>{displayValue(getField(statistics, key))}</strong>
                </div>
              ),
            )}
            {["Bytes (Read)", "Bytes (Write)"].map((key) => (
              <div key={key}>
                <span>{key}</span>
                <strong>
                  <ByteValue value={getField(statistics, key)} />
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="unavailable-actions">
        {recover && (
          <button
            className="recovery-start-button"
            onClick={recover}
            disabled={disabled}
          >
            <Icon name="shield" size={23} />
            <span>
              Start recovery<small>Check access & try enabled routes</small>
            </span>
            <Icon name="arrow" />
          </button>
        )}
        <button
          className="button primary"
          onClick={refresh}
          disabled={disabled}
        >
          <Icon name="refresh" />
          Refresh detection
        </button>
        <button className="button" onClick={ports} disabled={disabled}>
          <Icon name="hub" />
          Inspect ports & enclosure
        </button>
      </div>
      <FieldTable
        title="Original registry properties & driver chain"
        source="IORegistry · published properties only · exact numeric strings"
        value={item.fields}
      />
    </section>
  );
}
