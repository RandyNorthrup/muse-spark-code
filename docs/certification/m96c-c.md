# M96c lane C — Collisions

Status: FIXM96CC review repairs pass focused tests and guard drills on
2026-10-05, including the default-deadline real-Git fixture. Final gate
receipts follow below; whole-milestone assembly remains the lead's work.
The original implementation and timeout receipts are retained as history.

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

## Original blocker and bounded stop (superseded by FIXM96CC)

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

## Original lane receipts (historical)

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

## FIXM96CC review repairs — core checkpoint (2026-10-05)

RVM96CC reported seven P2 findings and one P3, with no P1. The owner's
`FIXM96CC.rig.md` authorizes repairs and supersedes the historical stopped
fixture path above. This checkout is already on macmini, branch `m96c/cfix`,
base `48f617f0`. No merge, rebase, push, network, credential access or model
call is authorized. The full-quality gate remains the lead's work, as the
brief requires and PLAN §7 records.

All seven P2 regressions failed against the original source before repairs:
three complete files, 12 failed / 15 passed, exit 1. The repaired sources
pass those files: 27/27, exit 0. The original hint-expiry assertion was
corrected to retain an answer when querying a different repository; expiry
now means actual hint disappearance in the corresponding scope.

| Finding                             | Resolution                                                                                                                                                                                                                                                                | Named regression                                                                                                                                                                | Red drill IDs                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1 (P2) repository merge downgrade   | Effective order preserves explicit user choices, strict built-ins, and strict repository additions over repository text rules, including overlapping patterns. Existing identical-pattern validation stays.                                                               | `preserves strict built-ins and user authority across overlapping repository rules`                                                                                             | `F1-trusted-precedence`, `F1-repository-no-downgrade`                                                            |
| 2 (P2) path aliases                 | One confined lexical normalizer resolves separators and dot segments before matching declarations, base files, role permissions, growth and hints. Stored lease paths fold on insensitive volumes; the host can select volume case policy explicitly.                     | `canonicalizes path aliases before leasing, role clipping, growth and hint matching`; `folds case consistently on insensitive filesystems and preserves sensitive distinctions` | `F2-lexical-identity`, `F2-case-identity`, `F2-root-confinement`, `F2-drive-root`, `F2-empty-path`               |
| 3 (P2) narrower JSON globs          | Bounded fixed prefix/suffix containment, character classes and brace alternatives prove narrower merge-kind globs exempt. Wider globs that may create ordinary files and overlapping higher-priority text overrides keep conservative leases.                             | `exempts narrower merge-kind globs while leasing globs that can create ordinary files`                                                                                          | `F3-contained-globs`, `F3-text-override`, `F3-brace-containment`, `F3-compiler-bounds`, `F3-mixed-class-braces`  |
| 4 (P2) hint answers                 | Cache identity includes own window, other window, repository and each canonical path. Expiry uses the complete fresh hint snapshot for the queried scope, independent of the current task. A new path asks; a dropped path expires; surviving paths retain Continue/Wait. | `retains Continue and Wait for live hints across unrelated tasks, repositories and windows`                                                                                     | `F4-hint-snapshot-expiry`, `F4-answer-scope`                                                                     |
| 5 (P2) asymmetric prediction        | Task-pair events and deduplication include `otherAttempt`. Integration events have no other task attempt; submission warnings identify both initial attempts.                                                                                                             | `identifies both attempts and notifies symmetrically when either task is reassigned`                                                                                            | `F5-both-attempt-identities`, `F5-both-attempt-events`                                                           |
| 6 (P2) restarted polling            | Stop detaches old pending work; only the owning generation clears pending state. A stale read returns before merging, so new polls work even when an old read never settles.                                                                                              | `starts fresh polling after restart and prevents an old finalizer from clearing new work`; `publishes restarted results while an old read remains unresolved`                   | `F6-generation-pending`, `F6-finalizer-ownership`, `F6-late-snapshot`                                            |
| 7 (P2) unsupported release headings | Unsupported ATX/setext release structure refuses all merge inputs with `structure` and the offending heading. Kept checks refuse unsupported structure too. Indented headings cannot be swallowed by multiline bullets; fenced examples are preserved.                    | `refuses unsupported release headings on every input and in the kept check`                                                                                                     | `F7-unsupported-heading`, `F7-kept-structure`, `F7-indented-heading`, `F7-heading-levels`, `F7-release-category` |

