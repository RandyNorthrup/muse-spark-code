// M98 J: libproc identity with a kernel-held process-generation watch.
// No task port, credentials, process environment or account labels are read.
#include <libproc.h>
#include <sys/event.h>
#include <sys/mount.h>
#include <sys/proc.h>
#include <sys/stat.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// ABI/path buffer sizes, not model or application tunables.
#define COMMAND_BYTES 32
#define USEC_LIMIT 1000000

struct identity {
    struct proc_bsdinfo info;
    char executable[PROC_PIDPATHINFO_MAXSIZE];
};

static int read_identity(pid_t pid, struct identity *out) {
    memset(out, 0, sizeof(*out));
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &out->info, sizeof(out->info)) != sizeof(out->info) ||
        proc_pidpath(pid, out->executable, sizeof(out->executable)) <= 0 ||
        out->info.pbi_pid != (uint32_t)pid || out->info.pbi_status == SZOMB ||
        out->info.pbi_uid != getuid() || out->info.pbi_ruid != getuid() ||
        out->info.pbi_start_tvsec == 0 || out->info.pbi_start_tvusec >= USEC_LIMIT)
        return -1;
    return 0;
}

static int same_identity(const struct identity *a, const struct identity *b) {
    return a->info.pbi_pid == b->info.pbi_pid &&
        a->info.pbi_uid == b->info.pbi_uid && a->info.pbi_ruid == b->info.pbi_ruid &&
        a->info.pbi_start_tvsec == b->info.pbi_start_tvsec &&
        a->info.pbi_start_tvusec == b->info.pbi_start_tvusec &&
        strcmp(a->executable, b->executable) == 0;
}

static int watch_alive(int queue) {
    struct kevent event;
    const struct timespec immediate = {0, 0};
    // Any event (exit/exec/error) permanently invalidates this lease.
    return kevent(queue, NULL, 0, &event, 1, &immediate) == 0;
}

static void json_string(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; ++p) {
        if (*p == '"' || *p == '\\') printf("\\%c", *p);
        else if (*p < ' ') printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}

static void print_identity(const struct identity *value) {
    printf("{\"pid\":%u,\"uid\":%u,\"realUid\":%u,\"creationTime\":\"%llu%06llu\",\"executable\":",
        value->info.pbi_pid, value->info.pbi_uid, value->info.pbi_ruid,
        (unsigned long long)value->info.pbi_start_tvsec,
        (unsigned long long)value->info.pbi_start_tvusec);
    json_string(value->executable);
    puts("}");
    fflush(stdout);
}

static int supported_volume(const struct statfs *volume) {
    return (strcmp(volume->f_fstypename, "apfs") == 0 || strcmp(volume->f_fstypename, "hfs") == 0) &&
        (volume->f_flags & MNT_LOCAL) && !(volume->f_flags & MNT_UNION);
}

static int volume_proof(const char *directory) {
    char canonical[PATH_MAX];
    struct statfs volume;
    struct stat entry;
    if (!realpath(directory, canonical) || strcmp(canonical, directory) != 0 ||
        lstat(directory, &entry) != 0 || !S_ISDIR(entry.st_mode) ||
        entry.st_uid != getuid() || (entry.st_mode & (S_IWGRP | S_IWOTH)) ||
        statfs(directory, &volume) != 0 || !supported_volume(&volume))
        return -1;
    printf("{\"filesystem\":");
    json_string(volume.f_fstypename);
    printf(",\"flags\":%u,\"device\":\"%llu\",\"uid\":%u}\n", volume.f_flags,
        (unsigned long long)entry.st_dev, entry.st_uid);
    return 0;
}

static int lease(pid_t pid) {
    struct identity initial, current;
    struct kevent registration;
    int queue = kqueue();
    if (queue < 0) return -1;
    // EVFILT_PROC attaches to the process object, not future uses of its PID.
    // Register BEFORE reading libproc; poll before and after every sample.
    EV_SET(&registration, pid, EVFILT_PROC, EV_ADD | EV_CLEAR, NOTE_EXIT | NOTE_EXEC, 0, NULL);
    if (kevent(queue, &registration, 1, NULL, 0, NULL) < 0 ||
        !watch_alive(queue) || read_identity(pid, &initial) < 0 || !watch_alive(queue)) {
        close(queue);
        return -1;
    }
    print_identity(&initial);
    char command[COMMAND_BYTES];
    int alive = 1;
    while (fgets(command, sizeof(command), stdin)) {
        if (strcmp(command, "identity\n") != 0 && strcmp(command, "alive\n") != 0) {
            close(queue);
            return -1;
        }
        alive = alive && watch_alive(queue) && read_identity(pid, &current) == 0 &&
            same_identity(&initial, &current) && watch_alive(queue);
        if (strcmp(command, "alive\n") == 0) {
            puts(alive ? "true" : "false");
            fflush(stdout);
        } else if (alive) print_identity(&current);
        else {
            close(queue);
            return -1;
        }
    }
    close(queue);
    return ferror(stdin) ? -1 : 0;
}

int main(int argc, char **argv) {
    int result = -1;
    if (argc == 3 && strcmp(argv[1], "volume") == 0) result = volume_proof(argv[2]);
    else if (argc == 3 && strcmp(argv[1], "lease") == 0) {
        char *end;
        errno = 0;
        long pid = strtol(argv[2], &end, 10);
        if (!errno && *end == '\0' && pid > 0 && pid <= INT_MAX) result = lease((pid_t)pid);
    }
    if (result < 0) {
        // Fixed words only: never echo a path, process command or system error.
        fputs("unverified-darwin-native\n", stderr);
        return 1;
    }
    return 0;
}
