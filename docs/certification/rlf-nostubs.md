# RLF-NOSTUBS: int's older stub-style test seams, rewritten over real parts

Base: `int/recovery 94b15b376`. CC-INT3 open item 2: the three stub-style
seams that predate the 2026-10-17 real-code-only rule
(`test/unit/tabEngine.test.ts` stub streams, `publishRegistry`'s injected
clock, `windowsRecording`'s injected removal) plus every seam of the same
kind still on int, rewritten over the real composition. Branch
`rec/rlf-nostubs`, worktree `/Users/user/lanes/RLF-NOSTUBS`.

Rig notes (this MacBook): no browser, GUI, keychain, vault or real
credential-store suite; `git` needs
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` (broken Xcode);
`ps` is denied (the two supervisor tests fail at base for that reason).
Windows-only recording cases are written for hosted CI. No paid call
anywhere; repository timeouts throughout (one named per-test timeout, the
live ten-second Undo window, with its reason).

## Inventory

The three named seams plus every same-kind seam found by the grep sweep
(injected deps used only by tests; `stub`, `fake`, `mock`; hand-written
stream objects; `scripted(` call sites; injected clocks). `vi.fn` /
`vi.mock` markers are already gated. Each row names its fate.

Rewritten over real parts (this lane):

| Seam                                                                                 | Fate                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabEngine.test.ts` stub streams (throwing/silent/admit-gate)                        | Real `ModelApiClient` on owned loopback (`f0a3c049a`)                                                                                                           |
| `modelDiscoveryCancel` fake never-answering wait                                     | Real client wait, real abort (`f0a3c049a`)                                                                                                                      |
| Shared model-API transport helper's injected no-op sleep / zero random               | Transport's own abortable sleep, real jitter windows (`f0a3c049a`)                                                                                              |
| `publishRegistry` injected virtual clock + scripted registry answers                 | Real time, real temp files, recorded npm answer; clock/sleep deleted (`188da4b62`)                                                                              |
| `windowsRecording` injected process/removal/fs/clock stand-ins                       | Owned node children, real deps, real locks, real sleeps (`6f6f5ae55`)                                                                                           |
| Subscription suites' `memorySubscriptionFile` + hand-written `getApiKey`             | Real temp config homes, real sources, real stores; injected `readFile`/`stat` deleted (`6d503e87e`)                                                             |
| `localProbe` hand-written fetch answers + global fetch                               | Production `fetchLoopback` over owned loopback; shared `helpers/loopbackServers.ts` (`5e21a9342`)                                                               |
| `playbookContainedJob` hand-written helper ports + scripted runner + `stubEnv`       | Real reaped pid, real sleeper, real stripped env, real git rename (`b90798726`)                                                                                 |
| `mediaJobRun` injected never-settling stat / rejecting prep / thrown spawn           | Real prep, real sync-throwing spawn; `statOutput` seam deleted, stalled-share cases to unproven (`82c2a7599`)                                                   |
| Plugin probe + native-git hand-built ENOENT rejections                               | Real non-executable PATH entry, real refused spawn; `onError(error?)` fix (`7204295a0`)                                                                         |
| `baseAgentToolset` scripted preparation with its own consent flow                    | Preparation as arranged input, consent tripwire (`543d54446`)                                                                                                   |
| `providerSpendTerminal` scripted provider fetch + fixed NOW + in-memory file/secrets | Real temp file + `userFileIo`, real resolver/fetch, recording loopback, real-time windows; content cases to unproven; `ProvidersDeps.now` deleted (`34c2c8124`) |
| `providerSpendSecrets` editor removal clock + terminal file doubles                  | Real `systemRemovalClock`, real temp file + CAS (`34c2c8124`)                                                                                                   |
| `providerRemoval` fixed-now clock + captured schedule + `undoWindowMs`               | Real process clock, backdated pendings, live 10 s wait; `undoWindowMs` deleted (`34c2c8124`)                                                                    |
| `providerRetryWait` fixed transport now + virtual pacer now                          | Real `Date.now`, tolerant remainder (`34c2c8124`)                                                                                                               |
| `providerPacing` pause test on the virtual pacer                                     | Real 2 s sleep, tolerant remainder (`5f4faf6e3`)                                                                                                                |

Kept as principled (not seams; the boundary is unownable or the input is
the caller's own):

| Double                                                                                               | Why it stays                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mapSecrets` / `mapSecretsBacked` (10 suites)                                                        | Pure Map storage for the OS secret store, which no unit test can own (subscription precedent)                   |
| `recordCalls` (observers)                                                                            | Records calls, answers nothing                                                                                  |
| Tripwire rejections (`confirmKeyUse`, `readSecret`, network `use`)                                   | Prove-by-absence: fail loudly if the code asks                                                                  |
| Person answers (`readSecret` keys, playbook picker steps, `commitIdentity`)                          | A person's answer has no real source in unit tests; recorded                                                    |
| Arranged wiring inputs (toolset preparation, kill-switch cleanups, `again` sweep tripwire)           | The caller's own callbacks/values into a primitive; the composition is proven where it is composed              |
| Editor-store doubles (removal `providers`/`pending`, `listProvidersStore` with the canonical schema) | VS Code global state in production; unownable in unit                                                           |
| Test-owned credential values (`TEST-ADMIN-KEY`, key literals)                                        | Our test keys, never provider content                                                                           |
| Recorded fixtures (npm integrity line, MSP capture in `museReplay`)                                  | Real exchanges with capture date and command                                                                    |
| Pure-function time anchors (`FIXED_NOW` into `providerWaitMs`, retry reason)                         | `now` is an explicit argument, not owned time                                                                   |
| Off-path noop sleeps (`authFastSignIn` install poll)                                                 | The tested paths never call them                                                                                |
| `authFastSignIn` real `Date.now`, real temp credential files                                         | Already real                                                                                                    |
| Pacing minute/day windows + trillion-ms pause on the virtual clock                                   | Provider-time-bound; no unit test can wait them out (time compression over captured headers, not invented data) |
| `providerSpendSecrets` source-text guard (`providerAdmin` absence)                                   | Architectural guard, no stand-in                                                                                |
| `nodeGitRunner` (real git + tripwire + observers)                                                    | Already real                                                                                                    |
| `nodeLifecycle` kill-switch callbacks + real 5 s deadline test                                       | Caller callbacks; the deadline waits for real                                                                   |
| Ledger suites (`dailySpend`, `fileSessionSpend`, `tabSpend`, `tabSpendGate`)                         | Already real temp-dir suites                                                                                    |
| `teamWorkerCreate` native ops                                                                        | Real fs/processes except the errno-mapping test below                                                           |

Follow-ups triaged (same-kind seams this lane did not reach):

| Seam                                                                                                                                                                                                                                                                                                                                                                                                         | Approach                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home-node cluster: `helpers/node/listener.ts` (`verifyBearer`, `sessionSignal`, `consumeStepUp`, `methods`, `terminal`, `requestStub`), `helpers/node/authService.ts` (`enroll`, `assert`), `nodeService` (`FakeNodeClock`, `FakeNodeToolHost`, `FixtureCodec`, scripted resources), `nodeToolHost` (`TestPty` + scripted `open`), `nodeListenerSocket` scripted terminal, `nodeAuth` CDP `send` + auth seam | Real composition over temp state: real verifier/keys, real dispatcher, real pty processes, real clock; CDP authenticator needs a browser host (linuxlt/CI) or unproven |
| `nodeBrowserPort` scripted fetch serving invented node answers                                                                                                                                                                                                                                                                                                                                               | Real fetch over owned (TLS) loopback                                                                                                                                   |
| `providerSpend.test.ts` (628 lines, "Fakes only" header): invented wire bodies into parsers + scripted `SpendFetcher`                                                                                                                                                                                                                                                                                        | Move parse/fetch cases to unproven until the lead's live capture lands; keep pure builder/render/money/ceiling tests                                                   |
| `teamWorkerCreate` errno-mapping test (hand-built Errors)                                                                                                                                                                                                                                                                                                                                                    | Real failing fs ops for producible codes (ENOTDIR/EEXIST/ENAMETOOLONG); ESTALE stays a kernel-failure model                                                            |

## Batches

Suite counts below are re-verified at HEAD on this rig unless noted;
drill outputs for this lane's last batches are quoted verbatim, earlier
batches name their drills per the commit record.

### `f0a3c049a` tabEngine and modelApi suites over the real client, clock and loopback

Hand-written stream doubles, the fake discovery wait and the forced
no-op sleep/zero random became the product's own `ModelApiClient` on
owned loopback (silent, empty, delayed, refused), the real clock and
jitter, and the transport's abortable sleep. Backoff assertions cover
the real jitter window. Suites: tabEngine 6/6, discovery 1/1,
retryNoCount 3/3, pacing 35/35 (one case reworked again in `5f4faf6e3`).
Drills D1-D6 plus the discovery drill, each shown red then restored.

### `188da4b62` the registry poll over the real clock, real files and a recorded npm answer

The injected virtual clock and scripted registry answers became real
time with short `timeoutMs`/`delayMs`, real temp files on real timers
(the kernel's own ENOENT polls on), and `verifyPublished` against the
recorded `npm view muse-spark-code-acp@0.19.0 dist.integrity` line
(captured 2026-10-30, `test/fixtures/publish-registry/`). The clock and
sleep are deleted from the script; the lying-clock backstop case had no
real trigger and is withdrawn. Suite: 8/8. Drills P1-P8, each shown red
then restored.

### `6f6f5ae55` windowsRecording over real parts

Injected process/removal/fs/clock stand-ins became owned node child
scripts through the production frame decoder, the real
`createWindowsRecorderDeps` machinery, real `denyWrites` locks and real
removal sleeps. Trust refusal, byte-stripped malformed stdout, retry
against a real 100 ms chmod lock, and `isRemoveRetriable` (now
exported) pinned directly. Suite: 11/11 on this rig; Windows-only cases
are written for hosted CI. Drills W-R1..W-T5, each shown red then
restored.

### `6d503e87e` subscription suites over real temp files, real stores

`memorySubscriptionFile` and the hand-written `getApiKey` became real
auth files in real temp config homes, the real key source/credential
wiring, the real `CredentialStore` over the Map-backed external store,
and the real file session store with the scrub asserted on persisted
bytes. Missing/unreadable/oversized/rotation/retention run over real
absent, blocked, denied and padded files. The down-store redaction case
moved to `docs/real-life/unproven.md`; the injected `readFile`/`stat`
seam is deleted. Suites: 33 + 15 + 4, all green. Drills S-K1..S-K4,
S-C1..S-C4, S-R1..S-R3 (plus the plumbing/rotation tests the v1
S-R2/S-R3 gained), each shown red then restored.

### `5e21a9342` localProbe over the production fetch

Hand-written fetch answers and the global fetch became the production
`fetchLoopback` against owned loopback (really-closed, silent,
answering), plus a new non-2xx case. The rewrite exposed a production
bug the stand-ins hid: transport failures rejected as plain `Error`,
so a refused connection rethrew out of the probe; failures now reject
as `TypeError` with the `node:http` cause, as fetch does. Owned-server
helpers moved to the shared `helpers/loopbackServers.ts`. Suites:
localProbe 4/4, providerLoopbackFetch 12/12. Drills L1..L4, each shown
red then restored (the first L1 attempt never applied and was re-run
assert-guarded).

### `b90798726` playbook tests over real processes, real env, real git

Hand-written helper ports, the scripted runner and `stubEnv` became a
real spawned-and-reaped pid, a real sleeper, the exact stripped-env
expression per OS, and real git finding a real rename with the host
variables really present. The rename proof is gated on git and
supervisor health and runs on hosted CI. Suite: 19 passed, 13 skipped,
2 pre-existing supervisor failures (denied `ps` at base, untouched).
Drills P-A, P-1, P-2 shown red then restored; P-B runs on hosted CI.

### `82c2a7599` mediaJobRun over real prep and real spawn failures

The injected never-settling stat, rejecting preparation and hand-thrown
spawn failure became the real `mcpJobExecutable` prep over a temp store
and a real sync-throwing spawn (`timeout: NaN`, refused by Node on
every platform). The stalled-share cases moved to unproven; the
`statOutput`/`OutputStat` seam is deleted. Suite: 20 passed, 4 skipped.
Drills M-1..M-4, each shown red then restored.

### `7204295a0` probe-refusal and runner-rethrow over real spawn failures

Hand-built ENOENT rejections became a runtime on PATH but not
executable (default probe, spawning for real) and a refused `spawn`
through the real `createGitProcess` with a twin direct run. The
rewrite exposed a second production bug: the child handle dropped the
start error, so `onError` now carries it (optionally; the dispatch
consumer is unchanged). Suites: pluginDispatch 44 passed / 4 skipped,
nativeGitService 10/10 (with `DEVELOPER_DIR`). Drills D-P1/D-P2,
D-G1/D-G2, each shown red then restored.

### `543d54446` toolset wiring pins, consent tripwire

The scripted preparation with its own consent flow became an arranged
preparation input (pass-through and flag gating asserted) with the
person's consent a never-called tripwire; the real consent flow stays
proven in `runtimeStore.test.ts`. Suite: 4/4. Drills B-1/B-2, each
shown red then restored.

### `34c2c8124` spend terminal, removal and retry waits over real parts

`providerSpendTerminal`'s scripted fetch, fixed `NOW` and in-memory
file/secrets became a real temp providers file behind the production
`userFileIo`, the real `resolveEndpointHost` and global fetch, and the
provider aimed at an owned recording loopback (new
`recordingHttpEndpoint` helper). Refusals, key isolation on the wire,
report windows asserted against real time, and admin auth stay in
unit; the invented report bodies moved to unproven. `ProvidersDeps.now`
is deleted. Removal runs on the real process clock (new shared
`systemRemovalClock`, production included) with backdated pendings for
expired windows, a new live ten-second wait (named timeout
`LIVE_WINDOW_TIMEOUT_MS`), and terminal removal over the real temp
file with CAS writes; `undoWindowMs` is deleted. `providerRetryWait`
runs on real `Date.now` with a tolerant pause remainder. Suites:
spendTerminal 18/18, spendSecrets 8/8, removal 6/6, retryWait 5/5.

Drills (each break red, each restore green):

- SP-T A, request path broken (`usage_report/messages` ->
  `usage_report/DRILL`): the pin refuses the off-allowlist request, so
  the wire test fails with `expected 'The provider could not be
reached.' to contain 'refused'`.
- SP-T B, origin binding forced true: the mismatch sails to the fetch,
  failing with `expected 'The provider refused the spend report...' to
contain 'https://api.anthropic.com'`.
- SP-T C, admin report reads the inference account: the wire lacks the
  admin key (`expected '127.0.0.1:51808\nkeep-alive\n2023-06-...' to
contain 'TEST-ADMIN-KEY'`) and the mismatch case reads the wrong
  account (2 failed).
- SP-T D, window shifted one day (`days + 1`): `expected 1792535647079
to be greater than or equal to 1792622047078`.
- SP-T E, groq preset gains `spend: 'key-usage'`: `expected 'No groq
key is stored.' to contain 'no spend report'`.
- SP-T F, `readProvidersFile` always missing: all 4 usage tests fail.
  The auth tests did not (authSet stages keys for unconfigured
  providers), so both authSet tests gained envelope-origin assertions,
  drilled by F2.
- SP-T F2, preset-origin fallback broken (`?? 'https://drill.invalid'`):
  both authSet tests fail with `expected 'https://drill.invalid' to be
'https://api.anthropic.com'`.
- R-A, undo expiry check removed: `expected true to be false`.
- R-B, `dropPending` saves the unfiltered list: the undo test and the
  live-window test fail with `expected [ { entry: ... } ] to deeply
equal []`.
- R-C, serialize chain observes the rejection (`operations = next`):
  the chain-alive test and the next-start retry test fail.
- R-D, admin delete skipped: the invisibility test and the editor
  removal test fail with `expected { v: 1, ... } to be undefined`.
- R-E, terminal remove skips the admin account: `expected true to be
false`.
- R-F, pacer pause ignored: the retry-wait order test fails with
  `expected [ 'background', 'foreground' ] to deeply equal
[ 'foreground' ]`.

### `5f4faf6e3` pacing pause over real time

The configured-provider pause test left the virtual `recordingPacer`
for real time with a real 2 s sleep (tolerant remainder 1900-2000 ms).
The minute/day window tests and the trillion-ms pause keep the virtual
clock (provider-time-bound; see the inventory). Suite: 35/35. Drill
R-G (pause ignored): both pause tests fail (`expected [] to have a
length of 1 but got +0` on the real-time test), restored green.

### `651a7733a` zero the duplication gate; regen the catch baseline

The lane's first full gate battery found two failures, both fixed:

- `check:catches` failed: the mediaJobRun rewrite renamed a GENERIC
  catch site's identity (`statOutput` -> `lstat`), so the baseline no
  longer matched. No count rose or fell; `catch-inventory.mjs
--write-baseline` regenerates exactly one identity hash.
- `duplication` found 10 clones, all lane-caused: the recording
  endpoint duplicated the loopback helper's bind/close (fixed by
  shared `bindHttpServer`/`bindNetServer`/`loopbackEndpoint`
  internals); the real pacer literal appeared in two suites (fixed by
  the shared `helpers/realPacer.ts`); the spend usage runner and the
  unknown-provider test shared setup (the test now runs through the
  runner with the file path); the windows test shadowed the
  production port assembly (production now exports
  `assembleRecorderPort(child)`, which both the launch and the test
  use — the driver side is proven against the real assembly, not a
  mirror); the two lock tests shared setup (`startLockedRun`); the
  subscription suites shared `writeAuthFile` (shared
  `helpers/subscriptionAuthFile.ts`) and the credential setup
  (`subscriptionOn`). Zero clones after.

## Gates

True exit codes (no pipes), this rig, final code:

| Gate                                    | Exit                               |
| --------------------------------------- | ---------------------------------- |
| prettier --check (touched files)        | 0                                  |
| eslint --max-warnings 0 (touched files) | 0                                  |
| npm run typecheck                       | 0                                  |
| node scripts/check-l10n.mjs             | 0                                  |
| npm run check:reference                 | 0                                  |
| npm run check:host-api                  | 0                                  |
| npm run check:plan                      | 0 (243 milestones, 0 drift)        |
| npm run check:roadmap                   | 0 (243 entries, current)           |
| npm run check:catches                   | 0 (after the baseline regen above) |
| npm run duplication                     | 0 (after the fixes above)          |
| npm run cycles                          | 0                                  |
| npm run deadcode                        | 0                                  |
| npm run build                           | 0                                  |

Suites re-verified at HEAD: tabEngine 6/6, publishRegistry 8/8,
windowsRecording 11/11, subscription 33+15+4, localProbe 4/4,
providerLoopbackFetch 12/12, playbook 19 passed + 13 skipped + 2
pre-existing supervisor env failures, mediaJobRun 20+4 skipped,
pluginDispatch 44+4 skipped, nativeGitService 10/10, baseAgentToolset
4/4, spendTerminal 18/18, spendSecrets 8/8, removal 6/6, retryWait 5/5,
pacing 35/35, discovery 1/1, retryNoCount 3/3.

`vitest related` per changed source: providerRemoval 14/14,
providersSpend 18/18, subscriptionKey 5 files green, windows record 2
files green, loopbackFetch 2 files green, windowsRecorderDeps 2 files
green, modelsPanelEntry no related unit tests (editor-side;
typecheck+build cover it), mediaJobRun per `82c2a7599` (file untouched
since; not re-run). providersCommands 97 pass with 3 failures and
pluginHost 571 pass with 4 failures, all non-lane: the
providerHeadersStore failures are the forbidden real-OS-store suite
(pulled in by `related`, keychain unavailable in the sandbox —
type-only lane diff, not re-run) and pathGuardRound4 is the broken
Xcode (`can't exec .../git`, `Operation not permitted`).

## Unproven moves

- Subscription down-store redaction case (`StoreUnavailableError`).
- mediaJobRun stalled-share sample cases (2).
- providerSpendTerminal report-content cases (5): Anthropic
  figures + estimate + JSON + figures-alone, DeepSeek balance,
  OpenRouter key usage. The live run also verifies the UNVERIFIED
  request shapes; a future content test must be written from its
  capture (AGENTS.md rule 14).

All three entries live under `## Lane RLF-NOSTUBS` in
`docs/real-life/unproven.md` with exact real-life steps.
