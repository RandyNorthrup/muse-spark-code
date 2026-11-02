// Exhaust the descriptor table before the run, so the stat operand opens
// fail with EMFILE and refuse with the limit reason. Exactly 48
// descriptors stay free: enough for the run's own root, home and profile
// opens, far too few for the test's 100 held operands. (Linux proves the
// same branch through prlimit, which macOS does not ship.) The fast path
// shrinks the table itself; where setrlimit is denied, the slow path
// leaks until open fails, which the process ceiling bounds.
#define main confine_main
#include "../../../native/confine/MuseSparkConfineMac.c"
#undef main
int main(int argc, char **argv) {
  struct rlimit soft;
  if (getrlimit(RLIMIT_NOFILE, &soft)) return 2;
  struct rlimit small;
  small.rlim_cur = 128;
  small.rlim_max = soft.rlim_max;
  if (setrlimit(RLIMIT_NOFILE, &small)) {
    int top = 2;
    for (;;) {
      int fd = open("/dev/null", O_RDONLY | O_CLOEXEC);
      if (fd < 0) break;
      if (fd > top) top = fd;
      if (fd > 3000000) break;
    }
    for (int i = 0; i < 48 && top - i > 2; i++) close(top - i);
  } else if (getrlimit(RLIMIT_NOFILE, &soft)) {
    return 2;
  } else {
    rlim_t keep = 48;
    rlim_t target = soft.rlim_cur > keep ? soft.rlim_cur - keep : 0;
    for (rlim_t i = 0; i < target; i++) {
      if (open("/dev/null", O_RDONLY | O_CLOEXEC) < 0) break;
    }
  }
  return confine_main(argc, argv);
}
