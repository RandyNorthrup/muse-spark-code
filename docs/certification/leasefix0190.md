# LEASEFIX0190: a window that saw a crashed credential lock never moves a live one aside

Lane LEASEFIX0190, branch `fix/0190-leasefix`, base `fb7c75cc71` (the merge
of LEASERACE, `c9105efeca`), rig: this PC (Windows 11 Pro 10.0.26200, NTFS,
Node 24.20.0), worktree `mx-leasefix`, 2026-10-20. Release blocker for
0.19.0.

## The defect

LEASERACE's takeover moved a crashed owner's lock directory aside under a
name made from the attempt's own random nonce (`<lockDir>.retired-<nonce>`),
checked the moved record, then removed it, or renamed it back when it was
not the dead record, swallowing a failed rename back. That still let two
holders into the credential store:

1. A reads dead record D at the lock's name and finds D's pid dead.
2. B, faster, moves D aside, verifies it, removes it and claims a fresh
   lock with its live record X.
3. A, resuming, renames the lock's name (now B's live X) to A's own fresh
   name. Nothing stops it.
4. A reads X, not D. Before A renames it back, C finds the name free and
   claims it.
5. A's rename back fails, swallowed. B's live lock sits aside while B is
   inside its credential transaction, and C holds the name: B and C both
   write.

The vault's file lease (`src/core/locks/fileLease.ts`) has the same
move-aside shape but survives it through fences; the credential lease has
no fence check, so displacing a live lock must be impossible.

## The fix (`src/core/credentialLease.ts`)

- The takeover renames the lock to a tombstone named by the dead record
  observed, not by the attempt: `<lockDir>.retired-<sha256 hex of
JSON [pid, startTime, nonce]>`. The record's text never enters a path.
- After the moved record is proven to be D (same pid, start time and
  nonce, and the pid still dead), the tombstone is kept with D's
  `owner.json` inside, never removed, by age or otherwise. It is never an
  empty directory, so a directory rename onto it fails everywhere (POSIX
  ENOTEMPTY/EEXIST; Windows EPERM, which a rename onto any existing
  directory gets). Once D has left the lock's name, every slower contender
  that saw D fails its move and looks again; none can move a later live
  lock aside. The fresh claim follows in the same pass, as before.
- Rename failures, with no catch-all: ENOENT, EEXIST and ENOTEMPTY mean
  the move was lost, so look again. EPERM, EACCES and EBUSY look again on
  Windows (the tombstone exists, or a handle is open inside the lock);
  elsewhere they mean the folder refuses this process (permissions, a
  sticky folder, a mount point) and are thrown. Anything else is thrown.
  Decided by `isLostTakeoverMove` over the file's `lockErrorCode`.
- A moved record that is not D (only a build from before the tombstone,
  whose takeover removed the dead lock, running at the same time can cause
  it) is put back while the name is free. If that fails, the attempt
  throws `CredentialLockBusyError` with the failure as `cause` (the class
  gained an optional ES2022 `cause`), as fileLease's "A moved lock could
  not be put back" does. Nothing is swallowed.
- The ownerless branch and the release path are unchanged; the
  `claimFreshLock` comment now names the ownerless reclaim (not a
  takeover move) as what can remove a directory it just won.
