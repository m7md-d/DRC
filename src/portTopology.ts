import { getField, displayValue } from "./data";
import type { Device, Json } from "./types";
export interface PortNode {
  id: string; label: string; kind: string; source: string; fields: Json; children: PortNode[]; diskIds: string[];
}
const text = (v: Json | undefined) => typeof v === "string" ? v.trim() : undefined;
const objects = (v: Json | undefined): Json[] => Array.isArray(v) ? v.filter(n => n !== null && typeof n === "object" && !Array.isArray(n)) : v && typeof v === "object" ? [v] : [];
function reportedIds(fields: Json): string[] {
  // Only explicit device identifiers, never model/serial heuristics.
  const ids = ["bsd_name", "BSD Name", "DeviceIdentifier", "kname"].map(k => text(getField(fields,k)));
  return [...new Set(ids.filter((id): id is string => !!id))];
}
function profiler(nodes: Json[], source: string, path: string, devices: Device[], kind = "Reported device"): PortNode[] {
  return nodes.map((fields,index) => {
    const id=`${path}/${index}`;
    const children=[...profiler(objects(getField(fields,"_items")),source,`${id}/items`,devices),...profiler(objects(getField(fields,"Media")),source,`${id}/media`,devices,"Reported media"),...profiler(objects(getField(fields,"volumes")),source,`${id}/volumes`,devices,"Reported volume")];
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      for (const [key,port] of Object.entries(fields)) if (/^receptacle_.*_tag$/.test(key) && port && typeof port === "object") {
        children.push({id:`${id}/${key}`,label:`Port ${text(getField(port,"receptacle_id_key")) ?? key}`,kind:"Reported port",source,fields:port,children:[],diskIds:reportedIds(port)});
      }
    }
    return {id,label:text(getField(fields,"_name")) ?? text(getField(fields,"device_name_key")) ?? kind,kind,source,fields,children,diskIds:reportedIds(fields)};
  });
}
function registry(nodes: Json[],path: string): PortNode[] {
  return nodes.map((fields,index)=>({id:`${path}/${index}`,label:text(getField(fields,"USB Product Name")) ?? text(getField(fields,"IORegistryEntryName")) ?? "Registry entry",kind:text(getField(fields,"IOObjectClass")) ?? "Registry entry",source:"IORegistry · IOUSB plane",fields,children:registry(objects(getField(fields,"IORegistryEntryChildren")),`${path}/${index}`),diskIds:[]}));
}
function linux(nodes: Json[],source: string,path: string,devices: Device[]): PortNode[] {
  const entries=nodes.map((fields,index)=>({id:`${path}/${index}`,label:text(getField(fields,"product")) ?? text(getField(fields,"device_name")) ?? text(getField(fields,"sysfsName")) ?? "Sysfs entry",kind:text(getField(fields,"sysfsName")) ?? "Sysfs entry",source,fields,children:[],diskIds:[]} as PortNode));
  const byName=new Map(entries.map(n=>[text(getField(n.fields,"sysfsName")),n]));
  const roots: PortNode[]=[];
  for (const n of entries) {
    const parent=byName.get(text(getField(n.fields,"parentSysfsName")));
    // Reject a cycle before linking any edge. Imported observations may be untrusted.
    let cursor=parent; const seen=new Set([n]); let cycle=false;
    while(cursor) {if(seen.has(cursor)){cycle=true;break;}seen.add(cursor);cursor=byName.get(text(getField(cursor.fields,"parentSysfsName")));}
    if(parent && !cycle) parent.children.push(n); else roots.push(n);
  }
  for(const d of devices) {
    const sysfs=text(getField(d.info,"sysfsPath"));
    if(!sysfs) continue;
    const parent=entries.filter(n=>{const p=text(getField(n.fields,"sysfsPath"));return p && sysfs.startsWith(p+"/");}).sort((a,b)=>String(getField(b.fields,"sysfsPath")).length-String(getField(a.fields,"sysfsPath")).length)[0];
    if(parent) parent.children.push({id:`${parent.id}/disk/${d.id}`,label:d.name,kind:`Block device · /dev/${d.id}`,source:"Snapshot · matching canonical sysfs ancestry",fields:d.info,children:[],diskIds:[d.id]});
  }
  return roots;
}
export function portTopology(fields: Json | null,devices: Device[]=[]): PortNode[] {
  const groups: PortNode[]=[];
  const group=(id:string,label:string,source:string,children:PortNode[])=>{if(children.length)groups.push({id,label,source,kind:"Report",fields:null,children,diskIds:[]});};
  group("usb","USB devices","System Profiler",profiler(objects(getField(fields,"SPUSBDataType")),"System Profiler · USB","usb",devices,"Reported bus"));
  group("thunderbolt","Thunderbolt / USB4","System Profiler",profiler(objects(getField(fields,"SPThunderboltDataType")),"System Profiler · Thunderbolt","thunderbolt",devices,"Reported bus"));
  group("registry","USB registry","IORegistry",registry(objects(getField(getField(fields,"IORegistryUSBReport"),"fields")),"registry"));
  group("linux-usb","USB devices","Linux sysfs",linux(objects(getField(fields,"USBDevices")),"Linux sysfs · USB","linux-usb",devices));
  group("linux-tb","Thunderbolt devices","Linux sysfs",linux(objects(getField(fields,"ThunderboltDevices")),"Linux sysfs · Thunderbolt","linux-tb",devices));
  return groups;
}
export function portMeasurements(node: PortNode) {
  const f=node.fields;
  const measurement=(label:string,keys:string[],hint:string)=>{const key=keys.find(k=>getField(f,k)!==undefined);return {label,key,value:key?(["bus_power", "bus_power_used"].includes(key) && /^\d+$/.test(displayValue(getField(f,key))) ? `${displayValue(getField(f,key))} mA` : displayValue(getField(f,key))):"Not reported",hint};};
  return [
    measurement("Link / speed",["device_speed","speed","current_speed_key","current_link_speed"],"Reported link or descriptor value. This is not measured read/write throughput."),
    measurement("Power requested",["bus_power_used","bMaxPower","USB Power Requested"],"Declared or host-allocated USB power metadata. It does not measure current flowing into the drive."),
    measurement("Power available",["bus_power","bus_power_available","kUSBWakePortCurrentLimit","kUSBSleepPortCurrentLimit"],"Host-reported current limit or budget. It is not proof of voltage or current reaching the SSD."),
    measurement("Port / power state",["receptacle_status_key","power/runtime_status","IOServiceState","authorized"],"Original port, runtime or authorization state. These values do not establish the state of the disk inside an enclosure."),
  ];
}
