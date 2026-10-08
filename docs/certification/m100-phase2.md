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

## Lane A — receiver per-action controls (M100P2A, 2026-10-07)

Kubuntu rig, branch `m100/p2-a`, base `466a7a8e4`. Implements only lane A's
core authority, receiver-policy binding and presence-relay carriage region.
No model calls, paid calls, real pairing, native presence prompt or physical
execution: model attempts **0**, inference spend **0**. Presence is injected;
`local-confirm`, Touch ID and Windows Hello are fake ports in these receipts.
Physical support remains unavailable under D83.

### Acceptance, implementation and owning tests

| Acceptance            | Implementation                                                                                                                                | Proof and drill                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intersection — done   | `src/core/devices/actionGrants.ts:132`, `DeviceActionGrants.admit`; `src/host/devices/deviceReceiver.ts:72`, `bindDeviceReceiverActionGrants` | `actionGrants.test.ts` covers the sender ceiling first, receiver manual/plan versus sender auto, all six quota fields at cap/one past for sender and each receiver limit, repository/offer/role/tools, protected paths including Windows separators and traversal, trust revoked after ordinary approval, local approval policy, expiry and revocation. The exact threat test `refuses admission past the receiver intersection` reaches the fake `DeviceLocalAttempt.start` when the intersection is omitted, and fails its forbidden-call assertion. |
| Step-up — done        | `actionGrants.ts:193`, `:220`, `:229`                                                                                                         | Fake connect/program/actuate actions require receiver-local confirmation, exact bytes/request digest, current grant revision, freshness below five minutes and single use. Offline/observe and refused classes are covered. Auto, ordinary approval and the pairing grant cannot replace presence. Forged approvals, replay, another digest, changed state during the prompt, denial/failure/timeout, bounded records and mutated returned receipts are tested. Removing digest binding, consumption or local provenance fails the owning tests.       |
| Presence relay — done | `actionGrants.ts:316`, `:347`; the sole new `presenceRelay` member in `src/core/devices/channel.ts`                                           | `devicePresenceRelay.test.ts` covers strict versioned envelopes, closed methods, pair/owner/digest binding, waiting plus attested/refused replies, control-stream carriage and fake orchestrator answers. No answer or settlement kind exists. Forged settlement cannot reduce receiver-recorded occupancy/liability. Allowing a forged attested answer or ignoring receiver-recorded usage fails the tests.                                                                                                                                           |
| Strings — done        | `DevicePresenceRelay.waitingText`, `actionGrants.ts:348`                                                                                      | Reads existing `UI_TEXT.devices.stepUpWaiting` at runtime with `fill({ device })`; all three method cases assert the waiting reply and named device. No new text key or translation change. Removing the device-presence check fails the relay's denial assertion; removing the version check fails its strict-envelope test. Localization gate is included in final verification below.                                                                                                                                                               |

The receiver binding preserves E's admission order, journal-before-start,
ordinary approvals, paid gate and Stop behavior. Its error retains the typed
`deviceGrantRefusalSchema` result in `DeviceActionGrantError.refusal`; the
phase-1 failure frame remains the existing `grant` word. The authority uses the
phase-2 schema from `src/shared/devices.ts`, never the phase-1 offer-grant
schema. Sender mode comparison uses lane 0's `grantCeilingRefusal` and
`DEVICE_GRANT_MODE_ORDER`. A successful result is narrowed to the admitted
request's mode, scope and quotas.

The receiver's synchronous `current` snapshot and `senderCeiling` are trusted
local ports. The local action registry supplies class, tool, paths and exact
bytes; a peer/model request carries no classification or approval hint.
Protected paths normalize both separators and lexical traversal before matching.
The presence port shows those bytes on the executing device, honours abort,
and rejects unavailable native methods. The receiver rechecks its complete
intersection and digest after a prompt yields. Private attestations are frozen;
returned receipts are independent parsed copies and carry no new authority.
Receiver-recorded usage is input only from the local owner, with no peer
settlement API. Slot reservation and durable settlement remain E/M96/R's job.

### Red drills and byte-exact restoration

Each command was `npx vitest run test/unit/<owning-file>.test.ts
--maxWorkers=3 -t <test name>`, at repository default timeouts. Every final
mutant below exited **1** with an assertion failure, then the original file
was restored byte-exact. Final source SHA-256 after each drill:
`fccfca48d1685a8ca89c832e42235e82456162764891936809bab829fa90bd38`
(`src/core/devices/actionGrants.ts`).

