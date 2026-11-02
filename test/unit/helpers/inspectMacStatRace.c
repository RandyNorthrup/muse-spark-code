// Delay the report's fstat only, after the walk, so the test can swap an
// ancestor for a symlink in between. The production stat path reads the
// walk-verified descriptor, so the swap must not redirect it.
#include <sys/stat.h>
#include <time.h>
#define MUSE_FSTAT delayed_fstat
#define main confine_main
int delayed_fstat(int fd, struct stat *buf);
#include "../../../native/confine/MuseSparkConfineMac.c"
#undef main
int delayed_fstat(int fd, struct stat *buf) {
  struct timespec delay = {0, 200000000};
  nanosleep(&delay, NULL);
  return fstat(fd, buf);
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
