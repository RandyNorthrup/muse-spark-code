# M96c lane C — Collisions

Status: implementation and core guard proof, 2026-10-05. One real-repository
fixture remains blocked on its runtime gate; this is not a green lane or
whole-milestone certification.

The supplied `M96CC.md` filename was absent. `M96C-C.md` names this exact
worktree (`mx-m96cc`), branch (`m96c/c`) and lane. Its lane-specific rules
override common.md's older merge/full-gate instructions: no merge, rebase,
push or full quality run in this lane. Base is `dfbedc5c`, with plan of
record `e23ec61c` (D75, M96c, round 4); research §8 was read.

## Delivered logic

- `src/core/team/writeSets.ts`: rooted, bounded glob expansion over the
  caller's base listing and literal future files; role clipping; conservative
  fixed-prefix overlap for future glob files; window-local attempt leases;
  inherited families, with an explicit pipeline lineage after retirement; retirement release; stale-attempt refusal; quarantined
  handoff transfer; free growth and occupied-growth prediction; whole-branch
  and in-place exclusive writers; fresh-hint collision questions and answer
  expiry. A growth conflict reports the earlier holder; the worker keeps
  writing in its own copy.
- `src/core/team/waitFor.ts`: one wait graph for lease, dependency, child and
  slot waits. A new cycle is named and refused before changing the graph.
- `src/core/team/conflictPredict.ts`: submission warnings, explicit-start
  polling at `TEAM_DIFF_POLL_MS`, immediate polling for engine writes, task
  pairs and integration changes through the injected landing routine, one
  event per newly appearing collision, overlapping-poll coalescing and late
  result suppression after stop.
- `src/core/team/sharedFiles.ts` and the `teamConfig.ts` shared-files shape:
  built-in changelog/JSON rules, user entries, bounded repository entries,
  explicit shared-text declaration checks, and root-anchored glob matching.
  Windows matching folds case. Existing glob limits are reused.
- `src/core/team/merge/jsonTable.ts`: a strict cursor parser preserving raw
  order, escaped-key duplicate refusal at every depth, nested key merges,
  atomic arrays, exact decimal-number comparison (including large integers
  and exponents), conflict/type/removal refusal, integration key order and
  branch-predecessor placement, BOM/EOL/indent/escaping preservation, and
  independent two-way intent/order/style validation after the formatter.
- `src/core/team/merge/changelog.ts`: release/section/normalized-bullet
  identity, the branch's Unreleased delta, authorized edits and removals,
  competing-edit refusal, immutable released material, a kept check and
  existing fragment-directory detection. Fragments remain for the project's
  release step.

No dependency, suppression, assertion cast or UI text was added. No wire
shape was introduced: these are extension-owned, internal contracts.

## Acceptance and tests

| Acceptance     | Owned evidence                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13             | `teamCollisions.test.ts`: serial leases, another free lane, retirement/rework, child/pipeline inheritance, stale calls, free/conflicting growth, clipping/future overlap, exclusive writers, transfer/quarantine and hint questions |
| 13 cycle       | `teamCollisions.test.ts`: an atomic four-kind wait-for cycle refusal                                                                                                                                                                |
| 14             | `teamConflictPredict.test.ts`: the injected landing routine, clean JSON/changelog merges, integration edits, deduplication, polling and stopped/failed reads                                                                        |
| 16             | `teamJsonTable.test.ts`: ten changes over thirty fixture paths, nested/flat keys, duplicate escapes/depth, type/array/delete conflicts, large numbers, order/style and corrupt formatter outputs                                    |
| 17             | `teamChangelog.test.ts`: ten additions, release after five, authorized edits/removals, moved multiline bullets, competing/released edits and fragments                                                                              |
| 16–17 real Git | `teamCollisionRepositories.test.ts`: ten real committed branches over thirty tables, serial integration commits, release after five, Prettier output and saved-byte SHA-256 equality                                                |

The thirty-table Git fixture uses this checkout's 14 translated-table paths
and 15 manifest-table paths, plus a fixture-only English JSON table. The
product's English table is `en.ts` and stays a plain-text Q merge.

## Verification checkpoint

All heavy work ran on Mac mini through the supplied `rig-run.sh`, slot
`m96cc`, with worktree snapshots and an untouched real index.

