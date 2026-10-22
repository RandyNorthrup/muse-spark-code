// Exercise the post-walk stat checks directly: each hostile shape must
// refuse in a forked child (exit 125), each allowed shape must return.
// Removing any check_stat line flips its case, which the test observes.
#define main confine_main
#include "../../../native/confine/MuseSparkConfine.c"
#undef main
static int refused_case(const struct statx *data) {
  pid_t pid = fork();
  if (pid < 0) return 0;
  if (pid == 0) {
    check_stat(data);
    _exit(0);
  }
  int status = 0;
  if (waitpid(pid, &status, 0) != pid) return 0;
  return WIFEXITED(status) != 0 && WEXITSTATUS(status) == JUDGE_FAST_B1_REFUSED_EXIT;
}
static void shape(struct statx *data, unsigned int mode, unsigned int major, unsigned int minor,
    unsigned int links) {
  memset(data, 0, sizeof(*data));
  data->stx_mask = STATX_TYPE | STATX_MODE | STATX_NLINK;
  data->stx_mode = (__u16)mode;
  data->stx_dev_major = major;
  data->stx_dev_minor = minor;
  data->stx_nlink = links;
}
int main(void) {
  device = makedev(8, 3);
  struct statx data;
  int failures = 0;
  shape(&data, S_IFREG | 0644u, 8, 3, 1);
  if (refused_case(&data)) { printf("FAIL regular\n"); failures++; }
  else printf("ok regular\n");
  shape(&data, S_IFDIR | 0755u, 8, 3, 2);
  if (refused_case(&data)) { printf("FAIL directory\n"); failures++; }
  else printf("ok directory\n");
  shape(&data, S_IFLNK | 0777u, 8, 3, 1);
  if (!refused_case(&data)) { printf("FAIL symlink-accepted\n"); failures++; }
  else printf("ok symlink-refused\n");
  shape(&data, S_IFREG | 0644u, 7, 0, 1);
  if (!refused_case(&data)) { printf("FAIL foreign-device-accepted\n"); failures++; }
  else printf("ok foreign-device-refused\n");
  shape(&data, S_IFREG | 0644u, 8, 3, 2);
  if (!refused_case(&data)) { printf("FAIL hardlink-accepted\n"); failures++; }
  else printf("ok hardlink-refused\n");
  shape(&data, S_IFIFO | 0644u, 8, 3, 1);
  if (!refused_case(&data)) { printf("FAIL fifo-accepted\n"); failures++; }
  else printf("ok fifo-refused\n");
  if (fflush(stdout)) return 1;
  return failures != 0;
}
