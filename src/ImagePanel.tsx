import { useCallback, useEffect, useState } from "react";
import { bridge, native } from "./bridge";
import { ModeDetails } from "./ModeDetails";
import { ExtractionPanel } from "./ExtractionPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { FieldTable } from "./FieldTable";
import { ByteValue } from "./ByteValue";
import { commandLine, timestamp } from "./data";
import type {
  ExtractionJob,
  ImageAction,
  ImageFileEntry,
  ImageGeometry,
  ImageReport,
  ImageSource,
  Json,
} from "./types";

const initial: ImageGeometry = {
  sectorSize: 512,
  offsetSectors: "0",
  filesystem: null,
  utc: true,
};
const filesystems = [
  "ntfs",
  "fat",
  "fat12",
  "fat16",
  "fat32",
  "exfat",
  "ext",
  "ext2",
  "ext3",
  "ext4",
  "hfs",
  "hfsp",
  "hfsl",
  "apfs",
  "ufs",
  "ufs1",
  "ufs2",
  "iso9660",
  "yaffs2",
];
export function isImageReport(value: Json): value is Json & ImageReport {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const r = value as unknown as ImageReport;
  return (
    typeof r.id === "string" &&
    typeof r.source?.path === "string" &&
    typeof r.source.token === "string" &&
    ["directory", "partitions", "filesystem", "metadata"].includes(
      r.request?.action,
    ) &&
    typeof r.request.geometry?.offsetSectors === "string" &&
    typeof r.request.geometry.sectorSize === "number" &&
    (r.request.geometry.filesystem === null ||
      typeof r.request.geometry.filesystem === "string") &&
    typeof r.request.entries === "string" &&
    typeof r.record?.stdout === "string" &&
    typeof r.record.stderr === "string" &&
    typeof r.record.program === "string" &&
    Array.isArray(r.record.arguments) &&
    r.record.arguments.every((a) => typeof a === "string") &&
    typeof r.record.startedAt === "number" &&
    (r.record.exitCode === null || typeof r.record.exitCode === "number") &&
    (r.record.launchError === null ||
      typeof r.record.launchError === "string") &&
    Array.isArray(r.files) &&
    r.files.every(
      (f) =>
        f &&
        [f.name, f.inode, f.kind, f.size].every((v) => typeof v === "string"),
    ) &&
    Array.isArray(r.partitions) &&
    r.partitions.every(
      (p) =>
        p &&
        [p.row, p.slot, p.start, p.length, p.description].every(
          (v) => typeof v === "string",
        ),
    ) &&
    Array.isArray(r.warnings) &&
    r.warnings.every((w) => typeof w === "string") &&
    Array.isArray(r.unparsedLines)
  );
}
export function ImagePanel({
  reports,
  disabled,
  close,
  onReport,
  jobs,
  onJob,
  simple = false,
}: {
  simple?: boolean;
  reports: Json[];
  jobs: ExtractionJob[];
  onJob: (job: ExtractionJob) => void;
  disabled: boolean;
  close: () => void;
  onReport: (report: ImageReport) => void;
}) {
  const [view, setView] = useState<"query" | "extractions">("query");
  const [checked, setChecked] = useState<number[]>([]);
  const validReports = reports.filter(isImageReport);
  const opaqueReports = reports.filter((r) => !isImageReport(r));
  const [path, setPath] = useState("");
  const [source, setSource] = useState<ImageSource | null>(null);
  const [sourceSetupOpen, setSourceSetupOpen] = useState(false);
  const [geometry, setGeometry] = useState(initial);
  const [entries, setEntries] = useState("all");
  const [report, setReport] = useState<ImageReport | null>(null);
  const [selected, setSelected] = useState<ImageFileEntry | null>(null);
  const [stack, setStack] = useState<{ inode: string; name: string }[]>([]);
  const [inode, setInode] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState("all");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismiss = useCallback(() => {
    void bridge.closeImage();
    close();
  }, [close]);
  useEffect(
    () => () => {
      void bridge.closeImage();
    },
    [],
  );
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
  async function read(
    action: ImageAction,
    address: string | null = null,
    nextStack = stack,
  ) {
    if (!source) return;
    const result = await bridge.readImage({
      token: source.token,
      action,
      geometry,
      inode: address,
      entries,
    });
    setReport(result);
    setChecked([]);
    setView("query");
    setSelected(null);
    onReport(result);
    if (action === "directory" && result.record.exitCode === 0)
      setStack(nextStack);
  }
  function changeGeometry(next: ImageGeometry) {
    setGeometry(next);
    setReport(null);
    setChecked([]);
    setSelected(null);
    setStack([]);
  }
  const historical = report && report.source.token !== source?.token;
  const blocked = working || disabled;
  const listedFiles = (report?.files ?? [])
    .map((file, index) => ({ file, index }))
    .filter(
      ({ file }) =>
        file.name.toLowerCase().includes(fileQuery.toLowerCase()) &&
        (entryFilter === "all" ||
          (entryFilter === "deleted" ? file.deleted : !file.deleted)),
    );
  const queryContext = report && (
    <ModeDetails simple={simple} title="Source and query settings">
      <code className="artifact-path">{report.source.path}</code>
      <p className="source-label">
        Sector size {report.request.geometry.sectorSize} bytes · filesystem
        offset {report.request.geometry.offsetSectors} sectors · reader{" "}
        {report.request.geometry.filesystem ?? "auto"} ·{" "}
        {report.request.geometry.utc ? "UTC" : "host timezone"}
      </p>
      <p className="source-label">
        The selected timezone controls reader formatting. FAT local timestamps
        do not record the original timezone.
      </p>
    </ModeDetails>
  );
  return (
    <WorkspacePanel
      title={simple ? "Browse disk image" : "Image workspace"}
      subtitle="Inspect partitions and recover files from a read-only image."
      close={dismiss}
      wide
      className={simple ? "simple-image" : ""}
    >
      {simple && (
        <ol className="workflow-steps" aria-label="Image recovery steps">
          <li data-current={!source}>
            1 <span>Open image</span>
          </li>
          <li data-current={!!source && report?.request.action !== "directory"}>
            2 <span>Choose partition or browse files</span>
          </li>
          <li data-current={report?.request.action === "directory"}>
            3 <span>Select files and save copies</span>
          </li>
        </ol>
      )}
      {simple && source && (
        <div className="image-source-strip">
          <Icon name="file" size={20} />
          <div data-hint={source.path}>
            <strong>{source.path.split("/").at(-1)}</strong>
            <small>
              <ByteValue value={source.identity.size} /> · Read-only image ·
              offset {geometry.offsetSectors} sectors
            </small>
          </div>
          <button
            className="button"
            disabled={blocked}
            onClick={() => void action(() => read("partitions"))}
          >
            Read partitions
          </button>
          <button
            className="button"
            disabled={blocked}
            onClick={() => void action(() => read("directory", null, []))}
          >
            Browse files
          </button>
          <button
            className="button"
            aria-expanded={sourceSetupOpen}
            onClick={() => setSourceSetupOpen((value) => !value)}
          >
            Image settings
          </button>
        </div>
      )}
      <div className="image-layout">
        <section
          className="image-setup"
          hidden={simple && !!source && !sourceSetupOpen}
        >
          <div className="section-heading">
            <h3>{simple ? "Image file" : "Read-only image source"}</h3>
            <span className="small-tag">NO MOUNT</span>
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="image-open-controls">
            <div className="form-field">
              <label htmlFor="image-source-path">Source image</label>
              <div className="path-field">
                <input
                  id="image-source-path"
                  value={path}
                  disabled={blocked}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="Absolute path to one raw image file"
                />
                <button
                  className="button"
                  disabled={blocked}
                  onClick={() =>
                    void action(async () => {
                      const picked = await bridge.pick("sourceImage");
                      if (picked) setPath(picked);
                    })
                  }
                >
                  Choose…
                </button>
              </div>
            </div>
            <button
              className="button primary"
              disabled={!native || blocked || !path}
              onClick={() =>
                void action(async () => {
                  const next = await bridge.openImage(path);
                  setSource(next);
                  setReport(null);
                  setSelected(null);
                  setStack([]);
                  setSourceSetupOpen(false);
                })
              }
            >
              <Icon name="file" />
              Open image
            </button>
          </div>
          {source && (
            <div className="review-fact">
              <code>{source.path}</code>
              <span>
                <ByteValue value={source.identity.size} />
              </span>
              <span>
                Opened {timestamp(source.openedAt)} · source handle read only
              </span>
            </div>
          )}
          <p className="panel-description">
            The image stays read-only and unmounted. Open it, then choose a
            partition or directory query.
          </p>
          <ModeDetails
            simple={simple}
            title={`Reader settings · ${geometry.sectorSize} B sectors · offset ${geometry.offsetSectors}`}
            hint="Sector geometry, filesystem reader and directory options. Changing a value invalidates the current result."
          >
            <div className="form-grid">
              <div className="form-field">
                <span>Logical sector size · bytes</span>
                <Select
                  label="Image logical sector size"
                  value={String(geometry.sectorSize)}
                  disabled={blocked}
                  options={[512, 1024, 2048, 4096].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                  onChange={(value) =>
                    changeGeometry({ ...geometry, sectorSize: Number(value) })
                  }
                />
              </div>
              <label className="form-field">
                Image offset · sectors
                <input
                  inputMode="numeric"
                  value={geometry.offsetSectors}
                  disabled={blocked}
                  onChange={(e) =>
                    changeGeometry({
                      ...geometry,
                      offsetSectors: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="form-field">
              <span>Filesystem reader</span>
              <Select
                label="Image filesystem reader"
                value={geometry.filesystem ?? "auto"}
                disabled={blocked}
                options={[
                  { value: "auto", label: "Auto · tool detection" },
                  ...filesystems.map((f) => ({ value: f, label: f })),
                ]}
                onChange={(value) =>
                  changeGeometry({
                    ...geometry,
                    filesystem: value === "auto" ? null : value,
                  })
                }
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <span>Timestamp interpretation</span>
                <Select
                  label="Image timestamp interpretation"
                  value={geometry.utc ? "utc" : "host"}
                  disabled={blocked}
                  options={[
                    { value: "utc", label: "UTC" },
                    { value: "host", label: "Host timezone" },
                  ]}
                  onChange={(v) =>
                    changeGeometry({ ...geometry, utc: v === "utc" })
                  }
                />
              </div>
              <div className="form-field">
                <span>Directory entries</span>
                <Select
                  label="Directory entries to list"
                  value={entries}
                  disabled={blocked}
                  options={[
                    { value: "all", label: "Allocated + deleted" },
                    { value: "allocated", label: "Allocated only" },
                    { value: "deleted", label: "Deleted only" },
                  ]}
                  onChange={(value) => {
                    setEntries(value);
                    setReport(null);
                    setSelected(null);
                  }}
                />
              </div>
            </div>
          </ModeDetails>
          <div className="panel-actions image-query-actions">
            <button
              className="button"
              disabled={!source || blocked}
              onClick={() => void action(() => read("partitions"))}
            >
              <Icon name="partitions" />
              {simple ? "Read partitions" : "Partition table"}
            </button>
            <button
              className="button"
              disabled={!source || blocked}
              onClick={() => void action(() => read("filesystem"))}
            >
              Filesystem report
            </button>
            <button
              className="button"
              disabled={!source || blocked}
              onClick={() => void action(() => read("directory", null, []))}
            >
              {simple ? "Browse files" : "Browse root"}
            </button>
          </div>
          <ModeDetails simple={simple} title="Inspect a metadata address">
            <label className="form-field">
              Metadata address · optional NTFS type / stream ID
              <input
                value={inode}
                disabled={blocked}
                onChange={(e) => setInode(e.target.value)}
                placeholder="e.g. 42 or 42-128-1"
              />
            </label>
            <button
              className="button"
              disabled={!source || blocked || !inode}
              onClick={() => void action(() => read("metadata", inode))}
            >
              Inspect metadata address
            </button>
          </ModeDetails>
          <p className="source-label">
            Set the image offset in Reader settings when opening a partition
            inside a full-disk image.
          </p>
          <details className="measurement-source">
            <summary>Saved image queries · {reports.length}</summary>
            <div className="saved-image-queries">
              {[...validReports].reverse().map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setReport(r);
                    setChecked([]);
                    setView("query");
                    setSelected(null);
                  }}
                >
                  <span>
                    {r.request.action} · {timestamp(r.record.startedAt)}
                  </span>
                  <code>{r.source.path}</code>
                </button>
              ))}
              {opaqueReports.map((r, i) => (
                <details key={`opaque-${i}`} className="measurement-source">
                  <summary>
                    Unrecognized imported image report · {i + 1}
                  </summary>
                  <FieldTable
                    title="Imported fields"
                    source="Original imported report · no reader actions are attached"
                    value={r}
                  />
                </details>
              ))}
            </div>
          </details>
        </section>
        <section className="image-results">
          <div
            className="image-view-tabs"
            role="group"
            aria-label="Image workspace view"
          >
            <button
              aria-pressed={view === "query"}
              onClick={() => setView("query")}
            >
              {simple ? "Files and partitions" : "Query results"}
            </button>
            <button
              aria-pressed={view === "extractions"}
              onClick={() => setView("extractions")}
            >
              {simple ? "Save selected files" : "File extractions"}{" "}
              <span>{jobs.length}</span>
            </button>
          </div>
          {view === "extractions" ? (
            <ExtractionPanel
              simple={simple}
              reportId={
                report && !historical && report.request.action === "directory"
                  ? report.id
                  : null
              }
              indices={checked}
              jobs={jobs}
              disabled={blocked}
              onJob={onJob}
              clearSelection={() => setChecked([])}
            />
          ) : !report ? (
            <div className="empty-state">
              <Icon name="file" size={30} />
              <h3>
                {simple
                  ? source
                    ? "Choose what to read"
                    : "Open a disk image to browse its files"
                  : "Choose an image query"}
              </h3>
              <p>
                Reported partition fields, file entries and original tool output
                appear here.
              </p>
              {simple && source && (
                <div className="image-start-actions">
                  <button
                    className="connection-card"
                    disabled={blocked}
                    onClick={() => void action(() => read("partitions"))}
                  >
                    <Icon name="partitions" />
                    <span>
                      <strong>Find partitions</strong>
                      <small>
                        Read the partition table of a full-disk image
                      </small>
                    </span>
                    <Icon name="chevron" size={12} />
                  </button>
                  <button
                    className="connection-card"
                    disabled={blocked}
                    onClick={() =>
                      void action(() => read("directory", null, []))
                    }
                  >
                    <Icon name="folder" />
                    <span>
                      <strong>Browse files</strong>
                      <small>Read the filesystem at the selected offset</small>
                    </span>
                    <Icon name="chevron" size={12} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="section-heading">
                <h3>
                  {
                    {
                      partitions: "Partition table",
                      filesystem: "Filesystem report",
                      directory: "Directory entries",
                      metadata: "Metadata report",
                    }[report.request.action]
                  }
                </h3>
                <span className="count-tag">
                  Exit {report.record.exitCode ?? "not available"}
                </span>
              </div>
              {!simple && queryContext}
              {historical && (
                <div className="inline-note">
                  <Icon name="clock" />
                  Saved query. Open the source and run a fresh query to browse
                  or copy from it.
                </div>
              )}
              {report.warnings.map((w, i) => (
                <div className="inline-note" key={i}>
                  <Icon name="info" />
                  {w}
                </div>
              ))}
              {report.record.timedOut && (
                <div className="error-box">
                  The query reached its 30-second process limit. Any returned
                  output is retained.
                </div>
              )}
              {report.record.launchError && (
                <div className="error-box">{report.record.launchError}</div>
              )}
              {report.record.exitCode !== null &&
                report.record.exitCode !== 0 && (
                  <div className="error-box" role="alert">
                    Query exited with code {report.record.exitCode}.
                    {report.record.stderr && <pre>{report.record.stderr}</pre>}
                  </div>
                )}
              {report.request.action === "partitions" && (
                <>
                  <div className="table-scroll">
                    <table className="image-table">
                      <thead>
                        <tr>
                          <th hidden={simple}>ROW / SLOT</th>
                          <th hidden={simple}>START · SECTORS</th>
                          <th>{simple ? "Size" : "LENGTH · SECTORS"}</th>
                          <th>DESCRIPTION</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {report.partitions.map((p) => (
                          <tr key={p.row}>
                            <td hidden={simple}>
                              {p.row} / {p.slot}
                            </td>
                            <td hidden={simple}>{p.start}</td>
                            <td>
                              {simple &&
                              report.fields &&
                              typeof report.fields === "object" &&
                              !Array.isArray(report.fields) &&
                              typeof report.fields.blockSize === "string" &&
                              /^\d+$/.test(report.fields.blockSize) &&
                              /^\d+$/.test(p.length) ? (
                                <ByteValue
                                  value={(
                                    BigInt(p.length) *
                                    BigInt(report.fields.blockSize)
                                  ).toString()}
                                />
                              ) : (
                                p.length
                              )}
                            </td>
                            <td>{p.description}</td>
                            <td>
                              <button
                                className="button subtle"
                                disabled={blocked || !!historical}
                                onClick={() => {
                                  const block =
                                    report.fields &&
                                    !Array.isArray(report.fields) &&
                                    typeof report.fields === "object"
                                      ? report.fields.blockSize
                                      : null;
                                  const base =
                                    report.fields &&
                                    !Array.isArray(report.fields) &&
                                    typeof report.fields === "object"
                                      ? report.fields.offsetBytes
                                      : null;
                                  if (
                                    typeof block !== "string" ||
                                    !["512", "1024", "2048", "4096"].includes(
                                      block,
                                    ) ||
                                    typeof base !== "string" ||
                                    !/^\d+$/.test(base) ||
                                    !/^\d+$/.test(p.start) ||
                                    BigInt(base) % BigInt(block) !== 0n
                                  ) {
                                    setError(
                                      "The volume-system byte offset or sector size cannot be represented as this reader's geometry. Inspect the original fields.",
                                    );
                                    return;
                                  }
                                  changeGeometry({
                                    ...geometry,
                                    sectorSize: Number(block),
                                    offsetSectors: (
                                      BigInt(base) / BigInt(block) +
                                      BigInt(p.start)
                                    ).toString(),
                                  });
                                }}
                              >
                                {simple ? "Select partition" : "Use offset"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.fields && (
                    <ModeDetails
                      simple={simple}
                      title="Original partition fields"
                    >
                      <FieldTable
                        title="Volume-system fields"
                        source="The Sleuth Kit volume API · exact source fields, including flags and table metadata"
                        value={report.fields}
                      />
                    </ModeDetails>
                  )}
                </>
              )}
              {report.request.action === "directory" && (
                <>
                  <div className="image-breadcrumbs">
                    <button
                      disabled={blocked || !!historical}
                      onClick={() =>
                        void action(() => read("directory", null, []))
                      }
                    >
                      Root
                    </button>
                    {stack.map((part, i) => (
                      <button
                        key={`${part.inode}:${i}`}
                        disabled={blocked || !!historical}
                        onClick={() =>
                          void action(() =>
                            read(
                              "directory",
                              part.inode,
                              stack.slice(0, i + 1),
                            ),
                          )
                        }
                      >
                        {" "}
                        / {part.name} [{part.inode}]
                      </button>
                    ))}
                  </div>
                  <p className="source-label">
                    {listedFiles.length} of {report.files.length} listed entries
                    · {report.unparsedLines.length} unparsed source lines ·
                    query: {report.request.entries}
                  </p>
                  <div className="file-browser-toolbar">
                    <label className="search">
                      <Icon name="search" />
                      <input
                        aria-label="Find a listed file"
                        placeholder="Find a listed file…"
                        value={fileQuery}
                        onChange={(e) => setFileQuery(e.target.value)}
                      />
                    </label>
                    <Select
                      label="Filter listed files"
                      value={entryFilter}
                      onChange={setEntryFilter}
                      options={[
                        { value: "all", label: "All listed entries" },
                        { value: "deleted", label: "Deleted entries" },
                        { value: "allocated", label: "Allocated entries" },
                      ]}
                    />
                  </div>
                  <div className="panel-actions">
                    <button
                      className="button subtle"
                      disabled={blocked || !!historical}
                      onClick={() =>
                        setChecked(
                          listedFiles
                            .map(({ file, index }) =>
                              ["d", "V"].includes(file.kind[0]) ? -1 : index,
                            )
                            .filter((i) => i >= 0)
                            .slice(0, 1000),
                        )
                      }
                    >
                      Select listed files
                    </button>
                    <button
                      className="button subtle"
                      disabled={!checked.length || blocked}
                      onClick={() => setChecked([])}
                    >
                      Clear selection
                    </button>
                    <button
                      className="button primary"
                      disabled={blocked || !!historical || !checked.length}
                      onClick={() => setView("extractions")}
                    >
                      {simple ? "Save selected files" : "Extract selected"} ·{" "}
                      {checked.length}
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table className="image-table file-browser">
                      <thead>
                        <tr>
                          <th>
                            <span className="sr-only">Select entry</span>
                          </th>
                          <th>NAME</th>
                          <th hidden={simple}>ADDRESS</th>
                          <th hidden={simple}>TYPE</th>
                          <th>{simple ? "Status" : "DELETED"}</th>
                          <th>SIZE</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {listedFiles.map(({ file, index: i }) => (
                          <tr key={i} data-selected={selected === file}>
                            <td>
                              {!["d", "V"].includes(file.kind[0]) && (
                                <input
                                  className="entry-checkbox"
                                  type="checkbox"
                                  aria-label={`Select ${file.name || file.inode} for extraction`}
                                  checked={checked.includes(i)}
                                  disabled={
                                    blocked ||
                                    !!historical ||
                                    (!checked.includes(i) &&
                                      checked.length >= 1000)
                                  }
                                  onChange={(e) =>
                                    setChecked((previous) =>
                                      e.target.checked
                                        ? [...previous, i]
                                        : previous.filter(
                                            (index) => index !== i,
                                          ),
                                    )
                                  }
                                />
                              )}
                            </td>
                            <td>
                              <button
                                className="file-name"
                                onClick={() => {
                                  if (
                                    simple &&
                                    ["d", "V"].includes(file.kind[0]) &&
                                    !blocked &&
                                    !historical
                                  )
                                    void action(() =>
                                      read("directory", file.inode, [
                                        ...stack,
                                        { inode: file.inode, name: file.name },
                                      ]),
                                    );
                                  else setSelected(file);
                                }}
                              >
                                {simple && (
                                  <Icon
                                    name={
                                      ["d", "V"].includes(file.kind[0])
                                        ? "folder"
                                        : "file"
                                    }
                                    size={16}
                                  />
                                )}
                                {file.name || '""'}
                              </button>
                            </td>
                            <td hidden={simple}>{file.inode}</td>
                            <td hidden={simple}>{file.kind}</td>
                            <td>
                              {simple
                                ? file.deleted
                                  ? "Deleted"
                                  : "Allocated"
                                : String(file.deleted)}
                            </td>
                            <td>
                              <ByteValue value={file.size} />
                            </td>
                            <td>
                              {!simple && ["d", "V"].includes(file.kind[0]) && (
                                <button
                                  className="button subtle"
                                  disabled={blocked || !!historical}
                                  onClick={() =>
                                    void action(() =>
                                      read("directory", file.inode, [
                                        ...stack,
                                        { inode: file.inode, name: file.name },
                                      ]),
                                    )
                                  }
                                >
                                  Browse
                                </button>
                              )}
                              <button
                                className="button subtle"
                                disabled={blocked || !!historical}
                                onClick={() =>
                                  simple
                                    ? setSelected(file)
                                    : void action(() =>
                                        read("metadata", file.inode),
                                      )
                                }
                              >
                                {simple ? "Details" : "Metadata"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selected && (
                    <section className="selected-file-inspector">
                      <div className="section-heading">
                        <h3>{selected.name}</h3>
                        <button
                          className="text-button"
                          onClick={() => setSelected(null)}
                        >
                          Close details
                        </button>
                      </div>
                      <dl className="reading-summary">
                        <div>
                          <dt>Type</dt>
                          <dd>
                            {["d", "V"].includes(selected.kind[0])
                              ? "Directory"
                              : "File"}
                          </dd>
                        </div>
                        <div>
                          <dt>Size</dt>
                          <dd>
                            <ByteValue value={selected.size} />
                          </dd>
                        </div>
                        <div>
                          <dt>Allocation</dt>
                          <dd>
                            {selected.deleted
                              ? "Deleted entry"
                              : "Allocated entry"}
                          </dd>
                        </div>
                      </dl>
                      <ModeDetails simple={simple} title="Original file fields">
                        <FieldTable
                          title="Selected entry fields"
                          source="Original fls values; timestamps and flags are retained without normalization"
                          value={selected as unknown as Json}
                        />
                      </ModeDetails>
                      <button
                        className="button"
                        disabled={blocked || !!historical}
                        onClick={() =>
                          void action(() => read("metadata", selected.inode))
                        }
                      >
                        Read filesystem metadata
                      </button>
                    </section>
                  )}
                </>
              )}
              {report.request.action !== "directory" &&
                report.request.action !== "partitions" && (
                  <pre className="image-tool-output" tabIndex={0}>
                    {report.record.stdout || "No stdout was returned."}
                  </pre>
                )}
              <ModeDetails
                simple={simple}
                title="Original command and full output"
              >
                <code className="artifact-path">
                  {commandLine(report.record)}
                </code>
                <pre className="image-tool-output" tabIndex={0}>
                  {report.record.stdout}
                </pre>
                {report.record.stderr && (
                  <>
                    <span className="eyebrow">STDERR</span>
                    <pre className="image-tool-output" tabIndex={0}>
                      {report.record.stderr}
                    </pre>
                  </>
                )}
              </ModeDetails>
              <ModeDetails simple={simple} title="Saved report fields">
                <FieldTable
                  title="Complete image report"
                  source="All fields, including any imported additions"
                  value={report as unknown as Json}
                />
              </ModeDetails>
              <ModeDetails
                simple={simple}
                title="Source identity and exact query inputs"
              >
                <FieldTable
                  title="Image source and query"
                  source="Recorded source descriptor and explicit parameters"
                  value={
                    {
                      source: report.source,
                      request: report.request,
                    } as unknown as Json
                  }
                />
              </ModeDetails>
              {simple && queryContext}
            </>
          )}
        </section>
      </div>
    </WorkspacePanel>
  );
}
