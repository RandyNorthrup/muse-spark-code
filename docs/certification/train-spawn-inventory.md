# Train spawn inventory (lane SPAWNM123)

**Round 1 below is historical and superseded by Round 2. Its dispatch-order
trade-off was rejected; its inventory and verification claims do not certify
the repaired tree.**

The train's full unit run had one open red: `spawnInventory` scanned 116
process launch sites while `docs/certification/spawn-inventory.json`
listed 103. The 13 unlisted sites all came with the Git and pull-request
native route (branch int/m123, commit 803f42f95); none is stale.

## Resolution

- `src/runtime/panel/git/service.ts` (8 sites: 1 import, 7 `this.spawn`
  wrapper calls) moved behind the governed launcher. The raw
  `node:child_process` import is gone; the wrapper is renamed `runGit`
  (it never launched a process itself); reads (`status`, `diff`,
  `rev-parse`, `config`, `remote`) call `execResourceFile('probe', …)`,
  writes (`add`, `commit`, `push`, `fetch`, `worktree`) call
  `execResourceFile('contained', …)`. Same arguments, working directory,
  environment rules, output caps (`GIT_OUTPUT_MAX_BYTES`) and deadline
  (`GIT_TIMEOUT_MS`, now covering admission and run together, so a
  throttled launch reports as a timeout, never a hang). Non-zero exits
  stay `GitExitError` (the push terminal offer depends on it); Cancel
  stays silent (`closed`); a launch the governor would not run is the new
  refusal word `busy`, shown as `UI_TEXT.gitMachineBusy` (all 14 tables).
- `src/runtime/panel/pullRequests/checkout.ts` (3 sites) moved behind the
  governed launcher. `run()` dispatches on an explicit `writes` flag
  (`contained` for fetch, index and worktree writes; `probe` for version,
  config, rev-parse and listings) with the same environment, deadline and
  output cap; an overfull listing still refuses as too large
  (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, detected from the launcher's
  capped stdout). `start()` runs the `cat-file --batch` child through
  `spawnResourceFile('probe', …)` (the governor owns the tree on every
  platform, as the old detached group did); it is now asynchronous and
  `GitProcessPort.start` returns the child or its promise. A refused run
  or start throws `PullRequestServiceError(UI_TEXT.gitMachineBusy)`.
  Cancel stays Cancel: the port throws the signal's reason before and
  after the launch, so abort-shaped errors keep their shape.
- `src/core/locks/processOwner.ts` (2 sites) stays a direct launch and is
  listed as a considered exemption: a liveness probe must not be throttled
  or paused by the governor, or a lock decision would wait on the very
  pressure it may be resolving. Confirmed as required: no shell option,
  fixed programs (`/bin/ps`, the system `powershell.exe`) with fixed
  flags, the caller pid digits-only (safe-integer > 0 validated before
  use), a 10 s timeout, and single-record output under `execFile`'s
  default cap. This lane changed nothing else in that file: another lane
  is editing it today, so the join must re-check the call indices if that
  lane adds `execFile` calls.
- Shared helper `isGovernedRefusal` in `src/core/resources/launch.ts`
  (paused, cap-refused, memory-limited, admission-unavailable,
  launch-unavailable; typed refusals matched structurally across the
  bundle boundary).

After the change the scan finds 111 sites (116 − 10 dissolved raw and
wrapper sites + 5 governed call sites) and the inventory lists 111: zero
unlisted, zero stale.

## Proof

- `spawnInventory` green (5/5) at the repository's default timeout.
- Red drill: removing
  `src/runtime/panel/git/service.ts#call:execResourceFile:1` fails with
  that site named; a scratch file with a raw `spawn` fails with both its
  sites named; both restored byte-exact (sha256 verified).
- Break checks: swapping the probe/contained literals fails the two
  routing tests per file; restored.
- New tests (launcher spies, never `child_process`): service reads take
  probe with the hosted git; commit takes contained for add/commit and
  probe for the reads; a refused launch is `busy`; a non-zero exit stays
  `GitExitError`; the panel notices a refusal as `gitMachineBusy`; the
  checkout fetch takes contained with the user environment; reads take
  probe; the batch starts through probe with piped streams; a refused
  fetch throws `gitMachineBusy`. One existing test updated to the new
  shape (missing host git rejects `Governed command unavailable`, with the
  spy proving the pinned path was attempted, never a PATH search); the
  dispatch-gate guard test now pins zero raw launches, the three governed
  calls and the gate-first order.
