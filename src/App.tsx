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
  RecoveryRun,
  RecoveryOptions,
} from "./types";
import { bridge, native, subscribe, type WindowPresentation } from "./bridge";
import {
  commandLine,
  displayValue,
  flatten,
  getField,
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
import { WorkspacePanel } from "./WorkspacePanel";
import { ByteValue } from "./ByteValue";
import { Hints } from "./Hints";
import { PortTree } from "./PortTree";
import { Select } from "./Select";
import { UnavailableMediaView, observationLabel } from "./UnavailableMediaView";
import { listen } from "@tauri-apps/api/event";
import { version } from "../package.json";
import { RecoveryPanel } from "./RecoveryPanel";
import { StorageOverview } from "./StorageOverview";
import { DeviceTabs } from "./DeviceTabs";
import { ModeDetails } from "./ModeDetails";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function savedRecovery(run?: RecoveryRun): RecoveryRun | null {
  if (!run) return null;
  return run.state === "running"
    ? {
        ...run,
        state: "interrupted",
        source: null,
        steps: run.steps.map((s) =>
          s.state === "running"
            ? {
                ...s,
                state: "not-run" as const,
                detail: "This saved check has no completion record.",
              }
            : s,
        ),
        issue: {
          code: "INCOMPLETE_SAVED_RUN",
          title: "No completion was recorded",
          detail:
            "The saved run ended while a check was active. Its result is unknown; it is not reported as successful.",
          scope: "saved-report",
          evidence: null,
        },
      }
    : run;
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

function Partitions({
  device,
  simple = false,
}: {
  device: Device;
  simple?: boolean;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Partition layout</h3>
          <p className="source-label">
            {getField(device.info, "kname")
              ? "lsblk --json --bytes"
              : "diskutil list -plist physical"}{" "}
            · {device.id}
          </p>
        </div>
        <span className="count-tag">{device.partitions.length} entries</span>
      </div>
      {device.partitions.length ? (
        <>
          <PartitionChart device={device} />
          {simple && (
            <div className="partition-cards">
              {device.partitions.map((partition, index) => (
                <article key={index}>
                  <Icon name="partitions" size={20} />
                  <div>
                    <h4>
                      {displayValue(
                        getField(partition, "VolumeName") ??
                          getField(partition, "label") ??
                          getField(partition, "DeviceIdentifier") ??
                          getField(partition, "kname"),
                      )}
                    </h4>
                    <p>
                      {displayValue(
                        getField(partition, "Content") ??
                          getField(partition, "fstype"),
                      )}
                    </p>
                    <p>
                      Mount point:{" "}
                      {displayValue(
                        getField(partition, "MountPoint") ??
                          getField(partition, "mountpoints"),
                      )}
                    </p>
                  </div>
                  <strong>
                    <ByteValue
                      value={
                        getField(partition, "Size") ??
                        getField(partition, "size")
                      }
                    />
                  </strong>
                </article>
              ))}
            </div>
          )}
          <ModeDetails
            simple={simple}
            title="Partition identifiers and mount points"
          >
            <div className="table-scroll">
              <table className="partition-table">
                <thead>
                  <tr>
                    <th>DEVICE</th>
                    <th>CONTENT</th>
                    <th>VOLUME NAME</th>
                    <th>SIZE</th>
                    <th>MOUNT POINT</th>
                  </tr>
                </thead>
                <tbody>
                  {device.partitions.map((partition, index) => (
                    <tr key={index}>
                      <td>
                        {displayValue(
                          getField(partition, "DeviceIdentifier") ??
                            getField(partition, "kname"),
                        )}
                      </td>
                      <td>
                        {displayValue(
                          getField(partition, "Content") ??
                            getField(partition, "fstype"),
                        )}
                      </td>
                      <td>
                        {displayValue(
                          getField(partition, "VolumeName") ??
                            getField(partition, "label"),
                        )}
                      </td>
                      <td>
                        <ByteValue
                          value={
                            getField(partition, "Size") ??
                            getField(partition, "size")
                          }
                        />
                      </td>
                      <td>
                        {displayValue(
                          getField(partition, "MountPoint") ??
                            getField(partition, "mountpoints"),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ModeDetails>
        </>
      ) : (
        <div className="inline-note">
          <Icon name="info" />
          No partition entries were returned in this snapshot. The full layout
          remains available below.
        </div>
      )}
      <ModeDetails simple={simple} title="Original partition fields">
        <FieldTable
          value={device.layout}
          source="Original partition-layout fields · numeric values retained as exact strings"
          title="Complete layout fields"
        />
      </ModeDetails>
    </>
  );
}

function SmartView({
  simple = false,
  device,
  result,
  busy,
  run,
}: {
  simple?: boolean;
  device: Device;
  result?: QueryResult;
  busy: boolean;
  run: (deviceType?: string) => void;
}) {
  const [deviceType, setDeviceType] = useState("auto");
  useEffect(() => setDeviceType("auto"), [device.token]);
  const fields = result?.fields;
  const status = getField(getField(fields, "smart_status"), "passed");
  const log = getField(fields, "nvme_smart_health_information_log");
  const temperature =
    getField(getField(fields, "temperature"), "current") ??
    getField(log, "temperature");
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
          onClick={() => run(deviceType)}
        >
          <Icon name="refresh" />
          Read information
        </button>
      </div>
      {simple && (
        <dl className="reading-summary" aria-label="Reported SMART readings">
          <div>
            <dt>Reported SMART status</dt>
            <dd>
              {status === true
                ? "Passed"
                : status === false
                  ? "Failed"
                  : result
                    ? "Not reported"
                    : "Not queried"}
            </dd>
          </div>
          <div>
            <dt>Temperature</dt>
            <dd>
              {temperature !== undefined
                ? `${displayValue(temperature)} °C`
                : "Not reported"}
            </dd>
          </div>
          <div>
            <dt>Percentage used</dt>
            <dd>
              {getField(log, "percentage_used") !== undefined
                ? `${displayValue(getField(log, "percentage_used"))}%`
                : "Not reported"}
            </dd>
          </div>
          <div>
            <dt>Last query</dt>
            <dd>
              {result ? timestamp(result.record.startedAt) : "Not queried"}
            </dd>
          </div>
        </dl>
      )}
      <ModeDetails
        simple={simple}
        title={`SMART transport · ${deviceType === "auto" ? "Automatic detection" : deviceType}`}
        hint="Some USB bridges need an explicit SMART pass-through protocol. Changing this selection performs no query. Choose a documented mode, then request a read."
      >
        <div className="form-field">
          <span>Pass-through protocol</span>
          <Select
            label="SMART pass-through protocol"
            value={deviceType}
            onChange={setDeviceType}
            disabled={busy || device.metadataOnly}
            options={[
              {
                value: "auto",
                label: "Automatic detection",
                detail: "smartctl chooses its device type",
              },
              {
                value: "sat",
                label: "SAT · ATA over SCSI",
                detail: "Documented SATA bridge pass-through",
              },
              {
                value: "scsi",
                label: "SCSI",
                detail: "SCSI information interface",
              },
              {
                value: "nvme",
                label: "Native NVMe",
                detail: "Host-exposed NVMe interface",
              },
              {
                value: "sntasmedia",
                label: "ASMedia · USB to NVMe",
                detail: "Requires supported bridge firmware and host",
              },
              {
                value: "sntjmicron",
                label: "JMicron · USB to NVMe",
                detail: "Requires supported bridge firmware and host",
              },
              {
                value: "sntrealtek",
                label: "Realtek · USB to NVMe",
                detail: "Requires supported bridge firmware and host",
              },
            ]}
          />
        </div>
        <p className="source-label">
          Changing this selection performs no query. Unsupported pass-through is
          retained as original output and does not establish disk failure. Some
          macOS bridges require a vendor driver.
        </p>
      </ModeDetails>
      {device.metadataOnly && (
        <div className="inline-note">
          <Icon name="shield" />
          {device.protectionReason}
        </div>
      )}
      <ModeDetails simple={simple} title="Query command">
        <div className="command-preview">
          <span className="eyebrow">QUERY</span>
          <code>
            smartctl -a -j {deviceType !== "auto" ? `-d ${deviceType} ` : ""}
            /dev/
            {device.id}
          </code>
          <span className="small-tag">NO SELF-TEST</span>
        </div>
      </ModeDetails>
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
            <ModeDetails simple={simple} title="All SMART / NVMe readings">
              <FieldTable
                value={result.fields}
                source={`${commandLine(result.record)} · ${timestamp(result.record.startedAt)}`}
                title="Complete SMART / NVMe fields"
              />
            </ModeDetails>
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
  simple = false,
  result,
  busy,
  run,
  platform = "macOS",
}: {
  simple?: boolean;
  platform?: string;
  result: QueryResult | null;
  busy: boolean;
  run: () => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>{simple ? "Connections" : "Host connection report"}</h3>
          <p className="source-label">
            {simple
              ? "Select a connection to view devices and reported readings."
              : "USB / Thunderbolt / network / displays / NVMe · host-reported properties"}
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy || !native}
          onClick={run}
        >
          <Icon name="refresh" />
          Refresh port map
        </button>
      </div>
      <p className="source-label" hidden={simple}>
        {platform === "Linux"
          ? "lsusb / sysfs"
          : "System Profiler / IORegistry"}{" "}
        · reported hierarchy and properties · actual electrical current is not
        measured
      </p>
      {result ? (
        <>
          {result.parseError && (
            <div className="error-box">
              Report parsing failed: {result.parseError}. Original output is in
              the transcript.
            </div>
          )}
          <PortTree report={result} simple={simple} />
          {result.fields !== null && (
            <ModeDetails
              simple={simple}
              title="Complete original connection report"
            >
              <FieldTable
                value={result.fields}
                source={`${commandLine(result.record)} · ${timestamp(result.record.startedAt)}`}
                title="Complete connection fields"
              />
            </ModeDetails>
          )}
        </>
      ) : (
        <EmptyState icon="link" title="Connection report not collected">
          Collect available host connection properties. No device reset or
          sector scan is performed.
        </EmptyState>
      )}
    </>
  );
}

function ToolsView({
  simple = false,
  tools,
  busy,
  refresh,
  smart,
  connection,
  acquisition,
  images,
}: {
  simple?: boolean;
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
          <h3>{simple ? "Available functions" : "Tool inventory"}</h3>
          <p className="source-label">
            Installed tools and implemented adapters are shown separately
          </p>
        </div>
        <span className="count-tag">
          {tools.filter((tool) => tool.available).length} located
        </span>
      </div>
      <div className={`tool-list ${simple ? "simple-tool-list" : ""}`}>
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
                {simple
                  ? ({
                      ddrescue: "Create disk images",
                      "drc-tsk": "Read images and recover files",
                      smartctl: "Read SMART information",
                      system_profiler: "Read connections",
                    }[tool.key] ?? tool.name)
                  : tool.name}
                <span
                  className={`small-tag ${tool.available ? "" : "muted"}`}
                  data-available={tool.available}
                >
                  {tool.available ? "LOCATED" : "NOT LOCATED"}
                </span>
              </h4>
              <p>{tool.purpose}</p>
              {simple && (
                <p>
                  {tool.name} ·{" "}
                  {tool.implemented ? "Integrated" : "Adapter pending"}
                </p>
              )}
              <ModeDetails simple={simple} title="Executable location">
                <code>
                  {tool.path ?? "No executable at the configured locations"}
                </code>
              </ModeDetails>
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
                  {simple
                    ? ({
                        ddrescue: "Create image…",
                        "drc-tsk": "Open image…",
                        smartctl: "SMART readings",
                        system_profiler: "Port map",
                      }[tool.key] ?? "Refresh devices")
                    : "Open"}
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
  const nativeMac = native && /Mac/.test(navigator.platform);
  const [windowPresentation, setWindowPresentation] =
    useState<WindowPresentation | null>(null);
  useEffect(() => {
    if (!nativeMac) return;
    let disposed = false;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    void listen<WindowPresentation>(
      "workspace-window-presentation",
      ({ payload }) => {
        receivedEvent = true;
        if (!disposed) setWindowPresentation(payload);
      },
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => console.warn("Window presentation listener:", error));
    void (async () => {
      // Initial presentation must not depend on event-listener registration.
      // The native IPC handler can still be finishing startup at first paint.
      for (const delay of [0, 150, 450, 900]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (disposed || receivedEvent) return;
        try {
          const initial = await bridge.windowPresentation();
          // A live transition wins over an older initial reply.
          if (!disposed && !receivedEvent) setWindowPresentation(initial);
          return;
        } catch (error) {
          if (delay === 900)
            console.warn("Initial window presentation:", error);
        }
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [nativeMac]);
  const [sidebarVisible, setSidebarVisible] = useState(
    () => window.innerWidth >= 900,
  );
  useEffect(() => {
    const width = window.matchMedia("(min-width: 900px)");
    const adapt = () => setSidebarVisible(width.matches);
    width.addEventListener("change", adapt);
    return () => width.removeEventListener("change", adapt);
  }, []);
  const [experience, setExperience] = useState<"easy" | "professional">(() =>
    localStorage.getItem("drc.experience") === "professional"
      ? "professional"
      : "easy",
  );
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const closeEvidence = useCallback(() => setEvidenceOpen(false), []);
  const [hostEvidence, setHostEvidence] = useState<Json[]>([]);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const closeReference = useCallback(() => setReferenceOpen(false), []);
  const [easyReading, setEasyReading] = useState<"smart" | "connection" | null>(
    null,
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const closeWorkspace = useCallback(() => setWorkspaceOpen(false), []);
  function openPanel(
    panel:
      | "workspace"
      | "device"
      | "recovery"
      | "acquisition"
      | "image"
      | "reference"
      | "session"
      | "evidence"
      | "connection"
      | "smart"
      | null,
  ) {
    setWorkspaceOpen(panel === "workspace");
    if (panel === "device") setTab("device");
    setRecoveryOpen(panel === "recovery");
    setAcquisitionOpen(panel === "acquisition");
    setImageOpen(panel === "image");
    setReferenceOpen(panel === "reference");
    setSessionOpen(panel === "session");
    setEvidenceOpen(panel === "evidence");
    setEasyReading(panel === "connection" || panel === "smart" ? panel : null);
    if (window.innerWidth < 900) setSidebarVisible(false);
  }
  const closeEasyReading = useCallback(() => setEasyReading(null), []);
  const changeExperience = (value: "easy" | "professional") => {
    setExperience(value);
    localStorage.setItem("drc.experience", value);
  };
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [originalImport, setOriginalImport] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const archivedRef = useRef(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [acquisitionOpen, setAcquisitionOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryRun, setRecoveryRun] = useState<RecoveryRun | null>(null);
  const [recoveryRuns, setRecoveryRuns] = useState<RecoveryRun[]>([]);
  const [recoveryRunning, setRecoveryRunning] = useState(false);
  const [recoveryStopping, setRecoveryStopping] = useState<string | null>(null);
  const [recoverySource, setRecoverySource] = useState<Device | undefined>(
    undefined,
  );
  const closeRecovery = useCallback(() => setRecoveryOpen(false), []);
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
  const [observationSelection, setObservationSelection] = useState<
    string | null
  >(null);
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
  const observedMedia = snapshot?.unavailableMedia ?? [];
  const observedSelection = observedMedia.find(
    (item) => item.id === observationSelection,
  );
  const menuNavigate = useRef<
    (value: { section: string; deviceId: string | null }) => Promise<void>
  >(async () => {});
  menuNavigate.current = async ({ section, deviceId }) => {
    if (archivedRef.current) await liveSession();
    if (
      deviceId &&
      inventoryRef.current?.devices.some((d) => d.id === deviceId)
    ) {
      setObservationSelection(null);
      selectionRef.current = deviceId;
      setSelection(deviceId);
    }
    if (section === "device") {
      openPanel("device");
      setTab("device");
    }
    if (section === "ports") openPanel("connection");
    if (section === "acquisition") openPanel("acquisition");
  };
  useEffect(() => {
    if (!native) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void listen<{ section: string; deviceId: string | null }>(
      "menu-bar-navigate",
      (event) => {
        void menuNavigate
          .current(event.payload)
          .catch((error) => setError(errorText(error)));
      },
    ).then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

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

  const updateRecovery = useCallback((incoming: RecoveryRun) => {
    setRecoveryRun((current) =>
      current?.id === incoming.id &&
      (current.updatedAt > incoming.updatedAt ||
        (current.state !== "running" && incoming.state === "running"))
        ? current
        : incoming,
    );
    setRecoveryRuns((items) => [
      ...items.filter((r) => r.id !== incoming.id),
      incoming,
    ]);
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
      setObservationSelection((current) =>
        next.unavailableMedia?.some((item) => item.id === current)
          ? current
          : null,
      );
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
          setRecoveryRuns(saved.recoveryRuns ?? []);
          setRecoveryRun(savedRecovery(saved.recoveryRuns?.at(-1)));
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
          recovery: (incoming) => {
            if (active && !archivedRef.current) updateRecovery(incoming);
          },
          discovery: (next) => {
            if (
              !active ||
              archivedRef.current ||
              (inventoryRef.current?.observedAt ?? 0) > next.observedAt
            )
              return;
            const previous = inventoryRef.current?.devices.find(
              (d) => d.id === selectionRef.current,
            );
            const replacement = next.devices.find(
              (d) =>
                d.id === previous?.id && d.identityKey === previous.identityKey,
            );
            const chosen = previous
              ? (replacement?.id ?? null)
              : inventoryRef.current
                ? null
                : ((
                    next.devices.find((d) => d.internal === false) ??
                    next.devices[0]
                  )?.id ?? null);
            inventoryRef.current = next;
            selectionRef.current = chosen;
            setSnapshot(next);
            setSelection(chosen);
            setObservationSelection((current) =>
              next.unavailableMedia?.some((item) => item.id === current)
                ? current
                : null,
            );
          },
          connection: (report) => {
            if (active && !archivedRef.current) setConnection(report);
          },
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
  }, [refresh, updateJob, updateRecovery]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<string>("recovery-stopping", (event) =>
      setRecoveryStopping(event.payload),
    ).then((fn) => {
      if (disposed) fn();
      else stop = fn;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  async function startRecovery(key: string, options: RecoveryOptions) {
    if (
      busyRef.current ||
      acquiringRef.current ||
      extractingRef.current ||
      archivedRef.current
    )
      throw new Error(
        "Finish the current operation or return to the live session first.",
      );
    busyRef.current = true;
    setRecoveryRunning(true);
    setRecoveryStopping(null);
    setRecoveryRun(null);
    setBusy("Running recovery checks");
    try {
      updateRecovery(await bridge.recoveryChecks(key, options));
    } finally {
      busyRef.current = false;
      setRecoveryRunning(false);
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }
  function continueRecovery(source: Device) {
    setRecoverySource(source);
    setRecoveryOpen(false);
    openPanel("acquisition");
  }

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

  async function runSmart(deviceType = "auto") {
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
      const result = await bridge.smart(target.token, deviceType);
      setSmart((items) => ({ ...items, [target.identityKey]: result }));
    } catch (error) {
      setError(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
  }

  async function collectHostEvidence(
    kind: "topology" | "kernel",
  ): Promise<QueryResult> {
    if (archivedRef.current)
      throw new Error("Return to the live session before collecting evidence.");
    const activeData = acquiringRef.current || extractingRef.current;
    if (kind === "kernel") return bridge.hostEvidence(kind);
    if (busyRef.current || activeData)
      throw new Error(
        "Wait for the active operation before collecting topology.",
      );
    busyRef.current = true;
    setBusy("Collecting host evidence");
    try {
      return await bridge.hostEvidence(kind);
    } finally {
      busyRef.current = false;
      setBusy(null);
      if (pendingRefresh.current) void refreshRef.current();
    }
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
          recoveryRuns,
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
    setRecoveryRuns(saved.recoveryRuns ?? []);
    setRecoveryRun(savedRecovery(saved.recoveryRuns?.at(-1)));
    setSnapshot(saved.snapshot);
    setRecords(saved.commandRecords);
    setEvents(saved.connectionEvents);
    setSmart(saved.smartReports);
    setConnection(saved.connectionReport);
    setSelectedRecord(saved.commandRecords.at(-1)?.id ?? null);
    setSelection(saved.snapshot?.devices[0]?.id ?? null);
    setObservationSelection(null);
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
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (event.key === "\\") {
        event.preventDefault();
        setSidebarVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const closeSessions = useCallback(() => setSessionOpen(false), []);
  const closeAcquisition = useCallback(() => {
    setAcquisitionOpen(false);
    setRecoverySource(undefined);
  }, []);

  const visibleDevices = (snapshot?.devices ?? []).filter((item) =>
    `${item.id} ${item.name} ${item.protocol ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [
    {
      label: "External",
      values: visibleDevices.filter((item) => item.internal === false),
    },
    {
      label: "Internal",
      values: visibleDevices.filter((item) => item.internal === true),
    },
    {
      label: "Location not reported",
      values: visibleDevices.filter((item) => item.internal === null),
    },
  ];

  return (
    <div className={`app-shell experience-${experience}`}>
      <Hints />
      <header
        className={`app-header${nativeMac ? ` macos-titlebar controls-${windowPresentation?.controlsSide ?? "pending"}${windowPresentation?.fullscreen ? " is-fullscreen" : ""}` : ""}`}
        aria-label="Workspace toolbar"
        data-tauri-drag-region="deep"
      >
        <button
          className="toolbar-icon"
          aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={sidebarVisible}
          data-hint="Show or hide devices and workspace tools."
          onClick={() => setSidebarVisible((v) => !v)}
        >
          <Icon name="sidebar" size={18} />
        </button>
        <div className="brand">
          <span className="brand-name">DRC</span>
          <span className="brand-subtitle">Disk Resource Console</span>
        </div>
        <div className="toolbar-spacer" />
        <div className="mode-switch" aria-label="Workspace experience">
          <button
            aria-pressed={experience === "easy"}
            onClick={() => changeExperience("easy")}
          >
            Easy
          </button>
          <button
            aria-pressed={experience === "professional"}
            onClick={() => changeExperience("professional")}
          >
            Professional
          </button>
        </div>
        <span className="toolbar-divider" />
        <button
          className="button primary"
          disabled={!native || (!!busy && !recoveryRunning)}
          onClick={() => openPanel("recovery")}
        >
          <Icon
            name={recoveryRunning ? "refresh" : "shield"}
            className={recoveryRunning ? "spin" : ""}
          />
          {recoveryRunning ? "View checks" : "Recovery checks"}
        </button>
        <button
          className="toolbar-icon policy-control"
          aria-label="Read-only policy"
          data-hint="DRC source-write policy and the limits of operating-system protection."
          onClick={() => setPolicyOpen(true)}
        >
          <Icon name="shield" size={17} />
        </button>
        <button
          className="toolbar-icon"
          aria-label="Refresh devices"
          data-hint="Refresh device metadata. Does not start SMART tests or read sectors."
          disabled={!!busy || !native || archived}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" className={busy ? "spin" : ""} size={17} />
        </button>
      </header>

      <div
        className={`main-layout ${sidebarVisible ? "sidebar-visible" : "sidebar-hidden"}`}
      >
        <aside className="sidebar">
          <div className="sidebar-title">
            <span className="sidebar-section-label">Devices</span>
            <span className="sidebar-count">
              {snapshot ? snapshot.devices.length + observedMedia.length : "—"}
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
                          openPanel(null);
                          setObservationSelection(null);
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
                            <ByteValue value={item.sizeBytes} />
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
            {visibleDevices.length === 0 && observedMedia.length === 0 && (
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
            {observedMedia.filter((item) =>
              `${item.name} ${item.bsdName ?? ""}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ).length > 0 && (
              <div className="device-group observed-device-group">
                <h2>Detected without a disk source</h2>
                {observedMedia
                  .filter((item) =>
                    `${item.name} ${item.bsdName ?? ""}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((item) => (
                    <button
                      key={item.id}
                      className={`device-item ${observedSelection?.id === item.id ? "selected" : ""}`}
                      onClick={() => {
                        openPanel(null);
                        setObservationSelection(item.id);
                        setSelection(null);
                        selectionRef.current = null;
                      }}
                      data-hint="Published host metadata. This is not a usable physical disk source, so no scan or copy is offered."
                    >
                      <div className="device-icon">
                        <Icon name="usb" size={22} />
                      </div>
                      <div className="device-summary">
                        <span className="device-name">{item.name}</span>
                        <span className="device-meta">
                          <ByteValue value={item.sizeBytes} />
                        </span>
                        <span className="device-protocol">
                          {observationLabel(item.stage)}
                        </span>
                      </div>
                      <Icon name="chevron" size={12} />
                    </button>
                  ))}
              </div>
            )}
          </div>
          <nav className="workspace-navigation" aria-label="Workspace tools">
            <h2>{experience === "easy" ? "Tasks" : "Workspace"}</h2>
            <button
              disabled={!native || archived}
              aria-current={acquisitionOpen ? "page" : undefined}
              onClick={() => openPanel("acquisition")}
            >
              <Icon name="copy" />
              Create disk image
            </button>
            <button
              disabled={!native || archived}
              aria-current={imageOpen ? "page" : undefined}
              onClick={() => openPanel("image")}
            >
              <Icon name="folder" />
              {experience === "easy" ? "Browse disk image" : "Image workspace"}
            </button>
            <button
              aria-current={easyReading === "connection" ? "page" : undefined}
              onClick={() => {
                openPanel("connection");
                if (!connection && !archived) void runConnection();
              }}
              data-hint="Inspect the hierarchy of ports, hubs, enclosures and reported storage."
            >
              <Icon name="hub" />
              {experience === "easy" ? "Connections" : "Ports & enclosures"}
            </button>
            {tools.some((t) => t.key === "lsblk") && (
              <button
                disabled={!native || archived}
                aria-current={evidenceOpen ? "page" : undefined}
                onClick={() => openPanel("evidence")}
              >
                <Icon name="link" />
                Host evidence
              </button>
            )}
            <button
              aria-current={referenceOpen ? "page" : undefined}
              onClick={() => openPanel("reference")}
            >
              <Icon name="file" />
              Command reference
            </button>
            <button
              disabled={!native || !sessionId}
              aria-current={sessionOpen ? "page" : undefined}
              onClick={() => openPanel("session")}
            >
              <Icon name="clock" />
              {experience === "easy" ? "Saved sessions" : "Sessions"}
            </button>
            {experience === "professional" && (
              <button disabled={!snapshot} onClick={copySession}>
                <Icon name="copy" />
                Copy session JSON
              </button>
            )}
          </nav>
          <div className="sidebar-bottom">
            <button
              role="switch"
              aria-checked={watching}
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
            <p>Metadata only · scans are explicit</p>
          </div>
        </aside>
        {sidebarVisible && (
          <button
            className="sidebar-dismiss"
            aria-label="Close sidebar"
            onClick={() => setSidebarVisible(false)}
          />
        )}

        <main className="workspace">
          <div id="workspace-panel-root" />
          <div className="workspace-bar">
            <nav className="breadcrumb" aria-label="Workspace navigation">
              <button
                onClick={() => openPanel("workspace")}
                aria-current={workspaceOpen ? "page" : undefined}
                data-hint="Open the storage overview: connected disks, host observations and image tools."
              >
                <Icon name="grid" size={14} />
                <span>Storage workspace</span>
              </button>
              <Icon name="chevron" size={12} />
              {device || observedSelection ? (
                <button
                  onClick={() => {
                    openPanel(device ? "device" : null);
                    setTab("device");
                  }}
                  data-hint={
                    device
                      ? "Open this disk's complete readings. This page is available in both modes."
                      : "Open the selected host observation and its original fields."
                  }
                >
                  <code>
                    {device ? `/dev/${device.id}` : "Host observation"}
                  </code>
                </button>
              ) : (
                <span>No selection</span>
              )}
            </nav>
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

          {observedSelection ? (
            <UnavailableMediaView
              recover={() => openPanel("recovery")}
              item={observedSelection}
              refresh={() => void refresh()}
              ports={() => {
                openPanel("connection");
                void runConnection();
              }}
              disabled={!!busy || !native || archived}
            />
          ) : experience === "easy" && tab === "device" ? (
            <EasyWorkspace
              device={device}
              smart={device ? smart[device.identityKey] : undefined}
              jobs={jobs}
              tools={tools}
              disabled={!!busy || !native || archived}
              inspect={() => {
                openPanel("smart");
                void runSmart();
              }}
              connections={() => {
                openPanel("connection");
                void runConnection();
              }}
              acquire={() => openPanel("acquisition")}
              images={() => openPanel("image")}
              navigation={
                device && (
                  <DeviceTabs
                    tab={tab}
                    select={setTab}
                    partitions={device.partitions.length}
                    simple
                  />
                )
              }
              platform={snapshot?.platform ?? "macOS"}
              reference={() => openPanel("reference")}
            />
          ) : device ? (
            <>
              <div className="device-heading">
                <div className="device-heading-icon">
                  <Icon name="drive" size={32} />
                </div>
                <div className="device-heading-text">
                  <div className="device-kicker">
                    <span className="eyebrow">Physical disk</span>
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
                  <strong>
                    <ByteValue value={device.sizeBytes} />
                  </strong>
                  <span>Reported capacity</span>
                </div>
              </div>
              <DeviceTabs
                tab={tab}
                select={setTab}
                partitions={device.partitions.length}
                simple={experience === "easy"}
              />
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
                        detail={
                          snapshot?.platform === "Linux"
                            ? "Reported by lsblk"
                            : "Reported by diskutil"
                        }
                      />
                      <Fact
                        label="PARTITION SCHEME"
                        value={device.content ?? "Not reported"}
                        detail="Reported content identifier"
                      />
                      <Fact
                        label="LOGICAL BLOCK SIZE"
                        value={displayValue(
                          getField(device.info, "DeviceBlockSize") ??
                            getField(device.info, "log-sec"),
                        )}
                        detail="Original value · bytes"
                      />
                      <Fact
                        label={
                          snapshot?.platform === "Linux"
                            ? "OS READ ONLY"
                            : "OS MEDIA WRITABLE"
                        }
                        value={displayValue(
                          snapshot?.platform === "Linux"
                            ? getField(device.info, "ro")
                            : getField(device.info, "WritableMedia"),
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
                {tab === "partitions" && (
                  <Partitions device={device} simple={experience === "easy"} />
                )}
                {tab === "smart" && (
                  <SmartView
                    simple={experience === "easy"}
                    device={device}
                    result={smart[device.identityKey]}
                    busy={!!busy || archived}
                    run={(deviceType) => void runSmart(deviceType)}
                  />
                )}
                {tab === "connection" && (
                  <ConnectionView
                    simple={experience === "easy"}
                    platform={
                      snapshot?.platform ??
                      (tools.some((t) => t.key === "lsblk") ? "Linux" : "macOS")
                    }
                    result={connection}
                    busy={!!busy || archived}
                    run={() => void runConnection()}
                  />
                )}
                {tab === "tools" && (
                  <ToolsView
                    simple={experience === "easy"}
                    tools={tools}
                    busy={!!busy || archived}
                    refresh={() => void refresh()}
                    smart={() => setTab("smart")}
                    connection={() => setTab("connection")}
                    acquisition={() => openPanel("acquisition")}
                    images={() => openPanel("image")}
                  />
                )}
                {tab === "activity" && (
                  <CommandTiming
                    simple={experience === "easy"}
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
                <h1>Select a device</h1>
                <p>
                  Choose a source from the sidebar to inspect its metadata,
                  partitions and original tool output.
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
              <div className="empty-capabilities" hidden>
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
        onExpand={() => setTerminalCompact(false)}
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
          <span>DRC {version}</span>
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
                  Copying requires unmounted source volumes. On macOS, source
                  preparation can unmount them after your explicit selection;
                  the OS may flush pending writes during that step. macOS holds a
                  Disk Arbitration mount veto; Linux holds an exclusive
                  read-only block-device handle during the operation. DRC does
                  not block all writes from other applications. Hardware
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
      {workspaceOpen && (
        <WorkspacePanel
          title="Storage workspace"
          subtitle={
            archived
              ? "Recorded session snapshot"
              : "Connected disks and host observations"
          }
          close={closeWorkspace}
          wide
          className="readings-modal"
        >
          <StorageOverview
            simple={experience === "easy"}
            snapshot={snapshot}
            disabled={!!busy || !native || archived}
            refresh={() => void refresh()}
            openDevice={(id) => {
              setObservationSelection(null);
              setSelection(id);
              selectionRef.current = id;
              openPanel("device");
              setTab("device");
            }}
            openObservation={(id) => {
              setSelection(null);
              selectionRef.current = null;
              setObservationSelection(id);
              openPanel(null);
            }}
            images={() => openPanel("image")}
            acquire={() => openPanel("acquisition")}
          />
        </WorkspacePanel>
      )}
      {sessionOpen && (
        <SessionPanel
          simple={experience === "easy"}
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
          device={recoverySource ?? device}
          devices={snapshot?.devices ?? []}
          refresh={() => void refresh()}
          preferPhysical={!!recoverySource}
          simple={experience === "easy"}
          platform={
            snapshot?.platform ??
            (tools.some((t) => t.key === "lsblk") ? "Linux" : "macOS")
          }
          jobs={jobs}
          busy={!!busy && !acquiringRef.current}
          close={closeAcquisition}
          started={updateJob}
        />
      )}
      {recoveryOpen && (
        <RecoveryPanel
          run={recoveryRun}
          running={recoveryRunning}
          stopping={recoveryStopping}
          historical={archived}
          initialKey={
            observedSelection
              ? `observation:${observedSelection.id}`
              : device?.internal === false
                ? `device:${device.token}`
                : null
          }
          platform={snapshot?.platform ?? "macOS"}
          close={closeRecovery}
          start={startRecovery}
          stop={() => {
            setRecoveryStopping(
              "Cancellation requested. Waiting for the current command to exit; no later check will start.",
            );
            void bridge.stopRecoveryChecks();
          }}
          continueToImage={continueRecovery}
          showCommand={(id) => {
            setSelectedRecord(id);
            setTerminalMode("commands");
            setTerminalCompact(false);
          }}
        />
      )}
      {evidenceOpen && (
        <HostEvidence
          kernelAllowed={!archived}
          collectReport={collectHostEvidence}
          reports={hostEvidence}
          disabled={!!busy || archived}
          close={closeEvidence}
          onReport={(report) =>
            setHostEvidence((items) => [...items, report as unknown as Json])
          }
        />
      )}
      {referenceOpen && (
        <CheatSheet
          simple={experience === "easy"}
          platform={
            snapshot?.platform ??
            (tools.some((t) => t.key === "lsblk") ? "Linux" : "macOS")
          }
          close={closeReference}
          copy={(text) => navigator.clipboard.writeText(text)}
        />
      )}
      {easyReading && (
        <WorkspacePanel
          title={
            easyReading === "smart"
              ? "Reported SMART / NVMe readings"
              : experience === "easy"
                ? "Connections"
                : "Port map"
          }
          subtitle="Original device and host observations."
          close={closeEasyReading}
          wide
          className="readings-modal"
        >
          {easyReading === "smart" && device ? (
            <SmartView
              simple={experience === "easy"}
              device={device}
              result={smart[device.identityKey]}
              busy={!!busy || archived}
              run={(deviceType) => void runSmart(deviceType)}
            />
          ) : (
            <ConnectionView
              simple={experience === "easy"}
              platform={
                snapshot?.platform ??
                (tools.some((t) => t.key === "lsblk") ? "Linux" : "macOS")
              }
              result={connection}
              busy={!!busy || archived}
              run={() => void runConnection()}
            />
          )}
        </WorkspacePanel>
      )}
      {imageOpen && (
        <ImagePanel
          simple={experience === "easy"}
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