- Where people see it: the lock directory is `providers.json.lock` beside
  the user-level `providers.json`, `<config>/muse-spark-code/` (`$XDG_CONFIG_HOME`
  or the home folder's `.config`, on every platform). A crash during a
  credential write leaves one `providers.json.lock.retired-…` folder
  there; the CHANGELOG `[0.19.0]` Fixed line names it and says it holds no
  key.

## The test (`test/unit/credentialLease.test.ts`)

`a window that saw a crashed lock another window took first`, on real
files with the real liveness check (`isOwnerAlive`). Window B is a real
process: the suite bundles `src/core/credentialLease.ts` with esbuild into
a temporary CommonJS file (the pattern of `dailySpend.test.ts`) and starts
`node holder.cjs <lockDir> <pid>` with `spawnSync`, credentials stripped
from its environment. B acquires under this process's pid (alive) with
its own start time and exits holding the lock.

- `refuses and never moves the live lock aside, even for a moment`: the
  lock is seeded with a dead owner (`DEAD_PID`). A's `isProcessAlive`, on
  its first call for `DEAD_PID` (A has just read D), runs B's takeover to
  completion and takes the snapshots, then answers with the real check.
  Asserted: A rejects with `CredentialLockBusyError`; the lock holds B's
  exact record; its `ino` and `birthtimeNs` are unchanged; the folder's
  modification time is unchanged; the only entry beside the lock is one
  tombstone holding D, so nothing else holds B's record.
- `puts back a lock that is not the dead one it saw, and keeps no
tombstone of it`: as above, but before B the hook removes the dead lock
  the way a build from before the tombstone did, so B claims a free name
  and A moves B's lock to D's tombstone name, finds it is not D and puts
  the same directory back. Asserted: A busy; B's exact record, same `ino`
  and birth time; nothing beside the lock.

Why the folder's modification time: a rename keeps a directory's identity
(`ino`, birth time), so on fb7c75cc71 A's move aside and back left B's
record and identity intact and only showed as a change to the folder's
entries. POSIX requires rename to mark the parent folder's modification
and status-change times for update; on this PC (NTFS) a rename aside and
back changed the folder's modification time, while a failed rename onto
an existing tombstone (EPERM) and a failed `mkdir` (EEXIST) left it
unchanged (probe in `temp/`, three runs). Before taking the snapshot the
test waits until the filesystem's own clock has passed the folder's last
change (a probe file rewritten in a separate folder until its
modification time is newer), so a move cannot hide inside one timestamp
tick. No wait of ours, no timeout added.

No file-operations seam was added: the red above is sound without one.
The cost is that the put-back failure (`CredentialLockBusyError` with
`cause`) has no unit test: it needs a third window to claim the name
between A's move and A's put-back, and the code runs nothing injectable
between the two, so only a seam could drive it deterministically. Same-build
contenders cannot reach that branch at all (see the fix above).

## Red on fb7c75cc71, green on the fix

| Run                                                                                                                                                                                                              | Result                                                                                                                                                                                                                                                             | Exit |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `cp src/core/credentialLease.ts temp/credentialLease.fix.ts; git show fb7c75cc71:src/core/credentialLease.ts > src/core/credentialLease.ts; npx vitest run test/unit/credentialLease.test.ts --reporter=verbose` | 1 failed, 10 passed: `refuses and never moves the live lock aside` at the folder-time assertion (`expected 1792543371893128700n to be 1792543371858384800n`); busy, B's record, `ino` and birth time all passed, as rename keeps them. B ran fb7c75cc71's code too | 1    |
| `cp temp/credentialLease.fix.ts src/core/credentialLease.ts` (restored, `cmp` identical); `npx vitest run test/unit/credentialLease.test.ts --reporter=verbose`                                                  | 11 passed                                                                                                                                                                                                                                                          | 0    |

## Break on purpose (AGENTS.md rule 3)

Each drill edited the fixed module (`temp/drill.cjs`), ran
`npx vitest run test/unit/credentialLease.test.ts`, and restored the file
from `temp/credentialLease.fix.ts` (`cmp` identical).

| Drill              | Change                                                                 | Failed                                                                                                        | Exit |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- |
| `tombstoneRemoved` | `rm` the proven tombstone before the fresh claim (LEASERACE's removal) | `refuses and never moves the live lock aside` (folder time changed) and the lane's contended test (no winner) | 1    |
| `identityDropped`  | treat any moved record as the dead one                                 | `puts back a lock that is not the dead one it saw` (A acquired: it kept B's live lock as a tombstone)         | 1    |
| `lostMoveNarrowed` | only ENOENT counts as a lost move                                      | `refuses and never moves the live lock aside` (EPERM thrown) and the contended test                           | 1    |

## Catch gate

`node scripts/catch-inventory.mjs`: core SWALLOW 72 and GENERIC 267
unchanged; CLEANUP 238 → 235. The three LEASERACE cleanup catches are
gone: the lost move is NARROW (`isLostTakeoverMove`, rethrow otherwise),
the failed put-back is REPORTED (throws with `cause`), and the tombstone
removal no longer exists. The baseline was regenerated with
`--write-baseline`. The regeneration also refreshed one CLEANUP site's
identity in `src/core/usage/resourceJournal.ts:742` (same class, same
count, handler unchanged): the NOLIMITSSET merge `a4e176e5e7` changed the
text of its `try` without regenerating, so `check:catches` already failed
at fb7c75cc71 ("new CLEANUP catch site" and "Accepted catch sites were
removed or changed").

## Gates on the final tree

| Gate                                                                                                                                                             | Exit                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `npx prettier --check src/core/credentialLease.ts test/unit/credentialLease.test.ts CHANGELOG.md scripts/catch-baseline.json docs/certification/leasefix0190.md` | 0                                |
| `npx eslint --max-warnings 0 src/core/credentialLease.ts test/unit/credentialLease.test.ts`                                                                      | 0                                |
| `npm run typecheck`                                                                                                                                              | 0                                |
| `node scripts/catch-inventory.mjs --check`                                                                                                                       | 0 (after the regeneration above) |
| `npm run duplication`                                                                                                                                            | 0 (0 clones)                     |
| `npm run cycles`                                                                                                                                                 | 0                                |
| `npm run deadcode`                                                                                                                                               | 0                                |
| `node scripts/check-l10n.mjs`                                                                                                                                    | 0                                |
| `npm run check:roadmap`                                                                                                                                          | 0                                |
| `npx vitest run test/unit/whatsNewContent.test.ts` (the CHANGELOG change)                                                                                        | 0 (55/55)                        |
| `npx vitest run test/unit/credentialLease.test.ts`, five runs                                                                                                    | 0, 0, 0, 0, 0 (11/11 each)       |
| `npx vitest related src/core/credentialLease.ts --run`                                                                                                           | 0 (8 files, 51 tests)            |
| `npm run build`                                                                                                                                                  | 1 (see below)                    |

`npm run build`: the production build and every bundle size budget passed
(`dist/credentialLease.js` 10.8 KiB of its 25 KiB). The chain then stopped
at `check-bundle-split.mjs` with 8 problems, all in bundles this lane does
not touch (`pageWorker`, `agentImport`, `imageResizeWorker`, `validation`),
each a "no longer carries node_modules/…" match. This worktree's
`node_modules` is a junction to another checkout's, so esbuild's metafiles
name those inputs `../mx-final/node_modules/…` (read in
`dist/meta/pageWorker.json`) and the `node_modules/` prefix check cannot
match; the checks after it (lazy registry, host globals, notices, legal
records) did not run. Hosted CI builds from a real install.

Not run in this lane: hosted CI and the packed product's real-life run
(the lead's, at merge and release). Linux and macOS behaviour of the new
tests is proven by hosted CI, not on this PC.
