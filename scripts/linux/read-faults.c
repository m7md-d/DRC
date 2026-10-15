/* Test-only userspace fault injection for generated regular images. Never bundled. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
static dev_t target_device;
static ino_t target_inode;
static int enabled;
static dev_t output_device;
static ino_t output_inode;
static int output_enabled;
static int interrupted_once;
__attribute__((constructor)) static void configure(void) {
    const char *value=getenv("DRC_TEST_SOURCE_FD");
    if (!value) return;
    struct stat st;
    if (!fstat(atoi(value),&st) && S_ISREG(st.st_mode)) {target_device=st.st_dev;target_inode=st.st_ino;enabled=1;}
    value=getenv("DRC_TEST_DESTINATION_FD");
    if (value && !fstat(atoi(value),&st) && S_ISREG(st.st_mode)) {output_device=st.st_dev;output_inode=st.st_ino;output_enabled=1;}
}
static int target(int fd) {
    struct stat st;
    return enabled && !fstat(fd,&st) && st.st_dev==target_device && st.st_ino==target_inode;
}
static ssize_t fault(int fd, void *buffer, size_t count, off_t position, int positional) {
    ssize_t (*original_read)(int,void*,size_t)=dlsym(RTLD_NEXT,"read");
    ssize_t (*original_pread)(int,void*,size_t,off_t)=dlsym(RTLD_NEXT,"pread");
    const char *mode=getenv("DRC_TEST_FAULT");
    if (target(fd) && mode) {
        if (!strcmp(mode,"enodev") && position>=65536) {errno=ENODEV;return -1;}
        if (!strcmp(mode,"enxio") && position>=65536) {errno=ENXIO;return -1;}
        if (!strcmp(mode,"eio") && position>=65536) {errno=EIO;return -1;}
        if (!strcmp(mode,"eof") && position>=65536) return 0;
        if (!strcmp(mode,"small-requests") && count>512) {errno=EINVAL;return -1;}
        if (!strcmp(mode,"4kn") && (position%4096 || count%4096)) {errno=EINVAL;return -1;}
        if (!strcmp(mode,"eintr") && position>=65536 && !interrupted_once++) {errno=EINTR;return -1;}
        if (!strcmp(mode,"short") && count>512) count=512;
        if (!strcmp(mode,"delayed")) {struct timespec remaining={1,500000000};while(nanosleep(&remaining,&remaining) && errno==EINTR){};}
    }
    return positional ? original_pread(fd,buffer,count,position) : original_read(fd,buffer,count);
}
ssize_t read(int fd,void *buffer,size_t count) {return fault(fd,buffer,count,lseek(fd,0,SEEK_CUR),0);}
ssize_t pread(int fd,void *buffer,size_t count,off_t position) {return fault(fd,buffer,count,position,1);}
ssize_t pread64(int fd,void *buffer,size_t count,off64_t position) {return fault(fd,buffer,count,(off_t)position,1);}

static int output_fault(int fd, off_t position) {
    const char *mode=getenv("DRC_TEST_FAULT");
    struct stat st;
    if (mode && output_enabled && !fstat(fd,&st) && S_ISREG(st.st_mode)
        && st.st_dev==output_device && st.st_ino==output_inode && position>=65536) {
        if (!strcmp(mode,"output-enospc")) {errno=ENOSPC;return 1;}
        if (!strcmp(mode,"output-eio")) {errno=EIO;return 1;}
    }
    return 0;
}
ssize_t write(int fd,const void *buffer,size_t count) {
    ssize_t (*original)(int,const void*,size_t)=dlsym(RTLD_NEXT,"write");
    if (output_fault(fd,lseek(fd,0,SEEK_CUR))) return -1;
    return original(fd,buffer,count);
}
ssize_t pwrite(int fd,const void *buffer,size_t count,off_t position) {
    ssize_t (*original)(int,const void*,size_t,off_t)=dlsym(RTLD_NEXT,"pwrite");
    if (output_fault(fd,position)) return -1;
    return original(fd,buffer,count,position);
}
ssize_t pwrite64(int fd,const void *buffer,size_t count,off64_t position) {
    ssize_t (*original)(int,const void*,size_t,off64_t)=dlsym(RTLD_NEXT,"pwrite64");
    if (output_fault(fd,(off_t)position)) return -1;
    return original(fd,buffer,count,position);
}

static int map_write_fault(const char *path, const char *mode) {
    const char *fault_mode=getenv("DRC_TEST_FAULT");
    const char *work=getenv("DRC_TEST_WORK_DIRECTORY");
    char cwd[4096];
    if (fault_mode && work && !strcmp(fault_mode,"map-enospc")
        && strchr(mode,'w') && !strcmp(path,"rescue.map")
        && getcwd(cwd,sizeof(cwd)) && !strcmp(cwd,work)) {
        errno=ENOSPC;
        return 1;
    }
    return 0;
}
FILE *fopen(const char *path,const char *mode) {
    FILE *(*original)(const char*,const char*)=dlsym(RTLD_NEXT,"fopen");
    if (map_write_fault(path,mode)) return NULL;
    return original(path,mode);
}
FILE *fopen64(const char *path,const char *mode) {
    FILE *(*original)(const char*,const char*)=dlsym(RTLD_NEXT,"fopen64");
    if (map_write_fault(path,mode)) return NULL;
    return original(path,mode);
}
