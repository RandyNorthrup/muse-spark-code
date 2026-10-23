# RLF-NOLIMITS — the three bounds RLTESTDRIVE kept, plus the checkout's own (2026-10-22, macmini)

Recovery lane. Base: int/recovery at 397aca3dd (main 0.19.0 plus 15 merged
lanes). Branch `rec/rlf-nolimits`. Owner's standing rule: every limit of ours
defaults to none — fix, never ask.

RLTESTDRIVE item 9 kept three bounds "under D121(4)", naming each "for the
lead" (`docs/certification/rltestdrive.md`): `SCHEDULE_FS_RETRY_ATTEMPTS`
(signal threading through `ScheduleFsPort` "a store-API project"),
`ORPHAN_SWEEP_ROUNDS` ("no stop reaches MCP exit cleanup"), and
`VISIBILITY_TIMEOUT_MS` ("the release's own patience"). RLM123 additionally
kept the checkout's own `GIT_WORKTREE_TIMEOUT_MS` deadline. This lane removes
all four under D121: no removal leaves a silent hang — the person is told in
words and the work waits until they stop it.

## 1. SCHEDULE_FS_RETRY_ATTEMPTS is gone

A transient-coded storage failure (EPERM/EBUSY/EACCES) retries until the
operation succeeds, fails another way, or the call's stop fires. The backoff
spaces attempts; it stops nothing. An abort throws the signal's reason, like
the lease lock's own stop (`src/runtime/schedules/nodeScheduleFs.ts`).

The stop threads through every layer:

- `ScheduleFsPort`: every method takes `ScheduleCallOptions` (`src/shared/scheduleV2.ts`;
  `eitherSignal` combines an owner's bound stop with a call's stop).
- The journal: `read`/`transact` take the call's stop and pass it to the
  lease lock and every filesystem call (`src/core/schedules/journal.ts`).
- The store: every method takes the call's stop; the store binds the
  owner's stop at construction (`src/core/schedules/store.ts`). The engine
  binds the delivery stop at the store, so close-time settlement still runs,
  and passes the combined close/delivery stop on the calls that must end at
  close (`src/runtime/schedules/engine.ts`). Debt-handling catches
  (journal retirement, audit prune, maintain) rethrow on abort: the stop is
  not debt.
- The queue (`serialize`), authority, registry, consent and migrate take the
  stop; scheduler hot paths, agent-tool requests, delivery bindings and the
  paid reserve pass their narrower stops. The report reader binds its
  context signal at the store instead of wrapping the port
  (`src/runtime/reporting/playbookSchedulesInputs.ts`); a cancelled read
  ends the report instead of failing or retrying it.
- The CLI binds Ctrl-C/SIGTERM through the binding into the engine, so a
  command's store wait ends at the person's stop with the abort in words
  (`src/runtime/main.ts`, `src/runtime/schedules/binding.ts`,
  `src/runtime/schedules/runtimeEntry.ts`).

`SCHEDULE_FS_RETRY_BACKOFF_MS` stays: spacing, not a stop.

Drill (`test/unit/scheduleFsRetryStop.test.ts`, real filesystem, the kernel's
own denial via `helpers/deniedAccess`): a read denied for 1.5 s succeeds
(six attempts space themselves ~420 ms apart, so the read outlived the
removed five-attempt budget); a denied read with a stop rejects with the
stop's reason. Red: a restored `attempt + 1 >= 5` check fails both tests
(vitest exit 1). Green: both pass (exit 0).

The CM1134AR8 port marker is re-certified from `e62d5346…` to `7b76e9dc…`
with this reason, per the re-mark convention.

## 2. ORPHAN_SWEEP_ROUNDS is gone

The orphan sweep reaps until none remains, no kill confirms, or the stop
fires (`src/host/processTree.ts`). The pool's per-server signal and the
vault's controller signal travel through the spawner into the queued exit
sweep and the kill's own sweep (`src/host/backend/mcpProcess.ts`); tool and
vault kills pass their run signals. A fired stop ends the sweep with words
naming the exited root, before its first round or after its current one.

Ordering note: pool close aborts before it awaits the kills (the abort is
what ends in-flight work), so a shutdown sweep always sees a fired stop and
stops; the tree kill itself still ran. Live operation sweeps to clean, past
where five rounds gave up.

Drill (`test/unit/processTreeSweep.test.ts`, real processes): an aborted
signal leaves a live child alone and logs words naming it; a live signal
still signals an exited leader's POSIX group. Red: a disabled check kills
the child despite the abort (vitest exit 1, only the stop test fails).
Green: all four pass (exit 0). The Windows round loop shares the checks;
hosted CI's Windows leg is the real-run proof for that path.

