// Directory helper protocol: op base baseIdentity child id tokenOrHash rootIdentity.
// Darwin builds with cc; the Linux compatibility build exercises the same *at walk.
#include <sys/stat.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
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
      // unlinkat(AT_REMOVEDIR) is empty-only even if this name was replaced.
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
  if (strncmp(name, "muse-tree-", 10) || strspn(name + 10, "0123456789abcdef-") != strlen(name + 10) || !name[10] || !id[0] || strspn(id, "0123456789abcdef-") != strlen(id)) refuse();
  int parent = open(base, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); if (parent < 0) refuse();
  struct stat parent_info = info(parent); private_dir(parent_info); match(parent_info, base_id);
  if (!strcmp(op, "create")) {
    if (strlen(value) != 32 || strspn(value, "0123456789abcdef") != 32) refuse();
    if (mkdirat(parent, name, 0700)) refuse();
    int root = directory(parent, name); struct stat s = info(root); private_dir(s); empty(root);
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
    if (renameat(parent, name, parent, trash)) refuse();
    int root = directory(parent, trash); struct stat held = info(root); match(held, argv[7]); marker_matches(root, id, value);
    unsigned long long root_mount = 0;
#ifdef __linux__
    root_mount = mount_id(root);
#endif
    walk(root, held.st_dev, root_mount);
    if (unlinkat(parent, trash, AT_REMOVEDIR)) refuse();
    close(root); close(source); puts("{\"removed\":true}");
  } else refuse();
  close(parent); return 0;
}

#ifdef MUSE_CREATED_STANDALONE
int main(int argc, char **argv) { return muse_created_main(argc, argv); }
#endif
