# RVTEMPLEAK — review of temp-tree removal before merge

2026-10-30, rig macmini (macOS, x86_64), branch `rv/templeak` from
`rec/rlf-templeak` (HEAD at review start `1746d0b96`, base `int/recovery`
`dfcb45936`). Real folders under the worktree's gitignored `temp/`. No
credential store, no vault, no paid or live model call. The macOS helper
`native/darwin/muse-dictate-screen-x64.app` was built here with
`native/darwin/build.sh` (exit 0) so the reclaim suite runs the product
app; that app is gitignored. The quarantine suite compiles the same
`native/darwin/MuseSparkCreated.c` standalone
(`test/unit/helpers/createdNative.ts`, `-Wall -Wextra -Werror`). Windows
was not run: the C# change is in `native/windows/MuseSparkJob.cs`, which
the Windows tests compile from source. The Linux directory walk
(`CreatedRegistry` when `directories` is unset) was not executed on this
Mac; the Mac product path is the C helper.

## 1. Nothing is removed that the product did not create

Identity is `device:inode`, checked again after the quarantine rename and
on resume. The marker `.muse-owner.json` must hash to the stored token.
The basename must match `muse-tree-` plus hex. Opens use
`O_NOFOLLOW | O_DIRECTORY` (Windows: open the reparse point and refuse it).
A symlink is unlinked as itself only after the tree is proven; a symlink
standing in for the tree is refused.

Run here, real directories, dead creator with exact evidence, clock past
the keep (`test/unit/createdRegistryQuarantineResume.test.ts`):

- A different directory at the tree's own name, with a sentinel file: sweep
  `removed` 0, id in `refused`, sentinel still there. **Pass.**
- A symlink at the tree's name pointing at the real tree held aside: sweep
  `removed` 0, id in `refused`, the target's `payload.txt` still there.
  **Pass.**
- A different directory already at `.muse-trash-<id>`: sweep `removed` 0,
  id in `refused`, sentinel still there, registry entry kept. **Pass.**
  Before the fix this reported `removed` 1 and dropped the entry (red,
  below).

Code, not a second run: the base is opened and its identity matched before
any child operation, so a world-writable parent of a private base cannot
retarget the walk. `private_dir` / `checkPrivate` refuse a directory that
is not this user's or whose mode includes `0022`. A registry file whose
owner or mode fails that check throws and the sweep does not delete. This
account did not have a second uid to plant another user's file. A junction
is the Windows reparse refusal; not run here. The rename is by name on
Darwin: after `renameatx_np`, the helper stats the destination and, if the
inode differs, renames it back only while the original name is absent,
then refuses. It does not delete that directory. Windows rename is by the
handle already opened.

## 2. "Owner proven gone" cannot be faked

The sweep no longer uses the legacy gone-check. `createdTreeCreator`
stores `machineId`, `bootId`, `pidNamespace` and `exactBirth` from
`exactCurrentProcessOwner(dataDir)`. `isCreatedTreeCreatorGone` returns
false when any of those is missing, or when this process cannot read its
own, and otherwise calls `isProcessOwnerGone` with `exactOnly` and this
process as `self`. A pid that is absent only in this namespace is not
proof. Tests pass a temp `dataDir`, so the installation id is written
there, not into this account's agent-data folder.

Run here:

