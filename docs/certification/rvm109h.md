# RVM109H — independent review of RLF-M109H

Date: 2026-11-02. Host: macmini (the Mac mini rig). Worktree:
`/Users/randy/lanes/RVM109H`, branch `rv/m109h`, starting at
`6b3e228cc` (rec/rlf-m109h, five commits on cc/int9). Provider calls: 0. Muse model requests: 0. Nothing was pushed, rebased, stashed or
tagged. Vault suites ran here (allowed on the Mac mini, file anchor).
No OS credential-store suite ran. Repository timeouts; no
`--testTimeout`.

Reviewed the credential-vault hardening in
`docs/certification/rlf-m109h.md`. Each finding below names severity,
file and line on this branch, the scenario, and the fix commit or why
it stays open.

## Findings

### P1. Linux dumpable does not survive exec of a normal command

`native/posix/vaultPeer.c:226` calls `PR_SET_DUMPABLE 0` and then
`execv`. For a normal binary (same uid and gid) the kernel sets
dumpable back to 1 at exec. A same-user read of `/proc/<pid>/environ`
succeeds after the command image is running. The approval card, the
changelog and PLAN said a Linux run was shielded. macOS has no
dumpable switch. Windows can read another process's environment from
memory when the caller is the same user. Root can read on every OS.
A setuid or file-capability target follows `suid_dumpable` instead,
and a later exec of a normal binary sets dumpable back to 1.

There is no supported way for this parent to keep dumpable off across
exec of an arbitrary normal command. The fix keeps the call, refuses
if it fails, and stops claiming the shield.

Fix: `8f9f0e1e3` (honest helper comment; the call stays, fail closed)
and `856ebcd31` (card in English and all 14 tables, changelog, PLAN).
`RLIMIT_CORE` {0, 0} is set first (`vaultPeer.c:220`) and does survive
exec of an unprivileged command. An ordinary crash writes no core
file. A target allowed to raise resource limits can raise it again.

Drill: putting the word "shielded" back into the English sentence
failed `vaultEnvironmentWarning.test.tsx` (exit 1: the sentence
matched `/shield/i`). Restored, 2 passed. The Linux environ case in
`vaultPeerRun.test.ts` is `skipIf` not linux. It now expects the
environment to be readable after `comm` shows the command. It did not
run here.

### P1. A recycled pid could pass between the walk and the parent helper

`src/core/vault/broker/peer.ts:75` re-read the current pid, then
called `parentIdentity` with only the pid. Those were two helper
processes. The C `parent` mode bracketed its own reads and did not
know the birth the walk had recorded. A pid that died and was reused
between the two calls was reported consistently by the second helper;
if that new process's parent was the requester, the walk accepted it.

The old argc==3 `parent` form is gone. `vaultPeer.c:245` requires
`parent <pid> <birth>`. `parent_identity` (`vaultPeer.c:130`) returns
1 unless both the first read and the re-read after the parent still
have that birth. `vaultParentIdentity` passes the birth.
`windowsHost.ts` `parentIdentify` re-reads the child after the parent
and returns null unless the birth and the parent pid are unchanged.
That Windows pair is still two reads, not one kernel bracket.

Fix: `8f9f0e1e3`.

Drill: commenting out the birth comparisons made
`feederAncestry.test.ts` "refuses a parent read whose recorded birth
is not the live one" resolve with the real parent instead of refusing
(exit 1). Restored, 6 passed. The right-birth case prints the
intermediate's pid through the real helper. A real pid-space wrap was
not run on this shared rig. The recycled-pid walk case still spoofs
`processIdentity` with another real process's start time; it does not
by itself force the allocator to reuse a pid.

Open, P3: Linux birth is a clock tick (`vaultPeer.c` stat field 22).
Two processes that start in the same tick can still collide. The
start time is not writable by the same user through `/proc` or, on
macOS, `proc_pidinfo`. A same-user rewrite of the installed helper is
a rewrite of the install. The POSIX helper is not sha256-pinned.
That stays open.

The Linux `/proc/<pid>/stat` parser takes the last `)` as the end of
`comm`, so a name with spaces or a `)` is parsed as the kernel writes
it. No defect found. No code change beyond the comment.

