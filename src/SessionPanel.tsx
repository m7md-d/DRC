import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { WorkspacePanel } from "./WorkspacePanel";
import { Icon } from "./Icon";
import { ModeDetails } from "./ModeDetails";
import type { SessionSummary } from "./types";

export function SessionPanel({
  current,
  originalImport,
  archived,
  disabled,
  close,
  view,
  fresh,
  live,
  simple = false,
}: {
  current: string | null;
  originalImport: string | null;
  archived: boolean;
  disabled: boolean;
  close: () => void;
  view: (id: string) => Promise<void>;
  fresh: () => Promise<void>;
  live: () => Promise<void>;
  simple?: boolean;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const refresh = () => bridge.sessions().then(setSessions);
  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);
  async function perform(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <WorkspacePanel
      title={simple ? "Saved sessions" : "Sessions"}
      subtitle="Saved observations and original command output."
      close={close}
      className={simple ? "simple-sessions" : ""}
    >
      <p className="panel-description">
        Readings and connection events are saved automatically. Previous
        sessions open as read-only records.
      </p>
      {simple && (
        <dl className="reading-summary">
          <div>
            <dt>Current view</dt>
            <dd>{archived ? "Saved session" : "Live session"}</dd>
          </div>
          <div>
            <dt>Saved sessions</dt>
            <dd>{sessions.length}</dd>
          </div>
          <div>
            <dt>Current commands</dt>
            <dd>
              {sessions.find((s) => s.id === current)?.recordCount ??
                "Not listed"}
            </dd>
          </div>
        </dl>
      )}
      <div className="panel-actions">
        <button
          className="button"
          disabled={working || disabled}
          onClick={() =>
            void perform(async () => {
              const path = await bridge.pick("importSession");
              if (!path) return;
              const id = await bridge.importSession(path);
              await view(id);
              setNotice(
                "Imported as a historical session. Source policies were not changed.",
              );
            })
          }
        >
          <Icon name="file" />
          {simple ? "Open session file…" : "Import JSON"}
        </button>
        <button
          className="button"
          disabled={!current || working || disabled}
          onClick={() =>
            void perform(async () => {
              const path = await bridge.pick("exportSession");
              if (!path || !current) return;
              await bridge.exportSession(current, path);
              setNotice(`Session saved to ${path}`);
            })
          }
        >
          <Icon name="copy" />
          {simple ? "Save session file…" : "Export session JSON"}
        </button>
        <button
          className="button"
          disabled={working || disabled}
          onClick={() => void perform(fresh)}
        >
          <Icon name="grid" />
          New session
        </button>
        {archived && (
          <button
            className="button primary"
            disabled={working || disabled}
            onClick={() => void perform(live)}
          >
            <Icon name="refresh" />
            Return to live session
          </button>
        )}
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="inline-note" role="status">
          {notice}
        </div>
      )}
      <ModeDetails simple={simple} title="Import pasted session JSON">
        <label className="form-field">
          Complete session JSON
          <textarea
            aria-label="Session JSON to import"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste a DRC session export here"
          />
        </label>
        <button
          className="button"
          disabled={!pasted || working || disabled}
          onClick={() =>
            void perform(async () => {
              const id = await bridge.importSessionJson(pasted);
              await view(id);
              setPasted("");
              setNotice("Imported the complete JSON as a historical session.");
            })
          }
        >
          Import pasted JSON
        </button>
      </ModeDetails>
      {originalImport && (
        <details className="paste-session">
          <summary>Original imported JSON · unchanged source document</summary>
          <pre className="raw-map" tabIndex={0}>
            {originalImport}
          </pre>
        </details>
      )}
      <h3 className="saved-sessions-heading">Saved sessions</h3>
      <div className="saved-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`saved-row ${current === session.id ? "active" : ""}`}
            disabled={working || disabled}
            data-hint={`Open the saved observations and command output. Session ${session.id}.`}
            onClick={() => void perform(() => view(session.id))}
          >
            <span>
              <strong>
                {new Date(session.createdAt).toLocaleString("en-GB")}
              </strong>
              <code>{session.id}</code>
            </span>
            <span>
              {session.recordCount} commands
              <small>
                Updated {new Date(session.updatedAt).toLocaleString("en-GB")}
              </small>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
      {!sessions.length && (
        <p className="panel-description">No saved sessions are listed.</p>
      )}
    </WorkspacePanel>
  );
}
