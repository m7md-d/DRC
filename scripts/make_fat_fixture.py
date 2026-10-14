"""Create disposable FAT16 images with independently known file bytes."""
from pathlib import Path
import json, struct, sys, hashlib
root = Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
sector = 512; total = 16384; fat_sectors = 64; root_entries = 512
image = bytearray(total * sector)
boot = bytearray(sector); boot[:3] = b'\xeb\x3c\x90'; boot[3:11] = b'DRCTEST '
struct.pack_into('<HBHBHHBHHHII',boot,11,512,1,1,2,root_entries,total,0xf8,fat_sectors,32,64,0,0)
boot[36] = 0x80; boot[38] = 0x29; struct.pack_into('<I',boot,39,0x1234abcd)
boot[43:54] = b'DRC FIXTURE'; boot[54:62] = b'FAT16   '; boot[510:512] = b'\x55\xaa'; image[:sector] = boot
fat = bytearray(fat_sectors * sector)
for n,value in {0:0xfff8,1:0xffff,2:0xffff,3:0xffff,4:0xffff,5:7,6:0xffff,7:0xffff}.items(): struct.pack_into('<H',fat,n*2,value)
image[sector:sector+len(fat)] = fat; image[sector+len(fat):sector+2*len(fat)] = fat
root_at = (1+2*fat_sectors)*sector; data_at = root_at + root_entries*32
stamp_date = ((2026-1980)<<9)|(10<<5)|14; stamp_time = 8<<11

def entry(name,attr,cluster,size):
    result=bytearray(32); result[:11]=name; result[11]=attr
    for offset,value in [(14,stamp_time),(16,stamp_date),(18,stamp_date),(22,stamp_time),(24,stamp_date),(26,cluster)]:struct.pack_into('<H',result,offset,value)
    struct.pack_into('<I',result,28,size); return result

def cluster(n,data): image[data_at+(n-2)*sector:data_at+(n-2)*sector+len(data)]=data
hello=b'DRC fixture: allocated file.\r\n'; deleted=b'DRC fixture: deleted entry, retained clusters.\r\n'; binary=bytes(range(256))*4; unicode_data='DRC fixture: Unicode filename.\n'.encode()
short=b'RECOVE~1TXT'; long='Recovery \u03a9.txt'; units=list(struct.unpack('<'+'H'*(len(long.encode('utf-16le'))//2),long.encode('utf-16le'))); units += [0]+[0xffff]*((13-len(units)-1)%13)
checksum=0
for b in short:checksum=(((checksum&1)<<7)+(checksum>>1)+b)&0xff
lfn=[]
for i in range(len(units)//13,0,-1):
    record=bytearray(32);record[0]=i|(0x40 if i==len(units)//13 else 0);record[11]=0x0f;record[13]=checksum
    for offset,value in zip([1,3,5,7,9,14,16,18,20,22,24,28,30],units[(i-1)*13:i*13]):struct.pack_into('<H',record,offset,value)
    lfn.append(record)
rows=[entry(b'DRC FIXTURE',0x08,0,0),entry(b'HELLO   TXT',0x20,2,len(hello)),entry(b'\xe5ELETED TXT',0x20,3,len(deleted)),entry(b'DOCS       ',0x10,4,0),*lfn,entry(short,0x20,6,len(unicode_data))]
image[root_at:root_at+32*len(rows)]=b''.join(rows)
cluster(2,hello);cluster(3,deleted);cluster(6,unicode_data);cluster(5,binary[:512]);cluster(7,binary[512:])
cluster(4,b''.join([entry(b'.          ',0x10,4,0),entry(b'..         ',0x10,0,0),entry(b'NESTED  BIN',0x20,5,len(binary))]))
volume=root/'fat16-volume.img'; volume.write_bytes(image)
disk=bytearray(2048*sector)+image; disk[510:512]=b'\x55\xaa'; part=bytearray(16);part[4]=0x06;struct.pack_into('<II',part,8,2048,total);disk[446:462]=part;(root/'fat16-disk.img').write_bytes(disk)
expected={'files':{'HELLO.TXT':hello.hex(),'deleted':deleted.hex(),'DOCS/NESTED.BIN':binary.hex(),long:unicode_data.hex()},'sourceSha256':hashlib.sha256(image).hexdigest(),'partitionStartSector':'2048'}
(root/'expected.json').write_text(json.dumps(expected,indent=2)+'\n')
print({'volume':str(volume),'sourceSha256':expected['sourceSha256']})
