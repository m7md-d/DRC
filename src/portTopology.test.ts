import { describe, expect, it } from "vitest";
import { portMeasurements, portTopology, type PortNode } from "./portTopology";
import type { Device } from "./types";
const all=(nodes:PortNode[]):PortNode[]=>nodes.flatMap(n=>[n,...all(n.children)]);
describe('reported port relationships',()=>{
  it('retains a hub and enclosure without inventing an SSD or readable namespace',()=>{
    const original={_name:'Bus',_items:[{_name:'Hub',_items:[{_name:'USB bridge',future_vendor_property:'18446744073709551615',bus_power:'900',bus_power_used:'224',extra_current_used:'0'}]}]};
    const roots=portTopology({SPUSBDataType:[original]});
    const nodes=all(roots),bridge=nodes.find(n=>n.label==='USB bridge')!;
    expect(roots[0].children[0].children[0].children[0]).toBe(bridge);
    expect(bridge.children).toHaveLength(0);expect(bridge.diskIds).toEqual([]);
    expect(bridge.fields).toEqual(original._items[0]._items[0]);
    const readings=portMeasurements(bridge);
    expect(readings.find(r=>r.label==='Power requested')?.value).toBe('224 mA');
    expect(readings.find(r=>r.label==='Power available')?.value).toBe('900 mA');
  });
  it('shows explicitly reported child media and disconnected ports without model-name association',()=>{
    const roots=portTopology({SPUSBDataType:[{_name:'Enclosure',Media:[{_name:'Reported media',bsd_name:'disk90',size:'256000000000'}]}],SPThunderboltDataType:[{_name:'Bus',receptacle_1_tag:{receptacle_id_key:'2',receptacle_status_key:'receptacle_no_devices_connected'}}]});
    expect(roots[0].children[0].children[0].diskIds).toEqual(['disk90']);
    expect(roots[1].children[0].children[0].label).toBe('Port 2');
    expect(roots[1].children[0].children[0].diskIds).toEqual([]);
  });
  it('uses canonical sysfs ancestry, not similar port or model names',()=>{
    const disk={id:'sdc',name:'Same model',info:{sysfsPath:'/sys/devices/usb1/1-1/1-1.2/storage/block/sdc'}} as unknown as Device;
    const unrelated={id:'sdd',name:'Same model',info:{sysfsPath:'/sys/devices/usb1/1-10/storage/block/sdd'}} as unknown as Device;
    const roots=portTopology({USBDevices:[{sysfsName:'usb1',sysfsPath:'/sys/devices/usb1'},{sysfsName:'1-1',parentSysfsName:'usb1',sysfsPath:'/sys/devices/usb1/1-1'},{sysfsName:'1-1.2',parentSysfsName:'1-1',sysfsPath:'/sys/devices/usb1/1-1/1-1.2'}]},[disk,unrelated]);
    const nodes=all(roots),leaf=nodes.find(n=>n.kind==='1-1.2')!;
    expect(leaf.children.map(n=>n.diskIds)).toEqual([['sdc']]);
    expect(nodes.find(n=>n.kind==='1-1')?.children.some(n=>n.diskIds.includes('sdd'))).toBe(false);
  });
  it('preserves orphan/cyclic imported nodes without manufacturing a parent link',()=>{
    const roots=portTopology({USBDevices:[{sysfsName:'a',parentSysfsName:'b',unknown:false},{sysfsName:'b',parentSysfsName:'a'},{sysfsName:'orphan',parentSysfsName:'missing'}]});
    const nodes=all(roots).filter(n=>n.source.startsWith('Linux sysfs ·'));
    expect(nodes).toHaveLength(3);expect(nodes.every(n=>n.children.length===0)).toBe(true);
    expect(nodes[0].fields).toEqual({sysfsName:'a',parentSysfsName:'b',unknown:false});
  });
});
