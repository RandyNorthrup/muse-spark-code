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

### Final coverage and remaining integration work

The dependency selector's actual CLI replay and subsequent three-file
batches ran 150 suites: every file passed, with no failed tests or hooks.
The pre-verified native owners and final resource replays bring selected
coverage to 160/324. The exact 164 files not run before
the lane's sixty-minute time box are in
[train-spawn-inventory-not-run.json](train-spawn-inventory-not-run.json).
This is incomplete dependent certification; it must not be represented as
ALL DEPENDENT SUITES RUN. No sandbox operation was blocked or worked around.

The final resource replays passed 59 tests, with 5 existing platform
skips: spawnProfiles, spawnGovernance, spawnBoundaries,
spawnRuntimeAdmission, shellJob, spawnBootstrap. The same-turn assertion
now runs on Windows too (using the attested helper fixture); no new
platform skip remains. All named M123 suites passed at repository defaults.

Post-hook review found Prettier undoing ESLint's required nested-ternary
parentheses; a separate failureCode local removes the conflict without
changing results. Root-only profiles retain their original conservative
spawn tracking after the final hook, so an error after actual spawn never
releases an unused lease. Piped Git's final hook/GO order stays unchanged.
A fresh unit typecheck passed after the writable fixture repair. Final
resource checks and a production rebuild were run after these refinements.
The same five inherited split findings remain; all byte caps pass.

Final exact bytes:

| Bundle                      |  Bytes |
| --------------------------- | -----: |
| `dist/extension.js`         | 571429 |
| `dist/modelApi.js`          | 529180 |
| `dist/checkpointStore.js`   |  86644 |
| `dist/acp.js`               | 241039 |
| `dist/conversationGit.js`   | 129177 |
| `dist/resourceProcess.js`   |  23446 |
| `dist/resourceAdmission.js` |   3260 |

HUB: integration run — the retained Round-1 gitMachineBusy key in
src/shared/l10n/en.ts and all fourteen translated tables remains reachable
in checkout; localization passes. The full integrated run remains lead-owned.
Service source is byte-identical to d4b06c62b after undoing only the wrapper
rename; processOwner source is byte-identical. The restored pinned test's
byte proof and all six SHA-256 restoration drills are above.

## Round 3 — RVSPAWNM123B findings 1 and 2 (2026-10-11, Kubuntu)

The launcher hook order, host Git runner and checkout gate calls are untouched.
`failureText` reconstructs execFile’s command/standard-error diagnostic from
the governed failure, preserves its exit/max-buffer code, redacts before the
existing `GIT_STDERR_MAX_CHARS` display bound, and remains the single helper
used at all thirteen checkout error boundaries. With no stderr, the governed
failure retains its fixed fallback. The base checkout did not impose a separate
display cap: execFile bounded its stderr with `maxBuffer`; ordinary diagnostics
are byte-identical, while oversized displayed diagnostics now use the existing
shared Git stderr cap after redaction. Three real failures compare the same
commands and environments against Node’s execFile (d4b06c62b’s implementation):
missing remote, taken worktree and missing ref. All compare equal.

Fixture repositories default to `nodeGitProcesses` again. Only the two cases
that count synchronous caller launches keep `directGitProcesses`, explicitly
documented at its definition. Admission is faked per process; its POSIX lease
records the actual PID and kills the owned group, tolerating only ESRCH. The
production launcher, stdout/stderr collector, exit codes and batch streams run
real git. Windows fixture setup prepares the real helper once before tests.

The earlier record’s “16 failures” was an undiagnosed aggregate, and its
original individual receipts are not retained. It is superseded by this
controlled reproduction and the complete green replay, not accepted as an
environmental exception. Removing admission setup now gives 17 failures:
four new route/diagnostic checks plus thirteen existing fixture cases. An
unconfigured governed launch fails before git or the claimed folder; higher
checkout layers consequently show version/configuration refusal, never reach
the claim/cancellation injection, or leave takeover barriers waiting until the
repository’s five-second test deadline. The group-stop fake also must kill
the actual group, rather than report success without stopping it. The sixteen
original real-Git fixture scenarios are accounted for below; no case’s deadline
or assertion is weakened.

