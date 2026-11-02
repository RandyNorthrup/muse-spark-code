// Exercise the post-walk stat checks directly: each hostile shape must
// refuse in a forked child (exit 125), each allowed shape must return.
// Removing any check_stat line flips its case, which the test observes.
#define main confine_main
#include "../../../native/confine/MuseSparkConfineMac.c"
#undef main
static int refused_case(const struct stat *data) {
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
static void shape(struct stat *data, unsigned int mode, int dev, unsigned int links) {
  memset(data, 0, sizeof(*data));
  data->st_mode = (mode_t)mode;
  data->st_dev = (dev_t)dev;
  data->st_nlink = (nlink_t)links;
}
int main(void) {
  device = 5;
  struct stat data;
  int failures = 0;
  shape(&data, S_IFREG | 0644u, 5, 1);
  if (refused_case(&data)) { printf("FAIL regular\n"); failures++; }
  else printf("ok regular\n");
  shape(&data, S_IFDIR | 0755u, 5, 2);
  if (refused_case(&data)) { printf("FAIL directory\n"); failures++; }
  else printf("ok directory\n");
  shape(&data, S_IFLNK | 0777u, 5, 1);
  if (!refused_case(&data)) { printf("FAIL symlink-accepted\n"); failures++; }
  else printf("ok symlink-refused\n");
  shape(&data, S_IFREG | 0644u, 6, 1);
  if (!refused_case(&data)) { printf("FAIL foreign-device-accepted\n"); failures++; }
  else printf("ok foreign-device-refused\n");
  shape(&data, S_IFREG | 0644u, 5, 2);
  if (!refused_case(&data)) { printf("FAIL hardlink-accepted\n"); failures++; }
  else printf("ok hardlink-refused\n");
  shape(&data, S_IFIFO | 0644u, 5, 1);
  if (!refused_case(&data)) { printf("FAIL fifo-accepted\n"); failures++; }
  else printf("ok fifo-refused\n");
  if (fflush(stdout)) return 1;
  return failures != 0;
}