The twenty-four distinct successful core drills ran complete owned files, each exited 1 on
its named regression, and restored SHA-256-identical source bytes in
`finally`. Machine-readable receipts are in
[m96c-c-fix-drills.json](m96c-c-fix-drills.json); raw reports and the runner
are in ignored `temp/`. One initially non-firing text-override mutation is
retained in that record: an existing base file masked the future-pattern
bug. Adding the empty-base regression made the same mutation fire. No gate
was weakened. Earlier receipts above are historical source hashes, not the
hashes of these repaired modules.

The P3 fixture repair and final complete lane checks are recorded in the
following checkpoint. There are no new dependencies, suppressions, unchecked
casts, wire shapes or user-facing strings. README/CHANGELOG product assembly
remains with X2 under the lane ownership table; this lane updates only its
required certification and PLAN records.

## FIXM96CC P3 fixture repair — implementation checkpoint

| Finding                                  | Resolution                                                                                                                                                                                                                                                                                                      | Regression                                                                                                                                                                                                                                                               | Red drill                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 (P3) repeated Git porcelain / deadline | One template is built per file using batched `hash-object`, isolated `update-index`/`write-tree` indices and `commit-tree`, then copied per case. Independent branch/tree construction is parallel; cumulative integration commits remain ordered. Exact blobs for every path are read with `cat-file --batch`. | The existing real-Git case retains its complete assertions, adds per-file identity, value/order/committed-byte checks, and enforces fewer than 80 Git launches including setup, with no porcelain commits. Original implementation fails this regression at 96 launches. | `F8-redundant-git`: add ten real redundant `rev-parse` calls; the named case fails its launch-budget assertion, exit 1; restore SHA-256-exact. |

The real-Git test still covers ten actual branch commits, thirty tables,
ten cumulative merge commits, a release after the fifth integration, all
three hundred table merges/formatter steps over ordered integrations, each saved-byte SHA-256,
all final values and raw integer/predecessor key order, every final
committed blob and clean status. Per-path fixture values ensure accidentally
reusing the first table's blob is observable. No assertion or deadline was
removed or raised. Setup plus each case uses 72 Git launches; the previous
fixture used 96, including repeated checkout/add/commit processes.

The failing old implementation took 7.406 seconds with the rig's diagnostic
120-second override. The plumbing implementation's first test body took
2.020 seconds. Three default-deadline runs passed at 1.870, 1.553 and 1.972
seconds; no `--testTimeout` flag or per-test timeout was supplied. Those
three runs preceded the fixture's final lint corrections. The final-source
JSON/real-Git file pair also passes the default deadline in 2.093 seconds, 25/25, exit 0
(`temp/final-json-repository-default.json`). The unchanged five-second
case deadline is now proven directly on macmini, superseding the stopped
fixture record above.

Together with the 27 core cases, the complete owned lane passes 52/52
registered cases across five files. The twenty-five distinct guard drills
(twenty-four core guards plus the fixture) have current successful receipts
whose before/restored hashes independently match the final source files.
All eight review findings are fixed; none is left as a named review
residual. Final static/build checks are recorded in the next checkpoint.

## FIXM96CC final verification — macmini, 2026-10-05

Implementation checkpoint: `54c4d74be8763918e3437aa9c8ae0c3c4709afec`.
The follow-up contains the final gate corrections and these receipts.