| Check                         | Result                                  | Snapshot   |
| ----------------------------- | --------------------------------------- | ---------- |
| Five owned vitest files       | 34/34 pass, exit 0                      | `e785c620` |
| All five typecheck projects   | exit 0                                  | `f212fe4f` |
| `npm run deadcode`            | exit 0                                  | `f212fe4f` |
| `npm run duplication` / jscpd | 0 clones, exit 0                        | `f212fe4f` |
| `npm run check:l10n`          | 14 tables, 0 problems, exit 0           | `f212fe4f` |
| `npm run check:host-api`      | 0 problems, exit 0                      | `f212fe4f` |
| `npm run build`               | size/split/globals/notices pass, exit 0 | `f212fe4f` |

Measured build sizes: extension 590.7/600 KiB, Model API 430.2/475 KiB,
checkpoint store 135.7/225 KiB, webview JavaScript 866.2/900 KiB. Lane C is
not wired into a product bundle until X2; these measurements certify the
current build, not the eventual team bundle.

Two initial fixture failures were corrected: one JSON fixture accidentally
removed an independently changed key; the real-Git helper trimmed blob
content and changed released changelog bytes. A mock's generic type was
also corrected after the unit-project typecheck caught widened result tags.

## Integration seams and remaining lead work

- S supplies only writing tasks, real base listings, role write paths and
  attempt identities to leases. Release follows proved retirement or the
  recorded user decision. Slot/resource admission and old-copy quarantine
  precede `transfer`; that method is not retirement proof. S consumes the
  wait graph for priority inheritance and blocked-cycle state.
- K supplies **fresh**, canonical repository hints to `FileHintQuestions`.
  This lane never uses hints as locks or process-liveness proof.
- Q injects its one merge routine into `ConflictPredictor`, resolving real
  ancestry and binary/added/deleted cases. Prediction does no writes and runs
  no formatter. The test adapter uses the actual C JSON/changelog routines.
- Q binds M68 `VerifyEditor.formatAfterEdit` to staging paths, passes it to
  `formatMergedJsonTable`, saves returned bytes before checks, and binds their
  final blob hashes to admission and landing. Actual staging/landing wiring
  and hash comparison are Q-owned. Q uses fragment detection to retain the
  project's convention.
- T2 composes `teamSharedFilesConfigShape` into M96's strict whole-config
  schema, enforces shared-text declarations before admitting those writes,
  and renders structured refusal data with the localized host text.
- X2 owns product wiring, README/CHANGELOG/PLAN updates and whole quality,
  integration, live, bundle and multi-platform certification. Those files
  were kept for their assigned owner.

The conservative future-prefix rule can delay globs with incompatible
suffixes; it does not widen role write permissions. No cross-window safety
claim is made. The current lane depends on the injected S/K/Q/T2 seams;
standalone tests do not certify the assembled scheduler.

## Red drills

All 48 distinct mutations fired a named assertion failure (exit 1): 47 on
Mac mini and Windows case folding on the Windows 11 rig. There were 59
successful executions, including re-running the write-set guards after the
pipeline-lineage correction. Every mutation used a full owned test file,
not a test-name filter. Every source was restored byte-exact in `finally`,
and before/restored SHA-256 equality was independently checked against the
current files.

The complete receipts, including every failed test name, mutation hash and
before/restored hash, are in [m96c-c-drills.json](m96c-c-drills.json). Raw rig
output and the disposable runner remain under `temp/m96cc-drills/` and
`temp/m96cc-drills.mjs`, respectively. Those temporary files are not product
artifacts. No model call ran and no spend was incurred.

| Guards                              | Mutations                                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict JSON grammar and diagnostics | grammar, colon, trailing comma, closing delimiter, string grammar, key type, JSON whitespace                                                                                              |
| JSON value identity and spelling    | exact decimal precision, decoded duplicates, duplicate keys, raw key and raw string spelling, conflict refusal                                                                            |
| JSON order and style                | key order, BOM, CRLF                                                                                                                                                                      |
| Both intents after formatting       | integration kept check, branch intent, formatter order, formatter BOM, formatter CRLF                                                                                                     |
| Changelog                           | released material, competing edits, kept check, authorized removals, release placement, structure, fragments                                                                              |
| Leases                              | overlap, child inheritance, retired pipeline lineage, clipping, future prefix, role growth, retirement, stale attempts, occupied growth, exclusive writers, path confinement, hint expiry |
| Wait graph                          | atomic cycle refusal                                                                                                                                                                      |
| Shared files                        | JSON/changelog no-lock policy, root anchoring, Windows case folding                                                                                                                       |
| Prediction                          | integration state, landing routine, one notification, late-stop suppression                                                                                                               |

