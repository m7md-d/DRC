import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  CommandRecord,
  Device,
  DeviceEvent,
  Discovery,
  QueryResult,
  Tab,
  ToolReport,
  SessionData,
  AcquisitionJob,
  Json,
  ExtractionJob,
} from "./types";
import { bridge, native, subscribe } from "./bridge";
import {
  commandLine,
  displayValue,
  flatten,
  getField,
  humanBytes,
  smartStatus,
  timestamp,
} from "./data";
import { FieldTable } from "./FieldTable";
import { TerminalPanel } from "./TerminalPanel";
import { Icon, type IconName } from "./Icon";
import { SessionPanel } from "./SessionPanel";
import { AcquisitionPanel } from "./AcquisitionPanel";
import { CommandTiming } from "./CommandTiming";
import { PartitionChart } from "./PartitionChart";
import { ImagePanel } from "./ImagePanel";
import { EasyWorkspace } from "./EasyWorkspace";
import { CheatSheet } from "./CheatSheet";
import { HostEvidence } from "./HostEvidence";
import { Modal } from "./Modal";

const tabs: { key: Tab; label: string; icon: IconName }[] = [
  { key: "device", label: "Device", icon: "drive" },
  { key: "partitions", label: "Partitions", icon: "partitions" },
  { key: "smart", label: "SMART / NVMe", icon: "chart" },
  { key: "connection", label: "Connection", icon: "link" },
  { key: "activity", label: "Activity", icon: "chart" },
  { key: "tools", label: "Tools", icon: "tools" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="fact">
      <span className="eyebrow">{label}</span>
      <strong title={value}>{value}</strong>
      {detail && (
        <span className="fact-detail" title={detail}>
          {detail}
        </span>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Partitions({ device }: { device: Device }) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Partition layout</h3>
          <p className="source-label">
            {getField(device.info,"kname") ? "lsblk --json --bytes" : "diskutil list -plist physical"} · {device.id}
          </p>
        </div>
        <span className="count-tag">{device.partitions.length} entries</span>
      </div>
      {device.partitions.length ? (
        <>
          <PartitionChart device={device} />
          <div className="table-scroll">
            <table className="partition-table">
              <thead>
                <tr>
                  <th>DEVICE</th>
                  <th>CONTENT</th>
                  <th>VOLUME NAME</th>
                  <th>SIZE · EXACT BYTES</th>
                  <th>MOUNT POINT</th>
                </tr>
              </thead>
              <tbody>
                {device.partitions.map((partition, index) => (
                  <tr key={index}>
                    <td>
                      {displayValue(getField(partition, "DeviceIdentifier") ?? getField(partition, "kname"))}
                    </td>
                    <td>{displayValue(getField(partition, "Content") ?? getField(partition, "fstype"))}</td>
                    <td>{displayValue(getField(partition, "VolumeName") ?? getField(partition, "label"))}</td>
                    <td>{displayValue(getField(partition, "Size") ?? getField(partition, "size"))}</td>
                    <td>{displayValue(getField(partition, "MountPoint") ?? getField(partition, "mountpoints"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="inline-note">
          <Icon name="info" />
          No partition entries were returned in this snapshot. The full layout
          remains available below.
        </div>
      )}
      <FieldTable
        value={device.layout}
        source="Original partition-layout fields · numeric values retained as exact strings"
        title="Complete layout fields"
      />
    </>
  );
}

function SmartView({
  device,
  result,
  busy,
  run,
}: {
  device: Device;
  result?: QueryResult;
  busy: boolean;
  run: () => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>SMART / NVMe information</h3>
          <p className="source-label">
            Device-reported fields · no DRC health score
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy || !native || device.metadataOnly}
          onClick={run}
        >
          <Icon name="refresh" />
          Read information
        </button>
      </div>
      {device.metadataOnly && (
        <div className="inline-note">
          <Icon name="shield" />
          {device.protectionReason}
        </div>
      )}
      <div className="command-preview">
        <span className="eyebrow">QUERY</span>
        <code>smartctl -a -j /dev/{device.id}</code>
        <span className="small-tag">NO SELF-TEST</span>
      </div>
      {result ? (
        <>
          <div className="report-status">
            <span className="eyebrow">
              SMARTCTL EXIT STATUS · {result.record.exitCode ?? "none"}
            </span>
            {smartStatus(result.record.exitCode).map((flag) => (
              <span className="reported-flag" key={flag}>
                {flag}
              </span>
            ))}
            <p>
              These are smartctl exit flags. The complete reported data is
              retained independently of the exit status.
            </p>
          </div>
          {result.record.launchError && (
            <div className="error-box">{result.record.launchError}</div>
          )}
          {result.record.stderr && (
            <div className="tool-message">
              <span className="eyebrow">STDERR · REPORTED BY SMARTCTL</span>
              <pre>{result.record.stderr}</pre>
            </div>
          )}
          {result.parseError && (
            <div className="inline-note">
              <Icon name="info" />
              JSON could not be parsed: {result.parseError}. Original output is
              retained in Command output.
            </div>
          )}
          {result.fields !== null && (
            <FieldTable
              value={result.fields}
              source={`${commandLine(result.record)} · ${timestamp(result.record.startedAt)}`}
              title="Complete SMART / NVMe fields"
            />
          )}
        </>
      ) : (
        <EmptyState icon="chart" title="No SMART query has run">
          Read information to collect the fields available through this device
          and connection. Unsupported commands and permission errors remain
          visible in the original output.
        </EmptyState>
      )}
    </>
  );
}

function ConnectionView({
  result,
  busy,
  run,
  platform = "macOS",
}: {
  platform?: string;
  result: QueryResult | null;
  busy: boolean;
  run: () => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Host connection report</h3>
          <p className="source-label">USB / Thunderbolt · host-reported properties</p>
        </div>
        <button
          className="button primary"
          disabled={busy || !native}
          onClick={run}
        >
          <Icon name="refresh" />
          Collect report
        </button>
      </div>
      <div className="connection-facts">
        <Fact
          label="DATA SOURCE"
          value={platform === "Linux" ? "sysfs / lsusb" : "System Profiler"}
          detail="USB / Thunderbolt registry information"
        />
        <Fact
          label="CURRENT MEASUREMENT"
          value="Unavailable"
          detail="Telemetry adapter not implemented"
        />
        <Fact
          label="DEVICE MAPPING"
          value="Host-wide report"
          detail="No automatic association with selected media"
        />
      </div>
      <div className="inline-note">
        <Icon name="info" />
        Reported USB current requirements are declared metadata, not a
        measurement of current draw.
      </div>
      {result ? (
        <>
          {result.parseError && (
            <div className="error-box">
              Report parsing failed: {result.parseError}. Original output is in
              the transcript.
            </div>
          )}
          {result.fields !== null && (
            <FieldTable
              value={result.fields}
              source={`${commandLine(result.record)} · ${timestamp(result.record.startedAt)}`}
              title="Complete connection fields"
            />
          )}
        </>
      ) : (
        <EmptyState icon="link" title="Connection report not collected">
          Collect available host connection properties. No device reset or sector scan is performed.
        </EmptyState>
      )}
    </>
  );
}

function ToolsView({
  tools,
  busy,
  refresh,
  smart,
  connection,
  acquisition,
  images,
}: {
  tools: ToolReport[];
  busy: boolean;
  refresh: () => void;
  smart: () => void;
  connection: () => void;
  acquisition: () => void;
  images: () => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Tool inventory</h3>
          <p className="source-label">
            Installed tools and implemented adapters are shown separately
          </p>
        </div>
        <span className="count-tag">
          {tools.filter((tool) => tool.available).length} located
        </span>
      </div>
      <div className="tool-list">
        {tools.map((tool) => (
          <article className="tool-row" key={tool.key}>
            <div className="tool-icon">
              <Icon
                name={tool.key === "ddrescue" ? "file" : "tools"}
                size={19}
              />
            </div>
            <div className="tool-description">
              <h4>
                {tool.name}
                <span
                  className={`small-tag ${tool.available ? "" : "muted"}`}
                  data-available={tool.available}
                >
                  {tool.available ? "LOCATED" : "NOT LOCATED"}
                </span>
              </h4>
              <p>{tool.purpose}</p>
              <code>
                {tool.path ?? "No executable at the configured locations"}
              </code>
            </div>
            <div className="tool-action">
              {tool.implemented ? (
                <button
                  className="button"
                  disabled={busy || !tool.available}
                  onClick={
                    tool.key === "ddrescue"
                      ? acquisition
                      : tool.key === "drc-tsk"
                        ? images
                        : tool.key === "smartctl"
                          ? smart
                          : tool.key === "system_profiler"
                            ? connection
                            : refresh
                  }
                >
                  Open
                  <Icon name="arrow" size={14} />
                </button>
              ) : (
                <span className="muted text-mono">Adapter pending</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="scope-note">
        <Icon name="shield" size={20} />
        <div>
          <h4>Source read only · new image destinations</h4>
          <p>
            Raw acquisition uses GNU ddrescue with saved maps and reviewed
            resume. The image workspace browses and extracts file entries
            without mounting the source. Filesystem capabilities depend on the
            selected reader; repair, formatting and sector writes remain
            pending.
          </p>
        </div>
      </div>
    </>
  );
}

export function App() {
  const [experience, setExperience] = useState<"easy" | "professional">(() => localStorage.getItem("drc.experience") === "professional" ? "professional" : "easy");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const closeEvidence = useCallback(() => setEvidenceOpen(false), []);
  const [hostEvidence, setHostEvidence] = useState<Json[]>([]);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const closeReference = useCallback(() => setReferenceOpen(false), []);
  const [easyReading, setEasyReading] = useState<"smart" | "connection" | null>(null);
  const closeEasyReading = useCallback(() => setEasyReading(null), []);
  const changeExperience = (value: "easy" | "professional") => { setExperience(value); localStorage.setItem("drc.experience", value); };
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [originalImport, setOriginalImport] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const archivedRef = useRef(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [acquisitionOpen, setAcquisitionOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageReports, setImageReports] = useState<Json[]>([]);
  const [extractions, setExtractions] = useState<ExtractionJob[]>([]);
  const extractingRef = useRef(false);
  const extractionRef = useRef<ExtractionJob[]>([]);
  const closeImages = useCallback(() => setImageOpen(false), []);
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const jobsRef = useRef<AcquisitionJob[]>([]);
  const acquiringRef = useRef(false);
  const [snapshot, setSnapshot] = useState<Discovery | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("device");
  const [records, setRecords] = useState<CommandRecord[]>([]);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [tools, setTools] = useState<ToolReport[]>([]);
  const [smart, setSmart] = useState<Record<string, QueryResult>>({});
  const [connection, setConnection] = useState<QueryResult | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  const [terminalMode, setTerminalMode] = useState<"commands" | "events">(
    "commands",
  );
  const [terminalCompact, setTerminalCompact] = useState(experience === "easy");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const policyDialog = useRef<HTMLElement>(null);
  const inventoryRef = useRef<Discovery | null>(null);
  const selectionRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const pendingRefresh = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const eventRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watcherRef = useRef(false);
  const device = snapshot?.devices.find((item) => item.id === selection);

  const updateJob = useCallback((incoming: AcquisitionJob) => {
    const previous = jobsRef.current.find((job) => job.id === incoming.id);
    const stale =
      previous &&
      (previous.attempts > incoming.attempts ||
        (previous.attempts === incoming.attempts &&
          (previous.updatedAt > incoming.updatedAt ||
            (!["running", "pausing"].includes(previous.state) &&
              ["running", "pausing"].includes(incoming.state)))));
    const job = stale ? previous : incoming;
    jobsRef.current = [
      job,
      ...jobsRef.current.filter((item) => item.id !== job.id),
    ];
    setJobs(jobsRef.current);
    const running = jobsRef.current.find((item) =>
      ["running", "pausing"].includes(item.state),
    );
    acquiringRef.current = !!running;
    if (running)
      setBusy(
        `${running.state === "pausing" ? "Saving acquisition" : "Acquiring"} · ${running.id}`,
      );
    else if (!busyRef.current && !extractingRef.current) {
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }, []);

  const updateExtraction = useCallback((incoming: ExtractionJob) => {
    const previous = extractionRef.current.find((j) => j.id === incoming.id);
    const stale =
      previous &&
      (previous.updatedAt > incoming.updatedAt ||
        (!["running", "stopping"].includes(previous.state) &&
          ["running", "stopping"].includes(incoming.state)));
    const job = stale ? previous : incoming;
    extractionRef.current = [
      job,
      ...extractionRef.current.filter((j) => j.id !== job.id),
    ];
    setExtractions(extractionRef.current);
    const running = extractionRef.current.find((j) =>
      ["running", "stopping"].includes(j.state),
    );
    extractingRef.current = !!running;
    if (running)
      setBusy(
        `${running.state === "stopping" ? "Saving file extraction" : "Extracting files"} · ${running.id}`,
      );
    else if (!busyRef.current && !acquiringRef.current) {
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!native) return;
    if (archivedRef.current || acquiringRef.current || extractingRef.current)
      return;
    if (busyRef.current) {
      pendingRefresh.current = true;
      return;
    }
    pendingRefresh.current = false;
    busyRef.current = true;
    setBusy("Reading device metadata");
    setError(null);
    try {
      const next = await bridge.discover();
      const previous = inventoryRef.current?.devices.find(
        (item) => item.id === selectionRef.current,
      );
      const replacement = next.devices.find(
        (item) =>
          item.id === previous?.id && item.identityKey === previous.identityKey,
      );
      const chosen = previous
        ? (replacement?.id ?? null)
        : inventoryRef.current
          ? null
          : ((
              next.devices.find((item) => item.internal === false) ??
              next.devices[0]
            )?.id ?? null);
      setSnapshot(next);
      inventoryRef.current = next;
      selectionRef.current = chosen;
      setSelection(chosen);
      if (previous && !replacement)
        setNotice(
          "The selected device disappeared or its reported descriptor changed. Select a device from the current snapshot.",
        );
    } catch (error) {
      setError(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    async function start() {
      try {
        if (native) {
          const saved = await bridge.currentSession();
          if (!active) return;
          setSessionId(saved.id);
          setOriginalImport(saved.originalImport);
          setImageReports(saved.imageReports ?? []);
          setHostEvidence(saved.hostEvidence ?? []);
          setRecords(saved.commandRecords);
          setEvents(saved.connectionEvents);
          setSmart(saved.smartReports);
          setConnection(saved.connectionReport);
          setSelectedRecord(saved.commandRecords.at(-1)?.id ?? null);
          jobsRef.current = await bridge.acquisitions();
          setJobs(jobsRef.current);
          extractionRef.current = await bridge.extractions();
          setExtractions(extractionRef.current);
        }
        const stop = await subscribe({
          command: (record) => {
            if (!active) return;
            if (!archivedRef.current) {
              setRecords((items) =>
                items.some((item) => item.id === record.id)
                  ? items.map((item) => (item.id === record.id ? record : item))
                  : [...items, record],
              );
              setSelectedRecord(record.id);
            }
          },
          device: (event) => {
            if (!active) return;
            if (!archivedRef.current) setEvents((items) => [...items, event]);
            if (eventRefresh.current) clearTimeout(eventRefresh.current);
            eventRefresh.current = setTimeout(() => {
              if (active && watcherRef.current) void refresh();
            }, 800);
          },
          watchError: (message) => {
            if (active) setError(`Connection watcher: ${message}`);
          },
          watchStopped: () => {
            if (active) {
              setWatching(false);
              watcherRef.current = false;
            }
          },
          persistenceError: (message) => {
            if (active) {
              setSaveError(message);
              setError(`Local save failed: ${message}`);
            }
          },
          exitDeferred: (message) => {
            if (active) setNotice(message);
          },
          extraction: (job) => {
            if (active) updateExtraction(job);
          },
          acquisition: (job) => {
            if (!active) return;
            updateJob(job);
          },
        });
        if (!active) {
          stop();
          return;
        }
        unsubscribe = stop;
        if (!native) return;
        setTools(await bridge.tools());
        await refresh();
        if (!active) return;
        await bridge.startWatch();
        watcherRef.current = true;
        setWatching(true);
      } catch (error) {
        if (active) setError(errorText(error));
      }
    }
    void start();
    return () => {
      active = false;
      unsubscribe?.();
      if (eventRefresh.current) clearTimeout(eventRefresh.current);
      if (native) void bridge.stopWatch();
    };
  }, [refresh, updateJob]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!policyOpen) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = policyDialog.current;
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPolicyOpen(false);
      }
      if (event.key === "Tab") {
        const targets = controls();
        if (event.shiftKey && document.activeElement === targets[0]) {
          event.preventDefault();
          targets.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === targets.at(-1)
        ) {
          event.preventDefault();
          targets[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [policyOpen]);

  async function runSmart() {
    if (
      !device ||
      device.metadataOnly ||
      busyRef.current ||
      acquiringRef.current ||
      archivedRef.current
    )
      return;
    const target = device;
    busyRef.current = true;
    setBusy(`Reading SMART · ${target.id}`);
    setError(null);
    try {
      const result = await bridge.smart(target.token);
      setSmart((items) => ({ ...items, [target.identityKey]: result }));
    } catch (error) {
      setError(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }

  async function collectHostEvidence(kind: "topology" | "kernel"): Promise<QueryResult> {
    if (archivedRef.current) throw new Error("Return to the live session before collecting evidence.");
    const activeData = acquiringRef.current || extractingRef.current;
    if (kind === "kernel") return bridge.hostEvidence(kind);
    if (busyRef.current || activeData) throw new Error("Wait for the active operation before collecting topology.");
    busyRef.current = true; setBusy("Collecting host evidence");
    try { return await bridge.hostEvidence(kind); } finally { busyRef.current=false; setBusy(null); if(pendingRefresh.current) void refreshRef.current(); }
  }

  async function runConnection() {
    if (busyRef.current || acquiringRef.current || archivedRef.current) return;
    busyRef.current = true;
    setBusy("Collecting host connection report");
    setError(null);
    try {
      setConnection(await bridge.connections());
    } catch (error) {
      setError(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }

  async function toggleWatch() {
    try {
      if (watching) {
        watcherRef.current = false;
        await bridge.stopWatch();
        setWatching(false);
      } else {
        await bridge.startWatch();
        watcherRef.current = true;
        setWatching(true);
      }
    } catch (error) {
      setError(errorText(error));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied complete data to clipboard.");
    } catch (error) {
      setError(`Clipboard: ${errorText(error)}`);
    }
  }

  function copySession() {
    void copy(
      JSON.stringify(
        {
          schemaVersion: "0.2",
          exportedAt: new Date().toISOString(),
          applicationPolicy: "source-read-only",
          id: sessionId,
          originalImport,
          imageReports,
          hostEvidence,
          snapshot,
          smartReports: smart,
          connectionReport: connection,
          commandRecords: records,
          connectionEvents: events,
        },
        null,
        2,
      ),
    );
  }

  function applySaved(saved: SessionData, historical: boolean) {
    archivedRef.current = historical;
    setArchived(historical);
    setSessionId(saved.id);
    setOriginalImport(saved.originalImport);
    setImageReports(saved.imageReports ?? []);
          setHostEvidence(saved.hostEvidence ?? []);
    setSnapshot(saved.snapshot);
    setRecords(saved.commandRecords);
    setEvents(saved.connectionEvents);
    setSmart(saved.smartReports);
    setConnection(saved.connectionReport);
    setSelectedRecord(saved.commandRecords.at(-1)?.id ?? null);
    setSelection(saved.snapshot?.devices[0]?.id ?? null);
    setTab("device");
  }
  async function viewSession(id: string) {
    if (acquiringRef.current || busyRef.current)
      throw new Error(
        "Wait for the current operation to stop before opening another session.",
      );
    applySaved(await bridge.loadSession(id), true);
  }
  async function liveSession() {
    applySaved(await bridge.currentSession(), false);
    inventoryRef.current = null;
    selectionRef.current = null;
    await refresh();
  }
  async function freshSession() {
    if (acquiringRef.current || busyRef.current)
      throw new Error(
        "Wait for the current operation to stop before creating a session.",
      );
    applySaved(await bridge.newSession(), false);
    inventoryRef.current = null;
    selectionRef.current = null;
    await refresh();
  }
  const closeSessions = useCallback(() => setSessionOpen(false), []);
  const closeAcquisition = useCallback(() => setAcquisitionOpen(false), []);

  const visibleDevices = (snapshot?.devices ?? []).filter((item) =>
    `${item.id} ${item.name} ${item.protocol ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [
    {
      label: "EXTERNAL MEDIA",
      values: visibleDevices.filter((item) => item.internal === false),
    },
    {
      label: "INTERNAL MEDIA",
      values: visibleDevices.filter((item) => item.internal === true),
    },
    {
      label: "LOCATION NOT REPORTED",
      values: visibleDevices.filter((item) => item.internal === null),
    },
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="drive" size={23} />
          </span>
          <span className="brand-name">DRC</span>
          <span className="brand-divider" />
          <span className="brand-subtitle">Disk Recovery Control</span>
          <span className="version">0.4.0</span>
        </div>
        <div className="header-actions">
          <div className="mode-switch" aria-label="Workspace experience"><button aria-pressed={experience === "easy"} onClick={() => changeExperience("easy")}>Easy</button><button aria-pressed={experience === "professional"} onClick={() => changeExperience("professional")}>Professional</button></div>
          <button className="button" onClick={() => setReferenceOpen(true)}><Icon name="file" />Reference</button>
          {tools.some(t=>t.key === "lsblk") && <button className="button" disabled={!native || archived} onClick={() => setEvidenceOpen(true)}><Icon name="link"/>Host evidence</button>}
          <button
            className="button"
            disabled={!native || archived}
            hidden={experience === "easy"}
            onClick={() => setImageOpen(true)}
          >
            <Icon name="file" />
            Images
          </button>
          <button
            className="button"
            disabled={!native || archived}
            hidden={experience === "easy"}
            onClick={() => setAcquisitionOpen(true)}
          >
            <Icon name="drive" />
            Raw acquisition
          </button>
          <button
            className="button"
            disabled={!native || !sessionId}
            onClick={() => setSessionOpen(true)}
          >
            <Icon name="file" />
            Sessions
          </button>
          <button className="policy-badge" onClick={() => setPolicyOpen(true)}>
            <Icon name="shield" size={15} />
            <span>Read-only policy</span>
            <span className="permission-code">r--</span>
          </button>
          <button className="button" disabled={!snapshot} onClick={copySession} hidden={experience === "easy"}>
            <Icon name="copy" />
            Copy session JSON
          </button>
          <button
            className="button"
            disabled={!!busy || !native || archived}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" className={busy ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <div className="sidebar-title">
            <span className="eyebrow">CONNECTED MEDIA</span>
            <span className="sidebar-count">
              {snapshot?.devices.length ?? "—"}
            </span>
          </div>
          <label className="search device-search">
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a device…"
              aria-label="Find a device"
            />
          </label>
          <div className="device-list">
            {groups.map(
              (group) =>
                group.values.length > 0 && (
                  <div className="device-group" key={group.label}>
                    <h2>{group.label}</h2>
                    {group.values.map((item) => (
                      <button
                        key={item.token}
                        className={`device-item ${selection === item.id ? "selected" : ""}`}
                        onClick={() => {
                          setSelection(item.id);
                          selectionRef.current = item.id;
                        }}
                      >
                        <div className="device-icon">
                          <Icon name="drive" size={22} />
                        </div>
                        <div className="device-summary">
                          <span className="device-name" title={item.name}>
                            {item.name}
                          </span>
                          <span className="device-meta">
                            {item.id} <span>·</span>{" "}
                            {humanBytes(item.sizeBytes)}
                          </span>
                          <span className="device-protocol">
                            {item.protocol ?? "Protocol not reported"}
                          </span>
                        </div>
                        <Icon
                          name="chevron"
                          size={12}
                          className="device-arrow"
                        />
                      </button>
                    ))}
                  </div>
                ),
            )}
            {visibleDevices.length === 0 && (
              <div className="sidebar-empty">
                <Icon name="drive" size={24} />
                <p>
                  {query
                    ? "No matching devices"
                    : busy
                      ? "Reading connected media…"
                      : native
                        ? "No physical media reported"
                        : "Desktop connection required"}
                </p>
              </div>
            )}
          </div>
          <div className="sidebar-bottom">
            <button
              className={`watch-control ${watching ? "is-on" : ""}`}
              disabled={!native}
              onClick={() => void toggleWatch()}
            >
              <span className={`status-dot ${watching ? "live" : ""}`} />
              <span>Watch connections</span>
              <span
                className="watch-switch"
                aria-label={watching ? "Enabled" : "Disabled"}
              >
                <span />
              </span>
            </button>
            <p>
              Metadata queries only.
              <br />
              No automatic SMART or sector scans.
            </p>
            <div className="brand-signature">6d 37 6d 64 2d 64</div>
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-bar">
            <div className="breadcrumb">
              <Icon name="grid" size={14} />
              <span>Storage workspace</span>
              <Icon name="chevron" size={12} />
              <code>{device ? `/dev/${device.id}` : "No selection"}</code>
            </div>
            <span className="snapshot-time">
              <Icon name="clock" size={12} />
              {snapshot
                ? `Snapshot ${timestamp(snapshot.observedAt)}`
                : "No snapshot"}
            </span>
          </div>
          {!native && (
            <div className="preview-banner">
              <Icon name="info" />
              <span>
                Browser preview · Live device access requires the DRC desktop
                app. No simulated readings.
              </span>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="info" />
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss error">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {archived && (
            <div className="inline-note historical-banner">
              <Icon name="file" />
              <span>
                Historical session · {sessionId}. These device paths and tokens
                are recorded observations.
              </span>
              <button className="button" onClick={() => void liveSession()}>
                Return to live
              </button>
            </div>
          )}
          {device?.metadataOnly && (
            <div className="inline-note protection-note">
              <Icon name="shield" />
              <span>{device.protectionReason}</span>
            </div>
          )}
          {snapshot?.warnings.map((warning, index) => (
            <div className="inline-note" key={index}>
              <Icon name="info" />
              {warning}
            </div>
          ))}

          {experience === "easy" ? <EasyWorkspace device={device} smart={device ? smart[device.identityKey] : undefined} jobs={jobs} tools={tools} disabled={!!busy || !native || archived} inspect={() => { setEasyReading("smart"); void runSmart(); }} connections={() => { setEasyReading("connection"); void runConnection(); }} acquire={() => setAcquisitionOpen(true)} images={() => setImageOpen(true)} details={() => { changeExperience("professional"); setTab("device"); }} reference={() => setReferenceOpen(true)} /> : device ? (
            <>
              <div className="device-heading">
                <div className="device-heading-icon">
                  <Icon name="drive" size={32} />
                </div>
                <div className="device-heading-text">
                  <div className="device-kicker">
                    <span className="eyebrow">PHYSICAL DEVICE</span>
                    <span
                      className="small-tag"
                      data-location={
                        device.internal === false
                          ? "external"
                          : device.internal === true
                            ? "internal"
                            : "unknown"
                      }
                    >
                      {device.internal === true
                        ? "INTERNAL"
                        : device.internal === false
                          ? "EXTERNAL"
                          : "LOCATION UNKNOWN"}
                    </span>
                  </div>
                  <h1>{device.name}</h1>
                  <div className="device-heading-meta">
                    <code>/dev/{device.id}</code>
                    <span>·</span>
                    <span>{device.protocol ?? "Protocol not reported"}</span>
                    <span>·</span>
                    <span>Collected {timestamp(device.observedAt)}</span>
                  </div>
                </div>
                <div className="device-heading-capacity">
                  <strong>{humanBytes(device.sizeBytes)}</strong>
                  <span>
                    {device.sizeBytes
                      ? `${device.sizeBytes} bytes`
                      : "Exact capacity not reported"}
                  </span>
                </div>
              </div>
              <nav className="workspace-tabs" aria-label="Device details">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    className={tab === item.key ? "active" : ""}
                    data-section={item.key}
                    aria-pressed={tab === item.key}
                    onClick={() => setTab(item.key)}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.key === "partitions" && (
                      <span className="tab-count">
                        {device.partitions.length}
                      </span>
                    )}
                  </button>
                ))}
                <div className="tab-end">
                  <Icon name="lock" size={12} />
                  <span>Write commands unavailable</span>
                </div>
              </nav>
              <div className="workspace-content" key={`${device.id}:${tab}`}>
                {device.infoError && (
                  <div className="error-box">
                    Device metadata query: {device.infoError}
                  </div>
                )}
                {tab === "device" && (
                  <>
                    <div className="facts-grid">
                      <Fact
                        label="BUS PROTOCOL"
                        value={device.protocol ?? "Not reported"}
                        detail={snapshot?.platform === "Linux" ? "Reported by lsblk" : "Reported by diskutil"}
                      />
                      <Fact
                        label="PARTITION SCHEME"
                        value={device.content ?? "Not reported"}
                        detail="Reported content identifier"
                      />
                      <Fact
                        label="LOGICAL BLOCK SIZE"
                        value={displayValue(
                          getField(device.info, "DeviceBlockSize") ?? getField(device.info, "log-sec"),
                        )}
                        detail="Original value · bytes"
                      />
                      <Fact
                        label={snapshot?.platform === "Linux" ? "OS READ ONLY" : "OS MEDIA WRITABLE"}
                        value={displayValue(
                          snapshot?.platform === "Linux" ? getField(device.info, "ro") : getField(device.info, "WritableMedia"),
                        )}
                        detail="Independent of DRC command policy"
                      />
                    </div>
                    <FieldTable
                      value={device.info}
                      grouping="device"
                      source={`${snapshot?.platform === "Linux" ? "lsblk / udev" : "diskutil info -plist"} ${device.id} · exact numeric strings`}
                      title="All device fields"
                      onCopy={() =>
                        void copy(
                          JSON.stringify(
                            { info: device.info, layout: device.layout },
                            null,
                            2,
                          ),
                        )
                      }
                    />
                    <div className="identity-note">
                      <Icon name="info" size={14} />
                      <span>
                        Selection is bound to this session snapshot. Device
                        paths can change after reconnecting.
                      </span>
                      <span className="text-mono">
                        {flatten(device.info).length} fields
                      </span>
                    </div>
                  </>
                )}
                {tab === "partitions" && <Partitions device={device} />}
                {tab === "smart" && (
                  <SmartView
                    device={device}
                    result={smart[device.identityKey]}
                    busy={!!busy || archived}
                    run={() => void runSmart()}
                  />
                )}
                {tab === "connection" && (
                  <ConnectionView
                    platform={snapshot?.platform ?? (tools.some(t=>t.key === "lsblk") ? "Linux" : "macOS")}
                    result={connection}
                    busy={!!busy || archived}
                    run={() => void runConnection()}
                  />
                )}
                {tab === "tools" && (
                  <ToolsView
                    tools={tools}
                    busy={!!busy || archived}
                    refresh={() => void refresh()}
                    smart={() => setTab("smart")}
                    connection={() => setTab("connection")}
                    acquisition={() => setAcquisitionOpen(true)}
                    images={() => setImageOpen(true)}
                  />
                )}
                {tab === "activity" && (
                  <CommandTiming
                    records={records}
                    onSelect={(id) => {
                      setSelectedRecord(id);
                      setTerminalMode("commands");
                      setTerminalCompact(false);
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="unselected-workspace">
              <div className="workspace-intro">
                <span className="eyebrow">STORAGE / INSPECTION</span>
                <h1>
                  One workspace.
                  <br />
                  Every reported field.
                </h1>
                <p>
                  Inspect connected media, partition layouts and original tool
                  output. You choose the query and interpret the readings.
                </p>
              </div>
              <div className="empty-media-panel">
                <Icon name="drive" size={38} />
                <h2>
                  {busy
                    ? "Reading connected media"
                    : snapshot?.devices.length
                      ? "Select a device"
                      : "No device selected"}
                </h2>
                <p>
                  {snapshot?.devices.length
                    ? "Choose a device from the current snapshot to inspect its complete metadata."
                    : native
                      ? "Connected physical media will appear in the sidebar."
                      : "Open the desktop app to query your connected media."}
                </p>
                {native && (
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() => void refresh()}
                  >
                    <Icon name="refresh" />
                    Refresh connected media
                  </button>
                )}
              </div>
              <div className="empty-capabilities">
                <span>
                  <Icon name="shield" />
                  Source read only
                </span>
                <span>
                  <Icon name="terminal" />
                  Original output retained
                </span>
                <span>
                  <Icon name="partitions" />
                  Filesystem-independent discovery
                </span>
              </div>
            </div>
          )}
        </main>
      </div>

      <TerminalPanel
        records={records}
        events={events}
        selected={selectedRecord}
        onSelect={setSelectedRecord}
        mode={terminalMode}
        setMode={setTerminalMode}
        onCopy={(text) => void copy(text)}
        compact={terminalCompact}
        onToggle={() => setTerminalCompact((value) => !value)}
      />
      <footer className="app-status" data-busy={!!busy}>
        <div>
          <span className={`status-dot ${busy ? "working" : ""}`} />
          <span>{busy ?? "Ready"}</span>
          <span className="status-separator">/</span>
          <span>{native ? "Native desktop" : "Browser preview"}</span>
        </div>
        <div>
          <span>
            {saveError
              ? "Local save error"
              : archived
                ? "Historical session"
                : "Session saved locally"}
          </span>
          <span className="status-separator">/</span>
          <span>{records.length} commands</span>
          <span className="status-separator">/</span>
          <span>DRC 0.4.0</span>
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Icon name="info" />
          {notice}
        </div>
      )}
      {policyOpen && (
        <div className="modal-backdrop" onClick={() => setPolicyOpen(false)}>
          <section
            ref={policyDialog}
            className="policy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="policy-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">EXECUTION POLICY</span>
                <h2 id="policy-title">Source read-only policy</h2>
              </div>
              <button
                onClick={() => setPolicyOpen(false)}
                aria-label="Close execution policy"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="policy-level">
              <Icon name="shield" size={23} />
              <div>
                <strong>Source writes: blocked by DRC</strong>
                <p>
                  Sources are opened read-only. Raw acquisition creates a new
                  image and mapfile on an admitted destination. Image file
                  extraction writes separate output streams to a reviewed new
                  folder. Metadata-only media prohibit extended reads and file
                  traversal. No source repair, format, controller changes or
                  open shell.
                </p>
              </div>
            </div>
            <div className="policy-level">
              <Icon name="info" size={23} />
              <div>
                <strong>System-wide write protection: not established</strong>
                <p>
                  Physical acquisition refuses mounted sources. macOS holds a
                  Disk Arbitration mount veto; Linux holds an exclusive read-only
                  block-device handle during the operation. DRC does not block all writes from other
                  applications. Existing mounts are unchanged; hardware
                  write-blocker state is not verified.
                </p>
              </div>
            </div>
            <div className="policy-level">
              <Icon name="file" size={23} />
              <div>
                <strong>Sessions and progress are saved locally</strong>
                <p>
                  Sessions retain reported fields, original streams and events.
                  Acquisitions retain an image, mapfile and original output
                  files. Resume requires another identity/artifact review. No
                  automatic source scans or filesystem mounts are performed.
                </p>
              </div>
            </div>
            <button
              className="button primary"
              onClick={() => setPolicyOpen(false)}
            >
              Close
            </button>
          </section>
        </div>
      )}
      {sessionOpen && (
        <SessionPanel
          current={sessionId}
          originalImport={originalImport}
          archived={archived}
          disabled={!!busy}
          close={closeSessions}
          view={viewSession}
          fresh={freshSession}
          live={liveSession}
        />
      )}
      {acquisitionOpen && (
        <AcquisitionPanel
          device={device}
          simple={experience === "easy"}
          platform={snapshot?.platform ?? (tools.some(t=>t.key === "lsblk") ? "Linux" : "macOS")}
          jobs={jobs}
          busy={!!busy && !acquiringRef.current}
          close={closeAcquisition}
          started={updateJob}
        />
      )}
      {evidenceOpen && <HostEvidence kernelAllowed={!archived} collectReport={collectHostEvidence} reports={hostEvidence} disabled={!!busy || archived} close={closeEvidence} onReport={report=>setHostEvidence(items=>[...items,report as unknown as Json])}/>}
      {referenceOpen && <CheatSheet platform={snapshot?.platform ?? (tools.some(t=>t.key === "lsblk") ? "Linux" : "macOS")} close={closeReference} copy={text=>navigator.clipboard.writeText(text)} />}
      {easyReading && <Modal title={easyReading === "smart" ? "Reported SMART / NVMe readings" : "Reported connection details"} subtitle="EXPLICIT QUERY / ORIGINAL FIELDS" close={closeEasyReading} wide className="readings-modal">{easyReading === "smart" && device ? <SmartView device={device} result={smart[device.identityKey]} busy={!!busy || archived} run={() => void runSmart()} /> : <ConnectionView platform={snapshot?.platform ?? (tools.some(t=>t.key === "lsblk") ? "Linux" : "macOS")} result={connection} busy={!!busy || archived} run={() => void runConnection()} />}</Modal>}
      {imageOpen && (
        <ImagePanel
          reports={imageReports}
          disabled={!!busy}
          close={closeImages}
          jobs={extractions}
          onJob={updateExtraction}
          onReport={(report) =>
            setImageReports((items) => [...items, report as unknown as Json])
          }
        />
      )}
    </div>
  );
}
