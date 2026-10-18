import { useState } from "react";
import { WorkspacePanel } from "./WorkspacePanel";
import { Select } from "./Select";
import { Icon } from "./Icon";
import { ModeDetails } from "./ModeDetails";
import {
  categories,
  effects,
  packageFamilies,
  normalizeLinuxFamily,
  referenceCommands,
  searchReference,
  type ReferenceOS,
  type LinuxFamily,
  type ReferenceCategory,
} from "./commandReference";
export function CheatSheet({
  platform,
  close,
  copy,
  simple = false,
}: {
  platform: string;
  close: () => void;
  copy: (value: string) => Promise<void>;
  simple?: boolean;
}) {
  const [os, setOS] = useState<ReferenceOS>(() => {
    const saved = localStorage.getItem("drc.referenceOS");
    return saved === "linux" || saved === "macos"
      ? saved
      : platform === "Linux"
        ? "linux"
        : "macos";
  });
  const [family, setFamily] = useState<LinuxFamily>(() => {
    const family = normalizeLinuxFamily(
      localStorage.getItem("drc.referenceFamily"),
    );
    localStorage.setItem("drc.referenceFamily", family);
    return family;
  });
  const [category, setCategory] = useState<ReferenceCategory>("setup");
  const [query, setQuery] = useState("");
  const [writes, setWrites] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = referenceCommands(os, family).filter(
    (c) =>
      (writes || c.effect !== "source-write") &&
      (query.trim() || c.category === category) &&
      searchReference(c, query),
  );
  return (
    <WorkspacePanel
      title="Command reference"
      subtitle="Offline tools, commands and flags."
      close={close}
      wide
      className={`reference-modal ${simple ? "simple-reference" : ""}`}
    >
      <div className="reference-toolbar">
        <div className="mode-switch" aria-label="Reference operating system">
          <button
            aria-pressed={os === "macos"}
            onClick={() => {
              setOS("macos");
              localStorage.setItem("drc.referenceOS", "macos");
            }}
          >
            macOS
          </button>
          <button
            aria-pressed={os === "linux"}
            onClick={() => {
              setOS("linux");
              localStorage.setItem("drc.referenceOS", "linux");
            }}
          >
            Linux
          </button>
        </div>
        {os === "linux" && (
          <Select
            label="Linux package family"
            value={family}
            onChange={(v) => {
              setFamily(v as LinuxFamily);
              localStorage.setItem("drc.referenceFamily", v);
            }}
            options={Object.entries(packageFamilies).map(
              ([value, profile]) => ({
                value,
                label: profile.name,
                detail: profile.detail,
              }),
            )}
          />
        )}
        <label className="search">
          <Icon name="search" />
          <input
            aria-label="Search command reference"
            placeholder="Search tools, commands or flags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="reference-note">
        <Icon name="info" />
        <span>
          Copy-only examples. Replace placeholders and verify paths before
          running commands. Installation follows the selected Linux family.
        </span>
      </div>
      {simple && (
        <div className="reference-task-picker">
          <div className="form-field">
            <span>What do you want to do?</span>
            <Select
              label="Command task"
              value={category}
              onChange={(value) => {
                setCategory(value as ReferenceCategory);
                setQuery("");
              }}
              options={categories
                .filter((c) => writes || c.id !== "maintenance")
                .map((c) => ({
                  value: c.id,
                  label: c.label,
                  detail: c.description,
                }))}
            />
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={writes}
              onChange={(e) => {
                setWrites(e.target.checked);
                if (!e.target.checked && category === "maintenance")
                  setCategory("setup");
              }}
            />
            <span>
              Show write references<small>Destructive operations</small>
            </span>
          </label>
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="reference-layout">
        <nav
          className="reference-nav"
          aria-label="Command categories"
          hidden={simple}
        >
          {categories
            .filter((c) => writes || c.id !== "maintenance")
            .map((c) => (
              <button
                key={c.id}
                aria-pressed={!query && category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  setQuery("");
                }}
              >
                <strong>{c.label}</strong>
                <small>{c.description}</small>
              </button>
            ))}
          <label className="check-field">
            <input
              type="checkbox"
              checked={writes}
              onChange={(e) => {
                setWrites(e.target.checked);
                if (!e.target.checked && category === "maintenance")
                  setCategory("setup");
              }}
            />
            <span>
              Show write references<small>Destructive operations</small>
            </span>
          </label>
        </nav>
        <div className="reference-cards" aria-live="polite">
          {query && (
            <p className="source-label">
              {items.length} matching commands across all categories
            </p>
          )}
          {items.map((c) => (
            <article
              className="reference-card"
              key={c.id}
              data-effect={c.effect}
            >
              <div className="reference-card-heading">
                <div>
                  <span className="eyebrow">{c.tool}</span>
                  <h3>{c.title}</h3>
                </div>
                <span className="reference-effect">{effects[c.effect]}</span>
              </div>
              <p>{c.description}</p>
              <div className="reference-code">
                <pre>
                  <code>{c.command}</code>
                </pre>
                <button
                  className="button"
                  aria-label={`Copy ${c.title}`}
                  onClick={() =>
                    void copy(c.command)
                      .then(() => {
                        setCopied(c.id);
                        setError(null);
                      })
                      .catch((e) => setError(String(e)))
                  }
                >
                  <Icon name="copy" />
                  {copied === c.id ? "Copied" : "Copy example"}
                </button>
              </div>
              <ModeDetails simple={simple} title="Flags and manual">
                <dl className="reference-flags">
                  {c.flags.map(([flag, explanation]) => (
                    <div key={flag}>
                      <dt>
                        <code>{flag}</code>
                      </dt>
                      <dd>{explanation}</dd>
                    </div>
                  ))}
                </dl>
                <p className="source-label">
                  Manual: <code className="reference-url">{c.source}</code>
                </p>
              </ModeDetails>
              {c.note && (
                <p className="reference-caution">
                  <Icon
                    name={c.effect === "source-write" ? "shield" : "info"}
                  />
                  {c.note}
                </p>
              )}
            </article>
          ))}
          {!items.length && (
            <p>No matching commands. Try a tool name or flag.</p>
          )}
        </div>
      </div>
    </WorkspacePanel>
  );
}
