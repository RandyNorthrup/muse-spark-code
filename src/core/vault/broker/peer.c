/* Owned protocol: v1 uid/pid/nonblocking on fd 3. No arguments, environment, values or logs. */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#ifdef __APPLE__
#include <sys/un.h>
#endif
int main(void) {
  /* Node's inherited stdio makes the shared fd blocking. Restore the parent's
     socket mode before replying; otherwise a large write blocks its event loop. */
  int flags = fcntl(3, F_GETFL);
  if (flags < 0 || fcntl(3, F_SETFL, flags | O_NONBLOCK) != 0) return 1;
  uid_t uid;
  pid_t pid;
#ifdef __APPLE__
  gid_t gid;
  socklen_t length = sizeof(pid);
  if (getpeereid(3, &uid, &gid) != 0 ||
      getsockopt(3, SOL_LOCAL, LOCAL_PEERPID, &pid, &length) != 0 ||
      length != sizeof(pid)) return 1;
#elif defined(__linux__)
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  if (getsockopt(3, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0 ||
      length != sizeof(credentials)) return 1;
  uid = credentials.uid;
  pid = credentials.pid;
#else
  return 1;
#endif
  if (pid <= 0) return 1;
  flags = fcntl(3, F_GETFL);
  if (flags < 0) return 1;
  return printf("{\"v\":1,\"uid\":%lu,\"pid\":%ld,\"nonblocking\":%s}\n",
    (unsigned long)uid, (long)pid, (flags & O_NONBLOCK) ? "true" : "false") < 0 ? 1 : 0;
}
