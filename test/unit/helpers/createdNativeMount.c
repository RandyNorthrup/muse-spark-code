// Test-only proc seam: the held mounted directory stays on the same st_dev,
// but its kernel mount ID differs from that of the root.
#include <stdio.h>
#include <string.h>
#include <unistd.h>
static FILE *mount_info(const char *name, const char *mode) {
  const char *info = strstr(name, "/fdinfo/");
  if (info) {
    char fd[128], target[4096];
    snprintf(fd, sizeof(fd), "/proc/self/fd/%s", info + strlen("/fdinfo/"));
    ssize_t length = readlink(fd, target, sizeof(target) - 1);
    if (length > 0) {
      target[length] = 0;
      const char *leaf = strrchr(target, '/');
      if (leaf && !strcmp(leaf, "/mounted")) {
        static char different_mount[] = "mnt_id:\t9999999999\n";
        return fmemopen(different_mount, sizeof(different_mount) - 1, "r");
      }
    }
  }
  return fopen(name, mode);
}
#define fopen mount_info
#include "../../../native/darwin/MuseSparkCreated.c"
