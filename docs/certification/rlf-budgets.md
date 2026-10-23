# RLF-BUDGETS certification — undo the three raised bundle budgets, fit by weight

Lane `rec/rlf-budgets`, base `d7be903c84` (int/recovery on main at 0.19.0).
Three lanes had raised bundle budgets against the recovery rule; each budget
is back to its pre-raise value and each bundle fits under it by weight, with
no behavior change. Repository default timeout throughout.

## What moved

- `dist/judgeServe.js` 30 → 25 KiB. The 4.4 KiB `POSIX_TREE_SUPERVISOR`
  template sat at module level in `src/host/processTree.ts`, where esbuild
  keeps the `String.raw` call in every bundle importing the module even when
  only `runProgram` is used. Function-local in `runTreeSync` (its only
  caller), it shakes out with that function. The script bytes are unchanged
  (4397 chars, byte-identical before/after).
- `dist/teamRunners.js` 100 → 75 KiB. The runners load only through their
  team runtime, so the runners build reads `shared/team` and
  `shared/teamView` from the already-loaded `dist/team.js` (a
  `deferredCohort` rule, M120CAP's pattern) instead of carrying second
  copies; `teamEntry.ts` re-exports the fourteen schemas. No new chunk.
- `dist/estimator.js` 80 → 75 KiB. Composer parsing and the first-wave start
  moved to `dist/estimateActions.js` (new, 52 KiB), required the first time
  one is used; `parseCommand` is async and the starter is kept across calls
  exactly as before. The catalog-row comparator moved to `goal.ts` so the
  engine no longer reaches the catalog adapter module.

## Sizes before and after (`npm run -s build`)

Before (raised budgets):

- `dist/teamRunners.js`: 83.9 KiB (budget 100 KiB)
- `dist/estimator.js`: 77.2 KiB (budget 80 KiB)
- `dist/judgeServe.js`: 25.4 KiB (budget 30 KiB)

After (restored budgets):

- `ok dist/teamRunners.js`: 64.1 KiB (budget 75 KiB)
- `ok dist/estimator.js`: 72.8 KiB (budget 75 KiB)
- `ok dist/judgeServe.js`: 21.1 KiB (budget 25 KiB)
- `ok dist/estimateActions.js`: 44.5 KiB (budget 52 KiB)

The build still exits 1 on seven pre-existing OVERs, byte-identical before
and after (reportingPanel, resourceGovernor, resourceAdmission, modelApi,
vaultActions, estimateContracts, wire); three of those belong to RLINTFIX,
none to this lane.

## Drill 1 — judgeServe (red/green)

Break: base `src/host/processTree.ts` (module-level supervisor) with the
restored 25 KiB budget.
Red: `OVER dist/judgeServe.js: 25.4 KiB (budget 25 KiB)`, `BUILD EXIT: 1`.
(The same build shows `dist/teamRunners.js` at 68.4 KiB: it still reaches
`processTree` through `gitFilterOptions` and carries the dead string again.)
Restore: byte-exact (`git status` clean). Green: 21.1 KiB, ok.

## Drill 2 — teamRunners (red/green)

Break: the sharing rule's outfile check pointed at a nonexistent
`dist/teamRunners-drill.js`, so the team schemas bundle locally again.
Red: `OVER dist/teamRunners.js: 79.6 KiB (budget 75 KiB)`, `BUILD EXIT: 1`.
Restore: one-line revert (`git status` clean). Green: 64.1 KiB, ok.

## Drill 3 — estimator (red/green)

Break: base `src/host/estimator/estimatorEntry.ts` (static composer and
starter imports) with the restored 75 KiB budget.
Red: `OVER dist/estimator.js: 76.7 KiB (budget 75 KiB)`, `BUILD EXIT: 1`.
Restore: byte-exact (`git status` clean). Green: 72.8 KiB, ok.

## New-test fire drill (red/green)

`test/unit/estimatorActionsBundle.test.ts` covers the lazy chunk: a composer
parse resolves through it, and two wave starts share one starter (first
returns `['0']`, second `[]`, one board start, one board read).
Break: `loaded()` returns a fresh actions run every call.
Red: `expected [ '0' ] to deeply equal []`, 1 failed / 1 passed.
Restore and green: 2 passed.

## Gates (final tree)

- prettier --check on touched files: exit 0.
- eslint --max-warnings 0 on touched files: exit 0.
- `npm run typecheck`: exit 0.
- `node scripts/check-l10n.mjs`: exit 0 (0 problems).
- `npm run check:reference`: exit 0.
- `npm run check:host-api`: exit 0.
- `npm run check:plan`: exit 1, pre-existing (PLAN.md over 85% of budget;
  this lane does not touch it beyond one D6 row rewording).
- `npm run check:roadmap`: exit 0.
- `npm run check:catches`: exit 1, pre-existing (log byte-identical to base).
- `npm run duplication`: exit 1, pre-existing (one clone in untouched
  RLM98P2 judge test files).
- `npm run cycles`: exit 0.
- `npm run deadcode` (knip): exit 1, pre-existing (log byte-identical to
  base; the four findings are untouched files).
- `npm run build`: exit 1 on the seven pre-existing OVERs only; every
  budget this lane owns holds.
- `node scripts/check-bundle-split.mjs`: exit 0 (cross-bundle members
  verified, including the new runners→team reads and the actions chunk).
- `node scripts/gen-lazy-registry.mjs --check`: exit 0 (158 bundles).
- Suites covering the moved modules: treeSyncNoDeadline, tokenFile,
  judgeServeLifecycle, sshRunnerUnreachable, teamEntries, runnerHelperNative,
  teamPanel, estimatorPriceCatalog, estimatorBundle, estimateComposer,
  estimatorProvision, estimatorFleetReview, estimatorDiagnostics,
  estimatorWithdrawal, estimatePrices, estimatorFleetFactsReview,
  estimatorFleetBinding, estimateRefusal, estimatorActionsBundle (new) —
  all green with the repository's own timeouts.
- `npx vitest related` over the nine changed sources: the stable failure
  set is byte-identical to two base runs (11 files / 19 tests, all
  environmental: POSIX modes, browser, CPU sampler, shared-build setup);
  two further failures (createdRegistryRace, playbookSchedulesInputs) are
  rig-load flakes that fail and pass intermittently on identical code on
  both base and lane, and pass in isolation on the lane.
- `test/unit/pathGuardSpawns.test.ts`: 1 failure, pre-existing (identical
  six files on pristine base; RLM98P2's judge peers lack guard records).