- Suites green at the default timeout: nativeGitService 32/32,
  nativeGitAdapter + nativeGitSpawn + nativeGitPipeline 65 passed
  1 skipped, runtimePullRequestCheckout 73/73, nativeGitCore +
  pullRequestCheckoutGit + heldCheckoutCore 47/47, runtimePullRequests +
  runtimePullRequestRecords + heldCheckout 57/57,
  runtimePullRequestInterleavings 17/17, conversationGit 91/91,
  shellJob + launch + spawnGovernance 35 passed 5 skipped.
- Fixture honesty note: the checkout fixture tests inject an ungoverned
  real-git double (`directGitProcesses`, node error shapes preserved).
  Running them through a real governor on this shared rig refused and
  stalled (16 failures: admission-unavailable, admission-cancelled,
  group-kill timing, 5 s timeouts). The governed routing is pinned by the
  port tests with real git behind the spy; admission is the governor
  suites' subject.
- Dependents rule (`vitest related` over the four changed source files,
  repository default timeout): 324 files, 8115 tests — 7825 passed,
  188 skipped, 102 failed across 17 files, all outside this change's
  area and all environmental: vault socket suites fail with `listen
EPERM` (this sandbox blocks Unix-socket listen; confirmed in isolation),
  the MCP streamable-HTTP test needs loopback it cannot have, and the
  rest (ChatGPT adapters, voice, browser checks, model matrices) are
  5 s timeouts under the run's 324-worker oversubscription (the one
  re-checked in isolation, `execResources`, passes 6/6). Every suite
  covering the changed files passed in that run, including
  `spawnInventory`, all nativeGit*, runtimePullRequest*,
  pullRequestCheckoutGit, heldCheckout*, conversationGit, shellJob,
  launch, spawnGovernance, spawnProfiles, spawnBoundaries and
  spawnRuntimeAdmission.
- Open trade-off (lead decision 1 as ordered): on the production default
  paths the trust/root/seal recheck now runs before governor admission
  rather than synchronously between admission and spawn — the launcher
  offers no hook there. The injected-runner suites still pin the old
  order; a launcher gate hook would restore it as follow-up.

## Sweep: the other raw spawn/exec sites in src/runtime and src/host

Every runtime site except the two moved files already routes through
`spawnResourceProcess`, `execResourceFile` or `handoffResourceFile`.
The remaining raw sites, each read:

- `host/git.ts` (5 execFile, 1 spawn): the shared admitted runner —
  `admitResource` per call, `observeResourceProcess` tree, Windows job.
- `host/git/untrustedGit.ts` (2 execFile): calls on the injected
  `GitExecFile` port, i.e. the runner above.
- `host/processTree.ts` (execFile, spawnSync): the containment
  infrastructure itself (POSIX supervisor, credential-free probes).
- `host/resources/resourceJobHolder.ts` (spawn): the native job holder
  infrastructure itself.
- `host/backend/mcpJobLaunch.ts` (2 spawn): the attested Windows
  launcher infrastructure itself, with governed tree stop.
- `host/backend/mcpProcess.ts` (spawn): via the attested launcher with
  admission, observation and tree stop.
- `host/backend/mcpServers.ts` (spawn): admits (`mcpServer`), then
  delegates to the injected builder's spawn.
- `host/backend/mcpVault.ts` (spawn): admits (`mcpServer`) around the
  vault child.
- `host/backend/museCodeBackendManager.ts` (spawn): admits
  (`museServe`) around the server child.
- `host/backend/toolIo.ts` (spawn): admits and observes the tool child.
- `host/browser/browserProcess.ts` (execFile, spawn): observed browser
  child, launched via the attested job path.
- `host/team/acpProcess.ts` (spawn): delegates to lane K's admitted
  team launcher (`input.launcher.spawn`).
- `host/voice/voiceProcesses.ts` (spawn): admits the voice child.
- `host/team/processLifetime.ts` (spawn, execFile, test-only ×2):
  reachable only from tests, proved by the inventory's own guard test.
- `host/web/pageConverter.ts` (worker): a worker thread on the fixed
  bundled converter, not a process.
- `core/resources/*` (spawn, execFile, spawnSync, embedded,
  worker): the launcher, admission, sampler and governor
  implementation itself.

No other site needed moving.

## Bundles (production build, caps unchanged)

