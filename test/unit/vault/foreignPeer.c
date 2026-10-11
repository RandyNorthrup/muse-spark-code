#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
  if (argc != 2) return 1;
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  if (strlen(argv[1]) >= sizeof(address.sun_path)) return 1;
  strcpy(address.sun_path, argv[1]);
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return 1;
  if (connect(fd, (struct sockaddr*)&address, sizeof(address)) != 0) {
    printf("{\"connected\":false,\"errno\":%d}\n", errno); close(fd); return 0;
  }
  printf("{\"connected\":true}\n");
  fflush(stdout);
  char reply;
  read(fd, &reply, 1);
  close(fd); return 0;
}