| Existing fixture scenario          | Failure class exposed by missing setup; final repair                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cancel after first file            | Fetch refused before the file/cancel trigger; real admission and group stop reach cleanup                  |
| Writer past batch deadline         | No writer reached, barrier times out; real batch streams reach writer and bounded drain                    |
| Own pull request                   | Fetch refused; production fetch/add now succeed                                                            |
| Destination populated before claim | Git/version refused before claim; claim now rejects HeldFolderTakenError                                   |
| Worktree replaced during checkout  | Git/version refused before swap; production git reaches gate and preserves foreign folder                  |
| Foreign file dropped before add    | Add gate never reached; production add reaches gate and leaves foreign file                                |
| Reservation refused at add         | Version refusal masks reservation; real route preserves ReservationLostError                               |
| Claim refused                      | Version refusal masks claim; real route preserves ReservationLostError                                     |
| Destination already present        | Version refusal masks claim; real route preserves HeldFolderTakenError                                     |
| Failed held checkout cleanup       | Version refusal masks injected cancellation; real route removes only its own tree                          |
| Fetch/batch cancel                 | Cancellation already bypasses admission; unchanged abort assertions pass                                   |
| Held checkout byte for byte        | Fetch refused; real batch/output paths now complete byte for byte                                          |
| Every git immediately after gate   | Recording port intentionally observes caller launches; production final-hook cases remain in spawnProfiles |
| No git after gate refusal          | Recording port intentionally counts launches; refusal assertions retained                                  |
| Trust revoked during claim         | Claim never reached; production path reaches revocation and starts no later git                            |
| Delayed takeover after claim       | Claim not reached, takeover barriers time out; production route completes both windows with no orphan      |

Red drills, full suite at repository deadlines (no test filtering):

| Drill                                | Named failing regression                                                                                        | Byte-exact restore SHA-256                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Remove command/stderr reconstruction | Three `preserves execFile diagnostics for a real git failure` cases and two bounded/redacted cases (5 failures) | `8049ed36f4b07a9089e6767ffc1433970f9b22e949fcabf98fd6e2bc9f685f0b` |
| Reinstate direct fixture defaults    | `runs real fixture git through production launch, output and batch streams by default` (1 failure)              | `3c21697e094c6e21281c9a8c2550e59f860587dca00daf0d3d8c8011d11d346b` |
| Remove fixture admission setup       | 17 failures described above, including 13 existing fixture scenarios                                            | `3c21697e094c6e21281c9a8c2550e59f860587dca00daf0d3d8c8011d11d346b` |

Initial production-route replay: 79/79; extended diagnostic replay: 82/82,
including all sixteen original fixture scenarios. Unit-project typecheck passed. All deliberate mutations were restored byte for byte before any other
edit. No process helper, gate, deadline, dependency or cap was altered.

### Round 3 — remaining four findings and class sweep

`start` returns the actual piped child with its launcher outcome. Batch completion
reads that outcome before interpreting the exit or incomplete answers, preserving
the exact Windows GO refusal and reporting an enforced memory/process cap even
when the root exits zero. The same typed refusal mapping covers run, start and
settlement: busy uses existing `gitMachineBusy`, pause uses existing translated
resource status words, missing helper uses `gitResourceUnavailable`, and memory
uses `gitMemoryLimit`. Existing strings were inspected: the other unavailable
sentences describe readings, dictation or other unrelated features, and no
existing sentence describes a stopped Git tree's memory limit. The two necessary
new sentences are translated in all fourteen languages. Both process-memory
and job-memory cases are covered. No detection depends on error-message text.

Absent resource admission takes the shared Git runner's legacy direct route.
It does not catch a helper failure, pause, cap, ordinary error or cancellation
into a fallback. A small `unconfiguredGit.ts` port is necessary to keep checkout's
zero-raw-launch assertion intact; it implements only this explicit embedding
exception, with cancellation and the caller's gate immediately before each
raw call, bounded output/deadline, no shell and the POSIX batch group. Its three
import/call sites are listed as bootstrap with that reason. The dispatch test
now pins both raw counts to zero in checkout and pins the fallback's two
synchronous final gates. The existing launcher protocol/order and checkout
gate calls are untouched, including the same-turn and Windows READY/GO drills
from Round 2. `src/host/git.ts`, `src/core/resources/process.ts` and
`src/core/locks/processOwner.ts` have no diff from the reviewed head.

