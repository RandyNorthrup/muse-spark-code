// Test-only interleaving at the final openat, after the helper holds its
// verified parent. Move that parent outside the copy before the create.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <stdarg.h>
static int worker_race_open(int parent, const char *name, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list arguments; va_start(arguments, flags); mode = va_arg(arguments, int); va_end(arguments);
  }
  if ((flags & O_CREAT) && !strcmp(name, "new")) {
    struct stat marker;
    if (!fstatat(parent, ".race-parent", &marker, AT_SYMLINK_NOFOLLOW)) {
      int root = openat(parent, "..", O_RDONLY | O_DIRECTORY);
      int user = openat(root, "../user", O_RDONLY | O_DIRECTORY);
      if (root < 0 || user < 0 || renameat(root, "src", user, "moved")) _exit(90);
      close(user); close(root);
    }
  }
  return openat(parent, name, flags, mode);
}
#define openat worker_race_open
#include "../../../native/darwin/MuseSparkCreated.c"
