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

---

# Stand-ins 0190, lane C: the last stand-ins in the 0.19.0 tests

Worktree `/home/randy/lanes/STANDINS3C`, branch `fix/0190-standins3c`.
Base `47ead851cf` (STANDINS3B's two landed rewrites). All suites below ran
with the repository's own timeout, `--maxWorkers=3`, on Linux.

## What sent SIGKILL to STANDINS3B

STANDINS3B's process died with exit 137 (SIGKILL), machine memory fine,
while running its unfinished rewrite of `test/unit/macRss.test.ts`, case
"refuses a child that never started" (spawn of a missing program, sampler
called with `process.pid`). That rewrite is lost; what follows is audited
fact plus one reconstructed link, marked as such.

Audited, all read in full:

- `src/core/media/macRss.ts` never signals any process. It only spawns
  `/bin/ps` reads through the `run` dep and parses them.
- `src/core/resources/trees/run.ts` (`boundedTreeProgram`) runs `execFile`
  with a timeout that kills only its own ps child.
- `src/core/resources/trees/actions.ts` (`signalVerifiedPosix`) refuses
  before any send when the target is this process, not a positive
  safe integer, or unregistered, then re-verifies identity and liveness.
- `src/core/resources/trees/linux.ts` signals only cgroup members after
  the harness excludes itself (`cgroupPids` throws on harness membership;
  per-pid membership is re-checked). `posix.ts` and `registry.ts` refuse
  self-rooted tickets and filter this process's rows out of every table.
- No product path reachable from the macRss test can signal the runner:
  the sampler takes no PID to signal at all.

Probed on this rig: spawning a missing program reports `ENOENT` on
`error` followed by `close` with code -2 and `exitCode` -2
(`node -e` probe, 2026-10-19). The committed file's cleanup skips such
children (`exitCode !== null`).

Reconstructed (the rewrite is lost, so this link is inference, not
observation): the lost case paired a missing-program spawn with an await
a never-started child can never satisfy — the `liveChild` pattern it was
modeled on awaits a `ready` stdout line, and the sibling patterns await
`spawn`. That await never resolves, the suite hangs, and the rig harness
reaps the hung process with SIGKILL: exit 137 with memory fine. No other
mechanism fits all three facts (exit 137, memory fine, missing-program
spawn in flight).

Fix, in `test/unit/macRss.test.ts`: every spawn is tracked from birth
(close waiter and error listener attach synchronously, before any await);
the `afterEach` signals only a live owned child
(`exitCode === null && signalCode === null`) and awaits only waits that
always settle (`close` fires for failed starts too). The committed
never-started test awaits only `error`/`close`, asserts `ENOENT`,
`exitCode -2`, `pid undefined` and zero ps calls. The suite ran green
five times consecutively plus three break runs: no hang, no stray signal.

Observation, not changed (out of lane scope): `sweepExitedTree`
(`src/host/processTree.ts`) group-kills any defined PID with only an
`undefined` guard. No test in this lane reaches it; noted for the lead.

## macRss.test.ts — commit 306aba7d85

- Stand-in: `fakeChild` (hand-built encoder handle) and `recordingRun` /
  scripted `run` bodies answering canned ps text.
- Real code now: real spawned Node children; the production
  `boundedTreeProgram` runner at absolute `/bin/ps`; `parseMacProcessTable`
  fed literal row strings (a parser fed text is not a stand-in);
  `readMacProcess` fed literal text for shape cases plus the real runner
  for a real ps failure (PID past pid_max); timing through the product's
  own `now` port; call counting and in-flight holding through wrappers
  that forward to the real runner.
- Live-child cases kept for the sampler: absolute-ps argv assertion,
  non-child PID refusal without ps, foreign-process refusal with a real
  ppid row, never-started refusal, already-exited refusal, failure
  finality (real parent-mismatch refusal), exit-drops-reading,
  run-finishes-after-exit (gated real ps, deterministic), interval
  coalescing with real RSS growth (+8 MiB child), max-age wait and late
  refusal.
- Coverage now at parser level only, by construction: reused-PID start
  mismatch (two live reads can never disagree for one live child), zero
  RSS (live RSS is never 0), zombie rows. Each is half of a comparison
  the sampler performs verbatim on parser output.
- Break: `found.row.parent !== parentPid` flipped to `===` in
  `src/core/media/macRss.ts`. Result: 6 failed, 23 passed, e.g.
  `FAIL reads its live child through the absolute /bin/ps ... Error: The
encoder memory reading is unavailable ❯ src/core/media/macRss.ts:121`.
  Reverted; suite 29/29 green.
- Gates: prettier clean, eslint zero warnings, typecheck has no error in
  this file (27 pre-existing errors elsewhere, all in untouched files).

## privateRootLease.test.ts — commit 3ae5eae3a9

- Stand-in: `fakeLinux` (scripted `/proc`, machine-id, boot id,
  namespace) plus invented PIDs and start ticks.
- Real code now: default production `linuxFiles` against the real
  `/proc` — a reaped crash (line captured live, entry gone at sweep),
  two live sleepers with provably different start ticks (100 ms apart,
  premise asserted), a corrupt lease file (real line plus trailing
  garbage). The restart opens the root in a real new process through the
  same bundled lease code instead of `vi.resetModules` (no `vi.*`
  remains). `goneLease` now waits for reap so the reading is gone.
- Dropped, honestly untestable on one box (single boot, machine,
  namespace; scope files unreadable without root): earlier-boot,
  other-machine and other-namespace keeps, and the three
  unreadable-scope cases. The product code is unchanged; the lead owns
  the real proof (second boot / machine / namespace).
- Break: `!== start` flipped to `=== start` in `isLinuxOwnerGone`
  (`src/runtime/privateRootLease.ts`). Result: `× reclaims only owners
proven gone ... AssertionError: expected { exited: true, reused: true,
…(2) } to deeply equal { exited: false, reused: false, …(2) }`.
  Reverted.
- Suite: 3 passed; 2 failed identically on base and rewrite
  (`removes a gone owner's folder…`, `keeps a live window's copy…`):
  `openPrivateRoot` refuses because `/` and `/home` on this rig are
  owned by uid 65534 (mapped container root), failing the ancestor
  owner check. Base measured at 2 failed / 6 passed; rewrite at
  2 failed / 3 passed. The lead must run those two where `/` is uid 0.
- Gates: prettier clean, eslint zero warnings.

## credentialLease.test.ts — commit a7f79fbead

- Stand-in: local `mapSecrets` (a Map directly behind the SecretStore
  port, bypassing all store logic).
- Real code now: the runtime's real `keyringSecretStore` (parts,
  reclaim, per-account named locks over real loopback sockets), with the
  map only behind the native entry factory — the seam the store file
  itself sanctions for tests (`src/runtime/keyStore.ts`: "the tests run
  against a map"). Lock scopes are per-test UUIDs. Nothing here needs VS
  Code SecretStorage (the guard takes any SecretStore; the editor passes
  its object directly with no adapter of ours), so nothing moves to
  `test/integration`.
- Kept meanings: write-inside-lease round trip with no lock residue;
  busy-lease refusal carrying the retry sentence with the store
  untouched; release then success.
- Break: rethrow the raw `CredentialLockBusyError` instead of mapping it
  in `src/host/models/credentialLeaseSecrets.ts`. Result: `× refuses a
panel write while a Connect transaction holds the lease; Expected:
"Another provider change is in progress. Try again when it finishes."
Received: "credential lock busy: .../providers.json.lock"`. Reverted.
- Suite: 9/9 green. Neighbours: `keyStore.test.ts` 2/2 green,
  `keyringParts.test.ts` skipped (Windows-only native store, honest
  platform gate).
- Gates: prettier clean, eslint zero warnings.

## vault/brokerSocketDirectory.test.ts — unchanged

`fakeHome()` is `path.join(root.directory, 'home')`: a real temp path
under the suite's real `mkdtemp` root, never the real home. Left as is.

Pre-existing, environmental, on the untouched file (9 passed,
3 failed, 2 skipped): this rig's deep lane `TMPDIR`
(`.../resource-created/trees/muse-tree-…`, ~120 chars) exceeds the
107-byte `sockaddr_un` limit, so the socket-length guard refuses three
tests and the bind probe (same over-long path) honestly skips the two
bind cases. The lead must run this file where TMPDIR is short.

## Helpers

Nothing to delete: `localStubs.ts` is already gone with no references;
`fakeChild`, `fakeLinux` and the local `mapSecrets` were file-local and
died with their rewrites (zero references repo-wide); shared
`test/unit/helpers/mapSecrets.ts` still serves `chatGptHost` /
`authCommands` (not this lane); `test/unit/helpers/keyring.ts`
`memoryKeyring` still serves the vault area (not this lane; this lane
only reuses it unmodified).

## Sandbox

Nothing blocked: real `/bin/ps`, real spawns and kills of owned
children, and real Unix-socket binds (named locks) all worked here.

---

# Stand-ins 0190, lane D: the two files that fell short

Worktree `/home/randy/lanes/STANDINS3D`, branch `fix/0190-standins3d`.
Base `51b8359f02` (lane C's record). All suites below ran with the
repository's own timeout, `--maxWorkers=3`, on Linux.

## credentialLease.test.ts — commit 12ff9dcd51

- Stand-in: `memoryKeyring()` (`test/unit/helpers/keyring.ts`), a Map
  behind the native keyring entry factory, under the real
  `keyringSecretStore`.
- Real code now: the product's own native entry (`AsyncEntry` from
  `@napi-rs/keyring`) on a throwaway service
  (`<KEYRING_SERVICE>.test.<uuid>`) with a per-test lock scope, swept
  afterwards — the `keyringParts.test.ts` pattern. Every assertion keeps
  its meaning: write-inside-lease round trip with no lock residue;
  busy-lease refusal carrying the retry sentence with the store
  untouched; release then success.
- Real OS keyring is the only store outside VS Code, and CI's Ubuntu
  legs have none: no Secret Service is set up there (only `hosts.yml`
  starts one, for the ACP host check), and the repo's real-keyring
  suites are Windows-only for the same reason ("native qualification",
  `keyringParts.test.ts`, `keystoreOwner.test.ts`). So the guard block
  is `runIf(win32)` like those suites. Nothing moves to
  `test/integration`: the guard is store-agnostic and the panel passes
  SecretStorage, which no integration test can obtain (no
  ExtensionContext). The two guard cases prove on Windows CI (full
  tier); on Linux they skip. Lead: run
  `npx vitest run test/unit/credentialLease.test.ts` on Windows and
  confirm 9/9 (7 lease + 2 guard), plus the guard break below.
- Vault fixture: `sessionBrokerChild.ts` drops its `memoryKeyring`
  override and calls `createVaultBrokerBindings(context)` — the
  product's own resolution (real OS store where the binding resolves,
  the keyring-less fallback where it does not), per the area-B
  NOSTANDINKEY rewrite. `test/unit/helpers/keyring.ts` deleted with
  zero remaining references repo-wide.
