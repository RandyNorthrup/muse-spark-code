# M117 C-M117-1 certification — estimator plan-snapshot adapter (2026-10-10, Kubuntu)

Lane CM1171 (branch `c/m117-1`, from `82d50d5e4`). Scope: the shared core
adapter from M113 readPlan (lane tables, Starts, rigs, files → affinity and
kind, delivery order, §10) + git merged-lane state + PR/issue evidence, wired
into every host in place of `missingEstimateBinding('M117-W-M113-plan-reader')`.

## What shipped

- `src/core/estimator/planSnapshot.ts` — pure `buildPlanSnapshot(planText,
goal, asOf, evidence)`. No IO, no clock, no model. Shared core, so every
  editor and host gets it through the same code.
- `src/host/estimator/planSnapshotSource.ts` — host side: workspace PLAN.md,
  `git for-each-ref` + `git branch --merged`, `gh pr/issue list`, all zod-
  validated, programs by absolute path (D24), no credentials in the
  environment. Evidence gaps stay conservative (lanes count as planned, never
  merged); only an unreadable plan refuses.
- `src/host/estimator/planSnapshotBundle.ts` + `planSnapshotEntry.ts` —
  `dist/planSnapshot.js` (61.5 KiB, budget 75 KiB), required on the first
  estimate needing a snapshot. The adapter reads M113's plan reader, which
  must stay out of activation (split gate): the bundle is registered in
  `scripts/lib/deferredBundles.mjs`, built by `scripts/build.mjs`, budgeted
  in `scripts/check-bundle-size.mjs`, shipped in the VSIX (`.vscodeignore`)
  and the ACP package (`scripts/package-acp.mjs`), and listed in AGENTS.md.
  `dist/extension.js` is back at 550.9 KiB (600 KiB budget);
  `dist/estimator.js` untouched at 67.1 KiB.
- `src/host/estimator/localFleet.ts`, `src/extension.ts`,
  `src/runtime/estimator/ports.ts` — `estimatorSourcePorts(priceLookup,
snapshot)` in every host, the snapshot behind the lazy loader (the loader
  is async so failures reject instead of throwing synchronously). Board,
  broker and catalog still refuse with their handoff names.
- `src/shared/constants.ts` — `ESTIMATE_SOURCE_TIMEOUT_MS`,
  `ESTIMATE_MISSING_DETAIL_LIMIT`, the three `ESTIMATE_ASSUMED_*` demand
  constants at the engine fixtures' scale, and `PLAN_SNAPSHOT_BUNDLE_FILE`.
- README “Estimates”, CHANGELOG `[Unreleased]`, PLAN.md M117 status note,
  regenerated `docs/ide-compatibility/host-api.md` (five Node builtin counts
  move with the new git/`gh` reads). No new UI strings (existing
  `estimateFailed`/`estimateNotFound`/`estimateUnavailable` carry the
  technical details), no new command, setting, or dependency; the reference
  gate is unchanged.

## Contract findings (built right the first time)

1. **The schedule refuses unknown demand** (`schedule.ts known()`), so an
   all-unknown resource projection can never forecast. The adapter emits the
   engine fixtures' own assumed lane (1 slot, 1 req/hr, 10 tokens/hr, 0 USD,
   0 CI, 4 GiB peak / 2 GiB steady workspace) with basis `assumption` and 0
   samples — disclosed in the estimate, replaced per kind by calibration
   (C-M117-2). Review stays `unknown` and qualifies the forecast through
   `unknownLimits`. Found via the e2e failing with
   `unknown-demand:M112:Q:requests` before the fix.
2. **Single-fleet affinity is exact.** `M118:P` (Mac mini rig) and `M118:X`
   (Win11 VM rig) correctly refuse as `unschedulable` on a linux-x64 rig;
   multi-machine placement is C-M117-3's scope, not a fallback invented here.
3. **Merged detection follows M113's branch convention** (`m112/0`-style
   refs); `c/…` lane branches do not match, exactly as the report reader
   behaves. Terminal milestone statuses (merged/released/complete) merge
   their lanes regardless of branch evidence.

## Tests (repository timeouts, never `--testTimeout`)

- `test/unit/estimatorPlanSnapshot.test.ts` — 25 tests: every goal kind
  resolves (milestone, lanes, PR, issues, label, release); running/merged
  states; terminal milestones; unknown goals refuse; hour-less closure
  refuses naming lanes; §10-only release resolves empty; zero-sample
  assumption disclosure; byte-identical snapshots under reordered evidence;
  rig affinities incl. unknown rigs; file/rig affinity combination; Windows
  separators; milestone expansion of Starts refs; merged-PR mapping.
