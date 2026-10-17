// macOS recovery access routes. Fixed read-only CDBs; reconnect/probe are separate actions.
#ifdef __APPLE__
#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/usb/IOUSBLib.h>
#include <IOKit/scsi/SCSITaskLib.h>
#include <mach/mach_error.h>
#include <sstream>
#include <vector>

static std::string mr_quote(const std::string &s) {
    std::ostringstream o;o<<'"'; for(unsigned char c:s) {if(c=='"'||c=='\\')o<<'\\'<<c;else if(c<32) {char b[7];snprintf(b,sizeof b,"\\u%04x",c);o<<b;} else o<<c;}o<<'"';return o.str();
}
static std::string mr_hex(const void *p,size_t n) {std::string s;const auto *b=static_cast<const unsigned char *>(p);for(size_t i=0;i<n;i++){char x[3];snprintf(x,sizeof x,"%02x",b[i]);s+=x;}return s;}
struct MRResults {
    std::vector<std::string> rows;
    bool ok=true;
    void add(const char *phase,IOReturn code,const std::string &extra="") {
        char hex[11];snprintf(hex,sizeof hex,"0x%08x",static_cast<unsigned>(code));
        rows.push_back("{\"phase\":"+mr_quote(phase)+",\"ioReturn\":"+mr_quote(hex)+",\"ioReturnDecimal\":\""+std::to_string(static_cast<unsigned>(code))+"\",\"message\":"+mr_quote(mach_error_string(code))+extra+"}");
        if(code!=kIOReturnSuccess)ok=false;
    }
    int finish() {printf("{\"ok\":%s,\"results\":[",ok?"true":"false");for(size_t i=0;i<rows.size();i++)printf("%s%s",i?",":"",rows[i].c_str());puts("]}");return ok?0:1;}
};
static std::string mr_text(io_registry_entry_t s,const char *key) {
    auto cfkey=CFStringCreateWithCString(nullptr,key,kCFStringEncodingUTF8);
    auto p=IORegistryEntryCreateCFProperty(s,cfkey,nullptr,0);CFRelease(cfkey);
    std::string result;
    if(p && CFGetTypeID(p)==CFStringGetTypeID()){char b[1024];if(CFStringGetCString(static_cast<CFStringRef>(p),b,sizeof b,kCFStringEncodingUTF8))result=b;}
    if(p)CFRelease(p);return result;
}
static uint64_t mr_number(io_registry_entry_t s,CFStringRef key) {
    auto p=IORegistryEntryCreateCFProperty(s,key,nullptr,0);int64_t n=-1;
    if(p && CFGetTypeID(p)==CFNumberGetTypeID())CFNumberGetValue(static_cast<CFNumberRef>(p),kCFNumberSInt64Type,&n);
    if(p)CFRelease(p);return static_cast<uint64_t>(n);
}
static bool mr_ancestor(io_registry_entry_t s,uint64_t id) {
    IOObjectRetain(s);
    for(int i=0;i<64;i++){uint64_t current=0;IORegistryEntryGetRegistryEntryID(s,&current);if(current==id){IOObjectRelease(s);return true;}io_registry_entry_t parent=0;auto r=IORegistryEntryGetParentEntry(s,kIOServicePlane,&parent);IOObjectRelease(s);if(r || !parent)return false;s=parent;}
    IOObjectRelease(s);return false;
}
static bool mr_has_usb_child(io_registry_entry_t s) {
    io_iterator_t it=0;if(IORegistryEntryCreateIterator(s,kIOServicePlane,kIORegistryIterateRecursively,&it))return true;
    bool found=false;io_object_t child;
    while((child=IOIteratorNext(it))){if(IOObjectConformsTo(child,"IOUSBHostDevice")||IOObjectConformsTo(child,"IOUSBDevice"))found=true;IOObjectRelease(child);}IOObjectRelease(it);return found;
}
// A peripheral can exist in the registry before registerService() is called.
// Service matching omits those entries; search only the pinned USB branch.
static io_registry_entry_t mr_descendant(io_registry_entry_t root,uint64_t id) {
    io_iterator_t it=0;
    if(IORegistryEntryCreateIterator(root,kIOServicePlane,kIORegistryIterateRecursively,&it))return 0;
    io_registry_entry_t found=0,child;
    while((child=IOIteratorNext(it))){
        uint64_t current=0;
        if(IORegistryEntryGetRegistryEntryID(child,&current)==kIOReturnSuccess&&current==id){found=child;break;}
        IOObjectRelease(child);
    }
    IOObjectRelease(it);return found;
}
static bool mr_no_bsd_media(io_registry_entry_t usb,MRResults &r) {
    io_iterator_t it=0;auto code=IORegistryEntryCreateIterator(usb,kIOServicePlane,kIORegistryIterateRecursively,&it);
    if(code){r.add("validateNoBsdMedia",code);return false;}
    bool clear=true;io_registry_entry_t child;
    while((child=IOIteratorNext(it))){if(!mr_text(child,"BSD Name").empty())clear=false;IOObjectRelease(child);}
    IOObjectRelease(it);r.add("validateNoBsdMedia",clear?kIOReturnSuccess:kIOReturnBusy);return clear;
}
// Probe exclusive USB-interface access only. No bulk command/data packet is sent.
static int mr_usb_interface_check(io_registry_entry_t usb,MRResults &r) {
    io_iterator_t it=0;auto code=IORegistryEntryCreateIterator(usb,kIOServicePlane,kIORegistryIterateRecursively,&it);
    r.add("enumerateUsbInterfaces",code);if(code)return r.finish();
    io_registry_entry_t found=0,child;
    while((child=IOIteratorNext(it))){
        if(IOObjectConformsTo(child,"IOUSBHostInterface")&&mr_number(child,CFSTR("bInterfaceClass"))==8&&mr_number(child,CFSTR("bInterfaceSubClass"))==6){
            if(found){IOObjectRelease(found);IOObjectRelease(child);IOObjectRelease(it);r.add("uniqueMassStorageInterface",kIOReturnBadArgument);return r.finish();}found=child;
        }else IOObjectRelease(child);
    }
    IOObjectRelease(it);
    if(!found){r.add("locateMassStorageInterface",kIOReturnNoDevice);return r.finish();}
    IOCFPlugInInterface **plugin=nullptr;SInt32 score=0;
    code=IOCreatePlugInInterfaceForService(found,kIOUSBInterfaceUserClientTypeID,kIOCFPlugInInterfaceID,&plugin,&score);r.add("createUsbInterfacePlugin",code);IOObjectRelease(found);
    if(code||!plugin){if(!code)r.add("missingPluginInterface",kIOReturnNoResources);return r.finish();}
    IOUSBInterfaceInterface300 **intf=nullptr;
    code=(*plugin)->QueryInterface(plugin,CFUUIDGetUUIDBytes(kIOUSBInterfaceInterfaceID300),reinterpret_cast<LPVOID *>(&intf));IODestroyPlugInInterface(plugin);r.add("queryUsbInterface",code);
    if(code||!intf){if(!code)r.add("missingDeviceInterface",kIOReturnNoResources);return r.finish();}
    code=(*intf)->USBInterfaceOpenSeize(intf);r.add("openMassStorageInterfaceExclusive",code);
    if(!code){
        UInt8 p=0,a=0,n=0;auto c=(*intf)->GetInterfaceProtocol(intf,&p);r.add("getInterfaceProtocol",c,",\"protocol\":"+std::to_string(p));
        c=(*intf)->GetAlternateSetting(intf,&a);r.add("getAlternateSetting",c,",\"alternate\":"+std::to_string(a));
        c=(*intf)->GetNumEndpoints(intf,&n);r.add("getNumEndpoints",c,",\"endpoints\":"+std::to_string(n));
        r.add("closeInterface",(*intf)->USBInterfaceClose(intf));
    }
    (*intf)->Release(intf);return r.finish();
}
static io_service_t mr_usb(uint64_t id,uint64_t vendor,uint64_t product,const char *serial,MRResults &r) {
    auto s=IOServiceGetMatchingService(kIOMainPortDefault,IORegistryEntryIDMatching(id));
    if(!s){r.add("locateUsbRegistryEntry",kIOReturnNoDevice);return 0;}
    if(!(IOObjectConformsTo(s,"IOUSBHostDevice")||IOObjectConformsTo(s,"IOUSBDevice"))||mr_number(s,CFSTR("idVendor"))!=vendor||mr_number(s,CFSTR("idProduct"))!=product||!serial[0]||mr_text(s,"USB Serial Number")!=serial){r.add("validateUsbDescriptor",kIOReturnBadArgument);IOObjectRelease(s);return 0;}
    r.add("validateUsbDescriptor",kIOReturnSuccess);return s;
}
static bool mr_scsi_task(SCSITaskDeviceInterface **device,const char *label,UInt8 *cdb,UInt8 length,unsigned count,MRResults &r,bool data_is_metadata) {
    auto task=(*device)->CreateSCSITask(device);if(!task){r.add("createScsiTask",kIOReturnNoMemory);return false;}
    std::vector<unsigned char> data(count);SCSITaskSGElement sg{};sg.address=reinterpret_cast<uint64_t>(data.data());sg.length=count;
    auto code=(*task)->SetCommandDescriptorBlock(task,cdb,length);
    if(!code)code=(*task)->SetTimeoutDuration(task,5000);
    if(!code)code=(*task)->SetScatterGatherEntries(task,count?&sg:nullptr,count?1:0,count,count?kSCSIDataTransfer_FromTargetToInitiator:kSCSIDataTransfer_NoDataTransfer);
    SCSI_Sense_Data sense{};SCSITaskStatus status=static_cast<SCSITaskStatus>(255);UInt64 transferred=0;
    if(!code)code=(*task)->ExecuteTaskSync(task,&sense,&status,&transferred);
    const auto sense_bytes=reinterpret_cast<const unsigned char *>(&sense);
    std::string extra=",\"cdbHex\":"+mr_quote(mr_hex(cdb,length))+",\"scsiStatus\":\""+std::to_string(status)+"\",\"requestedBytes\":\""+std::to_string(count)+"\",\"transferredBytes\":\""+std::to_string(transferred)+"\",\"senseHex\":"+mr_quote(mr_hex(&sense,sizeof sense));
    const auto response=sense_bytes[0]&0x7f;
    const bool fixed=response==0x70||response==0x71,descriptor=response==0x72||response==0x73;
    extra+=",\"senseFormat\":"+mr_quote(fixed?"fixed":descriptor?"descriptor":"not-reported");
    if(fixed||descriptor)extra+=",\"senseKey\":\""+std::to_string(sense_bytes[fixed?2:1]&15)+"\",\"asc\":\""+std::to_string(sense_bytes[fixed?12:2])+"\",\"ascq\":\""+std::to_string(sense_bytes[fixed?13:3])+"\"";
    if(data_is_metadata)extra+=",\"dataHex\":"+mr_quote(mr_hex(data.data(),std::min<uint64_t>(count,transferred)));
    r.add(label,code,extra);(*task)->Release(task);
    if(status!=kSCSITaskStatus_GOOD || transferred!=count){r.ok=false;return false;}return code==kIOReturnSuccess;
}
static int mac_recovery_main(int argc,char **argv) {
    MRResults r;uint64_t entry=0,a=0,b=0,scsi=0;
    const std::string action=argv[1];
    if(action=="--mac-port-probe") {
        if(argc!=4||!number(argv[2],entry)||!number(argv[3],a)||a==0||a>64)return 2;
        auto service=IOServiceGetMatchingService(kIOMainPortDefault,IORegistryEntryIDMatching(entry));
        if(!service){r.add("locateHostPort",kIOReturnNoDevice);return r.finish();}
        if(!IOObjectConformsTo(service,"AppleUSBHostPort")||mr_number(service,CFSTR("UsbCPortNumber"))!=a||mr_has_usb_child(service)){r.add("validateEmptyHostPort",kIOReturnBadArgument);IOObjectRelease(service);return r.finish();}
        r.add("requestHostPortProbe",IOServiceRequestProbe(service,0));IOObjectRelease(service);return r.finish();
    }
    if(argc!=(action=="--mac-scsi-check"?7:6)||!number(argv[2],entry)||!number(argv[3],a)||!number(argv[4],b))return 2;
    auto usb=mr_usb(entry,a,b,argv[5],r);if(!usb)return r.finish();
    if(action!="--mac-usb-status"&&!mr_no_bsd_media(usb,r)){IOObjectRelease(usb);return r.finish();}
    if(action=="--mac-usb-interface-check"){auto result=mr_usb_interface_check(usb,r);IOObjectRelease(usb);return result;}
    if(action=="--mac-scsi-check") {
        if(!number(argv[6],scsi)){IOObjectRelease(usb);return 2;}
        auto service=mr_descendant(usb,scsi);
        if(!service){IOObjectRelease(usb);r.add("locateScsiRegistryEntry",kIOReturnNoDevice);return r.finish();}
        if(!mr_ancestor(service,entry)||!IOObjectConformsTo(service,"IOSCSIPeripheralDeviceType00")){IOObjectRelease(service);IOObjectRelease(usb);r.add("validateScsiService",kIOReturnBadArgument);return r.finish();}
        r.add("validateScsiService",kIOReturnSuccess);
        IOCFPlugInInterface **plugin=nullptr;SInt32 score=0;
        auto code=IOCreatePlugInInterfaceForService(service,kIOSCSITaskDeviceUserClientTypeID,kIOCFPlugInInterfaceID,&plugin,&score);r.add("createScsiPlugin",code);IOObjectRelease(service);
        if(code||!plugin){if(!code)r.add("missingPluginInterface",kIOReturnNoResources);IOObjectRelease(usb);return r.finish();}
        SCSITaskDeviceInterface **device=nullptr;
        code=(*plugin)->QueryInterface(plugin,CFUUIDGetUUIDBytes(kIOSCSITaskDeviceInterfaceID),reinterpret_cast<LPVOID *>(&device));IODestroyPlugInInterface(plugin);r.add("queryScsiInterface",code);
        if(code||!device){if(!code)r.add("missingDeviceInterface",kIOReturnNoResources);IOObjectRelease(usb);return r.finish();}
        code=(*device)->ObtainExclusiveAccess(device);r.add("obtainScsiExclusiveAccess",code);
        if(!code){UInt8 inquiry[6]={0x12,0,0,0,36,0};mr_scsi_task(device,"inquiry",inquiry,6,36,r,true);UInt8 ready[6]={0};mr_scsi_task(device,"testUnitReady",ready,6,0,r,true);UInt8 capacity[16]={0x9e,0x10,0,0,0,0,0,0,0,0,0,0,0,32,0,0};mr_scsi_task(device,"readCapacity16",capacity,16,32,r,true);r.add("releaseScsiExclusiveAccess",(*device)->ReleaseExclusiveAccess(device));}
        (*device)->Release(device);IOObjectRelease(usb);return r.finish();
    }
    IOCFPlugInInterface **plugin=nullptr;SInt32 score=0;
    auto code=IOCreatePlugInInterfaceForService(usb,kIOUSBDeviceUserClientTypeID,kIOCFPlugInInterfaceID,&plugin,&score);r.add("createUsbPlugin",code);
    if(code||!plugin){if(!code)r.add("missingPluginInterface",kIOReturnNoResources);IOObjectRelease(usb);return r.finish();}
    IOUSBDeviceInterface320 **device=nullptr;
    code=(*plugin)->QueryInterface(plugin,CFUUIDGetUUIDBytes(kIOUSBDeviceInterfaceID320),reinterpret_cast<LPVOID *>(&device));IODestroyPlugInInterface(plugin);r.add("queryUsbInterface",code);
    if(!code&&!device)r.add("missingDeviceInterface",kIOReturnNoResources);
    if(!code&&device){
        if(action=="--mac-usb-status") {
            UInt8 descriptor[18]={};IOUSBDevRequestTO request{};request.bmRequestType=0x80;request.bRequest=6;request.wValue=0x100;request.wLength=18;request.pData=descriptor;request.noDataTimeout=3000;request.completionTimeout=5000;
            code=(*device)->DeviceRequestTO(device,&request);if(request.wLenDone!=18)r.ok=false;r.add("readLiveUsbDeviceDescriptor",code,",\"requestedBytes\":\"18\",\"transferredBytes\":\""+std::to_string(request.wLenDone)+"\",\"descriptorHex\":"+mr_quote(mr_hex(descriptor,std::min<UInt32>(18,request.wLenDone))));
        } else if(action=="--mac-usb-reconnect") {
            code=(*device)->USBDeviceOpenSeize(device);r.add("openUsbForReconnect",code);
            if(!code){r.add("usbReEnumerate",(*device)->USBDeviceReEnumerate(device,0));(*device)->USBDeviceClose(device);}
        } else {r.add("unsupportedAction",kIOReturnUnsupported);}
        (*device)->Release(device);
    }
    IOObjectRelease(usb);return r.finish();
}
#endif
