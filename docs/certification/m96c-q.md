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
