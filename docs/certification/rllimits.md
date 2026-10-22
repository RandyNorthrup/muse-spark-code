# RLLIMITS — fix/limits-int2's rule-abiding parts, hand-ported onto 0.19.0

Linux rig `linuxlt`, worktree `/home/randy/lanes/RLLIMITS`, branch
`rec/rllimits`, base `c7bdd3e943` (main at 0.19.0). Ported by hand from
`src/RLLIMITS/01-fix-limits-int2`, never merged whole. No paid or live
model calls. No push, merge or rebase.

## Why

The source branch carried unique, wanted work — byte-range file tools,
six once-silent outcomes, paged listings — mixed with drops the owner
ruled out under D121 (the repeat stop, the continuation repeat stop, and
the settings `modelApiMaxTurnRequests`, `questions.maxOpenQuestions`,
`judge.timeoutSeconds`). Its activation bundle also measured 568,388
bytes against 564,424. This lane lands only the unique, rule-abiding
parts, with the D121 drops left dropped and the budget met by weight.

## What changed

- Byte-range `read_file`/`edit_file` (`src/core/backends/modelapi/fileRangeTools.ts`,
  `src/core/toolEdit.ts`): `byteOffset`/`byteLength` address one window of
  a file of any size; the execution lives in the deferred
  `dist/modelApiFileRange.js` chunk (`modelApiFileRangeEntry.ts`), loaded
  on the first range-addressed call. Whole-file turns never carry it.
- Six notices (`src/shared/l10n/en.ts` plus all 14 tables, and their
  producers): `JudgeFence.dropped()`, the elicitation timeout
  (`mcpElicitationTimedOut`), `QuestionRegistry.onExpired`
  (`questionsExpiredNotice`), the child-result clip (`subagentResultClipped`,
  both counts), the provider send failure (`modelApiSendFailed`), and the
  tab spend gate expiry (`TabSpendGate.onExpired`,
  `tabBudgetReachedDetail`).
- Paged search, listings, diagnostics and web fetches (B5, B6, B7):
  `searchPaging.ts` threads the offset through `search`, `list_files`,
  diagnostics and web fetch; every page names what is left and the offset
  that fetches it. The search/list execution rides the deferred
  `dist/modelApiTools.js` chunk.
- B10: an omitted transcript keeps the unsent draft as a true top-level
  draft, and the restore waits for it (`pendingRestore?.isTranscriptOmitted`).
- B23: damage markers are all kept, never sliced to a cap.
- Rule-18 shapes: every new `catch` is NARROW or REPORTED (absent-chunk
  guard with rethrow, cause-carrying failure helpers, named-condition
  guards), and `scripts/catch-baseline.json` was lowered for the moved
  code. The golden request fixtures were re-baselined from the real
  builders (tools plus derived cache keys only; every other field
  byte-untouched), per the 1a5e7782 precedent.
- Generated records kept current: `src/shared/reference/reference.generated.ts`,
  `docs/ide-compatibility/host-api.md`, `ROADMAP.md` (with the internal
  `RLLIMITS` entry).

## Behaviour → test map

- `test/unit/fileRange.test.ts` (12): range reads and edits end to end
  through `executeTool` and the deferred entry; past-end, unseen and
  outside-window refusals name the valid range.
- `test/unit/toolPaging.test.ts` (6): pure paging plus end-to-end
  `list_files` paging, past-end refusal and glob narrowing through the
  deferred chunk.
- `test/unit/omittedTranscript.test.ts` (5), `snapshot.test.ts` (12),
  `damagedSessions.test.ts` (2): B10 draft shape and gate, B23 keep-all.
- Notice suites: `judgeFenceDropped`, `elicitationTimeoutNotice`,
  `questionExpiryNotice`, `subagentResultClip`, `tabBudgetReachedNotice`,
  `configuredInjectedSend` (the `not_sent` liability),
  `diagnosticsReport`, `diagnostics`, `webFetchPaging`, `webFetchBomb`.
- `test/unit/invariants.test.ts` (42): golden request bytes rebuilt from
  the real builders after the definition change.
- D121 drops verified dropped: no `modelApiMaxTurnRequests`,
  `maxOpenQuestions`, `judge.timeoutSeconds` setting, no repeat stop, no
  continuation repeat.

## Red/green drills

- Catch gate: all ten reshaped handlers reverted to their flagged forms —
  `catch-inventory --check` failed naming all ten sites (1 SWALLOW + 9
  GENERIC, counts rose) — restored, `All catch sites and counts match the
baseline`.
- Shared edit matcher: the `resolveEditRanges` miss mapping flipped —
  `fileRange.test.ts` failed exactly `refuses a find outside the read
window` (1 failed, 11 passed) — restored, suite green.
- Earlier per-part drills (ports): paging, fileRange, moved executors —
  each broken on purpose, watched fail, reverted (certified in the lane's
  earlier commits).

## Gates (final tree)

- `npx tsc --noEmit -p tsconfig.json`: clean. `npm run typecheck` (all
  five projects): clean.
- `eslint --max-warnings=0` on every touched file: clean.
- `prettier --check` on every touched file: clean.
- `node scripts/check-l10n.mjs`: 0 problems.
- `npm run check:reference`, `check:host-api`, `check:plan`,
  `check:roadmap`: green (generated files refreshed, never hand-edited).
- `npm run check:catches`: `All catch sites and counts match the
baseline`.
- `npm run duplication`: 0 clones. `npm run cycles`: no cycles.
  `npm run deadcode` (knip): only the three pre-existing `@unwired` tags.
- `npm run build`: `dist/extension.js` 427.5 KiB, `dist/modelApi.js`
  523.8 KiB (budget 525), `dist/modelApiTools.js` 38.5 KiB,
  `dist/modelApiFileRange.js` 31.5 KiB (budget 50 each); split and size
  gates green.
- Real use (no provider): byte-range and paging flows run through the
  packed-product-shaped chunks via `executeTool` in the suites above;
  every person-visible sentence goes through the English table plus all
  14 translations.

## Open

Hosted CI is the release gate and runs on merge. SAST locally: 533
rules on 4001 files, 0 findings. `npm run security:audit`: 4 advisories
covered by the 2 tracked exceptions, no dependency change this lane.
`security:secrets` (gitleaks over history) reports 3 redacted
`generic-api-key` hits, all outside this lane: two in base-history vault
migration tests, one in another lane's move-snapshot ref; the lane
touches no vault or voice file, and the pre-commit hook's scan of the
lane's staged patch found no leaks. The vault suites were not run (no
vault change).

## Integration on Windows (int/recovery, 2026-10-22)

`fileRange` "edits inside the window the model read" failed on the
owner's Windows 11 PC after the merge (`EPERM: operation not permitted,
rename`, 2 of 2 runs): `spliceFileRange` renamed the staged file over
the target while its own read handle was still open, which Linux allows
and Windows refuses. The read handle now closes before the rename, and
each rename attempt re-checks by path that the target is the file that
was read (same native file ID) with the planned size and mtime; a gone
file reads as changed. The same case is green after the change (12/12
in the file), commit `19ec96a431`.
