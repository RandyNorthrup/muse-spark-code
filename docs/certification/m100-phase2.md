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

## Lane H — Windows worker host (M100P2H, 2026-10-07)

Worktree `C:/lanes/M100P2H`, branch `m100/p2-h`, base `466a7a8e4`, on the
Win11 rig. Read the rig brief, phase-2 shared rules, PLAN's ownership and
acceptance section, planning record and threat model before implementation.
No models, paid calls, real-device pairing, network listener, registry write,
OS policy change, dependency addition, push, merge or rebase. M27's
`shellJob.ts`, `MuseSparkJob.cs` and M50's shared helper remain byte-identical.
Full joined quality, packaging, reference/docs changes and production wiring
remain lane W's exclusive work.

### Acceptance mapping and remaining work

| Brief item              | Windows implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Own context          | `deviceWorkerNative.ts` creates one on-demand Task Scheduler task with the current user's interactive token, no trigger and no service. `MuseSparkDeviceWorker.cs` refuses session 0/noninteractive stations, creates a private desktop and a named no-breakaway job. `DeviceWorkerHost.start` checks the reported context against the transport before the activation file permits any child. Fake transport/noninteractive refusals and real private-task tests pass. Context drill fails. | Windows done; Linux/systemd and macOS/launchd drivers and real platform receipts outstanding.                                   |
| 2. Desktop heap         | Signed and unsigned `STATUS_DLL_INIT_FAILED` exits become typed `unsupported-host`/`desktop-heap` failures with recovery prose in all 15 languages. One launch only; pressure callback reports the signal to V/M107 and does not change a cap. Registry-write spy stays zero; native source check rejects registry/policy mutation APIs. Silent-retry drill fails.                                                                                                                           | Windows done; scheduler startup heap refusal is verified with a fake last-exit status.                                          |
| 3. Recorded environment | Uses M96's canonical `workerEnvironment` with no passthrough names. The environment is recorded before launch; PATH resolution and the caller's hook-binary verifier both run before start. Actual empty-PATH and fake missing/unverified-hook cases keep launch count zero. Credential-fence and preflight drills fail.                                                                                                                                                                     | Host port done; W must bind a durable local environment record and M96's verified command/controlled boundaries.                |
| 4. Structured result    | Native helper owns explicit NUL stdin, bounded stdout/stderr pipes, suspended creation, assignment and resume. Only the exit-code-plus-JSON stdout channel supplies a result; banners on stderr do not. PowerShell commands get per-process Bypass and `-InputFormat None`; no `Set-ExecutionPolicy`. Zod validates native queries/exits and existing device schemas validate usage/artifact results. Stderr-result and output-cap drills fail.                                              | Windows done.                                                                                                                   |
| 5. Sleep and power      | Each active native helper holds `SetThreadExecutionState(CONTINUOUS \| SYSTEM_REQUIRED)` through observed whole-job exit; finally clears it, and OS thread teardown releases it on helper loss. Host reference count lasts through overlapping retirements; failed power reads stay unknown. Real awake/accounting/cancel tests and fake overlap/helper-loss tests pass. Drop-last-release drill fails.                                                                                      | Windows done; Linux inhibitor/macOS caffeinate and their native receipts outstanding. No battery admission policy was invented. |
| 6. Helper self-test     | Source-digest build through existing `compileJob`; per-factory cached self-test exercises suspended launch, job assignment/resume, observed empty job, context, CPU/peak-memory query and power, and reports only `jobProbe` with `scheduler: 'untested'` (see the attempt-caps addendum). Failed/corrupt helpers refuse without fallback. The real corruption case and fake failed-self-test case pass; bypass-self-test drill fails.                                                       | Windows done; scheduler launch permission is exercised by native tests, not by the primitive self-test itself.                  |

`retirement` is never resolved by cancellation, a deadline, helper/task disappearance
or direct-parent exit. The native accounting query must observe zero active
processes in the whole job. A real detached descendant finishes after its parent;
removing that guard makes its marker assertion fail. Helper loss rejects as
uncertain and retains occupancy. Whole-job cancellation uses `TerminateJobObject`,
never taskkill/PID-only tree termination. Suspended, unassigned children are
terminated before they can run. Kill-on-close covers helper death. The native
process ceiling is the attempt's admitted `caps.processes` (amended below in
"Launch contract: attempt caps"; this commit used the shared maximum); the
retained-attempt directory ceiling uses the unchanged shared `DEVICE_LIMITS`;
overflow stops work. The directory allocation is serialized.

Every real test removes its own task and directory in finally; afterAll also
stops/deletes only registrations whose action names that fixture's exact temporary
directory, then asserts none remain. Three retired registrations left by the first
failed pipe experiments were identified by their fixture paths and removed. The
failure was .NET Framework's refusal to open NUL through `FileStream`; the fixed
path opens the device with `CreateFileW`. No user/other-lane task was touched.

### Intentional guard failures

All drills run complete owning files with `--maxWorkers=3`, repository defaults,
and no timeout override. Each exits 1 with an assertion failure; each modified
source is restored from its original byte buffer and its SHA-256 checked.

| Drill             | Deliberate break                                  | Failure                                                                 |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| context           | Disable Windows context comparison                | A transport-session/noninteractive launch resolves instead of refusing. |
| silent-retry      | Launch again on desktop heap failure              | Launch count is 2 instead of 1.                                         |
| hook-preflight    | Iterate zero required tools                       | Missing/unverified hook attempts start.                                 |
| sleep-release     | Remove success-path running-count decrement       | Sleep stays inhibited after the last retirement.                        |
| helper-self-test  | Bypass failed self-test guard                     | Unsupported helper starts.                                              |
| output-cap        | Remove stdout byte ceiling                        | Valid JSON padded past the cap is accepted.                             |
| credential-fence  | Record inherited environment                      | Credential/loader/agent variables enter the record.                     |
| stderr-result     | Read stderr instead of stdout                     | Banner-bearing native run has no valid JSON result.                     |
| parent-retirement | Observe direct parent instead of active job count | Detached descendant is killed before its completion marker.             |

Final-source hashes, clean-clone receipts and commit IDs follow in the final
verification addendum. Local owning tests: **28 passed**, including six actual
Windows native cases. Five typecheck projects passed before final minor lifecycle
and capacity changes; the final committed clone is checked again below. No
`--testTimeout`, gate weakening, ignored diagnostic or lint escape hatch was added.

### Requests to the lead / W / V

- Bind `DeviceWorkerHost` as `DeviceReceiverExecution`, with M96's atomic occupancy
  restoration/reservation, durable environment record, local verified command and
  every tool/model/paid boundary. The command factory receives the local boundary;
  no peer can supply a command or environment. There is no new public runtime command.
- V reads `facts()` for power and sleep state; feed `pressure('desktop-heap')` to
  M107 as a pressure observation. Per-job accounting reports CPU in 100 ns units and
  **peak** committed memory, explicitly named `peakMemoryBytes`; current memory is
  not claimed. The governor owns any slot-cap decision.
- W must ship the new native C# asset, bind its trusted `sourceFile` and private
  storage, measure the fully wired lazy Devices bundle, update its owned CHANGELOG,
  README and feature reference, and run joined quality/installed-host checks.
- Complete and qualify Linux transient user units with a cgroup retirement proof
  and `systemd-inhibit`; complete and qualify macOS per-attempt launchd jobs with
  a whole-descendant retirement proof and `caffeinate`. This Windows-only rig has
  no real systemd/launchd runtime; fake platform port tests are not native receipts.
- Proposed battery policy for owner decision: keep already admitted work owned,
  and ask locally before admitting new heavy checks on battery. No policy is
  implemented here; unknown power must stay unknown.
- Qualify scheduler-specific self-test, private storage ACLs and native helper-death
  recovery before enabling the production offer. These are open, not support claims.

### Final committed-code verification

Implementation commit **219c8164e**; native-test setup deduplication
**9e6915957**, both with hooks enabled. The latter changes tests only; all
production source hashes are identical in both commits and in the CI clone.
All twelve final red drills exited **1** with test failures, then restored
the source byte-exact. In addition to the nine drills above:

| Drill         | Deliberate break                               | Failure                                                     |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| attempt-cap   | Disable retained-directory ceiling             | Allocation reaches the helper instead of refusing capacity. |
| unknown-power | Turn a failed reading into AC                  | Unknown-power/helper-loss facts fail.                       |
| cancel-race   | Remove cancellation check after pending launch | A cancelled attempt activates.                              |

SHA-256 values checked before and after each corresponding drill:

- Host: 5034f45b402d58fc3243d9c6bf8894f4a37e01b07c201944080a2a088ba9cdab.
- Native driver: da83342cd3c0470b70a3e257f990a0a5a0f0ccfbcd70c94c51dcb446f6e45462.
- C# helper: 8a44391400dd3bd0c47abcbe7bf29fa7cb4712802e3832c82e4d09112629414c.

Fresh local Git clone at temp/m100h-verify, Node **24.21.0**, npm **11.19.0**.
CI=true npm ci exited **0**; no dependency or lockfile change. Install
reported the pinned tree's 11 audit vulnerabilities (2 low, 9 high); joined
audit/security qualification remains W's responsibility. No audit fix was run.

On committed implementation **219c8164e**, with CI=true:

- Complete owning files three consecutive times: **28 passed each**,
  **12.37 / 11.59 / 11.57 seconds** total Vitest durations. Windows' actual
  repository defaults on this base are 15 seconds per test, 30 per hook;
  this lane never changes or overrides them. All six native cases ran on Windows.
- All five typechecks: **exit 0** (148.8 seconds). Full lint including Windows
  PSScriptAnalyzer: **exit 0** (388.9 seconds). Changed-file Prettier: **exit 0**.
- Plain knip: **exit 0**. Reference: **exit 0**, 18 Devices entries.
  Localization: **14 tables, 0 problems**, exit 0.
- Build: **exit 0**, including sizes, splits, host globals and notices.
  Devices **81.7/100 KiB**, activation **462.8/600 KiB**, Model API
  **456.0/475 KiB**. Every cap unchanged. This measures the existing entry
  plus new English text; W must measure the newly bound host factory.
- Duplication initially **exit 1**: native-test launch setup repeated 11 lines,
  58 tokens. Follow-up shares that setup, preserving every test, assertion and
  deadline. No ignore or threshold change.
- Host API **exit 1** solely for W's stale generated Node import counts.
  **366 VS Code APIs, 43 vscode-importing files, 28 Node built-ins, 70 theme
  variables** unchanged. Needed row updates: child_process **16→17**, crypto
  **93→94**, fs **44→45**, fs/promises **74→76**, path **125→127**,
  timers/promises **15→16**. W owns the file: regenerate with
  npm run check:host-api -- --write after integration, review/commit it and
  rerun the check. This lane did not edit that file or weaken the gate.

The clean CI clone fetched the committed test-only follow-up locally and
switched to detached **9e6915957**, without a merge, reset or rebase. Three
more complete owning runs: **28/28 each**, default deadlines,
**11.62 / 11.63 / 11.60 seconds**. Duplication: **0 clones**, exit 0. Unit
typecheck: **exit 0**. The hook passed changed-test lint and formatting.
Production source hashes and lockfile stayed unchanged from the full clone
checks. The outstanding gate is W's host API inventory update; Linux/macOS
drivers and qualification remain outstanding as mapped above.

No push or model call. This is a Windows implementation with receipts, not a
claim that the entire phase-2 host lane or installed-host qualification is
complete. Full quality remains delegated to W by the shared lane brief.

### Launch contract: attempt caps (M100P2H-CAPS, 2026-10-08)

Branch `m100/p2-h-caps` from `f4f6f3008`, worktree `C:/Users/Randy/Coding/mx-m100hcaps`
on the lead's Windows host. It answers the Linux continuation's lead request
(M100P2HL, `78258096a` on `m100/p2-h-linux`) and folds in the three RVM100P2H
review findings, which touch the same files.

**Decision (lead).** `DeviceWorkerDriver.launch(command, env, attempt)`, where
`attempt: Readonly<Pick<DeviceDispatch, 'identity' | 'caps'>>` (exported as
`DeviceWorkerAttempt`). The host builds it at its only launch call from the
request it already parsed with `deviceDispatchSchema`, as frozen copies, so no
driver can edit the host's record and nothing peer-supplied beyond the
validated identity and caps reaches a driver. No protocol field was added and
every shared ceiling is unchanged.

- Drivers enforce the admitted `caps.processes`. `admittedProcessLimit` (host
  port) returns it, or refuses with typed `unsupported-host` (detail
  `preflight`) when it is outside 1..`DEVICE_LIMITS.processes`. The Windows
  driver calls it first, before any helper call or attempt directory, and
  writes it as the job's `ActiveProcessLimit`. Previously the job used the
  protocol maximum (128) for every attempt.
- The other caps travel for drivers that can enforce them. None is an OS
  process property on Windows: worker/check occupancy is the reservation's,
  tokens and spend are M96's paid boundary, artifact bytes the result
  validation. A future driver that is handed a cap it cannot enforce refuses
  with `unsupported-host` rather than ignoring it (stated on the port).
- CPU and memory are not caps and were not added: the receiver's M107 resource
  governor owns them.
- The Linux driver can now apply the admitted process/task ceiling to its
  transient unit and call the same `admittedProcessLimit` refusal before
  activation. No Linux or macOS driver is part of this change.

**Review findings folded in (RVM100P2H, Grok, range `466a7a8e4..f4f6f3008`).**