The two processOwner sites are bootstrap exemptions, matching their direct
liveness-probe reason. Each reason now warns that the vault lease join adds
launches through the same call site and requires rereading the argument forms
and call indices. A regression pins both profiles and that note. The inventory
and its existing combined-certification mirror are regenerated together.

Full-suite red drills (no test filtering or timeout override), SHA-256 verified
after byte-exact restoration:

| Drill              | Named regression(s) that failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Restored source SHA-256                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| batch-outcome      | 5 failures: the synchronous final spawn fence (M123) preserves the batch refusal at Windows GO: trust revoked; the synchronous final spawn fence (M123) preserves the batch refusal at Windows GO: cancelled; the synchronous final spawn fence (M123) preserves the batch refusal at Windows GO: reservation lost; the synchronous final spawn fence (M123) keeps an enforced memory in batch settlement, including exit zero; the synchronous final spawn fence (M123) keeps an enforced process cap in batch settlement, including exit zero | `bfa1945d9052dfd7b6042da27306558f4b05df8ea94edcf9ff41f86b232b6283` |
| raw-checkout       | 1 failures: the git dispatch gate (M123 lane P) starts git in exactly two places, each right after its gate                                                                                                                                                                                                                                                                                                                                                                                                                                     | `bfa1945d9052dfd7b6042da27306558f4b05df8ea94edcf9ff41f86b232b6283` |
| refusal-reason     | 2 failures: checkout profile selection and final gate reports each resource refusal honestly for run; checkout profile selection and final gate reports each resource refusal honestly for start                                                                                                                                                                                                                                                                                                                                                | `bfa1945d9052dfd7b6042da27306558f4b05df8ea94edcf9ff41f86b232b6283` |
| unconfigured-route | 1 failures: checkout profile selection and final gate uses the shared Git unconfigured-admission rule for run and batch, with the final gate                                                                                                                                                                                                                                                                                                                                                                                                    | `bfa1945d9052dfd7b6042da27306558f4b05df8ea94edcf9ff41f86b232b6283` |
| unconfigured-gate  | 2 failures: the git dispatch gate (M123 lane P) starts git in exactly two places, each right after its gate; checkout profile selection and final gate uses the shared Git unconfigured-admission rule for run and batch, with the final gate                                                                                                                                                                                                                                                                                                   | `266d1d68d95da0e54da5ff4e038e098c63a00911db6ebd03ca00941ade8b9ba0` |
| liveness-profile   | 2 failures: complete production process inventory labels direct liveness probes as bootstrap and records the vault join launches; complete production process inventory requires every source process import and launch, including aliases and embedded programs                                                                                                                                                                                                                                                                                | `f0777c575a815d4afd49bb05753bf1b92eef65015677efff1bd31c5b2381facb` |

Final pre-static replay of checkout, spawnProfiles and spawnInventory: 123/123.
Inventory: 114 sites, zero unlisted and zero stale. All seventeen M123-tagged
files and the additional Git/launcher owners were selected; the three code
dependents are checkout, interleavings and spawnProfiles. The other 26 files
passed in batches of at most three, at maxWorkers=3 and repository deadlines.
The first actual `vitest related --run` was killed with exit 137 before a
report; it is not a test result. A one-worker replay is recorded below.

Windows rig must run, at its repository defaults (no override):

```sh
npx vitest run test/unit/runtimePullRequestCheckout.test.ts test/unit/spawnProfiles.test.ts test/unit/nativeGitSpawn.test.ts --maxWorkers=3
npx vitest run test/unit/mcpJobExecutable.test.ts test/unit/spawnRuntimeAdmission.test.ts test/unit/spawnBootstrap.test.ts --maxWorkers=3
```

The simulated Windows GO/outcome cases ran on Kubuntu; actual native Windows
helper preparation and launch are qualified only by the Windows commands above.
No Windows execution is claimed here. No sandbox operation was blocked or
worked around, no installation, live/paid call, daemon, merge or push occurred.

