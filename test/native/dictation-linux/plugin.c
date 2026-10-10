// A hostile workspace/backend override must never cause this library to load.
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
__attribute__((constructor)) static void loaded(void) {
  const char *marker = getenv("MUSE_PLUGIN_MARKER");
  if (!marker) return;
  int fd = open(marker, O_CREAT | O_WRONLY, 0600);
  if (fd >= 0) { close(fd); }
}
