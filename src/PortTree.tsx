import { useMemo, useState } from "react";
import { portMeasurements, portTopology, type PortNode } from "./portTopology";
import { getField, timestamp } from "./data";
import { FieldTable } from "./FieldTable";
import { Icon } from "./Icon";
import type { Device, QueryResult } from "./types";
function flattened(nodes: PortNode[]):PortNode[]{return nodes.flatMap(n=>[n,...flattened(n.children)]);}
export function PortTree({ report, devices }:{report:QueryResult;devices:Device[]}) {
  const roots=useMemo(()=>portTopology(report.fields,devices),[report,devices]);
  const all=useMemo(()=>flattened(roots),[roots]);
  const [selected,setSelected]=useState<string|null>(null);
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const node=all.find(n=>n.id===selected) ?? all.find(n=>n.fields!==null) ?? roots[0];
  function draw(nodes:PortNode[]){return <ul>{nodes.map(n=>{const open=!collapsed.has(n.id);return <li key={n.id}><div className={`port-node ${node?.id===n.id?'selected':''}`}>
    <button className="port-expand" disabled={!n.children.length} aria-label={`${open?'Collapse':'Expand'} ${n.label}`} aria-expanded={n.children.length?open:undefined} onClick={()=>setCollapsed(s=>{const next=new Set(s);if(open)next.add(n.id);else next.delete(n.id);return next;})}><Icon name={n.children.length?open?'chevronDown':'chevron':'grid'} size={13}/></button>
    <button className="port-select" onClick={()=>setSelected(n.id)} aria-pressed={node?.id===n.id} data-hint={`Inspect ${n.label}. This node and its parent relationship come from ${n.source}.`}><span className="port-node-icon"><Icon name={n.diskIds.length?'drive':n.children.length?'hub':'usb'} size={19}/></span><span><strong>{n.label}</strong><small>{n.kind}</small></span>{n.diskIds.length>0&&<code>{n.diskIds.join(', ')}</code>}</button>
  </div>{open&&!!n.children.length&&draw(n.children)}</li>;})}</ul>;}
  return <section className="port-map">
    <div className="port-map-heading"><div><h3 data-hint="The hierarchy the host reported. Hubs, bridges, ports and storage identifiers retain their original parent relationships.">Ports & enclosures</h3><p>{all.length} reported nodes · {timestamp(report.record.startedAt)} · snapshot</p></div><span className="small-tag">HOST OBSERVATIONS</span></div>
    <div className="port-map-layout"><nav className="port-tree" aria-label="Reported port hierarchy">{roots.length?draw(roots):<p>No hierarchy returned. Inspect the original output below.</p>}</nav>
      <div className="port-inspector">{node&&<><span className="eyebrow">SELECTED NODE</span><h3>{node.label}</h3><p className="source-label">{node.kind} · {node.source}</p>
        <div className="port-readings">{portMeasurements(node).map(m=><article key={m.label} data-hint={m.hint}><span>{m.label}</span><strong>{m.value}</strong><code>{m.key??'No property returned'}</code></article>)}<article data-hint="No electrical telemetry hardware is connected to DRC. Registry power state and USB current budgets do not measure current inside the enclosure."><span>Actual current / voltage</span><strong>Not measured</strong><code>Requires a telemetry instrument</code></article><article data-hint="Only a block-device ID explicitly reported here or a canonical sysfs parent path is associated with a disk. Matching model names alone is insufficient."><span>Storage identifier</span><strong>{node.diskIds.length?node.diskIds.map(id=>`/dev/${id}`).join(', '):'Not reported at this node'}</strong></article></div>
        <div className="inline-note"><Icon name="info"/><span>An enumerated enclosure reports its bridge. Its power budget or visible USB node does not prove that power reaches the SSD, that its controller responds, or that sectors are readable. Child media appear only when the host reports them.</span></div>
        {node.fields!==null&&<details className="port-properties"><summary>All properties of this node</summary><FieldTable value={node.fields} source={node.source} title="Original node properties"/></details>}
      </>}</div></div>
    {getField(getField(report.fields,"IORegistryUSBReport"),"parseError")&&<p className="error-box">USB registry: {String(getField(getField(report.fields,"IORegistryUSBReport"),"parseError"))}. Original command output is retained.</p>}
  </section>;
}
