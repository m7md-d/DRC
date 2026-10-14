export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

export interface CommandRecord {
  id: string;
  program: string;
  arguments: string[];
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutBase64: string;
  stderrBase64: string;
  stdoutUtf8Valid: boolean;
  stderrUtf8Valid: boolean;
  launchError: string | null;
  stdoutArtifact?: {
    path: string;
    bytes: string;
    sha256: string;
    identity: FileIdentity;
    operationId: string;
    entryIndex: number;
  } | null;
  terminationSignal?: number | null;
}

export interface Device {
  id: string;
  token: string;
  identityKey: string;
  name: string;
  sizeBytes: string | null;
  internal: boolean | null;
  protocol: string | null;
  content: string | null;
  partitions: Json[];
  info: Json;
  layout: Json;
  infoError: string | null;
  observedAt: number;
  metadataOnly: boolean;
  protectionReason: string | null;
}

export interface Discovery {
  devices: Device[];
  observedAt: number;
  platform: string;
  enumeration: Json;
  warnings: string[];
}

export interface QueryResult {
  record: CommandRecord;
  fields: Json | null;
  parseError: string | null;
}
export interface DeviceEvent {
  observedAt: number;
  line: string;
}
export interface ToolReport {
  key: string;
  name: string;
  path: string | null;
  available: boolean;
  implemented: boolean;
  purpose: string;
}
export type Tab =
  "device" | "partitions" | "smart" | "connection" | "activity" | "tools";

export interface SessionData {
  id: string;
  createdAt: number;
  updatedAt: number;
  snapshot: Discovery | null;
  commandRecords: CommandRecord[];
  connectionEvents: DeviceEvent[];
  smartReports: Record<string, QueryResult>;
  connectionReport: QueryResult | null;
  originalImport: string | null;
  imageReports?: Json[];
}

export interface ImageSource {
  token: string;
  path: string;
  identity: FileIdentity;
  openedAt: number;
}
export interface ImageGeometry {
  sectorSize: number;
  offsetSectors: string;
  filesystem: string | null;
  utc: boolean;
}
export type ImageAction =
  "partitions" | "filesystem" | "directory" | "metadata";
export interface ImageRequest {
  token: string;
  action: ImageAction;
  geometry: ImageGeometry;
  inode: string | null;
  entries: string;
}
export interface ImageFileEntry {
  inode: string;
  kind: string;
  name: string;
  deleted: boolean;
  prefix: string;
  modified: string;
  accessed: string;
  changed: string;
  created: string;
  size: string;
  uid: string;
  gid: string;
  originalLine: string;
}
export interface ImagePartitionEntry {
  row: string;
  slot: string;
  start: string;
  end: string;
  length: string;
  description: string;
  originalLine: string;
  fields: Json;
}
export interface ImageReport {
  id: string;
  source: ImageSource;
  request: ImageRequest;
  record: CommandRecord;
  files: ImageFileEntry[];
  partitions: ImagePartitionEntry[];
  unparsedLines: string[];
  warnings: string[];
  fields: Json | null;
}
export interface SessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  recordCount: number;
}
export interface FileIdentity {
  device: string;
  inode: string;
  size: string;
  modifiedSeconds: number;
  modifiedNanoseconds: number;
}
export type AcquisitionSource =
  | { kind: "image"; path: string; identity: FileIdentity }
  | { kind: "physical"; device: Device };
export interface AcquisitionSettings {
  offset: string;
  length: string | null;
  sectorSize: number;
  retryPasses: number;
  copyingOnly: boolean;
  timeoutSeconds: number;
  maxReadRate: string | null;
}
export interface AcquisitionRequest {
  kind: "image" | "physical";
  imagePath: string | null;
  deviceToken: string | null;
  destination: string;
  settings: AcquisitionSettings;
  resumeJob: string | null;
}
export interface AcquisitionPlan {
  ticket: string;
  expiresAt: number;
  source: AcquisitionSource;
  sourceSize: string;
  destinationDirectory: string;
  freeBytes: string;
  settings: AcquisitionSettings;
  program: string;
  arguments: string[];
  confirmation: string;
  resumeJob: string | null;
}
export interface MapSummary {
  rescuedBytes: string;
  nonTriedBytes: string;
  nonTrimmedBytes: string;
  nonScrapedBytes: string;
  badSectorBytes: string;
  domainBytes: string;
  blocks: { position: string; size: string; status: string }[];
}
export interface AcquisitionJob {
  id: string;
  source: AcquisitionSource;
  sourceSize: string;
  directory: string;
  imagePath: string;
  mapPath: string;
  stdoutPath: string;
  stderrPath: string;
  settings: AcquisitionSettings;
  state: string;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  message: string | null;
  map: MapSummary | null;
  attempts: number;
  toolVersion: string;
  rateReports?: RateReport[];
  progressReports?: ProgressReport[];
}

export interface ProgressSample {
  elapsedMs: string;
  observedAt: number;
  rescuedBytes: string;
  nonTriedBytes: string;
  nonTrimmedBytes: string;
  nonScrapedBytes: string;
  badSectorBytes: string;
  domainBytes: string;
}
export interface ProgressReport {
  attempt: number;
  startedAt: number;
  samples: ProgressSample[];
}

export interface RateSample {
  line: number;
  timeSeconds: string;
  inputPosition: string;
  currentRate: string;
  averageRate: string;
  badAreas: string;
  badBytes: string;
  values: string[];
  breakBefore: boolean;
}
export interface RateReport {
  attempt: number;
  startedAt: number;
  path: string;
  raw: string;
  rawBase64: string;
  utf8Valid: boolean;
  columns: string[];
  samples: RateSample[];
  warnings: string[];
  pendingLine: boolean;
}

export interface ExtractionItem {
  entry: ImageFileEntry;
  filename: string;
  maximumBytes: string;
  state: string;
  writtenBytes: string;
  record: CommandRecord | null;
}
export interface ExtractionPlan {
  ticket: string;
  expiresAt: number;
  source: ImageSource;
  request: ImageRequest;
  destination: string;
  destinationIdentity: FileIdentity;
  freeBytes: string;
  items: ExtractionItem[];
  confirmation: string;
}
export interface ExtractionJob {
  id: string;
  sessionId: string;
  source: ImageSource;
  request: ImageRequest;
  directory: string;
  directoryIdentity: FileIdentity;
  items: ExtractionItem[];
  state: string;
  createdAt: number;
  updatedAt: number;
  message: string | null;
}
export interface ArtifactPage {
  offset: string;
  totalBytes: string;
  bytesBase64: string;
}
