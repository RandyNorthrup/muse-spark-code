# M96c lane Q — merge queue and hygiene

Rig: Kubuntu. Base `dfbedc5c`; plan of record `e23ec61c`. Read PLAN.md D75
and M96c in full, m96-research.md §8, lane 0c's certification and the
RVM96C3 review before implementing. No model, paid or live call is authorized
or made. No dependency, gate, threshold or ignore is changed.

## Queue and merge routine

`orderMergeQueue` applies merged dependencies, waiter priority inheritance,
predicted conflicts, blast radius and finish time. `nextMergeBatch` takes
consecutive small candidates closed under dependency. `admitMergeBatch`
retries failed checks once on the exact batch, then checks cumulative trees
serially, returns culprits for rework and holds their dependents. It returns
only the last combination that passed. The caller provides independent
trial trees, resolved checks and task-copy rework/full-review admission.

`mergeFile` is the common prediction/landing routine. Lane C injects its
strict JSON-table and changelog mergers; no text fallback exists. Text
merging is injected, with explicit added, deleted, binary, link and mode
rules. Only a plain-text conflict with explicit `markers` can enter a trial.

Verification: the whole `teamMergeQueue.test.ts` file passed (8 tests).
Focused ESLint passed. Full quality is reserved for the lead under the
lane brief's shared rules; commits here use the hooks and focused checks.

## Red drills

Each mutation ran the whole focused file, exited nonzero with a named
assertion failure, then restored the source byte-exact and compared SHA-256.

| Mutation                     | Named failing test(s)                                                                                                                                                                                                           | Restored source SHA-256                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| dependency order             | orders dependencies before finish, inherits priority and applies every tie breaker                                                                                                                                              | `e222882a2b949758841cf253d59da2e8fb03ad27618b33868bf0ad18e10b300a` |
| dependency closure           | keeps consecutive small batches closed under dependency and predicted conflicts                                                                                                                                                 | `e222882a2b949758841cf253d59da2e8fb03ad27618b33868bf0ad18e10b300a` |
| flaky rerun                  | backs out one culprit and lands only the last cumulative combination checked; catches interacting candidates that pass alone and holds failed prerequisites; reruns only failing checks and marks the exact passing batch flaky | `e222882a2b949758841cf253d59da2e8fb03ad27618b33868bf0ad18e10b300a` |
| cumulative interaction       | backs out one culprit and lands only the last cumulative combination checked; catches interacting candidates that pass alone and holds failed prerequisites                                                                     | `e222882a2b949758841cf253d59da2e8fb03ad27618b33868bf0ad18e10b300a` |
| structured marker refusal    | keeps default rework and structured conflicts out of the admitted tree                                                                                                                                                          | `e222882a2b949758841cf253d59da2e8fb03ad27618b33868bf0ad18e10b300a` |
| default rework               | keeps default rework and structured conflicts out of the admitted tree                                                                                                                                                          | `e222882a2b949758841cf253d59da2e8fb03ad27618b33868bf0ad18e10b300a` |
| strict shared dispatch       | routes structured files even on unchanged sides, without text fallback                                                                                                                                                          | `0125babeecf19d642c911cc6d3486223f4967a71cd212bef7fbdc5a36bc7e88d` |
| binary and deletion conflict | handles binary, added, deleted, symlink and executable files explicitly                                                                                                                                                         | `0125babeecf19d642c911cc6d3486223f4967a71cd212bef7fbdc5a36bc7e88d` |

## Whole snapshots and staging

`StagingCopy` captures HEAD, tracked edits/deletions and nonignored untracked
files through a private index, hashing raw bytes without attributes or
filters. Ignored untracked installs remain outside the Git snapshot, as in
the lead's rig snapshot; submodule directories and unsafe paths refuse
explicitly. The temporary index is removed after use; the user's index and
HEAD are unchanged. The shared clone has no remote and disables conversion
before checkout. A local staging result can be fetched into an
`agents/landing/<id>` ref under Git's ref lock.

`checkIdentity` includes resolved command names, commands, timeouts, platform,
setup and cache key. `formatStagedTables` delegates the actual formatter and
both-intent validation to lane C/M68, then callers capture the final blobs.
The Git process is injected for lane K's lifetime launcher; its environment
is an explicit allowlist without inherited Git variables or credentials.

