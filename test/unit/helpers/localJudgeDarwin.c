// Synthetic native evidence tests, never shipped. Use the production predicates.
#include <libproc.h>
#include <string.h>
#include <unistd.h>
static struct proc_bsdinfo observed;
static int synthetic, failed_info, failed_path;
static int sample_info(int pid, int flavor, uint64_t arg, void *buffer, int size) {
    if (!synthetic) return proc_pidinfo(pid, flavor, arg, buffer, size);
    memcpy(buffer, &observed, sizeof(observed));
    return failed_info ? sizeof(observed) - 1 : sizeof(observed);
}
static int sample_path(int pid, void *buffer, uint32_t size) {
    if (!synthetic) return proc_pidpath(pid, buffer, size);
    if (failed_path) return 0;
    strcpy(buffer, "/captured/native/ollama");
    return strlen(buffer);
}
#define proc_pidinfo sample_info
#define proc_pidpath sample_path
#define main local_judge_main
#include "../../../native/darwin/LocalJudgePeer.c"
#undef main
#include <signal.h>
#include <sys/wait.h>

static int reuse_drill(void) {
    pid_t parent = getpid();
    pid_t original = fork();
    if (original < 0) return 1;
    if (original == 0) { while (getppid() == parent) usleep(100000); _exit(0); }
    int queue = kqueue();
    struct kevent registration;
    EV_SET(&registration, original, EVFILT_PROC, EV_ADD | EV_CLEAR, NOTE_EXIT | NOTE_EXEC, 0, NULL);
    if (queue < 0 || kevent(queue, &registration, 1, NULL, 0, NULL) < 0) return 1;
    struct identity before, after;
    if (read_identity(original, &before) < 0) return 1;
    printf("%d\n", original);
    fflush(stdout);
    char command[COMMAND_BYTES];
    if (!fgets(command, sizeof(command), stdin)) return 1;
    kill(original, SIGKILL);
    waitpid(original, NULL, 0);
    // Bounded fork/wait cycle; no process pile-up, installs, credentials or inference.
    const int ceiling = 200000;
    for (int attempt = 1; attempt <= ceiling; attempt++) {
        pid_t candidate = fork();
        if (candidate < 0) return 1;
        if (candidate == 0) { while (getppid() == parent) usleep(100000); _exit(0); }
        if (candidate == original) {
            int different = read_identity(candidate, &after) == 0 && !same_identity(&before, &after);
            int invalid = !watch_alive(queue);
            int checked = different && invalid;
            printf("{\"pid\":%d,\"attempts\":%d,\"differentStart\":%s,\"exitWatchStillInvalid\":%s,"
                "\"beforeCreationTime\":\"%llu%06llu\",\"afterCreationTime\":\"%llu%06llu\"}\n",
                candidate, attempt, different ? "true" : "false", invalid ? "true" : "false",
                (unsigned long long)before.info.pbi_start_tvsec, (unsigned long long)before.info.pbi_start_tvusec,
                (unsigned long long)after.info.pbi_start_tvsec, (unsigned long long)after.info.pbi_start_tvusec);
            fflush(stdout);
            if (!fgets(command, sizeof(command), stdin)) checked = 0;
            kill(candidate, SIGKILL);
            waitpid(candidate, NULL, 0);
            close(queue);
            return checked ? 0 : 1;
        }
        kill(candidate, SIGKILL);
        waitpid(candidate, NULL, 0);
    }
    puts("{\"reused\":false}");
    return 1;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "reuse") == 0) return reuse_drill();
    if (argc != 3) return 1;
    if (strcmp(argv[1], "sample") == 0) {
        synthetic = 1;
        observed.pbi_pid = 42;
        observed.pbi_uid = observed.pbi_ruid = getuid();
        observed.pbi_start_tvsec = 123456;
        observed.pbi_start_tvusec = 654321;
        struct identity value;
        if (read_identity(42, &value) != 0) return 1;
        if (strcmp(argv[2], "uid") == 0) observed.pbi_uid++;
        else if (strcmp(argv[2], "realUid") == 0) observed.pbi_ruid++;
        else if (strcmp(argv[2], "pid") == 0) observed.pbi_pid++;
        else if (strcmp(argv[2], "start") == 0) observed.pbi_start_tvsec = 0;
        else if (strcmp(argv[2], "microseconds") == 0) observed.pbi_start_tvusec = USEC_LIMIT;
        else if (strcmp(argv[2], "zombie") == 0) observed.pbi_status = SZOMB;
        else if (strcmp(argv[2], "info") == 0) failed_info = 1;
        else if (strcmp(argv[2], "path") == 0) failed_path = 1;
        else return 1;
        return read_identity(42, &value) == 0;
    }
    if (strcmp(argv[1], "volume") == 0) {
        struct statfs value = {0};
        snprintf(value.f_fstypename, sizeof(value.f_fstypename), "%s", argv[2]);
        value.f_flags = MNT_LOCAL;
        if (strcmp(argv[2], "nonlocal") == 0) {
            strcpy(value.f_fstypename, "apfs");
            value.f_flags = 0;
        }
        if (strcmp(argv[2], "union") == 0) {
            strcpy(value.f_fstypename, "apfs");
            value.f_flags |= MNT_UNION;
        }
        int expected = strcmp(argv[2], "apfs") == 0 || strcmp(argv[2], "hfs") == 0;
        return !!supported_volume(&value) != expected;
    }
    if (strcmp(argv[1], "generation") == 0) {
        struct identity a = {0}, b = {0};
        a.info.pbi_pid = 42;
        a.info.pbi_uid = a.info.pbi_ruid = 501;
        a.info.pbi_start_tvsec = 123456;
        a.info.pbi_start_tvusec = 654321;
        strcpy(a.executable, "/vetted/Ollama.app/Contents/Resources/ollama");
        b = a;
        if (!same_identity(&a, &b)) return 1;
        if (strcmp(argv[2], "pid") == 0) b.info.pbi_pid++;
        else if (strcmp(argv[2], "uid") == 0) b.info.pbi_uid++;
        else if (strcmp(argv[2], "realUid") == 0) b.info.pbi_ruid++;
        else if (strcmp(argv[2], "seconds") == 0) b.info.pbi_start_tvsec++;
        else if (strcmp(argv[2], "microseconds") == 0) b.info.pbi_start_tvusec++;
        else if (strcmp(argv[2], "path") == 0) strcpy(b.executable, "/relay/ollama");
        else return 1;
        return same_identity(&a, &b);
    }
    return 1;
}
