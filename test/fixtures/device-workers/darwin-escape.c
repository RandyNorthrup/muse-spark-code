// Native, fake-only workload: an ordinary child and a setsid/double-fork escapee.
#include <libproc.h>
#include <sys/wait.h>
#include <spawn.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct CoalitionIDs { uint64_t ids[2], reserved[3]; };
extern int posix_spawnattr_setcoalition_np(const posix_spawnattr_t *, uint64_t, int, int);
static uint64_t coalition(pid_t pid) {
  struct CoalitionIDs ids = {0};
  return proc_pidinfo(pid, 20, 0, &ids, sizeof(ids)) == sizeof(ids) ? ids.ids[0] : 0;
}
static void wait_for(const char *file) {
  while (access(file, F_OK)) usleep(1000);
}
static void close_stdio(void) { close(0); close(1); close(2); }
int main(int argc, char **argv) {
  // Deadman for a failed test, independent of the production retirement policy.
  alarm(4);
  if (argc != 6) return 1;
  const char *create = argv[1], *marker = argv[2], *release = argv[3], *root_exit = argv[4];
  FILE *initial = fopen(argv[5], "w"); if (!initial) return 1;
  fprintf(initial, "%d", getpid()); fclose(initial);
  wait_for(create);
  uint64_t id = coalition(getpid()); if (!id) return 1;
  int pipefd[2]; if (pipe(pipefd)) return 1;
  pid_t middle = fork(); if (middle < 0) return 1;
  if (!middle) {
    close(pipefd[0]);
    if (setsid() < 0) _exit(1);
    pid_t escape = fork(); if (escape < 0) _exit(1); if (escape) _exit(0);
    alarm(4);
    while (getppid() != 1) usleep(1000);
    // An unprivileged member cannot use the private spawn API to change coalition.
    posix_spawnattr_t attr; if (posix_spawnattr_init(&attr)) _exit(1);
    if (posix_spawnattr_setcoalition_np(&attr, id, 0, 0)) _exit(1);
    char *args[] = {"/usr/bin/true", NULL}, *env[] = {NULL}; pid_t attempted;
    int error = posix_spawn(&attempted, args[0], NULL, &attr, args, env);
    posix_spawnattr_destroy(&attr);
    if (!error) { int status; waitpid(attempted, &status, 0); }
    dprintf(pipefd[1], "%d %d %d %llu %d", getpid(), getpgrp(), getppid(), coalition(getpid()), error == EPERM);
    close(pipefd[1]); close_stdio(); wait_for(release); _exit(0);
  }
  close(pipefd[1]); int status; if (waitpid(middle, &status, 0) != middle) return 1;
  char data[128] = {0}; if (read(pipefd[0], data, sizeof(data) - 1) <= 0) return 1;
  close(pipefd[0]);
  int escape, group, parent, denied; unsigned long long escape_id;
  if (sscanf(data, "%d %d %d %llu %d", &escape, &group, &parent, &escape_id, &denied) != 5) return 1;
  pid_t held = fork(); if (held < 0) return 1;
  if (!held) { alarm(4); close_stdio(); wait_for(release); _exit(0); }
  FILE *out = fopen(marker, "w"); if (!out) return 1;
  fprintf(out, "{\"root\":%d,\"held\":%d,\"escape\":%d,\"rootGroup\":%d,\"escapeGroup\":%d,\"escapeParent\":%d,\"coalition\":%llu,\"escapeCoalition\":%llu,\"spawnReassignmentDenied\":%s}",
    getpid(), held, escape, getpgrp(), group, parent, id, escape_id, denied ? "true" : "false");
  fclose(out);
  while (access(release, F_OK) && access(root_exit, F_OK)) usleep(1000);
  printf("finished");
  return 0;
}
