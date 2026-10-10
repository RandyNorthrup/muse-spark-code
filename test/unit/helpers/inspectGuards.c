// Exercise syscalls directly inside the production domain; no alternate production executable.
#define main confine_main
#define execve guard_execve
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
#undef execve
#include <sys/mman.h>
int guard_execve(const char *file, char *const argv[], char *const env[]) {
  (void)file;
  size_t variables = 0;
  for (; env[variables]; variables++) {
    if (strcmp(env[variables], "PATH=/usr/bin:/bin") && strcmp(env[variables], "LC_ALL=C") &&
        strcmp(env[variables], "TZ=UTC0") && strncmp(env[variables], "HOME=", 5)) return -1;
  }
  if (variables != 4 || isatty(0) || isatty(1) || isatty(2)) return -1;
  char input;
  if (read(0, &input, 1) != 0) return -1;
  const long calls[] = {SYS_socket, SYS_socketpair, SYS_clone, SYS_clone3,
    SYS_io_uring_setup, SYS_io_uring_enter, SYS_io_uring_register,
    SYS_keyctl, SYS_add_key, SYS_request_key, SYS_ptrace, SYS_execveat,
    SYS_connect, SYS_bind, SYS_sendmsg, SYS_process_vm_readv, SYS_unshare,
    SYS_fchmod, SYS_fchmodat, SYS_fchown, SYS_utimensat, SYS_setxattr};
  for (size_t i = 0; i < sizeof(calls) / sizeof(calls[0]); i++) {
    errno = 0;
    if (syscall(calls[i], 0, 0, 0, 0, 0, 0) != -1 || errno != EPERM) return -1;
  }
#if defined(__x86_64__)
  if (syscall(0x40000000 | SYS_socket, 0, 0, 0) != -1 || errno != EPERM) return -1;
#endif
  if (open("allowed.txt", O_WRONLY) != -1 || errno != EACCES) return -1;
  int readable = open("allowed.txt", O_RDONLY);
  if (readable < 0) return -1;
  if (fchmod(readable, 0777) != -1 || errno != EPERM) return -1;
  close(readable);
  if (fchmodat(AT_FDCWD, "allowed.txt", 0777, 0) != -1 || errno != EPERM) return -1;
  if (open("new-file", O_CREAT | O_WRONLY, 0600) != -1 || errno != EACCES) return -1;
  if (truncate("allowed.txt", 0) != -1 || errno != EACCES) return -1;
  if (unlink("allowed.txt") != -1 || errno != EACCES) return -1;
  if (syscall(SYS_execve, "/bin/sh", argv, env) != -1 || errno != EACCES) return -1;
  if (fcntl(100, F_GETFD) != -1 || errno != EBADF) return -1;
  puts("ALL_GUARDS_REFUSED"); fflush(stdout);
  _exit(0);
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