## Current blocker and bounded stop

The real-Git fixture first passed at snapshot `e785c620` in 4.733 seconds.
Later runs crossed its unchanged 5,000 ms limit. Two performance fixes were
tried: memoizing identical Prettier inputs and then batching independent
file I/O. They did not close the runtime gate. The last full-file run,
snapshot `8038e158`, timed out at 5.031 seconds; the other 41 cases passed.
No timeout, assertion, gate threshold or test discovery rule was weakened.

common.md requires: "If the same test fails twice after two different fixes,
STOP that path". That path is now stopped: the fixture remains registered,
and has not been edited or re-run since its second failed performance fix.
It needs the lead's redesign/review. Subsequent runs verify the other owned
files, including the separate pipeline-lineage fix; they do not make the
real-repository obligation green.

Final core restored-green checks and final static/build receipts are recorded
below. The real-repository fixture is excluded from those core-only receipts
because its path was stopped under the explicit rule; it remains registered
and failed, with no skip or test-name filter added. The lead also owns S/K/Q/T2/X2 assembly and its full,
integration and live checks.

## Pipeline lineage correction

A delegated child still requires its parent's live attempt. A host-owned
pipeline step can pass `acquire(holder, set, overlap, parent, 'pipeline')`
after that registered parent retires. It shares the recorded family while
rejecting unknown or superseded parents. S must validate the parent/pipeline
relationship before choosing that internal mode; the model cannot choose it.
On reload, S rebinds pipeline ownership to current-window admissions rather
than treating another window's old lease as authority.

This has its own positive/negative test and the `lease-retired-pipeline`
red drill. The earlier active-parent-only implementation was insufficient
for a QA step after retirement.

## Final observed receipts

| Check                                              | Machine       | Result                                  | Snapshot   |
| -------------------------------------------------- | ------------- | --------------------------------------- | ---------- |
| Four core test files after lineage fix             | Mac mini      | 42/42 pass, exit 0                      | `3c862cf0` |
| Four core files, restored after Windows mutation   | Windows 11 VM | 42/42 pass, exit 0                      | `ebf80178` |
| All five typecheck projects                        | Mac mini      | exit 0                                  | `cbf9c545` |
| Dead code                                          | Mac mini      | exit 0                                  | `cbf9c545` |
| Duplication                                        | Mac mini      | 0 clones, exit 0                        | `cbf9c545` |
| Localization                                       | Mac mini      | 0 problems, exit 0                      | `cbf9c545` |
| Host API                                           | Mac mini      | 0 problems, exit 0                      | `cbf9c545` |
| Production build, size, split, globals and notices | Mac mini      | exit 0                                  | `cbf9c545` |
| Real-repository fixture                            | Mac mini      | stopped after repeated 5-second timeout | `8038e158` |

Final build measurements match the checkpoint above. Production source
hashes for the six mutated modules match every current drill receipt. The
schema-composition file is covered by core tests, typecheck and dead-code
checks. The full lane has 43 registered cases; its one real-repository case
is not certified by the 42 core cases.

The late syntax correction is at `merge/jsonTable.ts:34`: cursor-based
syntax failures retain the decoded key and line instead of guessing from
Node's version-dependent exception text. Raw escaped key/value spellings
are retained for untouched input. Post-formatter kept checks begin at
`merge/jsonTable.ts:312`. Retired pipeline inheritance is at
`writeSets.ts:152`, selected only by the host's validated pipeline context.

S/T2 also owns translating expanded internal path lists into its bounded
wire/paged views, while retaining `TEAM_WRITE_SET_MAX`; namespace paths by
workspace/repository consistently before expansion. These internal lists
are not a reason to widen a boundary cap.

Implementation checkpoint commit: `8a38f22f`. Final corrections and evidence
are in the follow-up commit. Both use hooks and the required co-author
trailer. The next action is lead review/redesign of the timed-out fixture,
then S/K/Q/T2/X2 wiring, root-document/PLAN reconciliation and the complete
four-machine quality/integration/live matrix. No publication or release
certification is asserted.

The final test-literal lint correction (`String.raw` for the invalid JSON
escape fixture) preserves the exact input bytes. The four core files passed
again on Mac mini at snapshot `05b7a17a`: 42/42, exit 0. Final changed-file
ESLint and Prettier checks passed locally; pre-commit hooks enforce both
again.
