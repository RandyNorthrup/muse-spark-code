// Test-only stat seam: an actual private directory reports a different device,
// consistently in both the no-follow observation and the newly held descriptor.
#include <sys/stat.h>
#include <string.h>
static ino_t mounted_inode;
static int device_statat(int fd, const char *name, struct stat *sample, int flags) {
  int result = fstatat(fd, name, sample, flags);
  if (!result && !strcmp(name, "mounted")) {
    mounted_inode = sample->st_ino;
    sample->st_dev++;
  }
  return result;
}
static int device_stat(int fd, struct stat *sample) {
  int result = fstat(fd, sample);
  if (!result && mounted_inode && sample->st_ino == mounted_inode) sample->st_dev++;
  return result;
}
#define fstatat device_statat
#define fstat device_stat
#include "../../../native/darwin/MuseSparkCreated.c"
