// Prove stat needs no program: every execve fails, yet stat is still answered.
// Any future stat path that starts a binary lands in refuse("exec") instead.
#define main confine_main
#define execve no_execve
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
#undef execve
int no_execve(const char *file, char *const argv[], char *const env[]) {
  (void)file;
  (void)argv;
  (void)env;
  errno = ENOSYS;
  return -1;
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
