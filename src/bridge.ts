import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Discovery,
  ToolReport,
  QueryResult,
  CommandRecord,
  DeviceEvent,
  SessionData,
  SessionSummary,
  AcquisitionRequest,
  AcquisitionPlan,
  AcquisitionJob,
  ImageSource,
  ImageRequest,
  ImageReport,
  ExtractionPlan,
  ExtractionJob,
  ArtifactPage,
  RecoveryRun,
  RecoveryTarget,
  RecoveryOptions,
} from "./types";

export const native = isTauri();

export interface WindowPresentation {
  controlsSide: "left" | "right" | "none";
  fullscreen: boolean;
}

function request<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    return Promise.reject(
      new Error(
        "Live device access is available in the DRC desktop app. This browser preview contains no simulated devices.",
      ),
    );
  return invoke<T>(command, args);
}

export const bridge = {
  windowPresentation: () => request<WindowPresentation>("window_presentation"),
  recoveryTargets: () => request<RecoveryTarget[]>("recovery_targets"),
  recoveryChecks: (targetKey: string, options: RecoveryOptions) =>
    request<RecoveryRun>("run_recovery_checks", { targetKey, options }),
  stopRecoveryChecks: () => request<void>("stop_recovery_checks"),
  hostEvidence: (kind: "topology" | "kernel") =>
    request<QueryResult>("read_host_evidence", { kind }),
  discover: () => request<Discovery>("discover_devices"),
  tools: () => request<ToolReport[]>("installed_tools"),
  smart: (token: string, deviceType = "auto") =>
    request<QueryResult>("read_smart", { request: { token, deviceType } }),
  connections: () => request<QueryResult>("read_connections"),
  startWatch: () => request<void>("start_device_watch"),
  stopWatch: () => request<void>("stop_device_watch"),
  currentSession: () => request<SessionData>("current_session"),
  sessions: () => request<SessionSummary[]>("list_sessions"),
  loadSession: (id: string) => request<SessionData>("load_session", { id }),
  newSession: () => request<SessionData>("new_session"),
  pick: (
    kind: "sourceImage" | "destination" | "importSession" | "exportSession",
  ) => request<string | null>("pick_path", { kind }),
  exportSession: (id: string, path: string) =>
    request<void>("export_session", { id, path }),
  importSession: (path: string) => request<string>("import_session", { path }),
  importSessionJson: (json: string) =>
    request<string>("import_session_json", { json }),
  prepareAcquisition: (requestValue: AcquisitionRequest) =>
    request<AcquisitionPlan>("prepare_acquisition", { request: requestValue }),
  cancelPlan: (ticket: string) =>
    request<void>("cancel_acquisition_plan", { ticket }),
  startAcquisition: (ticket: string, confirmation: string) =>
    request<AcquisitionJob>("start_acquisition", { ticket, confirmation }),
  pauseAcquisition: (id: string) => request<void>("pause_acquisition", { id }),
  acquisitions: () => request<AcquisitionJob[]>("list_acquisitions"),
  acquisitionMap: (id: string) => request<string>("acquisition_map", { id }),
  prepareExtraction: (
    reportId: string,
    indices: number[],
    destination: string,
  ) =>
    request<ExtractionPlan>("prepare_extraction", {
      reportId,
      indices,
      destination,
    }),
  cancelExtraction: (ticket: string) =>
    request<void>("cancel_extraction_plan", { ticket }),
  startExtraction: (ticket: string, confirmation: string) =>
    request<ExtractionJob>("start_extraction", { ticket, confirmation }),
  stopExtraction: (id: string) => request<void>("stop_extraction", { id }),
  extractions: () => request<ExtractionJob[]>("list_extractions"),
  extractionBytes: (
    id: string,
    index: number,
    offset: string,
    length: number,
  ) => request<ArtifactPage>("extraction_bytes", { id, index, offset, length }),
  openImage: (path: string) => request<ImageSource>("open_image", { path }),
  closeImage: () => request<void>("close_image"),
  readImage: (value: ImageRequest) =>
    request<ImageReport>("read_image", { request: value }),
};

export async function subscribe(handlers: {
  recovery?: (value: RecoveryRun) => void;
  discovery?: (value: Discovery) => void;
  connection?: (value: QueryResult) => void;
  command: (value: CommandRecord) => void;
  device: (value: DeviceEvent) => void;
  watchError: (value: string) => void;
  watchStopped: () => void;
  persistenceError: (value: string) => void;
  extraction: (value: ExtractionJob) => void;
  acquisition: (value: AcquisitionJob) => void;
  exitDeferred: (value: string) => void;
}): Promise<UnlistenFn> {
  if (!native) return () => {};
  const unlisten = await Promise.all([
    listen<RecoveryRun>("recovery-update", (event) =>
      handlers.recovery?.(event.payload),
    ),
    listen<Discovery>("live-discovery", (event) =>
      handlers.discovery?.(event.payload),
    ),
    listen<QueryResult>("live-connection", (event) =>
      handlers.connection?.(event.payload),
    ),
    listen<CommandRecord>("command-record", (event) =>
      handlers.command(event.payload),
    ),
    listen<DeviceEvent>("device-event", (event) =>
      handlers.device(event.payload),
    ),
    listen<string>("watch-error", (event) =>
      handlers.watchError(event.payload),
    ),
    listen("watch-stopped", handlers.watchStopped),
    listen<string>("persistence-error", (event) =>
      handlers.persistenceError(event.payload),
    ),
    listen<ExtractionJob>("extraction-update", (event) =>
      handlers.extraction(event.payload),
    ),
    listen<AcquisitionJob>("acquisition-update", (event) =>
      handlers.acquisition(event.payload),
    ),
    listen<string>("exit-deferred", (event) =>
      handlers.exitDeferred(event.payload),
    ),
  ]);
  return () => unlisten.forEach((stop) => stop());
}