- Dead creator with those four fields, tree quarantined: after the keep,
  the sweep removes it (section 4's resume). **Pass.**
- Same dead pid with only host, pid and `processStart`: sweep `removed` 0,
  tree still present, `endedAtMs` still null. **Pass.** Before the fix the
  legacy check removed it (red, below).
- Live creator, second registry on the same file, clock past the keep:
  `removed` 0, entry stays `created` / `endedAtMs` null
  (`createdRegistryReclaim.test.ts`). **Pass.** That is the second window.
- Same live child stopped with `SIGSTOP`, swept again, then `SIGCONT`:
  `removed` 0, tree still there. **Pass.** A sleeping process still
  answers `kill(pid, 0)` and its birth is unchanged. Windows has no
  `SIGSTOP`; the live-process case is that platform's check.
- Killed creator (SIGKILL) and a creator that finished failed and exited:
  ended at the first sweep, kept, removed only after
  `RESOURCE_TEMP_KEEP_MS`. **Pass.**

Not run here: two PID namespaces. macOS cannot create one. The exact check
returns false when `pidNamespace` differs or is absent; the absent case is
the test above. A pid that is dead in this namespace is gone only when the
machine, boot and namespace also match, so a live process in another
namespace is not declared gone by this sweep.

Pid reuse while the pid is dead is "gone": that process has exited. While
the pid is alive, exact birth is compared. macOS `ps -o lstart` is one
second. A reuse inside that same second can look like the same birth and
the tree is kept (a leak, not a deletion of the new process's files).

A crash during the sweep is section 4. The registry save that drops the
entry happens only after the helper reports the directory gone.

## 3. Every host sweeps at start

`resourceGovernorHost` starts `created.clean()` and returns the host
without awaiting it (`void created.clean().then(onCleanup).catch(onError)`).
Per-entry failures stay inside `clean` and come back as `refused`. A
failure of the sweep itself goes to `onError`: the editor logs
`warnResourceUnavailable`; the runtime reports
`ResourceReadingError('resources.admission')` on its existing error
channel. Neither path throws into the turn that is opening the host.
`onCleanup` logs `resourceCleanupRemoved` / `resourceCleanupRefused` and
does not include a path or an entry id. No new sentence was added.

The sweep takes the registry queue, so the first `createTemp` on that
registry waits until the sweep finishes its current pass. That wait was
not timed. The host function itself does not block on it.

## 4. The 24 h keep and the quarantine

`removeEntry` still returns before any deletion while a failed temp tree's
`endedAtMs` is inside `RESOURCE_TEMP_KEEP_MS`. The reclaim suite and the
quarantine suite both observe `removed` 0 on that first sweep, then
removal only after the clock advances. `worktree` and `dependencies` still
require `archivedAndClean`. A wrong marker is refused and kept (reclaim
suite). **Pass.**

The quarantine defect: Darwin, Windows and the Linux walk all treated
"original name is missing" as `{"removed":true}` and the registry then
deleted the entry. A crash after the rename to `.muse-trash-<id>` and
before `rmdir` left the tree on disk with nothing pointing at it. A
different directory at that name was forgotten the same way. Darwin's
rename is by name; a swap after the pre-rename stat was not rolled back.

Fix: if the original name is missing, open `.muse-trash-<id>`. Both
missing is success. A directory whose identity and marker match is
emptied and removed (the marker is unlinked last, so a crash mid-walk
can still be proved). Anything else is refused and left in place. After
a by-name rename, a different inode is moved back only when the original
name is free, then refused. The walk is not rolled back once it has
started.

## Red, then green

Against the unmodified helper (standalone compile), three tests, exit 1:

- Parked tree: sweep reported `removed` 1 and dropped the entry;
  `payload.txt` was still at `.muse-trash-<id>` (`expected true to be false`).
- Foreign directory at the quarantine name: `removed` was 1, expected 0.
- Dead creator with no exact evidence: `removed` was 1, expected 0.

After the fix, `npx vitest run test/unit/createdRegistryQuarantineResume.test.ts --maxWorkers=2`
is the suite of five (the two confinement cases above included). The
reclaim suite (four, including SIGSTOP) was run through the rebuilt x64
app. Neighboring suites that construct the proof: save-errors 3, spaces 2,
sweep 4, race 1. Repository timeouts only; the 30 s bound on the real
helper tests is the existing per-test timeout ("Real native helper spawns:
genuinely long." / "Real child processes and native helper spawns:
genuinely long.").

## Drills

Break, non-zero, restore byte-exact (`shasum` matched the pre-break file),
green. `git diff` on each file was empty after the restore.

- Drill A. `MuseSparkCreated.c` remove, on `ENOENT` of the original name,
  restored the old `{"removed":true}` return. `vitest` `-t "finishes a tree"`
  exit 1: `removed` 1, payload still present. Restored
  `2af08192560d2d81d48fd3065c0162a94783adb8`. Same test exit 0.
- Drill B. `isCreatedTreeCreatorGone` returned true when machine, boot,
  namespace or exact birth was missing. `vitest` `-t "no exact process evidence"`
  exit 1: `removed` 1. Restored
  `8fbe53c97f0275f67e037b45435f1130e0afbd87`. Same test exit 0.

## What is sound

The 24 h keep, the wrong-marker refusal, confinement to the registry base,
symlink-not-followed, a replaced directory at the tree name, a live or
stopped creator shared across two registries, and the start sweep's
`onError` path. Entries with no creator, and entries without exact
evidence, are not ended by a sweep.

## Still true, not changed here

- Linux `isProcessOwnerGone` without `exactOnly`, when both sides lack
  `bootId`, compares a tick count with an epoch-millisecond estimate and
  can call a live process gone. The sweep does not use that path. A new
  entry is stored only when exact evidence, including `bootId`, was read;
  if the boot id cannot be read, the entry has no creator and is kept.
- macOS birth resolution of one second, as above: a leak under same-second
  pid reuse, not a deletion.
- A crash after the marker itself has been unlinked and before `rmdir`
  leaves a partial `.muse-trash-<id>` that a later sweep refuses, because
  the marker is what distinguishes this tree from an inode reused by
  someone else. The registry entry stays. The marker is now last, so that
  window is one unlink.
- No second uid, no Windows junction run, no second PID namespace, and the
  Linux walk was not executed on this machine. Start-to-start time of the
  sweep was not measured.
