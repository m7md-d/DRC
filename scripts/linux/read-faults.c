/* Test-only userspace fault injection for generated regular images. Never bundled. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
static dev_t target_device;
static ino_t target_inode;
static int enabled;
__attribute__((constructor)) static void configure(void) {
    const char *value=getenv("DRC_TEST_SOURCE_FD");
    if (!value) return;
    struct stat st;
    if (!fstat(atoi(value),&st) && S_ISREG(st.st_mode)) {target_device=st.st_dev;target_inode=st.st_ino;enabled=1;}
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
        if (!strcmp(mode,"short") && count>512) count=512;
        if (!strcmp(mode,"delayed")) {struct timespec remaining={1,500000000};while(nanosleep(&remaining,&remaining) && errno==EINTR){};}
    }
    return positional ? original_pread(fd,buffer,count,position) : original_read(fd,buffer,count);
}
ssize_t read(int fd,void *buffer,size_t count) {return fault(fd,buffer,count,lseek(fd,0,SEEK_CUR),0);}
ssize_t pread(int fd,void *buffer,size_t count,off_t position) {return fault(fd,buffer,count,position,1);}
ssize_t pread64(int fd,void *buffer,size_t count,off64_t position) {return fault(fd,buffer,count,(off_t)position,1);}
