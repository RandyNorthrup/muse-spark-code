# M100 phase 2 — certification record (per-lane entries)

2026-10-07, kubuntu rig, worktree `/home/randy/lanes/FIXM100P2L0`,
branch `m100/p2-l0-fix`. Lane W completes this file on the joined tree
(README, PRIVACY, SECURITY, qualification); each lane appends its own
section with gate results and test-fire proofs. No live model calls in
any lane-0 entry: model attempts **0**, inference spend **0**.

## Lane 0 fix (RVM100P2L0): six findings made structural

Base `2d2292cc7`; review `/home/randy/lanes/_ctx/codex/RVM100P2L0.report.md`.
Every finding below is enforced from the shared contract alone
(`src/shared/devices.ts`, `src/shared/constants.ts`), with a regression
test in `test/unit/devicePhase2Contracts.test.ts` that fails on the base.

- P2 capability byte cap: `deviceCapabilitySchema` carries a refine on the
  serialized size (`src/shared/devices.ts`), so a field-valid advertisement
  past `capabilityBytes` refuses to parse. Test `refuses a field-valid
advertisement that serializes past the byte cap` builds the maximum
  advertisement (64 tools at `labelChars`, 16 engines at `modelIdChars`,
  `transportResets` at `Number.MAX_SAFE_INTEGER`, 10920 bytes): it fails
  when the refine is removed and when `capabilityBytes` is raised.
- P2 unread queue caps: `canAddOwner`, `canAddGrant` and `canQueueResultAck`
  export the `ownersPerDevice` (4), `grantsPerOwner` (16) and
  `pendingResultAcks` (256) bounds for lanes K and R to call. The queue-cap
  tests lock each literal and each boundary, and fail when a cap is removed
  or changed.
- P2 grant ceiling: `DEVICE_GRANT_MODE_ORDER` (`plan < manual < acceptEdits
< auto`, deliberately not `PERMISSION_MODES` order) and
  `grantCeilingRefusal` refuse a grant wider than the sender's ceiling in
  mode or in any of the six quota fields with the typed `scope-denied`
  refusal. The sample grant port calls it. Tests cover mode, each quota
  field, and the port's `scope-denied`.
- P2 threat model: `docs/certification/m100-threat-model.md` carries a
  threat table naming stolen pair key, malicious paired device, replay,
  downgrade, resource exhaustion and the D101 reconcile, each with its
  mitigation, owning lane and planned test. The owning test parses the
  table and requires a lane and a test file per threat, not substrings.
- P3 jitter: `handshakeBackoffMs` takes an injected random source
  (`Math.random` by default) and removes up to `handshakeBackoffJitter`
  (0.25) of the nominal delay, never above the nominal delay or the cap.
  Tests use fixed sources (`() => 0`, `() => 0.5`, `() => 1`).
- P3 epoch-bound acknowledgement: `isAckForEnvelope` settles one
  (epoch, digest) pair; the sample result port dedupes on
  `epoch:digest` and returns the envelope's epoch. The test publishes an
  epoch-2 envelope beside an epoch-1 ack and requires a fresh accept.

### Test-fire proof (base `2d2292cc7`, new test file copied over, rig run)

`npx vitest run test/unit/devicePhase2Contracts.test.ts --maxWorkers=3`:
9 failed, 26 passed. Every new or reworked test fails; every pre-existing
test passes. Failing: the jitter test (`handshakeBackoffJitter`
undefined), the capability refusal (`expected true to be false`), both
queue-cap tests (`canAddOwner is not a function`), both ceiling tests plus
the widened-grant port case, the epoch-ack case, and the threat-table
case (no table on base). On the fixed tree the same file is 35 passed.

### Verification (fresh clone `/tmp/fixm100-verify`, `npm ci`, `CI=true`, default timeouts)

- `npx vitest run test/unit/devicePhase2Contracts.test.ts --maxWorkers=3`
  three times: 35 passed each time.
- `npm run typecheck` (host, webview, unit, e2e, integration): clean.
- `npm run lint:js` (full tree, `--max-warnings=0`): clean.
- `npx prettier --check` on every changed file: clean.
- Plain `knip`: exit 0 (two pre-existing configuration hints only).
- `jscpd`: 0 clones.
- `npm run check:reference`: current (53 features, Devices reference
  18 entries). `node scripts/check-l10n.mjs`: 14 tables, 0 problems.
  `node scripts/check-host-api.mjs`: 0 problems.

## Base integration — M100P2BASE (macmini, 2026-10-07)

Worktree `/Users/randy/lanes/M100P2BASE`, branch `m100/p2-int`.
Release base `9d1ab33c3` (0.15.0); authorized merge
`git merge --no-ff 23c67925f` (phase 1, phase-2 plan/contracts and lane-0
review repairs). No other branch is merged. Version remains 0.15.0;
Devices remains unshipped. Model attempts **0**, inference spend **0**.

### Conflicts (19 files)