| Check                 | Command / scope                                                                                                                                             | Result                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Core regressions      | `npx vitest run test/unit/teamCollisions.test.ts test/unit/teamConflictPredict.test.ts test/unit/teamChangelog.test.ts --maxWorkers=3 --testTimeout=120000` | 27/27 pass, exit 0                                                                                             |
| JSON and real Git     | `npx vitest run test/unit/teamJsonTable.test.ts test/unit/teamCollisionRepositories.test.ts --maxWorkers=3`                                                 | 25/25 pass, exit 0; default five-second case deadline; real-Git body 2.093 s                                   |
| Compiler projects     | `npm run typecheck`                                                                                                                                         | All five projects pass, exit 0                                                                                 |
| Changed-file ESLint   | `npx eslint --max-warnings=0` over four source and four test files                                                                                          | Exit 0, no suppression added                                                                                   |
| Changed-file Prettier | `npx prettier --check` over the eleven changed files                                                                                                        | Exit 0                                                                                                         |
| Dead code             | `npm run deadcode` (plain knip)                                                                                                                             | Exit 0                                                                                                         |
| Duplication           | `npx jscpd`                                                                                                                                                 | 842 files, 0 clones, exit 0                                                                                    |
| Localization          | `npm run check:l10n`                                                                                                                                        | 14 tables, 120 manifest strings, 426 source files, 0 problems, exit 0                                          |
| Host API              | `npm run check:host-api`                                                                                                                                    | 271 VS Code APIs, 18 importing files, 23 Node built-ins, 59 theme variables, 0 problems, exit 0                |
| Production build      | `npm run build`                                                                                                                                             | All 17 JavaScript budgets, bundle split, host globals and 83-package notices pass, exit 0                      |
| Guard proof           | Twenty-five distinct mutations, 59 successful executions                                                                                                    | Every named regression fails, exit 1; every latest successful before/restored SHA-256 matches the final source |
| Commit hooks          | ESLint/Prettier and staged gitleaks                                                                                                                         | Implementation checkpoint passed; final follow-up uses the same hooks                                          |

Final build sizes: extension 590.7/600 KiB, Model API 430.2/475 KiB,
checkpoint store 135.7/225 KiB, webview JavaScript 866.2/900 KiB,
ACP 801.0/850 KiB. These are the current product's budgets; lane C is
still assembled into the team by X2, so this does not certify that future
bundle or the complete scheduler.

Two gates first fired on the repair itself and were corrected without
changing their rules. jscpd found an eight-line setup duplicate; the second
restart case now exercises the actual polling interval while the old read
remains unresolved. The prediction drills were repeated against that test.
The host API gate found the normalizer's extra `node:path` import (66 where
the generated record says 65). A small confined lexical stack now resolves
dot segments without that import, preserving the generated record and lane
ownership. Regressions and drills additionally reject empty/root paths,
root escapes, and drive prefixes before a later `..` can erase them. All
shared-file drills were refreshed against the final normalizer.

Raw final test/gate output and timing receipts remain in ignored `temp/`:
`final-core.json`, `final-json-repository-default.json`, `final-gates.json`
and the corresponding `final-*.log` files. Final successful drill receipts
are permanent in `m96c-c-fix-drills.json`; earlier executions are explicitly
historical. No dependency, gate, timeout, ignore, test registration or
localization exemption changed. All eight RVM96CC findings are fixed;
there is no deferred P2/P3 review finding in this lane (PLAN §9).

No full quality run, push, merge, rebase, credential access, live model
attempt or paid call occurred. The scoped full-quality exception is
recorded in PLAN §7. The lead still owns full quality, the other rigs,
S/K/Q/T2/X2 assembly, product README/CHANGELOG reconciliation and whole
milestone certification.

## Final heading/glob variants

After the gate checkpoint, two further variants within findings 3 and 7
were reproduced in complete test files: a narrower JSON glob mixing brace
alternatives with simple character classes still leased, and release-like
headings at other Markdown levels retained the Unreleased context. Both
regressions failed against the checkpoint, exit 1. Simple classes now coexist
with bounded alternatives; class syntax containing literal brace/comma
characters retains conservative treatment. Unsupported heading levels and
release-like category headings now refuse with `structure`, and multiline
bullets cannot swallow them. Fenced examples and ordinary sections pass.

Three additional drills (`F3-mixed-class-braces`, `F7-heading-levels`,
`F7-release-category`) fail the named regressions, exit 1, and restore
byte-exactly. All earlier shared-file/changelog drills were refreshed.
The final core files pass 27/27 again; the registered total remains 52. All
compiler/static/build gates were repeated successfully, and the final hook
checks use the same unchanged rules. No RVM96CC finding is deferred.
