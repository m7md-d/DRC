import { useMemo, useState } from "react";
import { portMeasurements, portTopology, type PortNode } from "./portTopology";
import { getField, timestamp, displayValue } from "./data";
import { FieldTable } from "./FieldTable";
import { PortStatistics } from "./PortStatistics";
import { ByteValue } from "./ByteValue";
import { Icon } from "./Icon";
import { ModeDetails } from "./ModeDetails";
import { Select } from "./Select";
import type { QueryResult } from "./types";
import { portReadingGroups, allPortReadings } from "./portReadings";
function flattened(nodes: PortNode[]): PortNode[] {
  return nodes.flatMap((n) => [n, ...flattened(n.children)]);
}
export function PortTree({
  report,
  simple = false,
}: {
  report: QueryResult;
  simple?: boolean;
}) {
  const roots = useMemo(
    () => report.topology ?? portTopology(report.fields),
    [report],
  );
  const all = useMemo(() => flattened(roots), [roots]);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const node =
    all.find((n) => n.id === selected) ??
    all.find((n) => !!n.observations?.length || n.fields !== null) ??
    roots[0];
  const reportedStorage = node
    ? flattened([node]).flatMap((n) => n.diskIds)
    : [];
  const storageIds = [...new Set(reportedStorage)];
  const observations = node ? portReadingGroups(node) : [];
  const observation = observations[evidenceIndex] ?? observations[0];
  const inspected = node ? allPortReadings(node, observations) : node;
  function pathTo(nodes: PortNode[], id: string): PortNode[] {
    for (const root of nodes) {
      if (root.id === id) return [root];
      const path = pathTo(root.children, id);
      if (path.length) return [root, ...path];
    }
    return [];
  }
  const path = node ? pathTo(roots, node.id) : [];
  function choose(item: PortNode) {
    setSelected(item.id);
    setEvidenceIndex(0);
  }
  function connectionCard(item: PortNode, active = node?.id === item.id) {
    return (
      <button
        key={item.id}
        className="connection-card"
        aria-pressed={active}
        onClick={() => choose(item)}
        data-hint={`Open ${item.label}. Parent relationship reported by ${item.source}.`}
      >
        <Icon
          name={
            /network/i.test(item.kind)
              ? "network"
              : /display/i.test(item.kind)
                ? "display"
                : item.diskIds.length
                  ? "drive"
                  : item.children.length
                    ? "hub"
                    : "usb"
          }
          size={20}
        />
        <span>
          <strong>{item.label}</strong>
          <small>
            {item.kind}
            {item.children.length
              ? ` · ${item.children.length} ${item.children.length === 1 ? "connection" : "connections"}`
              : ""}
          </small>
        </span>
        <Icon name="chevron" size={12} />
      </button>
    );
  }
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
                  onClick={() => {
                    setSelected(n.id);
                    setEvidenceIndex(0);
                  }}
                  aria-pressed={node?.id === n.id}
                  data-hint={`Inspect ${n.label}. This node and its parent relationship come from ${n.source}.`}
                >
                  <span className="port-node-icon">
                    <Icon
                      name={
                        n.kind.toLowerCase().includes("network")
                          ? "network"
                          : n.kind.toLowerCase().includes("display")
                            ? "display"
                            : n.diskIds.length
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
    <section className={`port-map ${simple ? "simple-port-map" : ""}`}>
      <div className="port-map-heading">
        <div>
          <h3
            hidden={simple}
            data-hint="The hierarchy the host reported. Hubs, bridges, ports and storage identifiers retain their original parent relationships."
          >
            Ports & enclosures
          </h3>
          <p>
            {all.length} connection entries ·{" "}
            {new Date(report.record.startedAt).toLocaleDateString("en-GB")}{" "}
            {timestamp(report.record.startedAt)} · snapshot
          </p>
        </div>
        <span className="small-tag" hidden={simple}>
          HOST OBSERVATIONS
        </span>
      </div>
      <div className="port-map-layout">
        <nav className="port-tree" aria-label="Reported port hierarchy">
          {roots.length && simple ? (
            <div className="connection-root-list">
              {roots.map((root) =>
                connectionCard(root, path[0]?.id === root.id),
              )}
            </div>
          ) : roots.length ? (
            draw(roots)
          ) : (
            <p>No hierarchy returned. Inspect the original output below.</p>
          )}
        </nav>
        <div className="port-inspector">
          {node && (
            <>
              {simple && (
                <ol
                  className="connection-path"
                  aria-label="Selected connection path"
                >
                  {path.map((item) => (
                    <li key={item.id}>
                      <Icon name="chevron" size={10} />
                      <button
                        onClick={() => choose(item)}
                        aria-current={
                          item.id === node.id ? "location" : undefined
                        }
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <span className="eyebrow" hidden={simple}>
                SELECTED NODE
              </span>
              <h3>{node.label}</h3>
              <p className="source-label">
                {node.kind}
                {!simple && ` · ${node.source}`}
              </p>
              {simple && node.children.length > 0 && (
                <section
                  className="child-connections"
                  aria-label="Child connections"
                >
                  <h4>Connected below {node.label}</h4>
                  <div>{node.children.map((item) => connectionCard(item))}</div>
                </section>
              )}
              <div className="port-readings">
                {node.kind === "Hub port" && (
                  <article data-hint="Published child devices on this logical hub port. No child reported does not establish the state of an unenumerated device or identify the printed socket number.">
                    <span>Published child devices</span>
                    <strong>{node.children.length}</strong>
                    <code>Reported hierarchy only</code>
                  </article>
                )}
                {node.kind === "Display output" && (
                  <article data-hint="The host reports its display transport. A converter's downstream HDMI or DisplayPort socket is identified only if the driver publishes it.">
                    <span>Adapter connector</span>
                    <strong>Not reported by host</strong>
                    <code>Host transport shown separately</code>
                  </article>
                )}
                {(getField(inspected?.fields ?? node.fields, "sizeBytes") ??
                  getField(inspected?.fields ?? node.fields, "size_in_bytes") ??
                  getField(inspected?.fields ?? node.fields, "Size") ??
                  getField(inspected?.fields ?? node.fields, "size")) !==
                  undefined && (
                  <article>
                    <span>Reported capacity</span>
                    <strong>
                      <ByteValue
                        value={
                          getField(
                            inspected?.fields ?? node.fields,
                            "sizeBytes",
                          ) ??
                          getField(
                            inspected?.fields ?? node.fields,
                            "size_in_bytes",
                          ) ??
                          getField(inspected?.fields ?? node.fields, "Size") ??
                          getField(inspected?.fields ?? node.fields, "size")
                        }
                      />
                    </strong>
                  </article>
                )}
                {getField(
                  inspected?.fields ?? node.fields,
                  "link-error-count",
                ) !== undefined && (
                  <article data-hint="The original host-port link-error counter. This does not assign the error to the SSD or establish its cause.">
                    <span>Reported link errors</span>
                    <strong>
                      {displayValue(
                        getField(
                          inspected?.fields ?? node.fields,
                          "link-error-count",
                        ),
                      )}
                    </strong>
                    <code hidden={simple}>link-error-count</code>
                  </article>
                )}

                {portMeasurements(inspected ?? node).map((m) => (
                  <article key={m.label} data-hint={m.hint}>
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                    <code hidden={simple}>
                      {m.key ?? "No property returned"}
                    </code>
                  </article>
                ))}
                {!/network|display/i.test(node.kind) && (
                  <article data-hint="No electrical telemetry hardware is connected to DRC. Registry power state and USB current budgets do not measure current inside the enclosure.">
                    <span>Actual current / voltage</span>
                    <strong>Not measured</strong>
                    <code>Requires a telemetry instrument</code>
                  </article>
                )}
                {!/network|display/i.test(node.kind) && (
                  <article data-hint="Only a block-device ID explicitly reported here or a canonical sysfs parent path is associated with a disk. Matching model names alone is insufficient.">
                    <span>Reported storage · this branch</span>
                    <strong>
                      {storageIds.length
                        ? storageIds.map((id) => `/dev/${id}`).join(", ")
                        : "No storage identifier reported in this branch"}
                    </strong>
                  </article>
                )}
              </div>
              <PortStatistics
                simple={simple}
                fields={inspected?.fields ?? node.fields}
              />
              {(node.kind.includes("storage") ||
                node.kind === "USB hub" ||
                node.kind === "USB device") && (
                <div className="inline-note">
                  <Icon name="info" />
                  <span>
                    An enumerated enclosure reports its bridge. Its power budget
                    or visible USB node does not prove that power reaches the
                    SSD, that its controller responds, or that sectors are
                    readable. Child media appear only when the host reports
                    them.
                  </span>
                </div>
              )}
              {observation && (
                <ModeDetails
                  simple={simple}
                  title="Original names and properties"
                >
                  {observations.length > 0 && (
                    <div className="port-evidence">
                      {observations.length > 1 ? (
                        <Select
                          label="Original property source"
                          value={String(
                            Math.min(evidenceIndex, observations.length - 1),
                          )}
                          onChange={(v) => setEvidenceIndex(Number(v))}
                          options={observations.map((o, i) => ({
                            value: String(i),
                            label: o.label,
                            detail: o.rawName,
                          }))}
                        />
                      ) : (
                        <p className="source-label">{observations[0].label}</p>
                      )}
                      <p>
                        <strong>Original name:</strong>{" "}
                        <code>{observation?.rawName}</code>
                      </p>
                      <p className="source-label">
                        Readings below combine the reported sources. Original
                        properties are grouped by source.
                      </p>
                    </div>
                  )}

                  <FieldTable
                    value={observation.fields}
                    source={observation.label}
                    title="Original node properties"
                  />
                  {observation.variants.length > 0 && (
                    <p className="source-label">
                      Properties with different reported values:{" "}
                      {observation.variants.join(", ")}. See the original
                      readings below.
                    </p>
                  )}
                  {observation.readings.length > 1 && (
                    <details>
                      <summary>
                        Original readings · {observation.readings.length}
                      </summary>
                      {observation.readings.map((reading, i) => (
                        <FieldTable
                          key={i}
                          value={reading.fields}
                          source={`${reading.source} · ${reading.relation}`}
                          title={reading.rawName}
                        />
                      ))}
                    </details>
                  )}
                </ModeDetails>
              )}
            </>
          )}
        </div>
      </div>
      {[
        ["IORegistryUSBReport", "USB registry"],
        ["IORegistryPortReport", "USB host ports"],
        ["IORegistryStorageReport", "USB services"],
        ["IORegistryNetworkReport", "Network registry"],
        ["IORegistryTransportReport", "Port transports"],
        ["NetworkInterfaceReport", "Network interfaces"],
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
