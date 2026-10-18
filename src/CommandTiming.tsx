import { Plot } from "./Plot";
import { commandLine, timestamp } from "./data";
import type { CommandRecord } from "./types";
import { ModeDetails } from "./ModeDetails";

export function CommandTiming({
  records,
  onSelect,
  simple = false,
}: {
  records: CommandRecord[];
  onSelect: (id: string) => void;
  simple?: boolean;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Session command timing</h3>
          <p className="source-label">
            All commands in this session · original records retained
          </p>
        </div>
        <span className="count-tag">{records.length} commands</span>
      </div>
      <p className="panel-description">
        Elapsed wall time includes tool startup, OS work and command execution.
        These are command durations; they do not measure sector latency or
        device throughput. Running commands show elapsed time so far.
      </p>
      {simple && (
        <>
          <dl className="reading-summary">
            <div>
              <dt>Commands</dt>
              <dd>{records.length}</dd>
            </div>
            <div>
              <dt>Exit 0</dt>
              <dd>{records.filter((r) => r.exitCode === 0).length}</dd>
            </div>
            <div>
              <dt>Nonzero exit</dt>
              <dd>
                {
                  records.filter((r) => r.exitCode !== null && r.exitCode !== 0)
                    .length
                }
              </dd>
            </div>
            <div>
              <dt>Last recorded start</dt>
              <dd>
                {records.length
                  ? timestamp(records.at(-1)!.startedAt)
                  : "No commands"}
              </dd>
            </div>
          </dl>
          <div className="recent-command-list" aria-label="Recent commands">
            {records
              .slice(-5)
              .reverse()
              .map((record) => (
                <button
                  key={record.id}
                  onClick={() => onSelect(record.id)}
                  data-hint={commandLine(record)}
                >
                  <strong>{record.program.split("/").at(-1)}</strong>
                  <span>{timestamp(record.startedAt)}</span>
                  <span>{record.durationMs} ms</span>
                  <span>Exit {record.exitCode ?? "not recorded"}</span>
                </button>
              ))}
          </div>
        </>
      )}
      <Plot
        title="Command elapsed time"
        description="DRC process timer · milliseconds"
        xLabel="Command order in this session"
        xFormat={(n) => `#${n}`}
        markersOnly
        unit="ms"
        series={[{ label: "Elapsed time", color: "var(--selection)" }]}
        points={records.map((r, i) => ({
          x: String(i + 1),
          values: [String(r.durationMs)],
          label: `#${i + 1} · ${timestamp(r.startedAt)} · ${r.program.split("/").at(-1)}`,
        }))}
        onSelect={(i) => onSelect(records[i].id)}
      />
      <ModeDetails
        simple={simple}
        title={`Command durations · ${records.length} records`}
      >
        <div className="table-scroll">
          <table className="timing-table">
            <thead>
              <tr>
                <th># / START</th>
                <th>ORIGINAL COMMAND</th>
                <th>ELAPSED · MS</th>
                <th>EXIT</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    {i + 1} / {timestamp(r.startedAt)}
                  </td>
                  <td>
                    <button onClick={() => onSelect(r.id)}>
                      {commandLine(r)}
                    </button>
                  </td>
                  <td>{r.durationMs}</td>
                  <td>{r.exitCode ?? "not available"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ModeDetails>
    </>
  );
}