| Files                                                                                                               | Resolution                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CHANGELOG.md`                                                                                                      | Preserve release history and existing Unreleased fixes; place all incoming Devices entries under Unreleased.                                                                         |
| `PLAN.md`                                                                                                           | Preserve both branches' phase-2 plan, gate records, escape-hatch register and residual-risk records.                                                                                 |
| `docs/orchestration-gotchas.md`                                                                                     | Retain every release rule/id, including G29–G33; add incoming channel, Windows host and auth rules as G34–G36 to avoid duplicate ids (now main's G50–G52; see the lead integration). |
| `knip.jsonc`, `package.json`                                                                                        | Union entry inventories, retain the release's compiler/quality/reference scripts, add both Devices cycle entries.                                                                    |
| `scripts/build.mjs`, `scripts/check-bundle-split.mjs`, `scripts/lib/deferredBundles.mjs`, `scripts/package-acp.mjs` | Keep every release bundle, lazy mapping and text guard; add Devices with its inherited independent budgets. Existing caps are unchanged.                                             |
| `scripts/gen-reference.mjs`                                                                                         | Run the complete release reference generator, the incoming Devices inventory and the release sharing inventory together.                                                             |
| `src/shared/l10n/en.ts`                                                                                             | Union English keys; all 14 translated tables merge automatically with both branches' keys and values.                                                                                |
| `src/shared/modelsPanel.ts`                                                                                         | Retain complete provider/team/traffic boundaries; move the strict Devices region into `src/shared/devicesPanel.ts` so unrelated validators stay outside its lazy closure.            |
| `scripts/lib/harnessServer.mjs`, `test/harness/index.html`                                                          | Retain every release scenario and fake-host handler, add Devices scenes, sizing and request/reply handling.                                                                          |
| `test/unit/bundleSize.test.mjs`, `test/unit/deferredBundles.test.ts`, `test/unit/webviewBundles.test.mjs`           | Retain release tests/setup and add the incoming Devices budget, build entry and Windows-separator closure assertion.                                                                 |
| `docs/ide-compatibility/host-api.md`, `src/shared/reference/reference.generated.ts`                                 | Regenerate with `npm run check:host-api -- --write` and `npm run reference:generate`; no hand-edited generated output.                                                               |

### Verification scope

The rig brief explicitly requires the full unit/process-e2e suite with coverage
and all four CI shard memberships, overriding common.md's owning-files-only
limit. Heavy commands run serially on macmini. Test execution retains the
rig's maximum three files/workers per invocation and repository timeouts;
partial coverage maps are merged once with the unchanged global thresholds.
No test filter, skip, global timeout override, gate waiver or paid/live call
is introduced. The final fresh-clone commands/results and exact counts are
recorded below and in `m100-phase2-base.json`.

### Initial integration regressions

All five compiler projects passed. The first complete three-file run
(`devicePhase2Contracts.test.ts`, `deferredBundles.test.ts`,
`webviewBundles.test.mjs`) reported **124 passed, 2 failed**. The phase-2
register assertion found six G29/G30/G31 rows because the release already
used those ids. Preserve those release ids and assign the incoming rules
G34/G35/G36, updating their plan, threat model, comments and test references.
(Main later released its own G34–G38; the lead integration below moves these
rules into main's G50–G52 and the two verification rows to G53/G54.)
The legal cap drill's green control failed because its synthetic browser
metafile omitted Devices; add that exact entry beside its existing Models
and Usage fixtures. No assertion, gate, budget or deadline is removed.
The localization gate also caught the automatically merged duplicate
`check:reference` package script; retain the release's single script.

The completed legal fixture then exposed the real Devices bundle cap:
**105.8/100 KiB**, because the shared Models panel loaded provider/team
validator construction with Devices. A new independent-boundary assertion
was deliberately run against that combined implementation: **2 failed,
78 passed** in the full deferred-bundle file (boundary assertion and cap).
Move the Devices region, without changing its schemas, into
`src/shared/devicesPanel.ts`; update its consumers and the guarded lazy
inventory. The final complete three-file run is **127 passed**, including
both inherited cap/global red/restored drills and the new separation check.
The real production build passes every unchanged size/split/global/notices
gate: Devices **80.7/100 KiB**, activation **462.8/600 KiB**, Model API
**456.0/475 KiB**, chat startup **735.8/900 KiB**, original deferred JS
**31.9/50 KiB**. `.husky/_/pre-commit` exists before the merge commit.

### First fresh-clone static run and release-head lint repair

Committed merge `1b24c700f`, fresh clone
`/var/folders/r2/xm1s2y_x67zg6lz1kr7x8f2h0000gp/T/m100p2base-ci-45gdvk6h/repo`,
`CI=true`, `npm ci` (exit 0). All five typechecks, full Prettier,
plain knip, duplication (zero clones), cycles (866 files, zero cycles),
reference, localization, host API and production build passed.
Full JavaScript lint found the release-head conditional spread at
`scripts/check-badges.mjs:37` (`unicorn/consistent-conditional-object-spread`).
Use a logical conditional spread while preserving the job-token header's
GitHub-only binding. The complete fake-only `checkBadges.test.mjs` passes
**40 tests** at repository deadlines, including token/no-token and image-host
boundary checks. No HTTP request is added by this repair or its tests.
Final verification starts from another fresh clone of the repair commit.

### Deliberate independent-panel drill

Temporarily add a side-effect import of `./modelsPanel` to the Devices
boundary. The full `deferredBundles.test.ts` file fails its new independent
boundary assertion and its unchanged size gate: **2 failed, 78 passed**.
Restore source byte-exact, then run the complete deferred/phase-2 contract
files together: **115 passed** at repository deadlines. The cap/global
artifact drills inside the deferred file also verify byte-exact restoration.

Source `src/shared/devicesPanel.ts` before/after SHA-256: `4a672cc45df36ee29d203d758e0dabe39d337c815951f0ff2e33b6a33b2abbbb`
(equal); red exit 1, restored exit 0.

### First complete fresh-clone suite and joined repairs

Repair commit `390c156a8`, fresh clone
`/var/folders/r2/xm1s2y_x67zg6lz1kr7x8f2h0000gp/T/m100p2base-ci-pc9ree0k/repo`,
`CI=true`, Node 24.21.0, npm 11.19.0, `npm ci` exit 0. All requested static
gates passed: five typechecks, full lint/Prettier, plain knip, zero duplication,
866 files/zero cycles, reference, 14-language localization, host API and build.
PowerShell lint is the repository's normal Darwin skip; no Windows result is
claimed here.

The full configured manifest is **846 unit/process-e2e files**, partitioned
by the actual CI sequencer as **212 / 212 / 211 / 211**. Its union is complete
and disjoint. Every manifest file is included in **284 batches**, each at most three files and
`--maxWorkers=3 --coverage --shard=1/1`, with repository deadlines. Seven
files failed; the remainder completed. Partial maps are not a global coverage
pass. No live opt-in is set, and no test/filter/deadline/gate waiver is added.

| Failure                                                                                                               | Structural repair and owning verification                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usagePackaging.test.mjs` (1 failed), `runtimeChatGptPackage.test.ts` (2 failed), `execStdio.e2e.test.ts` (30 failed) | Add `devices` to their isolated ACP bundle inventories. The real packager now reaches positive archive and intended missing-member checks.                                                                                                                                                                                 |
| `vsixPackaging.test.mjs` (setup failed, 75 cases never reached)                                                       | Add `dist/devices.js` to its isolated VSIX fixture. Keep the real strict staging/ZIP checks. The three package-unit suites pass 89 tests.                                                                                                                                                                                  |
| `deviceIntegration.test.ts` (one 5000 ms flood-test timeout)                                                          | Retain real pairing, launch, pinned TLS, 64 data/control frames, capacity counts, independent Stop and latest-state checks; use a memory-backed repeated journal advance. Assert every advance/cancellation and unchanged occupancy/usage. Neighboring journal/corrupt-storage integration cases retain actual durability. |
| `webviewBundle.test.mjs` (753429 bytes exceeds 733.8 KiB)                                                             | The Devices fallback uses existing generic panel failure/retry text. The collector distinguishes DOM surface selectors from indirect translation keys. Devices English loads with the Devices body under its own existing closure budget; all canonical language/key/slot checks remain.                                   |
| `flightRecorder.test.ts` (59 frame paths versus 60 shipped files)                                                     | Add exactly `dist/devices.js` to the recorder's package-frame vocabulary, retaining arbitrary-path refusal and the test's exact equality to `.vscodeignore`.                                                                                                                                                               |

