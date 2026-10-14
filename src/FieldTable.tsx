import { useMemo, useState } from "react";
import type { Json } from "./types";
import { displayValue, flatten } from "./data";
import { ByteValue, isByteField } from "./ByteValue";
import { Icon } from "./Icon";
import { groupFields } from "./fieldGroups";

export function FieldTable({
  value,
  source,
  title = "All reported fields",
  onCopy,
  grouping = "branches",
}: {
  value: Json;
  source: string;
  title?: string;
  onCopy?: () => void;
  grouping?: "device" | "branches";
}) {
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"grouped" | "flat">("grouped");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fields = useMemo(() => flatten(value), [value]);
  const groups = useMemo(() => groupFields(value, grouping), [value, grouping]);
  const visible = useMemo(
    () =>
      fields.filter((field) =>
        `${field.path} ${isByteField(field.path, field.value) ? <ByteValue value={field.value}/> : displayValue(field.value)}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [fields, filter],
  );
  const matching = new Set(visible.map((f) => f.path));
  const table = (rows: typeof fields) => (
    <div className="field-table-wrap">
      <table className="field-table">
        <thead>
          <tr>
            <th>FIELD / PATH</th>
            <th>REPORTED VALUE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((field) => (
            <tr key={field.path}>
              <td>{field.path}</td>
              <td className={field.value === null ? "muted" : ""}>
                {isByteField(field.path, field.value) ? <ByteValue value={field.value}/> : displayValue(field.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="field-section">
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          <p className="source-label">{source}</p>
        </div>
        <div className="section-heading-right">
          <span className="count-tag">{fields.length} fields</span>
          {onCopy && (
            <button className="button subtle" onClick={onCopy}>
              <Icon name="copy" size={14} />
              Copy device JSON
            </button>
          )}
        </div>
      </div>
      <div className="field-toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            aria-label={`Filter ${title}`}
            placeholder="Filter field names or values…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              aria-label="Clear field filter"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
        <div className="view-switch" aria-label={`${title} layout`}>
          {(["grouped", "flat"] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {mode === "grouped" ? "Grouped" : "Flat paths"}
            </button>
          ))}
        </div>
        <span>
          {visible.length} / {fields.length} matched
          {filter ? ` · ${fields.length - visible.length} filtered` : ""}
        </span>
      </div>
      {view === "flat" ? (
        table(visible)
      ) : (
        <div className="field-groups">
          {groups.map((group) => {
            const rows = group.fields.filter((f) => matching.has(f.path));
            if (!rows.length) return null;
            const open = filter.length > 0 || !collapsed.has(group.id);
            return (
              <section className="field-group" key={group.id}>
                <button
                  className="field-group-heading"
                  aria-expanded={open}
                  onClick={() => {
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
                  }}
                  disabled={filter.length > 0}
                >
                  <Icon name={open ? "chevronDown" : "chevron"} size={13} />
                  <h4>{group.label}</h4>
                  <span>
                    {rows.length} fields{!open ? " · collapsed" : ""}
                  </span>
                </button>
                {open && table(rows)}
              </section>
            );
          })}
        </div>
      )}
      {visible.length === 0 && (
        <p className="empty-filter">
          No matching fields. Clear the filter to display all {fields.length}{" "}
          fields.
        </p>
      )}
    </section>
  );
}
