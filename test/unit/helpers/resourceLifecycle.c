// Fake-only lifecycle fixture: a zombie held until its parent is told to reap.
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <string.h>

int main(int argc, char **argv) {
  // Bound every fake process even if a guard-break test cannot clean it up.
  alarm(120);
  if (argc > 1 && strcmp(argv[1], "short") == 0) {
    printf("%d\n", getpid());
    fflush(stdout);
    getchar();
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "hold-zombie") == 0) {
    int control[2];
    if (pipe(control) != 0) return 2;
    pid_t child = fork();
    if (child < 0) return 2;
    if (child == 0) {
      close(control[1]);
      if (setsid() < 0) _exit(2);
      alarm(120);
      printf("%d\n", getpid());
      fflush(stdout);
      char command;
      read(control[0], &command, 1);
      _exit(0);
    }
    close(control[0]);
    int command;
    while ((command = getchar()) != EOF) {
      if (command == 'z') {
        char byte = 'z';
        if (write(control[1], &byte, 1) != 1) return 2;
      }
    }
    close(control[1]);
    waitpid(child, NULL, 0);
    return 0;
  }
  if (argc > 1) {
    int control[2];
    if (pipe(control) != 0) return 2;
    printf("root %d\n", getpid());
    fflush(stdout);
    pid_t detached = fork();
    if (detached < 0) return 2;
    if (detached == 0) {
      close(control[1]);
      if (setsid() < 0) _exit(2);
      alarm(120);
      printf("detached %d\n", getpid());
      fflush(stdout);
      char command;
      while (read(control[0], &command, 1) == 1) {
        if (command == 'e') _exit(0);
        if (command == 'f') {
          pid_t grandchild = fork();
          if (grandchild < 0) _exit(2);
          if (grandchild == 0) {
            if (setsid() < 0) _exit(2);
            alarm(120);
            printf("grandchild %d\n", getpid());
            fflush(stdout);
            for (;;) pause();
          }
        }
      }
      _exit(0);
    }
    close(control[0]);
    int command;
    while ((command = getchar()) != EOF && command != 'q') {
      if (command == 'f' || command == 'e') {
        char byte = (char)command;
        if (write(control[1], &byte, 1) != 1) return 2;
      }
    }
    close(control[1]);
    return 0;
  }
  pid_t zombie = fork();
  if (zombie < 0) return 2;
  if (zombie == 0) _exit(0);
  printf("%d %d\n", getpid(), zombie);
  fflush(stdout);
  while (getchar() != EOF) {}
  waitpid(zombie, NULL, 0);
  return 0;
}
