import { useEffect, useRef, useState } from "react";
import { bridge, native } from "./bridge";
import { FieldTable } from "./FieldTable";
import { ArtifactPreview } from "./ArtifactPreview";
import { ByteValue } from "./ByteValue";
import { commandLine, timestamp } from "./data";
import type { ExtractionJob, ExtractionPlan, Json } from "./types";

export function ExtractionPanel({
  reportId,
  indices,
  jobs,
  disabled,
  onJob,
  clearSelection,
}: {
  reportId: string | null;
  indices: number[];
  jobs: ExtractionJob[];
  disabled: boolean;
  onJob: (job: ExtractionJob) => void;
  clearSelection: () => void;
}) {
  const [destination, setDestination] = useState("");
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (ticket.current) void bridge.cancelExtraction(ticket.current);
    },
    [],
  );
  const cancel = () => {
    if (ticket.current) void bridge.cancelExtraction(ticket.current);
    ticket.current = null;
    setPlan(null);
    setConfirmation("");
  };
  async function action(fn: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  const blocked = disabled || working;
  return (
    <div className="extraction-panel">
      <div className="section-heading">
        <h3>Extract selected file entries</h3>
        <span className="small-tag">SOURCE READ ONLY</span>
      </div>
      <p className="source-label">
        {indices.length} selected entries · no folder recursion. Every output is
        a separate original content-reader stdout stream. Deleted entries use
        the reader's recorded metadata address.
      </p>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {!plan ? (
        <>
          <label className="form-field">
            Destination folder
            <input
              value={destination}
              disabled={blocked}
              placeholder="Choose an existing folder"
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <div className="panel-actions">
            <button
              className="button"
              disabled={blocked || !native}
              onClick={() =>
                void action(async () => {
                  const picked = await bridge.pick("destination");
                  if (picked) setDestination(picked);
                })
              }
            >
              Choose destination
            </button>
            <button
              className="button primary"
              disabled={blocked || !reportId || !indices.length || !destination}
              onClick={() =>
                void action(async () => {
                  const result = await bridge.prepareExtraction(
                    reportId!,
                    indices,
                    destination,
                  );
                  ticket.current = result.ticket;
                  setPlan(result);
                })
              }
            >
              Review extraction
            </button>
          </div>
        </>
      ) : (
        <section className="extraction-review">
          <h4>Review source and destination</h4>
          <code className="artifact-path">{plan.source.path}</code>
          <p className="source-label">
            Offset {plan.request.geometry.offsetSectors} sectors · sector size{" "}
            {plan.request.geometry.sectorSize} bytes · reader{" "}
            {plan.request.geometry.filesystem ?? "auto"}
          </p>
          <code className="artifact-path">
            {plan.destination}/DRC-extraction-…
          </code>
          <p className="source-label">
            Available <ByteValue value={plan.freeBytes}/>. A
            new private folder is created. Each output is capped at the entry's
            reported size; an attempt exceeding that limit is retained as
            partial. Each reader has a one-hour process limit. A stop request
            escalates after five seconds if the process has not exited.
          </p>
          <div className="table-scroll">
            <table className="image-table">
              <thead>
                <tr>
                  <th>SOURCE ENTRY / ADDRESS</th>
                  <th>OUTPUT FILENAME</th>
                  <th>MAXIMUM · BYTES</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((item, i) => (
                  <tr key={i}>
                    <td>
                      {item.entry.name}
                      <br />
                      <code>{item.entry.inode}</code>
                    </td>
                    <td>{item.filename}</td>
                    <td>{item.maximumBytes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="measurement-source">
            <summary>Every reviewed field</summary>
            <FieldTable
              title="Extraction plan"
              source="Pinned descriptors, explicit geometry and original entries"
              value={plan as unknown as Json}
            />
          </details>
          <label className="form-field">
            Type {plan.confirmation} to confirm this source
            <input
              value={confirmation}
              disabled={blocked}
              autoComplete="off"
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <div className="panel-actions">
            <button className="button" disabled={working} onClick={cancel}>
              Cancel review
            </button>
            <button
              className="button primary"
              disabled={blocked || confirmation !== plan.confirmation}
              onClick={() =>
                void action(async () => {
                  const job = await bridge.startExtraction(
                    plan.ticket,
                    confirmation,
                  );
                  ticket.current = null;
                  setPlan(null);
                  setConfirmation("");
                  clearSelection();
                  onJob(job);
                })
              }
            >
              Start extraction
            </button>
          </div>
        </section>
      )}
      <div className="section-heading saved-extractions-heading">
        <h3>Saved extractions</h3>
        <span className="count-tag">{jobs.length}</span>
      </div>
      {!jobs.length && (
        <p className="source-label">
          Extraction records and retained output streams appear here.
        </p>
      )}
      {jobs.map((job) => (
        <details
          key={job.id}
          className="extraction-job"
          open={jobs[0]?.id === job.id}
        >
          <summary>
            <span>
              {job.state} · {job.items.length} entries
            </span>
            <span>{timestamp(job.createdAt)}</span>
          </summary>
          <code className="artifact-path">{job.directory}</code>
          <p className="source-label">
            {job.message ?? `Source: ${job.source.path}`}
          </p>
          {["running", "stopping"].includes(job.state) && (
            <button
              className="button"
              disabled={working || job.state === "stopping"}
              onClick={() => void action(() => bridge.stopExtraction(job.id))}
            >
              Stop extraction
            </button>
          )}
          {job.items.map((item, i) => (
            <details className="extraction-item" key={i}>
              <summary>
                <span>{item.filename}</span>
                <span>
                  {item.state} · <ByteValue value={item.writtenBytes}/> / <ByteValue value={item.maximumBytes}/>
                </span>
              </summary>
              <FieldTable
                title="Original entry and output"
                source="Reader metadata, exact byte counts and process status"
                value={
                  {
                    entry: item.entry,
                    filename: item.filename,
                    maximumBytes: item.maximumBytes,
                    writtenBytes: item.writtenBytes,
                    state: item.state,
                  } as unknown as Json
                }
              />
              {item.record && (
                <>
                  <code className="artifact-path">
                    {commandLine(item.record)}
                  </code>
                  <p className="source-label">
                    Exit {item.record.exitCode ?? "none"} · signal{" "}
                    {item.record.terminationSignal ?? "none"} ·{" "}
                    {item.record.durationMs} ms · timeout{" "}
                    {String(item.record.timedOut)}
                  </p>
                  {item.record.launchError && (
                    <div className="error-box">{item.record.launchError}</div>
                  )}
                  {item.record.stdoutArtifact && (
                    <>
                      <FieldTable
                        title="Complete original stdout artifact"
                        source="Stored output stream and SHA-256 of destination bytes"
                        value={item.record.stdoutArtifact as unknown as Json}
                      />
                      <ArtifactPreview
                        id={job.id}
                        index={i}
                        disabled={disabled}
                      />
                    </>
                  )}
                  <details className="measurement-source">
                    <summary>Original stderr and record</summary>
                    <pre className="image-tool-output">
                      {item.record.stderr || "No stderr returned."}
                    </pre>
                    <FieldTable
                      title="Every command-record field"
                      source="Original stderr bytes are retained as base64"
                      value={item.record as unknown as Json}
                    />
                  </details>
                </>
              )}
            </details>
          ))}
          <details className="measurement-source">
            <summary>Every extraction field</summary>
            <FieldTable
              title="Extraction record"
              source="Source identity, query, destination and all entry results"
              value={job as unknown as Json}
            />
          </details>
        </details>
      ))}
    </div>
  );
}