- `dist/extension.js`: 571429 bytes (558.0 KiB, cap 600 KiB).
- `dist/acp.js`: 241039 bytes.
- `dist/conversationGit.js`: 130872 bytes (carries the new string).
- No `MODEL_TEXT` block added; the launcher shim stays lazily loaded.
  The build's 5 bundle-split problems name only `modelPolicy.ts` and
  `priceCard.ts`, untouched here — pre-existing.

## Gates

Typecheck all five projects, eslint and prettier on changed files, knip
(clean), cycles (none), duplication (zero), `check:host-api`
(regenerated: `node:child_process` importers 30 → 29), `check:l10n`
(14 tables, 0 problems).

## Round 2 — restore the M123 protocol (2026-10-11, Kubuntu)

Round 1 checked trust, root identity, lock and seal before awaiting resource
admission and Windows preparation. That wait invalidated the final check;
the Windows GO recheck was lost, and the pinned synchronous-dispatch test
was replaced. This is a correctness defect, not an accepted trade-off.

The first repair restores service.ts to d4b06c62b byte for byte except the
non-launch wrapper rename (`spawn` → `runGit`). Checkout and both owning
suites are restored byte for byte, including “starts git in exactly two
places, each right after its gate”. The shared runner again admits and
prepares the Windows job before `beforeRun`, and checks again at GO.
The checkout admission repair follows in a separate commit.

Restoration verification at repository deadlines: nativeGitService 28/28,
runtimePullRequestCheckout 69/69; nativeGitAdapter and nativeGitSpawn 44
passed, 1 platform skip. The initial adapter run loaded the removed round-1
spy before restoration and failed that obsolete assertion; the restored
file's complete replay passes. Hook path is `.husky/_`, installed unchanged.

### Final routing and original thirteen sites

The service uses the original `createGitProcess` wiring and all original
`beforeRun` checks, unchanged except for the local wrapper rename. Its
import is listed as contained: admitted by the shared git runner: admission,
Windows job, then the caller's gate and the spawn in one synchronous turn
(M123 lock protocol). No service read/profile replacement remains.

Checkout's `runGit` and `startGitBatch` still synchronously call the gate
and return their port call. They also pass that exact gate as `beforeSpawn`.
The governed launcher checks it after admission and Windows preparation,
immediately before spawn, and again through the existing READY/GO
`authorize` callback. A GO refusal is preserved through command settlement.
The batch wrapper itself remains synchronous; its returned launch promise
is awaited by the stream consumer because admission must precede launch.
No await can occur between the final hook and actual process start.

Probes require complete checked arguments: version, the explicit config
name listing or `--get`, `remote -v`, the FETCH_HEAD commit read, a bounded
SHA-qualified tree listing, or `cat-file --batch`. Known untrusted-control
prefixes and disabling named-hook overrides are recognized explicitly;
any other form, including writing config/remote arguments, is contained.
Launcher unavailability has typed `ResourceUnavailableError` codes;
message text is never used to identify a refusal. Overfull command output
retains Node's max-buffer code so checkout's size refusal stays reachable.

| Original site                                                | Final state                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `src/runtime/panel/git/service.ts#import:1`                  | listed as admitted by the shared runner (contained)                        |
| `src/runtime/panel/git/service.ts#call:spawn:1`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/git/service.ts#call:spawn:2`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/git/service.ts#call:spawn:3`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/git/service.ts#call:spawn:4`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/git/service.ts#call:spawn:5`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/git/service.ts#call:spawn:6`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/git/service.ts#call:spawn:7`              | not a launch; renamed wrapper                                              |
| `src/runtime/panel/pullRequests/checkout.ts#import:1`        | listed admitted type port; its launch paths are governed                   |
| `src/runtime/panel/pullRequests/checkout.ts#call:execFile:1` | routed with the beforeSpawn hook (probe or contained by checked arguments) |
| `src/runtime/panel/pullRequests/checkout.ts#call:spawn:1`    | routed with the beforeSpawn hook (probe or contained by checked arguments) |
| `src/core/locks/processOwner.ts#import:1`                    | listed liveness-probe exemption; source untouched                          |
| `src/core/locks/processOwner.ts#call:execFile:1`             | listed liveness-probe exemption; source untouched                          |

### Pinned test and fixtures