The whole `teamStagingCopy.test.ts` file passed (6 tests), using real local
repositories and real Git. These additional red drills passed their failure
checks and restored the source byte-exact:

| Mutation                    | Named failing test(s)                                                                                                                                                                  | Restored source SHA-256                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| temporary index             | snapshots all visible files through a temporary index, preserving the real index and raw blobs; imports a staging result into a landing ref without changing the working tree or index | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| untracked dependencies      | snapshots all visible files through a temporary index, preserving the real index and raw blobs; validates both intents after formatting and captures the formatter output              | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| check environment identity  | binds resolved commands, platform, setup and cache key into the check identity                                                                                                         | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| formatter verification      | validates both intents after formatting and captures the formatter output                                                                                                              | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| text conflicts              | uses real git merge-file for both clean text and conflict markers                                                                                                                      | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| staged object transfer      | imports a staging result into a landing ref without changing the working tree or index                                                                                                 | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| raw blob conversion         | snapshots all visible files through a temporary index, preserving the real index and raw blobs                                                                                         | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| child environment allowlist | passes only the child allowlist and private index, never inherited Git configuration                                                                                                   | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |

## Landing, recovery and hygiene

`TeamLanding` admits one landing per canonical working tree in its window.
It asks through the host's ordinary landing policy, with a separate mandatory
consent for Land without checks. A known lock, fresh same-tree foreign-window
hint or Git operation redirects to a local landing ref. An open landing journal blocks the next landing until Recover completes,
even after manual lock removal. Otherwise it takes
an exclusively created, synced owner lock, compares the whole fresh snapshot,
HEAD and resolved check identity, and invalidates stale admissions through a
required enqueue callback. Apply requires a fresh rebuild/merge/check callback.

The complete journal is durable before any file. Writes use immutable tested
Git blobs and the existing atomic writer; canonical/target admission and raw
bytes/mode are checked again immediately before each rename or deletion.
Binary files, additions, deletions and executable modes are covered. Symlink
replacement explicitly refuses under the safe take contract. The final
whole-tree read-back compares untouched dependencies, every final blob and
HEAD. A partial write or failed journal close retains the lock and open
intent. Recover and Undo use the same in-process exclusion, owner admission,
known-holder check and newly owned lock. Recover rolls back only bytes still
matching the journal's after-state, leaving later edits as named conflicts.
A file shared by tasks requires Undo batch.

Lock release requires the identity and contents of the exact file this call
created. Foreign, replaced, edited-in-place, symlink and oversized locks are
never removed. Linked worktrees use their own Git directory. The base does
not declare `TEAM_LANDING_LOCK_WAIT_MS`; the default uses its existing
30-second `TEAM_RETIRE_WAIT_MS`, with an injected clock for the full-bound
fixture. No timeout or gate was relaxed.

Cleanup uses checked `lstat` recursion and `path.toNamespacedPath`, unlinks
links/junctions, and checks parents and file identity before removal. It
retains unmerged and foreign-owned copies, asks explicitly for quarantine,
and removes only extension refs with terminal outcomes through a conditional
ref adapter. The checkout guard refuses canonical user-root aliases and
subdirectories for non-in-place workers/commands.

The real-repository batch fixtures cover a green batch of four, one culprit,
an interaction that
passes individually, and a failed prerequisite. They merge independent
staging copies, check cumulative actual files, then land exactly the last
green tree hash with at most six check runs.

Real child processes pause before the first file and after two of four files.
A second owner cannot take their lock. SIGKILL leaves the durable journal and
lock; recovery refuses until the simulated user's terminal removal, then
restores matching files and preserves a seeded user edit. A resumed child
releases only its own lock; Retry sees the new tree and voids the old admission.
The resume fixture initially left its stdin pipe open after work completed;
closing stdin corrected that fixture, and the whole three-file suite passed
again in 8.50 seconds without manual interruption.

These guard mutations ran whole focused files, produced the named failures,
and restored byte-exact with the following SHA-256 receipts. Removing only
the outer symlink-read guard initially kept the test green because the
handle-identity guard still refused it. The recorded decisive mutation
bypassed both guards; no guard was weakened in the final source.

