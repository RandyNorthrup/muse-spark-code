// Delay the report's statx only, after the walk, so the test can swap an
// ancestor for a symlink in between. The production stat path reads the
// walk-verified descriptor (AT_EMPTY_PATH), so the swap must not redirect it.
#define _GNU_SOURCE
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
#define MUSE_STATX delayed_statx
#define main confine_main
int delayed_statx(int dirfd, const char *path, int flags, unsigned int mask, struct statx *buf);
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
int delayed_statx(int dirfd, const char *path, int flags, unsigned int mask, struct statx *buf) {
  struct timespec delay = {0, 200000000};
  nanosleep(&delay, NULL);
  return (int)syscall(SYS_statx, dirfd, path, flags, mask, buf);
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