The complete runtime repair group (Devices integration, exec stdio, flight
recorder) passes **114 tests**. The startup/language group (browser English,
Devices document, complete webview bundle file) passes **61 tests**. The
production build passes every unchanged cap: activation **462.8/600 KiB**,
Model API **456.0/475 KiB**, original deferred **31.9/50 KiB**, common surface
English **24.1/25 KiB**, Devices UI **33.7/50 KiB**, Devices host **80.7/100 KiB**.
The stronger startup **733.8 KiB** and legacy deferred **32.1 KiB** review
assertions also remain unchanged and pass.

Deferring English also exposed the generated loader's import outside the
surface's own catch: the new missing-English-chunk case failed (1 failed,
4 passed). Inject that import inside a sole async try/catch factory; test a
missing common-English chunk and a missing chunk carrying private Devices
English. Both return the surface fallback, preserving installed German.

The recorder repair changes covered source, so the final qualification uses
another fresh clone and complete four-shard coverage collection at the repair
commit. Maps from the first source revision are not used in that final result.

### Verification orchestration discoveries (now G53, G54)

Vitest 5.0.2's `list --filesOnly --shard=N/4` returned the whole manifest for
each shard. The complete/disjoint preflight rejected it before execution;
derive the actual membership from the configured execution sequencer instead.
Vitest also refuses `--merge-reports` with its blob reporter. Those attempted
intermediate collation commands failed; test collection continued. Final
collation retains every test/error/module graph and uses the same pinned
coverage-map merge in bounded groups, with an official direct/reduced-map
equivalence check and final official threshold merge. G53/G54 (first G37/G38)
and D100 record these rules; the final receipt records the successful
direct-map equivalence proof and unchanged-threshold merge.

### Joined guard-fire proofs

Each mutation ran the complete owning test file(s), with repository deadlines
and three workers, and restored its source byte-exact in `finally`.

| Deliberate mutation                                          | Red result                                            |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Count a technical surface selector as a text reader          | Browser English: 2 failed, 4 passed.                  |
| Put Devices English back in the common English module        | Browser English: 1 failed, 5 passed.                  |
| Move the generated English import outside the existing catch | Browser English: 1 failed, 5 passed.                  |
| Restore the old eager Devices failure shell                  | Devices document/webview bundle: 2 failed, 53 passed. |
| Remove the receiver's cancellation journal-advance effect    | Devices integration: 2 failed, 9 passed.              |

Restored startup/language files: **61 passed**. Restored Devices integration,
phase-2 contracts and production chat mount: **47 passed**. All restored source
SHA-256 pairs match; full values and red-log hashes are retained in the final
base receipt. No temporary mutation is committed.

### Final fresh-clone qualification

Verified code/test revision `18fa2609023358c2ef3a34de6a8326d3b5a72eae`; fresh clone
`/private/var/folders/r2/xm1s2y_x67zg6lz1kr7x8f2h0000gp/T/m100p2base-ci-v64yxltl/repo`. `CI=true`, Node v24.21.0,
npm 11.19.0, `npm ci` exit 0. All verification below uses this single
revision; no coverage map from the earlier failing revision is reused.
The final certification commit changes documentation only.

| Gate command              | Exit |
| ------------------------- | ---- |
| `npm ci`                  | 0    |
| `npm run typecheck`       | 0    |
| `npm run lint`            | 0    |
| `npm run format:check`    | 0    |
| `npm run deadcode`        | 0    |
| `npm run duplication`     | 0    |
| `npm run cycles`          | 0    |
| `npm run check:reference` | 0    |
| `npm run check:l10n`      | 0    |
| `npm run check:host-api`  | 0    |
| `npm run build`           | 0    |

`npm run typecheck` ran host, webview, unit, process-e2e and integration projects.
Lint ran the complete repository JavaScript/CSS gates; PowerShell has its normal
Darwin skip. Plain knip passed; duplication found zero clones; cycles examined
866 files and found zero cycles. Reference, all 14 language tables and the host
API record passed with zero problems. Production build includes the unchanged
size, split, host-global and notices gates. No aggregate quality wrapper is run:
the rig brief's enumerated gates are run individually and serially.

The configured CI sequencer produced the complete, disjoint **846-file** manifest.
All four memberships ran in **284** invocations, each at most three file arguments:
`npx vitest run <files> --maxWorkers=3 --coverage --shard=1/1
--reporter=default --reporter=blob --outputFile=<batch-report>`.
All 284 exited 0 at the repository's own deadlines. No assertion-level filter,
new skip or timeout override is used. Existing platform/live opt-in skips remain.

| CI membership | Files | Passed tests | Existing skipped tests | Todo tests | Exit |
| ------------- | ----- | ------------ | ---------------------- | ---------- | ---- |
| 1             | 212   | 4528         | 11                     | 0          | 0    |
| 2             | 212   | 3879         | 9                      | 0          | 0    |
| 3             | 211   | 4426         | 36                     | 0          | 0    |
| 4             | 211   | 4470         | 23                     | 0          | 0    |

The final official merge reports **17303 passed**,
**79 skipped**, **0 todo**,
**0 failed tests**, across **846 files**. Per-shard reports and final
counts agree. Every listed file is represented exactly once in the executed
batch arguments and official merged test results.

Coverage reduction is bounded to eight batch reports at a time and uses the
pinned Vitest coverage provider's own `createCoverageMap.merge` semantics.
All 284 raw reports are retained as gzip archives with
byte-exact SHA-256 round-trip checks. Before the final merge, the first eight
original reports (24 files) were merged directly by Vitest and
through the reducer: all **982 complete coverage maps**, counters,
locations and test counts are exactly equal. Tests, errors and module graphs
remain in the reduced blobs. Vitest then officially merged each membership and
finally all four together. Final command:
`npx vitest run --merge-reports=<four-shard-directory> --maxWorkers=3 --coverage
--reporter=default --reporter=json --outputFile=<summary>
--coverage.reporter=text --coverage.reporter=lcov --coverage.reporter=json-summary`.
It has **no shard flag** and exits **0**, enforcing the unchanged global thresholds.

