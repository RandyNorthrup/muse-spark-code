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
#include <dirent.h>
#include <limits.h>
#include <stdint.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/resource.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif
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
  /* comm sits inside parentheses and may hold spaces or ')'. The last
   * ')' closes it; the fields after that are space-separated. */
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

/* D243: the parent process's identity, for the broker's ancestry walk.
 * expected_birth is the start time the walk already recorded for pid.
 * Both the first read and the re-read after the parent must still be
 * that birth, so a pid recycled between the walk's own re-read and this
 * helper cannot answer. The parent is read twice with the same birth.
 * A parent that died and whose pid was recycled inside the window
 * changes one of those facts (a dead parent also reparents the child). */
static int parent_identity(pid_t pid, uint64_t expected_birth) {
  unsigned long uid, parent_uid, again_uid, child_uid;
  uint64_t birth, parent_birth, again_birth, child_birth;
  pid_t ppid, parent_ppid, again_ppid, child_ppid;
  char image[PATH_MAX], parent_image[PATH_MAX], again_image[PATH_MAX], child_image[PATH_MAX];
  int result = read_identity(pid, &uid, &birth, image, &ppid);
  if (result != 0) return result;
  if (birth != expected_birth) return 1;
  if (ppid <= 0) return 2;
  result = read_identity(ppid, &parent_uid, &parent_birth, parent_image, &parent_ppid);
  if (result != 0) return result;
  result = read_identity(ppid, &again_uid, &again_birth, again_image, &again_ppid);
  if (result != 0) return result;
  if (again_uid != parent_uid || again_birth != parent_birth) return 1;
  result = read_identity(pid, &child_uid, &child_birth, child_image, &child_ppid);
  if (result != 0) return result;
  if (child_birth != expected_birth || child_uid != uid || child_ppid != ppid) return 1;
  return print_identity(ppid, again_uid, again_birth, again_image);
}

/* The secret sits in this process's environment until exec. A refusal
 * zeroes those bytes before returning. The pointers stay; nothing here
 * is read again. Identity and parent modes never carry the secret. */
extern char **environ;

static void wipe_bytes(void *pointer, size_t length) {
  volatile unsigned char *bytes = pointer;
  for (size_t index = 0; index < length; index++) bytes[index] = 0;
}

static void wipe_environment(void) {
  if (environ == NULL) return;
  for (char **entry = environ; *entry != NULL; entry++) wipe_bytes(*entry, strlen(*entry));
}

static int refuse_run(void) {
  wipe_environment();
  return 1;
}

/* Close every inherited descriptor above 2. The command keeps standard
 * input, output and error. More than 256 extras, a read error, or no
 * /dev/fd refuses before exec rather than handing an unknown descriptor
 * to the command. */
static int close_extra_descriptors(void) {
  DIR *table = opendir("/dev/fd");
  if (table == NULL) return 1;
  int self = dirfd(table);
  int extras[256];
  int count = 0;
  int failed = 0;
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(table);
    if (entry == NULL) {
      if (errno != 0) failed = 1;
      break;
    }
    if (entry->d_name[0] == '.') continue;
    char *end = NULL;
    errno = 0;
    long descriptor = strtol(entry->d_name, &end, 10);
    if (errno != 0 || end == entry->d_name || *end != '\0' || descriptor < 0 ||
        descriptor > INT_MAX) {
      failed = 1;
      break;
    }
    if (descriptor < 3 || descriptor == (long)self) continue;
    if (count == 256) {
      failed = 1;
      break;
    }
    extras[count++] = (int)descriptor;
  }
  if (closedir(table) != 0) failed = 1;
  if (failed) return 1;
  for (int index = 0; index < count; index++) {
    if (close(extras[index]) != 0 && errno != EBADF) return 1;
  }
  return 0;
}

/* `run <file> [args...]` becomes the delegated command. The core limit
 * is zeroed first and does survive exec of an ordinary command, so an
 * ordinary crash writes no core file. On Linux, dumpable is cleared for
 * this process until exec: the kernel sets it back to 1 for a normal
 * command (a setuid or file-capability target follows suid_dumpable
 * instead), so this does not hide the command's environment. A failure
 * to set either fact, to close an extra descriptor, or to exec refuses
 * before the command exists and wipes the environment. */
static int run_command(char **argv) {
  struct rlimit no_core;
  no_core.rlim_cur = 0;
  no_core.rlim_max = 0;
  if (setrlimit(RLIMIT_CORE, &no_core) != 0) return refuse_run();
#ifdef __linux__
  if (prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0) return refuse_run();
#endif
  if (close_extra_descriptors() != 0) return refuse_run();
  execv(argv[0], argv);
  return refuse_run();
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
  if (argc == 4 && strcmp(argv[1], "parent") == 0) {
    char *end;
    errno = 0;
    long pid = strtol(argv[2], &end, 10);
    if (errno || *end || pid <= 0 || pid > INT_MAX) return 1;
    errno = 0;
    unsigned long long birth = strtoull(argv[3], &end, 10);
    if (errno || end == argv[3] || *end || birth == 0 || birth > UINT64_C(9007199254740991))
      return 1;
    return parent_identity((pid_t)pid, (uint64_t)birth);
  }
  if (argc >= 3 && strcmp(argv[1], "run") == 0) {
    if (argv[2][0] != '/') {
      wipe_environment();
      return 1;
    }
    return run_command(argv + 2);
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