- Break (lease group, shown on Linux): `isProcessAlive(observed.pid)`
  negated in `acquireCredentialLock`
  (`src/core/credentialLease.ts`). Result: 3 failed, 4 passed,
  2 skipped — `× reclaims a crashed owner instead of wedging`,
  `× lets exactly one of two contenders take a crashed lock, keeping
the winner`, `× reclaims a crashed CLI lock instead of wedging every
later command`. Reverted; suite 7 passed / 2 skipped.
- Prescribed guard-group break for Windows (not runnable on this rig):
  rethrow the raw `CredentialLockBusyError` instead of mapping it in
  `src/host/models/credentialLeaseSecrets.ts`; expect `× refuses a
panel write while a Connect transaction holds the lease` with
  `Received: "credential lock busy: ..."` (lane C showed this mapping
  fire on the old store).
- Suite neighbours: `brokerSession.test.ts` fails 4/4 here with test
  timeouts, IDENTICAL on the untouched base (files swapped back in
  place, no stash: same 4 timeouts at readiness). Environmental, not
  this lane: the fixture brokers never announce here. Probable common
  cause is the rig's mapped-root `/` (uid 65534), which already breaks
  the private-root owner check below; the vault enforces the same
  ancestor ownership.
- Gates: prettier clean, eslint zero warnings on touched files,
  `typecheck:unit` has no error in touched files (27 pre-existing
  errors elsewhere, unchanged — the same count lane C recorded).

