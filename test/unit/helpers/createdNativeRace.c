// Test-only kernel interleavings immediately at the native guard boundaries.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <sys/stat.h>
#include <fcntl.h>
#include <dirent.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
static int enabled(int parent, const char *name) {
  struct stat s; return fstatat(parent, name, &s, AT_SYMLINK_NOFOLLOW) == 0;
}
static void planted_file(int parent, const char *name) {
  int fd = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (fd < 0 || write(fd, "personal manifest", 17) != 17) _exit(90);
  close(fd);
}
static int published_race;
static int race_move(int parent, const char *source, int target_parent, const char *target, unsigned flags) {
  if (!strncmp(target, ".muse-trash-", 12) && enabled(parent, ".race-rename")) {
    if (mkdirat(parent, target, 0700)) _exit(91);
  }
  if (!published_race && !strcmp(target, "records.json") && enabled(parent, ".race-publish")) {
    published_race = 1;
    if (renameat(parent, target, parent, "saved-manifest")) _exit(92);
    planted_file(parent, target);
  }
#ifdef __APPLE__
  return renameatx_np(parent, source, target_parent, target, flags);
#else
  return renameat2(parent, source, target_parent, target, flags);
#endif
}
static int race_mkdir(int parent, const char *name, mode_t mode) {
  int result = mkdirat(parent, name, mode);
  if (!result && !strncmp(name, "muse-tree-", 10) && enabled(parent, ".race-create")) {
    if (renameat(parent, name, parent, "saved-root") || renameat(parent, "personal", parent, name)) _exit(93);
  }
  return result;
}
static int trash_parent = -1, nested_parent = -1;
static ino_t nested_inode;
static char trash_name[128];
static int race_statat(int parent, const char *name, struct stat *s, int flags) {
  int result = fstatat(parent, name, s, flags);
  if (!strncmp(name, ".muse-trash-", 12)) {
    trash_parent = parent; snprintf(trash_name, sizeof(trash_name), "%s", name);
  }
  if (!result && !strcmp(name, "nested")) { nested_parent = parent; nested_inode = s->st_ino; }
  return result;
}
static int race_closedir(DIR *d) {
  struct stat s; if (fstat(dirfd(d), &s)) _exit(94);
  if (trash_parent >= 0 && enabled(trash_parent, ".race-root")) {
    if (renameat(trash_parent, trash_name, trash_parent, "saved-root") || mkdirat(trash_parent, trash_name, 0700)) _exit(95);
    trash_parent = -1;
  }
  if (nested_parent >= 0 && s.st_ino == nested_inode && enabled(nested_parent, "../.race-nested")) {
    if (renameat(nested_parent, "nested", nested_parent, "saved-nested") || mkdirat(nested_parent, "nested", 0700)) _exit(96);
    nested_parent = -1;
  }
  return closedir(d);
}
static int race_linkat(int parent, const char *source, int target_parent, const char *target, int flags) {
  if (enabled(parent, ".race-stage")) {
    if (renameat(parent, source, parent, "saved-stage")) _exit(97);
    planted_file(parent, source);
  }
  return linkat(parent, source, target_parent, target, flags);
}
#define renameat2 race_move
#define renameatx_np race_move
#define mkdirat race_mkdir
#define fstatat race_statat
#define closedir race_closedir
#define linkat race_linkat
#include "../../../native/darwin/MuseSparkCreated.c"