- `test/unit/estimatorPlanSnapshotSource.test.ts` — 6 tests over injected
  IO: plan+git+gh resolution, empty root and unreadable plan refuse with
  `missing-plan`, git/gh gaps stay conservative, malformed `gh` JSON
  degrades, `mergedAt` maps to merged.
- `test/e2e/estimatorPlanSnapshot.e2e.test.ts` — plan text → snapshot →
  goal → schedule → seeded simulation: P50/P90 dates, chain order, critical
  path, disclosed unknown limits, byte-identical second run.
- Updated `test/unit/runtimeEstimatorPorts.test.ts` — snapshot reads the plan
  (unknown goal reports `Goal not found`) instead of the retired handoff;
  board/prices still refuse. Existing `estimatorLocalFleet` (4) green.
- Real-plan proof (scratch, not committed): `M118` (5 lanes) and `M116`
  (6 lanes) resolve from this PLAN.md; `M117` refuses naming its
  unestimated `M96` lanes; `M115` refuses on `M109:T`; snapshot bytes are
  deterministic across builds.

Results: 25 + 6 + 2 + 5 + 4 green on Kubuntu in this worktree.

## Red drills (break → named failure → byte-exact restore by SHA-256)

Drill base SHA of `src/core/estimator/planSnapshot.ts` (pre-lint-refactor;
each restore verified byte-exact to it before the lint pass, and all suites
re-ran green on the final file):
`5f8725c7ec743b86148adf336baafd83a2ac9cb7faebcda029b84f3e36db41a3`

- D1 (Starts parsing): `after/with/lanes?` keywords broken → 7 failures
  (goal-kind resolutions, merged-edge clearing, expansion test). Restored to
  the SHA above.
- D2 (assumed demands): slots back to `unknown` → disclosure test plus both
  e2e tests fail (`unknown-demand`). Restored to the SHA above.
- D3 (determinism): issue `laneIds` emission unsorted → byte-identical test
  fails on the multi-lane issue/PR evidence. Restored to the SHA above.
  (First attempt at D3 was ineffective — single-lane PRs are order-proof
  because plan-derived claims come first — so the test was strengthened with
  an evidence-only multi-lane PR and within-issue reordering before the
  drill. The strengthened test passes with the guard intact.)

## Gates and sizes

- `tsc -p tsconfig.json`, unit and e2e typechecks clean; eslint
  (`--max-warnings=0`) and prettier on every changed file; `check:l10n` (0
  problems), `check:reference` (unchanged), regenerated `check:host-api` (0
  problems), knip (no dead code), jscpd (0 clones).
- `check-bundle-size`: extension 550.9/600, estimator 67.1/75,
  planSnapshot 61.5/75 KiB. `check-bundle-split`: the first build carried
  the plan reader in activation and failed as designed; the lazy
  `dist/planSnapshot.js` passes.
- Lint notes: `isDisjointFrom`/iterator helpers are refused for the Node 20
  floor (loops instead, no escape hatch needed); the snapshot loader is
  async so bundle failures reject through the ports contract.

## Reviews (Codex + Grok): blocked in-lane, lead-owned

Both reviews were attempted from this lane on 2026-10-10 and both are
blocked before any model call, by the lane sandbox, not by the code:

- `codex review --commit 688a3c21c` (from the worktree): `Error: failed to
initialize in-process app-server client: Read-only file system (os
error 30)` (with the same warning up front about PATH aliases).
- `grok -p "<read-only review prompt>" --cwd <worktree> --permission-mode
plan`: `Error: Couldn't create session: An unexpected I/O error occurred.:
{ "detail": "Read-only file system (os error 30)", "code": "FS_OTHER" }`.
- `codex doctor` hung on the same restriction and was terminated.

Both CLIs fail at session/state creation outside the writable roots, so no
review ran, nothing was spent, and no findings exist to fix. Redirecting
either tool's state or credentials around the sandbox was not attempted
(auth material is never copied). The lead runs both reviews outside the
sandbox; their findings land here with same-day fixes per owner order (3).

## Open / lead-owned

- Codex + Grok review outcome and any fixes (blocked above; awaiting
  out-of-sandbox runs).
- Windows/macOS runs, hosted CI, full `npm run quality` (lead gates).
- Later lanes: C-M117-2 history/calibration (replaces the assumptions per
  kind), C-M117-3 fleet binding (multi-machine placement), C-M117-4 catalog,
  C-M117-5 board start, M113 N issue lane linkage (host passes `laneIds: []`
  for `gh` issues until then, so label/issue goals on unassociated issues
  report not-found honestly).
