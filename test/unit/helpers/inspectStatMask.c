// Simulate a filesystem that withholds fields (FUSE, NFS): clear mask bits
// and zero the values, so the report must print dashes, never zeros or 1970.
// Type, mode, inode and link count stay, or the post-walk checks refuse.
#define _GNU_SOURCE
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
#define MUSE_STATX masked_statx
#define main confine_main
int masked_statx(int dirfd, const char *path, int flags, unsigned int mask, struct statx *buf);
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
int masked_statx(int dirfd, const char *path, int flags, unsigned int mask, struct statx *buf) {
  int result = (int)syscall(SYS_statx, dirfd, path, flags, mask, buf);
  if (result == 0) {
    buf->stx_mask &= (unsigned int)~(unsigned int)(STATX_SIZE | STATX_BLOCKS | STATX_UID |
      STATX_GID | STATX_ATIME | STATX_MTIME | STATX_CTIME | STATX_BTIME);
    buf->stx_size = 0;
    buf->stx_blocks = 0;
    buf->stx_uid = 0;
    buf->stx_gid = 0;
    buf->stx_atime.tv_sec = 0;
    buf->stx_atime.tv_nsec = 0;
    buf->stx_mtime.tv_sec = 0;
    buf->stx_mtime.tv_nsec = 0;
    buf->stx_ctime.tv_sec = 0;
    buf->stx_ctime.tv_nsec = 0;
    buf->stx_btime.tv_sec = 0;
    buf->stx_btime.tv_nsec = 0;
  }
  return result;
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
