// Directory protocol: op base baseIdentity child id tokenOrHash rootIdentity.
// File protocol: op parent parentIdentity source destination previousIdentity sourceIdentity.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
// Darwin builds with cc; the Linux compatibility build exercises the same *at walk.
#include <sys/stat.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#include <linux/stat.h>
#include <sys/syscall.h>
#endif

static const char *marker = ".muse-owner.json";
static void refuse(void) { fputs("created directory helper refused\n", stderr); exit(1); }
static struct stat info(int fd) { struct stat s; if (fstat(fd, &s)) refuse(); return s; }
static void identity(struct stat s, char *out) {
  snprintf(out, 64, "%llu:%llu", (unsigned long long)s.st_dev, (unsigned long long)s.st_ino);
}
static void match(struct stat s, const char *expected) {
  char key[64]; identity(s, key); if (!s.st_ino || strcmp(key, expected)) refuse();
}
static void private_dir(struct stat s) {
  if (!S_ISDIR(s.st_mode) || s.st_uid != getuid() || (s.st_mode & 0022)) refuse();
}
static int leaf(const char *name) {
  return name[0] && !strchr(name, '/') && strcmp(name, ".") && strcmp(name, "..");
}
static int move_entry(int parent, const char *source, const char *target, int exchange) {
#ifdef __APPLE__
  return renameatx_np(parent, source, parent, target, exchange ? RENAME_SWAP : RENAME_EXCL);
#else
  return renameat2(parent, source, parent, target, exchange ? RENAME_EXCHANGE : RENAME_NOREPLACE);
#endif
}
static void same_name(int parent, const char *name, struct stat held) {
  struct stat current;
  if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) ||
      current.st_dev != held.st_dev || current.st_ino != held.st_ino) refuse();
}
static void fresh(int fd, struct timespec started) {
#ifdef __APPLE__
  struct timespec born = info(fd).st_birthtimespec;
#else
  struct statx sample;
  if (syscall(SYS_statx, fd, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW, STATX_BTIME, &sample) ||
      !(sample.stx_mask & STATX_BTIME)) refuse();
  struct timespec born = { sample.stx_btime.tv_sec, sample.stx_btime.tv_nsec };
#endif
  if (born.tv_sec < started.tv_sec ||
      (born.tv_sec == started.tv_sec && born.tv_nsec < started.tv_nsec)) refuse();
}
static void publish(int parent, const char *stage, const char *target, const char *previous, const char *expected) {
  int fd = openat(parent, stage, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); if (fd < 0) refuse();
  struct stat held = info(fd); match(held, expected);
  if (!S_ISREG(held.st_mode) || held.st_uid != getuid() || (held.st_mode & 0022)) refuse();
  if (!previous[0]) {
    if (linkat(parent, stage, parent, target, 0)) refuse();
    same_name(parent, target, held);
  } else {
    char candidate[512];
    if (snprintf(candidate, sizeof(candidate), "%s.publish", stage) >= (int)sizeof(candidate)) refuse();
    // Link is no-replace. Retain both staging names: unlink by name could lose a swapped file.
    if (linkat(parent, stage, parent, candidate, 0)) refuse();
    same_name(parent, candidate, held);
    if (move_entry(parent, candidate, target, 1)) refuse();
    struct stat displaced; char key[64];
    if (fstatat(parent, candidate, &displaced, AT_SYMLINK_NOFOLLOW)) refuse();
    identity(displaced, key);
    if (strcmp(key, previous)) {
      if (move_entry(parent, candidate, target, 1)) refuse();
      refuse();
    }
    same_name(parent, target, held);
    // The displaced verified manifest is retained; no external-name file unlink is safe on POSIX.
  }
  close(fd); puts("{\"published\":true}");
}
static int directory(int parent, const char *name) {
  int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) refuse();
  return fd;
}
static void empty(int fd) {
  DIR *d = fdopendir(dup(fd)); if (!d) refuse();
  errno = 0; struct dirent *e;
  while ((e = readdir(d))) if (strcmp(e->d_name, ".") && strcmp(e->d_name, "..")) refuse();
  if (errno) refuse();
  closedir(d);
}
static void marker_matches(int root, const char *id, const char *hash) {
  int fd = openat(root, marker, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); if (fd < 0) refuse();
  struct stat s = info(fd);
  if (!S_ISREG(s.st_mode) || s.st_size <= 0 || s.st_size >= 256 || s.st_uid != getuid() || (s.st_mode & 0022)) refuse();
  char bytes[256] = {0}, got_id[64] = {0}, token[64] = {0}, canonical[256];
  ssize_t n = read(fd, bytes, sizeof(bytes) - 1); close(fd); if (n != s.st_size || (size_t)n != strlen(bytes)) refuse();
  if (sscanf(bytes, "{\"id\":\"%63[0-9a-f-]\",\"token\":\"%63[0-9a-f]\"}", got_id, token) != 2 || strlen(token) != 32) refuse();
  snprintf(canonical, sizeof(canonical), "{\"id\":\"%s\",\"token\":\"%s\"}", got_id, token);
  if (strcmp(bytes, canonical) || strcmp(id, got_id)) refuse();
  unsigned char digest[32]; char hex[65];
#ifdef __APPLE__
  CC_SHA256(token, (CC_LONG)strlen(token), digest);
#else
  SHA256((unsigned char *)token, strlen(token), digest);
#endif
  for (int i = 0; i < 32; i++) snprintf(hex + 2*i, 3, "%02x", digest[i]);
  if (strcmp(hex, hash)) refuse();
}
#ifdef __linux__
static unsigned long long mount_id(int fd) {
  char name[64], line[256]; unsigned long long id = 0;
  snprintf(name, sizeof(name), "/proc/self/fdinfo/%d", fd);
  FILE *file = fopen(name, "r"); if (!file) refuse();
  while (fgets(line, sizeof(line), file)) if (sscanf(line, "mnt_id: %llu", &id) == 1) break;
  if (ferror(file) || !id) refuse();
  fclose(file); return id;
}
#endif
static void walk(int fd, dev_t root_device, unsigned long long root_mount) {
  DIR *d = fdopendir(dup(fd)); if (!d) refuse();
  struct dirent *e; errno = 0;
  while ((e = readdir(d))) {
    const char *name = e->d_name; if (!strcmp(name, ".") || !strcmp(name, "..")) continue;
    struct stat observed; if (fstatat(fd, name, &observed, AT_SYMLINK_NOFOLLOW)) refuse();
    if (S_ISDIR(observed.st_mode)) {
      if (observed.st_dev != root_device) refuse();
      int child = directory(fd, name); struct stat held = info(child);
      if (held.st_dev != observed.st_dev || held.st_ino != observed.st_ino) refuse();
#ifdef __linux__
      if (mount_id(child) != root_mount) refuse();
#endif
      walk(child, root_device, root_mount);
      // Recheck immediately before empty-only removal while child remains held.
      same_name(fd, name, held);
      if (unlinkat(fd, name, AT_REMOVEDIR)) refuse();
      close(child);
    } else if (unlinkat(fd, name, 0)) refuse(); // Symlinks are unlinked themselves.
    errno = 0;
  }
  if (errno) refuse();
  closedir(d);
}
int muse_created_main(int argc, char **argv) {
  if (argc != 8) refuse();
  const char *op=argv[1], *base=argv[2], *base_id=argv[3], *name=argv[4], *id=argv[5], *value=argv[6];
  if (!leaf(name) || !leaf(id)) refuse();
  int parent = open(base, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); if (parent < 0) refuse();
  struct stat parent_info = info(parent); private_dir(parent_info); match(parent_info, base_id);
  if (!strcmp(op, "publish")) { publish(parent, name, id, value, argv[7]); close(parent); return 0; }
  if (!strcmp(op, "rename")) {
    struct stat source; if (fstatat(parent, name, &source, AT_SYMLINK_NOFOLLOW)) refuse();
    match(source, argv[7]);
    if (move_entry(parent, name, id, 0)) refuse();
    close(parent); puts("{\"renamed\":true}"); return 0;
  }
  if (strncmp(name, "muse-tree-", 10) || strspn(name + 10, "0123456789abcdef-") != strlen(name + 10) || !name[10] || !id[0] || strspn(id, "0123456789abcdef-") != strlen(id)) refuse();
  if (!strcmp(op, "create") || !strcmp(op, "mkdir")) {
    if (strlen(value) != 32 || strspn(value, "0123456789abcdef") != 32) refuse();
    struct timespec started;
#ifdef __linux__
    // The filesystem uses the kernel's coarse realtime clock; avoid false refusals from its tick lag.
    if (clock_gettime(CLOCK_REALTIME_COARSE, &started)) refuse();
#else
    if (clock_gettime(CLOCK_REALTIME, &started)) refuse();
#endif
    if (mkdirat(parent, name, 0700)) refuse();
    int root = directory(parent, name); struct stat s = info(root); private_dir(s); empty(root); fresh(root, started);
    if (!strcmp(op, "mkdir")) {
      char key[64]; identity(s, key); printf("{\"identity\":\"%s\"}\n", key);
      close(root); close(parent); return 0;
    }
    char bytes[256]; int length = snprintf(bytes, sizeof(bytes), "{\"id\":\"%s\",\"token\":\"%s\"}", id, value);
    if (length < 0 || (size_t)length >= sizeof(bytes)) refuse();
    int file = openat(root, marker, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (file < 0 || write(file, bytes, (size_t)length) != length || fsync(file)) refuse();
    close(file);
    if (mkdirat(root, "browser-profile", 0700) || mkdirat(root, "browser-cache", 0700)) refuse();
    char key[64]; identity(s, key); printf("{\"identity\":\"%s\"}\n", key); close(root);
  } else if (!strcmp(op, "remove")) {
    int source = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (source < 0) { if (errno == ENOENT) { puts("{\"removed\":true}"); close(parent); return 0; } refuse(); }
    struct stat original = info(source); private_dir(original); match(original, argv[7]); marker_matches(source, id, value);
    char trash[128]; if (snprintf(trash, sizeof(trash), ".muse-trash-%s", id) >= (int)sizeof(trash)) refuse();
    struct stat occupied; if (!fstatat(parent, trash, &occupied, AT_SYMLINK_NOFOLLOW) || errno != ENOENT) refuse();
    if (move_entry(parent, name, trash, 0)) refuse();
    int root = directory(parent, trash); struct stat held = info(root); match(held, argv[7]); marker_matches(root, id, value);
    unsigned long long root_mount = 0;
#ifdef __linux__
    root_mount = mount_id(root);
#endif
    walk(root, held.st_dev, root_mount);
    same_name(parent, trash, held);
    if (unlinkat(parent, trash, AT_REMOVEDIR)) refuse();
    close(root); close(source); puts("{\"removed\":true}");
  } else refuse();
  close(parent); return 0;
}

#ifdef MUSE_CREATED_STANDALONE
int main(int argc, char **argv) { return muse_created_main(argc, argv); }
#endif
