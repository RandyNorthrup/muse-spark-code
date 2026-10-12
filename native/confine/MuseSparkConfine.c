// D107 §9.4. Linux B1 only. No shell, directory read-file grant or ambient environment.
// macOS stays refused until its literal Seatbelt system/service capture exists.
#define _GNU_SOURCE
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "policy.h"

#ifdef __linux__
#include <elf.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/openat2.h>
#include <linux/seccomp.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#include <sys/wait.h>
#include <time.h>

static int rules, abi;
static size_t visited, excluded;
static dev_t device;
static struct timespec started;
static char system_paths[JUDGE_FAST_B1_SYSTEM_MAX_FILES][PATH_MAX];
static size_t system_count;

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
static int beneath(int parent, const char *path, int flags) {
  struct open_how how = {
    .flags = (unsigned long long)(unsigned int)(flags | O_CLOEXEC | O_NOFOLLOW),
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV
  };
  return (int)syscall(SYS_openat2, parent, path, &how, sizeof(how));
}
static void grant(int fd, uint64_t rights) {
  struct landlock_path_beneath_attr rule = { .allowed_access = rights, .parent_fd = fd };
  if (syscall(SYS_landlock_add_rule, rules, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) refuse("landlock");
}
static void budget(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now)) refuse("clock");
  int64_t ns = ((int64_t)now.tv_sec - (int64_t)started.tv_sec) * 1000000000 + now.tv_nsec - started.tv_nsec;
  if (visited > JUDGE_FAST_B1_WALK_MAX_ENTRIES || ns > JUDGE_FAST_B1_WALK_MAX_MS * 1000000LL) refuse("walkBudget");
}
static void walk(int fd, const char *relative, int recursive, size_t depth) {
  if (depth > JUDGE_FAST_B1_WALK_MAX_DEPTH) refuse("walkBudget");
  budget();
  struct stat s = info(fd);
  if (s.st_dev != device || (!S_ISDIR(s.st_mode) && (!S_ISREG(s.st_mode) || s.st_nlink != 1))) refuse("operand");
  grant(fd, S_ISDIR(s.st_mode) ? LANDLOCK_ACCESS_FS_READ_DIR : LANDLOCK_ACCESS_FS_READ_FILE);
  if (!recursive || !S_ISDIR(s.st_mode)) return;
  int listing = beneath(fd, ".", O_RDONLY | O_DIRECTORY);
  if (listing < 0) refuse("walk");
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
    int child = beneath(fd, entry->d_name, O_PATH);
    if (child < 0) { excluded++; continue; }
    struct stat held = info(child);
    if (held.st_dev != device || (!S_ISDIR(held.st_mode) && (!S_ISREG(held.st_mode) || held.st_nlink != 1))) excluded++;
    else walk(child, name, recursive, depth + 1);
    close(child);
  }
  closedir(directory);
  budget();
}