One-worker dependent replay passed the exact three selected files: 134 tests,
no failures or skips. Together with the 26 owner files, final runtime coverage
is 29 files, 567 passed and 8 existing platform skips.

The first host typecheck exposed that ChildProcessWithoutNullStreams also
promises a narrower stdio tuple than the launch contract verifies. GitBatchChild
now uses the existing ResourcePipedProcess child type plus optional settlement;
no cast, contract widening or runtime change was introduced. The host and
webview checks passed after that type correction; the complete five-project
result and final dependent replay follow below.

Unit typing also caught the table-driven call's synchronous-or-promise return.
The test now uses Promise.resolve<unknown> before the existing settled helper,
with every refusal assertion retained and no cast or suppressed diagnostic.

### Final classification refinement and gate receipts

The typed admissionUnavailable code alone cannot prove an unconfigured
embedding: a configured governor (or its final gate) can refuse with that code.
Checkout now verifies that loadResourceWindow returns undefined before choosing
the direct route, and rechecks cancellation after that wait. A defined window
reports the existing refusal through the new translated unavailable sentence.
No wrapper replaces the caller's gate, and no launcher hook or checkout gate
call/order was changed. Both run and start cover configured admission refusal
and Cancel arriving while the availability lookup waits.

The first duplication gate exposed three clones: the outcome limit checks
copied from commands.ts and two repetitions in the new Windows batch tests.
The batch now walks its limits directly, retaining memory-before-process-cap
priority, and both Windows cases use one checkoutBatch fixture. Shared commands
and launch contracts remain untouched. No gate ignore or threshold changed.

Refined checkout/interleaving/profile replay: 136/136 at repository defaults.
Additional full-suite red drills (each restored byte for byte):

| Drill                | Failed regressions                                                                                                                                                                                              | Restore SHA-256                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| configured-admission | 2: checkout profile selection and final gate reports each resource refusal honestly for run; checkout profile selection and final gate reports each resource refusal honestly for start                         | `7ba6c190fa6ff0fdb7d29409068b7913fd6aa58c74fb94ac61d4f0a3b4901570` |
| availability-cancel  | 2: checkout profile selection and final gate keeps Cancel after the admission availability wait for run; checkout profile selection and final gate keeps Cancel after the admission availability wait for start | `7ba6c190fa6ff0fdb7d29409068b7913fd6aa58c74fb94ac61d4f0a3b4901570` |

The initial complete scoped gate batch passed localization (14 tables, zero
problems), reference, regenerated host API and its replay (zero problems),
plan, roadmap, plain knip, cycles (none), host globals and notices. ESLint's
callback rejection/type requirements and two fixture style findings were fixed
in code; the final scoped replay follows. The host API's Node child_process
importer count moves 30 → 31 solely for the explicit unconfigured helper.
The two necessary inline raw-call reasons are registered in PLAN.md §8.

HUB: integration run — src/shared/l10n/en.ts and all fourteen translated tables.
Related selection excludes these hubs per the shared rule; both suites naming
either new key (runtimePullRequestCheckout and spawnProfiles) ran in full. The
remaining code dependents and all M123/launcher owners also ran. Aggregate
quality and cross-platform integration remain lead-owned under this brief.

The rejection lint rule did not recognize Node's ExecFileException interface
as an Error. Two attempted adapters were abandoned: stringifying the non-native
branch triggered no-base-to-string, and Object.assign's inferred intersection
still triggered prefer-promise-reject-errors. The final callback retains Node's
original object with a compiler-checked Error annotation before rejection; no
adapter, cast, stringification or changed metadata remains. The complex iterable
was named before its loop and the test's void resolver uses the repository's
existing undefined-resolver form. All lint rules stay enabled.

The exit-137 interruptions were superseded by a fixture-control correction:
the simulated Windows child was constructed with Node's native, unstarted
process handle and retained its native kill method. The new batch failure path
called that method. Node's local internal/child_process implementation confirms
that kill dispatches directly to that native handle, not the fixture's pid
property. The fake now stubs kill alongside its streams/control, so simulated
stop never acts on the OS. This is a test-double correction, not a launcher or
sandbox change. The one-worker spawnProfiles replay passed 32/32, and the
actual one-worker vitest related replay then passed all three selected files,
136/136. The repeated exit-137 runs produce no test certification and are
replaced by this final successful receipt.

