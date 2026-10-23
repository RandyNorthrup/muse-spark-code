// M125 lane J: the Linux lease holder. It opens every blob the disk
// proof measured, takes a read lease on each, and answers pings until
// a writer breaks a lease — then it names the broken path and exits
// nonzero at once (closing the descriptors releases the leases, so the
// writer is never stuck behind us). It never reads a blob byte: the
// hold proves no writer arrived, not what the bytes are.
//
// Protocol (stdout, one JSON object or pong per line):
//   {"ready":true,"blobs":N}   all leases held
//   pong                       one ping answered
//   {"break":"<path>"}         a lease broke; exit 2 follows
// stdin: "ping" lines, or "stop"/EOF to exit 0.
// Exit codes: 0 clean stop; 1 setup failure (open, lease, signalfd);
// 2 lease break. Death by signal is the parent's loss too.
//
// BLOBHOLD_READY_DELAY_MS (test variants only): sleep that long before
// printing ready, to prove the parent refuses a late respawn.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/signalfd.h>
#include <time.h>
#include <unistd.h>

static void print_json_string(int fd, const char *text) {
  dprintf(fd, "\"");
  for (const unsigned char *at = (const unsigned char *)text; *at != 0; at++) {
    if (*at == '"' || *at == '\\') dprintf(fd, "\\%c", *at);
    else if (*at < 0x20) dprintf(fd, "\\u%04x", *at);
    else dprintf(fd, "%c", *at);
  }
  dprintf(fd, "\"");
}

int main(int argc, char **argv) {
  if (argc < 2) {
    dprintf(STDERR_FILENO, "usage: muse-blobhold <blob>...\n");
    return 1;
  }
  int count = argc - 1;
  int *held = calloc((size_t)count, sizeof(*held));
  if (held == NULL) {
    dprintf(STDERR_FILENO, "blobhold: out of memory\n");
    return 1;
  }
  sigset_t mask;
  sigemptyset(&mask);
  sigaddset(&mask, SIGRTMIN);
  if (sigprocmask(SIG_BLOCK, &mask, NULL) != 0) {
    dprintf(STDERR_FILENO, "blobhold: cannot block break signal: %s\n", strerror(errno));
    return 1;
  }
  int signals = signalfd(-1, &mask, SFD_CLOEXEC);
  if (signals < 0) {
    dprintf(STDERR_FILENO, "blobhold: cannot open signalfd: %s\n", strerror(errno));
    return 1;
  }
  for (int index = 0; index < count; index++) {
    int fd = open(argv[index + 1], O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
      dprintf(STDERR_FILENO, "blobhold: cannot open %s: %s\n", argv[index + 1], strerror(errno));
      return 1;
    }
    held[index] = fd;
    if (fcntl(fd, F_SETSIG, SIGRTMIN) != 0 || fcntl(fd, F_SETOWN, getpid()) != 0 ||
        fcntl(fd, F_SETLEASE, F_RDLCK) != 0) {
      dprintf(STDERR_FILENO, "blobhold: cannot lease %s: %s\n", argv[index + 1], strerror(errno));
      return 1;
    }
  }
#ifdef BLOBHOLD_READY_DELAY_MS
  {
    long total = (long)BLOBHOLD_READY_DELAY_MS;
    struct timespec wait = {total / 1000L, (total % 1000L) * 1000L * 1000L};
    nanosleep(&wait, NULL);
  }
#endif
  dprintf(STDOUT_FILENO, "{\"ready\":true,\"blobs\":%d}\n", count);
  struct pollfd watched[2] = {
    {.fd = STDIN_FILENO, .events = POLLIN},
    {.fd = signals, .events = POLLIN},
  };
  char line[32];
  size_t used = 0;
  for (;;) {
    if (poll(watched, 2, -1) < 0) {
      if (errno == EINTR) continue;
      dprintf(STDERR_FILENO, "blobhold: poll failed: %s\n", strerror(errno));
      return 1;
    }
    if ((watched[1].revents & POLLIN) != 0) {
      struct signalfd_siginfo info;
      ssize_t got = read(signals, &info, sizeof(info));
      if (got != (ssize_t)sizeof(info)) {
        dprintf(STDERR_FILENO, "blobhold: short signal read\n");
        return 1;
      }
      const char *broken = NULL;
      for (int index = 0; index < count; index++) {
        if (held[index] == info.ssi_fd) broken = argv[index + 1];
      }
      dprintf(STDOUT_FILENO, "{\"break\":");
      print_json_string(STDOUT_FILENO, broken == NULL ? "" : broken);
      dprintf(STDOUT_FILENO, "}\n");
      return 2;
    }
    if ((watched[0].revents & (POLLIN | POLLHUP)) != 0) {
      char chunk[32];
      ssize_t got = read(STDIN_FILENO, chunk, sizeof(chunk));
      if (got <= 0) return 0;
      for (ssize_t at = 0; at < got; at++) {
        if (chunk[at] == '\n') {
          line[used] = 0;
          if (strcmp(line, "ping") == 0) {
            if (dprintf(STDOUT_FILENO, "pong\n") < 0) return 1;
          } else if (strcmp(line, "stop") == 0) {
            return 0;
          }
          used = 0;
        } else if (used + 1 < sizeof(line)) {
          line[used++] = chunk[at];
        }
      }
    }
  }
}