## 3. VISIBILITY_TIMEOUT_MS is gone

The registry-visibility poll waits until every artifact is visible, an
integrity mismatch rejects, or the release's own stop fires
(`scripts/publish-registry.mjs`). Every round says what is still pending and
how long the wait has run. The stop is the publish job's own
timeout-minutes (60/60/40 in `release.yml`), or Ctrl-C on a local run.
`docs/RELEASING.md` and the workflow comments name the wait. `pollVisible`
and `pollAllVisible` take an injectable stop; `publishRegistry` is a thin
adapter over the one loop.

Drill (`test/unit/publishRegistry.test.mjs`): a registry invisible for 45
minutes resolves visible; one stop across artifacts pends all; every round
names exactly the still-pending labels; a mismatch still rejects at once.
Red: a restored 30-minute break fails only the past-budget test (vitest
exit 1). Green: all six pass (exit 0).

## 4. GIT_WORKTREE_TIMEOUT_MS is gone

- The session board's metadata reads wait for git's answer
  (`src/host/sessionBoard.ts`), like every other unnamed git call; stale
  reads are still dropped by generation.
- The forced worktree remove waits like the unforced one (`Infinity`).
- The held checkout's listing waits like its batch (`timeoutMs: undefined`).
- The native checkout's git runs, listing and batch child wait for git until
  Cancel or shutdown stops them; the batch child's own deadline option goes
  with it (`src/runtime/panel/pullRequests/checkout.ts`). Cancel already
  SIGKILLs the tree, so a root that ignores its signal still ends the
  checkout. The git process port's `timeout` is now a caller's own deadline,
  absent by default.

Drill (`test/unit/nativeCheckout.test.ts`, a real batch child): a child
slower than any bound runs its 300 ms course and completes. Red: a restored
50 ms deadline fails it (vitest exit 1). Green: the batch tests pass
(exit 0).

## Proof

- Red/green drills for all four removals, observed on this rig (above).
- Schedule suites: all 30 `*schedul*` unit files green (schedules.test.ts,
  scheduleBackgroundReconcile, fileScheduleMigration, scheduleConsent,
  scheduleDeliveryWithdrawal, schedulePaidConsent and the rest at the
  repository timeout; playbookSchedulesInputs 22/22 and scheduleFireFailures
  8/8 at a raised exploratory timeout on the loaded rig — see rig note).
- MCP suites: mcpServers, mcpOffer, mcpParse, mcpOAuthDenied, mcpJobRetire,
  processTreeSweep, pathGuardSpawns, teamWorkerCreate, privateDirectory,
  windowsRecorderDeps, toolIo, teamWorkerToolIo green; pluginTreeKill and
  windowsScreenRecorderNative skip on macOS (platform-gated).
- Git suites: nativeCheckout, sessionBoard, worktreeCommands,
  heldCheckoutCore, worktrees, bestOfNWorktreeFailed, worktreeConversations
  green. publishRegistry 6/6 green.
- No-limits gates: check:no-round-cap, check:no-output-continuation-cap
  green; check:usable-reply green.
- Static gates: prettier, eslint --max-warnings 0 (all touched files), all
  five tsc projects, knip (exit 0), dpdm (no cycles), jscpd (0 clones),
  catch inventory (baseline regenerated: twelve sites moved by these edits,
  counts unchanged), l10n, bundle-split, lazy-registry, host-globals green.
- Build: `npm run build` fails on two size budgets, byte-identical at base
  (measured: base build fails the same two, plus vaultActions which passes
  here): dist/modelApi.js 527.7 KiB vs 525, dist/resourceAdmission.js
  25.0 KiB vs 25. None of this lane's code is in either bundle
  (eitherSignal 0× in modelApi.js). Pre-existing, named for the lead.

## Rig note (macmini, load 21–33, shared)

Store suites are fsync-heavy: one `create`/`admit` measured 0.9–2.5 s on
this rig, identical on base (shared-clone timing probe: base create
2491 ms / admit 1764 ms; changed tree 937 ms / 1496 ms — no regression).
Two playbookSchedulesInputs tests and six scheduleFireFailures tests exceed
the 5 s repository timeout here and pass with a raised exploratory timeout;
the final word belongs to hosted CI on a quiet runner. `treeSyncNoDeadline`
(2 tests) cannot run in this sandbox: spawning `/bin/ps` answers EPERM
(`runTreeSync` reads the real process table through it). Untouched by this
lane; the lead runs it outside the sandbox.
