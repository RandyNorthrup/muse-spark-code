#define main confine_main
#define lstat trust_lstat
#define fstat trust_fstat
#define access trust_access
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
#undef lstat
#undef fstat
#undef access
static const char *fault = "none";
int trust_lstat(const char *name, struct stat *s) {
  int result = (int)syscall(SYS_newfstatat, AT_FDCWD, name, s, AT_SYMLINK_NOFOLLOW);
  if (result) return result;
  if (!strcmp(fault, "uid")) s->st_uid = getuid();
  if (!strcmp(fault, "group")) s->st_mode |= 0020;
  if (!strcmp(fault, "other")) s->st_mode |= 0002;
  return 0;
}
int trust_fstat(int fd, struct stat *s) {
  int result = (int)syscall(SYS_fstat, fd, s);
  if (!result && !strcmp(fault, "identity")) s->st_ino++;
  return result;
}
int trust_access(const char *name, int mode) {
  return !strcmp(fault, "acl") ? 0 : (int)syscall(SYS_faccessat, AT_FDCWD, name, mode);
}
int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) refuse("request");
  if (argc == 3) fault = argv[2];
  char resolved[PATH_MAX];
  int fd = system_file(argv[1], resolved, 1);
  close(fd); return 0;
}
