// Simulate a verified program the boundary cannot start (the uutils case):
// execve of wc fails, so the helper refuses "exec" after the confined line.
// Every other program starts normally, so the session self-test still passes.
#define main confine_main
#define execve selective_execve
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
#undef execve
int selective_execve(const char *file, char *const argv[], char *const env[]) {
  if (strstr(file, "wc") != NULL) {
    errno = EACCES;
    return -1;
  }
  return (int)syscall(SYS_execve, file, argv, env);
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
