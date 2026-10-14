import { Plot } from "./Plot";
import { commandLine, timestamp } from "./data";
import type { CommandRecord } from "./types";

export function CommandTiming({
  records,
  onSelect,
}: {
  records: CommandRecord[];
  onSelect: (id: string) => void;
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
      <details className="measurement-source">
        <summary>Every command duration · {records.length} records</summary>
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
      </details>
    </>
  );
}