| Mutant                                            | Failing assertion                                |
| ------------------------------------------------- | ------------------------------------------------ |
| Omit receiver scope intersection                  | Forbidden `DeviceLocalAttempt.start` called once |
| Omit sender ceiling early refusal                 | Receiver snapshot unexpectedly read              |
| Omit receiver quota check                         | Each of six one-past requests admitted           |
| Omit grant revocation                             | Revoked grant admitted                           |
| Omit grant expiry                                 | Expired grant admitted                           |
| Omit digest binding                               | Another payload admitted                         |
| Omit one-use consumption                          | Connect/program/actuate replay admitted          |
| Accept unminted attestation                       | Orchestrator approval unexpectedly resolves      |
| Ignore device rejection                           | Attested reply instead of `presence-unverified`  |
| Ignore receiver-recorded usage                    | Unrecorded settlement permits admission          |
| Accept orchestrator's attested answer             | Receiver relay unexpectedly resolves             |
| Share a mutable private approval with its receipt | Mutated receipt authorizes replacement payload   |
| Remove relay version literal                      | Wrong version parses                             |

Exploratory defense-in-depth observation: removing only the relay's direction
check still refused a forged attested reply through the independent digest
check. The final origin drill explicitly accepted that forged reply and failed
its rejection assertion. Neither mutant remains. Final raw drill logs are
under `/tmp/m100p2a-drills-*` on this rig.

### Requests to the lead / lane W

- Proposed order, without editing K's regions: authenticate → owner binding
  (K) → grant validity/revocation (K) → receiver intersection (A) → receiver-local
  per-action step-up (A). Construct the policy through
  `bindDeviceReceiverActionGrants`; resolve owners/check roles from local K
  records and build a request bound to the exact dispatch mode, role,
  repository, scope and six caps. `current` must read local offer, trust,
  role/tool/path policy, approval policy and recorded occupancy every time.
- Bind `DevicePresenceRelay.receive` only to authenticated requests on the
  receiver's control stream (`PacedDeviceChannel.send` /
  `MultiplexedDevicePort.receive`). Pass the authenticated pair id, validate
  current owner/grant through K first, and use the local digest resolver.
  The added union member is exactly
  `{ kind: 'presenceRelay', relay: devicePresenceRelaySchema }`. The
  orchestrator renders the correlated `waiting` reply with `waitingText(device)`
  and treats attested replies as status only; it never calls a local answer
  or `attestStepUp` from peer content. The attempt-aware binding below covers
  repeated pre-start policy checks and spends the approval at launch or terminal
  admission. No physical executor is supplied by this lane.
- W owns joined CHANGELOG/feature catalog/README/SECURITY updates, final lazy
  entry wiring and fully wired bundle measurement, aggregate `npm run quality`
  and installed-host qualification. No extra command, setting or dependency
  is added here, and no global/shared gate or cap is changed.
- Real-prompt drill request after M109 P is merged, with the owner present:
  on **Mac mini**, bind P's actual device-local presence port and execute
  `await grants.requestStepUp(request, 'touch-id')` once for an inert fake
  `program` action in the installed receiver's debug/test host. Expected:
  **one** Touch ID prompt on Mac mini, **zero** on the orchestrator, a named
  waiting status there, no executor/spawn, one attested reply only after the
  owner's touch. On **Windows PC**, use
  `await grants.requestStepUp(request, 'windows-hello')` with the equivalent
  port: **one** Windows Hello prompt there and **zero** remotely. Owner cancels
  on a second invocation: one prompt, typed `presence-unverified`, no admission.
  The VMs use the simulator/local-confirm port when biometric hardware is
  missing. These prompts were requested for qualification, never triggered here.

### Final committed-code fresh-clone receipt

Implementation commit `baacf40aee6afc8177d424f77089c41fa7c0145f`, cloned
directly from this worktree to `/tmp/m100p2a-final-verify-nir7cqqo`. Node
**24.18.0**, npm **12.0.1**; `CI=true npm ci` exited **0**. The committed
source, worktree and clone have the exact action-grants SHA-256 recorded above.
Final receipt logs are `/tmp/m100p2a-verification-receipts/` on this rig.

