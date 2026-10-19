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