## privateRootLease.test.ts — commit 8b7b63feac

- Stand-in residue: the rewrite dropped the earlier-boot,
  other-machine and other-namespace cases and the three
  unreadable-scope cases with the fake `/proc`.
- Correction to the lane notes (brief and lane-C record say "kept"):
  an earlier boot is RECLAIMED, not kept. The product code
  (`boot !== scope[1]` → gone: that boot is over, its PIDs cannot be
  alive) and the dropped case agreed (`earlierBoot: false`, removed).
  Other-machine and other-namespace leases are kept (cannot be judged
  here). This lane restores exactly that.
- Real code now: the owner decision is the pure product export
  `isLinuxLeaseOwnerGone(owner, scope, pidStart)` over the parsed
  `LinuxLeaseOwner` (`parseLinuxLease`), and the async probe calls it
  with the same truth table and the same `/proc` read short-circuit
  (no read for another machine or namespace; none needed for an
  earlier boot). Behaviour unchanged: the pre-existing real-`/proc`
  rules test passes unmodified against the refactored product.
- Coverage restored, no stand-in anywhere:
  - literal identities on every platform (7 tests): earlier boot
    reclaimed, other machine and namespace kept, exited and reused
    PIDs reclaimed, live owner kept, well-formed line parsed and
    trailing-garbage line naming no owner;
  - end to end on Linux through the real sweep with literal lease
    lines on the real scope (live PID and start throughout, so only
    the identity decides): another machine's and namespace's folders
    kept, an earlier boot's reclaimed;
  - unreadable scope for each of the three files through the real
    refusal: a `LinuxProcess` that forwards to the true filesystem
    except the scope path, which hits a real chmod-0 file (reads) or
    an empty chmod-0 directory (namespace link). The kernel's own
    refusal — no lease taken, nothing removed, reclaimable folder
    stays. (The product takes a reader, not paths, so this is the
    "otherwise through the same pure function" branch made
    end-to-end: the only answered reads are the real fs ones.)
