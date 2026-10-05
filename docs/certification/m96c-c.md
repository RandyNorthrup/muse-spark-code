# M96c lane C — Collisions

Status: implementation checkpoint, 2026-10-05. Lane verification is in
progress; this is not whole-milestone certification.

The supplied `M96CC.md` filename was absent. `M96C-C.md` names this exact
worktree (`mx-m96cc`), branch (`m96c/c`) and lane. Its lane-specific rules
override common.md's older merge/full-gate instructions: no merge, rebase,
push or full quality run in this lane. Base is `dfbedc5c`, with plan of
record `e23ec61c` (D75, M96c, round 4); research §8 was read.

## Delivered logic

- `src/core/team/writeSets.ts`: rooted, bounded glob expansion over the
  caller's base listing and literal future files; role clipping; conservative
  fixed-prefix overlap for future glob files; window-local attempt leases;
  inherited families; retirement release; stale-attempt refusal; quarantined
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
- `src/core/team/merge/jsonTable.ts`: strict grammar plus a raw-order second
  pass, escaped-key duplicate refusal at every depth, nested key merges,
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

Pending at this implementation checkpoint. The final record will list the
named failed tests, mutation identities, rig results, before/restored
SHA-256 fingerprints and restored-green verification.