| Coverage   | Measured | Unchanged threshold | Covered / total |
| ---------- | -------- | ------------------- | --------------- |
| statements | 92.74%   | 90%                 | 72129 / 77771   |
| branches   | 87.79%   | 85%                 | 50303 / 57298   |
| functions  | 93.89%   | 90%                 | 14638 / 15590   |
| lines      | 93.37%   | 90%                 | 68848 / 73731   |

The build remains within every inherited cap, including activation
**462.8/600 KiB**, Model API **456.0/475 KiB**, Devices host **80.7/100 KiB**,
Devices UI **33.7/50 KiB**, surface English **24.1/25 KiB**, startup
**733.8/900 KiB** and original deferred JS **31.9/50 KiB**. The full unit suite
also passes the stricter unchanged **733.8 KiB** startup and **32.1 KiB** legacy
deferred review assertions.

`m100-phase2-base.json` records exact commands, results, counts, source identity,
coverage, log/archive/membership hashes and every deliberate drill's matching
before/restored SHA-256. The authorized merge is `1b24c700f`; structural repair
commits are `390c156a8` and `18fa26090`. All commits use the repository hooks;
lint-staged and gitleaks pass. No push, additional merge, gate waiver, live model
attempt or paid call is made. Devices remains unshipped pending the phase-2
product lanes and qualification W.

## Lane 0 re-review (RVM100P2L0B): the byte cap counts UTF-8 bytes

The re-review confirmed the six fixes and found one P2: `deviceCapabilitySchema` compared `JSON.stringify(value).length` (UTF-16 code units) with `capabilityBytes`, so an advertisement of 64 tool names padded with U+4F60 was 5,893 code units but 15,801 UTF-8 bytes and parsed. The refine now measures `new TextEncoder().encode(JSON.stringify(value)).byteLength`, as `tableArchive.ts` does.

- Test: "counts the byte cap in UTF-8 bytes, not string length" (string length under the cap, UTF-8 bytes over it, parse refused); the existing fixture check now measures UTF-8 bytes.
- Drill: with the previous schema the new test fails (1 failed, 35 passed); with the fix 36 passed. `devicePhase2Contracts` and `devices` together: 130 passed.
- ESLint (`--max-warnings=0`), Prettier and `tsc -p tsconfig.json` clean on the host, 2026-10-07.

## Lane C — multiplexed channel (M100P2C, 2026-10-07)

Kubuntu, worktree `/home/randy/lanes/M100P2C`, branch `m100/p2-c`,
base `81f07067497a9edcd750a3f6aabf505a0a0909e9`. Read the rig brief,
`M100P2-common.md`, the phase-2 PLAN ownership/acceptance section, the
planning record and the threat model. Changed only lane C's core/host files,
its owning tests/helper, and this section. No upstream wire shape was added:
these are product-owned channel packets, exercised with fakes and an actual
mutually authenticated TLS exchange on `127.0.0.1`. Model attempts **0**;
inference spend **0**; real-device pairing **0**.

### Acceptance mapping — all lane C items implemented, tested and drilled

| Acceptance                                                                                    | Implementation                                                                                                                                                                                                                                               | Owning test                                                                                                                                                                                                   | Red drill                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| One long-lived authenticated channel per pair                                                 | `src/host/devices/deviceChannel.ts:678`: `PacedDeviceChannels.request`, `connect`, `accept`; `isAuthenticatedChannel` checks mutual TLS 1.3, no reused ticket, saved SHA-256 leaf pin and current pairing                                                    | `channel.test.ts`: memoizes a pair while callers race; shares one authenticated ready channel; inbound duplicate refused; `deviceMultiplexedChannel.test.ts`: real loopback TLS and each authentication guard | one-pair-channel; saved-tls-pin                        |
| Control over status/events over logs over bulk; bulk and approval waits never starve Stop     | `src/core/devices/channel.ts:314`: `streamFor`, `enqueue`, `nextPacket`; grant requests/dispatch use events; separate running control/data drains; socket false-write waits for drain                                                                        | preempts fragmented bulk; reserves control capacity; socket backpressure prioritizes Stop; held log/grant request; real TLS held log                                                                          | priority; queue-reserve; grant-approval-stop           |
| At most three pending handshakes per host; jittered exponential backoff capped at ten minutes | `src/host/devices/deviceChannel.ts:570`: `PacedDeviceChannels.pump/run` calls lane 0's `canOpenHandshake` and `handshakeBackoffMs`; incoming TLS starts only inside an admitted factory; abort does not free a slot until the factory settles                | queues a handshake burst past pendingHandshakes under backoff (threat-table test); mixed inbound/outbound factories; all eight backoff boundaries; late socket destroyed                                      | handshake-burst; mixed-handshake-burst; jitter-backoff |
| Refusal is throttled/unknown, never down; no port probes; health is authenticated ready       | `src/host/devices/deviceChannel.ts:338`: typed `DeviceThrottled` facts and `unknown` failures; `openMultiplexedDeviceChannel.health` sends a parsed ready request, matches its reply and observes absolute deadlines; periodic ready calls retain the socket | authenticated-ready-only health with a TCP-probe spy; silence is unknown; periodic health; reconnect backoff; absolute incomplete-message time                                                                | no-port-probe; absolute-deadline                       |
| One authentication failure stops and asks; second attempt needs explicit user consent         | `src/host/devices/deviceChannel.ts:782`: typed `DeviceChannelDialFailure('authentication')`, `canRetryAuth`, `authenticationRequired`, `retryAuthentication(pairId, isConfirmed)`; a repeated connect preserves the lockout                                  | stops after one failed authentication and asks; false consent does nothing; confirmed consent admits exactly the next request                                                                                 | auth-lockout                                           |

Framing is canonical newline-delimited JSON with strict zod parsing of both
packet and inner lane-0 envelope. Each packet, including newline, is at most
`channelFrameBytes` (4096 UTF-8 bytes); reassembly and fragment allocations
observe `frameBytes` and `frameFragments`. Duplicate keys (outer and inner),
unknown fields, malformed UTF-8, wrong versions, foreign packet pair/incarnation,
sequence gaps and impossible acknowledgements refuse before application
use. Separate 32-item control and data reserves include queued, partial,
running and unacknowledged work. An acknowledgement releases transport
capacity only after the application handler settles; it is not an execution
retirement or a durable result settlement. Disconnect never changes a
journal, grant, attempt owner or spending liability. The phase-1
`openDeviceChannel` interface and its 25 regressions remain intact.