- Break, owner-decision group: `pidStart !== owner.start` flipped to
  `===` in `isLinuxLeaseOwnerGone`. Result: 7 failed, 9 passed, e.g.
  `FAIL ... reclaims an exited PID — AssertionError: expected false
to be true // Object.is equality`. The flip also blinds the
  self-probe, so the sweep never runs and the keeps/reclaim end-to-end
  fails too. Reverted.
- Break, scope-refusal group: the outer catch in `leasePrivateRoot`
  rethrows instead of refusing (`} catch (error) { throw error }`).
  Result: exactly the 3 unreadable-scope tests fail, everything else
  passes, e.g. `FAIL ... when /etc/machine-id cannot be read —
Error: EACCES: permission denied, open '.../denied/scope' ❯
linuxScope src/runtime/privateRootLease.ts:155` — the real kernel
  refusal surfacing. Reverted.
- Suite: 14 passed; the same 2 fail as on base (`/` owned by uid
  65534, lane C's record): `removes a gone owner's folder…`, `keeps
a live window's copy…`. The lead runs those two where `/` is uid 0.
- Gates: prettier clean, eslint zero warnings on touched files,
  `typecheck:unit` has no error in touched files (same 27
  pre-existing elsewhere).

## Helpers deleted

- `test/unit/helpers/keyring.ts` (`memoryKeyring`): deleted; zero
  references repo-wide after the two rewrites above (verified by
  grep). Vault-area files that needed more than the override drop
  (native helper builds, governor wiring) stay area B's join work;
  the broker fixture child change here is only the override removal,
  which is behaviour-neutral for the session tests (they perform no
  secret-store operations).

## Sandbox / rig notes

- `/var/tmp/l-STANDINS3D` is read-only on this machine (only
  `node-compile-cache` inside); temp clones could not go there. Base
  comparison for `brokerSession.test.ts` was done by swapping the two
  original files back in place from `HEAD` and restoring afterwards —
  no stash, no second worktree.
- No sub-agents used. No credentials printed, stored, or probed: the
  OS keyring was never touched from a shell (the repo's own
  Windows-only gates are the evidence CI's Ubuntu legs have no usable
  Secret Service).

---

# Stand-ins 0190, lane GRVFIXB1: the Grok review's ToolIo answers

Worktree `/home/randy/lanes/GRVFIXB1`, branch `fix/0190-grvfixb1`.
Base `82bc057107` (the join's area C). All unit suites below ran with
the repository's own timeout (`--maxWorkers=3`, one file per run; a
two-file run on the busy rig timed out only the 12 MB fixture test at
the repo's 5 s, green alone at 1225 ms), on Linux.

## The finding

A Grok review of the 0.19.0 join found hand-written `ToolIo` objects
with `hasUnsavedChanges: () => false` in
`test/unit/toolResultsRideWhole.test.ts:57` and
`test/unit/noLimitsInput.test.ts:169-186` — an answer standing in for
the editor API (a dirty buffer would never refuse). A sweep of the rest
of `test/` found the same answer in three more unit files (plus one
`unsavedFiles: () => []` in `test/integration/codeIntel.test.ts`).

## The cause

Nothing in a headless unit process holds an editor buffer, so the
suites answered the editor's question by hand. The product already has
the real answer for exactly that context: the standalone runtime's own
`createToolIo` wiring in `src/runtime/backends.ts` (`unsavedFiles:
() => []` — "the agent cannot see the editor's buffers (D62)"), whose
`hasUnsavedChanges` compares through the product's `isSamePath`. The
dirty-true half of the check exists only inside VS Code, so it moves
to `test/integration`, which runs in a real VS Code in CI.

## The fix

- New shared helper `test/unit/helpers/headlessToolIo.ts`: the
  standalone runtime's own `createToolIo` wiring (empty unsaved list,
  the real `walkFiles` lister) for headless suites.
- `toolResultsRideWhole.test.ts`: the hand-built `memoryTools()` is
  gone; the memory port is built over the helper. Every behaviour
  kept (6/6).
- `noLimitsInput.test.ts`: the hand-built `ToolIo` (with its
  `unusedIo` rejects) is gone; edit sources are eleven real PNG files
  in a real temp workspace read through the helper, with reads counted
  by a forwarding wrapper (observation, not a stand-in). Every
  behaviour kept (16/16).
- `modelapiMalformedInputs.test.ts`: the hand-built memory port is
  the helper now (17/17).
- `memoryIo.test.ts`: `fileTools` keeps its real disk reads and the
  product's atomic writes and canonical paths, with the unsaved answer
  through the helper; the dirty-true forwarding row is replaced by a
  not-dirty row, and the true answer moves to integration (9/9).
- `editReviewResolve.test.ts`: all three file/editor answers are the
  product's own (`canonicalPath`, the helper's `readFile` and
  `hasUnsavedChanges`); the unresolvable file is now a real symlink
  loop in a temp workspace, which the product's own `canonicalPath`
  refuses — the panel's fixed words and the kind-only log read as
  before (1/1).