### P1. Headless exec denied every later vault use as tainted

`src/runtime/exec/execArgs.ts:486` sets `trustWorkspace: false`, and
exec refuses `--trust-workspace`. `src/core/vault/taint.ts:51` then
adds `restrictedWorkspace` on every request. The headless source
observed that note, so after the first request a clean `vault_run`
was denied as tainted even when the run had touched no tainted
content. The denial was said. It was the wrong denial.

Fix: `c75c40403`. `createHeadlessVaultTaintSource`
(`vaultExecHost.ts:66`) drops reasons whose source is
`restrictedWorkspace`. A search, web, mcp or other content reason
still taints. A note that is tainted and names no reason stays
tainted. A later clean note does not clear content already noted.
Workspace trust for hooks and files is unchanged.

Drill: observing the raw note failed the workspace-flag test (exit 1:
tainted, reason `restrictedWorkspace`). Restored, 5 passed.

Open, P3: `ModelApiHost` records web, browser and mcp provenance when
a tool call finishes, and the next request's note is what the vault
source sees. A tool result that never reaches a later note is not a
separate observation. No new call site was added in the host. The
construction of that host is not covered by a small real-code test
here.

### P2. Inherited descriptors above 2 were handed to the command

`execv` keeps non-CLOEXEC descriptors. The feeder's normal spawn
passes only 0, 1 and 2. Any extra descriptor, including a caller that
puts a pipe on stdio slot 3, survived into the command.
`close_extra_descriptors` (`vaultPeer.c:174`) reads `/dev/fd`, skips
0–2 and its own directory fd, and closes the rest. More than 256
extras, a read error, or a missing `/dev/fd` refuses before exec.
`closefrom` is not declared in this Mac's SDK, so the sweep is the
one path.

Fix: `8f9f0e1e3`.

Drill: `return 0` at the top of the sweep made the command print
`open` (exit 1, expected `closed`). Restored, the command prints
`closed` and stdout still works.

### P2. A refused run left the environment in the helper until exit

The secret is in the helper's environment until exec. A relative
path, a failed `setrlimit` or `prctl`, a failed descriptor sweep, or
a failed `execv` returned 1 with those strings still live.
`wipe_environment` (`vaultPeer.c:160`) zeroes each environment string
on those paths and does not wipe before a successful exec. Identity
and parent modes do not carry the secret and do not wipe.

Fix: `8f9f0e1e3`. No test reads the helper's memory after it has
exited, so the zeroed bytes themselves were not observed. The
relative-path case still exits non-zero. The wipe is a volatile loop
(`explicit_bzero` is undeclared on this Mac; `memset_s` is missing
from glibc).

### P3. Left open on purpose

- Same-user environment reads after exec, on Linux, macOS and
  Windows, and any read by an administrator. Said on the card. Not a
  remaining code defect.
- Same-tick Linux start times, and no forced pid-space wrap.
- POSIX helper not hash-pinned.
- Feeder JS strings that held a secret cannot be wiped (RVM109). Not
  expanded here.
- Windows policy path, container pid namespace, and the git, askpass,
  sudo, SSH and editor surfaces stay in `docs/real-life/unproven.md`.
- `finishCall` provenance reaches the vault source on the next noted
  request.

## What this rig ran

Red drills, each exit 1, then restore. Green re-run with repository
timeouts:

| Suite                              | Result                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feederAncestry.test.ts`           | 6 passed                                                                                                                                                                                                                                                                             |
| `vaultPeerRun.test.ts`             | 5 passed, 1 skipped (Linux `/proc`)                                                                                                                                                                                                                                                  |
| `vaultHeadlessTaint.test.ts`       | 5 passed                                                                                                                                                                                                                                                                             |
| `vaultEnvironmentWarning.test.tsx` | 2 passed                                                                                                                                                                                                                                                                             |
| `vaultExecDelegated.test.ts`       | first run exit 1: the fixture copies `native/darwin/muse-dictate-screen-x64.app`, which was absent (`ENOENT`). After `bash native/darwin/build.sh` (git-ignored outputs), 4 passed, including "a provenance note from the run refuses the next vault use, said in the denial record" |

The Linux `/proc` case did not run. `docker version` failed: cannot
connect to the Docker daemon at `unix:///Users/randy/.docker/run/docker.sock`.
The daemon was not started. The case stays for hosted CI, with the
corrected expectation (readable after exec, not a thrown read).

