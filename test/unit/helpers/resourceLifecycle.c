// Fake-only lifecycle fixture: a zombie held until its parent is told to reap.
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
  pid_t zombie = fork();
  if (zombie < 0) return 2;
  if (zombie == 0) _exit(0);
  printf("%d %d\n", getpid(), zombie);
  fflush(stdout);
  while (getchar() != EOF) {}
  waitpid(zombie, NULL, 0);
  return 0;
}
