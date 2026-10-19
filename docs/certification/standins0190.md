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