// Only root-owned, non-writable system files and ancestry. realpath's resolved path is execve's path.
static int system_file(const char *given, char *resolved, int executable) {
  if (!realpath(given, resolved)) refuse("systemFile");
  if (strncmp(resolved, "/usr/", 5) && strncmp(resolved, "/lib", 4) && strncmp(resolved, "/bin/", 5) && strcmp(resolved, "/etc/ld.so.cache")) refuse("systemFile");
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
  if (!S_ISREG(s.st_mode) || s.st_uid || (s.st_mode & 0022) || (executable && !(s.st_mode & 0111)) ||
      stat(resolved, &named) || s.st_dev != named.st_dev || s.st_ino != named.st_ino) refuse("systemFile");
  return fd;
}
static void read_exact(int fd, void *buffer, size_t length, uint64_t offset) {
  struct stat s = info(fd);
  if (offset > (uint64_t)s.st_size || length > (uint64_t)s.st_size - offset || offset > INT64_MAX) refuse("elf");
  if (pread(fd, buffer, length, (off_t)offset) != (ssize_t)length) refuse("elf");
}
// Resolve DT_NEEDED recursively, without running ldd or a loader before confinement.
// RPATH/RUNPATH and unusual ELF formats are refused, never approximated.
static void system_elf(const char *given, int executable) {
  char resolved[PATH_MAX];
  int fd = system_file(given, resolved, executable);
  for (size_t i = 0; i < system_count; i++) if (!strcmp(system_paths[i], resolved)) { close(fd); return; }
  if (system_count >= JUDGE_FAST_B1_SYSTEM_MAX_FILES) refuse("elf");
  strcpy(system_paths[system_count++], resolved);
  grant(fd, LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE);
  struct stat s = info(fd);
  if (s.st_size <= 0 || s.st_size > JUDGE_FAST_B1_ELF_MAX_BYTES) refuse("elf");
  Elf64_Ehdr header;
  read_exact(fd, &header, sizeof(header), 0);
  if (memcmp(header.e_ident, ELFMAG, SELFMAG) || header.e_ident[EI_CLASS] != ELFCLASS64 ||
      header.e_ident[EI_DATA] != ELFDATA2LSB || header.e_phentsize != sizeof(Elf64_Phdr) ||
      !header.e_phnum || header.e_phnum > 128) refuse("elf");
#if defined(__x86_64__)
  if (header.e_machine != EM_X86_64) refuse("elf");
#elif defined(__aarch64__)
  if (header.e_machine != EM_AARCH64) refuse("elf");
#else
#error Unsupported B1 architecture
#endif
  Elf64_Phdr segments[128];
  read_exact(fd, segments, header.e_phnum * sizeof(Elf64_Phdr), header.e_phoff);
  uint64_t dynamic_offset = 0, dynamic_length = 0, table_address = 0, table_size = 0;
  for (size_t i = 0; i < header.e_phnum; i++) {
    Elf64_Phdr p = segments[i];
    if (p.p_type == PT_INTERP) {
      char interpreter[PATH_MAX];
      if (p.p_filesz < 2 || p.p_filesz > sizeof(interpreter)) refuse("elf");
      read_exact(fd, interpreter, (size_t)p.p_filesz, p.p_offset);
      if (interpreter[p.p_filesz - 1] || strlen(interpreter) != p.p_filesz - 1) refuse("elf");
      system_elf(interpreter, 1);
    }
    if (p.p_type == PT_DYNAMIC) { dynamic_offset = p.p_offset; dynamic_length = p.p_filesz; }
  }
  if (!dynamic_length || dynamic_length > (uint64_t)s.st_size || dynamic_length % sizeof(Elf64_Dyn)) refuse("elf");
  size_t count = (size_t)(dynamic_length / sizeof(Elf64_Dyn));
  Elf64_Dyn *dynamic = calloc(count, sizeof(*dynamic));
  if (!dynamic) refuse("memory");
  read_exact(fd, dynamic, (size_t)dynamic_length, dynamic_offset);
  for (size_t i = 0; i < count; i++) {
    if (dynamic[i].d_tag == DT_RPATH || dynamic[i].d_tag == DT_RUNPATH) refuse("elf");
    if (dynamic[i].d_tag == DT_STRTAB) table_address = dynamic[i].d_un.d_ptr;
    if (dynamic[i].d_tag == DT_STRSZ) table_size = dynamic[i].d_un.d_val;
  }
  uint64_t table_offset = 0;
  int found_table = 0;
  for (size_t i = 0; i < header.e_phnum; i++) {
    Elf64_Phdr p = segments[i];
    if (p.p_type == PT_LOAD && table_address >= p.p_vaddr && table_address - p.p_vaddr < p.p_filesz && table_size <= p.p_filesz - (table_address - p.p_vaddr)) {
      table_offset = p.p_offset + table_address - p.p_vaddr; found_table = 1;
    }
  }
  if (!found_table || !table_size || table_size > (uint64_t)s.st_size) refuse("elf");
  char *table = malloc((size_t)table_size);
  if (!table) refuse("memory");
  read_exact(fd, table, (size_t)table_size, table_offset);
  for (size_t i = 0; i < count; i++) if (dynamic[i].d_tag == DT_NEEDED) {
    uint64_t offset = dynamic[i].d_un.d_val;
    if (offset >= table_size || !memchr(table + offset, 0, (size_t)(table_size - offset))) refuse("elf");
    const char *name = table + offset;
    if (!*name || strchr(name, '/') || strlen(name) > NAME_MAX) refuse("elf");
#if defined(__x86_64__)
    const char *dirs[] = {"/lib/x86_64-linux-gnu", "/usr/lib/x86_64-linux-gnu", "/lib64", "/usr/lib64", "/lib", "/usr/lib", NULL};
#else
    const char *dirs[] = {"/lib/aarch64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/lib64", "/usr/lib64", "/lib", "/usr/lib", NULL};
#endif
    int found = 0;
    for (size_t j = 0; dirs[j]; j++) {
      char dependency[PATH_MAX];
      int n = snprintf(dependency, sizeof(dependency), "%s/%s", dirs[j], name);
      if (n < 0 || (size_t)n >= sizeof(dependency)) refuse("elf");
      struct stat candidate;
      if (!stat(dependency, &candidate)) { system_elf(dependency, 0); found = 1; break; }
      if (errno != ENOENT) refuse("systemFile");
    }
    if (!found) refuse("elf");
  }
  free(table); free(dynamic); close(fd);
}
static void new_rules(void) {
  abi = (int)syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < JUDGE_FAST_B1_MIN_ABI || abi > JUDGE_FAST_B1_MAX_ABI) refuse("landlockAbi");
  // ABI 3: 15 FS rights; ABI 5 adds ioctl. ABIs 6–8 add no FS right.
  struct { uint64_t fs, net, scopes; } attr = {
    .fs = (1ULL << (abi >= 5 ? 16 : 15)) - 1,
    .net = abi >= 4 ? 3 : 0,
    .scopes = abi >= 6 ? 3 : 0
  };
  size_t size = abi >= 6 ? 24 : abi >= 4 ? 16 : 8;
  rules = (int)syscall(SYS_landlock_create_ruleset, &attr, size, 0);
  if (rules < 0) refuse("landlock");
}
#define DENY(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_##n, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
static void restrict_run(void) {
  // A rejected syscall can make a system program abort; it must not leave a core file.
  struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core)) refuse("limits");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || syscall(SYS_landlock_restrict_self, rules, 0)) refuse("landlock");
  close(rules);
