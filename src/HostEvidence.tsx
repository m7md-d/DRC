import { useState } from "react";
import { WorkspacePanel } from "./WorkspacePanel";
import { FieldTable } from "./FieldTable";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { getField, timestamp } from "./data";
import type { Json, QueryResult } from "./types";
export function HostEvidence({ reports, disabled, close, onReport, collectReport, kernelAllowed }: { kernelAllowed: boolean; reports: Json[]; disabled: boolean; close: () => void; onReport: (report: QueryResult) => void; collectReport: (kind: "topology" | "kernel") => Promise<QueryResult> }) {
  const [working,setWorking]=useState(false);
  const [chosen,setChosen]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const valid = reports.filter(v=>typeof getField(getField(v,"record"),"id") === "string");
  const result=valid.find(v=>getField(getField(v,"record"),"id") === chosen) ?? valid.at(-1);
  const record=getField(result,"record");
  async function collect(kind: "topology" | "kernel") {setWorking(true);setError(null);try {const report=await collectReport(kind);onReport(report);setChosen(report.record.id);}catch(e){setError(String(e));}finally{setWorking(false);}}
  return <WorkspacePanel title="Host evidence" subtitle="Linux controller and kernel observations." close={close} wide className="readings-modal">
    <div className="reference-note"><Icon name="info"/><span>When no disk appears, collect the available PCIe, NVMe-controller and kernel observations. These are host-wide reports, not an automatic association or diagnosis. Power metadata is not a current measurement.</span></div>
    <div className="panel-actions"><button className="button primary" disabled={disabled||working} onClick={()=>void collect("topology")}><Icon name="link"/>PCIe & NVMe controller state</button><button className="button" disabled={!kernelAllowed||working} onClick={()=>void collect("kernel")}><Icon name="terminal"/>Kernel messages</button></div>
    <p className="panel-description">No reset, firmware update, sanitize, format, namespace creation or power-state change is performed. Kernel-log access depends on system permissions; a denied query is preserved in raw output.</p>
    {working && <p role="status">Collecting host evidence…</p>}{error && <div className="error-box" role="alert">{error}</div>}
    {!!valid.length && <Select label="Saved host evidence" value={String(getField(record,"id"))} onChange={setChosen} options={valid.map(v=>{const r=getField(v,"record");return {value:String(getField(r,"id")),label:`${String(getField(r,"program"))} · ${timestamp(Number(getField(r,"startedAt")))}`};})}/>}
    {result ? <><p className="source-label">Reported exit: {String(getField(record,"exitCode"))} · Timed out: {String(getField(record,"timedOut"))}</p>{getField(result,"parseError") && <div className="error-box">Report parsing: {String(getField(result,"parseError"))}. Original stdout and stderr remain below.</div>}<FieldTable value={getField(result,"fields") ?? null} title="Original reported properties" source="sysfs bytes, controller attributes or dmesg JSON · exact numeric strings"/><details><summary>Raw stdout, stderr and command metadata</summary><FieldTable value={record ?? null} title="Original command record" source="Complete stored output and original bytes"/></details></> : <p className="source-label">No report collected. Collection is explicit and does not require a selectable disk.</p>}
  </WorkspacePanel>;
}
