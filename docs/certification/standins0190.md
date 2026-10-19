# 0.19.0 stand-in rewrites, lane STANDINS3A (2026-10-19, macbook rig)

The 0.19.0 test audit rewrote two files but missed the five below. Each
stand-in is rewritten onto the real implementation the product uses; every
old behaviour is proved again on real code. Each rewritten file was broken
once with a one-line product change, observed to fail, and reverted.

## test/unit/helpers/schedules/kindStorage.ts — deleted

MemoryScheduleFs (an in-memory filesystem behind ScheduleFsPort, with a
fault-injection map and an in-memory lock chain) is deleted; its only
importer was test/unit/scheduleLeaseLifecycle.test.ts.

## test/unit/scheduleLeaseLifecycle.test.ts — disk only

Every lifecycle row now drives createNodeScheduleFs in a temp directory.
RecordingScheduleFs stays: it forwards every call to the real port and
only records, which is observation, not a stand-in. The forged-fence row
issues and releases a real fence file. The memory-tail row tested the
deleted helper's own tails map, so it goes with the helper; the
no-stranded-waiter behaviour it covered is proved on the product port by
the abort/deadline polling rows and their follow-up acquisitions (which
wait on the release marker, never a short deadline — LEASEFLAKE's meaning
is kept).

- Break: `releaseScheduleFence` publishing `${candidate}.released2`
  instead of `${candidate}.released`.
- Failure: `refuses a forged, re-released or foreign fence handle ...` →
  `AssertionError: expected undefined to be ''`.
- Commit: 4afc3d888.

Left as instructed: `certification identifies the actual filesystem-port
bytes` fails on this worktree (recorded `a56001…`, actual `5acaed…`;
neither input file is touched by this lane). Its hash is refreshed at
release preparation.

## test/unit/scheduleBackgroundReconcile.test.ts — real native entry

RecordingEntry answered status/register/remove in place of the OS
background service. The suite now drives the production
NativeScheduleBackground (real temp home/data directories, the real
process runner, the production authorization shape) behind a forwarding
recorder, with the real coordinator and the real consent store on the
real disk filesystem. The entry harness lives once in
test/unit/helpers/schedules/realBackgroundEntry.ts, shared by the unit
and integration suites (the duplication gate stays silent).

A bare unit process never binds the resource governor, so the entry's
real runner refuses here (`Schedules are unavailable in this host`,
caused by `Resource admission unavailable` from `withLease`); the unit
rows prove the routing — which entry call reconcile makes, with which
arguments — and pin that refusal instead of scripting around it. The
real outcomes live in test/integration/scheduleBackground.test.ts,
where the host binds the real governor. Registering for real would
create a genuine OS background entry, which no automated test does:
bare unit refuses at the runner on every platform before any OS
contact, and the host rows assert the real launcher refusal
(`UnsafeScheduleLauncherError`, before any OS write) on darwin/linux;
the Windows register row is gated out (it would create a real
scheduled task). One routing case was added where a break attempt
showed no coverage: reconcile with a stored `never` consent still
retires the entry.

- Break: `reconcileWith` doing nothing instead of `entry.remove()` when
  nothing is due.
- Failure: `routes a stale entry to entry.remove ...` →
  `AssertionError: promise resolved "undefined" instead of rejecting`.
- Commit: 4c76bd742.

## test/unit/teamPipelines.test.ts — real temp directories

memoryFs answered listFiles/readFile from a literal object. The loading
rows now write their files to real temp personal/project folders and
drive loadPipelines through a thin node:fs adapter (a missing folder
loads as empty, as before; any other failure propagates). Refusals are
relativized to the temp root, so every assertion reads as before on
every platform. The built-ins, rounds, result-kind, threshold and
approval rows are pure logic and unchanged.

- Break: `maxRounds > base.maxRounds` flipped to `<` in applyNarrowing.
- Failure: `a project file that raises the rounds is refused whole` →
  `AssertionError: expected [] to have a length of 1 but got +0`.
- Commit: b9f876083.

## test/unit/teamOrchestratorSlot.test.ts — store cases to integration

memoryState answered get/update from a closure variable. The pure
resolutions (resolveOrchestratorModel, resolveDefaultModel,
requiresBackendSwitch) need no store and stay unit. The read/reset
drills run over the real settings store in
test/integration/orchestratorSlot.test.ts through a two-line forwarding
adapter, with the key restored after each case; the reset proof is a
real reread (the override persisted, then reads as none), not a
write-array length.

- Break: `resolveOrchestratorModel` forced onto the picker branch
  (`=== undefined || true`).
- Failure: `takes effect for new conversations once set` →
  `AssertionError: expected { modelId: 'muse-spark-1.3', …(2) } to deeply
equal { modelId: 'opus-5.5', …(2) }`.
- The integration read/reset rows are proved by hosted CI (they need the
  Extension Development Host); break procedure for them: point the
  adapter's update at a different key and watch the stored-override row
  fail.
- Commit: e5803d1e9.

## test/unit/sessionBudgetApply.test.ts — store cases to integration

memorySource answered get/inspect/update from a Map, and two configs
scripted their refusals (an InvalidError thrown by hand, a stored
Error object). The apply paths now run over the real VS Code
configuration in test/integration/sessionBudget.test.ts through the
production adapter itself — extracted as vscodeSessionBudgetSource in
modelsPanelEntry.ts and used by both the panel and the suite, so the
duplication gate stays silent: a changed write at its effective scope,
unchanged, a concurrent-change conflict, an invalid value with the
store observably untouched, and a read-only workspace settings file as
the real store failure (its filesystem error propagates with its kind,
and the value still reads 10 afterwards). The pure schema validation
stays unit, fed by a real `usdAmountSchema.parse('-5')` instead of a
cast.

- Break: `validateWizardSessionBudget` without the `expectedUsd ===
undefined` arm.
- Failure: `fails a changed value with no prefill to compare against` →
  `AssertionError: expected undefined to be 'Enter a non-negative
amount in dollar…'`.
- The integration write rows are proved by hosted CI; break procedure
  for them: write at the wrong scope in `createSessionBudgetConfig`
  and watch the written-scope row fail.
- Commit: 7e3d925c6.

## Helpers deleted

- test/unit/helpers/schedules/kindStorage.ts (MemoryScheduleFs).
- memoryFs/loadFiles in teamPipelines.test.ts (in-file, replaced by
  nodePipelineFs/loadFromFiles over real temp dirs).
- memoryState in teamOrchestratorSlot.test.ts (in-file; store cases
  moved to integration).
- memorySource in sessionBudgetApply.test.ts (in-file; store cases
  moved to integration) and the two hand-built SessionBudgetConfig
  objects (scripted refusals).
- The answering RecordingEntry in scheduleBackgroundReconcile.test.ts
  (replaced by a forwarding recorder over the real entry).

RecordingScheduleFs in scheduleLeaseLifecycle.test.ts stays: it
forwards to the real port and only records.