#if defined(__x86_64__)
#define MUSE_ARCH AUDIT_ARCH_X86_64
#else
#define MUSE_ARCH AUDIT_ARCH_AARCH64
#endif
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MUSE_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    // x32 shares the x86_64 audit architecture, but has a separate syscall table.
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    DENY(socket), DENY(socketpair), DENY(connect), DENY(bind), DENY(listen),
    DENY(accept), DENY(accept4), DENY(sendto), DENY(recvfrom), DENY(sendmsg),
    DENY(recvmsg), DENY(sendmmsg), DENY(recvmmsg), DENY(shutdown),
    DENY(getsockname), DENY(getpeername), DENY(setsockopt), DENY(getsockopt),
    DENY(io_uring_setup), DENY(io_uring_enter), DENY(io_uring_register),
    DENY(add_key), DENY(request_key), DENY(keyctl), DENY(ptrace),
    DENY(process_vm_readv), DENY(process_vm_writev), DENY(clone), DENY(clone3),
#ifdef SYS_fork
    DENY(fork), DENY(vfork),
#endif
    DENY(execveat), DENY(unshare), DENY(setns), DENY(mount), DENY(umount2),
    DENY(bpf), DENY(userfaultfd), DENY(perf_event_open),
    DENY(fchmod), DENY(fchmodat), DENY(fchown), DENY(fchownat), DENY(utimensat),
    DENY(setxattr), DENY(lsetxattr), DENY(fsetxattr),
    DENY(removexattr), DENY(lremovexattr), DENY(fremovexattr),
#ifdef SYS_chmod
    DENY(chmod), DENY(chown), DENY(lchown), DENY(utime), DENY(utimes), DENY(futimesat),
