#define fstat device_fstat
#define main confine_main
#include "../../../native/confine/MuseSparkConfine.c"
#undef fstat
#undef main
int device_fstat(int fd, struct stat *s) {
  int result = (int)syscall(SYS_fstat, fd, s);
  char name[64], path[PATH_MAX];
  snprintf(name, sizeof(name), "/proc/self/fd/%d", fd);
  ssize_t length = readlink(name, path, sizeof(path) - 1);
  if (length >= 0) {
    path[length] = 0;
    if (strstr(path, "/foreign.txt")) s->st_dev++;
  }
  return result;
}
int main(int argc, char **argv) { return confine_main(argc, argv); }