Current dependent and owner coverage: 29 files, 569 passed and 8 existing
platform skips; no failing, unlisted or stale case remains. Final full
npm run typecheck exited 0 across host, webview, unit, e2e and integration;
subsequent host typecheck also exited 0 after the native-error annotation.
ESLint and jscpd exited 0 on the refined code (zero clones), with a final
post-fixture ESLint replay below. Earlier red-drill hashes describe the exact
versions restored at the drill, before the subsequent compiler/style/fixture
corrections; all tested behavioral guards remain in the final implementation.

### Final production receipt (Kubuntu, 2026-10-11)

The final actual dependent replay is 136/136; the isolated inventory is 6/6,
with 114 entries, zero unlisted and zero stale. Post-fixture changed-file ESLint,
host globals and third-party notices exit 0. All five repository typechecks
exit 0; knip, cycles, reference, host API, localization, plan and roadmap passed.
Duplication is zero. No required code-dependent file is left unrun.

Final npm run build exits 1 only at the same five inherited split findings:
modelPolicy.ts in extension.js, and priceCard.ts in extension.js/runtimeEngine.js
(two cohorts report each priceCard edge). Those two sources have no diff from
the reviewed head or this round. All production byte caps pass unchanged. This
is the existing PLAN.md §7 integration hold, not a green build claim or a
residual review finding. The lead must resolve that inherited split before
release; no off-lane source or gate was changed to hide it.

| Bundle                      | Exact bytes | Cap bytes |
| --------------------------- | ----------: | --------: |
| `dist/extension.js`         |      571429 |    614400 |
| `dist/modelApi.js`          |      529180 |    537600 |
| `dist/checkpointStore.js`   |       86644 |    230400 |
| `dist/acp.js`               |      241039 |    870400 |
| `dist/conversationGit.js`   |      129177 |    153600 |
| `dist/resourceProcess.js`   |       23446 |     51200 |
| `dist/resourceAdmission.js` |        3260 |     25600 |

Production metafiles at this isolated head have no reader of checkout.ts:
M123's native route remains off here, as PLAN.md's integration record requires.
These are the actually shipped bundle measurements, not a projection of the
bound M123 route. The release integration must measure that route when it is
bound. Shared English and runtime bundle measurements from the same build:

| Bundle                  | Exact bytes | Cap bytes |
| ----------------------- | ----------: | --------: |
| `dist/uiText.js`        |       96948 |    128000 |
| `dist/uiTextRuntime.js` |        4746 |     25600 |
| `dist/runtimeEngine.js` |      651172 |    896000 |

Final source hashes after the compiler, style and fixture corrections:

| Source                                              | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `src/runtime/panel/pullRequests/checkout.ts`        | `a67a6545f70ccd3d1d27256304ca65a7d2a55013da5e6cbbfcb29d1d9d0d3ea1` |
| `src/runtime/panel/pullRequests/unconfiguredGit.ts` | `eeb7856f3d10a0b72bc5b1670f964d9f8e8d410a32716d806bf782b9d0885f28` |
| `src/host/git.ts`                                   | `d392a80e653c6a8ffab9c162de1f27f693acf6f386649df6cdf23cceff58cac2` |
| `src/core/resources/process.ts`                     | `1d3baae41bd5ad31b80bb94ec05dbcac2ef4ef2dab007ea23b93b7a7c25502f3` |
| `src/core/locks/processOwner.ts`                    | `70338bed7eb7c7bab385b91983c6ec7099fc7a1feb512ba55e42e03c73611821` |

Final Prettier check covered every file changed since 27abac965 plus the new
helper and exited 0. After formatting PLAN.md, the roadmap was regenerated:
plan, roadmap, current host API and localization all replayed with exit 0.
No protected launcher/shared-Git/processOwner source was changed; hooks remain
installed at .husky/_ and commits use the unchanged fail-closed hook.

The final unit-project replay after the fake stop exposed one missing argument
to the undefined resolver. Supplying undefined explicitly fixes its type while
preserving the already-green runtime behavior; the final unit replay is recorded
below. This does not change a production branch, gate or test assertion.

Final unit-project replay after the explicit resolver argument: exit 0.