- Three consecutive `CI=true npx vitest run test/unit/actionGrants.test.ts
test/unit/devicePresenceRelay.test.ts --maxWorkers=3` runs: **59 passed
  each**, repository default deadlines, no `--testTimeout` override. Vitest
  durations **2.95 s / 5.99 s / 3.23 s** (whole runs, not individual tests).
- Fresh-clone receiver/channel regressions (`deviceReceiver.test.ts`,
  `channel.test.ts`, `deviceMultiplexedChannel.test.ts`, at most three
  files/workers): **92 passed**, no timeout override. Restored worktree's
  owning files plus receiver regression: **108 passed** before committing.
- Focused V8 coverage on `src/core/devices/actionGrants.ts`, with the
  unchanged repository thresholds: **97.32% statements, 95.95% branches,
  100% functions, 100% lines**; owning **59 passed**, exit **0**.
- `npm run typecheck`: exit **0**, all five projects (host, webview, unit,
  e2e, integration). Fresh-clone `npm run lint`: exit **0**, full JavaScript/
  TypeScript and CSS; PowerShell reports its expected Linux platform skip.
  Changed-file ESLint and Prettier passed before commit;
  commit hooks ran ESLint/Prettier and Gitleaks successfully, no leaks.
- Fresh-clone Prettier on all seven changed files, plain `npx knip`,
  duplication (**0 clones**), `check:reference` (**18 Devices entries**),
  `check:l10n` (**14 UI tables, 0 problems**) and cycles: exit **0**.
- `npm run build`: exit **0**, caps, splits, host globals and notices
  unchanged and green: Devices **82.5/100 KiB**, activation **462.8/600 KiB**,
  Model API **456.0/475 KiB**, ACP entry **155.3/850 KiB**, original deferred
  webview **31.9/50 KiB**. Notices cover **88 packages**. W must still measure
  the joined bundle after wiring the admission and presence factories.
