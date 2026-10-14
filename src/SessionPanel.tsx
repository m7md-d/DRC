import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
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
}: {
  current: string | null;
  originalImport: string | null;
  archived: boolean;
  disabled: boolean;
  close: () => void;
  view: (id: string) => Promise<void>;
  fresh: () => Promise<void>;
  live: () => Promise<void>;
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
    <Modal
      title="Sessions"
      subtitle="LOCAL RECORDS / ORIGINAL OUTPUT"
      close={close}
    >
      <p className="panel-description">
        Readings and connection events are saved automatically. Previous
        sessions open as historical records; live device queries remain
        separate.
      </p>
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
          Import JSON
        </button>
        <button
          className="button"
          disabled={!current || working || disabled}
          onClick={() =>
            void perform(async () => {
              const path = await bridge.pick("exportSession");
              if (!path || !current) return;
              await bridge.exportSession(current, path);
              setNotice(`Complete session saved to ${path}`);
            })
          }
        >
          <Icon name="copy" />
          Export complete JSON
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
      <details className="paste-session">
        <summary>Import pasted session JSON</summary>
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
      </details>
      {originalImport && (
        <details className="paste-session">
          <summary>Original imported JSON · unchanged source document</summary>
          <pre className="raw-map" tabIndex={0}>
            {originalImport}
          </pre>
        </details>
      )}
      <div className="saved-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`saved-row ${current === session.id ? "active" : ""}`}
            disabled={working || disabled}
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
    </Modal>
  );
}