A restarted receiver's current authenticated incarnation replaces the pair
cache only after its previous channel closes (or an inbound handshake has
settled without a channel). It preserves handshake backoff and cannot bypass
authentication lockout. A live/pending channel refuses a conflicting incarnation
as unknown; historical execution identities remain unchanged. The owning
regressions cover both closed-channel reconnect and a failed inbound connection
followed by an outbound reconnect.

### Intentional failures and byte-exact restoration

Each command was `npx vitest run <owning-file> --maxWorkers=3 -t <test-name>`
with the repository's default timeout; no `--testTimeout` was used. Every
mutation below produced an assertion failure and exit **1**, then the source
was restored byte-exact. Final source hashes, verified before and after
every corresponding mutation:

- `src/core/devices/channel.ts`:
  `17cad84f4aa53d9c5dfcbcb75ad1511df1228e04bfe50983aab4d60794571147`.
- `src/host/devices/deviceChannel.ts`:
  `67e675188f63ecfa0c958b64379be324323167305d4719a6eb3b471a4f766ccb`.

| Drill                     | Deliberate break                                                      | Failing assertion                                                               |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| priority                  | Reverse outgoing stream priority                                      | expected 'bulk' to be 'control' // Object.is equality                           |
| queue-reserve             | Remove outgoing occupancy guard                                       | expected true to be false // Object.is equality                                 |
| packet-byte-cap           | Remove packet byte guard                                              | expected [Function] to throw an error                                           |
| ack-sequence              | Accept an acknowledgement beyond the last fully sent sequence         | expected [Function] to throw an error                                           |
| inner-duplicate           | Remove inner canonical-JSON check                                     | expected [Function] to throw an error                                           |
| mixed-handshake-burst     | Bypass shared handshake admission for incoming/outgoing factories     | expected "vi.fn()" to not be called at all, but actually been called 1 times    |
| handshake-burst           | Bypass pending-handshake admission                                    | expected "vi.fn()" to be called 3 times, but got 5 times                        |
| jitter-backoff            | Halve the shared jittered backoff delay in the host                   | expected "vi.fn()" to be called 1 times, but got 2 times                        |
| no-port-probe             | Add a raw TCP connect to health (test spy supplies the socket)        | expected "connect" to not be called at all, but actually been called 2 times    |
| auth-lockout              | Forget the authentication failure on the next connect without consent | expected "vi.fn()" to be called once, but got 2 times                           |
| saved-tls-pin             | Remove the saved leaf fingerprint comparison                          | expected [Function] to throw an error                                           |
| one-pair-channel          | Bypass the pair cache lookup                                          | expected "vi.fn()" to be called once, but got 2 times                           |
| grant-approval-stop       | Put a waiting grant request on control                                | expected "vi.fn()" to be called 2 times, but got 1 times                        |
| absolute-deadline         | Remove the monotonic incomplete-message deadline check                | expected false to be true // Object.is equality                                 |
| ready-publication         | Remove the post-ready closed/deadline/active-pair check               | Missing handshake-backoff notification; a closed channel was published as ready |
| receiver-live-incarnation | Permit a conflicting incarnation to replace a live channel            | expected promise to reject, but it resolved                                     |
| receiver-restart          | Skip the closed-channel reconnect reset                               | expected the new incarnation, received the old ready identity                   |
| inbound-outbound-restart  | Reset a failed inbound request only for another inbound request       | expected the new ready identity, received undefined                             |

The corrected inbound retry test advances the second failure's shared
30-second backoff, rather than waiting with an incorrectly assumed
15-second delay. Its timeout was never raised; the final test run is
66 passed at the repository default. All 18 red drills have an assertion failure
and exit 1; the host drills were repeated against the final host source hash.

### Local restored-tree checks

- Owning core/host tests plus phase-1 `deviceChannel.test.ts`: **66 passed**.
- Focused V8 coverage on the two implementation files with the unchanged
  repository thresholds: **95.15% statements, 93.33% branches, 94.11%
  functions, 96.83% lines**; exit 0.
- Phase-1 transport/boundary plus phase-2 contracts: **122 passed**.
- Host and unit typechecks, changed-file ESLint/Prettier, plain knip,
  duplication (0 clones), reference and localization: clean in this lane.
- Host API and production build/sizes/splits/host globals/notices were repeated
  on the final committed code, as recorded below. No cap or gate was changed.

### Final committed-code fresh-clone receipt

Code commit `39524833459b89f0df470e517d4b3936959ffbad`, cloned directly from
this worktree to `/tmp/m100p2c-final-verify.YPf3Op`. Node **24.18.0**, npm
**12.0.1**; `CI=true npm ci` exited **0**. Both source SHA-256 values above
match the committed worktree and the fresh clone after the commit hooks.

- Three consecutive runs of
  `CI=true npx vitest run test/unit/channel.test.ts test/unit/deviceMultiplexedChannel.test.ts test/unit/deviceChannel.test.ts --maxWorkers=3`:
  **66 passed each**, durations **1.76 s / 2.88 s / 2.56 s**. Repository
  default timeouts; no timeout override.
- `npm run typecheck`: exit **0**, all five projects (host, webview, unit,
  e2e and integration).
- `npm run lint`: exit **0**, full JavaScript/TypeScript and CSS gates.
  The existing PowerShell gate reports its Linux platform skip;
  PSScriptAnalyzer remains part of W's Windows qualification.
- Prettier on all six changed files, plain `npx knip` and
  `npm run duplication`: exit **0**; **0 clones**. Knip's existing hints
  about `vendor/**` and `axe-core` were not changed.
- `npm run check:reference`: exit **0**, generated reference current,
  **18 Devices entries**. `npm run check:l10n`: exit **0**, **14 tables**,
  **0 problems**. `npm run check:host-api`: exit **0**, **0 problems**.
- `npm run build`: exit **0**, sizes, split, host globals and notices clean.
  Existing caps retained: Devices **81.6/100 KiB**, activation
  **441.6/600 KiB**, Model API **447.3/475 KiB**, webview initial aggregate
  **738.0/900 KiB**, ACP **823.6/850 KiB**; notices cover **83 packages**.
  W still measures the joined bundle with the new factories wired into its
  entry; the lane C factories are not yet called by the product entry.

### Requests to the lead / lane W (outside lane C ownership)