- **Host API inventory: exit 1, requires W's owned generated-file update.**
  `npm run check:host-api` reports exactly two stale Node import-reader counts
  in `docs/ide-compatibility/host-api.md`: `node:crypto` **93 → 94** and
  `node:path` **125 → 126**, from this lane's exact-payload hashing and portable
  path normalization. VS Code API count (**366**), importing files (**43**)
  and unique Node built-ins (**28**) are unchanged. Per the explicit ownership
  rule, this lane did not edit W's record or weaken the gate. W should run
  `npm run check:host-api -- --write`, review these two rows (plus other joined
  lanes' readers), and rerun the gate before the integration is proposed.

All four lane acceptance bullets have implementation, tests and red drills.
Aggregate `npm run quality`, the generated host inventory, product wiring,
real native prompts and installed-host/physical qualification remain W's
explicit responsibilities; this record does not claim them passed.

### Lane A review repair — FIXM100P2A (2026-10-07, macmini)

Branch `m100/p2-a-fix`, base `5bbefbd4f`; review
`RVM100P2A.report.md`. Only lane A's authority, receiver admission binding,
presence-carriage region, owning tests and this lane's certification changed.
No live or paid calls, real pairing or native prompts: model attempts **0**,
inference spend **0**. No dependency, contract envelope, gate or budget change.

- **P1 fixed** — `src/core/devices/actionGrants.ts:81` uses the shared
  `isProtectedPath` rule after separator/lexical normalization and case folding.
  Receiver-specific protected runs match whole segments anywhere in the path.
  Normalized leading `..`, POSIX absolute, UNC and Windows drive paths refuse
  `scope-denied`. `actionGrants.test.ts:122` covers every review scenario,
  mixed case, Windows separators, ordinary outside writes and the canonical
  protected names; `:123` proves custom multi-segment runs, boundary-safe
  ordinary writes and shared protection even with an empty receiver list.
- **P2 fixed** — `actionGrants.ts:216`, `:251`, `:258` keeps the attestation
  bound to one dispatch's full identity and payload digest throughout policy
  checks. Every check still evaluates the current receiver intersection,
  action digest, grant revision and freshness. Standalone `admit` retains its
  one-use behavior. `deviceReceiver.ts:74` binds the scoped authority and
  `finishAdmission`; `:570` spends it before `lease.start`, and `:590` spends
  it on every terminal admission path. `actionGrants.test.ts:249` drives real
  `DeviceReceiver.dispatch` with real binding and fake connect/program/actuate:
  one start, spent at start, second dispatch typed `step-up-required`. `:277`
  refuses another in-flight id or dispatch payload, `:306` proves terminal
  ordinary denial spends it, and `:318` refuses changed action bytes then
  refuses reuse of the restored payload after the attempt ends.
- **P3 fixed** — `src/core/devices/channel.ts:225` binds `presenceRelay` to
  the authenticated pair and applies `DEVICE_LIMITS.grantBytes`.
  `devicePresenceRelay.test.ts:158` rejects a cross-pair relay at enqueue;
  `:164` isolates the channel cap from the schema refine: the genuine relay
  still parses, while a test-only TextEncoder spy reports an envelope of
  `grantBytes + 1` bytes (below `frameBytes`) and enqueue must refuse.
  Existing control-stream request/waiting/attested delivery stays covered.

#### Base-failure proof

Before fixing production source, the new regressions ran directly against
`5bbefbd4f`: **23 failed / 64 passed**. After adding the two in-flight identity
and dispatch-digest cases, all final tests ran against that same base source
again: **25 failed / 65 passed** — P1 **18**, P2 **5**, P3 **2** assertion
failures. Command: `CI=true npx vitest run test/unit/actionGrants.test.ts
test/unit/devicePresenceRelay.test.ts --maxWorkers=3`, repository default
timeouts, no override. Source restored byte-exact after the base run.
Fixed owning suites: **90 passed**; receiver/channel suites: **73 passed**.
Logs: `temp/fixm100p2a/base-failures.log`,
`base-final-regressions.log`, `fixed-owning.log`, `receiver-channel.log`.

#### Review guard drills

Each deliberate mutant ran its named regression with `--maxWorkers=3 -t
<name>` at repository default timeouts. All exited **1** with assertion
failures; selected-out tests below apply only to drills, not verification.
Every mutation restored the entire file byte-exact before the next drill.

| Removed guard                               | Failing tests        |
| ------------------------------------------- | -------------------- |
| P1 shared protected-path rule               | 3 failed / 19 passed |
| P1 workspace containment                    | 4 failed / 18 passed |
| P1 custom path-segment matching             | 1 failed             |
| P2 repeated checks within one bound attempt | 3 failed             |
| P2 bound attempt identity                   | 2 failed             |
| P2 dispatch payload digest in attempt key   | 1 failed / 1 passed  |
| P2 current action digest                    | 1 failed             |
| P2 consumption at launch                    | 3 failed             |
| P2 consumption on terminal ordinary denial  | 1 failed             |
| P3 channel pair binding                     | 1 failed             |
| P3 independent channel grant-byte cap       | 1 failed             |

Restored source SHA-256:

- `src/core/devices/actionGrants.ts`:
  `d522de88a80e74ecb50481cd8c70a203fc7d328f34e0f6722620647e6cd5146b`
- `src/host/devices/deviceReceiver.ts`:
  `11cbda32dae8d6120fee1d81047d009f1443282ccc5e313a89f48e270b8be314`
- `src/core/devices/channel.ts`:
  `304de781ac5453c05819e10eaeb7f6eb8ecf1b0b7f7020565eefdfba286be8fc`

Drill receipts are `temp/fixm100p2a/drills.log` and `drill-*.log` on macmini.
The shared `DeviceActionGrantPort` and wire shapes stay unchanged; W must
supply the concrete attempt-aware methods to `bindDeviceReceiverActionGrants`
and retain its returned `finishAdmission` hook. Post-start physical actions
need fresh per-action presence. W still owns the generated host API inventory,
joined CHANGELOG/reference/docs and aggregate `npm run quality` qualification,
as the phase-2 ownership table and shared lane rules require.

The initial repair commit is `b17387a9ed1cb31600b95e9c89ef86dd3d55f2d9`;
ESLint/Prettier and Gitleaks hooks passed, the post-hook staged/committed diff
was reread, and source hashes still match the drills. Worktree five-project
`npm run typecheck`, changed-file ESLint and Prettier exited **0**.

Fresh-clone attempt at `/tmp/fixm100p2a-final-verify-20261007`, that commit,
`CI=true npm ci`: exit **0**, 902 packages; the unchanged lockfile reports
11 advisories (2 low, 9 high). Its first three-file test batch had **138
passed / 1 failed**, an `ENOTEMPTY` in cleanup of the unchanged receiver test
`RVM100E3-P2 reset starts Stop despite a stalled journal and held cancellation
confirmation`; no assertion or timeout was changed. Its duplication gate
correctly failed with **4 clones** in the added tests. Shared protected-write,
confirmed-receiver and waiting-relay fixture setup removes all clones while
keeping every case and assertion: **90 owning tests still pass**, duplication
**0 clones**, changed-test ESLint exit **0**. Final verification uses two-file
batches, at most three workers, without a timeout override.

#### Final fresh-clone repair receipt

Verified commit `950dfc8aa16ed0cd94c94b8c72660297a9ea7a73` (the fixes plus
shared test setup), cloned directly from this worktree into
`/tmp/fixm100p2a-final-verify-20261007-final`. Node **24.21.0**, npm **11.19.0**.
`CI=true npm ci` run with the clone as its working directory exited **0**;
source hashes match all drill receipts, and both worktree and clone were clean.
The test-setup commit also passed ESLint/Prettier and Gitleaks hooks; its staged
and committed diff was reread after the hook.

All four owning files ran **three consecutive complete times**, in two-file
batches with `CI=true`, `--maxWorkers=3`, repository default timeouts and no
`--testTimeout`. Each pass: **163 passed** (**90** action-grants/presence-relay
and **73** receiver/channel); no filters, skipped cases or relaxed assertions.
Batch durations: **6.10 + 10.85 s**, **7.27 + 11.90 s**, **7.08 + 12.06 s**.
The five compiler projects (`npm run typecheck`) exited **0**, 0 errors.
Receipts are `temp/fixm100p2a/fresh-tests.json`, `fresh-tests-*.log`,
`npm-ci-final-direct.log` and `fresh-typecheck.log`.

The final shared-setup tests were also rerun against `5bbefbd4f`: **25 failed /
65 passed**, unchanged finding counts. All **11** guard drills were repeated
against those final tests with the same assertion failures and byte-exact
source hashes. Receipts: `base-refactored-regressions.log`, `drills-final.log`.

Fresh-clone gate exits (all commands ran with `CI=true`):

| Gate                                       | Exit | Result                                                              |
| ------------------------------------------ | ---- | ------------------------------------------------------------------- |
| `npm run typecheck`                        | 0    | All five projects; 0 errors                                         |
| `npm run lint`                             | 0    | Full JS/TS and CSS; PowerShell's expected darwin platform skip      |
| `npx prettier --check <six changed files>` | 0    | All clean                                                           |
| Plain `npx knip`                           | 0    | Only existing vendor/axe-core configuration hints                   |
| `npm run duplication`                      | 0    | 0 clones                                                            |
| `npm run check:reference`                  | 0    | Current, 18 Devices entries                                         |
| `node scripts/check-l10n.mjs`              | 0    | 14 UI/14 usage tables, 0 problems                                   |
| `npm run check:host-api`                   | 1    | Existing generated inventory mismatch, two Node reader counts below |
| `npm run cycles`                           | 0    | No cycles                                                           |
| `npm run build`                            | 0    | All budgets, splits, host globals and notices passed                |

Production budget receipts (KiB): Devices **82.6/100**, activation
**462.8/600**, Model API **456.0/475**, ACP **155.3/850**, webview startup
**733.8/900**, original deferred webview **31.9/50**. No cap changed;
the stricter 733.8 KiB startup review baseline also stays intact. Notices
cover **88 bundled packages**. Gate details are `fresh-gates.json` and
`fresh-<gate>.log` alongside the test/drill receipts.

**Integration request, W-owned file:** refresh
`docs/ide-compatibility/host-api.md` with `npm run check:host-api -- --write`,
review the two inherited reader-count updates (`node:crypto` **93 → 94**,
`node:path` **125 → 126**), then rerun the inventory gate. This repair adds
no Node import reader beyond lane A's already recorded two changes. Inventory
facts remain **366 VS Code APIs**, **43 VS Code-importing files**, **28 Node
built-ins**, **70 theme variables**. No shared generated record was edited here.

All three review findings are fixed and all final owning verification passes.
The inventory refresh, joined CHANGELOG/docs and aggregate `npm run quality`
remain lane W's explicit ownership under `M100P2-common.md` and the PLAN.md
phase-2 table. No merge, push, rebase, live call or paid call was made.
