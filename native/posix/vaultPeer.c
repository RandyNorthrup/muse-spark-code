/* Owned v1 peer protocol on fd 3; value-free identity and kernel-lock modes. No logs. */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <sys/stat.h>
#include <sys/file.h>
#ifdef __APPLE__
#include <sys/un.h>
#include <libproc.h>
#endif

/* Owned, value-free process identity. Recheck birth after reading the image. */
static int read_identity(pid_t pid, unsigned long *uid_out, uint64_t *birth_out,
                         char *image, pid_t *ppid_out) {
  unsigned long uid;
  uint64_t birth;
  pid_t ppid = 0;
#ifdef __APPLE__
  struct proc_bsdinfo before, after;
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before)) != (int)sizeof(before) ||
      proc_pidpath(pid, image, PATH_MAX) <= 0 ||
      proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != (int)sizeof(after))
    return errno == ESRCH ? 2 : 1;
  if (before.pbi_pid != (uint32_t)pid || before.pbi_start_tvsec != after.pbi_start_tvsec ||
      before.pbi_start_tvusec != after.pbi_start_tvusec || before.pbi_uid != after.pbi_uid ||
      before.pbi_ppid != after.pbi_ppid)
    return 1;
  uid = before.pbi_uid;
  birth = before.pbi_start_tvsec * UINT64_C(1000000) + before.pbi_start_tvusec;
  ppid = (pid_t)before.pbi_ppid;
#elif defined(__linux__)
  char directory[64], raw[8192], latest[8192];
  snprintf(directory, sizeof(directory), "/proc/%ld", (long)pid);
  int root = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) return errno == ENOENT ? 2 : 1;
  struct stat info;
  int fd = openat(root, "stat", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  ssize_t count = fd < 0 ? -1 : read(fd, raw, sizeof(raw) - 1);
  if (fd >= 0) close(fd);
  if (count <= 0 || fstat(root, &info) != 0) { close(root); return 1; }
  raw[count] = '\0';
  ssize_t length = readlinkat(root, "exe", image, PATH_MAX - 1);
  fd = openat(root, "stat", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  count = fd < 0 ? -1 : read(fd, latest, sizeof(latest) - 1);
  if (fd >= 0) close(fd);
  close(root);
  if (count <= 0) return 1;
  latest[count] = '\0';
  char *fields = strrchr(raw, ')'), *other = strrchr(latest, ')');
  if (!fields || !other) return 1;
  /* Field 3 is state, field 4 the parent pid, field 22 the birth tick. */
  char *saved = NULL, *token = strtok_r(fields + 2, " ", &saved);
  char *saved_other = NULL, *comparison = strtok_r(other + 2, " ", &saved_other);
  if (!token || !comparison) return 1;
  if (*token == 'Z' || *comparison == 'Z') return 2;
  if (length <= 0) return 1;
  image[length] = '\0';
  char *parent_token = NULL, *parent_comparison = NULL;
  for (int field = 3; field < 22; field++) {
    token = strtok_r(NULL, " ", &saved);
    comparison = strtok_r(NULL, " ", &saved_other);
    if (!token || !comparison) return 1;
    if (field == 3) { parent_token = token; parent_comparison = comparison; }
  }
  if (strcmp(token, comparison) != 0) return 1;
  if (!parent_token || strcmp(parent_token, parent_comparison) != 0) return 1;
  char *end;
  errno = 0;
  birth = strtoull(token, &end, 10);
  if (errno || *end || birth == 0) return 1;
  errno = 0;
  long parent_pid = strtol(parent_token, &end, 10);
  if (errno || *end || parent_pid < 0 || parent_pid > INT_MAX) return 1;
  ppid = (pid_t)parent_pid;
  uid = info.st_uid;
#else
  (void)pid;
  return 1;
#endif
  if (birth > UINT64_C(9007199254740991)) return 1;
  *uid_out = uid;
  *birth_out = birth;
  *ppid_out = ppid;
  return 0;
}

static int print_identity(pid_t pid, unsigned long uid, uint64_t birth, const char *image) {
  /* JSON escaping without locale dependence; no image bytes reach stderr. */
  printf("{\"processId\":%ld,\"userId\":\"%lu\",\"startedAt\":%llu,\"executable\":\"",
    (long)pid, uid, (unsigned long long)birth);
  for (const unsigned char *p = (const unsigned char *)image; *p; p++) {
    if (*p < 32) printf("\\u%04x", (unsigned int)*p);
    else { if (*p == '"' || *p == '\\') putchar('\\'); putchar(*p); }
  }
  return puts("\"}") < 0 ? 1 : 0;
}

static int identity(pid_t pid) {
  unsigned long uid;
  uint64_t birth;
  pid_t ppid;
  char image[PATH_MAX];
  int result = read_identity(pid, &uid, &birth, image, &ppid);
  if (result != 0) return result;
  return print_identity(pid, uid, birth, image);
}

/* D216: the parent process's identity, for the broker's ancestry walk. */
static int parent_identity(pid_t pid) {
  unsigned long uid;
  uint64_t birth;
  pid_t ppid;
  char image[PATH_MAX];
  int result = read_identity(pid, &uid, &birth, image, &ppid);
  if (result != 0) return result;
  if (ppid <= 0) return 2;
  return identity(ppid);
}

#define main vault_peer
#include "../../src/core/vault/broker/peer.c"
#undef main

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "identity") == 0) {
    char *end;
    errno = 0;
    long pid = strtol(argv[2], &end, 10);
    if (errno || *end || pid <= 0 || pid > INT_MAX) return 1;
    return identity((pid_t)pid);
  }
  if (argc == 3 && strcmp(argv[1], "parent") == 0) {
    char *end;
    errno = 0;
    long pid = strtol(argv[2], &end, 10);
    if (errno || *end || pid <= 0 || pid > INT_MAX) return 1;
    return parent_identity((pid_t)pid);
  }
  if (argc == 2 && (strcmp(argv[1], "lock") == 0 || strcmp(argv[1], "lock-wait") == 0)) {
    struct stat info;
    if (fstat(3, &info) != 0 || !S_ISREG(info.st_mode) || info.st_uid != getuid() ||
        info.st_nlink != 1 || (info.st_mode & (S_IRWXG | S_IRWXO)) != 0) return 1;
    if (flock(3, LOCK_EX | (strcmp(argv[1], "lock-wait") == 0 ? 0 : LOCK_NB)) != 0) return errno == EWOULDBLOCK ? 2 : 1;
    if (puts("{\"v\":1,\"locked\":true}") < 0 || fflush(stdout) != 0) return 1;
    char byte;
    while (read(STDIN_FILENO, &byte, 1) > 0) { /* EOF releases the kernel lock. */ }
    return 0;
  }
  if (argc != 1) return 1;
  return vault_peer();
}
