import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { CommandRecord, DeviceEvent } from "./types";
import { commandLine, terminalText, timestamp, transcript } from "./data";
import { Icon } from "./Icon";
import "@xterm/xterm/css/xterm.css";

export function TerminalPanel({
  records,
  events,
  selected,
  onSelect,
  mode,
  setMode,
  onCopy,
  compact,
  onToggle,
}: {
  records: CommandRecord[];
  events: DeviceEvent[];
  selected: string | null;
  onSelect: (id: string) => void;
  mode: "commands" | "events";
  setMode: (mode: "commands" | "events") => void;
  onCopy: (text: string) => void;
  compact: boolean;
  onToggle: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const record = records.find((item) => item.id === selected) ?? records.at(-1);
  const text =
    mode === "events"
      ? events
          .map((event) => `${timestamp(event.observedAt)}  ${event.line}`)
          .join("\n")
      : record
        ? transcript(record)
        : "No commands have run in this session.\nMetadata queries and their original output will appear here.";

  useEffect(() => {
    if (!container.current) return;
    const instance = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11,
      lineHeight: 1.5,
      scrollback: 100000,
      allowProposedApi: false,
      theme: {
        background: "#0b0e11",
        foreground: "#c0c8cf",
        cursor: "#909aa3",
        selectionBackground: "#303b46",
      },
    });
    const addon = new FitAddon();
    instance.loadAddon(addon);
    instance.open(container.current);
    instance.textarea?.setAttribute("aria-label", "Read-only command output");
    terminal.current = instance;
    fit.current = addon;
    const observer = new ResizeObserver(() => {
      if (container.current?.clientHeight) {
        try {
          addon.fit();
        } catch {
          /* A hidden dock has no measurable viewport. */
        }
      }
    });
    observer.observe(container.current);
    addon.fit();
    return () => {
      observer.disconnect();
      instance.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    instance.reset();
    // The complete text is also retained in records and available through Copy output.
    instance.options.scrollback = Math.max(
      100000,
      text.split("\n").length + 100,
    );
    instance.write(terminalText(text), () => instance.scrollToTop());
  }, [text]);

  return (
    <section
      className={`terminal-dock ${compact ? "is-compact" : ""}`}
      aria-label="Raw command output"
    >
      <div className="terminal-heading">
        <div className="terminal-tabs">
          <button
            className={mode === "commands" ? "active" : ""}
            data-stream="commands"
            aria-pressed={mode === "commands"}
            onClick={() => setMode("commands")}
          >
            <Icon name="terminal" />
            Command output<span>{records.length}</span>
          </button>
          <button
            className={mode === "events" ? "active" : ""}
            data-stream="events"
            aria-pressed={mode === "events"}
            onClick={() => setMode("events")}
          >
            <Icon name="chart" />
            Connection events<span>{events.length}</span>
          </button>
        </div>
        <div className="terminal-actions">
          <span className="text-mono muted">OUTPUT ONLY</span>
          <button
            onClick={() => onCopy(text)}
            title="Copy complete output"
            aria-label="Copy complete output"
          >
            <Icon name="copy" />
          </button>
          <button
            onClick={onToggle}
            title={
              compact ? "Expand command output" : "Collapse command output"
            }
            aria-label={
              compact ? "Expand command output" : "Collapse command output"
            }
          >
            <Icon name="chevronDown" className={compact ? "rotate" : ""} />
          </button>
        </div>
      </div>
      <div className="terminal-body">
        <aside className="command-history">
          {mode === "commands" ? (
            records.map((item) => (
              <button
                key={item.id}
                className={record?.id === item.id ? "active" : ""}
                onClick={() => onSelect(item.id)}
              >
                <span className="command-title">
                  {item.program.split("/").at(-1)}{" "}
                  {item.arguments.slice(0, 3).join(" ")}
                </span>
                <span>
                  {timestamp(item.startedAt)}{" "}
                  <span
                    className="history-exit"
                    data-nonzero={item.exitCode !== null && item.exitCode !== 0}
                  >
                    exit {item.exitCode ?? "—"}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="event-origin">
              <span className="eyebrow">EVENT SOURCE</span>
              <code>/usr/sbin/diskutil activity</code>
              <p>Original Disk Arbitration event text. No sector scans.</p>
            </div>
          )}
        </aside>
        <div className="terminal-viewport" ref={container} />
      </div>
      <div className="terminal-footer">
        <span title={record ? commandLine(record) : ""}>
          {mode === "commands" && record
            ? commandLine(record)
            : mode === "events"
              ? "/usr/sbin/diskutil activity"
              : "Session transcript"}
        </span>
        <span>
          {mode === "commands" && record
            ? `${record.durationMs} ms · ${record.stdoutArtifact ? "Stdout retained in file" : record.stdoutUtf8Valid && record.stderrUtf8Valid ? "UTF-8" : "Bytes retained as base64"}`
            : "Local session"}
        </span>
      </div>
    </section>
  );
}
