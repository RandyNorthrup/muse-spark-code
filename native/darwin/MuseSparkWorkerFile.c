// Included by the packaged created-path helper. Worker operations never
// create through an absolute pathname: every component is relative to a
// verified directory descriptor, with no symlink traversal.
#include <limits.h>

static int worker_created_parent = -1, worker_created_file = -1;
static const char *worker_created_name;
static void worker_refuse(const char *reason) {
  // A post-open refusal must not leave our empty file in a moved parent.
  // Cleanup is relative to that same held parent, and only while the name
  // still denotes our single-link, empty inode. Never remove a replacement.
  if (worker_created_file >= 0) {
    struct stat held, named;
    if (!fstat(worker_created_file, &held) && held.st_size == 0 && held.st_nlink == 1 &&
        !fstatat(worker_created_parent, worker_created_name, &named, AT_SYMLINK_NOFOLLOW) &&
        held.st_dev == named.st_dev && held.st_ino == named.st_ino) {
      if (unlinkat(worker_created_parent, worker_created_name, 0))
        fputs("worker empty-file cleanup uncertain\n", stderr);
    } else fputs("worker empty-file cleanup refused changed name\n", stderr);
  }
  fprintf(stderr, "worker file helper refused: %s\n", reason); exit(1);
}
static void worker_match(int fd, const char *expected) {
  char key[64]; identity(info(fd), key);
  if (strcmp(key, expected)) worker_refuse("identity changed");
}
static void worker_name(int fd, char *out) {
#ifdef __APPLE__
  if (fcntl(fd, F_GETPATH, out)) worker_refuse("handle path unavailable");
#else
  char name[64]; snprintf(name, sizeof(name), "/proc/self/fd/%d", fd);
  ssize_t length = readlink(name, out, PATH_MAX - 1);
  if (length <= 0 || length >= PATH_MAX - 1) worker_refuse("handle path unavailable");
  out[length] = 0;
#endif
}
static void worker_parent(int root, int parent, const char *root_name, const char *parent_name) {
  char actual[PATH_MAX]; worker_name(root, actual);
  if (strcmp(actual, root_name)) worker_refuse("root moved");
  worker_name(parent, actual);
  if (strcmp(actual, parent_name)) worker_refuse("parent moved");
  // Prove ancestry by descriptors rather than a string prefix.
  int current = dup(parent); if (current < 0) worker_refuse("parent unavailable");
  struct stat admitted = info(root);
  if (info(parent).st_dev != admitted.st_dev) worker_refuse("different device");
#ifdef __linux__
  if (mount_id(parent) != mount_id(root)) worker_refuse("different mount");
#endif
  for (;;) {
    struct stat held = info(current);
    if (held.st_dev == admitted.st_dev && held.st_ino == admitted.st_ino) break;
    int up = openat(current, "..", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (up < 0) worker_refuse("ancestor unavailable");
    struct stat above = info(up);
    if (held.st_dev == above.st_dev && held.st_ino == above.st_ino)
      worker_refuse("outside root");
    close(current); current = up;
  }
  close(current);
}
static int worker_walk(int root, const char *relative, int create, int *made) {
  char copy[PATH_MAX];
  if (strlen(relative) >= sizeof(copy)) worker_refuse("path too long");
  strcpy(copy, relative);
  int current = dup(root); if (current < 0) worker_refuse("root unavailable");
  char *state = NULL;
  for (char *part = strtok_r(copy, "/", &state); part; part = strtok_r(NULL, "/", &state)) {
    if (!leaf(part)) worker_refuse("invalid component");
    int next = openat(current, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0 && errno == ENOENT && create) {
      if (mkdirat(current, part, 0700)) worker_refuse("directory create failed");
      ++*made;
      next = openat(current, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    }
    if (next < 0) worker_refuse("parent unavailable or linked");
    struct stat named;
    if (fstatat(current, part, &named, AT_SYMLINK_NOFOLLOW)) worker_refuse("directory unavailable");
    struct stat held = info(next);
    if (named.st_dev != held.st_dev || named.st_ino != held.st_ino)
      worker_refuse("directory name changed");
    close(current); current = next;
  }
  return current;
}
// op root rootIdentity ancestorRelative ancestorIdentity remainingPath fileIdentity
static int worker_file(int argc, char **argv) {
  if (argc != 8) worker_refuse("invalid request");
  const char *op = argv[1], *base = argv[2], *relative = argv[4], *tail = argv[6];
  if (base[0] != '/' || relative[0] == '/' || tail[0] == '/' || !tail[0])
    worker_refuse("invalid path");
  int root = open(base, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) worker_refuse("root unavailable");
  worker_match(root, argv[3]);
  int made = 0, ancestor = worker_walk(root, relative, 0, &made);
  worker_match(ancestor, argv[5]);
  char parent_name[PATH_MAX], suffix[PATH_MAX];
  if (snprintf(parent_name, sizeof(parent_name), "%s%s%s", base, relative[0] ? "/" : "", relative) >= PATH_MAX)
    worker_refuse("path too long");
  worker_parent(root, ancestor, base, parent_name);
  if (strlen(tail) >= sizeof(suffix)) worker_refuse("path too long");
  strcpy(suffix, tail);
  char *slash = strrchr(suffix, '/'), *name = suffix;
  int parent = dup(ancestor);
  if (parent < 0) worker_refuse("parent unavailable");
  if (slash) {
    *slash = 0; name = slash + 1;
    close(parent); parent = worker_walk(ancestor, suffix,
      !strcmp(op, "worker-create") || !strcmp(op, "worker-prepare"), &made);
    size_t length = strlen(parent_name);
    if (snprintf(parent_name + length, sizeof(parent_name) - length, "/%s", suffix) >= (int)(sizeof(parent_name) - length))
      worker_refuse("path too long");
  }
  if (!leaf(name)) worker_refuse("invalid filename");
  worker_parent(root, parent, base, parent_name);
  if (!strcmp(op, "worker-prepare")) {
    char key[64]; identity(info(parent), key);
    printf("{\"identity\":\"%s\",\"createdFolders\":%d}\n", key, made);
    close(parent); close(ancestor); close(root); return 0;
  }
  if (strcmp(op, "worker-create") && strcmp(op, "worker-check") && strcmp(op, "worker-release"))
    worker_refuse("unknown operation");
  int fd = openat(parent, name, O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK |
    (!strcmp(op, "worker-create") ? O_CREAT | O_EXCL : 0), 0600);
  if (fd < 0) worker_refuse(errno == EEXIST ? "target exists" : "file unavailable or linked");
  if (!strcmp(op, "worker-create")) {
    worker_created_parent = parent; worker_created_file = fd; worker_created_name = name;
  }
  struct stat held = info(fd);
  if (!S_ISREG(held.st_mode) || held.st_nlink != 1) worker_refuse("file is not single-link regular");
  if (strcmp(op, "worker-create")) worker_match(fd, argv[7]);
  worker_parent(root, parent, base, parent_name);
  struct stat named;
  if (fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) ||
      held.st_dev != named.st_dev || held.st_ino != named.st_ino)
    worker_refuse("file name changed");
  if (!strcmp(op, "worker-release")) {
    if (held.st_size != 0) worker_refuse("reserved file changed");
    if (unlinkat(parent, name, 0)) worker_refuse("release failed");
  }
  char key[64]; identity(held, key);
  printf("{\"identity\":\"%s\",\"createdFolders\":%d}\n", key, made);
  worker_created_file = -1;
  close(fd); close(parent); close(ancestor); close(root); return 0;
}
