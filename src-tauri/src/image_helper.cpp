// Narrow, non-privileged adapter: TSK reads only an inherited O_RDONLY file
// descriptor. No source pathname is reopened and no source write API exists.
#include <tsk/libtsk.h>
#include <algorithm>
#include <cerrno>
#include <cinttypes>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

struct ExternalImage { TSK_IMG_INFO info; int descriptor; };
static ssize_t read_image(TSK_IMG_INFO *info, TSK_OFF_T offset, char *buffer, size_t length) {
    auto *image = reinterpret_cast<ExternalImage *>(info);
    if (offset < 0 || offset > info->size) { tsk_error_reset(); tsk_error_set_errno(TSK_ERR_IMG_READ_OFF); tsk_error_set_errstr("Image read offset outside source"); return -1; }
    length = std::min(length, static_cast<size_t>(info->size - offset));
    ssize_t result;
    do { result = pread(image->descriptor, buffer, length, offset); } while (result < 0 && errno == EINTR);
    if (result < 0) { tsk_error_reset(); tsk_error_set_errno(TSK_ERR_IMG_READ); tsk_error_set_errstr("Pinned image read: %s", strerror(errno)); }
    return result;
}
static void close_image(TSK_IMG_INFO *info) { auto *image=reinterpret_cast<ExternalImage *>(info); close(image->descriptor); free(image); }
static void image_stat(TSK_IMG_INFO *info, FILE *output) { fprintf(output,"Image bytes: %" PRId64 "\nRead-only inherited descriptor\n",info->size); }
static bool number(const char *s,uint64_t &value) {
    if (!s || !*s) return false;
    value=0;
    for (;*s;s++) { if (*s<'0'||*s>'9'||value>(UINT64_MAX-static_cast<unsigned>(*s-'0'))/10) return false;value=value*10+static_cast<unsigned>(*s-'0'); }
    return true;
}
static void json_string(const char *s) {
    fputc('"',stdout);
    for (const unsigned char *p=reinterpret_cast<const unsigned char *>(s);*p;p++) {
        if (*p=='"'||*p=='\\') {fputc('\\',stdout);fputc(*p,stdout);} else if (*p<32) fprintf(stdout,"\\u%04x",*p); else fputc(*p,stdout);
    }
    fputc('"',stdout);
}
static int failure() {tsk_error_print(stderr);return 1;}
int main(int argc,char **argv) {
    if (argc==2 && !strcmp(argv[1],"--version")) {printf("DRC image adapter / The Sleuth Kit %s\n",tsk_version_get_str());return 0;}
    if (argc!=8) {fprintf(stderr,"Expected action, descriptor, sector bytes, sector offset, filesystem, entry filter and metadata address.\n");return 2;}
    if (strcmp(tsk_version_get_str(),TSK_VERSION_STR)) {fprintf(stderr,"TSK runtime version differs from the adapter's headers. Rebuild the adapter.\n");return 2;}
    std::string action=argv[1];
    if (action!="partitions"&&action!="fsstat"&&action!="fls"&&action!="istat"&&action!="icat") return 2;
    uint64_t descriptor,sectors,offset;
    if (!number(argv[2],descriptor)||descriptor<3||descriptor>INT_MAX||!number(argv[3],sectors)||(sectors!=512&&sectors!=1024&&sectors!=2048&&sectors!=4096)||!number(argv[4],offset)||offset>static_cast<uint64_t>(INT64_MAX)/sectors) return 2;
    struct stat status{};
    int fd=static_cast<int>(descriptor);
    if ((fcntl(fd,F_GETFL)&O_ACCMODE)!=O_RDONLY || fstat(fd,&status)!=0 || !S_ISREG(status.st_mode)||status.st_size<=0) {fprintf(stderr,"The image must be an inherited read-only regular file.\n");return 2;}
    auto *image=static_cast<ExternalImage *>(calloc(1,sizeof(ExternalImage)));if (!image) return 1;
    image->descriptor=fd;
    auto *img=tsk_img_open_external(image,status.st_size,static_cast<unsigned>(sectors),read_image,close_image,image_stat);
    if (!img) {free(image);return failure();}
    int result=0;
    if (action=="partitions") {
        auto *vs=tsk_vs_open(img,static_cast<TSK_DADDR_T>(offset*sectors),TSK_VS_TYPE_DETECT);
        if (!vs) result=failure(); else {
            printf("{\"backend\":\"The Sleuth Kit %s\",\"volumeType\":",tsk_version_get_str());json_string(tsk_vs_type_todesc(vs->vstype));
            printf(",\"offsetBytes\":\"%" PRIu64 "\",\"blockSize\":\"%u\",\"isBackup\":\"%d\",\"endian\":\"%u\",\"partCount\":\"%u\",\"volumeTypeCode\":\"%u\",\"partitions\":[",vs->offset,vs->block_size,vs->is_backup,static_cast<unsigned>(vs->endian),vs->part_count,static_cast<unsigned>(vs->vstype));
            for (TSK_PNUM_T i=0;i<vs->part_count;i++) {
                auto *p=tsk_vs_part_get(vs,i);if (!p) {result=failure();break;}
                if (i) fputc(',',stdout);
                printf("{\"address\":\"%u\",\"tableNumber\":\"%d\",\"slotNumber\":\"%d\",\"flags\":\"%u\",\"start\":\"%" PRIu64 "\",\"length\":\"%" PRIu64 "\",\"description\":",p->addr,p->table_num,p->slot_num,p->flags,p->start,p->len);json_string(p->desc?p->desc:"");fputc('}',stdout);
            }
            fputs("]}\n",stdout);tsk_vs_close(vs);
        }
    } else {
        TSK_FS_TYPE_ENUM type=TSK_FS_TYPE_DETECT;
        if (strcmp(argv[5],"auto")) type=tsk_fs_type_toid_utf8(argv[5]);
        const char *type_name=tsk_fs_type_toname(type);
        if (type==TSK_FS_TYPE_UNSUPP||(type_name&&(!strcmp(type_name,"logical")||!strcmp(type_name,"dir")))) {fprintf(stderr,"Unsupported image filesystem backend\n");tsk_img_close(img);return 2;}
        uint64_t start=offset*sectors;
        if (start>=static_cast<uint64_t>(status.st_size)) {tsk_img_close(img);return 2;}
        auto *fs=tsk_fs_open_img(img,static_cast<TSK_OFF_T>(start),type);
        if (!fs) result=failure();else {
            uint64_t inode=fs->root_inum,attribute=0,attribute_id=0;bool type_used=false,id_used=false;
            std::string address=argv[7];
            if (address!="root") {
                auto first=address.find('-'),second=first==std::string::npos?first:address.find('-',first+1);
                if (!number(address.substr(0,first).c_str(),inode)) result=2;
                if (first!=std::string::npos) {type_used=true;if (!number(address.substr(first+1,second==std::string::npos?second:second-first-1).c_str(),attribute)||attribute>UINT32_MAX) result=2;}
                if (second!=std::string::npos) {id_used=true;if (!number(address.substr(second+1).c_str(),attribute_id)||attribute_id>UINT16_MAX) result=2;}
            }
            if (!result && action=="fls") {
                auto flags=TSK_FS_DIR_WALK_FLAG_NONE;
                if (!strcmp(argv[6],"all")||!strcmp(argv[6],"allocated")) flags=static_cast<TSK_FS_DIR_WALK_FLAG_ENUM>(flags|TSK_FS_DIR_WALK_FLAG_ALLOC);
                if (!strcmp(argv[6],"all")||!strcmp(argv[6],"deleted")) flags=static_cast<TSK_FS_DIR_WALK_FLAG_ENUM>(flags|TSK_FS_DIR_WALK_FLAG_UNALLOC);
                result=tsk_fs_fls(fs,static_cast<TSK_FS_FLS_FLAG_ENUM>(TSK_FS_FLS_LONG|TSK_FS_FLS_FILE|TSK_FS_FLS_DIR),inode,flags,nullptr,0);
            } else if (!result && action=="fsstat") result=fs->fsstat(fs,stdout);
            else if (!result && action=="istat") result=fs->istat(fs,TSK_FS_ISTAT_NONE,stdout,inode,0,0);
            else if (!result && action=="icat") result=tsk_fs_icat(fs,inode,static_cast<TSK_FS_ATTR_TYPE_ENUM>(attribute),type_used,static_cast<uint16_t>(attribute_id),id_used,TSK_FS_FILE_WALK_FLAG_NONE);
            if (result==1) tsk_error_print(stderr);
            tsk_fs_close(fs);
        }
    }
    tsk_img_close(img);
    if (fflush(stdout)!=0 || ferror(stdout)) {perror("Output write");return 1;}
    return result;
}
