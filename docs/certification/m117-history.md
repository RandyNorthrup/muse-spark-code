# M117 C-M117-2 certification — estimator history journal and builders (2026-10-11, macmini)

Lane CM1172 (branch `c/m117-2`, from `7d0410526`). Scope: the journal in the
agent data folder; concrete builders for git lane branches, M116's
FilePlaybookJournal and GitHub CI check runs; retention and skippedRecords
disclosure. Acceptance 5 (calibrated estimates).

## What shipped

- `src/core/estimator/calibration/sources.ts` (new) — concrete
  `HistoryBuilderPorts`: `gitDurationSource` (lane-branch first commit to
  integration merge under M113's branch convention, unique match only),
  `playbookReviewSource` (complete rounds, module/class strikes, one redesign
  event per family round from validated M116 records; unattributed rounds stay
  unknown), `ciDurationSource` (summed measured check durations for lane-tip
  ancestors, never wall time). Missing stays missing (the lane is excluded
  with its reason); malformed reaches `buildHistory` as `invalidHistorySource`.
  The M96c board's active-agent-time source is deliberately absent: no board
  with lane hours exists yet, and the ports are optional, so git elapsed time
  covers durations until M96c lands.
- `src/host/estimator/historyStore.ts` (new) — `estimateHistoryDirectory`
  and `fileHistoryPorts` over one journal instance, so the skip snapshot
  belongs to the same listing as the records.
- `src/host/estimator/localFleet.ts`, `src/extension.ts`,
  `src/runtime/estimator/ports.ts` — both shells read history from
  `<agent data folder>/estimator/history` (new `ESTIMATE_HISTORY_DIRECTORY`
  constant). No activation IO: the journal creates nothing until first use,
  and a missing directory lists as empty.
- `src/shared/estimate.ts` — optional string-only `historySkipped` section
  field (opaque file id + fixed code), so the disclosure walk gains no
  targets and existing sections are byte-identical when nothing is skipped.
- `src/core/estimator/calibration/journal.ts` — `clear()` deletes
  observations, `.identity` claims and staging files together; observations
  are otherwise immutable and never age-pruned. `src/core/estimator/planSnapshot.ts`
  exports `branchLane` (M113's convention, reused instead of duplicated) and
  `outputLines` (the `lines()` helper, consolidated out of
  `planSnapshotSource.ts` for the zero-tolerance duplication gate): the only
  base-logic changes.
- No new UI strings (fixed failure codes carry the details), no new command,
  setting, feature-catalog row, or dependency.

## Contract findings (built right the first time)

1. **M113's branch convention names `m117/c`, not `c/m117-c`.** The first
   sources run matched nothing: `shortRef` strips an owner prefix only before
   `feature/` or `m\d+/`, so the lane branch for estimator lane `M117:C` is
   `m117/c` (as the `m117/s`, `m117/c` merges show). Fixed the fixtures, not
   the matcher.
2. **Playbook timestamps are epoch millis, finding classes are lowercase.**
   `round.at` is `z.int()`, and `PLAYBOOK_FINDING_CLASSES` folds
   validation/security, failure/honesty, concurrency/lifecycle, tests and docs
   into the estimate's five review classes. Unknown classes stay aggregate-only.
3. **M113's CI run records carry no durations.** `reportCiRunSchema` has no
   timestamps, so a GitHub-API CI source would need an uncaptured wire shape
   (rule 13). The CI source sums M113's `CheckRunRecord.durationMs` instead.
4. **Builders convert a throwing source to `historySourceUnavailable`.**
   Sources therefore return raw measured projections for the builders' schemas
   to reject (`invalidHistorySource`) and throw only on structural corruption.
5. **Destructuring defaults revive explicit `undefined`.** The git fake reads
   absent scenario fields with `in`, or "missing" scenarios silently run happy.

## Tests (repository timeouts, never `--testTimeout`)

- `test/unit/estimatorHistorySources.test.ts` (new, 12 tests): git build,
  missing (no/ambiguous/deleted/unmerged branch, no machine class, no git),
  malformed dates, playbook projection/strikes/redesigns/attribution,
  unreadable journal, CI job-hours and malformed runs, end-to-end collection.
- `test/unit/estimatorHistoryJournal.test.ts` (+3): `clear()` semantics,
  missing-directory `clear()`, and concurrent appends from **four child
  processes** (18 unique lanes plus an idempotent cross-process replay: 18
  records, 18 `.json` + 18 `.identity` files, no `.tmp`, no skips).
- `test/unit/estimatorHistoryStore.test.ts` (new, 3 tests): directory join,
  record + skip-diagnostic round-trip, sharing with a directly opened journal.
- `test/unit/estimatorEntry.test.ts` (+2): `historySkipped` disclosure and
  its omission when nothing is skipped (sections byte-identical).
- Regression: `estimatorCalibration`, `estimatorContracts`,
  `estimatorLocalFleet`, `runtimeEstimatorPorts` files pass unmodified.

## Red drills (break the guard, see the named test fail, restore byte-exact)

| Guard                                        | Break                                           | Named failure                                                                            | Restore SHA-256  |
| -------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| Journal identity claim (`journal.ts`)        | removed the `EEXIST` identity-conflict check    | `admits only one identity when independent journals concurrently append different bases` | `c4d1f231…9962`  |
| Branch uniqueness (`sources.ts`)             | returned the first hit instead of requiring one | `stays missing without a branch, with an ambiguous branch or without a tip`              | `3331653e…80ff`  |
| Disclosure passthrough (`estimatorEntry.ts`) | dropped the `historySkipped` spread             | `discloses skipped history records without changing calibrated output`                   | `b82a38a5…8644f` |

Full SHA-256 values are in `temp/cm1172-drills/sha-before.txt` (gitignored);
each file was copied back and its hash re-verified before committing.

## Still open (for the lead to schedule)

- **History population.** Nothing calls `collectHistory` yet: the M115
  lane-finished trigger (C-M117-8) owns the append path, and it needs the
  snapshot lane's rig→machine-class mapping for git durations. The journal
  reads correctly but starts empty, so estimates still report the
  uncalibrated prior until observations accumulate.
- **M96c board durations.** The board port stays absent; agent-time
  observations begin when M96c's duration source merges.
- **Panel/CLI surfacing of `historySkipped`.** The field rides in the section
  (JSON output carries it); the Estimator panel's honesty block and the text
  render do not name it yet (U/W surfaces).
- **Windows + editors.** Verified on macmini only; Windows path joins are
  covered by `path.join` tests, other editors by the shared core. The full
  `npm run quality` gate and cross-rig runs are lead-owned per the scoped
  brief; scoped gates run here are recorded below.

## Scoped gate receipts (macmini, this lane)

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npm run typecheck:unit` — clean.
- `npx eslint --max-warnings=0` on all changed files — clean.
- `npx prettier --check` on all changed files — clean.
- `npm run check:l10n` — 0 problems (no new UI strings).
- `npm run check:host-api` — regenerated `docs/ide-compatibility/host-api.md`
  (child_process 28→29, fs 71→72, os 34→35, path 196→197, util 11→12).
- `npm run check:reference` — current (no new command, setting or feature).
- `npm run deadcode` (knip) — clean.
- `npm run duplication` (jscpd) — 0 clones, after consolidating the
  `lines()` helper into the exported `outputLines` in `planSnapshot.ts`.
- `npm run build` — all budgets hold **except** `dist/webview estimator
panel: 25.3 KiB (budget 25 KiB)`. Measured with base `src/shared/estimate.ts`
  (`7d0410526`): the same 25.3 KiB, so the overage **predates this lane**
  (the closure grew from 9.6 KiB on 2026-10-06 as other lanes extended the
  shared contract). This lane's marginal cost is nil: the strict
  `historySkippedSchema` carries `/* @__PURE__ */` so unreading bundles drop
  it, and the section field reuses schema nodes already in the chunk. Raising
  the cap or shrinking the closure is the owner's call, outside this lane's
  files.

## RLM117 port note (2026-10-22, macbook)

True merge onto `rec/rlm117` with resolutions for the merged main model:

- `localFleet.estimatorSourcePorts` keeps the fleet-binding (`fleetIo`),
  `beginEstimate`/limit-context assembly and adds `historyPorts` as a fourth
  parameter (history journal + skipped diagnostics); the price port stays
  fifth. Extension and headless assemblies pass the file journal
  (`estimateHistoryDirectory` under the agent data folder).
- `estimatorEntry` keeps `parseEstimate` + the closed colon diagnostic
  registry and adds the strict `historySkipped` parse.
- `planSnapshotSource` keeps the guarded execution model and imports the
  shared `outputLines`.
- `sources.ts` follows the merged execution model: `resolveExecutable` from
  `../../execGuard` with the explicit no-workspace scope (the base's
  scope-less probe threw, so every git read stayed missing).
- The resurrected `ESTIMATE_DRIFT_DETAIL_MAX_CHARS` is removed again:
  mainline `8eaedf111` deliberately deleted it when drift moved into
  check-plan problems.

Real-code rewrite of the history-sources suite (the branch scripted git
output through the `runGit` seam; mainline `f2b00c094` purged its fake
sibling suites): every git read now runs the machine's own git against a
real temp repository (fixed `+00:00` stamps, locally crafted origin refs,
no network), and playbook rounds go through the real `FilePlaybookJournal`
file. The rewrite exposed a real bug the scripted transport masked:
`merge-base(default, tip)` names the tip itself for a merged branch, so the
fork-point read was always empty and every merged lane stayed missing. The
source now reads the integration merge (`--merges --ancestry-path`) and
takes the lane's commits as `merge^1..tip`.

- Red: the rewritten suite against the pre-fix source — 6 failed, every
  merged-lane case `missingDuration`.
- Green: `test/unit/estimatorHistorySources.test.ts` (11 passed),
  `test/unit/estimatorHistoryEntry.test.ts` (2 passed),
  `test/unit/estimateHistoryJournal.test.ts` (7 passed),
  `test/unit/estimatorHistoryStore.test.ts` (3 passed); fleet
  (binding/facts-review/review, 72), snapshot/plan-source/prices (36) and
  catalog/withdrawal (34) suites green; unit, host and webview typechecks
  clean; eslint clean on every touched file.
- Determinism: fixed author/committer stamps with explicit `+00:00` hold
  across processes (identical SHAs observed) and time zones; no locale text
  asserted; temp state under the rig's `$TMPDIR` via `os.tmpdir()`.