- `test/integration/codeIntel.test.ts`: `unsavedFiles: () => []`
  becomes the real VS Code dirty-document query, the product's own
  wiring from `src/extension.ts`.
- New `test/integration/unsavedRefusal.test.ts`: a real document is
  dirtied in the editor; the product's own ToolIo (wired as
  `src/extension.ts` wires it) reports it unsaved, and the memory
  store refuses the append and the edit over it; saving clears both.

No product file changes: `git status` shows only test files.

## Breaks (each reverted; product tree identical afterwards)

- `memoryStore.ts` `truncated: ... < ...` flipped to `>` →
  `toolResultsRideWhole`: 1 failed (`... still says a later window
follows`), 5 passed.
- `imageGeneration.ts` `args.images.length > maxEditSources` flipped
  to `<` → `noLimitsInput`: 2 failed (`refuses eleven sources ...`,
  `prepares three sources whole ...`), 14 passed.
- `memoryIo.ts` forwarding negated → `memoryIo`: 4 failed
  (including `answers not-dirty from the real headless file tool`),
  rest passed.
- `editReview.ts` warn `could not resolve` changed to `could not
open` → `editReviewResolve`: 1 failed with `expected 'Edit review
could not open loop-a/mis…' to contain 'could not resolve'`.
- `memoryTools.ts` reason `'arguments are not valid JSON'` changed to
  `'arguments are not JSON'` → `modelapiMalformedInputs`: 1 failed
  (`refuses before placing any note`), 16 passed.
- Integration rows (`unsavedRefusal`, `codeIntel`) are proved by
  hosted CI: `npm run build:dev` is red on this worktree before any
  test bundle is emitted — `CHANGELOG.md` 0.19.0 notes decode to
  332265 bytes over the What's New bound of 76800
  (`scripts/lib/whatsNewContent.mjs`), on files this lane does not
  touch. Prescribed breaks for CI: point the integration adapter's
  `unsavedFiles` at `() => []` and watch the dirty-document row fail;
  negate `createMemoryIo`'s forwarding and watch the not-dirty unit
  row fail (shown above).

## Suites and gates

- `toolResultsRideWhole`: 6/6. `noLimitsInput`: 16/16. `memoryIo`:
  9/9. `modelapiMalformedInputs`: 17/17. `editReviewResolve`: 1/1 —
  each with the repository's own timeout, `--maxWorkers=3`.
- `npx tsc -p test/integration/tsconfig.json --noEmit`: clean.
  `npm run typecheck` (full): only pre-existing errors in untouched
  files (none in this lane's files); the lane's one new error while
  working (`ToolIo` imported from `toolIo.ts`, which does not export
  it) was fixed to the `core/.../tools.ts` import.
- `eslint` on all touched files: zero warnings. `prettier --check`:
  clean.
- `test/integration` run: NOT RUN on this rig — blocked by the
  pre-existing `build:dev` What's New failure above (exact error
  pasted); no gate weakened to work around it. Hosted CI runs it.

## Sandbox / rig notes

- No sub-agents, no background tasks. No credentials seen: no paid or
  live model calls, no key or token printed, logged or passed anywhere.
- Scratch lived in the worktree's gitignored `temp/` (one probe,
  removed) and lane-temp folders cleaned by the suites' own
  `afterAll` handlers. No `/tmp` writes.
