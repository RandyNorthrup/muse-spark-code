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

## Phase 2 — fit the remaining reachable blockers (2026-10-22)

The first phase left seven pre-existing OVERs. Three belong to RLINTFIX
(`modelApi.js`, `resourceAdmission.js`, `vaultActions.js`), which this
lane must not touch. The other four are fitted here, with no budget
raised and no behavior change.

### What moved

- Constants satellites converge: `shared/constants.ts` no longer
  re-exports `browserCheckConstants` or `linuxDictationConstants`, so
  bundles importing the barrel stop carrying both satellites'
  initialization; every consumer imports the satellite directly. The
  four dictation helper-process tunables move to a new import-free
  `shared/dictationConstants.ts`, read the same way.
- `dist/reportingPanel.js` (+39 B): the entry reads the settings
  section through `SETTINGS_SECTION` instead of five `'museSpark'`
  literals (constants, not literals).
- `dist/wire.js` (+717 B): sixteen values no dist bundle reads and no
  source outside their defining module references are unexported from
  the wire modules (their code stays for internal users; only the
  export entries leave). The `elicitationReplySchema` value is dead —
  only its type is used — so it is replaced by its proven-identical
  explicit type (exact-equality proof compiled under the repo config,
  then removed).
- `dist/resourceGovernor.js` (+1691 B): the Windows job-object tree
  reader (3317 B in-output) rides new `dist/resourceGovernorWindows.js`
  (13 KiB), required the first time a Windows job launch binds its
  tree. The entry imports `trees/windowsEntry` dynamically and the
  deferred cohort externalises it, the way admission's import reaches
  the governor; the factory constructs the same reader class with the
  same arguments. The split gate allows the chunk exactly the reader's
  resource files (`RESOURCE_WINDOWS_FILES`).

### Sizes before and after (`npm run -s build`)

Before (phase-1 tree):

- `OVER dist/reportingPanel.js`: 51,239 bytes (budget 51,200)
- `OVER dist/resourceGovernor.js`: 129,691 bytes (budget 128,000)
- `OVER dist/wire.js`: 77,517 bytes (budget 76,800)
- `OVER dist/estimateContracts.js`: +30 B (budget 25 KiB)
- `OVER dist/resourceAdmission.js`: +70 B (budget 25 KiB)
- `OVER dist/vaultActions.js`: +37 B (budget 25 KiB)
- `OVER dist/modelApi.js`: 545,025 bytes (budget 537,600)

After:

- `ok dist/reportingPanel.js`: 50.0 KiB (budget 50 KiB)
- `ok dist/resourceGovernor.js`: 123.5 KiB (budget 125 KiB)
- `ok dist/resourceGovernorWindows.js`: 10.7 KiB (budget 13 KiB)
- `ok dist/wire.js`: 74.6 KiB (budget 75 KiB)
- `ok dist/estimateContracts.js`: 24.9 KiB (budget 25 KiB)
- `ok dist/resourceAdmission.js`: 25.0 KiB (budget 25 KiB)
- `ok dist/vaultActions.js`: 24.9 KiB (budget 25 KiB)
- `OVER dist/modelApi.js`: 532.3 KiB (budget 525 KiB, +7425 B) —
  RLINTFIX's scope; this lane must not touch it.

The convergence alone returned estimateContracts, resourceAdmission and
vaultActions under budget; their modules are untouched. The build still
exits 1 on modelApi only.

### Drill 4 — wire export trim (red/green)

Break: the five `agentEvents.ts` values re-exported
(`approvalStageSchema`, `checkSummarySchema`, `questionOptionSchema`,
`tokenUsageCompletionSchema`, and the dead `elicitationReplySchema`
value back in the bundle).
Red: `OVER dist/wire.js: 75.0 KiB (budget 75 KiB)` (76,851 bytes),
`BUILD EXIT: 1`.
Restore: byte-exact (`git status` clean apart from this record).
Green: 74.6 KiB, ok.

### Drill 5 — governor chunk (red/green)

Break: `resourceGovernorEntry.ts` with the static
`WindowsResourceTreeReader` import and inline construction back.
Red: `OVER dist/resourceGovernor.js: 126.7 KiB (budget 125 KiB)`,
`BUILD EXIT: 1`.
Restore: byte-exact (`git status` clean). Green: 123.5 KiB, ok.

### Drill 6 — new-test fire drill (red/green)

`test/unit/governorWindowsBundle.test.ts` covers the chunk entry: the
factory builds a `WindowsResourceTreeReader` instance, and relative
helper paths throw the reader's sentence.
Break: the factory returns `{}`.
Red: 2 failed.
Restore and green: 2 passed.

### Drill 7 — gate-clause fire drills (red/green)

- Break: the new `RESOURCE_WINDOWS_FILES` clause removed from
  `checkResourceBundles`. Red: 4 × `carries resource policy …
outside the lazy governor`, split-gate exit 1. Restore: exit 0.
- Break: a bogus file added to the chunk's `ON_FIRST_USE` record.
  Red: `dist/resourceGovernorWindows.js no longer carries
src/core/resources/trees/nope.ts`, split-gate exit 1. Restore:
  exit 0.

### Phase-2 gates (final tree)

- prettier --check on touched files: exit 0.
- eslint --max-warnings 0 on touched files: exit 0 (after fixing 3
  `unicorn/prefer-string-raw` errors in the new test).
- `npm run typecheck`: exit 0.
- `node scripts/check-l10n.mjs`: exit 0.
- `npm run check:reference`: exit 0.
- `npm run check:host-api`: exit 0.
- `npm run check:plan`: exit 1, pre-existing (PLAN.md still over 85%;
  this phase does not touch PLAN.md).
- `npm run check:roadmap`: exit 0.
- `npm run check:catches`: exit 1, pre-existing (counts identical to
  base; this phase adds no try/catch).
- `npm run duplication`: exit 1, pre-existing (the one clone is two
  untouched judge test files).
- `npm run cycles`: exit 0.
- `npm run deadcode` (knip): exit 1, pre-existing (log byte-identical
  to base; none of this phase's files flagged).
- `npm run build`: exit 1 on `dist/modelApi.js` (+7425 B) only;
  every budget this lane owns holds.
- `node scripts/check-bundle-split.mjs`: exit 0.
- `node scripts/gen-lazy-registry.mjs --check`: exit 0 (159 bundles).
- Suites: questionContracts, mediaContracts, reportProblem,
  scheduleTime, schedulesReportSource, teamProtocolLoading,
  browserLaunch, helperLocation, dictationRefusedKill,
  governorWindowsBundle (new), windowsTreeReader (win32-gated, skips
  on Linux), resourceTreeFailures, evalFreezeLayout — all green with
  the repository's own timeouts.
- `npx vitest related` over the three governor sources (261 files):
  232 passed, 18 skipped; the 11 failing files are the base set less
  the playbookSchedulesInputs flake (passing now) — all environmental
  (POSIX modes, browser, CPU sampler, shared-build setup), identical
  to base. `evalFreezeLayout` failed mid-phase only because the new
  entry file was still untracked (the freeze copies `git ls-files`);
  it passes 4/4 on the committed tree.
