// Slow the verified program's exec only in this fixture, after grants and descriptor closure.
// Strict C11 hides the declarations this fixture uses, so name the same
// feature level the confine program itself uses, with its header, explicitly.
#define _GNU_SOURCE
#include <time.h>
#define main confine_main
#define execve delayed_execve
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
#undef execve
int delayed_execve(const char *file, char *const argv[], char *const env[]) {
  struct timespec delay = {0, 200000000};
  nanosleep(&delay, NULL);
  return (int)syscall(SYS_execve, file, argv, env);
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