| Mutation                               | Named failing test(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Restored source SHA-256                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| in-process exclusion                   | excludes overlapping in-process landings and makes real git add meet the lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| whole admission snapshot               | invalidates untouched dependency changes and changed check identities before writing                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| resolved check admission               | invalidates untouched dependency changes and changed check identities before writing                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| known holder branch                    | defers a known holder to a landing branch and Apply rebuilds from a fresh snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| journal before first file              | lands the tested blobs uncommitted, journals first and keeps the user index untouched; keeps a partial landing journal and lock, then Recover restores only matching bytes                                                                                                                                                                                                                                                                                                                                                                                 | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| retain partial landing lock            | keeps a partial landing journal and lock, then Recover restores only matching bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| final blobs and untouched dependencies | reports the visible change from a lock-ignoring writer: checkout-index; reports the visible change from a lock-ignoring writer: clean                                                                                                                                                                                                                                                                                                                                                                                                                      | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| final HEAD read-back                   | reports the visible change from a lock-ignoring writer: HEAD; reports the visible change from a lock-ignoring writer: linked-worktree                                                                                                                                                                                                                                                                                                                                                                                                                      | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| explicit untested consent              | asks separately for Land without checks in every mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| recovery owner authorization           | requires owner authorization for recovery and Undo batch for shared files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `61566bd8c4c15045e9d1fed0f8490bd5159a51e1a165bf7699eb3cd73a696a4c` |
| partial recovery rollback              | keeps a partial landing journal and lock, then Recover restores only matching bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `4dfa44e78bcea440241cf39a0b046bc13208c6253a6cc4fcdafdf7bfbe64b496` |
| shared file Undo batch                 | requires owner authorization for recovery and Undo batch for shared files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `4dfa44e78bcea440241cf39a0b046bc13208c6253a6cc4fcdafdf7bfbe64b496` |
| last byte and target check             | rechecks bytes and target admission after the replacement file has been staged                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `4dfa44e78bcea440241cf39a0b046bc13208c6253a6cc4fcdafdf7bfbe64b496` |
| tested immutable blob bytes            | lands the tested blobs uncommitted, journals first and keeps the user index untouched; lands and undoes raw binary additions and deletions with executable modes; excludes overlapping in-process landings and makes real git add meet the lock; defers a known holder to a landing branch and Apply rebuilds from a fresh snapshot; asks separately for Land without checks in every mode; keeps a partial landing journal and lock, then Recover restores only matching bytes; requires owner authorization for recovery and Undo batch for shared files | `4dfa44e78bcea440241cf39a0b046bc13208c6253a6cc4fcdafdf7bfbe64b496` |
| validated journal file paths           | rejects journal path escapes and revalidates targets after staging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `4dfa44e78bcea440241cf39a0b046bc13208c6253a6cc4fcdafdf7bfbe64b496` |
| exclusive create                       | waits the full bound on a foreign lock, never removes it, and retries only after user removal; keeps the journal and lock when a real lander is killed after 0 files; keeps the journal and lock when a real lander is killed after 2 files                                                                                                                                                                                                                                                                                                                | `12ac239641e6d6b3f73870d28eb5aac6906c984565cfacd58ca8c4b7727ad8f0` |
| opaque symlink lock read               | does not follow a foreign symlink lock when reading its owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `12ac239641e6d6b3f73870d28eb5aac6906c984565cfacd58ca8c4b7727ad8f0` |
| same-inode lock contents guard         | does not release a replaced lock, even when the original owner is done; does not release a lock whose contents changed in place                                                                                                                                                                                                                                                                                                                                                                                                                            | `12ac239641e6d6b3f73870d28eb5aac6906c984565cfacd58ca8c4b7727ad8f0` |
| fresh duplicate window hint            | treats only another window fresh on this same working tree as a known holder                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `12ac239641e6d6b3f73870d28eb5aac6906c984565cfacd58ca8c4b7727ad8f0` |
| foreign owner isolation                | sweeps terminal and owned orphan copies/refs, preserves unmerged and foreign-owned work                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| quarantine user action                 | keeps quarantine until explicit Clean up, warning even when the old owner may be live                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| unmerged retention                     | sweeps terminal and owned orphan copies/refs, preserves unmerged and foreign-owned work                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| ref namespace guard                    | sweeps terminal and owned orphan copies/refs, preserves unmerged and foreign-owned work                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| canonical checkout guard               | guards worker starts and command directories against the canonical user checkout                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `d128bc813b484780a253fe282242d9404be7c12cb1af4588fcd55fe5bfb150ab` |
| link traversal canary                  | unlinks links/junctions and removes deep copies without touching the outside canary                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| journal id before store access         | rejects journal path escapes and revalidates targets after staging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `37a76b695d0f7e11f6357f248f1ad5cabc60ef462b9c70dc5ba59bc13fc942a5` |
| storage containment                    | refuses removal outside storage, storage itself and paths through an ancestor link                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| ancestor link confinement              | refuses removal outside storage, storage itself and paths through an ancestor link                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |
| queue explanation priority             | orders dependencies before finish, inherits priority and applies every tie breaker                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d` |

Additional boundary probes exercise admission limits, snapshot path/type
refusals, a concurrent HEAD move, durable-record parsing and recovery gating:

| Mutation                         | Named failing test(s)                                                                 | Restored source SHA-256                                            |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| open journal before next landing | keeps a partial landing journal and lock, then Recover restores only matching bytes   | `e65966eac6eefbc0b3949dd6cf9652f75302d798c3c9d5f92b86597620c5648f` |
| priority propagation             | orders dependencies before finish, inherits priority and applies every tie breaker    | `3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d` |
| batch size cap                   | keeps consecutive small batches closed under dependency and predicted conflicts       | `3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d` |
| admission size cap               | refuses oversized admissions before any merge or check                                | `3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d` |
| duplicate queue ids              | orders dependencies before finish, inherits priority and applies every tie breaker    | `3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d` |
| snapshot parent confinement      | refuses escaped tracked parents and submodule directories, cleaning its private index | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| snapshot regular file admission  | refuses escaped tracked parents and submodule directories, cleaning its private index | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| HEAD capture identity            | refuses a HEAD change during capture and still removes its private index              | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| canonical landing target         | rejects journal path escapes and revalidates targets after staging                    | `37a76b695d0f7e11f6357f248f1ad5cabc60ef462b9c70dc5ba59bc13fc942a5` |
| journal duplicate paths          | rejects journal path escapes and revalidates targets after staging                    | `37a76b695d0f7e11f6357f248f1ad5cabc60ef462b9c70dc5ba59bc13fc942a5` |
| journal open intent              | rejects journal path escapes and revalidates targets after staging                    | `37a76b695d0f7e11f6357f248f1ad5cabc60ef462b9c70dc5ba59bc13fc942a5` |
| stored journal schema            | rejects journal path escapes and revalidates targets after staging                    | `37a76b695d0f7e11f6357f248f1ad5cabc60ef462b9c70dc5ba59bc13fc942a5` |

## Required integration seams and remaining certification

This base has contracts but no team lifecycle implementation. Production
seams are explicit injected interfaces; there is no fake production fallback.
The lane's implementation is complete against those interfaces. Integration
belongs to the named parallel lanes:

- C supplies strict structured mergers to `mergeFile`, calls
  `formatStagedTables`, and captures/checks the formatted final blobs.
- K supplies the real lifetime-managed Git process, fresh canonical-tree
  hints, the open-landing admission gate and the atomic, flushed window journal. Its journal adapter must
  retain before/after blobs for the Recover/Undo lifetime; these references
  must remain resolvable even after Git object cleanup.
- I supplies target/protected/ref/unsaved-buffer checks on each mutation,
  landing/recovery authorization, and calls `assertTeamCheckout` at worker
  start and before every command. The invalidation callback enqueues a new
  merge/check, respecting Pause queue; Apply's rebuild callback cannot reuse
  an old admission.
- O supplies independent trial copies and the resolved check adapter, with
  reruns restricted to the failing check ids. Its environment/setup/cache
  identity must match the identity admitted for landing.
- V/X2 wire outcomes, queue reason material, per-use prompts and recovery
  actions into Traffic; X2 owns the lazy team bundle and public docs.

The read-back detects visible persistent changes from lock-ignoring writers;
it is not prevention. These fixtures place those writes after the conditional
replacement and before the read-back. They do not prove detection of a write
that is overwritten in the narrow final-check/rename gap. The underlying
path-based filesystem operations also retain M77's final-check race limit.
Ignored untracked installs are excluded; submodules refuse. Executable-mode
assertions run on POSIX; Windows needs its own receipt. Kubuntu alone is
certified here: Windows junction/long-path and macOS crash receipts, the
integrated UI/static lock-removal review, full quality/coverage, golden
single-model checks and live/throughput certification remain with the lead.
No owner default or paid policy is changed by this lane.

X2's release-note material: team merges gain dependency-ordered small batches,
one flaky rerun and cumulative fallback; admissions bind raw whole snapshots,
resolved checks and final blobs; landing uses an owned Git lock and a durable
recovery journal; deferred landing refs, conditional Undo, safe copy cleanup
and the canonical checkout guard preserve user work. No new command, setting,
script, dependency, localization key or escape hatch was introduced here.

## Final rig verification

All results below are on Kubuntu, with one heavy command at a time. Tests
ran only the six owned files, at most three files and three workers per run,
with `--testTimeout=120000`; no filtering, skips or changed thresholds.
The final runs passed 33 tests in 5.51 seconds and 17 in 5.10 seconds:

| File                               | Tests passed |
| ---------------------------------- | ------------ |
| `teamMergeQueue.test.ts`           | 9            |
| `teamStagingCopy.test.ts`          | 8            |
| `teamLanding.test.ts`              | 16           |
| `teamGitIndexLock.test.ts`         | 8            |
| `teamCleanup.test.ts`              | 5            |
| `teamMergeBatchRepository.test.ts` | 4            |
| Total                              | 50           |

All **57 red drills** produced named failures and byte-exact source restoration.
The production bundle checks passed: extension **590.7/600 KiB**, Model API
**430.2/475 KiB**, checkpoint store **135.7/225 KiB**. Every other size, split,
host-globals and notices check in `npm run build` also passed. This base does
not wire the team module into a production entry; these numbers certify its
existing shipped bundles, not X2's future integrated team bundle.

`npm run typecheck` passed all five projects. Focused ESLint and Prettier
passed. `npm run deadcode` passed (with the existing vendor-ignore advisory).
`npx jscpd` passed with zero clones after moving the repeated outside-link
setup into the existing test fixture helper. `npm run check:l10n` reported
14 tables, 120 manifest strings, 427 source files and zero problems.

**Open gate:** `npm run check:host-api` exited 1 solely because the new
Node imports change the generated counts below. Lane X2 explicitly owns
`docs/ide-compatibility/host-api.md`; it was not edited. X2 must regenerate and
review it during integration. VS Code API usage, files importing VS Code,
Node built-in kinds and theme-variable counts remain 271, 18, 23 and 59.

| Node import            | Recorded | Source now |
| ---------------------- | -------- | ---------- |
| `node:buffer`          | 27       | 28         |
| `node:crypto`          | 32       | 33         |
| `node:fs/promises`     | 34       | 38         |
| `node:path`            | 65       | 70         |
| `node:timers/promises` | 3        | 5          |

The lead runs full `npm run quality`; the rig brief explicitly forbids it
in lanes. Local commits use hooks, including gitleaks, with no bypass.
No push, merge, rebase, live call or paid call was made. README, CHANGELOG,
PLAN and the build/manifest wiring remain with X2 under the ownership table.

Final implementation fingerprints (SHA-256):

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/core/team/mergeQueue.ts`     | `3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d` |
| `src/core/team/mergeRoutine.ts`   | `0125babeecf19d642c911cc6d3486223f4967a71cd212bef7fbdc5a36bc7e88d` |
| `src/core/team/teamMerge.ts`      | `e65966eac6eefbc0b3949dd6cf9652f75302d798c3c9d5f92b86597620c5648f` |
| `src/core/team/teamWorkspaces.ts` | `d128bc813b484780a253fe282242d9404be7c12cb1af4588fcd55fe5bfb150ab` |
| `src/host/team/stagingCopy.ts`    | `56a6b961885f81acb095649559adeb650e6b4f5d4d2a819af54f7a8302d8866c` |
| `src/host/team/landingJournal.ts` | `37a76b695d0f7e11f6357f248f1ad5cabc60ef462b9c70dc5ba59bc13fc942a5` |
| `src/host/team/gitIndexLock.ts`   | `12ac239641e6d6b3f73870d28eb5aac6906c984565cfacd58ca8c4b7727ad8f0` |
| `src/host/team/teamCleanup.ts`    | `d707cb8822d991730e1ea2263e0d9dff66113b4602cf469a3411059d0bd441e0` |

## RVM96CSQ findings 1 and 2 (2026-10-05, Kubuntu)

Finding 1 fixed: refresh all known operation markers, fresh hints and locks
after acquisition, before each landing file, and inside the final conditional
rename/removal guard for landing, Recover and Undo. The acquired lease may be
ignored only after its path, native file identity and exact owner bytes are
verified. Each acquisition adds a fresh lease nonce: owner ids alone do not
identify an incarnation, and POSIX can immediately reuse a removed inode.
Lost/changed/foreign locks remain holders and are never removed by release.

`TeamLandingDeps` adapters must forward the held lease to the holder reader
and forward the required `canWrite` callback through replace/recover/undo to
`LandingFileAccess.replace`. The callback is required, with no permissive
default. X2 owns runtime wiring, as before; these suites exercise the real
repository adapters and crash child.

Finding 2 fixed: snapshots and landing/recovery reads use the same Git modes
from HEAD, the index (taking precedence), and Git's raw working-tree mode diff.
A tracked executable is `100755` on every platform even when its filesystem
execute bits are absent and `core.filemode=false`. On POSIX with Git filemode
tracking enabled, filesystem bits cross-check Git's mode and a capture race
is refused. Untracked files have no retained Git mode; their first index entry
uses POSIX bits when supported, otherwise `100644`. User index bytes stay
untouched. The regressions use real Git fixtures; no native Windows receipt
or service/model wire capture is claimed, and model attempts/cost are zero.

Before fixes: four post-acquisition operation regressions plus the pre-file
regression failed (`landed` instead of `branched`/`changed`), while all 16
existing landing tests passed. The permission-blind executable snapshot and
staged-mode regressions failed (`100644` instead of `100755`); the landing
read regression failed with the same wrong mode. Added coverage includes
Recover/Undo acquisition and final guards, deletion, exact owned locks, fresh
hints, unique acquisition bytes and the POSIX mode capture cross-check.

Red drills (each exit 1; each file restored byte-exact before the next run):

| Broken guard                   | Named failing regression                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 post-acquisition refresh    | defers an operation appearing during lock acquisition: rebase-merge; defers an operation appearing during lock acquisition: rebase-apply; defers an operation appearing during lock acquisition: MERGE_HEAD; defers an operation appearing during lock acquisition: CHERRY_PICK_HEAD; refuses recover when an operation arrives during lock acquisition; refuses undo when an operation arrives during lock acquisition |
| Q1 pre-file refresh            | stops landing writes when an operation appears after the first file                                                                                                                                                                                                                                                                                                                                                     |
| Q1 final rename refresh        | rechecks holders at the final staged-file guard for land; rechecks holders at the final staged-file guard for recover; rechecks holders at the final staged-file guard for undo                                                                                                                                                                                                                                         |
| Q1 final deletion refresh      | checks holders immediately before deleting a matching file                                                                                                                                                                                                                                                                                                                                                              |
| Q1 exact owned-lock validation | ignores only the exact owned lock while still observing operations and fresh hints                                                                                                                                                                                                                                                                                                                                      |
| Q1 unique lease incarnation    | gives each acquisition distinct owner bytes even for the same landing and window; ignores only the exact owned lock while still observing operations and fresh hints                                                                                                                                                                                                                                                    |
| Q2 retained Git mode           | lands and undoes an indexed executable on a permission-blind checkout; preserves Git executable modes on a permission-blind checkout and staging clone; uses staged mode changes ahead of the HEAD mode on a permission-blind checkout                                                                                                                                                                                  |
| Q2 POSIX mode cross-check      | cross-checks POSIX filesystem mode after Git mode capture                                                                                                                                                                                                                                                                                                                                                               |

Restored source fingerprints (SHA-256):

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/core/team/teamMerge.ts`      | `1cfc77914fa6ed25aa45254b4a16bbfb5a05a767d93c1f05a7394e95ed6cbd30` |
| `src/host/team/landingJournal.ts` | `da5dc73a96ed4ebdb0e5986344b6dc3013c5666af439072d0bf0dc59a986a48d` |
| `src/host/team/gitIndexLock.ts`   | `3b31b7a7302e530756bef8dc75ae92985fe825d41172964f2029de748fbdef64` |
| `src/host/team/stagingCopy.ts`    | `af85adc1d39a6d1398aaa61161218a169730f9886bbcdde006349b3baa07e3bf` |

The duplication gate initially found three clones. Reused the executable
checkout setup in the existing repository fixture, factored repeated owner
input in the lock test, and reordered the journal recovery declarations.
`npx jscpd` then passed with zero clones. Repeated both final journal guard
drills on this final source; each again produced the named failures and
restored both bytes and the SHA-256 above.

## FIXM96CSQ final verification (2026-10-05, Kubuntu)

All four RVM96CSQ P2 findings are fixed in the assigned lane logic; none is
left as a residual. Merged `m96c/q` (`892f15bb`) first, with `--no-ff`, as
requested. All work is local, with hooks enabled and explicit staged paths.
No push, main merge, rebase, dependency addition, credential access, live call
or paid call. Runtime wiring, public docs and full milestone certification
still belong to X2/the lead under the original lane ownership.

Owned Vitest suites (direct runs, at most three files per run,
`--maxWorkers=3 --testTimeout=120000`):

| Files                                     | Result    |
| ----------------------------------------- | --------- |
| Board, Pick, Review                       | 42 passed |
| Retire, Stalls, Pool                      | 29 passed |
| Landing, StagingCopy, GitIndexLock        | 49 passed |
| MergeQueue, MergeBatchRepository, Cleanup | 18 passed |

**138 tests passed across 12 files** (S: 71, Q: 67). The 17 distinct guard
drills above/in the companion lane record all produced named failures and
byte-exact restoration, with SHA-256 receipts. Both final journal guards were
repeated after the declaration-order duplication fix.

`npm run typecheck` passed all five projects. Focused ESLint and Prettier
passed on changed files. `npm run deadcode` passed (the existing vendor-ignore
advisory remains); `npx jscpd` passed with zero clones; `npm run check:l10n`
passed with 14 tables, 120 manifest strings, 435 source files and zero problems.
`git diff --check` passed. No gate threshold, ignore, rule or timeout was changed.

`npm run build` passed all size, split, host-globals and notices checks. Main
sizes: extension **590.7/600 KiB**, Model API **430.2/475**, checkpoint store
**135.7/225**, webview JS **866.2/900**, shared English **110.5/125**, ACP
**801.0/850**. All 17 production metafiles have zero team source inputs; these
are receipts for the currently shipped graph, not the future integrated team
bundle.

**Open integration gate:** `npm run check:host-api` exits 1 only because the
generated import counts in `docs/ide-compatibility/host-api.md` are stale.
That file is X2-owned and outside this fix lane; X2 must regenerate and review
it. The remaining inventory is unchanged: 271 VS Code APIs, 18 files importing
VS Code, 23 Node built-in kinds and 59 theme variables. Current counts:

| Node import            | Recorded | Source now |
| ---------------------- | -------- | ---------- |
| `node:buffer`          | 27       | 28         |
| `node:crypto`          | 32       | 34         |
| `node:fs/promises`     | 34       | 38         |
| `node:path`            | 65       | 70         |
| `node:timers/promises` | 3        | 5          |

Full `npm run quality` was not run: the shared rig brief explicitly forbids
full-suite lane runs and assigns the complete gate to the lead. Native Windows
and macOS receipts remain with integration; permission-blind mode behavior
here was exercised on Kubuntu with real Git and `core.filemode=false`.