1. P2, pre-job failures were journaled as completed work. A start that failed
   before a job existed (failed self-test, hook preflight, a launch refusal
   such as the scheduler's `STATUS_DLL_INIT_FAILED` or an unenforceable cap)
   resolved `retirement` with the reservation usage, so `DeviceReceiver`
   journaled `retired` and released occupancy as finished work. Now the host
   settles every no-job path (pre-job failure and cancel-before-start) as
   `{ refused: true, usage }`. `DeviceLocalAttempt['retirement']` gains that
   variant, and the receiver journals it with the existing terminal state
   `refused` (occupancy zero, no artifact), then releases the reservation once
   as not-run work. The dispatch reply is unchanged (`uncertain`, because
   admission was journaled) and reconciliation returns the `refused` outcome.
   This touches `deviceReceiver.ts` (lane E's) only in the retirement type and
   the terminal-state choice in its `retire` effect.
2. P3, the helper self-test overclaimed. `--self-test` printed `launch: true`
   after an in-process CreateProcess/assign/resume probe that never used Task
   Scheduler or the session/station refusal. It now prints
   `{ jobProbe: true, query: true, power, scheduler: 'untested' }`, and
   `selfTestSchema` accepts only that shape, so an answer claiming a scheduler
   launch is refused. Scheduler launch remains qualified by each real launch
   and the native tests, not by the self-test.
3. P3, the compile ran under the helper's frame deadline. `isPrepared` passed
   `deps.run` (10 s frame deadline) into `compileJob`. The compiler is now a
   separate optional `compile` dependency; production omits it, so
   `compileJob` uses its own runner and `PROCESS_TABLE_TIMEOUT_MS`. No
   deadline was raised.

Files: `src/host/devices/deviceWorkerHost.ts`, `src/host/backend/deviceWorkerNative.ts`,
`native/windows/MuseSparkDeviceWorker.cs`, `src/host/devices/deviceReceiver.ts`,
`test/unit/deviceWorkerHost.test.ts`, `test/unit/deviceWorkerHostNative.test.ts`
and this record.

Implementation commit **b4edab744** (hooks on: lint-staged eslint/prettier and
staged gitleaks exited 0; the index was unchanged by the hook). Final
SHA-256: host `22beef265def4c1a1b45fd4efcfdad396671a084ae8659f8c969a231df95337a`,
Windows driver `64de6c31400f536e7457d2377952f596ee2d68eaef64a6bfc6d220e0d3e2453f`,
C# helper `d7a760a5389f045795ebd1b2b7de8486c5030d0aab8190d89a2bd1fc7ad21490`,
receiver `fbcc6bb0ce8c79187b136875bf67ca0d79fdaa5be56bbe293c532a9293a91cde`.

#### Tests

| Test (owning files)                                                                          | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| passes each simultaneous attempt only its own validated identity and caps                    | Two attempts started together (`processes` 1 and 128) reach the fake driver, which records every launch's third argument, each with exactly its own identity and caps, frozen.                                                                                                                                                                                                                                                                       |
| the Windows driver bounds each simultaneous job at its own admitted cap                      | Two simultaneous real-driver launches over a fake helper write `maxProcesses` 1 and 128 into their own request files.                                                                                                                                                                                                                                                                                                                                |
| the Windows driver refuses an admitted process cap of 0 / 129 before any helper call         | Typed `unsupported-host`/`preflight`; no helper call, no attempt directory.                                                                                                                                                                                                                                                                                                                                                                          |
| an admitted zero-process attempt is refused before launch or activation                      | Through the host: `start` refuses, the helper sees only the transport query, retirement settles `refused`.                                                                                                                                                                                                                                                                                                                                           |
| limits the OS job to the admitted process cap and the OS refuses a child beyond it (native)  | Before activation a compiled probe opens `Global\MuseSparkDevice-<id>` and reads JOBOBJECT_EXTENDED_LIMIT_INFORMATION: flags `0x2008` (kill-on-close, active-process) and **ActiveProcessLimit 2**, the admitted cap. After activation the script and its held child fill the job, the third `CreateProcess` is refused by Windows (libuv reports the job-quota error as `UNKNOWN`), and once the held child exits the same spawn succeeds (exit 0). |
| the receiver journals … as refused not-run work and releases it once (four cases)            | Real `DeviceReceiver` and `AttemptJournal` over the real host: failed self-test, failed hook preflight, scheduler heap failure at launch, unenforceable cap at launch. Each journals `refused` with zero occupancy and the reservation usage, releases once, never activates; reconciliation returns `refused`.                                                                                                                                      |
| existing host tests (hook preflight, unverified hook, failed self-test, cancel-before-start) | Now assert `{ refused: true, usage }` instead of awaiting retirement blindly.                                                                                                                                                                                                                                                                                                                                                                        |
| a helper self-test answer of … is accepted (three cases)                                     | The old `launch: true` claim and a `scheduler` claim are refused; only `{ jobProbe, query, power, scheduler: 'untested' }` is accepted.                                                                                                                                                                                                                                                                                                              |
| compiles and self-tests … (native)                                                           | The real compiled helper's `--self-test` prints exactly that shape.                                                                                                                                                                                                                                                                                                                                                                                  |
| compiles with compileJob's own runner, never the frame-deadline helper runner                | Without an injected compiler the helper runner sees no compile; with one, the compile goes only there and the helper runner sees only `--self-test`.                                                                                                                                                                                                                                                                                                 |

A temporary, uncommitted diagnostic on the lead's host launched one script at
caps 2, 3 and 128: at 2 the third process was refused, and at 3 and 128 it
ran, matching the committed native case.

Regression proof against **f4f6f3008**: the new portable owning file run
against the unchanged base sources fails **18 of 35**: every caps case, all
four receiver cases and four retirement assertions (finding 1), the
accepted-shape case (finding 2) and the compile-runner case (finding 3). The
native helper-JSON assertion fails on the base by construction (it prints
`launch: true`).

#### Red drills

Complete owning files, `--maxWorkers=3`, `CI=true`, repository default
timeouts, on the Win11 rig at b4edab744. Each break exited **1** with
assertion failures, and each source was restored from its original buffer and
its SHA-256 checked (all byte-exact; worktree clean afterwards).

| Drill                  | Deliberate break                                          | Failed tests                                                                                                                                             |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| caps-global            | Windows job `maxProcesses: DEVICE_LIMITS.processes` again | 2: simultaneous real-driver caps; native ActiveProcessLimit/OS refusal (probe reads 128).                                                                |
| drop-attempt           | Host launch call without the attempt argument             | 5: simultaneous attempts, credential-free environment and PowerShell launch arguments, zero-process host refusal, native private-desktop host run.       |
| prejob-retired         | Host pre-job catch resolves `{ usage }` again             | 8: all four receiver cases and four host retirement assertions.                                                                                          |
| receiver-retired       | Receiver journals every retirement as `retired`           | 4: all four receiver cases.                                                                                                                              |
| selftest-overclaim     | Schema and helper back to `launch: true`                  | 6: accepted-shape, compile-runner, heap-startup and caps real-driver cases (fake helper answers refused), zero-process host refusal, native helper JSON. |
| compile-frame-deadline | `compileJob(…, deps.run)` again                           | 5: compile-runner, accepted-shape, heap-startup, caps real-driver and zero-process cases (the fake compiler is bypassed).                                |

#### Verification

Lead's Windows host (this worktree), `CI=true`, Node 24.21.0:

- Five typechecks: host **0** (105 s), unit **0** (323 s), webview **0**,
  e2e **0**, integration **0**. ESLint `--max-warnings=0` on the five changed
  TypeScript files **0**; Prettier on them **0**. Plain knip **0** (the two
  existing configuration hints). jscpd **0 clones**. check:l10n **0 problems**.
  Production build **0**: Devices **81.8/100 KiB**, activation
  **462.8/600 KiB**, Model API **456.0/475 KiB**; every cap unchanged.
- The portable owning file passes here (35/35). **The native file could not
  qualify on this host:** other sessions held the CPU at 99-100%, scheduled
  task launches took 6-10 s each, and the native cases hit the 15 s Windows
  default. The unchanged base f4f6f3008 native file timed out identically
  here (5 of 6). These runs are recorded as failures, not passes, and no
  timeout was raised.

Win11 rig (10.10.11.183, console session active, ~5% load), worktree
`C:/lanes/M100P2HCAPS` at **b4edab744**, Node 24.21.0, npm 11.19.0,
`npm ci --ignore-scripts` exit 0:

- Owning files three times: **42/42 each** (35 portable, 7 native, none
  skipped), **23.2 / 20.7 / 18.2 s** Vitest durations, default timeouts.
- Five typechecks **0** (162.5 s); ESLint **0**; Prettier **0**; knip **0**;
  jscpd **0**; check:l10n **0**; production build **0**.
- Receiver neighbours (deviceReceiver, deviceRecovery, attemptJournal), idle
  rig: **114/115**, 14.3 s. deviceReceiver and deviceRecovery pass in full.
  The one failure is attemptJournal's "flushes admission and launch files
  before atomic replacement and directory flush" (no `directory-flush` event
  on Windows), which fails identically on the unchanged base f4f6f3008 on the
  lead's host; this change does not touch the journal. Two later reruns, made
  while the rig and the lead's host were loaded (198-215 s instead of 14 s),
  added `vi.waitFor`/socket timing failures in lane E's suites; those tests'
  leases never produce the new `refused` variant, for which the receiver's
  behaviour is otherwise byte-for-byte the old `retired` path. They are
  recorded here as loaded-host failures, not passes.

No push to origin, merge, rebase, stash, dependency, lockfile, string or
gate-threshold change, and no model call. The commit was sent only to the
Win11 rig's private gate repository for the native runs. Linux and macOS
drivers, scheduler-specific qualification and installed-host checks remain
open as mapped above.

### macOS continuation — M100P2HM (macmini, 2026-10-07)

Branch `m100/p2-h-darwin`, Windows head/base `f4f6f3008`. Read the rig
continuation, shared phase-2 rules, original H brief, PLAN ownership/acceptance,
planning record, threat model and Windows host/driver before implementation.
This subsection qualifies macOS only. Windows' six native cases are skipped
on this rig and are not counted as passes. No model, paid call, pairing,
listener, dependency, registry/policy change, merge, rebase, manual stash or push.
Shared README, CHANGELOG, feature reference, packaging and host-API record
remain W's owned files, as specified in the phase-2 ownership table.

| Brief item              | Darwin implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Own context          | `deviceWorkerDarwin.ts` bootstraps a unique, per-attempt plist into `gui/<uid>`, limited to Aqua, with `AbandonProcessGroup=false`. The launchd helper verifies parent PID 1, its own process group and a resource coalition containing only itself before readiness. Activation is a separate local gate. Missing manager/non-Aqua refusals run through the injected port; real GUI jobs run on this rig. `selectDeviceWorkerDriver` is the host's single lazy-factory selection point, exercised by native setup and portable tests, without changing the driver port.                                     |
| 2. Host pressure        | Process-creation `EAGAIN`/`ENOMEM`, native launch pressure, bounded-output pressure and retained-attempt exhaustion become typed `capacity` failures with existing `devices.capacityHelp`; unsupported launches use the existing `unsupportedHost` prose. Host result handling preserves these typed failures, with no retry or cap change. A cold factory at the retained-attempt cap refuses before bootstrap. Existing Windows desktop-heap behavior is preserved.                                                                                                                                        |
| 3. Recorded environment | The unchanged host path records canonical M96 `workerEnvironment` before launch, after executable/PATH and hook verification. Darwin sanitizes again before persisting the local request and passes that exact environment through native `posix_spawn`, with explicit file actions. Missing/unverified hook tests and the actual stdin/JSON run with hostile loader and unapproved variables pass. Plists/requests are private; helper writes use umask 0077. The root is owner-only 0700, rejects symlinks and ownership/mode mismatches. Reads are bounded and use canonical BigInt file identity checks. |
| 4. Structured results   | `/dev/null` stdin, independent capped nonblocking stdout/stderr pipes, and a capped exit-code-plus-JSON envelope. Stderr cannot supply a result. Query/readiness/count/result boundaries are parsed with zod; the host validates JSON usage/artifacts with the existing schemas. Real stdout/stderr floods stop the unit; escaped JSON cannot enlarge the stored result past the frame cap.                                                                                                                                                                                                                  |
| 5. Sleep and power      | A real `IOPMAssertion` prevents user-idle system sleep while the helper observes all descendants. Native `pmset -g assertions` proves acquisition/release, including overlapping attempts and helper death. `IOPowerSources` reports AC, battery or unknown; injected battery/unknown readings remain those values and do not cancel admitted work. The approved admission question for new heavy checks on battery/unknown stays W's responsibility.                                                                                                                                                        |
| 6. Factory self-test    | A source-digest, compile-once Objective-C helper in private storage; each factory caches one real GUI bootstrap, readiness/context/assertion, native query, child execution, zero-coalition/group proof and removal. No compiler, GUI domain, usable ABI or assertion means refusal. A corrupted cached executable refuses a new factory with no bootstrap/fallback. No new public runtime command or driver-interface change.                                                                                                                                                                               |

Launchd's process-group cleanup alone cannot prove that a detached descendant
retired: [Apple's launchd manual](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5)
defines cleanup of the original group. This driver additionally uses the
kernel resource coalition inherited by descendants, including setsid and
double-fork children. The private, version-sensitive ABI is explicitly
qualified by the factory and native suite, rather than assumed available:
[coalition identifiers](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h),
[resource-usage wrapper](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/coalition.c),
and [kernel count implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/sys_coalition.c).

The helper waits until the only remaining coalition task is itself. The driver
then independently requires zero kernel coalition tasks, no launchctl PID and
no remaining member of the helper's process group before resolving retirement.
Cancellation requests coalition-member termination; it never resolves the
promise. There is no retirement deadline. Helper/manager loss rejects as
uncertain and forbids `remove`, retaining evidence and receiver occupancy.
Readiness failures stop the never-activated helper and retain local evidence.
Already admitted work stays owned on battery; an unreadable power source never
becomes AC. CPU accounting includes the helper and departed children; memory
is the peak sampled sum of resident bytes, not a claimed instantaneous or
kernel lifetime peak. No slot-cap policy is invented.

Native setup shares its expensive compile/self-test in `beforeAll`; every test
uses repository deadlines without `--testTimeout`. Normal jobs cancel, await
observed retirement and remove in `finally`. The helper-loss test explicitly
recovers its exact, deliberately uncertain unit and detached PID; production
does not mark either observed. `afterAll` tracks every fixture label, removes
only its own registrations and asserts none are left. The Mac mini was on
AC (`pmset -g batt`); battery/unknown cases are injected facts, not hardware
receipts. Final drill and clean-clone receipts follow below.

Lead/W requests: bind the supplied lazy native factories and existing
`DeviceWorkerHost` port to the receiver/M96 owner; carry durable environment
recording and battery/unknown heavy-check prompts into that binding. Measure
the fully bound lazy Devices bundle and ship/qualify the compiler/helper path
without raising caps. If Command Line Tools or the private coalition ABI is
unavailable, keep the offer refused. Regenerate W's host-API inventory and
update W's README/CHANGELOG/catalog/packaging regions on joining. Linux's
systemd/cgroup implementation and installed-host/full-quality qualification
remain outside this macOS continuation.

#### Darwin guard-fire receipts

Each drill ran its complete owning test file with `CI=true`, `--maxWorkers=3`
and repository defaults. Every run exited **1** with the intended failed
assertion; no timeout override was used. Each source was restored from its
original byte buffer and its SHA-256 verified immediately after the run.

| Drill                | Deliberate break                                                                     | Observed failure                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| manager-uncertainty  | Classify failed retirement observations as helper startup refusal                    | Actual helper/manager loss has the wrong failure reason.                                            |
| retained-cap         | Remove the retained-attempt ceiling                                                  | Cold capacity case reaches the forbidden bootstrap.                                                 |
| gui-refusal          | Remove the Aqua-domain check                                                         | Non-GUI self-test reaches the compiler instead of refusing immediately.                             |
| typed-pressure       | Drop the host's capacity-result mapping                                              | Pressure is reported as uncertain, losing its recovery prose.                                       |
| hook-preflight       | Verify zero required tools                                                           | Missing/unverified hook attempts launch.                                                            |
| recorded-environment | Record the inherited environment                                                     | Canonical fence assertions fail with synthetic fixture values.                                      |
| stderr-result        | Drain stderr into stdout                                                             | The actual banner-bearing worker loses its valid JSON result.                                       |
| native-inhibitor     | Create the assertion at level OFF                                                    | `pmset` finds no active worker assertion for a running tree/overlap.                                |
| power-release-facts  | Claim inhibition after all native units retire                                       | Idle/retired and overlap facts remain true.                                                         |
| parent-retirement    | Drop the helper's descendant count and the driver's independent zero-coalition guard | Retirement beats the detached double-fork marker; the live-tree assertion disappears early.         |
| self-test            | Return true without the factory's self-test                                          | Missing/non-Aqua/corrupted helpers are falsely certified.                                           |
| structured-cap       | Omit the encoded-result ceiling                                                      | A flooded JSON envelope exceeds the bounded reader; the job cannot be reported/removed as observed. |
| last-retirement      | Omit the host's success-path count decrement                                         | Overlapping attempts still report inhibition after the last retirement.                             |

Final production source hashes, identical before and after their drills:

- Darwin: `bf9b30835834a8fc45861344576331491fbb4e2ed0b54c0b2ccbd0748cc5d4e9`.
- Host: `2d7aa2aaa669a5200cc45f9d65ce5e291348e7dd45e3cec73796b6952d5a9336`.

Local restored-tree owning suite: **39 passed**, including **12 actual macOS
cases**, **3 injected Darwin port cases**, and **24 portable host cases**;
Windows' **6 native cases skipped**, not passed. Final committed-code,
fresh-clone gate receipts are recorded in the following addendum.

#### Darwin committed-code fresh-clone verification

Implementation **715b4a7b1**, test-setup sharing **b8df233dc**, portable
POSIX-storage fixture **01dd8eb18**, all committed locally with hooks enabled.
After every hook, the empty remaining index and committed diff were reviewed;
production hashes stayed identical to the guard-fire record. The Windows
driver/helper remain byte-identical to `f4f6f3008`.

Fresh local Git clone `/tmp/m100hm-verify`, Node **24.21.0**, npm **11.19.0**,
macOS **15.7.4 / 24G517**, real Aqua domain **gui/502**. `CI=true npm ci`
in that clone exited **0**, installing the unchanged lockfile. An initial
shell command attempted installation from `/tmp` and exited 1 for its absent
lockfile; the working directory was corrected before qualification. The
pinned dependency tree reported its existing 11 audit vulnerabilities (2 low,
9 high); no dependency, audit fix or lockfile change was made. Joined security
and full quality remain W's responsibility under the shared brief.

On `715b4a7b1`, with `CI=true` and repository defaults:

- Three complete owning runs: **39 passed + 6 Windows-native skipped** each,
  Vitest durations **8.32 / 7.80 / 7.82 seconds**. All twelve macOS cases ran;
  no raised test or hook deadline.
- Five typechecks: **all exit 0** (host, webview, unit, e2e, integration;
  **82.0 seconds** combined wall time).
- Changed-file ESLint and Prettier, plain knip, reference, localization,
  cycle checks: **all exit 0**. Localization: **14 UI + 14 usage tables,
  0 problems**. Reference: **18 Devices entries**, current.
- Production build: **exit 0**, including size/split/global/notice checks;
  activation **462.8/600 KiB**, existing Devices **81.7/100 KiB**, Model API
  **456.0/475 KiB**, Devices webview **33.9/50 KiB**. Caps unchanged.
  These are the existing entry bundles; W still must measure the fully
  bound worker factories and ship/qualify the helper/compiler path.
- Duplication: initially **exit 1**, two repeated native test setup/recovery
  blocks. `b8df233dc` shares them without removing any assertion or changing
  a deadline; subsequent plain jscpd reports **0 clones, exit 0**.
- Host API: **exit 1**, solely W's stale generated Node import counts.
  **366 VS Code APIs, 43 vscode-importing files, 28 Node built-ins, 70 theme
  variables** remain unchanged. W must regenerate its owned
  `docs/ide-compatibility/host-api.md`: child_process **16→18**, crypto
  **93→95**, fs **44→45**, fs/promises **74→77**, path **125→128**,
  timers/promises **15→17**, then review/commit and rerun the check.

The clean clone fetched the two test-only follow-ups locally and switched
to their detached commits, without merging/rebasing. `01dd8eb18` models
POSIX mode bits only in the fake capacity case so it also runs on Windows;
the native cases retain real filesystem calls through the passthrough spy.
This changes no production guard or native assertion. On final code
`01dd8eb18`, three more complete owning runs with `CI=true`, default deadlines:
**39 passed + 6 skipped each**, **8.23 / 8.26 / 8.58 seconds**.
Unit typecheck, changed-file lint/Prettier, plain knip and jscpd all **exit 0**;
jscpd reports **0 clones**. All thirteen unique drills in the table fired;
the seven Darwin retirement/manager/capacity/GUI/inhibitor/release/self-test
drills were repeated after the test follow-ups, **exit 1** each, with the
same byte-exact production hashes. The host-API inventory is the sole
outstanding requested lane gate and is explicitly assigned to W.

All six Darwin acceptance items are implemented, tested and drilled. Native
receipts prove real launchd ownership, detached double-fork retirement,
bounded channels, CPU/memory sampling, actual assertion hold/release, clean
manager refusal, uncertainty on helper/manager loss, and exact registration
cleanup. They do not certify Windows/Linux, physical battery behavior,
installed-editor packaging or the fully bound production offer. No push or
model call; W's bindings, battery/unknown admission prompt, shared docs,
generated host inventory, bundle measurement and joined qualification remain
the lead requests above.

#### Darwin attempt-caps continuation — M100P2HM2 (macmini, 2026-10-08)

**Blocked: strict per-job spawn admission is not available in the existing
Darwin helper.** This continuation follows the brief's explicit fallback,
"Refuse an unenforceable cap rather than ignoring it." Real Darwin attempts
now refuse with `unsupported-host`; the earlier continuation's launch receipts
remain historical evidence and do not qualify execution under the attempt-caps
contract. The nine existing launch-behavior cases and the new cap-2 case retain
all their assertions and fail against this refusal. This is not a green lane or
a claim of macOS execution support.

Worktree `/Users/randy/lanes/M100P2HM2`, branch `m100/p2-h-darwin2`, base
`b0fe91da3`. The authorized `git merge --no-ff m100/p2-h-darwin` was committed
as **c7c3ff2e1** with hooks enabled. The host merged automatically, retaining
`DeviceWorkerAttempt`, frozen identity/caps at the launch call and all pre-job
`{ refused: true, usage }` settlements. Conflict resolution kept both host-test
imports/coverage and both certification subsections. The Windows driver/helper
and receiver are unchanged from the contract branch.

| Brief item                                                  | Result and evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge the previous Darwin driver while keeping the contract | Done: the merge has parents `b0fe91da3` and `e57306fd8`; contract launch call and pre-job settlements retained.                                                                                                                                                                                                                                                                                |
| Use the admitted process limit; refuse an unenforceable cap | `launch(command, env, attempt)` calls shared `admittedProcessLimit(attempt)` before self-test, allocation or launchctl. Caps 0/129 refuse with `unsupported-host`/`preflight` and no native calls or directories. Valid caps 1/2/128 refuse with `unsupported-host`/`helper`: no arbitrary worker is activated. Only the fixed local `/usr/bin/true` factory probe uses `rawLaunch`, at cap 1. |
| Match the helper self-test shape                            | Native `--self-test` returns exactly `{ jobProbe: true, query: true, power, scheduler: 'untested' }`, parsed with a strict zod schema. The native case checks that JSON; the factory separately tests an actual GUI launchd registration, without treating the primitive JSON as scheduler qualification.                                                                                      |
| Settle pre-job refusal as not-run                           | Native driver through the real host: `start` rejects `unsupported-host`, retirement resolves `{ refused: true, usage }`, two `release` calls invoke the reservation release once, no attempt directory remains. The joined portable receiver tests also retain the lead's four refused-journal cases.                                                                                          |
| Native cap 2: refuse third process, then admit after exit   | **Blocked.** A committed native case preserves exactly these assertions. A diagnostic temporarily allowed the existing coalition poller to launch with the actual admitted cap 2: both third spawn and retry returned exit 0; the test expected `third: 'EAGAIN'` and failed. Source restored byte-exact. An unenforceable poller is therefore not used for real attempts.                     |

**Why launchd's resource-limit keys are not used.** The installed
`launchd.plist(5)` and [Apple's launchd manual](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5)
define `NumberOfProcesses` as the simultaneous count for the UID, not this
job. [XNU's fork implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c)
checks `RLIMIT_NPROC` against `chgproccnt(uid, 1)`. A native C fixture on this
Mac sets its own soft and hard `RLIMIT_NPROC` to 2, observes more than two
already-existing UID processes, and gets `EAGAIN` for its **first** child.
It changes only the fixture process's inherited limits, not any launchd,
user, sysctl or machine setting. Adding a snapshot of other UID processes to
the cap is unsafe: those processes can exit and leave extra worker slots.

Coalition counts prove whole-descendant retirement, but polling observes
creation after it happened. The native cap-2 diagnostic proves a short-lived
third process can execute and exit between polls. Killing observed overflow
also cannot provide the required refused-spawn-then-retry behavior. No
per-job process-count admission operation is supplied by the coalition
resource-usage interface used here. No same-user limit, registry/system
change, privileged service, interposition or cooperative test shim is claimed
as a hard per-job bound.

**Guard-fire receipts.** Complete three owning files, `CI=true`,
`--maxWorkers=3`, repository default deadlines, at most three files per run.
The restored suite has ten blocked native failures; the table separates each
mutation's additional failures from those unchanged baseline failures.

| Drill                        | Deliberate break                                                                         | Additional failures                                                                                   | Exit / restoration                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| caps-global                  | Replace the attempt's process cap with `DEVICE_LIMITS.processes` at validation           | Both 0/129 cases reach native preparation instead of refusing before any call (wrong refusal detail). | Exit 1; 12 failed, 49 passed, 7 Windows-native skipped. Darwin SHA-256 restored byte-exact. This proves validation; hard native cap enforcement remains blocked. |
| drop-attempt                 | Drop the host's third launch argument                                                    | Four portable identity/environment/zero-cap cases and the new native refused-settlement case fail.    | Exit 1; 15 failed, 46 passed, 7 Windows-native skipped. Host SHA-256 restored byte-exact.                                                                        |
| native-accounting diagnostic | Temporarily permit real attempts through `rawLaunch(..., admittedProcessLimit(attempt))` | The native cap-2 test receives `{ third: 0, retry: 0 }`, rather than `{ third: 'EAGAIN', retry: 0 }`. | Focused diagnostic exit 1; Darwin source restored byte-exact. Other tests were filtered for this diagnostic only.                                                |

Restored production SHA-256 values:

- Darwin: `9682c6d5377dcbff7a9febba1400788d5ab01440aae26826e34a31b0f8bdb240`.
- Host: `6340c2feaa7dce231dee0650087e504c97c0944a3825c049e077ddd4d2082e82`.

The merged baseline, before the refusal change, ran **52 passed + 7
Windows-native skipped**, including all twelve original macOS native cases.
That baseline passes the old behavior, not the strict admitted-cap contract.
The final committed-code fresh-clone verification is recorded below.

**Lead request.** Choose a mechanism that can authorize every descendant spawn
before execution (or a separately isolated execution backend) before enabling
Darwin offers. Preserve the cap-2 refused-spawn/retry assertion. Per-UID rlimits
and a post-creation poller are not such a mechanism. Keep this lane blocked;
W still owns full quality, shared PLAN deferral entries, generated host API,
README/CHANGELOG/reference changes and installed-editor qualification. No
assertion, deadline or cap was weakened; no model call, dependency change,
push, stash command, rebase or additional merge was made.

##### M100P2HM2 committed-code verification

Implementation **de27ba82a**, merge **c7c3ff2e1**. Both commits ran the
repository hooks (lint-staged ESLint/Prettier and staged gitleaks) with exit 0;
post-hook diffs and the empty index were reread. The final production hashes
above match the committed files. The accounting diagnostic was repeated after
the final source change, again receiving `{ third: 0, retry: 0 }` and restoring
the Darwin file to that exact hash.

Fresh local Git clone `/tmp/M100P2HM2-verify-de27ba82a`, Node **24.21.0**,
npm **11.19.0**, macOS **15.7.4**, `CI=true npm ci`: **exit 0**.
The unchanged pinned tree reports 11 existing audit findings (2 low, 9 high);
no audit fix, dependency or lockfile change was made.

| Required check in the fresh clone                                                                                | Exit and result                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three complete owning runs: `deviceWorkerHost`, `deviceWorkerHostNative`, `deviceWorkerDarwin`, `--maxWorkers=3` | **1 / 1 / 1**: each has **51 passed, 10 failed, 7 Windows-native skipped**. Vitest durations **4.51 / 4.35 / 4.32 s**. All **19 macOS native cases ran**; none skipped. Failures are the retained nine launch-behavior cases plus the new strict cap-2 proof, all refused by the unsupported-host guard; no timeout failures. |
| Five compiler projects: host, webview, unit, e2e, integration                                                    | **0** for all five, through `npm run typecheck`.                                                                                                                                                                                                                                                                              |
| ESLint on all changed TS files, `--max-warnings=0`                                                               | **0**.                                                                                                                                                                                                                                                                                                                        |
| Prettier on all five changed files                                                                               | **0**.                                                                                                                                                                                                                                                                                                                        |
| Plain knip                                                                                                       | **0**, unchanged configuration.                                                                                                                                                                                                                                                                                               |
| Plain jscpd                                                                                                      | **0**, zero clones. The initial local run found the duplicated helper schema and cached-helper lookup; the Darwin probe now handles negative flags explicitly and the tests share the lookup. No ignore or threshold change.                                                                                                  |
| `check:reference`                                                                                                | **0**, existing Devices reference remains current.                                                                                                                                                                                                                                                                            |
| `check:l10n`                                                                                                     | **0**, no string/table change or missing key.                                                                                                                                                                                                                                                                                 |
| `check:host-api`                                                                                                 | **1**, W's stale generated Node import counts, described below.                                                                                                                                                                                                                                                               |
| Production `npm run build`, including unchanged size/split/global/notices gates                                  | **0**. Devices **81.8/100 KiB**, activation **462.8/600 KiB**, Model API **456.0/475 KiB**, Devices webview **33.9/50 KiB**, chat startup **733.8/900 KiB**. These measure the existing entry, not a newly bound Darwin factory.                                                                                              |

Host API totals remain **366 VS Code APIs, 43 vscode-importing files, 28 Node
built-ins and 70 theme variables**. W must regenerate its owned inventory:
child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises
**74→77**, path **125→128**, timers/promises **15→17**. The lane does not edit
that shared generated file or suppress its failure.

The required scoped checks were all executed; owning tests and host API did
**not** pass. Full quality is not claimed and this branch is not ready for
integration as a working macOS execution driver. The strict spawn-admission
mechanism and the cap-2 native proof remain the blocker. No native assertion
was removed or weakened, no timeout override or gate relaxation was used,
and no push or model call occurred. The verification follow-up changes this
certification region only; production/test hashes remain those of de27ba82a.

#### M100P2HM3 — supervised macOS caps (2026-10-08)

The lead's new brief supersedes HM2's kernel fork-admission requirement for
macOS: enforce the admitted limit through supervised whole-coalition
termination, retaining the existing refusal for limits outside 1..128.
Windows job objects and Linux cgroup `TasksMax` enforce their limits in the
kernel at fork; macOS checks every `POSIX_TREE_EXIT_POLL_MS` (20 ms), kills
observed overflow, and reports typed `capacity` only after whole-membership
exit. The UID-wide `RLIMIT_NPROC` remains the outer kernel bound; it is not
changed or claimed as a per-attempt limit. A short-lived excess process can
run between samples. Scheduling and scan cost also affect reaction time.

Before implementation, an independent C launchd probe in
`/tmp/M100P2HM3-coalition-proof` ran unprivileged as UID 502 on macOS
15.7.4 / 24G517. A child called `setsid`, forked again and exited; the
grandchild reparented to PID 1, left the root's process group, retained
resource coalition 1440279, and was found by `proc_listpids(PROC_UID_ONLY)`
plus `proc_pidinfo(PROC_PIDCOALITIONINFO)`. SIGKILL followed by observed
ESRCH proved no survivor. All assertions passed and launchctl reported
exit 0; the exact probe registration was removed. One hundred UID membership
scans averaged **0.037930 ms** each (about **0.19%** of a 20 ms interval,
excluding file I/O and accounting).

Implementation plan within H's owned driver/tests: use that resource
coalition for enumeration, killing, kernel counts and independent final
retirement observation; activate valid admitted limits; native cap 2 kills
a three-process tree including an escapee; cap 3 completes a three-process
tree; a living escapee blocks retirement. Deliberately replace coalition
membership with process-group membership and drop termination, observe the
respective tests fail, then restore exact source hashes. Fresh-clone owning
tests run three times at repository deadlines; unchanged compiler/lint/
format/dead-code/duplication/localization/reference/host-API/build checks
follow. Shared product documentation and full quality remain W's obligation.

**Implemented and locally verified.** `deviceWorkerDarwin.ts` enumerates
the current UID's processes using byte-counted `proc_listpids`, checks the
resource coalition with `proc_pidinfo` and rechecks before SIGKILL. A
truncated snapshot, unreadable living UID process or failed signal retains
uncertainty. Kernel coalition counts include departed/reparented children;
the helper waits for itself alone, and the host independently checks zero
coalition tasks after helper exit before resolving retirement. Valid caps
are passed unchanged to the native request. Invalid caps still refuse before
any native call or attempt directory. The loop subtracts scan/accounting/I/O
time from the 20 ms interval; missed periods run again immediately, without
claiming a hard scheduler deadline.

The committed fake-only native C fixture makes an ordinary held child and
a setsid/double-fork grandchild. Its receipt proves the grandchild has PPID 1,
a different process group and the same resource coalition. Its explicit
coalition spawn attribute is rejected with EPERM, corroborating Apple's
[fork inheritance](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c)
and [privileged coalition-spawn check](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c).
Cap 2 terminates all three processes with `capacity`; cap 3 samples exactly
three and completes successfully. The retirement case kills the ordinary
child and exits the root, leaving only the reparented escapee: active count
is one, the assertion stays held, `remove` refuses, and retirement stays
pending until coalition cancellation kills it. The supervisor is suspended
only while constructing the deterministic overflow fixture, then resumed;
this avoids a short fork intermediate preventing the escapee's proof receipt.
Fixture cleanup independently terminates exact fixture PIDs even during drills.
The superseded HM2 fork-EAGAIN assertion is replaced by the lead's explicit
supervised-termination contract, not silently weakened or skipped.

A second native launchd benchmark exercised the production `counts`, UID
`members`, memory accounting, power query and atomic query-file write unchanged
for 100 samples with three coalition tasks (helper plus two children): mean
**1.221855 ms**, median **1.210392 ms**, maximum **2.027655 ms**, **6.11%** of
the 20 ms interval as wall time, not claimed CPU utilization. Both children
were killed/reaped and the benchmark registration removed. The earlier
0.037930 ms measure isolates membership enumeration only.

| Drill                | Deliberate break                                                 | Observed result at default deadlines                                                                                                                               |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| process-group-only   | Select signal targets by process group instead of coalition      | Cap-2 escapee remains alive; no-survivors assertion fails. Exit 1: 62 passed, 1 failed, 7 Windows skipped.                                                         |
| drop-kill            | Replace SIGKILL with signal 0                                    | All three cap-2 processes remain alive; no-survivors assertion fails. Exit 1: 56 passed, 7 failed, 7 Windows skipped; existing cancellation/flood tests also fail. |
| early-retirement     | Remove helper's alone check and independent zero-coalition guard | Sole-escapee retirement, original double-fork marker and assertion-lifetime tests fail. Exit 1: 60 passed, 3 failed, 7 Windows skipped.                            |
| wrong-admitted-limit | Force every valid attempt to cap 2 instead of its admitted limit | Cap-3 completion, sole-escapee retirement and the cap-1/cap-128 request assertions fail. Exit 1: 59 passed, 4 failed, 7 Windows skipped.                           |

Every drill ran the complete three owning files with `CI=true` and
`--maxWorkers=3`; source was restored byte-exact in `finally`, SHA-256
**a00b481ed113b87ac16b42d923e5d89f804f3d59309817db2f5c78d8577e8ba1**.
Drop-kill also fired existing repository 5 s deadlines; no deadline was
raised. The restored owning suite passes **63 tests**, with **7 Windows-native
skips**, including all **21 macOS-native cases** and **5 injected Darwin cases**.
All five typechecks, changed TS ESLint/Prettier, plain knip, zero-clone jscpd
and capped production build pass locally. Final committed-code fresh-clone
receipts follow.

##### HM3 committed-code fresh-clone verification

Implementation **126993a8a**, branch `m100/p2-h-darwin3`, base **2c06f6958**.
The commit ran the repository hooks with exit 0 (four TS ESLint/Prettier
checks, two Markdown format checks, staged gitleaks). The post-hook empty
index, clean worktree and committed diff were reread. No merge, rebase,
manual stash, push, model/paid call, listener, dependency change or relaxed
gate was used. Native captures were local in the stated probe/fixture
workspaces, with **zero model attempts**.

Fresh local clone **`/tmp/M100P2HM3-verify`** at that exact implementation
commit, Node **24.21.0**, npm **11.19.0**, macOS **15.7.4 / 24G517**,
unprivileged UID **502**, real Aqua domain **gui/502**. `CI=true npm ci`
exited **0** against the unchanged lockfile; npm reports the same 11 existing
audit findings (2 low, 9 high). No audit fix or lockfile edit was made.

After the final wrong-admitted-limit drill, the restored worktree's complete
owning suite again exited **0**: **63 passed, 7 Windows-native skipped**,
**12.45 s**, repository deadlines. Source hashes still match the fresh clone.

| Fresh-clone check                                                                                                                                                    | Exit / result                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete owning files `deviceWorkerHost.test.ts`, `deviceWorkerHostNative.test.ts`, `deviceWorkerDarwin.test.ts`, three runs, `--maxWorkers=3`, repository deadlines | **0 / 0 / 0**. Each: **63 passed, 0 failed, 7 Windows-native skipped**. All **21 macOS-native cases ran and passed** every time, verified from the JSON reporter; no macOS skips. Durations **11.84 / 11.42 / 11.79 s**.                                                   |
| Five compiler projects, `npm run typecheck`                                                                                                                          | **0**: host, webview, unit, e2e, integration.                                                                                                                                                                                                                              |
| ESLint on all four changed TS files, `--max-warnings=0`                                                                                                              | **0**.                                                                                                                                                                                                                                                                     |
| Prettier on all six changed TS/Markdown files                                                                                                                        | **0**. Native C is outside the stock Prettier parsers.                                                                                                                                                                                                                     |
| Native fixture compiled with `clang -Wall -Wextra -Werror`                                                                                                           | **0**, no warnings.                                                                                                                                                                                                                                                        |
| Plain knip                                                                                                                                                           | **0**, unchanged configuration.                                                                                                                                                                                                                                            |
| Plain jscpd                                                                                                                                                          | **0**, zero clones.                                                                                                                                                                                                                                                        |
| `check:l10n`                                                                                                                                                         | **0**, 14 UI/usage tables and 991 source files, zero problems.                                                                                                                                                                                                             |
| `check:reference`                                                                                                                                                    | **0**, existing 18-entry Devices reference current.                                                                                                                                                                                                                        |
| `check:host-api`                                                                                                                                                     | **1**, the inherited stale generated inventory owned by W; exact same six count differences as HM2, below.                                                                                                                                                                 |
| Production `npm run build`, size/split/host-global/notices gates                                                                                                     | **0**, all unchanged caps pass. Devices **81.8/100 KiB**, activation **462.8/600 KiB**, Model API **456.0/475 KiB**, Devices webview **33.9/50 KiB**, chat startup **733.8/900 KiB**. The factory still awaits W's lazy binding; this measures the existing Devices entry. |

Final source hashes match the committed fresh clone and every drill restoration:

- Darwin: `a00b481ed113b87ac16b42d923e5d89f804f3d59309817db2f5c78d8577e8ba1`.
- Host (documentation-only interface change): `182a04e2d341ca0c08e7a9f2a9c0a5f191784ed2e25c7986e5e489af7aa54d93`.
- Owning Darwin tests: `24a1bda39b704141610f2404f546cdd4f73b97514c0f853d4d7039621317bbb4`.
- Escape fixture adapter: `076dc8c64e9e4c510e4e8db58ceb78965f4efc68487e48942516191b44e2f662`.
- Native C fixture: `81501648ec62a63cb969c6f105eba9a3aa355c2b95393a4fd8da1c5b6f86b14a`.

**Lead/W requests.** Regenerate W's owned
`docs/ide-compatibility/host-api.md`: child_process **16→18**, crypto
**93→95**, fs **44→45**, fs/promises **74→77**, path **125→128**,
timers/promises **15→17**. The totals stay **366 VS Code APIs, 43
vscode-importing files, 28 Node built-ins, 70 theme variables**. This gate
is reported as failed, not suppressed. Carry the approved supervised
macOS-cap wording into W's shared PLAN/product documents and lazy factory
binding; retain the compiler/ABI refusal and measured bundle caps. W owns
full `npm run quality`, integrated receiver/editor and installed-host
qualification. H's macOS implementation and native acceptance proofs are
complete; aggregate quality is not claimed by this scoped lane.

#### M100P2HM4 — macOS review round 1 (2026-10-08)

Branch `m100/p2-h-darwin4`, base `29560b4c5`; review
`RVM100P2HMB`. All three findings are fixed at their root. No new translation,
dependency, executable command, setting, model attempt or paid call.

| Finding                                            | Fix and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2 observed capacity rejected / reservation leaked | `deviceWorkerHost.ts` resolves a typed `capacity` retirement with observed whole-membership exit, reservation usage (including any retained liability), and runtime `UI_TEXT.devices.capacityHelp`. `deviceReceiver.ts` durably journals existing terminal state `retired` with `failure: capacity`, then calls the idempotent release. Only rejection remains uncertain. Host tests cover direct localized retirement and real receiver dispatch with fake Windows/Linux drivers; Darwin's native regression dispatches through the real receiver/host, overflows cap 2 with the setsid/double-fork fixture, proves no survivors, zero occupancy and exactly one release, and reads the localized result mapping. |
| P2 Aqua listing exceeds buffer                     | Default session probe streams only through the complete `session =` line, bounded by the existing frame byte/deadline limits, and stops its child. Synthetic overflowing-listing regression reaches the filesystem probe and observes child exit; injected Background is cached as negative. The default runner self-tests a real Aqua GUI job.                                                                                                                                                                                                                                                                                                                                                                    |
| P3 transient self-test rejection cached            | One shared preparation function clears a rejected promise, while retaining true/false results. Retained-directory regression fills all 128 slots, sees capacity, removes them, and proves the same factory reaches bootstrap next time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The local result carries the existing `capacity` failure word; no new journal
state or parallel pressure vocabulary is introduced. The additive optional
result/tombstone field is the narrow contract amendment required by this
review. `attemptJournal.ts` preserves it during acknowledged compaction;
both portable receiver cases verify the full result and compacted tombstone.
Lane 0/W must reconcile this field with composed protocol compatibility.

Native capture on macmini, macOS **15.7.4**, UID **502**: the rig shell's
`launchctl managername` says **Background**, while the targeted
`launchctl print gui/502` says **session = Aqua** after **174 bytes**.
The bounded reader therefore targets the GUI domain rather than classifying
the SSH shell's manager. Capture workspace is this lane's private TMPDIR;
**zero model attempts**. Existing driver result captures/shapes are unchanged.

Baseline proof: temporarily restore the five production files from
`29560b4c5`, retain every final regression, and run the three owning files
with `CI=true`, `--maxWorkers=3`, default repository deadlines. **Exit 1:
61 passed, 6 failed, 7 Windows-native skips**. The six failures are the
localized host capacity result, Windows and Linux receiver capacity results,
native macOS receiver capacity result, overflowing session listing and
retry-after-cleanup. All five production files restored byte-exact in finally.

| Red drill       | Mutation                                                    | Exit / failures                                                                       |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| capacity-reject | Restore host capacity rejection                             | **1 / 4**: direct result, Windows receiver, Linux receiver and native macOS receiver. |
| whole-listing   | Use the ordinary buffered runner for the GUI-domain listing | **1 / 1**: overflowing-listing session regression.                                    |
| rejected-cache  | Keep the rejected preparation promise                       | **1 / 1**: retained-directory cleanup retry.                                          |

All drills use default deadlines, restore source in finally and verify exact
bytes. Restoration hashes: host
`3cabe0134285c73715732f9a4c25dd92031df53a674afdf2c797f2e976bbee0e`;
Darwin `b7836d304400425d1d4656afe8beb700510798da3ed95aee123c6a5bb26ea6d4`.
Restored owning run: **exit 0, 67 passed, 7 Windows-native skips**, all
**22 macOS native cases** and **6 injected Darwin cases** passed. Host and
unit typechecks and changed-file ESLint exit **0**. Committed fresh-clone
receipts follow after verification.

The first committed clone at `abf28763b` passed all six requested test runs
(67 owning + 86 receiver/recovery per repetition), all five compiler projects,
ESLint, Prettier, Knip, localization, reference and the capped build. It exposed
two duplicated test blocks: **jscpd exit 1**. Share the real receiver's test
policy in `helpers/deviceWorkerReceiver.ts` and the retained-cap case's launch
closure; keep every assertion and threshold. Restored local jscpd is **exit 0,
zero clones**. Final committed-clone checks are repeated after that fixture
repair. The host API inventory remains the exact inherited W residual.

##### HM4 final committed-source fresh-clone verification

Final source/test commit **`6d68dc086`** (implementation **`abf28763b`**).
Fresh clone **`$TMPDIR/M100P2HM4-final-verify.seKSaq`**, Node **24.21.0**,
npm **11.19.0**, macOS **15.7.4**, UID **502**. `CI=true npm ci`:
**exit 0**, unchanged lockfile; the same 11 existing audit findings (2 low,
9 high). No dependency or audit configuration change.

| Final committed-clone check                                                | Exit / result                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H's three owning files, three runs, `--maxWorkers=3`, repository deadlines | **0 / 0 / 0**: **67 passed, 0 failed, 7 Windows-native skipped** each time. All **22 macOS native cases** and **6 injected Darwin cases** ran and passed every time. Durations **14.82 / 13.92 / 14.09 s**. |
| Complete `deviceReceiver.test.ts` + `deviceRecovery.test.ts`, three runs   | **1 / 0 / 0**: **85 passed, 1 failed / 86 passed / 86 passed**, no skips, **19.78 / 19.63 / 19.75 s**. The single failure is the unchanged E reset-test teardown's `ENOTEMPTY`, detailed below.             |
| Five typechecks: host, webview, unit, e2e, integration                     | **0 / 0 / 0 / 0 / 0**.                                                                                                                                                                                      |
| ESLint, nine changed TS files, `--max-warnings=0`                          | **0**.                                                                                                                                                                                                      |
| Prettier, all twelve changed TS/Markdown files                             | **0**; final documentation formatting is also checked after the certification commit.                                                                                                                       |
| Plain Knip                                                                 | **0**, unchanged configuration.                                                                                                                                                                             |
| Plain jscpd                                                                | **0**, zero clones; original zero threshold unchanged.                                                                                                                                                      |
| `check:l10n`                                                               | **0**, 14 UI/usage tables, 197 manifest strings, 991 source files, zero problems.                                                                                                                           |
| `check:reference`                                                          | **0**, current existing feature catalog.                                                                                                                                                                    |
| `check:host-api`                                                           | **1**, exactly the inherited six W-owned inventory count differences below; no suppression or regeneration in H.                                                                                            |
| Production `npm run build`: size, split, host globals, notices             | **0**. Devices **82.0/100 KiB**, activation **462.8/600 KiB**, Model API **456.0/475 KiB**, Devices webview **34.0/50 KiB**; every cap unchanged.                                                           |

All six final test runs are recorded, including the failure; no retry, timeout
increase, assertion removal or added test skip was used. The complete owning suites
pass in each required repetition. Baseline proof and all three red drills were
also repeated after the fixture refactor, with the same **6** baseline failures
and **4 / 1 / 1** drill failures and exact restoration hashes above.

**E request, outside H ownership.** In
`test/unit/deviceReceiver.test.ts:208`, `RVM100E3-P2 reset starts Stop despite
a stalled journal and held cancellation confirmation`, the body resolves the
held confirmation and immediately reconciles. By tracing the existing async
cancel effect, the `record-uncertain` journal write can enqueue after that
reconciliation; `useExecutionFixture` then removes the directory while the
write is active. The first final run fails only with `ENOTEMPTY` in fixture
teardown; the next two complete runs pass. The first committed clone also
passed all three complete receiver/recovery runs. E should await the durable
`uncertain` state before the existing final reconciliation/teardown, preserving
all immediate Stop, held-confirmation, nonrelease and framing assertions.
The shared ownership rule requires this request rather than an H edit; the
residual is recorded in PLAN section 7. H does not claim a fully green combined
receiver gate or aggregate quality.

**W / lane 0 requests.** Regenerate W's unchanged stale host API record:
child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises **74→77**,
path **125→128**, timers/promises **15→17**. Totals remain **366 VS Code APIs,
43 importing files, 28 Node built-ins, 70 theme variables**. Reconcile the
review-required optional `failure: capacity` result/tombstone amendment with
lane 0's composed contracts and protocol compatibility. W retains the existing
lazy factory binding and full `npm run quality` / installed-host obligations.
No reviewed H finding is deferred.

Changed files: `src/host/backend/deviceWorkerDarwin.ts`,
`src/host/devices/deviceWorkerHost.ts`, `src/host/devices/deviceReceiver.ts`,
`src/shared/devices.ts`, `src/core/devices/attemptJournal.ts`,
`test/unit/deviceWorkerDarwin.test.ts`, `test/unit/deviceWorkerHost.test.ts`,
`test/unit/helpers/deviceDarwinEscape.ts`,
`test/unit/helpers/deviceWorkerReceiver.ts`, `PLAN.md`, `CHANGELOG.md`, and
this macOS certification subsection. Implementation and fixture commits ran
all repository hooks (ESLint, Prettier, staged gitleaks) with exit **0**;
staged/committed diffs were reread after each hook run. The final documentation
commit does likewise. No push, merge, rebase, manual stash, credential read,
paid/model call, nonloopback listener or gate weakening. Both verification
clones are removed after final documentation validation.

#### M100P2HM5 — macOS review round 2 (2026-10-08)

Branch `m100/p2-h-darwin5`, base **`407025f16`**, review
`RVM100P2HMC`. The bounded Aqua probe and ordinary command runner now use
one `spawnFailure` mapping: `EAGAIN` and `ENOMEM` reject as typed capacity;
other errors remain helper failures. Preparation clears the rejected promise,
so the same factory probes launchctl again after pressure passes. Two native
regressions inject each spawn error, prove no runner/attempt was started on
the first launch, then activate and retire a real GUI job on the second launch.

The audit covers every spawn site in this driver:

| Site                           | Capacity handling / observation                                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded `spawn` Aqua reader    | Shared `spawnFailure` handles the error event before close; the existing byte cap/deadline and child termination remain.                                                                                                                             |
| `execFile` runner              | The existing mapping moves into the same helper, covering clang, native helper and launchctl/ps calls. Post-launch observation failures still become uncertainty rather than proof of exit.                                                          |
| Native worker `posix_spawn`    | Existing typed capacity result is retained; native errno classification is shared with its primitive self-test.                                                                                                                                      |
| Native self-test `posix_spawn` | Audit found the same transient-negative-cache problem. It now emits optional `failure: capacity` with `jobProbe: false`, parsed by the strict self-test schema and rethrown as capacity before negative caching. Normal self-test JSON is unchanged. |

The additional native regression runs the actual helper through the existing
UID-limit fixture with `RLIMIT_NPROC=2`, applied only to that subprocess before
`execv`. It observes the capacity JSON and proves the same factory's next launch
succeeds. No launchd, per-user, machine, sysctl or registry limit is changed.
Capture workspace: this lane's native test folder under `TMPDIR` on macmini;
zero model attempts. The returned local-helper shape is
`{ jobProbe: false, query: true, power, scheduler: 'untested', failure: 'capacity' }`.
No Muse Code or Model API wire shape is changed.

**Base proof.** Restore only the Darwin production file from `407025f16`, keep
all final tests, and run the complete three owning files with `CI=true`,
`--maxWorkers=3`, repository default deadlines. **Exit 1: 67 passed, 3 failed,
7 Windows-native skipped**, **13.76 s**. Both injected probe cases and the
native self-test pressure case receive `unsupported-host` instead of capacity.
An earlier probe-only baseline also gave **67 passed, 2 failed, 7 skipped**.
Two initial exploratory attempts exited **143** without a test summary because
an unspawned child double's native kill method signalled the process group;
the double's kill is now explicitly stubbed. No production guard or deadline
was changed to resolve that test-double defect.

| Red drill                | Deliberate break                                                 | Result                                                                                                               |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Probe error mapping      | Replace `finish(undefined, spawnFailure(error))` with `finish()` | **Exit 1: 68 passed, 2 failed, 7 Windows skips**, **13.54 s**; both pressure codes lose their typed capacity result. |
| Native self-test mapping | Replace the validated capacity throw with a cached false result  | **Exit 1: 69 passed, 1 failed, 7 Windows skips**, **15.41 s**; native pressure is cached as unsupported.             |

Every mutation restores the exact production bytes in `finally` and checks
SHA-256 **`b07dd61bf9e91c68aa2b401f42f1224cbde9b57b5e376292b53a8c816c3330dc`**.
The restored complete local owning run passed **70 tests**, with **7 existing
Windows-native skips**, **16.15 s**. All **25 macOS native cases** ran; none
was skipped. Unit typecheck and changed-test ESLint pass after fixing the
simple-condition ordering and awaited return required by the existing rules.
Committed-source fresh-clone qualification follows in this subsection.

The first local duplication check exited **1**, identifying two repeated
activation/retirement/cleanup blocks (15 lines). A test-only `complete` helper
now owns those assertions and guaranteed cleanup for both new regressions and
the existing exact-cap case. Every assertion is retained. Plain jscpd then
exited **0**, zero clones, with its original threshold/configuration.

**W requests, outside H ownership.** Add an Unreleased CHANGELOG note for
retrying Darwin preparation after probe/native self-test spawn pressure. The
inherited stale host-API inventory and full `npm run quality` remain W's
integration gate under PLAN section 7; no shared inventory, product doc,
translation, dependency, command, setting or gate is changed by this lane.

##### HM5 committed-source fresh-clone verification

Implementation **`03862a3f0`**, with repository hooks enabled: changed-file
ESLint/Prettier and staged gitleaks all exit **0**. Post-hook source/test diffs
were reread; the index and worktree were clean. The source SHA-256 above is
unchanged; the final test SHA-256 is
**`1adb550641b37becdeaee45bf118b7b5a0296141dafc32bb5d87878352a99d08`**.

Fresh clone **`$TMPDIR/M100P2HM5-verify.gDm3gE`**, Node **24.21.0**, npm
**11.19.0**, macOS **15.7.4**, UID **502**. `CI=true npm ci`: **exit 0**;
unchanged lockfile, 902 packages installed, the same 11 inherited audit findings
(2 low, 9 high). No audit fix or dependency change.

| Fresh-clone check                                                                 | Exit / result                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete three H owning files, three runs, `--maxWorkers=3`, repository deadlines | **0 / 0 / 0**: each **70 passed, 0 failed, 7 Windows-native skipped**. All **25 macOS native cases** and **6 portable Darwin cases** passed each time, verified in JSON reports; no macOS skips. Durations **15.77 / 15.92 / 15.40 s**.                                                              |
| Five compiler projects: host, webview, unit, e2e, integration                     | **0 / 0 / 0 / 0 / 0**, through `npm run typecheck`.                                                                                                                                                                                                                                                  |
| ESLint, both changed TS files, `--max-warnings=0`                                 | **0**.                                                                                                                                                                                                                                                                                               |
| Prettier, all four changed TS/Markdown files                                      | **0**; final documentation is also formatted and checked after its hook run.                                                                                                                                                                                                                         |
| Plain Knip                                                                        | **0**, unchanged configuration.                                                                                                                                                                                                                                                                      |
| Plain jscpd                                                                       | **0**, zero clones, original zero threshold.                                                                                                                                                                                                                                                         |
| `check:reference`                                                                 | **0**, current catalog including 18 Devices entries.                                                                                                                                                                                                                                                 |
| `check:l10n`                                                                      | **0**, 14 UI/usage tables, 197 manifest strings, 991 source files, zero problems.                                                                                                                                                                                                                    |
| `check:host-api`                                                                  | **1**, the exact inherited six W-owned count differences; no suppression or regeneration.                                                                                                                                                                                                            |
| Production `npm run build`: size/split/host globals/notices                       | **0**, every cap unchanged. Devices **82.0/100 KiB**, activation **462.8/600 KiB**, Model API **456.0/475 KiB**, Devices webview **34.0/50 KiB**, chat startup **733.8/900 KiB**, original deferred JS **31.9/50 KiB**. This measures the current lazy entry; W still owns Darwin's factory binding. |

After the duplication refactor and implementation commit, the complete base
proof was repeated: **exit 1, 67 passed, 3 failed, 7 skipped**, **13.89 s**.
Both red drills were repeated against the committed source and final tests:
probe mapping **exit 1, 68 passed, 2 failed, 7 skipped**, **15.77 s**; native
self-test mapping **exit 1, 69 passed, 1 failed, 7 skipped**, **15.19 s**.
Every repeat restored the production hash above byte-exact in `finally`.
Final restored complete owning run: **exit 0, 70 passed, 7 Windows-native
skipped**, **15.40 s**; all **25 macOS native cases** pass. No raised timeout,
assertion removal, test skip, retry or gate weakening was used.

**Lead/W requests.** Regenerate the inherited host-API inventory:
child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises **74→77**,
path **125→128**, timers/promises **15→17**; totals stay **366 VS Code APIs,
43 importing files, 28 Node built-ins, 70 theme variables**. Add the
CHANGELOG note above with the integrated H fix. Full `npm run quality`, lazy
factory wiring and installed/cross-platform qualification remain W's explicit
obligations under PLAN section 7. No reviewed H finding is deferred.

Changed files: the Darwin driver, its owning tests, PLAN's H review/gate
regions, and this macOS certification subsection. No push, merge, rebase,
manual stash, credential read, model/paid call or nonloopback listener. The
verification clone and private receipt folder are removed after final
documentation validation.

#### M100P2HM6 — macOS review round 3: spawn and preparation redesign (2026-10-08)

Branch `m100/p2-h-darwin6`, base **`c94ddce3c`**. Read reviews
`RVM100P2HMB`, `RVM100P2HMC`, then `RVM100P2HMD`. Three successive reviews
found different delivery paths for the same cache defect. A shared error-event
mapping was insufficient: Node can throw before a child/listener exists. This
round replaces both runners rather than adding another call-site catch.

`program` is the driver's sole process-start primitive, with injected spawn,
stdin on `/dev/null`, independent bounded stdout/stderr and the unchanged
`frameDeadlineMs`. It returns a discriminated success/failure; failures retain
`kind`, `detail` and `isRetryable`. Synchronous throws and error events use one
errno table. Nonzero/signal exits, deadlines and oversized output also settle
once. The Aqua mode consumes only a complete session line inside the bounded
prefix and kills the listing process; it never retains the unbounded service
listing. An absent pipe does not preempt Node's later capacity error event.
All clang, helper, launchctl and ps calls use this primitive. Power stays in
the native IOPM assertion; there is no caffeinate subprocess to bypass it.
The native self-test/worker capacity predicate is generated from the same table.

Preparation is **unknown → preparing → ready / notGui / broken**. All callers
share the preparing promise. A retryable outcome restores unknown before it
returns to the caller. Non-Aqua and definitive helper errors remain cached;
capacity, timeout, unclassified I/O/launch errors and lost observations retry.
A ready factory retains its confirmed preparation across a later query failure.
Failed retirement observations remain typed uncertainty, with their original
program failure as the cause: they never prove exit, release occupancy or allow
removal. Preparation cleanup no longer replaces that failure with an attempted
removal of an unobserved job.

| Spawn errno                              | Meaning on macOS                                                                                | Typed detail / caching   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| EAGAIN                                   | Process/task or per-user process ceiling                                                        | capacity; unknown, retry |
| ENOMEM                                   | Insufficient memory for the new process                                                         | capacity; unknown, retry |
| EMFILE / ENFILE                          | Per-process descriptors / system file table exhausted while creating spawn pipes                | capacity; unknown, retry |
| ENOENT / EACCES                          | Missing executable / path search or execution denied                                            | helper; broken, cached   |
| ENOEXEC / ENOTDIR / ELOOP / ENAMETOOLONG | Invalid executable format / non-directory path component / symlink loop / excessive path length | helper; broken, cached   |
| E2BIG / EINVAL                           | Arguments exceed the system limit / invalid spawn configuration                                 | helper; broken, cached   |
| EIO / ETXTBSY / unclassified code        | I/O failure / executable busy / insufficient evidence                                           | helper; unknown, retry   |

Sources: Apple's [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
for path, format, permission, argument and memory failures;
[pipe(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/pipe.2.html)
for descriptor exhaustion; XNU's [kern_fork.c](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c)
for process-limit EAGAIN. Node [24.21.0 ChildProcess.spawn](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/child_process.js)
and [26.0.0](https://github.com/nodejs/node/blob/v26.0.0/lib/internal/child_process.js)
schedule error events for EACCES/EAGAIN/EMFILE/ENFILE/ENOENT, return early for
EMFILE/ENFILE before creating streams, and throw other failures, including
ENOMEM. [libuv 1.52.1](https://github.com/libuv/libuv/blob/v1.52.1/src/unix/process.c)
uses Darwin posix_spawn and returns its errno through UV__ERR. No real memory
or system-descriptor exhaustion is attempted; these paths use injected failures.

**Test table:** twelve process sites × twenty-four failure deliveries =
**288 cells**, plus one concurrent-launch/share/retry test. Every cell asserts
the typed result, whether preparation is retained, and that an eligible retry
reaches bootstrap on the same factory. Definitive failures make no further
process call. Retirement inspection failures keep the outer uncertain result
and still prove retry of preparation; query failures preserve ready state.

| Axis                            | Cases                                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process sites                   | Aqua probe; clang; native self-test; initial helper query; bootstrap; readiness print; retirement print; coalition count; ps; bootout; ready-factory helper query; active-job query print |
| Capacity delivery               | Synchronous throw and error event for each of ENOMEM, EAGAIN, EMFILE and ENFILE (8)                                                                                                       |
| Definitive delivery             | Error event for ENOENT, EACCES, ENOEXEC, ENOTDIR, ELOOP, ENAMETOOLONG, E2BIG and EINVAL (8)                                                                                               |
| Unclassified/transient delivery | Synchronous EIO, ETXTBSY and unknown-code throws (3)                                                                                                                                      |
| Other failure modes             | Nonzero exit, signal exit, deadline, stdout overflow, stderr overflow (5)                                                                                                                 |
| Native cases                    | All 25 prior macOS cases retained; two added real-GUI retries after synchronous EAGAIN/ENOMEM injection: 27 macOS cases, none skipped                                                     |

**Base proof:** replacing only the Darwin production file with `c94ddce3c`
while retaining these tests yields **exit 1, 291 failed, 0 passed, 31 filtered**.
The selected regressions are the 289 table/concurrency cases and the two added
native synchronous-throw cases. The baseline lacks the single injected-spawn
boundary: its legacy execFile calls hit the explicit forbidden-bypass guard.
The two native synchronous cases directly reproduce cached unsupported-host
instead of capacity. Source is restored in finally, byte-exact.

| Red drill        | Deliberate break                                                             | Exit / failed assertions                                                   |
| ---------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Primitive bypass | Aqua call starts injected spawn directly rather than passing through program | 1 / 1: the Aqua synchronous ENOMEM table cell loses typed capacity         |
| Transient cache  | Store retry as broken instead of restoring unknown                           | 1 / 3: synchronous ENOMEM retry, timeout retry and concurrent shared retry |

Production SHA-256 before/after the baseline and both drills:
`b108ca8cbb5f70e86a941e9dfa9bf0e9e9e54bd7b6966e6cc7a2b37fe6be0232`.
Restored local owning run: **349 passed, 0 failed, 7 Windows-native skipped**,
including all **27 macOS-native cases**. Default repository timeouts throughout;
deadline tests advance fake timers rather than waiting ten real seconds.

Exploration uncovered two fixture errors, corrected without changing an
assertion: active-job classification incorrectly intercepted a retry's readiness
print, and the first baseline concurrency fixture omitted the global process
fence. That old-driver run left two unactivated registrations, which contaminated
four subsequent native power assertions. Their exact baseline-owned launchd
labels were booted out; both process APIs are now fenced before every table or
concurrency test. The restored owning run above passes all power assertions.
The final baseline proof uses the corrected fixture. No other job was stopped.

The duplication gate initially rejected an 18-line / 123-token repeated fixture
setup. Both tests now use one spawnBoundaryFixture; unchanged jscpd reports zero
clones. Signal termination is included in every matrix site, proving that
close(null) retries rather than caching an externally killed probe.

Hooked local checkpoints retain both repository checks (lint-staged and
staged gitleaks). A private temporary hook copy adds only `--no-stash` to
lint-staged, honoring this brief's ban on stash without disabling a check.
The staged/committed diff is re-read after each hook run. Full aggregate quality
and installed platform qualification remain W's gate under PLAN section 7.
No dependency, setting, command, translation, wire shape, cap or timeout changes.

**Lead/W request:** add this change to the W-owned Unreleased changelog:
“Route every macOS Devices process through one bounded spawn primitive and
retry preparation after transient process, memory, descriptor or timeout failures.”
The inherited host-API inventory and lazy factory wiring remain W-owned.

**Final fresh-clone qualification.** Source/test commits **`f686d0a04`**
(primitive/state machine), **`9fa927da8`** (shared fixture setup) and
**`43b921c05`** (signal-exit matrix). Fresh `git clone --no-hardlinks` of
`43b921c05` under the lane's `TMPDIR`, then **CI=true npm ci: exit 0**,
902 installed packages, unchanged lockfile and 11 inherited audit findings
(2 low, 9 high). Rig: macmini, Node **24.21.0**, libuv **1.52.1**, npm
**11.19.0**, macOS **15.7.4 / 24G517**, UID **502**.

| Final check                                                                                                             | Exit / evidence                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three full owning runs: deviceWorkerHost, deviceWorkerHostNative, deviceWorkerDarwin; maxWorkers=3, repository timeouts | **0 / 0 / 0**. Each **361 passed, 0 failed, 7 Windows-native skipped**. All **27 macOS-native cases** and **289 matrix/concurrency cases** ran and passed in every JSON report. Durations **46.02 / 46.02 / 46.13 s**.                                                                                |
| Complete deviceReceiver file                                                                                            | **0**, **49 passed, 0 failed, 0 skipped**, **11.43 s**.                                                                                                                                                                                                                                               |
| Five typechecks: host, webview, unit, e2e, integration                                                                  | **0 / 0 / 0 / 0 / 0**, npm run typecheck.                                                                                                                                                                                                                                                             |
| ESLint: three changed TS files, max-warnings=0                                                                          | **0**.                                                                                                                                                                                                                                                                                                |
| Prettier: all five changed TS/Markdown files                                                                            | **0**, with final certification prose also checked after its hook.                                                                                                                                                                                                                                    |
| Plain knip                                                                                                              | **0**, unchanged configuration.                                                                                                                                                                                                                                                                       |
| Plain jscpd                                                                                                             | **0**, zero clones, unchanged zero threshold.                                                                                                                                                                                                                                                         |
| check:reference                                                                                                         | **0**.                                                                                                                                                                                                                                                                                                |
| check:l10n                                                                                                              | **0**: 14 UI tables, 14 usage tables, 197 manifest strings, 991 source files, zero problems.                                                                                                                                                                                                          |
| check:host-api                                                                                                          | **1**: the same inherited six W-owned Node import counts; no regeneration, suppression or gate change.                                                                                                                                                                                                |
| Production build, size/split/host globals/notices                                                                       | **0**. Devices **82.0/100 KiB**; activation **462.8/600 KiB**; Model API **456.0/475 KiB**; Devices webview **34.0/50 KiB**; chat startup **733.8/900 KiB**; original deferred JS **31.9/50 KiB**. All caps unchanged. This measures the current lazy entry; W still owns the Darwin factory binding. |

The expanded final committed tests were also run against `c94ddce3c` again:
**291 failed, 0 passed, 31 filtered, exit 1**. Both final red drills were
repeated: bypass **1 failed / exit 1**, transient cache **3 failed / exit 1**.
Every mutation restored the production SHA-256 above in finally before final
verification. No raised timeout, removed assertion, native macOS skip or gate
weakening. The early 23-delivery qualification also passed all owning files
three times (349 each); the final receipts above replace it with all 24 deliveries.

**Final lead/W requests:** regenerate only the inherited host-API inventory
(child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises **74→77**,
path **125→128**, timers/promises **15→17**; totals **366 VS Code APIs,
43 importing files, 28 Node built-ins, 70 theme variables**). Carry the
Unreleased note above into W's changelog and bind the lazy Darwin factory.
Full aggregate quality and installed/cross-platform qualification remain W's
required integration gate; no finding in this round's H redesign is deferred.

Changed files: the Darwin driver, its owning test and injected-spawn fixture,
PLAN's H review/gate regions, and this H/macOS certification subsection.
All commits ran lint-staged and staged gitleaks with explicit paths; post-hook
staged snapshots were reviewed. No push, merge, rebase, stash, credential read,
paid/live model call or nonloopback listener. Temporary verification clones
and hook copies are removed after final documentation validation.

#### M100P2HM7 — macOS review round 4: probe reclamation (2026-10-08)

Branch `m100/p2-h-darwin7`, base **`bf57f638b`**, review
`RVM100P2HME`. This round closes its P2: failed probe retirement observations
left launchd registrations and private attempt directories until the 128-entry
cap permanently refused a recovered factory.

The factory retains exact BigInt identities for its store and every directory
it creates, together with readiness and pending-reclamation state. Probe cleanup
always attempts bootout, including when cancellation fails; absence is idempotent.
Deletion requires an observed empty resource coalition and no matching process
group, followed by another directory-identity check. Failed inspections retain
pending evidence. Sweeps run at preparation entry and before allocation refuses
capacity, reclaiming pending probes and owned attempts with an observed absent
launchd job. Unowned names, replaced directories, symlinks and replaced stores
are never deleted. A sweep stops on inspection-process pressure instead of
multiplying that pressure by the retained-attempt count. Removed attempts leave
the factory map as well as the filesystem.

**Native capture:** on this Mac (UID 502), credential-free
`launchctl print gui/502/com.musespark.device.00000000000000000000000000000000`
returned exit **113**; bootout of that absent service returned **3 / ESRCH**.
Only those exit statuses supply absence; spawn errors, deadlines and other
failures remain uncertainty. No new wire shape is introduced. Bootout can reap
the coalition's resource-usage record. The native `--count` helper therefore
falls back to a complete, successful UID membership scan using the same
coalition IDs when that record cannot be read. Enumeration failures still
refuse proof; process groups never replace coalition membership.

| Acceptance                                                               | Test                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Probe reclaimed after repeated retryable observation failure             | One factory, **200 consecutive** failures, zero attempt directories and fake-manager registrations after every failure, then bootstrap, launch completion and a clean query.      |
| Recovery after the full retained-attempt ceiling                         | **128 dead pending probes** with count inspection held unavailable, then restored inspection, sweep, preparation/bootstrap, completion and an empty store/map.                    |
| Capacity sweep also handles ordinary attempts                            | A ready factory accumulates **128 ordinary attempts**, loses their manager registrations, and reclaims observed empty membership before refusing the next allocation.             |
| Every observing-site matrix cell checks cleanup                          | All **72 retirement-print/count/ps cells** in the unchanged **288-cell** delivery/site table assert an empty attempt store after recovery.                                        |
| Retain live or unprovable membership; bound deletion to factory identity | Coalition/group-live cases retain the pending attempt; replaced directory, symlink, unowned sentinel and replaced-store cases preserve the held evidence.                         |
| Actual launchd and reaped-coalition recovery                             | Two native count-pressure cases: one-shot pressure reclaims immediately; pressure through cleanup retains one probe until recovery, then sweeps and launches on the same factory. |

**Base and required red drills:** repository default timeouts, no raised deadline.
Final production SHA-256:
`af963b66525b552dcc8289ca98965416f538a7c0347c223d3a437af68bbe8c4b`.
Every mutation was restored in finally and its SHA-256 checked byte-exact.

| Mutation                                                                                        | Result                                                                                                          |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Production file from `bf57f638b`, new 200/128/ordinary regressions and observing cells retained | **Exit 1: 75 failed, 0 passed, 257 filtered**, 5.562 s wall.                                                    |
| Same base, native one-shot count-pressure regression                                            | **Exit 1: 1 failed, 0 passed, 331 filtered**, 3.155 s wall.                                                     |
| Same base, native pending-count recovery regression                                             | **Exit 1: 1 failed, 0 passed, 331 filtered**, 3.763 s wall.                                                     |
| Skip the failed-observation reclaim in preparation's finally                                    | **Exit 1: 2 failed, 0 passed, 330 filtered**, 1.519 s wall (200 stress and retirement-print ENOMEM).            |
| Skip the sweep                                                                                  | **Exit 1: 2 failed, 0 passed, 330 filtered**, 2.336 s wall (128 pending probes and ordinary capacity recovery). |

Additional guard drills used the final 332-test file: ignoring the membership
proof failed **2** live-membership cases; skipping owned-directory identity
checks failed **2** substitution cases; skipping the pinned store identity
failed **1** replaced-store case. All exited **1**, with exact source restoration.
The restored source's complete three-file checkpoint run exited **0**:
**371 passed, 0 failed, 7 Windows-native skipped**; all **29 macOS-native cases**
ran and passed, including the two new reaped-coalition cases.

The initial stress fixtures exceeded 5 s by accumulating real polling sleeps;
ready/exited fake jobs now remove those sleeps from the reclamation stress
fixtures. The full 288-cell handshake and every native case remain intact.
No timeout, assertion, cap, ignore or gate was weakened. No added string,
dependency, setting, command or shared contract. W owns the product changelog
and inventory: carry an Unreleased note that macOS probe failures no longer
leave attempts that permanently exhaust preparation capacity. Aggregate quality
and installed cross-platform qualification remain W's integration obligations
under PLAN §7; this lane runs the brief's scoped fresh-clone gates.

The final source also preserves query uncertainty for retained jobs instead of
skipping their manager observation. After extracting the repeated recovery
assertions into one test helper, plain jscpd reports zero clones with its unchanged
zero threshold. All base proofs and all five guard drills above were repeated on
this final source, followed by the restored selection: **exit 0, 82 passed,
0 failed, 250 filtered** (18.058 s wall).

Implementation checkpoint **`d228495f3`** ran both repository hooks successfully.
That first hook invocation inadvertently used lint-staged's automatic temporary
backup; lint-staged cleaned it normally. No manual stash was run. Subsequent
commits use a private temporary copy of the unchanged pre-commit checks, with
`set -e` and only `--no-stash` added to lint-staged; ESLint, Prettier and staged
gitleaks remain enabled. Post-hook staged/committed snapshots are reread.

##### HM7 final committed-source fresh-clone verification

Final source/test checkpoint **`a6042da81`** (after implementation
`d228495f3`), independently cloned under `$TMPDIR/M100P2HM7-final-…/checkout`,
with a fresh **`CI=true npm ci` (exit 0)**. Every gate below ran with `CI=true`.
The clone's production SHA-256 matches the final/drill hash above. Tests use the
repository timeout, `--maxWorkers=3`, and at most three files per invocation.
No native macOS case is skipped; the seven owning-file skips are Windows-only.

| Gate                                                                                       | Exit / receipt                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three complete H owning runs: deviceWorkerHost, deviceWorkerHostNative, deviceWorkerDarwin | **0 / 0 / 0**: each **371 passed, 0 failed, 7 Windows-native skipped**. All **29 macOS-native cases** passed each time. Wall durations **53.88 / 53.29 / 52.77 s**.                                |
| Matrix completeness, independently counted from each JSON report                           | **288 / 288 / 288** typed/cache cells passed, including all **72 / 72 / 72** observing-site cells with the new empty-store assertion.                                                              |
| deviceReceiver, complete file                                                              | **0**: **49 passed, 0 failed, 0 skipped**, **11.31 s** wall.                                                                                                                                       |
| Five typechecks: host, webview, unit, e2e, integration                                     | **0 / 0 / 0 / 0 / 0**, each npm script run separately.                                                                                                                                             |
| ESLint, three changed TS files, max-warnings=0                                             | **0**.                                                                                                                                                                                             |
| Prettier, all five changed files                                                           | **0**; final receipt prose also checked after its hook.                                                                                                                                            |
| Plain knip                                                                                 | **0**.                                                                                                                                                                                             |
| Plain jscpd, unchanged zero threshold                                                      | **0**, zero clones. The first checkpoint's repeated recovery assertions made this gate fail; the shared helper fixes the duplication without losing an assertion.                                  |
| check:reference                                                                            | **0**.                                                                                                                                                                                             |
| check:l10n                                                                                 | **0**: 14 UI tables, 14 usage tables, 197 manifest strings, 991 source files; zero problems.                                                                                                       |
| check:host-api                                                                             | **1**: unchanged inherited W-owned inventory mismatch for the six Node import counts below. No regeneration, suppression or gate change.                                                           |
| Production build, unchanged size/split/host-globals/notices gates                          | **0**: activation **462.8/600 KiB**, Devices **82.0/100 KiB**, Model API **456.0/475 KiB**, Devices browser **34.0/50 KiB**, chat startup **733.8/900 KiB**, original deferred JS **31.9/50 KiB**. |

**Lead/W requests:** regenerate the inherited host API inventory:
child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises **74→77**,
path **125→128**, timers/promises **15→17**. Totals remain **366 VS Code APIs,
43 importing files, 28 Node built-ins, 70 theme variables**. Carry the
Unreleased note above and retain W's existing lazy Darwin factory binding and
aggregate/installed-host qualification obligations. This build measures the
current lazy entries; no size cap was changed to accommodate the driver.
The P2 is fixed and all three requested regressions/cleanup proofs are certified;
no finding in this round is deferred.

Changed files: `src/host/backend/deviceWorkerDarwin.ts`,
`test/unit/deviceWorkerDarwin.test.ts`, `test/unit/helpers/deviceDarwinSpawn.ts`,
PLAN's H scope/gate regions, and this H/macOS certification subsection.
All three local commits run ESLint/Prettier and staged gitleaks; post-hook
staged/committed diffs are reread. No push, merge, rebase, manual stash, credential
read, paid/live model call or nonloopback listener. Both private verification
clones and the private no-stash hook copy are removed after final validation.

#### M100P2HM8 — one macOS attempt lifecycle (2026-10-08)

Branch `m100/p2-h-darwin8`, base **`78e72664f`**; briefs and reviews
`M100P2HM8.rig.md`, `M100P2-common.md`, `RVM100P2HME` and `RVM100P2HMF`.
The repeated failures shared one cause: progress lived partly in booleans and
partly in readiness-file existence. Cleanup could not distinguish a never-ready
attempt from a running job whose observation had been lost. Query then visited
the leftover and classified an absent service as an unsupported desktop host.

Every attempt is now registered in its driver-owned record before allocation.
Its single lifecycle is **allocated → bootstrapping → running → retiring →
reclaimed**, with **pendingReclaim** retaining the furthest progress, observed
PID/coalition, observed result when present, and the failed inspection. All state
updates use `transition`; reclaimed records cannot be resurrected by a late
observer. The same state and reclaim operation serve preparation probes and
ordinary jobs; concurrent reclamations share one promise in that record. No
reclamation reads `ready.json` to infer progress. Initial directory identity is
pinned before bootstrap, and allocation-observation failures also enter recorded
cleanup. Running query samples fall back to the record's validated ready query,
not a readiness-file inference. Only running records supply query samples.

| Furthest progress                                        | Reclamation requirement                                                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allocated, bootstrap never attempted                     | Nothing ran: remove the owned directory directly, or record reclamation if allocation never created it.                                                                                                                |
| Bootstrap attempted, never ready; no observed PID        | Bootout succeeds or reports absence; no worker was activated and no PID was observed. Remove the owned attempt.                                                                                                        |
| Bootstrap attempted, never ready; observed PID/coalition | Bootout, then prove the observed PID and its process group absent; add empty-coalition proof when a coalition was observed. Remove only after proof.                                                                   |
| Running or retiring                                      | Bootout, observed empty coalition and absent PID/process group, then recheck directory/store identity before removal. A retirement result additionally requires validated result JSON; cleanup never manufactures one. |
| Inspection, bootout or removal unavailable               | Record pendingReclaim with the same furthest evidence and error. Sweep at preparation/cached-state entry, launch and capacity refusal; recovery releases the directory and map entry.                                  |

Launchctl absence is a typed `ProgramResult` at the sole process boundary:
**print 113 / bootout 3**, never a helper error. Credential-free recapture on
this rig, UID **502**, fixed all-zero nonexistent service label: print **113**,
bootout **3**. This repeats HM7's documented native capture; no Muse/Meta wire
shape, credential, model attempt or paid call is involved. Aqua absence remains
an honest non-GUI outcome. Other failures retain their existing classification.
The native helper, coalition ABI, cap, interval and inhibitor are unchanged.

The lifecycle table runs **9 points × 5 deliveries × 2 kinds = 90 cells**:
allocation, allocation identity observation, request write, bootstrap, pre-ready
print, readiness observation after a printed PID, retirement observation,
bootout and remove; synchronous ENOMEM, definitive ENOENT, nonzero exit,
signal and timeout; probe and ordinary job. Filesystem deliveries use the
corresponding rejected errno (ENOMEM/ENOENT/ETIMEDOUT/ABORT_ERR). Every cell
checks the preparation outcome, later query and launch, empty attempt directory
store and empty fake-manager map. The existing spawn table now has **13 sites ×
24 deliveries = 312 cells**, including bootstrap throw/error/exit and the new
pre-ready observation site. Every cell additionally checks complete cleanup and
later query; all earlier assertions remain. Real helper readiness-write exit,
pre-ready live PID/group, pending-reader isolation and exact absent-service
mapping have separate regressions. The reviewer's ENOMEM → recover → query
sequence runs before its saved empty-store assertion, so its base failure reaches
the poisoned query. A new actual GUI bootstrap-pressure regression accompanies
all **29** retained native cases.

Local complete restored owning checkpoint: **exit 0**, **493 passed**, **0 failed**,
**7 Windows-only skipped**; all **30 macOS-native cases passed**. The separate
lifecycle selection is **97 passed** at repository deadlines. The existing
**200 consecutive failures**, **128 pending recovery**, ordinary capacity,
live-membership and identity-substitution proofs remain intact. No timeout,
assertion, cap, ignore or gate was weakened.

| Base / guard-fire proof                                                           | Receipt                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle and native bootstrap regressions with production bytes from `78e72664f` | **Exit 1: 88 failed, 10 passed, 356 filtered**, **8.85 s**. All 7 focused lifecycle regressions and the native regression fail; 80/90 table cells fail. The 10 passing cells preserve behavior already correct on the base. |
| Expanded base proof, including every spawn-table cleanup/query assertion          | **Exit 1: 171 failed, 239 passed, 44 filtered**, **39.34 s wall**. Lifecycle table **80 failed / 10 passed**; spawn table **83 failed / 229 passed**; focused lifecycle/native regressions **8 failed**.                    |
| Infer pre-ready reclamation from `ready.json` again                               | **Exit 1: 1 failed, 453 filtered**, **1.610 s wall**; bootstrap-pressure recovery leaves the original attempt.                                                                                                              |
| Let query visit a non-running record                                              | **Exit 1: 1 failed, 453 filtered**, **1.577 s wall**; pending pre-ready query reads an ineligible attempt.                                                                                                                  |
| Map print 113 back to helper                                                      | **Exit 1: 1 failed, 453 filtered**, **1.638 s wall**; absent running-service query rejects instead of reporting absence.                                                                                                    |

The shared spawn-errno table generates the native helper's C capacity predicate.
The filesystem ETIMEDOUT classification therefore lives only in `attemptFailure`,
as a typed retryable timeout. Final source's shared errno table and complete
helper template compare byte-exact to `78e72664f`; no generated native behavior
changes. The timeout-kind regression against checkpoint `62166126b` exits **1**:
**8 failed, 10 passed, 436 filtered**, **3.16 s wall**. All eight filesystem timeout
cells see the wrong spawn kind on that checkpoint. Restored final lifecycle
selection: **exit 0, 97 passed, 357 filtered**, **11.20 s**. The final-source native
bootstrap/count-pressure/lifecycle selection is **100 passed** at default deadlines.

Final-source mutations were restored in finally, byte-exact SHA-256:
`a2c379d200c61a3021eacb41488d353c0618fa8edd9138635cc2a8c70f742178`.
Local host/unit compiler projects, changed-source ESLint and plain jscpd pass;
jscpd reports zero clones after sharing native pressure-fixture construction.
Full quality and installed cross-platform qualification remain W's required
integration gates under PLAN §7. W also owns the inherited host API inventory
and product changelog: carry an Unreleased note that macOS attempts now share
one lifecycle, reclaim pre-ready failures and keep pending attempts out of query.
No new command, setting, string, dependency or shared contract is introduced.

##### HM8 final committed-source qualification

Implementation checkpoint **`62166126b`**, filesystem-boundary follow-up and
final source/test checkpoint **`7d0928cf0`**. Both ran the repository's installed
hooks, `core.hooksPath=.husky/_`, with lint-staged's normal internal backup,
ESLint/Prettier and staged gitleaks; **all hook checks exit 0**. No hook was
copied, wrapped, substituted or edited. The staged/committed diffs were reread
after each hook, and the final production SHA-256 matches the guard-fire hash.

The final checkpoint was independently cloned under
`$TMPDIR/M100P2HM8-final-ynqjf6zh/checkout`, with fresh **`CI=true npm ci: exit 0`**.
Node **24.21.0**, npm **11.19.0**, macOS **15.7.4**, UID **502 / Aqua gui/502**.
Every gate below ran with **CI=true**. Vitest used repository deadlines and
`--maxWorkers=3`, at most three complete files per invocation; no `--testTimeout`.
All native macOS cases ran; skips are Windows-only. This is the final source,
including the timeout-kind regression and unchanged native helper template.

| Gate                                                              | Exit / receipt                                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete H owning files, three runs                               | **0 / 0 / 0**. Each **493 passed, 0 failed, 7 Windows-only skipped**; **66.63 / 65.11 / 65.66 s wall**.                                                                                            |
| Native and table completeness from each JSON report               | **30 / 30 / 30 native**, **90 / 90 / 90 lifecycle cells**, **312 / 312 / 312 spawn cells**, every case passed. The 200-failure and 128-recovery cases passed in every run.                         |
| Complete deviceReceiver file                                      | **0**, **49 passed, 0 failed, 0 skipped**, **11.25 s wall**.                                                                                                                                       |
| Five compiler projects: host, webview, unit, e2e, integration     | **0 / 0 / 0 / 0 / 0**. Each npm script ran separately.                                                                                                                                             |
| ESLint, all three changed TS files, max-warnings=0                | **0**.                                                                                                                                                                                             |
| Prettier, all five changed files                                  | **0**; final receipt prose also checked after its hook.                                                                                                                                            |
| Plain knip                                                        | **0**.                                                                                                                                                                                             |
| Plain jscpd, unchanged zero threshold                             | **0**, zero clones.                                                                                                                                                                                |
| check:reference                                                   | **0**; all generated reference coverage and freshness current.                                                                                                                                     |
| check:l10n                                                        | **0**: 14 UI tables, 14 usage tables, 197 manifest strings, 991 source files; zero problems.                                                                                                       |
| check:host-api                                                    | **1**: the same inherited W-owned six Node import-count mismatches documented by HM7, below. No regeneration, suppression or gate change.                                                          |
| Production build, unchanged size/split/host-globals/notices gates | **0**: activation **462.8/600 KiB**, Devices **82.0/100 KiB**, Model API **456.0/475 KiB**, Devices browser **34.0/50 KiB**, chat startup **733.8/900 KiB**, original deferred JS **31.9/50 KiB**. |

**Lead/W requests:** regenerate the inherited host API inventory:
child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises **74→77**,
path **125→128**, timers/promises **15→17**. Totals remain **366 VS Code APIs,
43 importing files, 28 Node built-ins, 70 theme variables**. Carry the Unreleased
note above, run aggregate quality and installed cross-platform qualification,
and bind this driver through W's lazy native factory: this lane's source has no
production caller of `deviceWorkerDarwin` or `selectDeviceWorkerDriver` yet.
The build measures existing lazy entries and is not an installed-driver receipt.
No H lifecycle finding is deferred; no shared contract, feature catalog or
product file was changed outside the lane's ownership.

Changed files: `src/host/backend/deviceWorkerDarwin.ts`,
`test/unit/deviceWorkerDarwin.test.ts`, `test/unit/helpers/deviceDarwinSpawn.ts`,
PLAN's H scope/gate regions, and this H/macOS certification subsection.
Both private verification clones are removed after validation. No push, merge,
rebase, manual stash, credential read, paid/live model call or nonloopback listener.

#### M100P2HM9 — stop signaling and independent macOS reclamation (2026-10-08)

Branch `m100/p2-h-darwin9`, base **`ed3c06cbb`**, review **RVM100P2HMG**.
The brief keeps HM8's state machine and closes both lifecycle findings in its
reclaim/sweep rules. No native helper, contract, cap, poll interval or gate changes.

| Reclaim-table row                                             | Updated rule                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Allocated, bootstrap never attempted                          | Remove the owned directory directly; no stop signal or process observation is needed.                                                                                                                                                                                                                                    |
| Bootstrapping, with or without an observed PID                | Write the idempotent stop file and record `stopWritten`, then bootout. Conservatively signal even an unobserved bootstrap because unreadable published readiness can conceal a live helper. On successful/absent bootout, retain HM8's proof of every observed PID/group/coalition before removal.                       |
| Running, retiring, or pending reclaim retaining that progress | Use the same stop signal, bootout, empty-membership proof and immediately repeated owned-directory/store check. Cancellation uses that recorded signal too; a reclaimed record remains terminal.                                                                                                                         |
| Stop, bootout, membership or removal failure                  | Preserve `pendingReclaim`, its furthest evidence, observed result and error. Every sweep visits every pending attempt; retryable and definitive failures remain pending, and neither blocks later attempts. Return every unreclaimed service, progress, recorded stop write and error.                                   |
| Pending-attempt capacity and health                           | Retain its directory against `DEVICE_LIMITS.unresolvedAttempts`, including definitive failures. Query throws typed `uncertain`, with existing localized `devices.unresolvedHelp` and an AggregateError containing every retained failure. Successful reclamation removes that evidence and restores normal observations. |

Capacity follows **PLAN D80 item 7**: unknown/unresolved old records keep their
occupancy and liabilities, and only locally observed retirement settles them.
The **M96 uncertain-attempt** rule also retains process slots and quarantines the
working copy. A failed program command cannot prove retirement. Query's typed
uncertainty reaches the host's existing unknown-facts fallback and the existing
uncertain-failure presentation; it never advertises a reclaimed slot. W still owns
the production factory binding and installed-host status wiring.

The lifecycle table adds **probe/ordinary × context mismatch/schema failure/
ready-read timeout = 6 cells**, each after readiness publication with bootout held
failing. They assert the stop file precedes every bootout, independently poll the
fixture helper to its exited/assertion-released state, inspect `stopWritten` in
the retained error report, then recover and reclaim the directory. Two additional
cells put definitive exit 1 or retryable ENOMEM on oldest A: one preparation-entry
sweep removes empty B and C, retains/reports A, reports two failures together,
and refuses allocation at the unchanged 128-directory ceiling. No retained slot
is treated as free.

The new native macOS case deliberately invalidates a real helper's published
ready schema while its actual IOPM assertion is held and forces bootout to fail.
It observes stop, polls the helper's own released query at the unchanged 20 ms
helper interval, checks `pmset -g assertions` no longer names its assertion,
retains uncertainty while bootout is unavailable, then recovers and reclaims.
The capture is this lane's native temporary workspace on macmini, UID 502;
zero model attempts, credential reads or paid calls.

A full first local run exposed two 5 s stress-test timeouts and 24 active-print
mapping failures. Query now sweeps pending records only before sampling running
records, preserving the original active-print classifications. Stop is written
once successfully per attempt, and preparation no longer repeats its entry sweep.
The two 128-attempt fake stress fixtures cache immutable directory samples and
root creation; actual allocation/readdir/removal, request/readiness files, process
boundaries and all 128 occupancy/assertion checks remain. Separate identity and
substitution cases keep real filesystem observations, as do all native cases.
No timeout, skip, assertion, threshold or ignore was relaxed.

Restored local complete H owning suite: **exit 0, 502 passed, 0 failed,
7 Windows-only skipped**, **73.22 s**. All **31 macOS-native cases** ran.
Host and unit typechecks, changed-file ESLint, plain knip and plain jscpd pass;
jscpd reports zero clones. Final committed-source fresh-clone receipts follow.

| Base / red drill                                                | Exit and counts                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| All nine new regressions with production bytes from `ed3c06cbb` | **1: 9 failed, 0 passed, 454 filtered**, **3.85 s**. Every regression fires on the required base.                               |
| Remove the stop write from reclaim                              | **1: 7 failed, 0 passed, 456 filtered**, **3.84 s**. All six lifecycle cells and the actual native assertion case fail.         |
| Return from the sweep after its first pending failure           | **1: 2 failed, 0 passed, 461 filtered**, **1.55 s**. Both definitive/retryable oldest-failure cases retain B and C incorrectly. |

Each mutation restores the exact production bytes in finally and verifies
SHA-256 **`9446c710de978490e940b882977f363c3395c7d33536c83074babaf6b38b29b5`**.
Every test run uses repository deadlines and `--maxWorkers=3`; no raised timeout.
The nine restored focused regressions also pass after all mutations.

**Lead/W requests:** carry the Unreleased CHANGELOG note that macOS reclamation
signals waiting helpers before bootout, sweeps all attempts despite individual
failures, and surfaces retained reclamation uncertainty. Full `npm run quality`,
the inherited host API inventory, lazy production factory binding and installed
cross-platform qualification remain W's integration duties under PLAN §7.
No reviewed H finding is deferred or shared-file ownership widened.
