// Signal the parent after the walk, wait until it adds a second hard link
// to the operand (or time out), then report. The walk saw one link, so only
// the post-walk check in production main can refuse: removing that check
// reports exit 0 instead. A marker-write failure degrades to an operand
// refusal below; the test then still observes exit 125.
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
#define MUSE_STATX link_race_statx
#define main confine_main
int link_race_statx(int dirfd, const char *path, int flags, unsigned int mask, struct statx *buf);
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
int link_race_statx(int dirfd, const char *path, int flags, unsigned int mask, struct statx *buf) {
  if (fputs("{\"walked\":true}\n", stderr) < 0 || fflush(stderr)) return -1;
  for (int i = 0; i < 500; i++) {
    struct stat current;
    if (!fstat(dirfd, &current) && current.st_nlink > 1) break;
    struct timespec wait = {0, 10000000};
    nanosleep(&wait, NULL);
  }
  return (int)syscall(SYS_statx, dirfd, path, flags, mask, buf);
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