## Gates

Repository timeouts. No `--testTimeout`. No budget was raised.

| Command                                                                                                                             | Exit    | Result                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on touched sources, tests, PLAN, CHANGELOG, l10n, and these records                                              | 0       | `rvm109h.md` needed `--write` once                                                                                                                                                                                                                                                                                                                                                          |
| `eslint --max-warnings 0` on touched sources and tests                                                                              | 0       |                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run typecheck`                                                                                                                 | 0       | first run exit 1 (`vaultPeerRun` stdout possibly null); the pipe is checked, then the full run exited 0                                                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                                                                                                       | 0       | 0 problems, after `npm run desktop:l10n`                                                                                                                                                                                                                                                                                                                                                    |
| `npm run check:reference`                                                                                                           | 0       | 93 features, current                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:host-api`                                                                                                            | 0       | 0 problems                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run check:plan`                                                                                                                | 0       | 250 milestones, 0 drift. The first draft's phrase `reviewed` is not in the status list; the line says `built`                                                                                                                                                                                                                                                                               |
| `npm run check:roadmap`                                                                                                             | 0       | 250 entries, current                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:catches`                                                                                                             | 0       | counts unchanged. The parent probe's catch identity changed because the argv is built before the try; one GENERIC site was regenerated in `scripts/catch-baseline.json`, count not raised                                                                                                                                                                                                   |
| `npm run duplication`                                                                                                               | 0       | 0 clones                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run cycles`                                                                                                                    | 0       | no circular dependency                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run deadcode`                                                                                                                  | 0       | knip clean; the same 7 `@unwired` tag hints and 5 configuration hints                                                                                                                                                                                                                                                                                                                       |
| `npm run build`                                                                                                                     | 0       | every budget holds. `dist/vaultExec.js` 95.8 of 110 KiB, `dist/vaultExecHost.js` 34.0 of 40, `dist/vaultPolicy.js` 9.5 of 25, `dist/vaultRuntime.js` 21.3 of 25                                                                                                                                                                                                                             |
| the four review suites, final run                                                                                                   | 0       | 18 passed, 1 skipped (Linux `/proc`)                                                                                                                                                                                                                                                                                                                                                        |
| `npx vitest run test/unit/vault/vaultExecDelegated.test.ts --maxWorkers=2`                                                          | 0       | 4 passed after `bash native/darwin/build.sh`. The first attempt exited 1 because the git-ignored `.app` was absent                                                                                                                                                                                                                                                                          |
| `npx vitest related` on `peer.ts`, `brokerBindings.ts`, `posixNative.ts`, `windowsHost.ts`, `vaultExecEntry.ts`, `vaultExecHost.ts` | 1       | 23 files: 92 passed, 20 skipped, 8 failed. The failures are the login keychain refusing a headless write (`User interaction is not allowed` in `chatgptSubscriptionMigration.test.ts`; `vaultStoreScope.test.ts` then read no scoped anchor). The file-anchor suites in that same run passed, including the delegated suite and the ancestry walk. Those keychain suites were not run again |
| `npx vitest related src/shared/l10n/en.ts --run`                                                                                    | not run | the English table is imported across the unit suite. RLF-M109H's related run of this file was terminated after 34 minutes. Covered here by `check-l10n` (0), the card suite (2 passed) and typecheck (0)                                                                                                                                                                                    |
| `SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                                              | 0       | 699 rules, 6019 files, 0 findings. Three rules timed out on `ModelApiHost.ts`; the scan still exited 0                                                                                                                                                                                                                                                                                      |
| `npm run security:audit`                                                                                                            | 0       | 2 moderate advisories (`glob`, `minimatch`), 0 exceptions. The lock was not changed                                                                                                                                                                                                                                                                                                         |

Linux `/proc`: not run. Docker's client is installed; the daemon is not
(`Cannot connect to the Docker daemon at unix:///Users/randy/.docker/run/docker.sock`).
The daemon was not started.