- Bind one `PacedDeviceChannels` per host to the existing address-policy and
  pairing authorities. Both outbound `connect` and inbound `accept` factories
  must perform TLS only after admission, honor `AbortSignal` and close a
  rejected TCP socket. Classify certificate/pin/credential failures with
  `DeviceChannelDialFailure('authentication')`; network resets are transport
  failures. Do not feed the phase-1 transport's generic normalized error into
  this distinction. Select one connection initiator per pair and reuse an
  accepted channel for all local callers.
- The shared `DeviceReady` input requires the current receiver incarnation.
  R/W must bind it from an authenticated exchange before opening carriage,
  rather than synthesize an id or adopt an old attempt. Lane 0 should settle
  an initial-incarnation bootstrap/negotiation contract if the joined driver
  cannot supply this input; that shared-file change is deliberately not made
  by C. The new product-owned packet/message schemas are in `channel.ts` for
  review; no lane-0 cap, pacing helper or version literal was redefined.
- R binds durable receive/ack/result handlers and reconnect resends. Transport
  acknowledgements are per-stream/channel; epochs, application deduplication,
  result settlement and liability stay in R's durable authorities.
- W connects pressure/unknown/authentication facts to the existing localized
  UI and an explicit consent action before `retryAuthentication(..., true)`,
  updates CHANGELOG/feature reference/docs in its owned regions, measures the
  fully wired lazy bundle and runs the joined-tree `npm run quality`,
  coverage, installed-host and packaged qualification. This lane makes no
  new installed-host support claim.

## Lane C fix (RVM100P2C): two P2 findings made structural

2026-10-08, kubuntu rig, worktree `/home/randy/lanes/FIXM100P2C`,
branch `m100/p2-c-fix`, base `59253a397`. Review
`/home/randy/lanes/_ctx/codex/RVM100P2C.report.md`; shared rules
`/home/randy/lanes/_ctx/codex/M100P2-common.md`. Changed only lane C's
files (`src/core/devices/channel.ts`, `src/host/devices/deviceChannel.ts`,
`test/unit/channel.test.ts`) plus this section. No live model calls:
model attempts **0**, inference spend **0**.

- P2 concurrency/lifecycle (`deviceChannel.ts:699`): an unsettled outbound
  retry still waiting for backoff adopts the owner's current receiver
  incarnation (`isWaitingOutboundRetry`: outbound call, outbound job, not
  running, no channel, unsettled) instead of rejecting `unknown` and
  redialling the stale id until close. A live/pending channel and a dial
  in flight still reject `unknown`; the closed-channel, settled-inbound
  and authentication-lockout paths are unchanged. Regression:
  `channel.test.ts` `lets an unsettled outbound retry adopt a restarted
receiver incarnation` — shares the pair promise and the retry dial
  announces the new incarnation.
- P2 validation/security (`channel.ts:237`): `checkedMessage` binds result
  and result-ack `identity.receiverIncarnationId` to the channel, the same
  way the packet header and frame body are bound. Envelopes naming another
  incarnation refuse with `invalid-frame` before queueing or delivery.
  Regression: `channel.test.ts` `rejects result and result-ack envelopes
naming a different incarnation` — mismatched result and ack refuse while
  same-incarnation envelopes still enqueue.

### Test-fire proof (base `59253a397`, new tests run before the fix)

`npx vitest run test/unit/channel.test.ts --maxWorkers=3 -t <name>`,
repository default timeouts, no `--testTimeout`. Both new tests fail on
the base: the incarnation test with `expected [Function] to throw an
error` (foreign result enqueues), the retry test with `expected
Promise{…} to be Promise{…}` and the second connect rejecting `unknown`
from `request` (`deviceChannel.ts:701`). On the fixed tree the owning
files are 43 passed (24 + 19).

### Guard drills (break the fix on purpose, restore byte-exact)

- Core: remove both `incarnation = …receiverIncarnationId` bindings →
  `rejects result and result-ack envelopes naming a different
incarnation` fails, 1 failed / 23 skipped. Restored byte-exact:
  `00a091bc1ca02193ab6db25cbd090330d379bc7cc2cade17e39eb631f5df168c`.
- Host: remove the `isWaitingOutboundRetry` admission → `lets an
unsettled outbound retry adopt a restarted receiver incarnation` fails,
  1 failed / 23 skipped. Restored byte-exact:
  `f211509b87bd6fabc4ed0d3bb850d4c7f60ab0637aeaf0ca97739b1682aedbe9`.

Fix commit `d6eb2a510` (hooks on): both findings plus both regressions.
This section is committed separately below.

### Verification (worktree, `CI=true` unless noted, default timeouts)

- Three consecutive runs of `npx vitest run
test/unit/channel.test.ts test/unit/deviceMultiplexedChannel.test.ts
--maxWorkers=3`: **43 passed each**.
- `npm run typecheck`: exit **0**, all five projects. `npm run lint`:
  exit **0** (PowerShell gate reports its Linux platform skip).
- Prettier on all three changed files: clean. Plain `npx knip`: exit
  **0** (only the pre-existing `vendor/**` and `axe-core` hints).
  `npm run duplication`: **0 clones**. `npm run check:reference`: current,
  **18 Devices entries**. `node scripts/check-l10n.mjs`: **14 tables**,
  **0 problems**. `npm run check:host-api`: exit **0**, **0 problems**.
- `npm run build`: exit **0**, caps unchanged (Devices **81.6/100 KiB**,
  activation **441.6/600 KiB**).
- Fresh-clone receipt: `/tmp/fixm100p2c-verify`, cloned from this
  worktree at `196aabe36`, `CI=true npm ci` exit **0** (Node **24.18.0**,
  npm **12.0.1**). Three consecutive runs of the two owning files:
  **43 passed each**, default timeouts. `npm run typecheck` (0 errors),
  `npm run lint`, prettier on the four changed files, plain knip
  (0 errors), duplication (**0 clones**), `check:l10n` (**14 tables**,
  **0 problems**), `check:host-api` (**0 problems**), `npm run build`
  (all budgets ok, Devices **81.6/100 KiB**): all exit **0**.

## Lane U — Devices UI phase 2 (M100P2U, 2026-10-07)

Worktree `/Users/randy/lanes/M100P2U`, branch `m100/p2-u`, base
`466a7a8e4` (phase-2 integration with lanes 0 and C). Lane D's
`encodeQrInviteText` is not on this base, so its text contract is faked
as the canonical JSON of the public invitation; lanes A, K, V and H
outputs are faked by the panel setup facts, which lane W wires to the
real host. Model attempts **0**, inference spend **0**. No dependency
installed.

