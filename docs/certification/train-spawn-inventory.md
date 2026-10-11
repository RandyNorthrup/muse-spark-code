# Train spawn inventory (lane SPAWNM123)

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
