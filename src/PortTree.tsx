import { useMemo, useState } from "react";
import { portMeasurements, portTopology, type PortNode } from "./portTopology";
import { getField, timestamp, displayValue } from "./data";
import { FieldTable } from "./FieldTable";
import { PortStatistics } from "./PortStatistics";
import { ByteValue } from "./ByteValue";
import { Icon } from "./Icon";
import type { QueryResult } from "./types";
function flattened(nodes: PortNode[]): PortNode[] {
  return nodes.flatMap((n) => [n, ...flattened(n.children)]);
}
export function PortTree({ report }: { report: QueryResult }) {
  const roots = useMemo(() => portTopology(report.fields), [report]);
  const all = useMemo(() => flattened(roots), [roots]);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const node =
    all.find((n) => n.id === selected) ??
    all.find((n) => n.fields !== null) ??
    roots[0];
  const reportedStorage = node
    ? flattened([node]).flatMap((n) => n.diskIds)
    : [];
  const storageIds = [...new Set(reportedStorage)];
  function draw(nodes: PortNode[]) {
    return (
      <ul>
        {nodes.map((n) => {
          const open = !collapsed.has(n.id);
          return (
            <li key={n.id}>
              <div
                className={`port-node ${node?.id === n.id ? "selected" : ""}`}
              >
                <button
                  className="port-expand"
                  disabled={!n.children.length}
                  aria-label={`${open ? "Collapse" : "Expand"} ${n.label}`}
                  aria-expanded={n.children.length ? open : undefined}
                  onClick={() =>
                    setCollapsed((s) => {
                      const next = new Set(s);
                      if (open) next.add(n.id);
                      else next.delete(n.id);
                      return next;
                    })
                  }
                >
                  <Icon
                    name={
                      n.children.length
                        ? open
                          ? "chevronDown"
                          : "chevron"
                        : "grid"
                    }
                    size={13}
                  />
                </button>
                <button
                  className="port-select"
                  onClick={() => setSelected(n.id)}
                  aria-pressed={node?.id === n.id}
                  data-hint={`Inspect ${n.label}. This node and its parent relationship come from ${n.source}.`}
                >
                  <span className="port-node-icon">
                    <Icon
                      name={
                        n.diskIds.length
                          ? "drive"
                          : n.children.length
                            ? "hub"
                            : "usb"
                      }
                      size={19}
                    />
                  </span>
                  <span>
                    <strong>{n.label}</strong>
                    <small>{n.kind}</small>
                  </span>
                  {n.diskIds.length > 0 && <code>{n.diskIds.join(", ")}</code>}
                </button>
              </div>
              {open && !!n.children.length && draw(n.children)}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section className="port-map">
      <div className="port-map-heading">
        <div>
          <h3 data-hint="The hierarchy the host reported. Hubs, bridges, ports and storage identifiers retain their original parent relationships.">
            Ports & enclosures
          </h3>
          <p>
            {all.length} reported nodes ·{" "}
            {new Date(report.record.startedAt).toLocaleDateString("en-GB")}{" "}
            {timestamp(report.record.startedAt)} · snapshot
          </p>
        </div>
        <span className="small-tag">HOST OBSERVATIONS</span>
      </div>
      <div className="port-map-layout">
        <nav className="port-tree" aria-label="Reported port hierarchy">
          {roots.length ? (
            draw(roots)
          ) : (
            <p>No hierarchy returned. Inspect the original output below.</p>
          )}
        </nav>
        <div className="port-inspector">
          {node && (
            <>
              <span className="eyebrow">SELECTED NODE</span>
              <h3>{node.label}</h3>
              <p className="source-label">
                {node.kind} · {node.source}
              </p>
              <div className="port-readings">
                {(getField(node.fields, "sizeBytes") ??
                  getField(node.fields, "size")) !== undefined && (
                  <article>
                    <span>Reported capacity</span>
                    <strong>
                      <ByteValue
                        value={
                          getField(node.fields, "sizeBytes") ??
                          getField(node.fields, "size")
                        }
                      />
                    </strong>
                  </article>
                )}
                {getField(node.fields, "link-error-count") !== undefined && (
                  <article data-hint="The original host-port link-error counter. This does not assign the error to the SSD or establish its cause.">
                    <span>Reported link errors</span>
                    <strong>
                      {displayValue(getField(node.fields, "link-error-count"))}
                    </strong>
                    <code>link-error-count</code>
                  </article>
                )}

                {portMeasurements(node).map((m) => (
                  <article key={m.label} data-hint={m.hint}>
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                    <code>{m.key ?? "No property returned"}</code>
                  </article>
                ))}
                <article data-hint="No electrical telemetry hardware is connected to DRC. Registry power state and USB current budgets do not measure current inside the enclosure.">
                  <span>Actual current / voltage</span>
                  <strong>Not measured</strong>
                  <code>Requires a telemetry instrument</code>
                </article>
                <article data-hint="Only a block-device ID explicitly reported here or a canonical sysfs parent path is associated with a disk. Matching model names alone is insufficient.">
                  <span>Reported storage · this branch</span>
                  <strong>
                    {storageIds.length
                      ? storageIds.map((id) => `/dev/${id}`).join(", ")
                      : "No storage identifier reported in this branch"}
                  </strong>
                </article>
              </div>
              <PortStatistics fields={node.fields} />
              <div className="inline-note">
                <Icon name="info" />
                <span>
                  An enumerated enclosure reports its bridge. Its power budget
                  or visible USB node does not prove that power reaches the SSD,
                  that its controller responds, or that sectors are readable.
                  Child media appear only when the host reports them.
                </span>
              </div>
              {node.fields !== null && (
                <details className="port-properties">
                  <summary>All properties of this node</summary>
                  <FieldTable
                    value={node.fields}
                    source={node.source}
                    title="Original node properties"
                  />
                </details>
              )}
            </>
          )}
        </div>
      </div>
      {[
        ["IORegistryUSBReport", "USB registry"],
        ["IORegistryPortReport", "USB host ports"],
      ].map(([key, label]) => {
        const error = getField(getField(report.fields, key), "parseError");
        return error ? (
          <p className="error-box" key={key}>
            {label}: {displayValue(error)}. Original command output is retained.
          </p>
        ) : null;
      })}
    </section>
  );
}
