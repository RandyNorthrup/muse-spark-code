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
| 6. Helper self-test     | Source-digest build through existing `compileJob`; per-factory cached self-test exercises suspended launch, job assignment/resume, observed empty job, context, CPU/peak-memory query and power. Failed/corrupt helpers refuse without fallback. The real corruption case and fake failed-self-test case pass; bypass-self-test drill fails.                                                                                                                                                 | Windows done; scheduler launch permission is exercised by native tests, not by the primitive self-test itself.                  |

`retirement` is never resolved by cancellation, a deadline, helper/task disappearance
or direct-parent exit. The native accounting query must observe zero active
processes in the whole job. A real detached descendant finishes after its parent;
removing that guard makes its marker assertion fail. Helper loss rejects as
uncertain and retains occupancy. Whole-job cancellation uses `TerminateJobObject`,
never taskkill/PID-only tree termination. Suspended, unassigned children are
terminated before they can run. Kill-on-close covers helper death. A native
process ceiling and retained-attempt directory ceiling use the unchanged shared
`DEVICE_LIMITS`; overflow stops work. The directory allocation is serialized.

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

### macOS continuation — M100P2HM (macmini, 2026-10-07)

Branch `m100/p2-h-darwin`, Windows head/base `f4f6f3008`. Read the rig
continuation, shared phase-2 rules, original H brief, PLAN ownership/acceptance,
planning record, threat model and Windows host/driver before implementation.
This subsection qualifies macOS only. Windows' six native cases are skipped
on this rig and are not counted as passes. No model, paid call, pairing,
listener, dependency, registry/policy change, merge, rebase, stash or push.
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