The restoration commit `6986ccd9c` includes the original named test byte
for byte; extracted test SHA-256 on both it and d4b06c62b:
`ab47c5c6ecef267bf9ced013b0981b11278652ac07cef9a2668104f41b7cafa6`.
Final changes to this test are limited to replacing the raw execFile/spawn
counts and raw-port syntax assertions with the governed branch counts and
hook forwarding assertions. Its name, exactly two port call sites,
synchronous gate/return assertions and exhaustive caller-gate assertions
remain. Runtime admission-wait and same-turn tests enforce what a syntax
assertion alone cannot prove, including Windows GO.

Real-Git checkout fixtures inject a synchronous port that honors
beforeSpawn; machine-pressure admission is faked only in the launcher
regressions. Additional final checks increase fixture gate counts from
7/8 to 11/12; foreign-folder preservation, removal and reservation-loss
assertions are retained. No deadlines are raised.

The first commit's installed hook also staged launcher scaffolding written
while the hook was running. Both staged and committed diffs were reread;
subsequent hooks run with no concurrent edits. The scaffolding is verified
by the complete launcher/checkout regressions and deliberate drills below.

### Round-2 red drills and default-timeout receipts

Each deliberate break below failed its complete owning suite and was
restored to the recorded SHA-256 byte for byte (script assertions compare
both the before and after bytes). No timeout override was used.

| Drill          | Repaired file SHA-256                                              | Failing regression                                      |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| inventory      | `b431848e8a5c22a7e4ae17fcd3017e43bab2f7cb7365d3fda31ce4785ad41505` | Missing shared-runner import is named by spawnInventory |
| final-hook     | `2e272262aa7c0aa1a1e7e6a74f4c0f96b8a78b741a22fa715865920ab3ea910a` | All four admission-wait state changes fail to refuse    |
| windows-go     | `2e272262aa7c0aa1a1e7e6a74f4c0f96b8a78b741a22fa715865920ab3ea910a` | Windows payload authorization is absent                 |
| read-arguments | `3f173d7a83b77efa423f42e1c7ffc069662b54dc581ec79a51fc09865cdcb735` | Complete read/write argument profiles are reversed      |
| typed-refusal  | `df6898686afe10efa3b3721a944e08c87db94965eab0d42423fc55bdb0919445` | Message-based recognition misses the typed refusal      |
| output-cap     | `2f4f5f7fd8af5fad484470a703f925ae2c9a5c8a1dd0c498476deb985bd95ba7` | Overfull command loses the max-buffer code              |

Five typechecks passed on Kubuntu at repository settings. The combined
restored replay passed the launcher and checkout suites (102 tests), but
spawnInventory's setup missed its unchanged 10-second bound at system load
40.31/35.64/26.95. Its earlier round-2 replay passed 5/5 with zero unlisted
and stale entries; a final isolated replay is required below. The initial
new cap regression exposed a persistent test spawn spy, corrected with
mockImplementationOnce; no production guard changed for that fixture fix.

### Scoped static and production build receipts (Kubuntu)

All five typechecks, changed-file ESLint, formatting, plain knip, cycles,
duplication (zero), localization (14 tables, zero problems), host API,
reference and roadmap gates pass. Production bundling and every byte cap
pass; `npm run build` exits 1 at the same five inherited bundle-split
findings recorded in Round 1: modelPolicy.ts in extension.js and priceCard.ts
in extension.js/runtimeEngine.js (two cohorts name each priceCard edge).
Neither source was changed by this lane. No cap or gate was adjusted;
this remains an integration hold, not a green production-build claim.

| Bundle                      | Exact bytes | Cap bytes |
| --------------------------- | ----------: | --------: |
| `dist/extension.js`         |      571429 |    614400 |
| `dist/modelApi.js`          |      529180 |    537600 |
| `dist/checkpointStore.js`   |       86644 |    230400 |
| `dist/acp.js`               |      241039 |    870400 |
| `dist/conversationGit.js`   |      129177 |    153600 |
| `dist/resourceProcess.js`   |       23473 |     51200 |
| `dist/resourceAdmission.js` |        3260 |     25600 |

Final owning replay on Kubuntu: spawnInventory 5/5 in isolation;
spawnProfiles + runtimePullRequestCheckout + nativeGitSpawn 115 passed,
1 existing platform skip. The six explicit owners omitted by the dependency
selector also pass: runtimePullRequests, runtimePullRequestRecords,
runtimePullRequestProcessBirth, conversationGit, heldCheckoutCore, launch.
The dependent selector includes both restored adapter/service modules and
all three changed launcher modules; it selects 324 suites. Remaining suites
are run in groups of at most three, with maxWorkers=3 and repository timeouts.
No elevated timeout or sandbox workaround was used.
