import { getField, displayValue, humanBytes } from "./data";
import type { Device } from "./types";

const colors = [
  "var(--selection)",
  "var(--information)",
  "var(--policy)",
  "var(--warning)",
];
export function PartitionChart({ device }: { device: Device }) {
  const entries = device.partitions.map((p, i) => ({
    label: displayValue(getField(p, "DeviceIdentifier")),
    name: displayValue(getField(p, "Content")),
    size: getField(p, "Size"),
    index: i,
  }));
  if (
    !device.sizeBytes ||
    !/^\d+$/.test(device.sizeBytes) ||
    entries.some((p) => typeof p.size !== "string" || !/^\d+$/.test(p.size))
  )
    return (
      <p className="source-label">
        Capacity proportions require a reported device size and an exact byte
        count for every listed entry.
      </p>
    );
  const total = BigInt(device.sizeBytes),
    sum = entries.reduce((n, p) => n + BigInt(p.size as string), 0n);
  const domain = sum > total ? sum : total;
  if (!domain) return null;
  const percent = (n: bigint) => Number((n * 1000000n) / domain) / 10000;
  return (
    <section className="partition-chart">
      <div className="plot-heading">
        <h4>Reported capacity distribution</h4>
        <span>
          {humanBytes(device.sizeBytes)} · {device.sizeBytes} bytes
        </span>
      </div>
      <div
        className="capacity-bar"
        role="img"
        aria-label="Proportions of listed partition sizes, with exact values below"
      >
        {entries.map((p) => (
          <span
            key={p.index}
            style={{
              width: `${percent(BigInt(p.size as string))}%`,
              background: colors[p.index % colors.length],
            }}
            title={`${p.label} · ${p.size} bytes`}
          />
        ))}
        {sum < total && (
          <span
            className="capacity-remainder"
            style={{ width: `${percent(total - sum)}%` }}
            title={`${total - sum} bytes outside listed entries`}
          />
        )}
      </div>
      <div className="capacity-legend">
        {entries.map((p) => (
          <div key={p.index}>
            <i style={{ background: colors[p.index % colors.length] }} />
            <code>{p.label}</code>
            <span>{p.name}</span>
            <code>{p.size as string} bytes</code>
          </div>
        ))}
        {sum < total && (
          <div>
            <i className="capacity-remainder" />
            <span>Outside listed entries</span>
            <code>{String(total - sum)} bytes</code>
          </div>
        )}
      </div>
      <p className="source-label">
        Proportions use reported sizes, without enlarging small entries. The
        arithmetic remainder does not indicate filesystem free space.
        {sum > total
          ? " Listed sizes exceed reported device capacity; this bar is normalized to their sum."
          : ""}
      </p>
    </section>
  );
}
