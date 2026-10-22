/* M98 Linux process lease. A pidfd and an open proc directory are held until
 * stdin closes. No signal is sent and no credential/environment is read. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

static int alive(int lease) {
  struct pollfd p = { .fd = lease, .events = POLLIN };
  int result;
  do { result = poll(&p, 1, 0); } while (result < 0 && errno == EINTR);
  return result == 0 && p.revents == 0;
}

static int read_proc(int directory, const char *name, char *buffer, size_t size) {
  int file = openat(directory, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (file < 0) return 0;
  ssize_t count = read(file, buffer, size - 1);
  close(file);
  if (count <= 0 || (size_t)count >= size - 1) return 0;
  buffer[count] = '\0';
  return 1;
}

static int identity(int directory, int lease, unsigned long pid,
                    char *start, size_t start_size, char *executable, size_t exe_size) {
  char buffer[16384];
  struct stat owner;
  if (!alive(lease) || fstat(directory, &owner) || owner.st_uid != getuid()) return 0;
  if (!read_proc(directory, "status", buffer, sizeof(buffer))) return 0;
  char *uids = strstr(buffer, "\nUid:\t");
  unsigned long real, effective, saved, filesystem;
  if (!uids || sscanf(uids, "\nUid:\t%lu %lu %lu %lu", &real, &effective,
                       &saved, &filesystem) != 4 || real != getuid() ||
      effective != real || saved != real || filesystem != real) return 0;
  if (!read_proc(directory, "stat", buffer, sizeof(buffer))) return 0;
  char *end;
  if (strtoul(buffer, &end, 10) != pid || *end != ' ') return 0;
  char *fields = strrchr(buffer, ')');
  if (!fields) return 0;
  fields++;
  char *save = NULL;
  char *field = strtok_r(fields, " \n", &save);
  /* stat field 22, indexed after the parenthesized comm (field 2). */
  for (int index = 0; index < 19 && field; index++) field = strtok_r(NULL, " \n", &save);
  if (!field || strspn(field, "0123456789") != strlen(field) ||
      strlen(field) >= start_size) return 0;
  strcpy(start, field);
  ssize_t length = readlinkat(directory, "exe", executable, exe_size - 1);
  if (length <= 0 || (size_t)length >= exe_size - 1) return 0;
  executable[length] = '\0';
  return alive(lease);
}

static void json_string(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end;
  errno = 0;
  unsigned long pid = strtoul(argv[1], &end, 10);
  if (errno || !pid || pid > INT_MAX || *end) return 2;
  int lease = (int)syscall(SYS_pidfd_open, (pid_t)pid, 0);
  if (lease < 0) return 3;
  char location[64];
  snprintf(location, sizeof(location), "/proc/%lu", pid);
  int directory = open(location, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  char initial_start[32], initial_executable[PATH_MAX];
  if (directory < 0 || !identity(directory, lease, pid, initial_start,
                                sizeof(initial_start), initial_executable,
                                sizeof(initial_executable))) {
    if (directory >= 0) close(directory);
    close(lease);
    return 3;
  }
  int command;
  while ((command = getchar()) != EOF) {
    if (command == '\n') continue;
    if (command == 'q') break;
    if (command != 'i') break;
    char start[32], executable[PATH_MAX];
    int valid = identity(directory, lease, pid, start, sizeof(start),
                         executable, sizeof(executable)) &&
                !strcmp(start, initial_start) && !strcmp(executable, initial_executable);
    if (!valid) puts("{\"alive\":false}");
    else {
      printf("{\"alive\":true,\"identity\":{\"pid\":%lu,\"uid\":%lu,\"creationTime\":", pid,
             (unsigned long)getuid());
      json_string(start);
      fputs(",\"executable\":", stdout);
      json_string(executable);
      puts("}}");
    }
    if (fflush(stdout)) break;
  }
  close(directory);
  close(lease);
  return 0;
}