#endif
#ifdef SYS_fchmodat2
    DENY(fchmodat2),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) refuse("seccomp");
}
static void probe(void) {
  // Insert and replace names after adding the inode rules, before entering the domain.
  // No self-test child survives cancellation; the run's filter is tested below.
  if (mkdir("probe-tree", 0700)) refuse("selfTest");
  int allowed = open("probe-tree/allowed", O_CREAT | O_EXCL | O_RDONLY, 0600);
  int denied = open("probe-denied", O_CREAT | O_EXCL | O_RDONLY, 0600);
  int folder = open("probe-tree", O_PATH | O_DIRECTORY);
  if (allowed < 0 || denied < 0 || folder < 0) refuse("selfTest");
  close(denied);
  new_rules();
  grant(allowed, LANDLOCK_ACCESS_FS_READ_FILE); close(allowed);
  grant(folder, LANDLOCK_ACCESS_FS_READ_DIR); close(folder);
  if (link("probe-denied", "probe-tree/late") || unlink("probe-tree/allowed") ||
      link("probe-denied", "probe-tree/allowed")) refuse("selfTest");
  restrict_run();
  if (open("probe-tree/late", O_RDONLY) != -1 || errno != EACCES ||
      open("probe-tree/allowed", O_RDONLY) != -1 || errno != EACCES) refuse("postWalkRead");
  errno = 0;
  pid_t pid = fork();
  if (!pid) _exit(JUDGE_FAST_B1_REFUSED_EXIT);
  if (pid > 0) { waitpid(pid, NULL, 0); refuse("processCreation"); }
  if (errno != EPERM) refuse("processCreation");
  if (socket(AF_INET, SOCK_STREAM, 0) != -1 || errno != EPERM) refuse("network");
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) != -1 || errno != EPERM) refuse("network");
  if (open("confine-must-not-create", O_CREAT | O_WRONLY, 0600) != -1 || errno != EACCES) refuse("write");
  printf("{\"abi\":%d,\"confined\":true}\n", abi);
}
static const char *program_path(const char *name) {
  static const char *names[] = {"ls", "cat", "head", "tail", "wc", "du", "grep", "find", NULL};
  static const char *paths[] = {"/bin/ls", "/bin/cat", "/usr/bin/head", "/usr/bin/tail", "/usr/bin/wc", "/usr/bin/du", "/bin/grep", "/usr/bin/find"};
  for (size_t i = 0; names[i]; i++) if (!strcmp(name, names[i])) return paths[i];
  refuse("program"); return NULL;
}
// stat is reported from the walked operands themselves, so the result cannot
// depend on which implementation a distribution ships: no program is verified
// or executed for it, and no grant beyond the walked operands is needed. The
// report runs statx on the descriptor the walk verified (AT_EMPTY_PATH), never
// by resolving the path again: a concurrent swap of an ancestor for a symlink
// after the walk cannot redirect the report to a file outside the workspace.
// Only a mutation of the same inode between the walk and the report (for
// example another hard link, changing the link count) can still turn the
// answer into a refusal. The grammar admits stat with no options, so every
// report below is the default one. Owners stay numeric and times UTC, as for
// every confined program: no user database is granted, and no byte of any
// content is read here. `ls`, `find` and `du` still resolve paths themselves
// through their system programs (pre-existing, which do the lstat): closing
// that would mean reporting their listings from the helper too.
// Test variants delay the report's statx through this name; production calls statx.
#ifndef MUSE_STATX
#define MUSE_STATX statx
#endif
static void check_stat(const struct statx *data) {
  if (S_ISLNK(data->stx_mode)) refuse("operand");
  if (makedev(data->stx_dev_major, data->stx_dev_minor) != device) refuse("operand");
  if (!S_ISDIR(data->stx_mode) && (!S_ISREG(data->stx_mode) || data->stx_nlink != 1)) refuse("operand");
}
// A filesystem that does not supply a field (FUSE, NFS) gets a dash, never a
// zero or a 1970 timestamp. stx_blksize and the device numbers have no mask
// bits; the kernel always fills them, so they print directly.
static void put_number(unsigned long long value, int have) {
  if (have) printf("%llu", value);
  else fputs("-", stdout);
}
static void report_time(const char *label, struct statx_timestamp when) {
  time_t sec = (time_t)when.tv_sec;
  struct tm fields;
  if (gmtime_r(&sec, &fields) != &fields) refuse("clock");
  printf("%s: %04d-%02d-%02d %02d:%02d:%02d.%09u +0000\n", label,
    fields.tm_year + 1900, fields.tm_mon + 1, fields.tm_mday,
    fields.tm_hour, fields.tm_min, fields.tm_sec, (unsigned int)when.tv_nsec);
}
static void report_time_masked(const char *label, struct statx_timestamp when, int have) {
  if (!have) printf("%s: -\n", label);
  else report_time(label, when);
}
static void print_stat(const char *path, const struct statx *data) {
  int have_mode = (data->stx_mask & STATX_MODE) != 0;
  unsigned int mode = (unsigned int)(data->stx_mode & 07777u);
  char text[11];
  text[0] = S_ISDIR(data->stx_mode) ? 'd' : '-';
  static const char bits[] = "rwxrwxrwx";
  for (int i = 0; i < 9; i++) text[1 + i] = (have_mode && (mode & (1u << (unsigned int)(8 - i)))) ? bits[i] : '-';
  if (have_mode && (mode & 04000u)) text[3] = (mode & 0100u) ? 's' : 'S';
  if (have_mode && (mode & 02000u)) text[6] = (mode & 0010u) ? 's' : 'S';
  if (have_mode && (mode & 01000u)) text[9] = (mode & 0001u) ? 't' : 'T';
  text[10] = 0;
  printf("File: %s\n", path);
  fputs("Size: ", stdout);
  put_number((unsigned long long)data->stx_size, (data->stx_mask & STATX_SIZE) != 0);
  fputs("  Blocks: ", stdout);
  put_number((unsigned long long)data->stx_blocks, (data->stx_mask & STATX_BLOCKS) != 0);
  printf("  IO Block: %u  %s\n",
    (unsigned int)data->stx_blksize, S_ISDIR(data->stx_mode) ? "directory" : "regular file");
  unsigned long long number = (unsigned long long)makedev(data->stx_dev_major, data->stx_dev_minor);
  printf("Device: %llxh/%llud  Inode: ", number, number);
  put_number((unsigned long long)data->stx_ino, (data->stx_mask & STATX_INO) != 0);
  fputs("  Links: ", stdout);
  put_number((unsigned long long)data->stx_nlink, (data->stx_mask & STATX_NLINK) != 0);
  fputs("\n", stdout);
  fputs("Access: (", stdout);
  if (have_mode) printf("%04o", mode);
  else fputs("-", stdout);
  printf("/%s)  Uid: (", text);
  if ((data->stx_mask & STATX_UID) != 0) printf("%5u", (unsigned int)data->stx_uid);
  else fputs("-", stdout);
  fputs("/ UNKNOWN)  Gid: (", stdout);
  if ((data->stx_mask & STATX_GID) != 0) printf("%5u", (unsigned int)data->stx_gid);
  else fputs("-", stdout);
  fputs("/ UNKNOWN)\n", stdout);
  report_time_masked("Access", data->stx_atime, (data->stx_mask & STATX_ATIME) != 0);
  report_time_masked("Modify", data->stx_mtime, (data->stx_mask & STATX_MTIME) != 0);
  report_time_masked("Change", data->stx_ctime, (data->stx_mask & STATX_CTIME) != 0);
  if ((data->stx_mask & STATX_BTIME) && (data->stx_btime.tv_sec || data->stx_btime.tv_nsec))
    report_time("Birth", data->stx_btime);
  else
    printf("Birth: -\n");
}
int main(int argc, char **argv) {
  if (!getuid() || !geteuid()) refuse("root");
  if (argc == 2 && !strcmp(argv[1], "probe")) { probe(); return 0; }
  // run root device:inode emptyHome recursive program operand... -- toolArg...
  if (argc < 9 || strcmp(argv[1], "run")) refuse("request");
  new_rules();
  int root = open(argv[2], O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) refuse("workspace");
  struct stat s = info(root); device = s.st_dev;
  char identity[64];
  snprintf(identity, sizeof(identity), "%llu:%llu", (unsigned long long)s.st_dev, (unsigned long long)s.st_ino);
  if (!s.st_ino || strcmp(identity, argv[3])) refuse("workspaceIdentity");
  int home = open(argv[4], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (home < 0) refuse("home");
  struct stat h = info(home);
  if (h.st_uid != getuid() || (h.st_mode & 0077)) refuse("home");
  DIR *empty = fdopendir(home);
  if (!empty) refuse("home");
  errno = 0; struct dirent *entry;
  while ((entry = readdir(empty))) if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..")) refuse("home");
  if (errno) refuse("home");
  closedir(empty);
  int recursive = !strcmp(argv[5], "recursive");
  if (!recursive && strcmp(argv[5], "single")) refuse("request");
  char resolved[PATH_MAX]; resolved[0] = 0;
  int is_stat = !strcmp(argv[6], "stat");
  if (is_stat && recursive) refuse("request");
  if (!is_stat) {
    int program = system_file(program_path(argv[6]), resolved, 1); close(program);
    system_elf(resolved, 1);
    char cache[PATH_MAX];
    int cache_fd = system_file("/etc/ld.so.cache", cache, 0);
    grant(cache_fd, LANDLOCK_ACCESS_FS_READ_FILE); close(cache_fd);
  }
  if (clock_gettime(CLOCK_MONOTONIC, &started)) refuse("clock");
  // For stat the walk-verified descriptors stay open until the report reads
  // them below: nothing in the stat path resolves a path a second time.
  int *held = NULL;
  struct statx *reported = NULL;
  if (is_stat) {
    held = calloc((size_t)(argc - 7), sizeof(*held));
    reported = calloc((size_t)(argc - 7), sizeof(*reported));
    if (!held || !reported) refuse("memory");
  }
  int separator = 7;
  while (separator < argc && strcmp(argv[separator], "--")) {
    if (private_path(argv[separator])) refuse("privateOperand");
    int operand = beneath(root, argv[separator], O_PATH);
    // More operands than the process may hold open is a limit refusal, not a
    // hostile operand: stat keeps every walked descriptor open until the
    // report reads it, so a long operand list exhausts RLIMIT_NOFILE first.
    if (operand < 0 && (errno == EMFILE || errno == ENFILE)) refuse("limits");
    if (operand < 0) refuse("operand");
    visited++; walk(operand, argv[separator], recursive, 0);
    if (is_stat) held[separator - 7] = operand;
    else close(operand);
    separator++;
  }
  if (separator == 7 || separator >= argc) refuse("request");
  if (is_stat) {
    // The tool arguments must mirror the walked operands: the grammar emits
    // the operands there, and the reports below cover the walked operands.
    if (argc - separator - 1 != separator - 7) refuse("request");
    for (int i = 0; i < separator - 7; i++)
      if (strcmp(argv[7 + i], argv[separator + 1 + i])) refuse("request");
  }
  budget();
  if (is_stat) {
    // Read the verified descriptors before confinement closes them, so every
    // refusal below still precedes the confined line on stderr.
    for (int i = 0; i < separator - 7; i++) {
      if (MUSE_STATX(held[i], "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,
          STATX_BASIC_STATS | STATX_BTIME, &reported[i])) refuse("operand");
      check_stat(&reported[i]);
      close(held[i]);
    }
    free(held);
  }
  if (fchdir(root)) refuse("workspace");
  close(root);
  int null_fd = open("/dev/null", O_RDONLY | O_CLOEXEC);
  if (null_fd < 0 || dup2(null_fd, STDIN_FILENO) < 0) refuse("stdin");
  if (null_fd != STDIN_FILENO) close(null_fd);
  // The neutral environment is explicit even if the helper's caller had injected variables.
  char home_env[PATH_MAX + 5];
  int n = snprintf(home_env, sizeof(home_env), "HOME=%s", argv[4]);
  if (n < 0 || (size_t)n >= sizeof(home_env)) refuse("home");
  char *environment[] = {"PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC0", home_env, NULL};
  char **tool = calloc((size_t)(argc - separator + 1), sizeof(*tool));
  if (!tool) refuse("memory");
  // Keep the requested applet name for verified system multicall executables.
  // execve still receives only the resolved, verified absolute file.
  tool[0] = argv[6];
  for (int i = separator + 1; i < argc; i++) tool[i - separator] = argv[i];
  restrict_run();
  if (syscall(SYS_close_range, 3U, ~0U, 0)) refuse("descriptors");
  fprintf(stderr, "{\"confined\":true,\"abi\":%d,\"excluded\":%zu}\n", abi, excluded);
  if (fflush(stderr)) refuse("protocol");
  if (is_stat) {
    for (int i = 7; i < separator; i++) print_stat(argv[i], &reported[i - 7]);
    free(reported);
    if (fflush(stdout)) refuse("protocol");
    return 0;
  }
  execve(resolved, tool, environment);
  refuse("exec");
  return JUDGE_FAST_B1_REFUSED_EXIT;
}
#else
int main(void) {
  fputs("{\"refused\":\"macosCaptureRequired\"}\n", stderr);
  return JUDGE_FAST_B1_REFUSED_EXIT;
}
#endif