New views (exclusive): `src/webview/models/sections/devices/qr/`
(`inviteText.ts`, `encoder.ts`, `QrFigure.tsx`), `discovery/`,
`grants/`, `prompts/`, `power/`, `setup/`. Mounts (add-only):
`DevicesView.tsx` (phase-2 sections behind the same action-bound setup
as the card) and `DevicesApp.tsx` (lazy `qr/` chunk behind `renderQr`).
Panel (add-only, `src/shared/devicesPanel.ts`): one added message kind
`revokeGrant`, plus strict optional setup facts `discovery`, `owners`
(4 max, 16 grants max, reusing lane 0's `deviceGrantSchema`),
`capability`, `throttled`, `stepUp` and `grantRefusal`. Strings
(add-only): 17 Devices keys in `en.ts`, all 14 `l10n/ui.*.json` tables
(real translations; `CPU`/`Disk`/`Repository`/`Quota` loanwords
allowlisted per locale in `untranslated.json`), plus
`qrQuietZoneModules: 4` in `DEVICE_LIMITS`. Harness (add-only):
`devices-qr`, `devices-discovery`, `devices-owners`,
`devices-prompts-narrow`, `devices-power`, `devices-blocked` scenes,
fixtures, a `revokeGrant` reply branch and the `SCENARIOS`/`SIZED`
entries.

1. **QR and text fallback** (`QrFigure.tsx`, `inviteText.ts`,
   `encoder.ts`): the encoder gets `fakeQrInviteText` output byte for
   byte (test compares); dark `#000000` modules on a fixed `#ffffff`
   field with a four-module quiet zone in every theme including hc-dark,
   `role="img"` with the `qrCodeName` accessible name; the selectable
   text and `copyInvitation` button are always rendered and focusable,
   never behind a toggle. The strict invitation schema refuses a planted
   `privateKey`, so no secret reaches the view.
2. **Discovery switch** (`DiscoveryDetails.tsx`): off by default
   (`discoveryDefault: false`; rendering with discovery off sends no
   request — `port.request` uncalled). The details name the exact opaque
   service id, port and protocol version and that discovery grants no
   trust.
3. **Owners and grants** (`OwnerGrants.tsx`): up to 4 owners × 16 grants
   (the schema refuses wider shapes before display), each grant showing
   role, mode, repository, lanes/checks, quota and expiry with a revoke
   action sending the one added `revokeGrant` kind. `grant-expired` →
   `grantExpired`, `owner-mismatch` → `ownerMismatch`
   (`grantRefusalText`; revoked → `revokedHelp`, all else → `grantHelp`).
4. **Per-action prompts** (`ActionPrompts.tsx`): `stepUpWaiting` names
   the device (the `waitingApproval` device name stays covered on
   `DeviceCard`); the prompt view renders no button, so no orchestrator
   control answers a presence prompt.
5. **Power and pressure** (`PowerView.tsx`): `power` (ac/battery/
   unknown), `sleepInhibited`, CPU/memory/disk percents, transport
   resets, `throttled` with `throttledHelp` and `unknownSince`. The view
   renders no offline/down state (G5, G34).
6. **Blocked or unreachable** (`BlockedSetup.tsx` + card): the summary
   fills application, interface, address and port from host state;
   `blockedRecovery` adds OS-firewall and administrator steps, never
   promises prompt-free or admin-free access and changes nothing.
   Unresolved attempts and liability stay shown through every retry; an
   unbound (foreign) setup supplies no facts (phase-1 binding test
   caught this during the lane and now passes).
7. **Keyboard, themes and width**: native controls and the two-button
   decision-row contract remain. The original sandbox and fixture claims below
   were invalidated by RVM100P2U; the repair runs on unrestricted `linuxlt`.
   Real Chrome now proves all six scenes ready at 320 px, with correlated setup
   replies and peer-bound owner/prompt actions. The additional startup repair
   waits for the mounted Devices document because Devices deliberately sends
   no chat-ready handshake. Four-theme a11y/keyboard and pseudo-locale receipts
   are tracked in the review-repair record below.

### Red drills (each: break, owning tests fail, restore byte-exact)

- Message schema: drop `grantId` from `revokeGrant` → 2 failures
  (revoke send + missing-grant refusal). Restored:
  `9548bcaf8908ff41d08a872b8434128be6cd6d39cc0dd268e96364c5f78c1273`.
- Focus label: remove the QR `aria-label` → 2 failures (quiet-zone
  render + keyboard text test). Restored (plus the staged lint fix
  re-applied after an over-broad `git checkout --` reverted it):
  `e0358bdca8e31fb59507873f83ab61532e99d0f6707ed7015728fe17881c6e33`
  pre-drill.
- Status mapping: `grant-expired` → `grantHelp` → 1 failure.
  Restored:
  `8259cba496e5241f68eefddc750e94909253c18804afba829a739909e47d285b`.
- Recovery mapping: throttled renders `offline` → 1 failure.
  Restored:
  `fb488b6fe16932561766150162b704dc467f400093e23df7ab44c1d4035fa04b`.

### FIXM100P2U — review round 1 repair (2026-10-07, linuxlt)

The original successful-build and schema-only harness receipts are superseded:
RVM100P2U reproduced an unlisted QR surface, invalid initial setup, unbound
owner/prompt actions and no real-browser readiness. This record reports the
repaired committed tree. Shared-file approvals come from the rig brief;
`qrcode-generator@2.0.4` remains lane W's install, with no dependency change here.
No model attempts, inference spend, real pairing or non-loopback listeners.

| Finding | Root repair and regression                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 P2    | `scripts/lib/webviewBundles.mjs`: QR inventory derives into the split gate, separate 25 KiB cap; `webviewBundles.test.mjs` proves complete closure and unchanged 50 KiB legacy/Devices caps with Windows paths.                                                     |
| 2 P2    | `test/harness/index.html`: initial states omit setup, replies alone supply correlated facts; `devicesPhase2Harness.test.mjs` tests all six actual fixture declarations and Chrome readiness. Devices startup waits for its mounted document rather than chat-ready. |
| 3 P2    | Owner/step-up harness scenes click peer-bound Pause; same suite asserts selectors and real owner/prompt readiness.                                                                                                                                                  |
| 4 P2    | `DeviceCard.tsx` receives the observation independently of action facts and matches its pair; combined `devicesPhase2Views.test.tsx` tests matching and foreign throttles, status and unknown time.                                                                 |
| 5 P2    | `DevicesView.tsx` mounts `OwnerGrants` for a bound refusal alone; same suite tests revoke then refusal-only `grant-expired` and `owner-mismatch`, with no stale revoke button.                                                                                      |
| 6 P2    | `OwnerGrants.tsx` labels all six quota dimensions using existing translations and Intl formats; two grants differing only in heavy checks/artifact bytes visibly differ.                                                                                            |
| 7 P2    | `QrFigure.tsx` clamps SVG width and auto height, preserves aspect ratio/viewBox/quiet zone; unit regression plus real 177-module matrix in a 320 px harness.                                                                                                        |
| 8 P3    | `DevicesApp.tsx` skips QR rendering/import without an encoder; configured QR announces loading, keeps selectable text, reports failure with Retry, and owns a fresh lazy intent on the next Pair. `devicesQrLoading.test.tsx` and `DevicesApp.test.tsx` prove it.   |

**Base failures on `025b3accc`, before implementation changes:** existing
phase-2 suite plus six regressions **5 failed / 22 passed**; budget suite
**1 failed / 12 passed**; corrected QR lifecycle suite **2 failed / 1 passed**;
App suite **1 failed / 19 passed**; harness suite **14 failed / 1 passed**
(5 initial snapshots, 2 peer actions, all 6 scene readiness and the large-QR
browser case). Combined: **23 failed / 55 passed**, five files. An initial
loader assertion compared JSON property order and caused one extra unrelated
failure; corrected to semantic invitation equality and rerun on unchanged base.
The QR browser base readiness failure also exposed the missing document startup;
the responsive drill below independently proves the actual width guard fires.

**Drills:** each temporarily removes a guard, runs its targeted test (or real
split gate), checks nonzero exit, then restores exact source bytes and confirms
SHA-256. Target selection excludes unrelated cases; final owning verification
runs every test without selection, skips or timeout overrides.

| Drill        | Red result                 | Restored SHA-256                                                   |
| ------------ | -------------------------- | ------------------------------------------------------------------ |
| 1-budget     | split gate failed (exit 1) | `a4dfe9ab8ebd21905470e4f81a11755c4126f6fa8d44717b357b0066bf82e16c` |
| 2-initial    | 6 failed                   | 9 skipped (15) (exit 1)                                            | `87c78e0044cb41ee438ad2f9f912004eb98b92927fca0d9a952cb1d0d1435269` |
| 3-binding    | 1 failed                   | 1 passed                                                           | 13 skipped (15) (exit 1)                                           | `87c78e0044cb41ee438ad2f9f912004eb98b92927fca0d9a952cb1d0d1435269` |
| 4-throttle   | 1 failed                   | 1 passed                                                           | 25 skipped (27) (exit 1)                                           | `62b7a0e5e38b54bf3bc66109897913c655a2bf8cc694bcbe34780fe4bf132219` |
| 5-refusal    | 2 failed                   | 25 skipped (27) (exit 1)                                           | `62b7a0e5e38b54bf3bc66109897913c655a2bf8cc694bcbe34780fe4bf132219` |
| 6-quotas     | 1 failed                   | 26 skipped (27) (exit 1)                                           | `7d06b97407b5f73e4f33a78e44c9c2f63c082c405f33bac3565281bd5d304495` |
| 7-responsive | 1 failed                   | 14 skipped (15) (exit 1)                                           | `6fe55fdaece29a492df162bc1d62256d51c03fe5290c976925512c71a3760e1d` |
| 8-next-pair  | 1 failed                   | 2 skipped (3) (exit 1)                                             | `f5cc7e1435bd465dd2fe97f973144be0c0b261fa3ae470d9555a5abcf675b0fe` |
| 8-no-encoder | 1 failed                   | 19 skipped (20) (exit 1)                                           | `f5cc7e1435bd465dd2fe97f973144be0c0b261fa3ae470d9555a5abcf675b0fe` |

**Worktree receipts:** five typechecks and changed-file ESLint exit 0.
Production `npm run build` exit 0, caps unchanged: chat startup **733.9/900
KiB**, legacy deferred **31.9/50 KiB**, Devices browser **40.1/50 KiB**,
QR **0.9/25 KiB**, host Devices **82.2/100 KiB**. The approved encoder's
21,323-byte estimate plus the figure fits the new 25 KiB budget, but its
installed measurement remains W's responsibility. All six Chrome scenes and
large-QR measurement pass; restored owning batches pass **43 + 113 = 156 tests**, without test selection or timeout overrides. Plain knip (two inherited hints), duplication (**0 clones**), l10n (**14 tables, 0 problems**), reference and host API all exit **0**.

**Fresh clone:** required next: `npm ci`, `CI=true`, six owning files three
full passes at repository deadlines, five typechecks, changed-file ESLint and
prettier, plain knip, duplication, l10n, reference, host API, production build,
six-scene a11y and Devices keyboard. Results are added after the first code
commit; nothing pending is reported as certified.

### Lane W handoff: approved QR encoder dependency (not installed here)

- Purpose: encode the exact public invite text (`fakeQrInviteText`
  output) into a module matrix inside the lazy `qr/` chunk, behind the
  `QrEncoder` interface (text in, matrix out); tests inject a fixed
  matrix. The text fallback is complete and is what ships meanwhile.
- Package: `qrcode-generator@2.0.4`, MIT, zero dependencies, no peers,
  its own types, no network or native code (lane D's measurement).
- Size: 21,323 bytes minified into the lazy chunk; Devices closure
  measures **40.1/50 KiB**, chat startup **733.9/900 KiB** on the repaired tree.
- Peers/dependencies: confirmed empty by `npm view
qrcode-generator@2.0.4` on 2026-10-07 (`dependencies {}`,
  `peerDependencies {}` print nothing; `license MIT`, `version 2.0.4`,
  unpacked 555,539 bytes for the whole package). At install time still
  run `npm audit` and add the third-party notices entry per AGENTS.md
  rule 9.

### Further requests to the lead

- Lane W: wire the real `discovery`, `owners`, `capability`,
  `throttled`, `stepUp` and `grantRefusal` host values behind the new
  setup facts; adopt or replace `fakeQrInviteText` with lane D's
  `encodeQrInviteText` (byte-for-byte contract above).
- Lane W retains real-host wiring, the actual encoder install/measurement and
  installed-host/four-device qualification. The repair's fresh-clone browser,
  a11y and keyboard receipts replace the original sandbox-blocked requests.
