// D107 §9.4, B1 macOS. No shell, no directory read grant, ambient environment
// never reaches the child. Enforcement is Seatbelt: the helper walks the
// workspace with no-follow opens (same privacy policy as Linux, policy.h),
// writes a literal-path profile, prints the protocol line, then execs
// /usr/bin/sandbox-exec. Seatbelt checks every open at open time, so a swap
// after the walk can only deny (the new path is outside the profile), never
// allow — except an inode swap beneath an allowed path, which path-based
// profiles cannot see. That walk-to-exec window (one synchronous process, no
// awaits) is the documented macOS residual; Linux Landlock grants inodes and
// has no such window.
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <arpa/inet.h>
#include <mach-o/dyld.h>
#include <netinet/in.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "policy.h"

#ifdef __APPLE__
// The Darwin ABI arrives via policy.h: one source of truth with the TS side.
#define B1_SANDBOX_EXEC "/usr/bin/sandbox-exec"
// Upper bound for the inherited-descriptor sweep (B1-10 opens a hundred).
#define B1_DARWIN_MAX_FD 65536

static int profile_fd = -1;
static size_t visited, excluded;
static dev_t device;
static struct timespec started;
static char root_absolute[PATH_MAX];
static char home_absolute[PATH_MAX];

static void refuse(const char *reason) {
  fprintf(stderr, "{\"refused\":\"%s\"}\n", reason);
  exit(JUDGE_FAST_B1_REFUSED_EXIT);
}
static struct stat info(int fd) {
  struct stat s;
  if (fstat(fd, &s)) refuse("file");
  return s;
}
static int canonical_path(const char *path, char *canonical) {
  if (!*path || *path == '/' || strlen(path) >= PATH_MAX) return 0;
  size_t length = 0;
  const char *part = path;
  for (const char *p = path;; p++) {
    unsigned char c = (unsigned char)*p;
    if (c >= 127 || c == '\\' || (c && c < 32)) return 0;
    if (!c || c == '/') {
      size_t n = (size_t)(p - part);
      if (n > NAME_MAX) return 0;
      if (n == 2 && part[0] == '.' && part[1] == '.') {
        if (!length) return 0;
        while (length && canonical[length - 1] != '/') length--;
        if (length) length--;
      } else if (n && !(n == 1 && part[0] == '.')) {
        if (length) canonical[length++] = '/';
        memcpy(canonical + length, part, n); length += n;
      }
      if (!c) break;
      part = p + 1;
    }
  }
  if (!length) canonical[length++] = '.';
  canonical[length] = 0;
  if (*canonical == '-' || *canonical == '!' ||
      (isalpha((unsigned char)canonical[0]) && canonical[1] == ':')) return 0;
  return 1;
}
static int listed(const char *name, const char *const *list) {
  for (size_t i = 0; list[i]; i++) if (!strcmp(name, list[i])) return 1;
  return 0;
}
static int private_path(const char *path) {
  char canonical[PATH_MAX], lower[PATH_MAX];
  // The trusted grammar rewrites both operand lists. Direct helper callers must agree.
  if (!canonical_path(path, canonical) || strcmp(path, canonical)) return 1;
  for (size_t i = 0; i <= strlen(canonical); i++) lower[i] = (char)tolower((unsigned char)canonical[i]);
  for (const char *part = lower; *part;) {
    for (size_t i = 0; PROTECTED_PATH_SEGMENTS[i]; i++) {
      const char *component = part, *protected = PROTECTED_PATH_SEGMENTS[i];
      for (;;) {
        size_t n = strcspn(component, "/"), m = strcspn(protected, "/");
        if (n != m || memcmp(component, protected, n)) break;
        if (!protected[m]) return 1;
        if (!component[n]) break;
        component += n + 1; protected += m + 1;
      }
    }
    const char *end = strchr(part, '/');
    size_t n = end ? (size_t)(end - part) : strlen(part);
    char name[NAME_MAX + 1];
    if (n > NAME_MAX) return 1;
    memcpy(name, part, n); name[n] = 0;
    const char *suffix = strrchr(name, '.');
    if (listed(name, PROTECTED_FILE_NAMES) || listed(name, PRIVATE_ATTACHMENT_NAMES) ||
        !strncmp(name, PRIVATE_ENV_PREFIX, strlen(PRIVATE_ENV_PREFIX)) ||
        (suffix && listed(suffix, PRIVATE_ATTACHMENT_EXTENSIONS))) return 1;
    if (!end) break;
    part = end + 1;
  }
  return 0;
}
static void budget(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now)) refuse("clock");
  int64_t ns = ((int64_t)now.tv_sec - (int64_t)started.tv_sec) * 1000000000 + now.tv_nsec - started.tv_nsec;
  if (visited > JUDGE_FAST_B1_WALK_MAX_ENTRIES || ns > JUDGE_FAST_B1_WALK_MAX_MS * 1000000LL) refuse("walkBudget");
}
// One component, never a slash: no-follow, same device checked by the caller.
static int open_component(int parent, const char *name, int want_dir) {
  if (!*name || strchr(name, '/')) refuse("operand");
  int flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (want_dir ? O_DIRECTORY : 0);
  return openat(parent, name, flags);
}
static void write_escaped(const char *path) {
  for (const char *p = path; *p; p++) {
    if (*p == '\\' || *p == '"') dprintf(profile_fd, "\\");
    dprintf(profile_fd, "%c", *p);
  }
}
static void allow_literal(const char *path) {
  dprintf(profile_fd, "(allow file-read* (literal \"");
  write_escaped(path);
  dprintf(profile_fd, "\"))\n");
}
// Seatbelt denies everything under (deny default), including executing the
// verified target and mapping it with dyld: both need explicit rules. The
// system reads below cover the loader and its shared cache only; /etc and
// every other tree stay denied, and workspace reads stay literal.
static void allow_exec(const char *path) {
  dprintf(profile_fd, "(allow process-exec (literal \"");
  write_escaped(path);
  dprintf(profile_fd, "\"))\n");
}
static void allow_system(void) {
  dprintf(profile_fd, "(allow file-read* (subpath \"/bin\") (subpath \"/sbin\") (subpath \"/usr\") (subpath \"/System\"))\n");
}
static void allow_absolute(const char *relative) {
  char absolute[PATH_MAX];
  int n = !strcmp(relative, ".")
    ? snprintf(absolute, sizeof(absolute), "%s", root_absolute)
    : snprintf(absolute, sizeof(absolute), "%s/%s", root_absolute, relative);
  if (n < 0 || (size_t)n >= sizeof(absolute)) refuse("walkBudget");
  allow_literal(absolute);
}
static void walk(int fd, const char *relative, int recursive, size_t depth) {
  if (depth > JUDGE_FAST_B1_WALK_MAX_DEPTH) refuse("walkBudget");
  budget();
  struct stat s = info(fd);
  if (s.st_dev != device || (!S_ISDIR(s.st_mode) && (!S_ISREG(s.st_mode) || s.st_nlink != 1))) refuse("operand");
  allow_absolute(relative);
  if (!recursive || !S_ISDIR(s.st_mode)) return;
  int listing = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (listing < 0) refuse("walk");
  struct stat held = info(listing);
  if (held.st_dev != device || !S_ISDIR(held.st_mode)) refuse("walk");
  DIR *directory = fdopendir(listing);
  if (!directory) refuse("walk");
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (!entry) { if (errno) refuse("walk"); break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    visited++; budget();
    char name[PATH_MAX];
    int n = !strcmp(relative, ".")
      ? snprintf(name, sizeof(name), "%s", entry->d_name)
      : snprintf(name, sizeof(name), "%s/%s", relative, entry->d_name);
    if (n < 0 || (size_t)n >= sizeof(name)) refuse("walkBudget");
    if (private_path(name)) { excluded++; continue; }
    int child = open_component(fd, entry->d_name, 0);
    if (child < 0) { excluded++; continue; }
    struct stat kept = info(child);
    if (kept.st_dev != device || (!S_ISDIR(kept.st_mode) && (!S_ISREG(kept.st_mode) || kept.st_nlink != 1))) excluded++;
    else walk(child, name, recursive, depth + 1);
    close(child);
  }
  closedir(directory);
  budget();
}
// A canonical relative operand, component by component: intermediates must be
// directories, the leaf a directory or a single-link file, all same-device.
static int resolve_operand(int root, const char *operand) {
  int cursor = openat(root, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (cursor < 0) refuse("operand");
  // The grammar's default operand names the root itself; anything else is
  // split into components below, where bare dots stay refused.
  if (!strcmp(operand, ".")) return cursor;
  const char *rest = operand;
  for (;;) {
    const char *slash = strchr(rest, '/');
    size_t n = slash ? (size_t)(slash - rest) : strlen(rest);
    if (!n || n > NAME_MAX) refuse("privateOperand");
    char component[NAME_MAX + 1];
    memcpy(component, rest, n); component[n] = 0;
    if (!strcmp(component, ".") || !strcmp(component, "..")) refuse("privateOperand");
    int last = slash == NULL;
    int child = open_component(cursor, component, !last);
    close(cursor);
    if (child < 0) refuse("operand");
    struct stat s = info(child);
    if (s.st_dev != device || !S_ISDIR(s.st_mode)) {
      if (last && S_ISREG(s.st_mode) && s.st_nlink == 1) return child;
      close(child);
      refuse("operand");
    }
    if (last) return child;
    cursor = child;
    rest = slash + 1;
  }
}
// Only root-owned, non-writable system files and ancestry. realpath's resolved path is execve's path.
static int system_file(const char *given, char *resolved) {
  if (!realpath(given, resolved)) refuse("systemFile");
  if (strncmp(resolved, "/usr/", 5) && strncmp(resolved, "/bin/", 5) &&
      strncmp(resolved, "/sbin/", 6) && strcmp(resolved, "/etc/ld.so.cache")) refuse("systemFile");
  char ancestry[PATH_MAX]; strcpy(ancestry, resolved);
  for (;;) {
    struct stat s;
    if (lstat(ancestry, &s) || s.st_uid || (s.st_mode & 0022) || S_ISLNK(s.st_mode) || !access(ancestry, W_OK)) refuse("systemFile");
    if (!strcmp(ancestry, "/")) break;
    char *slash = strrchr(ancestry, '/');
    if (!slash) refuse("systemFile");
    if (slash == ancestry) slash[1] = 0; else *slash = 0;
  }
  int fd = open(resolved, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) refuse("systemFile");
  struct stat s = info(fd), named;
  if (!S_ISREG(s.st_mode) || s.st_uid || (s.st_mode & 0022) ||
      stat(resolved, &named) || s.st_dev != named.st_dev || s.st_ino != named.st_ino) refuse("systemFile");
  return fd;
}
static const char *program_path(const char *name) {
  static const char *names[] = {"ls", "cat", "head", "tail", "wc", "stat", "du", "grep", "find", NULL};
  static const char *paths[] = {"/bin/ls", "/bin/cat", "/usr/bin/head", "/usr/bin/tail", "/usr/bin/wc", "/usr/bin/stat", "/usr/bin/du", "/usr/bin/grep", "/usr/bin/find"};
  for (size_t i = 0; names[i]; i++) if (!strcmp(name, names[i])) return paths[i];
  refuse("program"); return NULL;
}
static void check_home(int home) {
  struct stat h = info(home);
  if (h.st_uid != getuid() || (h.st_mode & 0077)) refuse("home");
  DIR *empty = fdopendir(home);
  if (!empty) refuse("home");
  errno = 0; struct dirent *entry;
  while ((entry = readdir(empty))) if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..")) refuse("home");
  if (errno) refuse("home");
  closedir(empty);
}
static void open_profile(int home) {
  profile_fd = openat(home, "profile.sb", O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (profile_fd < 0) refuse("home");
  dprintf(profile_fd, "(version 1)\n(deny default)\n");
}
static void self_path(char *resolved) {
  char image[PATH_MAX];
  uint32_t size = sizeof(image);
  if (_NSGetExecutablePath(image, &size)) refuse("exec");
  if (!realpath(image, resolved)) refuse("exec");
}
// The confined probe: every denial must hold and the allowed read must work.
// Runs under sandbox-exec; a direct unconfined run refuses (fork succeeds).
static void probe_child(const char *dir, const char *allowed, const char *denied, const char *late) {
  char path[PATH_MAX];
  int n = snprintf(path, sizeof(path), "%s/%s", dir, late);
  if (n < 0 || (size_t)n >= sizeof(path)) refuse("request");
  errno = 0;
  int late_fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  // Seatbelt denials surface as EPERM, not EACCES; either proves the profile held.
  if (late_fd >= 0 || (errno != EACCES && errno != EPERM)) refuse("postWalkRead");
  n = snprintf(path, sizeof(path), "%s/%s", dir, denied);
  if (n < 0 || (size_t)n >= sizeof(path)) refuse("request");
  errno = 0;
  int denied_fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (denied_fd >= 0 || (errno != EACCES && errno != EPERM)) refuse("postWalkRead");
  n = snprintf(path, sizeof(path), "%s/%s", dir, allowed);
  if (n < 0 || (size_t)n >= sizeof(path)) refuse("request");
  int allowed_fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (allowed_fd < 0) refuse("selfTest");
  char byte = 0;
  if (read(allowed_fd, &byte, 1) != 1) refuse("selfTest");
  close(allowed_fd);
  n = snprintf(path, sizeof(path), "%s/child-must-not-create", dir);
  if (n < 0 || (size_t)n >= sizeof(path)) refuse("request");
  errno = 0;
  int created = open(path, O_CREAT | O_WRONLY | O_CLOEXEC, 0600);
  if (created >= 0 || (errno != EACCES && errno != EPERM)) refuse("write");
  errno = 0;
  pid_t pid = fork();
  // Seatbelt denies process creation: any success means no confinement.
  if (pid == 0) _exit(JUDGE_FAST_B1_REFUSED_EXIT);
  if (pid > 0) { int status = 0; waitpid(pid, &status, 0); refuse("processCreation"); }
  if (errno != EPERM && errno != EACCES) refuse("processCreation");
  int pair = socket(AF_INET, SOCK_STREAM, 0);
  if (pair >= 0) {
    struct sockaddr_in loopback;
    memset(&loopback, 0, sizeof(loopback));
    loopback.sin_family = AF_INET;
    loopback.sin_port = htons(1);
    loopback.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    errno = 0;
    int connected = connect(pair, (struct sockaddr *)&loopback, sizeof(loopback));
    int refused_errno = errno;
    close(pair);
    // Anything but a policy denial proves packets flow: fail closed.
    if (connected == 0 || (refused_errno != EPERM && refused_errno != EACCES)) refuse("network");
  } else if (errno != EPERM && errno != EACCES) {
    refuse("network");
  }
  printf("{\"abi\":%d,\"confined\":true}\n", JUDGE_FAST_B1_DARWIN_ABI);
}
static void spawn_confined(char *const args[], int read_fd, int write_fd) {
  pid_t pid = fork();
  if (pid == 0) {
    close(read_fd);
    if (dup2(write_fd, STDOUT_FILENO) < 0) _exit(JUDGE_FAST_B1_REFUSED_EXIT);
    close(write_fd);
    char *environment[] = {"PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC0", NULL};
    execve(args[0], args, environment);
    _exit(JUDGE_FAST_B1_REFUSED_EXIT);
  }
  if (pid < 0) refuse("exec");
  close(write_fd);
  int status = 0;
  char output[JUDGE_FAST_B1_PROTOCOL_MAX_BYTES + 1];
  size_t used = 0;
  ssize_t n;
  while ((n = read(read_fd, output + used, sizeof(output) - 1 - used)) > 0) {
    used += (size_t)n;
    if (used >= JUDGE_FAST_B1_PROTOCOL_MAX_BYTES) break;
  }
  close(read_fd);
  while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
  output[used] = 0;
  char expected[64];
  int m = snprintf(expected, sizeof(expected), "{\"abi\":%d,\"confined\":true}\n", JUDGE_FAST_B1_DARWIN_ABI);
  if (m < 0 || (size_t)m >= sizeof(expected)) refuse("protocol");
  if (!WIFEXITED(status) || WEXITSTATUS(status) || strcmp(output, expected)) refuse("selfTest");
  printf("%s", expected);
}
// The profile is written before the late insert: anything the walk did not
// see must be denied, and the allowed read must still work.
static void probe(void) {
  if (mkdir("probe-tree", 0700)) refuse("selfTest");
  int allowed = open("probe-tree/allowed", O_CREAT | O_EXCL | O_RDONLY, 0600);
  int denied = open("probe-denied", O_CREAT | O_EXCL | O_RDONLY, 0600);
  if (allowed < 0 || denied < 0) refuse("selfTest");
  close(allowed);
  close(denied);
  char sandbox[PATH_MAX], self[PATH_MAX], cwd[PATH_MAX];
  int se = system_file(B1_SANDBOX_EXEC, sandbox);
  close(se);
  self_path(self);
  if (!getcwd(cwd, sizeof(cwd))) refuse("selfTest");
  int cwd_fd = open(cwd, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (cwd_fd < 0) refuse("selfTest");
  open_profile(cwd_fd);
  close(cwd_fd);
  if (!realpath(".", root_absolute)) refuse("selfTest");
  allow_system();
  allow_exec(self);
  allow_literal(self);
  allow_absolute("probe-tree");
  allow_absolute("probe-tree/allowed");
  close(profile_fd);
  profile_fd = -1;
  if (link("probe-denied", "probe-tree/late")) refuse("selfTest");
  char profile[PATH_MAX], dir[PATH_MAX];
  int n = snprintf(profile, sizeof(profile), "%s/profile.sb", root_absolute);
  if (n < 0 || (size_t)n >= sizeof(profile)) refuse("selfTest");
  n = snprintf(dir, sizeof(dir), "%s/probe-tree", root_absolute);
  if (n < 0 || (size_t)n >= sizeof(dir)) refuse("selfTest");
  int out[2];
  if (pipe(out)) refuse("exec");
  char *args[] = {sandbox, "-f", profile, self, "probe-child", dir, "allowed",
                  "probe-denied", "late", NULL};
  spawn_confined(args, out[0], out[1]);
}
int main(int argc, char **argv) {
  if (!getuid() || !geteuid()) refuse("root");
  if (argc == 2 && !strcmp(argv[1], "probe")) { probe(); return 0; }
  if (argc == 6 && !strcmp(argv[1], "probe-child")) {
    probe_child(argv[2], argv[3], argv[4], argv[5]);
    return 0;
  }
  // run root device:inode emptyHome recursive program operand... -- toolArg...
  if (argc < 9 || strcmp(argv[1], "run")) refuse("request");
  if (!realpath(argv[2], root_absolute)) refuse("workspace");
  int root = open(root_absolute, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) refuse("workspace");
  struct stat s = info(root);
  device = s.st_dev;
  char identity[64];
  snprintf(identity, sizeof(identity), "%llu:%llu", (unsigned long long)s.st_dev, (unsigned long long)s.st_ino);
  if (!s.st_ino || strcmp(identity, argv[3])) refuse("workspaceIdentity");
  // Absolute before the fchdir: sandbox-exec resolves -f after it.
  if (!realpath(argv[4], home_absolute)) refuse("home");
  int home = open(home_absolute, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (home < 0) refuse("home");
  check_home(home);
  home = open(home_absolute, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (home < 0) refuse("home");
  open_profile(home);
  close(home);
  int recursive = !strcmp(argv[5], "recursive");
  if (!recursive && strcmp(argv[5], "single")) refuse("request");
  char resolved[PATH_MAX], sandbox[PATH_MAX];
  int program = system_file(program_path(argv[6]), resolved);
  close(program);
  int se = system_file(B1_SANDBOX_EXEC, sandbox);
  close(se);
  allow_absolute(".");
  allow_system();
  allow_exec(resolved);
  allow_literal(resolved);
  if (clock_gettime(CLOCK_MONOTONIC, &started)) refuse("clock");
  int separator = 7;
  while (separator < argc && strcmp(argv[separator], "--")) {
    if (private_path(argv[separator])) refuse("privateOperand");
    int operand = resolve_operand(root, argv[separator]);
    visited++; walk(operand, argv[separator], recursive, 0); close(operand); separator++;
  }
  if (separator == 7 || separator >= argc) refuse("request");
  budget();
  close(profile_fd);
  profile_fd = -1;
  if (fchdir(root)) refuse("workspace");
  close(root);
  int null_fd = open("/dev/null", O_RDONLY | O_CLOEXEC);
  if (null_fd < 0 || dup2(null_fd, STDIN_FILENO) < 0) refuse("stdin");
  if (null_fd != STDIN_FILENO) close(null_fd);
  // The neutral environment is explicit even if the helper's caller had injected variables.
  char home_env[PATH_MAX + 5];
  int n = snprintf(home_env, sizeof(home_env), "HOME=%s", home_absolute);
  if (n < 0 || (size_t)n >= sizeof(home_env)) refuse("home");
  char *environment[] = {"PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC0", home_env, NULL};
  char profile[PATH_MAX];
  n = snprintf(profile, sizeof(profile), "%s/profile.sb", home_absolute);
  if (n < 0 || (size_t)n >= sizeof(profile)) refuse("home");
  char **tool = calloc((size_t)(argc - separator + 5), sizeof(*tool));
  if (!tool) refuse("memory");
  tool[0] = "sandbox-exec";
  tool[1] = "-f";
  tool[2] = profile;
  tool[3] = resolved;
  // Keep the requested applet name for verified system multicall executables.
  tool[4] = argv[6];
  for (int i = separator + 1; i < argc; i++) tool[i - separator + 3] = argv[i];
  // A rejected open can make a system program abort; it must not leave a core file.
  struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core)) refuse("limits");
  fprintf(stderr, "{\"confined\":true,\"abi\":%d,\"excluded\":%zu}\n", JUDGE_FAST_B1_DARWIN_ABI, excluded);
  if (fflush(stderr)) refuse("protocol");
  long open_max = sysconf(_SC_OPEN_MAX);
  if (open_max < 0 || open_max > B1_DARWIN_MAX_FD) open_max = B1_DARWIN_MAX_FD;
  for (int fd = 3; (long)fd < open_max; fd++) close(fd);
  execve(sandbox, tool, environment);
  refuse("exec");
  return JUDGE_FAST_B1_REFUSED_EXIT;
}
#else
int main(void) {
  fputs("{\"refused\":\"macosCaptureRequired\"}\n", stderr);
  return 125;
}
#endif
