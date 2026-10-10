#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>
#include <fcntl.h>
#include <grp.h>
int main(int argc, char **argv) {
  if (argc != 2 && argc != 4) return 1;
  const char *socket_path = argv[1];
  char directory[PATH_MAX];
  if (argc == 4) {
    /* Open only this generated test directory as root, then drop all privileges
       before connect; the rig's private TMPDIR need not become traversable. */
    if (getuid() != 0 || strlen(socket_path) >= sizeof(directory)) return 1;
    strcpy(directory, socket_path);
    char *name = strrchr(directory, '/');
    if (!name || !name[1]) return 1;
    *name = '\0';
    int root = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (root < 0 || fchdir(root) != 0) return 1;
    close(root);
    char *end;
    unsigned long uid = strtoul(argv[2], &end, 10);
    if (*end || uid == 0 || uid > UINT_MAX) return 1;
    unsigned long gid = strtoul(argv[3], &end, 10);
    if (*end || gid == 0 || gid > UINT_MAX) return 1;
    if (setgroups(0, NULL) != 0 || setgid((gid_t)gid) != 0 ||
        setuid((uid_t)uid) != 0 || getuid() != (uid_t)uid) return 1;
    socket_path = name + 1;
  }
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  if (strlen(socket_path) >= sizeof(address.sun_path)) return 1;
  strcpy(address.sun_path, socket_path);
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return 1;
  if (connect(fd, (struct sockaddr*)&address, sizeof(address)) != 0) {
    printf("{\"connected\":false,\"errno\":%d}\n", errno); close(fd); return 0;
  }
  printf("{\"connected\":true,\"uid\":%lu}\n", (unsigned long)getuid());
  fflush(stdout);
  char reply;
  read(fd, &reply, 1);
  close(fd); return 0;
}
