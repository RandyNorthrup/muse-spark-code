// Slow the verified program's exec only in this fixture, after grants and descriptor closure.
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
