import { Icon } from "./Icon";
import { humanBytes, getField, displayValue, timestamp } from "./data";
import { PartitionChart } from "./PartitionChart";
import { AcquisitionCharts } from "./AcquisitionCharts";
import type { AcquisitionJob, Device, QueryResult, ToolReport } from "./types";

export function EasyWorkspace({ device, smart, jobs, tools, disabled, inspect, connections, acquire, images, details, reference }: {
  device?: Device; smart?: QueryResult; jobs: AcquisitionJob[]; tools: ToolReport[];
  disabled: boolean; inspect: () => void; connections: () => void; acquire: () => void;
  images: () => void; details: () => void; reference: () => void;
}) {
  const job = jobs.find(j => ["running", "pausing"].includes(j.state)) ?? jobs[0];
  const passed = getField(getField(smart?.fields ?? null, "smart_status"), "passed");
  const temperature = getField(getField(smart?.fields ?? null, "temperature"), "current") ?? getField(getField(smart?.fields ?? null, "nvme_smart_health_information_log"), "temperature");
  const source = device?.info;
  const blockSize = getField(source, "DeviceBlockSize") ?? getField(source, "log-sec");
  const reader = tools.find(t => t.key === "drc-tsk");
  const copier = tools.find(t => t.key === "ddrescue");
  const smartTool = tools.find(t => t.key === "smartctl");
  return <div className="easy-workspace">
    <div className="easy-title"><div><span className="eyebrow">EASY WORKSPACE</span><h1>{device?.name ?? "Your recovery workspace"}</h1><p>{device ? `/dev/${device.id} · Last observed ${timestamp(device.observedAt)}` : "Select connected media, or work with an existing disk image."}</p></div><span className="easy-policy"><Icon name="shield" />Source read only</span></div>
    <div className="easy-stats">
      <article className="easy-stat"><span className="eyebrow">CONNECTION</span><strong>{device ? device.infoError ? "Metadata error" : "Observed" : "No selection"}</strong><span>{device?.protocol ?? "Transport not reported"}</span></article>
      <article className="easy-stat"><span className="eyebrow">REPORTED CAPACITY</span><strong>{humanBytes(device?.sizeBytes)}</strong><code>{device?.sizeBytes ? `${device.sizeBytes} bytes` : "No capacity reading"}</code></article>
      <article className="easy-stat"><span className="eyebrow">SMART · TOOL REPORTED</span><strong>{typeof passed === "boolean" ? passed ? "PASSED" : "FAILED" : smart ? "Not reported" : "Not queried"}</strong><span>{temperature !== undefined ? `${displayValue(temperature)} °C · tool reported` : "Temperature not reported"}</span></article>
      <article className="easy-stat"><span className="eyebrow">SOURCE ACCESS</span><strong>{device?.metadataOnly ? "Metadata only" : device?.internal === true || getField(getField(device?.info,"drcObservation"),"systemBacking") === true ? "System media" : "Read only"}</strong><span>{device ? `${device.partitions.length} listed entries · ${displayValue(blockSize)} bytes / block` : "DRC source handles are read only"}</span></article>
    </div>
    <div className="easy-section-heading"><div><span className="eyebrow">CHOOSE AN ACTION</span><h2>Inspect, copy, then explore</h2></div><button className="button" onClick={reference}><Icon name="file" />Command reference</button></div>
    <div className="easy-actions">
      <article><div className="easy-action-icon"><Icon name="chart" size={25}/></div><span className="eyebrow">01 / INSPECT</span><h3>Read reported measurements</h3><p>Request SMART / NVMe information and host connection metadata. Original fields stay available for your interpretation.</p><button className="button primary" disabled={disabled || !device || device.metadataOnly || !smartTool?.available} onClick={inspect}>Read SMART / NVMe <Icon name="arrow" /></button><button className="button" disabled={disabled} onClick={connections}>Connection details</button><small>{device?.metadataOnly ? "This medium permits discovery and metadata only." : !smartTool?.available ? "Install smartmontools from the command reference." : "On request only. No automatic self-test or surface scan."}</small></article>
      <article><div className="easy-action-icon"><Icon name="drive" size={25}/></div><span className="eyebrow">02 / COPY</span><h3>Create a raw disk image</h3><p>Choose a source and a destination folder. Review the exact command before copying. A mapfile records the unread ranges for a later resume.</p><button className="button primary" disabled={disabled || !copier?.available} onClick={acquire}>Create or resume an image <Icon name="arrow" /></button><small>{!copier?.available ? "GNU ddrescue is required. See installation in the reference." : "Default: full source range, copying phase, zero retries. Physical access requires OS permissions and an unmounted eligible source."}</small></article>
      <article><div className="easy-action-icon"><Icon name="file" size={25}/></div><span className="eyebrow">03 / EXPLORE</span><h3>Find files in an image</h3><p>Open an existing image, inspect its partition table and browse supported filesystems. Extract selected files into a new destination folder.</p><button className="button primary" disabled={disabled || !reader?.available} onClick={images}>Open an image <Icon name="arrow" /></button><small>{reader?.available ? "Image reads and extraction use the bundled Sleuth Kit adapter. Deleted entries may contain incomplete or overwritten data." : "The image adapter is unavailable in this installation."}</small></article>
    </div>
    {device && <div className="easy-observations"><PartitionChart device={device}/><button className="button" onClick={details}><Icon name="grid" />All readings and raw fields</button><p className="source-label">Observed metadata is a snapshot. A reported SMART result or a complete-sized image does not establish that every file is intact.</p></div>}
    {job && <section className="easy-job"><div className="easy-section-heading"><div><span className="eyebrow">LATEST ACQUISITION</span><h2>{job.state.replaceAll("_", " ")}</h2><code>{job.source.kind === "image" ? job.source.path : `/dev/${job.source.device.id}`}</code></div><button className="button" onClick={acquire}>Progress, pause and resume</button></div><div className="easy-job-counts"><div><span>Finished bytes · mapfile</span><strong>{humanBytes(job.map?.rescuedBytes)}</strong><code>{job.map?.rescuedBytes ?? "Not observed"}</code></div><div><span>Bad-sector bytes · mapfile</span><strong>{humanBytes(job.map?.badSectorBytes)}</strong><code>{job.map?.badSectorBytes ?? "Not observed"}</code></div><div><span>Image path</span><code>{job.imagePath}</code><small>Unread ranges remain in the mapfile; zero bad-sector bytes alone does not mean the image is complete.</small></div></div><AcquisitionCharts job={job}/></section>}
  </div>;
}
