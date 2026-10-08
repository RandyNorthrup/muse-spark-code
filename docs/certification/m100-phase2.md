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
rules into main's G50–G52 and the two verification rows to G60/G61.)
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

### Verification orchestration discoveries (now G60, G61)

Vitest 5.0.2's `list --filesOnly --shard=N/4` returned the whole manifest for
each shard. The complete/disjoint preflight rejected it before execution;
derive the actual membership from the configured execution sequencer instead.
Vitest also refuses `--merge-reports` with its blob reporter. Those attempted
intermediate collation commands failed; test collection continued. Final
collation retains every test/error/module graph and uses the same pinned
coverage-map merge in bounded groups, with an official direct/reduced-map
equivalence check and final official threshold merge. G60/G61 (first G37/G38)
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

## Lane D: QR and mDNS discovery (M100P2D)

2026-10-08, macbook rig, worktree `/Users/user/lanes/M100P2D`, branch
`m100/p2-d` from `81f070674` (phase 1 plus the phase-2 plan and lane 0).
No live model calls in this lane: model attempts **0**, inference spend
**0**. No listener beyond loopback in tests; all sockets are fakes.

Lane D owns `src/host/devices/qrInvite.ts` (QR invite payload contract),
`src/host/devices/deviceMdns.ts` (the DNS-SD binding with its minimal codec
behind the injected mDNS port),
`src/host/devices/deviceDiscoverySwitch.ts` (the discovery switch and
Blocked-or-unreachable setup region), the persisted `discoveryEnabled`
region of `src/host/devices/deviceStore.ts`, the shared lane-test host
`test/unit/helpers/deviceLaneHosts.ts`, and the owning tests
`test/unit/deviceQrInvite.test.ts`, `test/unit/deviceMdns.test.ts` and
`test/unit/deviceDiscoverySwitch.test.ts`.

### Dependencies and the 100 KiB finding (AGENTS.md rule 9)

Measured on this lane: `dist/devices.js` allows 100 KiB and stood at about
85.6 KiB before this lane. The first cut bundled `qrcode-generator@2.0.4`
(21,323 bytes minified) and `dns-packet@5.6.1` (30,990 bytes with its single
`@leichtgewicht/ip-codec` dependency) for 136.7 KiB, over budget. Both are
CJS, so the bundler carries them whole; no host-side render encoder fits
the cap. The lane was reworked to zero new runtime dependencies instead:

- QR: the host owns the identical-text payload contract only
  (`encodeQrInviteText`, `decodeScannedInviteText`); pixels are lane U's
  lazy qr/ views. Verified but NOT installed for U's later use:
  `qrcode-generator@2.0.4` (MIT, zero dependencies, no peers, ships its own
  types, dependency-free with no network or native code).
- mDNS: the binding carries a minimal hand-rolled DNS-SD codec
  (`src/host/devices/deviceMdns.ts`, PTR/SRV/TXT under our service type
  only, bounded name/pointer/count guards) over `node:dgram`. No
  Avahi/Bonjour SDK, no native build, no new dependency.
- `npm audit` at install time: 12 findings, all pre-existing dev-tooling
  chains (`@vscode/vsce` via secretlint, stylelint/globby/micromatch/braces,
  mocha via serialize-javascript, source-map-js); none names a lane package.
  After the rework `package.json` carries no new dependency, so
  `THIRD_PARTY_NOTICES.txt` gains no entry; the production build below
  regenerates it unchanged.
- Request to the lead: confirm lane U installs `qrcode-generator@2.0.4`
  (exact pin above) for its lazy qr/ chunk, or name another encoder.

### Acceptance mapping

- A QR invite decodes to the identical text invite, carrying public
  certificate, fingerprint, address, protocol version and bounded validity,
  never a Bearer [REDACTED] `encodeQrInviteText`
  (`src/host/devices/qrInvite.ts`) returns the canonical public text byte
  for byte; `decodeScannedInviteText` trims only surrounding scanner
  whitespace, refuses private-key material before parsing, then runs the
  strict text parser, so the result stringifies back to the exact scanned
  bytes. Tests: `test/unit/deviceQrInvite.test.ts` › "encodes the identical
  canonical text the manual path accepts" and "keeps private-key material
  out of every renderable text".
- mDNS is off by default, advertises only opaque service id, port and
  protocol version, and a spoofed record never replaces the saved peer pin.
  `DeviceDiscoverySwitch` reads off until an explicit local `setDiscovery`
  choice persisted as `discoveryEnabled`
  (`src/host/devices/deviceStore.ts`); the binding announces only `id`/`v`
  TXT entries plus the port SRV under an opaque instance name, and
  `decodeDeviceMdnsPacket` picks only those three fields while ignoring
  extras. The codec is proven against third-party bytes: captures from the
  reference codec (dns-packet 5.6.1) for our response, our query and a
  foreign service, plus byte mutations (extra entries, SRV mismatch,
  compression pointers and loops, truncation, cache-flush classes, case). A
  hint stays `{address, port}` and `material` still demands the saved
  fingerprint. Tests: `deviceMdns.test.ts` › "a spoofed mDNS record never
  replaces the saved peer pin" and `deviceDiscoverySwitch.test.ts` › "stays
  silent when chosen without a paired offer".
- Manual entry completes mutual pairing over typed text with discovery
  fully blocked. Test: `deviceDiscoverySwitch.test.ts` › "completes mutual
  pairing over typed text while multicast stays denied" (the mDNS port
  denies every open while pairing over typed invitation text succeeds; the
  proof materials with the saved fingerprint and refuses a wrong pin —
  no TCP opens).
- Blocked-or-unreachable setup names the listener, interface, address and
  port with OS/admin recovery. A denied bind answers the fixed
  `blocked-or-unreachable` setup with `listenerApplication`/`interfaceLabel`
  facts and no reflected text. Test: `deviceDiscoverySwitch.test.ts` ›
  "answers a denied bind with fixed Blocked-or-unreachable recovery".

### Red drills (break, fail, restore byte-exact)

Pre-drill SHA-256: `src/core/devices/pairing.ts`
`215d91406120ace27cae0c3607a826a2f2c9294278b1e22685ef0e91770df116`,
`src/host/devices/devicePairing.ts`
`18d758f353963a38701f3b1967b1a22a3d28a5bbfb4ac28af4e4c4502bb79eea`,
`src/host/devices/deviceDiscovery.ts`
`3e587922aec4ff30f6386cf244b384762c14deebc6201f450e3840365df96f16`.
All three hashes identical after restore (verified below).

- Drill 1, public copy without its private key: removed the
  `checkPrivateKey` assertion from `devicePrivateKey`. Result:
  `deviceQrInvite.test.ts` 1 failed ("refuses confirmation signed with any
  other key").
- Drill 2, spoofed mDNS record: removed the peer-pin comparison from
  `DevicePairing.material`. Result: `deviceMdns.test.ts` 1 failed ("stays
  an address hint").
- Drill 3, discovery without consent: removed the policy early-return from
  `DeviceDiscovery.start`. Result: the new golden
  `deviceDiscoverySwitch.test.ts` › "stays silent when chosen without a
  paired offer" failed (plus phase-1 `deviceDiscovery.test.ts` › "does no
  work with discovery off"). The golden was added after the first attempt
  showed the lane suite alone did not catch this break; it now does.
- Final re-proof on the finished tree (all three breaks at once): 3 failed
  (exactly the three drill tests), 16 passed; hashes identical after
  restore (verified below).

### Verification (this worktree, default timeouts)

- `npx vitest run test/unit/deviceQrInvite.test.ts
test/unit/deviceMdns.test.ts test/unit/deviceDiscoverySwitch.test.ts
--maxWorkers=3` three times: 19 passed each time.
- Neighbors `deviceStore`, `deviceDiscovery`, `devicePairingAdapter`:
  78 passed. Full unit suite: see the final gate below.
- `npm run typecheck` (host, webview, unit, e2e, integration): clean.
- `npm run lint:js` (full tree, `--max-warnings=0`): clean.
- `npx prettier --check` on every changed file: clean.
- Plain `knip`: exit 0 (two pre-existing configuration hints only).
  `jscpd`: 0 clones (the two lane harnesses share
  `test/unit/helpers/deviceLaneHosts.ts`, which reuses the existing memory
  secret store).
- `npm run check:reference`: current. `node scripts/check-l10n.mjs`:
  14 tables, 0 problems (no new strings; the switch reuses `discovery`,
  `discoveryDescription` and `blockedHelp`). `node scripts/check-host-api.mjs`:
  regenerated for the new `node:dgram` import, 0 problems.
- `npm run build`: production bundles under budget (`dist/devices.js`
  against its 100 KiB cap, caps otherwise unchanged) with notices
  regenerated unchanged (no new dependency).

## Lane D fix (RVM100P2D): six P2 and one P3 made structural

2026-10-08, macbook rig, worktree `/Users/user/lanes/FIXM100P2D`,
branch `m100/p2-d-fix` from `f28e1ea40` (lane D). Review
`/Users/user/lanes/_ctx/codex/RVM100P2D.report.md`. Fix commit `bb2b6544`
(five files: `deviceMdns.ts`, `deviceDiscoverySwitch.ts`, both owning
tests, `test/unit/helpers/deviceLaneHosts.ts`). No live model calls:
model attempts **0**, inference spend **0**. No listener beyond loopback
in tests; all sockets are fakes.

Shared-region approval (lead, lane brief): the two lines the review
flagged stay as registration lines — `src/host/devices/deviceEntry.ts:27`
(the `createDeviceMdnsPort, decodeDeviceMdnsPacket` re-export) and
`docs/ide-compatibility/host-api.md:435` (the `node:dgram` row). No other
shared file or region was touched; `deviceDiscovery.ts` (lane T) is
unchanged, which bounds finding 1 as noted below.

- P2 post-bind failures (`src/host/devices/deviceMdns.ts:391`): any UDP
  failure closes the socket and fails later sends with the fixed
  `blocked-or-unreachable` word, never socket or peer text. A throwing
  send throws from `advertise` (`deviceMdns.ts:429`); a post-bind socket
  error closes the socket and fails the next send the same way. Startup
  failures (bind error, membership denial) reject `open` after closing the
  created socket, so `DeviceDiscovery` maps them and the switch answers the
  Blocked-or-unreachable setup as before. Boundary: `DeviceDiscovery`
  (lane T, untouched) still swallows a throwing rotation announce into
  `stop()` — the observable contract is halted discovery with the socket
  closed and no further traffic, proven by `a failed first announcement
stops discovery with the socket closed`. Tests:
  `test/unit/deviceMdns.test.ts:219` (throwing send),
  `test/unit/deviceMdns.test.ts:237` (post-bind error),
  `test/unit/deviceMdns.test.ts:265` (first announcement halts).
- P2 failed startup closes its socket (`deviceMdns.ts:382`): every step
  after `bind` (synchronous bind throw, startup-window socket error,
  `setMulticastInterface`/`addMembership` denial) closes the created
  socket before rejecting, so retries leak nothing. Test:
  `test/unit/deviceMdns.test.ts:251` (membership and bind denials reject
  with the fixed word and `closed` 1).
- P2 query budget (`deviceMdns.ts:438`): service-query answers share
  discovery's packet budget — at most `DEVICE_LIMITS.queuedFrames` (32)
  responses per advertisement rotation, only while an advertisement is
  current, re-armed by each `advertise`. Test:
  `test/unit/deviceMdns.test.ts:281` (1,000 queries in one rotation send
  32 answers; the next rotation re-arms).
- P2 compressed SRV target (`deviceMdns.ts:327`): each kept record carries
  its whole message plus its RDATA offset, and the SRV target decodes
  against message offsets. Test: `test/unit/deviceMdns.test.ts:294` (golden
  with the SRV target replaced by a pointer and RDLENGTH 8 decodes).
- P2 Additional-section records (`deviceMdns.ts:184`): Answers and
  Additional records are kept (Authority only positions), so a standard
  DNS-SD layout with PTR in Answers and SRV/TXT in Additional decodes.
  Test: `test/unit/deviceMdns.test.ts:313` (golden re-headered to ANCOUNT 1
  / ARCOUNT 2 decodes).
- P2 switch serialization (`src/host/devices/deviceDiscoverySwitch.ts:42`):
  state-changing turns run through a `serialized` tail (the store's
  `ordered`/`settled` idiom, no `withResolvers`: host targets Node 20), so
  a later OFF always runs after an earlier ON's facts resolve and wins.
  Test: `test/unit/deviceDiscoverySwitch.test.ts:208` (deferred facts: ON
  then OFF ends off, persisted off, session closed).
- P3 manual-entry proof (`test/unit/deviceDiscoverySwitch.test.ts:238`,
  helper `test/unit/helpers/deviceLaneHosts.ts:44`): the test now completes
  mutual pairing over typed invitation text — pair, import each side's
  text, confirm both fingerprints, import both confirmations — with the
  mDNS port denying every open (a `setDiscovery` attempt answers
  `blocked-or-unreachable` first), then materials with the saved
  fingerprint while a wrong pin refuses with `unpaired`. The dance lives in
  `completeLaneMutualPairing`, shared with the spoof test, so `jscpd`
  stays at 0 clones.

### Test-fire proof (base `f28e1ea40`, new test files copied over, rig run)

Worktree `/tmp/m100base` at `f28e1ea40` with the fixed test files:
`test/unit/deviceMdns.test.ts` 7 failed, 7 passed;
`test/unit/deviceDiscoverySwitch.test.ts` 1 failed, 7 passed. Every new
regression test fails on the base; every pre-existing test passes. The
rewritten manual-entry proof passes on the base (its pairing flow is valid
there), so its strength is drilled instead: the same file with the
import/confirm/complete blocks removed fails (1 failed, 7 passed),
proving the middle steps are load-bearing.

### Verification (fresh clone `/tmp/fixm100-verify`, `npm ci`, `CI=true`, default timeouts)

- Owning `deviceQrInvite`, `deviceMdns`, `deviceDiscoverySwitch` three
  times: 27 passed each time. Neighbors `deviceStore`, `deviceDiscovery`,
  `devicePairingAdapter`: 78 passed.
- `npm run typecheck` (host, webview, unit, e2e, integration): 0 errors.
- `npm run lint:js` (full tree, `--max-warnings=0`): clean.
- `npx prettier --check` on all five changed files: clean.
- Plain `knip`: 0 errors (two pre-existing configuration hints only).
  `jscpd`: 0 clones.
- `npm run check:reference`: current (Devices reference 18 entries).
  `node scripts/check-l10n.mjs`: 14 tables, 0 problems. `node
scripts/check-host-api.mjs`: 0 problems.
- `npm run build`: `dist/devices.js` 87.5 KiB against its 100 KiB cap,
  caps otherwise unchanged, notices regenerated unchanged.

## Lane D fix round 3 (RVM100P2DB): the discovery switch reads one live status

2026-10-08, macbook rig, worktree `/Users/user/lanes/FIXM100P2D2`, branch
`m100/p2-d-fix2` from `c85d5fa68` (lane D fix round 2). Review
`/Users/user/lanes/_ctx/codex/RVM100P2DB.report.md`. Third-round rule:
restructure the failing part instead of patching it — the remaining P2 was
the switch inferring success from a resolved `start()`, so discovery now
owns one status (`off`, `starting`, `on`, `blocked-or-unreachable` with the
fixed reason) and the switch subscribes to it and shows exactly what it
says. No live model calls: model attempts **0**, inference spend **0**. No
listener beyond loopback in tests; all sockets are fakes.

Shared-region note: this round touches `src/host/devices/deviceDiscovery.ts`
(lane T) exactly where the brief named it — the rotation-announce swallow
(`:119`), now `haltBlocked`, plus the `DeviceDiscoveryStatus` / `status()` /
`onStatus()` surface and the `onStatus` session hook it reads. The lane T
test file is untouched and still passes: the hook is optional so older fakes
keep working, and discovery still derives the verdict from a throwing
`advertise`. Request to the lead: confirm lane T owns the new status surface
going forward.

- P2 owned status (`deviceDiscovery.ts`, `deviceMdns.ts:429`,
  `deviceDiscoverySwitch.ts:76`, `:137`): the mDNS session publishes
  `blocked-or-unreachable` (fixed word, never socket or peer text) whenever
  it fails — a throwing send, a post-bind socket error, a closed port — at
  startup and after it; `DeviceDiscovery` mirrors every failure into its
  owned status via `haltBlocked` (traffic halts, socket closes, verdict
  stays) instead of resolving into silent success. The switch reads that
  status after `start()` resolves and stays subscribed: a later failure
  flips the switch off and persists it through the serialized tail. Tests:
  `deviceDiscoverySwitch.test.ts` › "shows Blocked-or-unreachable when the
  bind succeeds but a later send fails" (full switch path over the real
  binding: bind ok, first send throws, reply is `blocked-or-unreachable`
  with recovery facts, switch and store off, status blocked, socket closed,
  nothing sent) and › "shows Blocked-or-unreachable when a socket error
  lands after startup" (ON succeeds, `socket.fail()` flips `isEnabled()` and
  the persisted bit to off with the status blocked and no sentinel text);
  `deviceMdns.test.ts` › "publishes blocked-or-unreachable to session
  subscribers on a send failure", and the first-announcement test now also
  asserts the blocked status (and `off` after `stop()`).
- P3 docs honesty: the lane D acceptance mapping above now cites the live
  test title ("completes mutual pairing over typed text while multicast
  stays denied") with no connects/TCP claim.

### Test-fire proof (base `c85d5fa68`, new test files copied over, rig run)

Worktree `/tmp/m100d3base` at `c85d5fa68` with the fixed test files plus the
new `test/unit/helpers/deviceMdnsFakes.ts` (the `FakeSocket` it shares):
`test/unit/deviceMdns.test.ts` 2 failed, 13 passed;
`test/unit/deviceDiscoverySwitch.test.ts` 2 failed, 8 passed. The four
failures are exactly the new/strengthened status tests (the switch-path
pair, the session-publish test, the first-announcement status assertion);
every pre-existing test passes on the base.

### Verification (fresh clone `/tmp/fixm100d3-verify`, `npm ci`, `CI=true`, default timeouts)

- Owning `deviceQrInvite`, `deviceMdns`, `deviceDiscoverySwitch` three
  times: 30 passed each time. Neighbors `deviceStore`, `deviceDiscovery`,
  `devicePairingAdapter` (worktree): 78 passed.
- `npm run typecheck` (host, webview, unit, e2e, integration): exit 0.
- `npm run lint:js` (full tree, `--max-warnings=0`): exit 0.
- `npx prettier --check` on all seven changed files: clean.
- Plain `knip`: exit 0 (two pre-existing configuration hints only).
  `jscpd`: 0 clones.
- `npm run check:reference`: current (Devices reference 18 entries).
  `node scripts/check-l10n.mjs`: 14 tables, 0 problems. `node
scripts/check-host-api.mjs`: 0 problems.
- `npm run build`: `dist/devices.js` 88.9 KiB against its 100 KiB cap,
  caps otherwise unchanged.

## Lane D fix round 4 (RVM100P2DC): serialized discovery state machine

2026-10-08, macbook rig, worktree `/Users/user/lanes/FIXM100P2D3`,
branch `m100/p2-d-fix3` from `e34f47715`. Scope is the review's one P2
and two P3s: every switch input and asynchronous completion enters one
queue; stale ON continuations cannot overwrite a blocked verdict; store
failures remain visible with a fresh read of the persisted value; dropping
an offer or enable flag during open settles discovery to off. Preserve all
lane D tests and files. No UI styling, dependencies, wire changes, live
model calls or real sockets are needed.

### Acceptance and review repairs

- P2 ordering: `deviceDiscoverySwitch.ts` applies every request, session
  verdict, facts/read/start completion and persist result on one synchronous
  event queue. Effects only enqueue results. Operation identity and phase
  reject stale continuations; the single outstanding write settles before
  the next write or choice. A blocked verdict invalidates the active ON and
  all older queued ONs, immediately clears the choice, and queues the OFF
  write. An ON completion cannot reopen the session or finish before its
  downgrade settles; later OFF retains order and wins. Tests: "keeps a
  blocked verdict when a second ON is still awaiting facts" (also an older
  third ON queued), and "orders a queued downgrade behind an in-flight ON
  write without reopening, then OFF wins" (both writes deferred; reply stays
  pending until the downgrade finishes; no second advertisement).
- P3 persistence: `status()` exposes the machine's choice, discovery verdict,
  fixed failure and confirmed persisted flag. A failed write publishes
  `storage`, attempts a fresh read and reports `persistedEnabled: undefined`
  if the failed-closed store refuses it. Never infer that the disk is off.
  Tests: "reports a failed live downgrade and rereads the persisted flag",
  "reports unknown persistence when the failed downgrade cannot be reread",
  "keeps a later OFF when a failed downgrade reread completes", and "reports
  an ON persist failure before any socket opens and a later OFF still works".
- P3 lifecycle: `deviceDiscovery.ts` closes the newly opened session and
  settles this generation to off when offer/enable disappears during open
  or the first announcement. Generation checks keep an older open from
  stopping a newer session. Tests: "settles off when the offer drops during
  open" through the switch; the two parameterized "settles off when %s drops
  during open without stop" and "settles off when %s drops in the first
  announcement" cases through discovery. Existing consent-without-offer,
  stale-open, QR, mDNS, manual-pairing and pin tests remain intact.

### Test-fire proof and red drills

Detached base worktree `/tmp/fixm100p2d3-base` at `e34f47715`, final switch
and discovery tests copied in, `CI=true`, repository-default timeout:
**11 failed, 22 passed**. Every new regression fails on the base; all old
cases pass. The reread-completion case hits the 5-second timeout because the
base swallows the write failure and never attempts the read.

Guard breaks run directly with `npx vitest run <file> --maxWorkers=3 -t
<case>` and `CI=true`; each restores byte-exact source before the next:

| Drill           | Removed guard                                                    | Result               |
| --------------- | ---------------------------------------------------------------- | -------------------- |
| stale-facts     | active operation/phase check on facts completion                 | 1 failed, 16 skipped |
| downgrade-order | outstanding downgrade check before completing the older ON write | 1 failed, 16 skipped |
| persist-report  | storage failure in the machine's displayed state                 | 2 failed, 15 skipped |
| open-policy     | current-generation stop after policy disappears                  | 2 failed, 14 skipped |
| announce-policy | current-generation stop after first announcement loses policy    | 2 failed, 14 skipped |

SHA-256 before and after every drill:
`deviceDiscoverySwitch.ts`
`f89cbc12da6c30f8540c740f09138de00ad01b9924bafa9a2b262d794bf95c56`;
`deviceDiscovery.ts`
`e6a06a3ac3f0d372d6c841e9ddf6b2794db483fae8be89208619b7a1bd56742e`.
Restored tree: switch/mDNS/discovery **48 passed**; all five compiler
projects pass.

### Verification (fresh clone, CI=true, repository-default timeouts)

Repair commit `e10fd2003897f4f8ee9bfbc84257543aeb15a6fc`, cloned directly
from this worktree to `/tmp/fixm100p2d3-verify`; `CI=true npm ci` exits 0.
The clone remains clean after the checks; no generated or budget file changed.

- `npx vitest run test/unit/deviceQrInvite.test.ts
test/unit/deviceMdns.test.ts test/unit/deviceDiscoverySwitch.test.ts
--maxWorkers=3`: **37 passed**, three runs.
- `npx vitest run test/unit/deviceDiscovery.test.ts --maxWorkers=3`:
  **16 passed**, three runs. All four owning files total **53 passed per
  repetition**; no raised timeout. Worktree neighbors `deviceStore`,
  `devicePairingAdapter`, `deviceDiscoverySwitch`: **83 passed**.
- `npm run typecheck`: host, webview, unit, e2e and integration all exit 0.
- `npm run lint:js`: full tree, `--max-warnings=0`, exit 0.
- `npx prettier --check` on all six changed files: exit 0.
- Plain `npx knip`: exit 0, the same two existing configuration hints.
  `npm run duplication`: exit 0, **0 clones**.
- `npm run check:reference`: current (53 features, Devices 18 entries).
  `node scripts/check-l10n.mjs`: 14 tables, **0 problems**.
  `node scripts/check-host-api.mjs`: **0 problems**.
- `npm run build`: exit 0, `dist/devices.js` **91.6/100 KiB**, extension
  **441.6/600 KiB**, Model API **447.3/475 KiB**, ACP **823.6/850 KiB**.
  All original caps, split/global guards and notices pass unchanged.
- Repair commit hooks: ESLint/Prettier and staged gitleaks exit 0. Re-read
  the committed diff and empty index after the hook; both production hashes
  still match the drill restoration above.

### Planning status and next slice

This lane completes all three round-4 findings; no contract change is
requested. The phase-2 planning record remains the phase-2 baseline, with
lane D's receipts here; it does not certify the other lanes or installed
Devices. Next slice belongs to W: integrate the lane branches, consume the
switch's `status()` for snapshots (including `storage` and unknown persisted
state), run aggregate quality and installed-host/four-device qualification.
Lane T retains discovery's generation/status ownership. No visual styling
changed, so no screenshot claim is made. Model attempts **0**, spend **0**;
all sockets are fakes.

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

## Lead integration — M100P2INT (Windows host, 2026-10-07)

Worktree `mx-m100int`, branch `m100/p2-int-lead` from `3cfd06391`. Three
authorized `git merge --no-ff` steps, in order. Model attempts **0**, inference
spend **0**, no push.

| Merge       | Source                                                                       | Conflicts and resolution                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `12310b6f0` | `81f070674` (`m100/p2-l0-fix2`, lane 0 UTF-8 capability byte cap)            | This record: keep the base-integration section and add the lane 0 re-review after it. `devices.ts` and its test merged cleanly.                                                                                                                                                             |
| `d2e4b4e43` | `a6ccaf594` (`refs/rigs/kubuntu/m100/p2-c-fix`, lane C with RVM100P2C fixes) | None. Its five code and test files are byte-identical to `a6ccaf594`.                                                                                                                                                                                                                       |
| `466a7a8e4` | `18dc73651` (`origin/main`: 0.15.0, PR #137, PR #139)                        | `CHANGELOG.md`: keep the Devices Unreleased entries, main's harness fix and its Documentation section. `PLAN.md` D100: keep both sides' amendments. `docs/orchestration-gotchas.md`: the reconciliation below. `test/harness/index.html` and `vsixPackaging.test.mjs` merged automatically. |

No l10n table, generated reference or host API record changed; `check:l10n`,
`check:reference` and `check:host-api` confirm they are current.

### Gotcha register reconciliation

Main numbered the SSH-limit rows G49 (key installs), G50 (handshake
throttling), G51 (Windows desktop heap) and G52 (password and probe
penalties). Lane 0 had registered the same findings as G29–G31; the base
integration held them as G34–G36, ids main has since used for other rows.
Main's rows are kept and lane 0's duplicates removed. Their M100 rule text
moves into main's rows:

- **G50:** one long-lived authenticated channel per pair, at most 3 pending
  handshakes per host; status notes that lane C paces it.
- **G51:** a scheduled-task or service context, recovery steps, no registry
  change without consent, slot caps calibrated from transport health.
- **G52:** failed authentications of every kind are counted, never retried in
  a loop; status notes that lane C stops after one failure and sends no probe.

Plan (lane C is now `D100: G50, G52`, lane H `D100: G14, G15, G51`), threat
model, phase-2 plan record, source comments in `constants.ts` and
`devices.ts`, and the test names in `devicePhase2Contracts.test.ts` and
`channel.test.ts` name G50–G52. The historical text above keeps its ids and
gains pointers to the new ones.

The base integration's two verification rows (Vitest shard membership, bounded
report reduction) were G37/G38, which main also released for other rows. They
become **G60** and **G61**, because open PR #141 claims G53–G59 and the
0.16.0 fix branch (`fix/0160`) claims G53–G55 for other rows.

The register test now requires unique row ids and exactly one row holding
each M100 SSH-limit rule (G50, G51, G52), owned by M100 and marked amend.
Drills on `docs/orchestration-gotchas.md` (SHA-256 `2d777663…74ed30` before
and after each):

| Drill                                                       | Result                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| Renumber G61 back to G38 (the collision this merge removed) | 1 failed: `expected 53 to be 54`                    |
| Re-add lane 0's pacing row under an unused id after G52     | 1 failed: `expected [ …(2) ] to have a length of 1` |
| Restored file                                               | 1 passed                                            |

### Verification (Windows host, default timeouts)

- `devicePhase2Contracts`, `devices`, `channel`, `deviceMultiplexedChannel`
  and `deviceChannel`: 5 files, **198 passed**.
- All 23 Devices and channel test files: 20 pass (624 tests; `DevicesView`
  passed 78 on a rerun after its worker failed to start under load). The
  other three fail on Windows storage (below). Main's changed `harnessWaits`,
  `ollamaCodec` and `companionBrowser`: 78 passed.
- `npx eslint --max-warnings=0` on the 15 changed TypeScript/JavaScript
  files and `npx prettier --check` on all 27 changed files: clean.
- `check:l10n` (14 tables, 0 problems), `check:reference` (61 features,
  Devices 18 entries, current), `check:host-api` (0 problems).
- `gitleaks git` over `3cfd06391..HEAD`: 15 commits, no leaks.

### Host residuals (not caused by these merges)

- **Stale shared dependencies.** The worktree's `node_modules` junction lacks
  `pngjs` 7.0.0, `jpeg-js` 0.4.4 and `@types/pngjs` 6.0.5, and 11 packages
  are a patch behind the lockfile (vitest 5.0.1, prettier 3.9.8). So
  `npm run typecheck` exits 2. Its only errors are TS2307 for those two
  modules in `imageResizeWorker.ts` and `imageResize.test.ts` (host 2, unit 4,
  e2e 2); webview and integration are clean. `refreshBadges.test.mjs` and
  `vsixPackaging.test.mjs` cannot load (`check-badges.mjs` imports `pngjs`),
  and `teamHarness.test.mjs` cannot build production bundles. These three
  files need a lockfile-exact install or a rig before this head is called
  verified.
- **Windows device storage (P-I-WINDOWS-STORAGE).** `deviceStore` (14 of 15),
  `devicePairingAdapter` (51 of 51) and `deviceIntegration` (11 of 11) fail
  at `DeviceStore.create` with `storage`. On win32 the store refuses without
  a `DeviceStorageProtection` binding, and those fixtures pass none. The code
  is unchanged since phase 1 (`0a92cb94f`). Hosted Windows CI fails these
  76 tests until a Windows binding or fixture lands.
- **Hooks.** This worktree had no generated `.husky/_`, so the three merge
  commits ran without hooks. Afterwards gitleaks, ESLint and Prettier were
  run over the same changes; Prettier found this record's conflict table
  misaligned, fixed here. `.husky/_` (gitignored) was copied from the main
  checkout, so this commit ran lint-staged and gitleaks.

## Lane D review round 5 (RVM100P2DD, Grok on Kubuntu, 2026-10-07): clean

Reviewed `e10fd2003` and `1f09bd471` against the three RVM100P2DC findings.
No P1, P2 or P3. Each original finding replays red on base `e34f47715` (11
failed, 22 passed) and green on the fix. Two in-memory drills fire: dropping
the facts phase check fails 1, and dropping the current-generation `stop()`
fails 2. `deviceQrInvite`, `deviceMdns` and `deviceDiscoverySwitch` pass 37,
`deviceDiscovery` 16, and `check-l10n` finds 14 tables with 0 problems, all
at repository-default timeouts. Lane D merged into `m100/p2-int-lead` with
`docs/ide-compatibility/host-api.md` regenerated (0 problems).

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
- **P2 partially fixed (superseded by FIXM100P2A2 below)** — `actionGrants.ts:216`, `:251`, `:258` keeps the attestation
  bound to one dispatch's full identity and payload digest throughout policy
  checks. Every check still evaluates the current receiver intersection,
  action digest, grant revision and freshness. Standalone `admit` retains its
  one-use behavior. `deviceReceiver.ts:74` binds the scoped authority and
  `finishAdmission`; `:570` spends it before `lease.start`, and `:590` spends
  it on every terminal admission path. `actionGrants.test.ts:249` drives real
  `DeviceReceiver.dispatch` with real binding and fake connect/program/actuate:
  one mocked start, spent before start, second dispatch typed `step-up-required`.
  That mock skipped `boundary.beforeAction()`; this receipt did not prove launch. `:277`
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

P1 and P3 are fixed; the first P2 repair passes its mocked-start tests but
does not prove the real start contract (see FIXM100P2A2 below).
The inventory refresh, joined CHANGELOG/docs and aggregate `npm run quality`
remain lane W's explicit ownership under `M100P2-common.md` and the PLAN.md
phase-2 table. No merge, push, rebase, live call or paid call was made.

### Lane A second review repair — FIXM100P2A2 (2026-10-07, linuxlt)

Brief: `FIXM100P2A2.rig.md`; shared rules: `M100P2-common.md`. Base
`cd8913a7e`, branch `m100/p2-a-fix2`; review `RVM100P2AB.report.md` P2.
The first repair's P2 certification is superseded: its mocked start omitted
the execution contract's `boundary.beforeAction()` and did not prove launch.

Work plan (within the existing lane A admission region):

1. Correct dispatch regressions to retain the real execution-fixture start;
   run them on the unchanged base and record failures at default deadlines.
2. Keep the identity/digest-bound attestation through every start check; spend
   after start succeeds or admission settles without starting. Prove one
   launch, replay refusal, changed-payload refusal and failed-start consumption.
3. Break the lifecycle guard, observe assertion failures and restore byte-exact.
4. Commit with hooks, then verify committed source in a fresh `npm ci` clone:
   all four suites three times, five typechecks and required scoped gates.
5. Record final receipts and W-owned blockers, reread post-hook diffs and commit.

Status: steps 1–5 complete. P2 fixed end to end; final receipts below.
Integration qualification and the inherited host inventory remain W-owned.
Base source `cd8913a7e`: **6 failed / 85 passed**, exit **1**. Restored
fixed owning suites: **91 passed**, exit **0**. Every test uses the repository
deadline; no timeout override. A duplicated assertion block was extracted
into `expectSingleLaunch`; all assertions remain, duplication **0 clones**.
No wire shape, gate, cap, dependency, user-visible text or shared region
changes; live/paid attempts **0**.

#### P2 lifecycle and regression proof

`src/host/devices/deviceReceiver.ts:572` now calls `finishAdmission` after
`lease.start` succeeds, before the running-state journal advance; its terminal
`finally` at `:592` still spends a bound approval on every non-starting exit. The existing
identity plus dispatch-payload-digest key covers all checks in that one
start contract. Each check retains fresh intersection, action digest, grant
revision and time validation. No new owner abstraction or wire change is needed.

The corrected `actionGrants.test.ts:258`
`RVM100P2A-P2 confirms exactly one %s dispatch` tests use
the unchanged execution fixture's real start, including its own
`boundary.beforeAction()`, for connect/program/actuate: outcome running,
`launches === 1`, replay `step-up-required`, and another post-start action
boundary refused. Both in-flight identity/payload tests also retain real
start and assert one launch. The changed-action-payload test still refuses
and spends that attempt (`:337`). New test at `:323`,
`RVM100P2AB-P2 spends a bound attestation when
the real start boundary denies approval` reaches the fourth ordinary approval
inside real start, refuses with retained `uncertain` reservation, launches
zero times and proves terminal consumption. No start override remains in
these tests.

Final tests replayed on `cd8913a7e` source: **6 failed / 85 passed**, exit
**1** (three physical classes, two in-flight binding tests, one real-start
denial). Receipt: `/tmp/fixm100p2a2-receipts/base-final.log`.

| Deliberate lifecycle break         | Exit | Assertion failures                                     |
| ---------------------------------- | ---- | ------------------------------------------------------ |
| Spend before real `lease.start`    | 1    | 6 failed / 2 passed; outcome or fourth approval absent |
| Remove terminal spend in `finally` | 1    | 2 failed; denied attempts wrongly retain approval      |

Drills selected only the relevant regression names; full verification uses
unfiltered suites. Sources restored byte-exact after every base/drill run:

- `src/core/devices/actionGrants.ts`: `ea853c03c09ae319b774d36012cda148785c1ad33c4b7b7b90eb37f03ceb86f0`
- `src/host/devices/deviceReceiver.ts`: `5c10059e498540c8c7bd371da72a9afda9452936444ca1e84eecb5ad150651a9`

Receipts: `/tmp/fixm100p2a2-receipts/drills.json`, `drill-early-spend.log`,
`drill-terminal-spend.log`. All use `CI=true`, at most three workers and
repository default timeouts. No scope, dependency, threshold or cap changes.

#### Final fresh-clone receipt — FIXM100P2A2 (2026-10-08)

Verified implementation commit `cc49a2bfd49c0ec25dd24dd475a799e51138e6ac`,
cloned directly from this worktree into
`/tmp/fixm100p2a2-final-verify-20261007`. Node **24.21.0**, npm **11.19.0**.
`CI=true npm ci`: exit **0**, 901 packages added; unchanged lockfile. The
clone, committed tree and restored worktree share the two source hashes
recorded above. Test source SHA-256:
`8d19bd30fa274f16f5d1d172d5f9790410ff62bcd4c03eeda969d469a94a5e2e`.

All four complete suites ran three times with `CI=true`, in two-file batches
and at most three workers. No filters or timeout overrides: **164 passed
each time** (**91** actionGrants/devicePresenceRelay + **73**
deviceReceiver/channel), all six batch exits **0**. Batch wall times:
**1.63 + 3.46 s**, **1.57 + 3.49 s**, **1.57 + 3.45 s**.
Receipts: `/tmp/fixm100p2a2-receipts/fresh-tests.json` and
`fresh-tests-<run>-<batch>.log`.

Fresh-clone gates (`CI=true` throughout):

| Gate                          | Exit | Result                                             |
| ----------------------------- | ---- | -------------------------------------------------- |
| `npm run typecheck`           | 0    | All five compiler projects; no errors              |
| `npm run lint`                | 0    | Full JS/TS and CSS; expected Linux PowerShell skip |
| Changed-file ESLint           | 0    | Both source files and action-grants tests          |
| Changed-file Prettier         | 0    | All four files clean                               |
| Plain `npx knip`              | 0    | Existing vendor/axe-core configuration hints only  |
| `npm run duplication`         | 0    | 0 clones                                           |
| `npm run check:reference`     | 0    | Current; 18 Devices entries                        |
| `node scripts/check-l10n.mjs` | 0    | 14 UI/14 usage tables; 0 problems                  |
| `npm run check:host-api`      | 1    | Inherited W-owned generated inventory mismatch     |
| `npm run cycles`              | 0    | No cycles                                          |
| `npm run build`               | 0    | All caps, splits, host globals and notices pass    |

Production sizes (KiB): Devices **82.6/100**, activation **462.8/600**,
Model API **456.0/475**, ACP **155.3/850**, chat startup **733.8/900**,
original deferred webview **31.9/50**, Devices UI **33.8/50**. The stricter
733.8 KiB chat-startup baseline also holds. No cap changed; notices cover
**88** packages. All command exits are in `fresh-gates-*.json` and their
`fresh-<gate>.log` receipts under `/tmp/fixm100p2a2-receipts/`.

**Blocker / lead request:** W must run `npm run check:host-api -- --write`
and review the inherited `node:crypto` **93 → 94** and `node:path`
**125 → 126** reader counts in `docs/ide-compatibility/host-api.md`, then
rerun that gate. This repair introduces no new Node reader. Facts remain
**366** VS Code APIs, **43** importing files, **28** Node built-ins and
**70** theme variables. The inventory is outside this lane's ownership.
W also owns joined CHANGELOG/docs, aggregate `npm run quality`, installed
hosts and native-presence qualification under the phase-2 ownership table.
These are not claimed passed here. Lead integrates this branch; no merge,
push, rebase, real pairing, live model call or paid call was made.

The implementation commit passed ESLint/Prettier and Gitleaks hooks. To
honour the no-stash rule, a temporary external npx wrapper adds only
`--no-stash` to lint-staged; every hook still runs. Its captured post-hook
staged diff was reread and matches the committed diff exactly. The final
receipt changes documentation only; its formatting and hooked commit are
checked separately. Both trees were clean after code verification, before
this receipt update. Next: lead integration and W's inherited inventory
refresh plus aggregate/installed-host qualification.

## Lane R: reconnect, leases, result channel (verified on win11)

2026-10-07, branch `m100/p2-r`, worktree `C:/lanes/M100P2R`, base
`81f070674`. Codex completed the prior shell-blocked implementation;
the three earlier static reviews are superseded by these runner receipts.
Only lane R's new core files, owning tests/helper and this section change.
Phase-1 `attemptJournal.ts` and `deviceReceiver.ts` remain byte-exact.
No new strings, dependencies, commands, settings or constants. Model attempts
**0**, inference spend **0**; fakes only, no listener, device pairing or ACL change.

### Acceptance: each item done in the portable core

| Acceptance                                          | Implementation                                                                                                                                                          | Owning test                                                                                                                                | Guard break                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Pair-key identity and reconnect resume              | `reconnect.ts:40`, full saved identity checked, isolated copies, bounded leases; conflicting restored state refuses                                                     | `deviceReconnect`: scopes leases, restart adoption, reused attempt identity, returned-object isolation                                     | R1                                  |
| Resend only unacknowledged messages                 | `reconnect.ts:131`, schemas plus lane 0's `isAckForEnvelope`                                                                                                            | `deviceReconnect`: resends only unacknowledged envelopes                                                                                   | R2                                  |
| Lost admission reply never starts twice             | real phase-1 `DeviceReceiver.dispatch` and `AttemptJournal.lookup`, unchanged                                                                                           | `deviceReconnect`: drops the admission reply; admission and launch counters each 1                                                         | R3                                  |
| Failed poll reads unknown since time, never running | `epochs.ts:86`, earliest failure retained; `unknownSinceText` reads runtime `UI_TEXT` and `formatTime`                                                                  | `deviceEpochs`: marks a failed poll, earliest unknown time; `deviceReconnect`: failed-poll text                                            | R4                                  |
| Explicit lease expiry before a new epoch            | `epochs.ts:119`, expired status and elapsed deadline both required, epoch increment checked                                                                             | `deviceEpochs`: advance every timeout, early expiry/reopen refusal, future expiry marker                                                   | R5                                  |
| Re-dispatch from the last acknowledged checkpoint   | `reconnect.ts:116`, accepted/duplicate acks no later than the expired epoch win; absent accepted progress keeps the expired lease's opening checkpoint                  | `deviceReconnect`: no-result outage, expiry quarantine, future ack ignored; accepted progress still wins                                   | R6, P2-R                            |
| Late results quarantine                             | `resultChannel.ts:92`, reconciled lease is the authority, including before any new-epoch result arrives and at expiry                                                   | `deviceResultChannel`: old epoch before a new result, expired/future/missing lease                                                         | R7                                  |
| Content-addressed results acknowledged once         | `resultChannel.ts:92`, serialized durable receipt per epoch; repeat payload checked in full; persistent quarantine timestamps and older accepted receipts               | `deviceResultChannel`: accepts once, simultaneous resends, conflicting payload, time and restart, older accepted receipt                   | R8; six pre-fix regression failures |
| Corrupt durable state refuses, never empty success  | zod parses every load, binds receipt identity/epoch/digest/settlement; storage failure latches closed                                                                   | `deviceResultChannel`: corrupt/failing store and uncertain save; real receiver test refuses corrupt `attempts.json` before admission/start | R9, R11                             |
| Epoch-bound acknowledgements and shared caps        | `resultChannel.ts:179`, full-identity wait key, `isAckForEnvelope`, `canQueueResultAck`; duplicate waits remain valid at capacity; publish queue and leases bounded too | `deviceResultChannel`: old ack never settles next epoch, wait cap, blocked-storage publish cap; `deviceReconnect`: lease cap               | R10, R12, R13                       |

### Defects found by running the inherited work

The inherited 32 tests passed at default timeouts. Six added regression tests
then failed on the inherited implementation (6 failed, 32 passed): premature
reopen of a future expiry marker, replaced attempt identity, mutable returned
lease state, two simultaneous accepted replies, quarantine timestamp drift
across restart, and duplicate wait refusal at capacity. All now pass. The
initial duplication gate found four copied fixtures; shared lane-R fixtures
remove them without ignores or threshold changes. Initial lint/format defects
were fixed, including private method order, boolean names and stale imports.
All three inherited test casts have been removed: unknown boundary inputs are
parsed directly, so no new escape-hatch row in PLAN section 8 is needed.

### Red drills: actual assertion failures, then byte-exact restoration

Every targeted run used `npx.cmd vitest run <owning file> --maxWorkers=3 -t
<test pattern>` with the repository default timeout. Each returned exit **1**
with an owning assertion failure, and the final owning run returned **0**
(**47 passed**: epoch 13, reconnect 14, result channel 20). R3 and R11 inject
an in-memory journal lookup bypass in the owning test; phase-1 source stays
untouched. R3 observes two admissions after the dropped reply; R11 observes
one forbidden admission from corrupt storage. The restored tests assert one
admission/one launch and zero admissions/zero launches respectively.

| Drill | Deliberate break                                  | Observed failure                                      | Restored file SHA-256                                              |
| ----- | ------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| R1    | Bypass pair scoping                               | Required refusal did not occur (exit 1)               | `48da32de9d7ec8b9d0026cfbbb250cc99f223f64ed80220861dab61996ab7de9` |
| R2    | Treat all envelopes as unacknowledged             | Acknowledged envelope not settled (exit 1)            | `48da32de9d7ec8b9d0026cfbbb250cc99f223f64ed80220861dab61996ab7de9` |
| R3    | Hide the saved admission during resend, in memory | Admission spy called 2 times, expected 1 (exit 1)     | `4925b55be3df80468ae1e245c18f971584716a6e34548096c1bc5eb4603e7d23` |
| R4    | Return unchanged lease on failed poll             | current instead of unknown (exit 1)                   | `e4c32bf62e30d193a71b12541a6e5cad0a414d4bbe610ea3ebc398397df795d9` |
| R5    | Remove reopen expiry guard                        | Far-future clock alone permits reopen (exit 1)        | `e4c32bf62e30d193a71b12541a6e5cad0a414d4bbe610ea3ebc398397df795d9` |
| R6    | Allow quarantined ack to advance checkpoint       | Quarantined digest selected (exit 1)                  | `48da32de9d7ec8b9d0026cfbbb250cc99f223f64ed80220861dab61996ab7de9` |
| R7    | Ignore the authoritative lease epoch              | accepted instead of quarantined (exit 1)              | `8f8df21416e499b42805ef1398c800288b972357298de38ac6585c05812c4115` |
| R8    | Accept an already recorded result again           | accepted instead of duplicate (exit 1)                | `8f8df21416e499b42805ef1398c800288b972357298de38ac6585c05812c4115` |
| R9    | Ignore the loaded durable record                  | Publish resolves instead of refusing storage (exit 1) | `8f8df21416e499b42805ef1398c800288b972357298de38ac6585c05812c4115` |
| R10   | Match identity without epoch/digest               | Old ack settles the new wait (exit 1)                 | `8f8df21416e499b42805ef1398c800288b972357298de38ac6585c05812c4115` |
| R11   | Hide corruption from lookup, in memory            | Forbidden admission spy called once (exit 1)          | `4925b55be3df80468ae1e245c18f971584716a6e34548096c1bc5eb4603e7d23` |
| R12   | Remove the pending-wait cap                       | Extra wait does not throw (exit 1)                    | `8f8df21416e499b42805ef1398c800288b972357298de38ac6585c05812c4115` |
| R13   | Remove the fresh-lease cap                        | Excess lease does not refuse (exit 1)                 | `48da32de9d7ec8b9d0026cfbbb250cc99f223f64ed80220861dab61996ab7de9` |

The before and after SHA-256 matched in every drill. For R1/R2/R6/R13 the
restored file is `reconnect.ts`; R4/R5 `epochs.ts`; R7/R8/R9/R10/R12
`resultChannel.ts`; R3/R11 `deviceReconnect.test.ts`. The same hashes are
checked after all drills. The temporary logs/JSON are outside the worktree
under the rig's `m100p2r-verify-*` temporary directory.

### Verification

Direct worktree verification: the final owning run is 47 passed at default
timeouts; lint exits 0; duplication exits 0 with 0 clones; plain knip exits 0
(two existing configuration hints). Reference and l10n exit 0 (14 tables, 0 problems); the production build exits
0 with every cap unchanged (`dist/devices.js` 80.6 KiB / 100 KiB, activation
441.6 KiB / 600 KiB). All five typecheck projects exit 0 (host, webview, unit, e2e, integration).
Prettier on all eight changed files exits 0. Phase-1 regression suites
`deviceReceiver`, `deviceRecovery` and `devicePhase2Contracts` also pass:
**122 tests**, repository default timeouts.
`check:host-api` exits **1** solely because the new result channel imports
`node:crypto`: the generated built-in count is 56 versus the recorded 55.
That generated record belongs to lane W, so it is not changed here. Fresh-clone results are recorded below.
No gate threshold, rule, ignore or assertion was weakened.

### Fresh-clone CI verification (implementation `ac644c3ea`)

Fresh `git clone --no-hardlinks C:/lanes/M100P2R
C:/lanes/M100P2R-ci-9f5837`, committed HEAD
`ac644c3eabe72ad32c44cb614290a0d782efe598`, followed by `npm.cmd ci`.
Every verification process ran with `CI=true`. No test timeout override was
used in any exploratory, drill or final run. No dependencies or source files
were copied from the working tree; the clone remained clean after checks.

| Check                                                | Exit    | Receipt                                                                                                           |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm.cmd ci`                                         | 0       | 898 packages installed from the unchanged lockfile                                                                |
| Owning tests, three consecutive default-timeout runs | 0, 0, 0 | 47 passed each: deviceEpochs 13, deviceReconnect 14, deviceResultChannel 20; at most 3 files and `--maxWorkers=3` |
| `typecheck:host`                                     | 0       | Repository host project                                                                                           |
| `typecheck:webview`                                  | 0       | Repository browser project                                                                                        |
| `typecheck:unit`                                     | 0       | All unit test types                                                                                               |
| `typecheck:e2e`                                      | 0       | All e2e test types                                                                                                |
| `typecheck:integration`                              | 0       | Integration test types                                                                                            |
| ESLint `--max-warnings=0`                            | 0       | All 7 changed TypeScript files                                                                                    |
| Prettier `--check`                                   | 0       | All 8 changed files                                                                                               |
| Plain `npx.cmd knip`                                 | 0       | Only the two pre-existing configuration hints                                                                     |
| `npm.cmd run duplication`                            | 0       | jscpd: 0 clones; threshold unchanged                                                                              |
| `node scripts/check-l10n.mjs` via `check:l10n`       | 0       | 14 tables, 169 manifest strings, 657 source files, 0 problems                                                     |
| `check:reference`                                    | 0       | 53 features; 18 Devices reference entries; generated data current                                                 |
| `check:host-api`                                     | 1       | Sole diff: node:crypto import count 55 to 56; generated file owned by lane W                                      |
| `npm.cmd run build`                                  | 0       | Production build, all size/split/global/notices gates passed with original caps                                   |

`npm ci`'s automatic audit reports 12 vulnerabilities in this inherited lockfile
(2 low, 10 high); this lane changes no dependencies. The full joined-tree audit
and other `npm run quality` gates remain lane W's required qualification.
The implementation commit ran the normal ESLint/Prettier and gitleaks hooks
successfully (no leaks found). This receipt update changes documentation only.

### Wiring contract for the lead (lane W)

Lane 0's envelopes, `DeviceResultPort`, caps and ack matcher are unchanged.
Instantiate one `ResultChannel(store, leaseOf, clock)` per pair with the
reconciled receiver lease lookup; an incoming result is never its own epoch
authority. Persist lease mutations before redispatch and restore through
`DeviceReconnectSession.track`; a conflicting restore refuses. `reopenAttempt`
takes envelopes/acks and derives accepted progress or retains the expired
lease's opening checkpoint. The result store must atomically persist the full bounded
receipt record before resolving a save, reject unavailable or corrupt
initialized storage, and return undefined only for a genuinely new attempt.
The portable lane adds no installed listener, physical executor or storage
adapter: lane W owns wiring and installed-host qualification. README,
CHANGELOG, feature catalog and the complete joined-tree `npm run quality`
remain with lane W as assigned by PLAN, not a claim of this lane's certification.

Lead request: regenerate `docs/ide-compatibility/host-api.md` in lane W
with `npm run check:host-api -- --write` (the expected change on this base is
`node:crypto` imports 55 to 56). No shared-contract change is requested.

### Review round 1 fixes (FIXM100P2R)

2026-10-07, win11 rig, branch `m100/p2-r-fix`, base `44fffb8c8`;
review `C:/lanes/_ctx/codex/RVM100P2R.report.md` read in full.
Only `reconnect.ts`, its owning test and this lane R section change.
Model attempts **0**, spend **0**; all tests use fakes and no listener.

The recorded R6 refusal changes because G6 requires recovery after a whole
lease without accepted progress: the lease's opening checkpoint remains valid.

- **P2 fixed:** `reopenAttempt` uses `current.checkpoint` when no accepted or
  duplicate acknowledgement supplies a checkpoint through the expired epoch.
  An accepted checkpoint still wins; future and quarantined acknowledgements
  never advance it. The replacement contract test checks future-epoch acks,
  and two outage regressions check an absent result and a result quarantined
  exactly at expiry. Both reopen at epoch 2, keep the original identity and
  checkpoint, refuse a second reopen while leased, quarantine old-epoch late
  results (including resends), and accept the recovered epoch's result.
- **P3 fixed:** `useExecutionFixture('check')` is scoped to the receiver's
  `reconnect never launches twice` block. A separate pure reconnect regression
  makes `AttemptJournal.create` reject with `storage`, reaches its assertions,
  and verifies journal creation was never called. The two receiver tests still
  exercise real durable storage; no assertion or storage guard is relaxed.

With the final regression tests added and both fixes withheld on base
`44fffb8c8`, the three owning suites returned **exit 1: 4 failed, 46 passed**
(50 tests). P2 accounts for three `DeviceEpochError: uncertain` failures;
P3 accounts for one `DeviceJournalError: storage` failure in fixture setup.
After both fixes and drills, the identical command returned **exit 0: 50 passed**
(deviceEpochs 13, deviceReconnect 17, deviceResultChannel 20).
Every run used repository default timeouts and `--maxWorkers=3`, at most three files.

| Drill | Deliberate break                                                            | Observed red result                                                                     | Restored SHA-256                                                                               |
| ----- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P2-R  | Replace the opening-checkpoint fallback with the former `uncertain` refusal | 3 failed, 14 unselected; exit 1 (`opening checkpoint` filter)                           | `ec04e198e8cd517d8d54881782e2f28ad84471ee2a13ffd8816da19cd82bdd67` (`reconnect.ts`)            |
| P3-R  | Move the receiver fixture back to module scope                              | Storage-refusal regression fails before its assertions: 1 failed, 16 unselected; exit 1 | `f5c16e6eab65012b5a8491426ac66402469aa6c792350240be7a3c8f2a9fd220` (`deviceReconnect.test.ts`) |

Both restores matched the pre-drill file bytes and SHA-256. Logs are outside
the worktree in `C:/lanes/FIXM100P2R-verify-20261007/P2-drill.log` and
`P3-drill.log`. Fresh-clone verification is recorded with the follow-up receipt.

### FIXM100P2R fresh-clone CI receipt

2026-10-07–08, win11 rig.

Committed implementation `66a3c39dd38ad9d95625cc67fc352e53fdfba4b2` was
cloned with `git clone --no-hardlinks C:/lanes/FIXM100P2R
C:/lanes/FIXM100P2R-ci-20261007`, then installed with `npm.cmd ci`.
No source or dependencies were copied from the working tree.
All checks below ran with `CI=true`; all test runs used the repository's
default timeout, at most three files, and `--maxWorkers=3`.

`TMPDIR`, `TEMP` and `TMP` all selected the new private temporary root
`C:/lanes/FIXM100P2R-verify-20261007/private-temp`. On Windows, its NTFS ACL
has inheritance disabled and grants only the current user FullControl,
the platform equivalent of a private 0700 temp root. The inherited Windows
execution fixture still injects its existing journal-protection port;
these receipts do not qualify POSIX permissions or production Windows storage.
P3's injected storage refusal is portable and does not depend on that port.

| Check                                                       | Exit    | Receipt                                                                                                                                                                |
| ----------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd ci`                                                | 0       | 898 packages installed from unchanged lockfile                                                                                                                         |
| Owning suites, three consecutive runs                       | 0, 0, 0 | 50 passed each: epochs 13, reconnect 17, result channel 20                                                                                                             |
| `deviceReceiver`, `deviceRecovery`, `devicePhase2Contracts` | 0       | 122 passed, default timeouts                                                                                                                                           |
| `typecheck:host`                                            | 0       | Host/core/shared project                                                                                                                                               |
| `typecheck:webview`                                         | 0       | Browser project                                                                                                                                                        |
| `typecheck:unit`                                            | 0       | All unit test types                                                                                                                                                    |
| `typecheck:e2e`                                             | 0       | All e2e test types                                                                                                                                                     |
| `typecheck:integration`                                     | 0       | Integration test types                                                                                                                                                 |
| ESLint `--max-warnings=0`                                   | 0       | Both changed TypeScript files                                                                                                                                          |
| Prettier `--check`                                          | 0       | All three changed files                                                                                                                                                |
| Plain `npx.cmd knip`                                        | 0       | Two existing configuration hints only                                                                                                                                  |
| `npm.cmd run duplication`                                   | 0       | jscpd: zero clones; no threshold or ignore changes                                                                                                                     |
| `check:l10n`                                                | 0       | 14 tables, 169 manifest strings, 657 source files; zero problems                                                                                                       |
| `check:reference`                                           | 0       | 53 features, 18 Devices entries; generated files current                                                                                                               |
| `check:host-api`                                            | 1       | Sole inherited diff: `node:crypto` count 55 to 56; owned by lane W                                                                                                     |
| Production `npm.cmd run build`                              | 0       | All caps/split/globals/notices passed; Devices 80.6/100 KiB, activation 441.6/600 KiB, deferred webview 32.1/50 KiB                                                    |
| Full `npm.cmd run quality`                                  | 1       | Passed whole-repository formatting, JavaScript/CSS/PowerShell lint, all five typechecks, badges, l10n and reference; stopped solely at the inherited host-API mismatch |

The clone stayed clean after these checks. Per-check output and exit-code
JSON receipts are outside the worktree in
`C:/lanes/FIXM100P2R-verify-20261007/`.
`npm ci` reports the inherited lockfile's 12 vulnerabilities (2 low, 10 high);
this fix changes no dependency. The implementation's normal ESLint, Prettier
and gitleaks hooks all exited 0, with no secret leaks. The committed diff was
re-read after the hooks; no additional hook changes or staged files remained.

Full quality stopped before its later gates; the owning/phase-1 tests, knip,
duplication and production build were run separately above and passed.
The generated host-API record, README/CHANGELOG and complete joined-tree
qualification remain lane W's assigned files/work. Request unchanged:
regenerate `docs/ide-compatibility/host-api.md` there with
`npm run check:host-api -- --write`, then run full quality on the joined tree.
No source outside lane R, gate, assertion, timeout, cap or shared contract
was changed to obtain these results.

## Lead integration round 2 (lanes A, R)

Windows host, 2026-10-08. Worktree `mx-m100int`, branch `m100/p2-int-lead`
from `db09e194f`. Two `git merge --no-ff` steps, in order. Model attempts
**0**, inference spend **0**, no push. Hooks (lint-staged, gitleaks) ran on
every commit.

| Merge       | Source                                                                                                         | Conflicts and resolution                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bbb73dc40` | `cead4eb7b` (`refs/rigs/linuxlt/m100/p2-a-fix2`: lane A `5bbefbd4f`, round 1 `cd8913a7e`, round 2 `cead4eb7b`) | This record only: one hunk after the lane C fix section. Kept every integrated section unchanged and appended lane A's sections after the lane D round-5 review; both halves byte-identical to their sources. |
| `a3a44d4ae` | `2411f6f35` (`refs/rigs/win11/m100/p2-r-fix`: `ac644c3ea`, `44fffb8c8`, fixes `66a3c39dd`, `2411f6f35`)        | This record only: one hunk after the lane 0 re-review. Kept everything above, then lane R's sections after lane A's; both halves byte-identical to their sources.                                             |

No other file conflicted. Neither lane touches `CHANGELOG.md`, `PLAN.md`,
`src/shared/devices.ts` or `docs/ide-compatibility/host-api.md`; lane A's
`channel.ts` and `deviceReceiver.ts` additions merged automatically. Lane R
was built on `81f070674`: every import in its seven files (`shared/constants`,
`shared/l10n/text`, `shared/devices`, `core/devices/attemptJournal`, the
shared device fixtures) resolves on the integrated base, and no import names a
moved module.

**Regenerated.** `docs/ide-compatibility/host-api.md` with
`node scripts/check-host-api.mjs --write`: `node:crypto` readers 93 → 95
(`actionGrants.ts`, `resultChannel.ts`) and `node:path` 125 → 126
(`actionGrants.ts`). No l10n table or reference changed.

### Verification (Windows host for static gates, Kubuntu rig for tests)

| Gate                                                                  | Exit | Result                                                                     |
| --------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------- |
| `typecheck:host` (`tsc -p tsconfig.json --noEmit`)                    | 0    | clean                                                                      |
| `typecheck:unit` (`tsc -p test/unit/tsconfig.json --noEmit`)          | 0    | clean                                                                      |
| `eslint --max-warnings=0` on the 13 merged lane source and test files | 0    | clean                                                                      |
| `prettier --check` on those files, this record and `host-api.md`      | 0    | clean                                                                      |
| `node scripts/check-l10n.mjs`                                         | 0    | 14 UI tables, 14 usage tables, 197 manifest strings, 995 files, 0 problems |
| `node scripts/check-host-api.mjs` before regeneration                 | 1    | 1 problem: the two stale reader counts above                               |
| `node scripts/check-host-api.mjs` after regeneration                  | 0    | 0 problems                                                                 |
| `npm run cycles`                                                      | 0    | 871 modules, no circular dependency                                        |
| `gitleaks git --log-opts=db09e194f..HEAD`                             | 0    | 11 commits, no leaks                                                       |

Kubuntu rig, `rig-test.sh kubuntu … 1` (snapshot `1c5026f9` = `a3a44d4ae`
plus the regenerated `host-api.md`, lockfile base `dfccddb8e7d78460`,
repository-default timeouts): `test/unit/device*.test.ts`,
`actionGrants.test.ts` and `channel.test.ts` (lane A changed
`core/devices/channel.ts`). **29 files, 785 tests passed, 0 failed**, exit
**0**. Lane-owned files: `actionGrants` 80, `devicePresenceRelay` 11,
`deviceReconnect` 17, `deviceResultChannel` 20, `deviceEpochs` 13; shared
neighbours `deviceReceiver` 49, `channel` 24.

Not run here: the full `npm run quality` on the joined tree (lane R's wiring
contract asks for it) and the lanes' requests to the lead and lane W, which
stay open for the lead.

## Lane V — verified inputs and capability advertisement

2026-10-07, win11 rig, `C:/lanes/M100P2V`, branch `m100/p2-v`, base
`81f070674`. Codex completed the inherited, uncommitted implementation
after the Muse shell failure; no ACL, permission or sandbox setting changed.
Model attempts **0**, inference spend **0**; all tests use injected fakes,
with no listener or real second device. Exclusive files only: new
`src/core/devices/inputManifest.ts`, `src/core/devices/capability.ts`, their
two owning test files, and this lane's certification section. Shared schemas,
caps, strings and gate settings are unchanged. README, CHANGELOG, feature
reference and shipped wiring remain lane W's assigned regions.

### Acceptance mapping

| Requirement                                                               | Implementation and owning tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result / red drills                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-addressed inputs plus base objects, verified before start (G1/G2) | `inputManifest.ts:58` strict versioned manifest, bounded items/paths/bytes, matched 40/64-hex Git objects; `:88` Windows path normalization; `:108` fixed-order digest; `:145` dispatch/manifest parse and attempt/base/tree/digest binding, both base-object checks, every file's digest and byte size. `deviceInputManifest.test.ts`: complete copy, missing plan, missing commit/tree, mismatched content/size, each dispatch binding, invalid shapes, caps, duplicate normalized paths, Windows end to end. | Done in lane V's verifier; caller must await it before admission/start (lane W). V1–V9.                                                                                     |
| Measured capability advertisement under lane 0's schema and cap           | `capability.ts:23` stamps measured fields and parses; `:38` wire parse and future-clock bound; `:54` offer binds device/incarnation/platform/workers. `deviceCapability.test.ts`: measured build/admit, field-invalid and oversize refusal, multibyte UTF-8 cap, skew edge, all offer refusals.                                                                                                                                                                                                                 | Done for the fields in the accepted contract; no truncation. V10–V16. Hardware inventory beyond presence flags needs the contract clarification below.                      |
| Live pressure and transport failure signals for M107 (G12)                | `capability.ts:93` passes aggregate CPU/memory/disk pressure, power and measured slot cap; reports reset delta plus elapsed milliseconds (rate division belongs to M107). Missing/nonadvancing samples or counter restarts return nulls; invalid previous measurements refuse. Owning tests: shapes pressure and transport signals; counter restarts/reversed time; invalid clocks/samples.                                                                                                                     | Done for accepted aggregate fields, V17–V19. Separate OS-service pressure is blocked on lane 0's absent field; actual sampling and governor consumption belong to H/W/M107. |

Completion review fixed unchecked input byte sizes, duplicate normalized
paths, missing offer device-id binding, invalid sampling clocks and negative
transport deltas after counter restarts. Assertions were added or strengthened;
none was weakened or skipped. The attempt-binding test uses a correctly
rehashed manifest for a different attempt, so it independently proves the
identity guard. The duplication finding in the oversize fixture was removed
within the owning tests.

### Test-fire proofs

Each mutation ran only its owning test file, using the repository default
timeout and `--maxWorkers=3` (no `--testTimeout`). Every row exited **1**
with the listed assertion-failure count, then restored the source from its
original in-memory bytes and checked the SHA-256 before/after.

`M` = `src/core/devices/inputManifest.ts`, owning file
`test/unit/deviceInputManifest.test.ts`; `C` = `src/core/devices/capability.ts`,
owning file `test/unit/deviceCapability.test.ts`.

| Drill | File / intentional break                   | Owning test selector                                        | Failures |
| ----- | ------------------------------------------ | ----------------------------------------------------------- | -------- |
| V1    | M: disable missing/digest/size refusal     | refuses a plan file; refuses mismatched content             | 2        |
| V2    | M: disable both base-object checks         | refuses a base commit                                       | 1        |
| V3    | M: remove digest binding                   | refuses a manifest the dispatch                             | 1        |
| V4    | M: remove attempt identity binding         | refuses a manifest the dispatch                             | 1        |
| V5    | M: remove base binding                     | refuses a manifest the dispatch                             | 1        |
| V6    | M: remove tree binding                     | refuses a manifest the dispatch                             | 1        |
| V7    | M: ignore declared byte size               | refuses a worker input with                                 | 1        |
| V8    | M: allow duplicate paths                   | refuses duplicate paths                                     | 1        |
| V9    | M: disable relative-path validation        | refuses unsafe paths                                        | 1        |
| V10   | C: build without schema parsing            | refuses a measurement that serializes; applies the byte cap | 2        |
| V11   | C: admit wire input without schema parsing | refuses future-dated; applies the byte cap                  | 2        |
| V12   | C: remove future-skew check                | refuses future-dated                                        | 1        |
| V13   | C: remove offer device binding             | binds offers                                                | 1        |
| V14   | C: remove incarnation binding              | binds offers                                                | 1        |
| V15   | C: remove platform binding                 | binds offers                                                | 1        |
| V16   | C: remove measured slot cap                | binds offers                                                | 1        |
| V17   | C: emit zero CPU pressure                  | shapes pressure and transport                               | 1        |
| V18   | C: emit zero transport delta               | shapes pressure and transport                               | 1        |
| V19   | C: remove counter-restart guard            | does not invent a transport rate                            | 1        |

Byte-exact restored SHA-256 (the same hash on every drill of that file):

- M: `a8d7dc21e9bde74619feea1188ab0528b076aa4c4b3b8f80c38adb805d1d2ca5`.
- C: `b11f7f076e93ad1ef1ace8de9484be650211283bab46063318986d9dffb19a85`.

Restored owning run: `npx.cmd vitest run test/unit/deviceInputManifest.test.ts
test/unit/deviceCapability.test.ts --maxWorkers=3`, **25 passed** (15 manifest,
10 capability), exit **0**, repository-default timeouts.

### Worktree verification

| Gate                                                          | Exit / receipt                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Five typecheck projects (`npm.cmd run typecheck`)             | 0; host, webview, unit, e2e, integration                                                       |
| Changed TypeScript ESLint (`npx.cmd eslint --max-warnings=0`) | 0                                                                                              |
| Changed-file Prettier                                         | 0                                                                                              |
| Plain `npx.cmd knip`                                          | 0; two pre-existing configuration hints                                                        |
| `npm.cmd run duplication` (jscpd)                             | 0; zero clones                                                                                 |
| `node scripts/check-l10n.mjs`                                 | 0; 14 tables, zero problems                                                                    |
| `npm.cmd run check:reference`                                 | 0; 53 features, Devices 18 entries, current                                                    |
| `npm.cmd run check:host-api`                                  | 1; generated Node reader count: `node:crypto` 55 → 56; regeneration is lane W's exclusive file |
| `npm.cmd run build`                                           | 0; unchanged caps, split/host-globals/notices clean; `dist/devices.js` 80.6/100 KiB            |

The production build still contains the phase-1 Devices implementation:
passing it proves existing bundle gates, not shipped phase-2 wiring. The
joined-tree full `npm run quality`, coverage/integration/a11y and installed
four-device qualification are explicitly lane W's acceptance, not a receipt
claimed by this lane.

### Fresh-clone CI verification

Verified implementation commit `d89b9c69219d8b7260b9db8f4481f0a61cc446be`
in `C:/lanes/_verify/M100P2V-20261007-2150`, cloned directly from the committed
worktree with `git clone --no-hardlinks --branch m100/p2-v`. Every command
ran with `CI=true`; `npm.cmd ci` exited **0** (898 installed packages).
Its install audit reported 12 issues (2 low, 10 high) in the unchanged lockfile;
this lane adds or changes no dependency and makes no full security-gate claim.

- Owning test command above ran **three times**, repository-default timeouts:
  **25 passed / 25 passed / 25 passed**, each exit **0** (15 manifest,
  10 capability); durations 2.16 s, 1.85 s and 1.83 s.
- Every gate in the worktree table was repeated in this fresh clone with
  the same exit code: host/webview/unit/e2e/integration typechecks **0**,
  changed-file ESLint **0**, changed-file Prettier **0**, plain knip **0**,
  duplication **0**, localization **0**, reference **0**, production build
  **0**. Host API **1** with only the same `node:crypto` count 55 → 56
  request; its assigned generated file was left unchanged.
- Source SHA-256 matches both restored drill hashes above; the fresh clone
  remains clean after all checks. The original worktree's implementation
  commit used normal hooks: ESLint/Prettier and the staged gitleaks scan
  passed, with no leaks and no bypass.

### Requests to the lead

- Lane W: await `verifyDispatchInputs` with a worker-local reader before
  admission/start; transport the manifest/base objects first; wire capability
  build/admit, offer admission and signals into the lazy Devices bundle and
  M107. Sample baselines must belong to the same device/incarnation.
- Lane W: regenerate the assigned host API record with
  `npm.cmd run check:host-api -- --write`; the exact current diff is the
  `node:crypto` reader count 55 → 56. Carry this change into the joined-tree
  README/CHANGELOG/reference and full gate.
- Contract question (lane 0): `deviceCapabilitySchema` has hardware-presence
  booleans and aggregate CPU/memory/disk pressure, but no hardware inventory
  or separate OS-service pressure. Clarify whether those satisfy the PLAN
  bullet; otherwise add the versioned fields in the shared contract before
  lane H measures and lane V/W admits/consumes them. This lane did not guess
  or broaden a shared wire shape.
- Optional contract consolidation: export the canonical `relativePath` and
  `gitObject` schemas so the compact manifest mirrors can reuse them.

### Review RVM100P2V round 1 (FIXM100P2V, 2026-10-07)

Branch `m100/p2-v-fix`, base `d8960e6bfa38c6af37c79a03724f407bd6967dbc`,
Windows 11 rig. Both review findings are fixed. The brief explicitly extends
this correction to the shared path helpers; other lanes' regions and generated
records remain their owners' work. No live model call, real-device pairing,
new dependency, wire shape, user-facing string or widened gate is involved.

| Finding                                         | Fix and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2: manifest uniqueness misses Windows aliases  | `src/core/devices/inputManifest.ts:73` compares `windowsPathIdentity` for every item at schema admission, so build and worker verification refuse collisions with `invalid-frame` on **every platform**, before any base-object or input read. `test/unit/deviceInputManifest.test.ts:315` covers all five review pairs, mixed case, trailing dots/spaces on multiple segments, Windows separators and AUX/NUL/COM/LPT names; each pair asserts build, wire-schema and worker refusal with no reads.                                                                                                                                                                                                                                                                                      |
| P2: trailing protected-name aliases             | The one shared implementation is `src/core/pathIdentity.ts:6` (trailing-name trimming) and `:11` (Windows normalization, separator and case identity). Workspace confinement, held-tree writable names and Windows folding, `isSamePath`/folder membership, and shared protected-name checks all use it. `src/core/protectedPaths.ts:33` treats `.git.`, mixed-case/backslash variants, aliased workflow directories and `AGENTS.md. ` as protected everywhere. It preserves every segment of unresolved approval paths. `test/unit/deviceInputManifest.test.ts:341` and `test/unit/pathIdentity.test.ts` cover protection, path comparisons and confinement; existing `heldTree.test.ts` and the workspace-path cases in `modelApiTools.test.ts` cover their unchanged rejection policy. |
| P3: offer admission skips future-skew admission | `src/core/devices/capability.ts:53` accepts unknown boundary values and an explicit receiver clock, calls `admitCapability` once (schema, UTF-8 cap, clock/future skew), then parses and binds the offer. `test/unit/deviceCapability.test.ts:143` reproduces exactly `now=1700000000000`, `observedAt=1700000030001`, skew=30000; it refuses the future value and accepts the exact boundary. The next test proves malformed/oversized/multibyte advertisements and invalid clocks refuse before offer binding.                                                                                                                                                                                                                                                                          |

**Path policy decision:** manifest uniqueness deliberately uses the Windows
identity on Linux, macOS and Windows alike; it cannot change with the receiver's
OS. Stored wire spellings and digest serialization remain unchanged. A segment
that becomes a protected name after Windows drops trailing dots/spaces is
protected on every platform. This does not make reserved device names ordinary
files: the existing Windows workspace/held-tree refusal stays in force.

**Native Windows evidence:** the default-timeout test at
`deviceInputManifest.test.ts:345` creates an isolated temporary copy and opens
both spellings of the case, trailing-dot, trailing-space, `.git.` and separator
pairs using ordinary `CreateFileW`; `GetFinalPathNameByHandleW` reports the
identical file for each pair. `test/unit/helpers/windowsFileIdentity.ps1` runs
one hidden, noninteractive PowerShell process with process-only execution
policy. Handles and temporary files are cleaned up. Node/libuv's extended-path
opens retain trailing dots on this rig, so that API cannot prove the ordinary
Win32 rule; this test exercises Win32 directly. Reserved devices are tested
with pure comparisons and refusals, never opened.

#### Base failure proof

Fresh clone `C:/lanes/_verify/FIXM100P2V-base-20261008` at the exact base above;
only the two updated regression test files and the native test helper were
overlaid. `CI=true`, `npm.cmd ci` **0**, then
`npx.cmd vitest run test/unit/deviceInputManifest.test.ts
test/unit/deviceCapability.test.ts --maxWorkers=3`, repository-default
timeouts, **1**: **18 failed, 26 passed** (manifest **16 failed/16 passed**;
capability **2 failed/10 passed**). All 25 original tests and the native
Win32 proof passed; the new assertions exposed the two review defects.

#### Correction red drills

Each drill used the direct Vitest CLI with `--maxWorkers=3`, the owning file
and the named selector, repository-default timeouts. A selector leaves
unselected tests pending; no assertion was weakened or disabled. Each mutation
was restored from its saved bytes in `finally`, then the SHA-256 was checked.

| Drill           | Intentional break / owning selector                                                                                    | Exit / failures | Restored SHA-256                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| V-fix-identity  | `inputManifest.ts`: replace canonical uniqueness with raw path characters; `refuses Windows identity collisions`       | 1 / 12          | `1baee6a4f2f330bfbf22f1cc02aa3e4352b95373f3b589139f33d71e97575e4e` |
| V-fix-protected | `protectedPaths.ts`: case fold only, without Windows name identity; `recognizes protected names`                       | 1 / 4           | `8e92b85758d6da2e1933e28d03425b5918cd545ffedbd4d02ec843ca2e94233c` |
| V-fix-offer     | `capability.ts`: parse capability schema instead of calling admission; `review future-dated\|admits schema, UTF-8 cap` | 1 / 2           | `84d8d2a0f0e39c3b36c7b50d5da5c8c19f77be3ed56490be115761521b6107ec` |

Restored worktree run: manifest/capability/held-tree **99 passed**, exit **0**.
Shared identity/workspace-tools/held-tree run **104 passed**, exit **0**.
All five worktree typecheck projects **0**. Implementation commit
`ac0d4d6b66ec9d0e18383330c0fcf1f6df3444b6` used normal hooks: changed-file
ESLint/Prettier and staged gitleaks **0**, no leaks. The staged/committed diff
was re-read after the hook, and all three restored source hashes still match.

#### Fresh-clone final verification

Exact implementation commit above, cloned with `--no-hardlinks` into
`C:/lanes/_verify/FIXM100P2V-ci-20261008`. Every command ran with `CI=true`;
`npm.cmd ci` exited **0**, 898 installed packages. The unchanged lockfile's
install audit reports 12 issues (2 low, 10 high); no dependency changed and
this correction makes no full security-gate claim.

The owning suites ran **three times**, at most three files per invocation,
`--maxWorkers=3`, with repository-default timeouts and no `--testTimeout`:

- `npx.cmd vitest run test/unit/deviceInputManifest.test.ts
test/unit/deviceCapability.test.ts test/unit/heldTree.test.ts --maxWorkers=3`:
  **99 / 99 / 99 passed**, exits **0 / 0 / 0**; durations 3.43 s, 3.11 s,
  3.08 s. Counts: manifest 32, capability 12, held tree 55. The native
  Windows proof ran and passed each time.
- `npx.cmd vitest run test/unit/pathIdentity.test.ts
test/unit/modelApiTools.test.ts --maxWorkers=3`:
  **49 / 49 / 49 passed**, exits **0 / 0 / 0**; durations 3.67 s, 2.60 s,
  2.67 s. Counts: shared identity 8, workspace-path/tool cases 41.
- Total: **148 tests per round, 444 passing executions**, no skipped test
  in any of these final Windows runs.

| Fresh-clone gate                                        | Exit / receipt                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Five typecheck projects (`npm.cmd run typecheck`)       | 0; host, webview, unit, e2e and integration                                                                                                     |
| Changed TypeScript ESLint, `--max-warnings=0`           | 0                                                                                                                                               |
| Changed-file Prettier (TypeScript and certification)    | 0                                                                                                                                               |
| Native test helper, PSScriptAnalyzer 1.25.0 / PSGallery | 0; zero findings                                                                                                                                |
| Plain `npx.cmd knip`                                    | 0; the same two pre-existing configuration hints                                                                                                |
| `npm.cmd run duplication`                               | 0; jscpd, zero clones                                                                                                                           |
| `npm.cmd run check:l10n`                                | 0; 14 tables, 169 manifest strings, 657 source files, zero problems                                                                             |
| `npm.cmd run check:reference`                           | 0; 53 features, 18 Devices entries, current                                                                                                     |
| `npm.cmd run check:host-api`                            | 1; only generated reader counts: `node:crypto` 55 → 56 (base lane V) and `node:path` 89 → 90 (shared helper); lane W owns regeneration          |
| `npm.cmd run build`                                     | 0; all unchanged size/split/host-globals/notices gates pass; Devices 80.6/100 KiB, webview startup 738.0/900 KiB, original deferred 32.1/50 KiB |

All three source SHA-256 values match the drill restores and committed worktree;
the fresh clone remains clean after verification. Phase-2 manifest/capability
wiring and the joined-tree full `npm run quality` remain lane W's acceptance,
as in the original lane V record; no full-quality result is claimed here.

Integration requests remain with lane W: call `admitOfferCapability` with the
receiver's current clock (a separate admission call is no longer needed),
regenerate its host API record for the two count changes above, and carry these behavior corrections
into its assigned Unreleased changelog and joined-tree full quality gate.

### Lane V second review correction — Win32 is the identity oracle

2026-10-08, win11 rig, `C:/lanes/FIXM100P2V2`, branch `m100/p2-v-fix2`,
base `32c55827f`. Read the shared phase-2 rules and both reviews,
`RVM100P2V.report.md` then `RVM100P2VB.report.md`. No merge, push, model
request, paid use, listener or real second device. This corrects the first
review's overbroad intermediate-name identity; the earlier certification's
claim that every segment drops all trailing dots/spaces is superseded here.

| Finding                                                 | Root correction and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2: canonical POSIX backslashes became separators       | `src/core/protectedPaths.ts` receives the resolver's already-canonical relative path and splits only `/`. It never infers an OS from a backslash. Case and conservative protected-name refusals remain. `pathIdentity.test.ts` and `workspacePath.test.ts` cover Linux and macOS literal backslashes; the original `permissions.test.ts` Windows-versus-POSIX regression also passes. MSP's separate raw-subject entrypoint retains its documented conservative separator conversion.                                                                                                                                                                                                                                                                                                      |
| P2: distinct intermediate Windows directories collapsed | `src/core/pathIdentity.ts` is the single lexical Windows identity: only one trailing intermediate period is removed; multiple periods and spaces remain; a terminal name loses trailing periods/spaces only without a final separator. Exact extended paths bypass normalization. `paths.ts` folds before `path.relative` can discard that separator. `pathIdentity.test.ts` corrects the wrong containment assertion and checks the native oracle. Manifest tests admit distinct `plans..` and `plans. ` directories while preserving all 12 true-collision refusals. `worktreeConversations.test.ts` refuses to transfer confirmed trust to either distinct directory; `fsAtomic.test.ts` refuses an approval bound to the other directory before rename, preserving the original bytes. |

Workspace and held-tree writable-name refusals retain their prior conservative
policy: they refuse trailing dots/spaces and device names before writing.
`windowsName` documents that policy rather than claiming all intermediate
Windows names normalize that way. Manifest uniqueness still applies the one
Windows identity on every platform, with stored wire spelling and digests
unchanged. No schema, cap, timeout, assertion or gate was relaxed.

#### Native OS oracle

Read Microsoft's [Windows path normalization](https://learn.microsoft.com/en-us/dotnet/standard/io/file-path-formats#path-normalization),
including the Windows 11 legacy-device note and exact extended-path exception.
The strict-zod-parsed native receipt comes from
`test/unit/helpers/windowsFileIdentity.ps1`, one hidden noninteractive process.
Fixtures are created by `CreateDirectoryW` and `CreateFileW`, ordinary aliases
are opened by `CreateFileW`, and disk identities come from
`GetFileInformationByHandle` (volume serial plus 64-bit file index). Directory
handle identities determine containment independently of the TypeScript
helper. `GetFullPathNameW` additionally checks ordinary normalized spelling;
exact extended opens bypass that call, as Win32 does. Handles and temporary
trees are cleaned in `finally`. The test uses the repository's default 5 s
deadline, without `--testTimeout`.

All 11 rows assert `windowsPathIdentity`, `isSamePath`, and `isWithinFolder`
against the native result:

| First spelling / second spelling (inside a fresh temporary root) | Native result                                                   | Inside second folder            |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| `name.` / `name`                                                 | Same volume and file index                                      | Yes                             |
| `name ` / `name`                                                 | Same volume and file index                                      | Yes                             |
| `name. .` / `name`                                               | Same volume and file index                                      | Yes                             |
| `a.\child` / `a\child`                                           | Same volume and file index; same directory index                | Yes                             |
| `a..\child` / `a\child`                                          | Distinct file and directory indexes                             | No                              |
| `a. \child` / `a\child`                                          | Distinct file and directory indexes                             | No                              |
| `NAME` / `name`                                                  | Same volume and file index                                      | Yes                             |
| `a. \` / `a\`                                                    | Distinct directory indexes; final separator preserves the space | No                              |
| Exact extended `\\?\<root>\literal.` / ordinary `literal`        | Distinct file indexes; extended final period remains            | Yes, both in the temporary root |
| `NUL` / `nul`                                                    | Same character device (`GetFileType = 2`), no disk file index   | No                              |
| `nul.txt` / `NUL.TXT`                                            | Same disk volume and file index on Windows 11                   | Yes                             |

The reserved-name row is honest about the OS: NUL has no volume/file index.
`CreateDirectoryW(NUL)` returns success here but creates no disk directory;
an exact extended-path open returns `ERROR_FILE_NOT_FOUND` (2). Workspace
policy refuses both `NUL` and `nul.txt` regardless of that OS difference.
No console, serial or printer device is read or written. Disk opens request
no read/write access.

#### Exact-base regression and red drills

Fresh clone `C:/lanes/_verify/FIXM100P2V2-base-20261008`, exact base above,
`CI=true`, `npm.cmd ci` **0**. Only the four updated regression test files,
the new workspace-path suite and native helper were overlaid; base production
code was untouched. Default deadlines, `--maxWorkers=3`, at most three files:

- `pathIdentity`, `deviceInputManifest`, `permissions`: **9 failed / 104 passed**,
  exit **1** (including the original permissions regression).
- `fsAtomic`, `worktreeConversations`, `workspacePath`: **6 failed / 47 passed /
  1 skipped**, exit **1**. The existing POSIX-only file-mode test is the skip.
- Total: **15 failed / 151 passed / 1 existing platform skip**. Every new
  defect regression fails on the base; Windows writable-name policy controls
  and the remaining existing assertions pass.

Each drill saved bytes, mutated one guard, ran the direct Vitest CLI, restored
bytes in `finally`, and verified SHA-256 equality. Unselected tests are pending
because of the named selector, not disabled assertions.

| Drill          | Intentional break / selector                                                                                                                                                            | Exit / failures | Restored source SHA-256                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| V2-POSIX       | Reinsert unconditional backslash separation in `protectedPaths.ts`; `POSIX backslashes\|backslashes separate\|resolved path segments` across identity, permissions and workspace suites | 1 / 5           | `a818814250524529f7b0e843a49bbbb1ff68684a19411f02621bd39a3b04cc80` |
| V2-Win32       | Trim all intermediate dots/spaces in `pathIdentity.ts`; `intermediate\|folder membership\|native Win32\|confirmed trust to a distinct` across identity, manifest and worktree suites    | 1 / 8           | `62886fe56759df7e0ca37f7dce65eefd9a3bad03b40417d60885aeda0555a469` |
| V2-containment | Restore resolve-before-fold in `paths.ts`; `native Win32`                                                                                                                               | 1 / 1           | `b35833024b5ca8b7d27ca7e1261f2cc3f793c670388217a812d2258288746ac3` |

Restored worktree: identity/manifest/permissions **113 passed**; atomic writes,
worktree trust and workspace paths **53 passed / 1 existing platform skip**;
held-tree/tools/Muse Code protected writes **121 passed**. Five typecheck
projects, changed-file ESLint/Prettier, and PSScriptAnalyzer 1.25.0/PSGallery
for the changed helper exit **0**. Fresh-clone final receipts follow separately.

Lane W still owns its host API record regeneration, Unreleased changelog and
joined-tree full `npm run quality`. Carry these shared protection/identity
corrections into that integrated gate; this lane claims only its actual checks.

#### Second-review fresh-clone final verification

Implementation `a5e2830bc46f13ac8e622f09983ecb13d3e8e4f9`, normal hooks
enabled: changed-file ESLint/Prettier and staged gitleaks **0**, no leaks.
The staged diff was re-read after the hook (empty after commit), then the
committed implementation/test diff was re-read. All three restored source
hashes above still match. No manually invoked stash, merge or push.

Fresh clone with `--no-hardlinks` at that exact commit:
`C:/lanes/_verify/FIXM100P2V2-ci-20261008`. Every verification shell sets
`CI=true`; `npm.cmd ci` **0**, 898 installed packages. No dependency changed;
the unchanged install audit reports the same 12 issues (2 low, 10 high).
This is not a full security/audit gate receipt.

Each group ran with `npx.cmd vitest run <three files> --maxWorkers=3`,
repository-default deadlines and no timeout override:

| Owning suites                                             | Round 1                                     | Round 2                                     | Round 3                                     | Exits     |
| --------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | --------- |
| `deviceInputManifest`, `deviceCapability`, `pathIdentity` | 59 passed; 4.61 s                           | 59 passed; 3.84 s                           | 59 passed; 3.85 s                           | 0 / 0 / 0 |
| `permissions`, `heldTree`, `workspacePath`                | 129 passed; 2.87 s                          | 129 passed; 2.60 s                          | 129 passed; 2.61 s                          | 0 / 0 / 0 |
| `modelApiTools`, `fsAtomic`, `worktreeConversations`      | 86 passed, 1 existing platform skip; 4.54 s | 86 passed, 1 existing platform skip; 3.74 s | 86 passed, 1 existing platform skip; 3.74 s | 0 / 0 / 0 |

Total **274 passed per round, 822 passing executions**, with the same existing
POSIX-only atomic-write mode test skipped once each round on Windows. Both
native Windows identity tests ran and passed every round; no new test skipped.
The new `workspacePath.test.ts` isolates the prior writable-name policy and
canonical separator contract already exercised by the tools/permissions suites.

| Fresh-clone gate                                               | Exit / receipt                                                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                        | 0; host, webview, unit, e2e and integration projects                                                                                                     |
| Changed-file ESLint, `--max-warnings=0`                        | 0; all eight changed TypeScript files                                                                                                                    |
| Changed-file Prettier                                          | 0; TypeScript and certification                                                                                                                          |
| Changed PowerShell helper, PSScriptAnalyzer 1.25.0 / PSGallery | 0; zero findings                                                                                                                                         |
| Plain `npx.cmd knip`                                           | 0; same two pre-existing configuration hints                                                                                                             |
| `npm.cmd run duplication`                                      | 0; jscpd, zero clones                                                                                                                                    |
| `npm.cmd run check:l10n`                                       | 0; 14 tables, 169 manifest strings, 657 source files, zero problems                                                                                      |
| `npm.cmd run check:reference`                                  | 0; 53 features, 18 Devices entries; current                                                                                                              |
| `npm.cmd run check:host-api`                                   | 1; same inherited generated reader counts: `node:crypto` 55 → 56 and `node:path` 89 → 90; lane W owns regeneration                                       |
| `npm.cmd run build`                                            | 0; unchanged size, split, host-global and notices gates; extension 442.0/600 KiB, Devices 80.6/100 KiB, webview startup 738.0/900 KiB, ACP 824.0/850 KiB |

The fresh clone remains clean after every check. Production source SHA-256
values match the drill restores and committed worktree. This final addition
changes certification text only; it does not change the tested implementation.
Integration requests remain the lane W requests above. There is no contract
change request and no full-quality, installed-host or live-model claim.

### Lane V round 3 redesign — refuse nonportable manifest spellings (2026-10-08)

Brief `C:/lanes/_ctx/FIXM100P2V3.rig.md`, shared rules
`C:/lanes/_ctx/codex/M100P2-common.md`; reviews RVM100P2V, VB and VC read
in that order. Branch `m100/p2-v-fix3` from `851a23341`; implementation
`7a1ae34606f5e88c1dd32bbb5f163b48f3b92a2c`. This section supersedes the
earlier rounds' implementation descriptions; their receipts remain historical.

The owner's round-three decision changes the approach: a manifest is a
portable spelling contract, not an emulation of Win32 file identity. Each
review exposed another mismatch between string normalization and an OS open,
and the extraction had extended that approximation into unrelated guards.
This redesign implements the existing PLAN lane V input-validation scope;
it adds no protocol, feature, dependency, setting, command or UI string.

#### Grammar and dispatch order

`src/core/devices/inputManifest.ts` validates the original path at both build
and wire admission. It never rewrites the builder's path or reader's lookup.

| Rule                                                                       | Implementation / test                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relative, `/` separators only; no backslash, colon, drive or device prefix | ASCII segment whitelist plus nonempty segments; reviewed-spelling table and generated forbidden characters                                                                                  |
| Every segment uses ASCII letters, digits, space, `._-+@`                   | Negative character class; generated accepted segments exercise every allowed character and 256 deterministic combinations                                                                   |
| No empty, `.` or `..` segment; no segment ending in dot or space           | Explicit segment checks, including intermediate segments; generated forbidden segment and trailing-run cases                                                                                |
| No Windows reserved name, regardless of case or extension                  | CON, PRN, AUX, NUL, COM0–9, LPT0–9, CONIN$, CONOUT$ and COM/LPT superscript ¹²³ variants; generated names in first and last positions, upper/lowercase, bare, `.txt`, ` .txt` and `:` forms |
| At most 512 characters in the whole path                                   | Existing `DEVICE_LIMITS.pathChars`; the boundary is accepted and boundary + 1 refused                                                                                                       |
| One item per case-folded valid path                                        | `item.path.toLowerCase()` uniqueness; original twelve collision rows retained, with case-only pairs equated and invalid spellings refused individually                                      |
| Protected names compared only after manifest validation                    | Valid `.GiT/config`, `.CLAUDE/settings.json`, `.GitHub/workflows/build.yml` and `AGENTS.MD` retain protection through the restored helper; trailing aliases fail grammar first              |

Dollar signs, superscript digits, all other Unicode and NTFS short-name `~`
spellings are also excluded by the character whitelist. Reserved ASCII names
with spaces before their extension are explicitly refused. No platform-specific
path emulation remains in this module. The 78 reviewed-spelling cases and
generated forbidden cases assert `invalid-frame` at build/schema/dispatch and
empty base-object and file-read lists. The grammar table runs on every platform;
only the native filesystem proof is Windows-specific. This rig ran Windows 11.

Dispatch digest/attempt/base/tree binding, missing input, changed content/size
and missing base-object refusals remain covered. The capability module is
unchanged from `851a23341`, retaining offer future-skew admission and measured
governor signals. Original lane V acceptance/drill records above still apply.

#### Shared restoration

The following command exits **0** with no diff:

```text
git diff --exit-code 81f070674 HEAD -- src/core/paths.ts src/core/workspacePath.ts src/core/git/heldTree.ts src/core/protectedPaths.ts test/unit/fsAtomic.test.ts test/unit/worktreeConversations.test.ts
```

Those four production helpers and two modified shared suites are exactly the
base Git blobs. Permissions, held-tree and checkpoint suites were never changed
by this correction. The previously added `workspacePath.test.ts` remains
unchanged: its eight tests isolate the base Windows refusal and canonical
POSIX separator behavior and pass with the restored source. That new suite is
the only retained shared-test addition relative to `81f070674`.

Deleted `src/core/pathIdentity.ts`, its approximation-specific suite, and
`test/unit/helpers/windowsFileIdentity.ps1`; no external reader needs them.
The manifest's native proof now opens both `plans/q3.md` and `Plans/Q3.MD`
through Node's real filesystem handles, checks nonzero inode and matching
BigInt device/inode identity, and closes both handles in `finally`. It passed
on this Windows rig. Obsolete normalization/alias-acceptance assertions were
replaced with strict-refusal assertions; shared tests were restored as directed.
No assertion was disabled and no timeout, threshold, ignore or rule was weakened.
Pre-existing shared-helper device-path gaps belong to the lead's separate audit.

#### Exact-base regressions and red drills

Isolated local clone `C:/lanes/_verify/FIXM100P2V3-base-proof-20261008`,
`CI=true`, repository-default deadlines, `--maxWorkers=3`, no timeout override.
The clone uses a junction to the worktree's installed dependencies; this is a
base regression receipt, not the fresh `npm ci` verification below. Production
files at each base were untouched; only regression tests were overlaid.

| Base / selected regression                                                                                                                                                                 | Result                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `d8960e6bf`; current manifest/capability suites, `refuses Windows identity collisions\|refuses the review future-dated`                                                                    | Exit 1; all 13 selected regressions fail (12 manifest collision rows, 1 future offer)                 |
| `32c55827f`; unchanged permissions regression plus the `851a23341` atomic-write/worktree intermediate-name assertions, `different intermediate\|distinct.*directory\|backslashes separate` | Exit 1; all 5 selected regressions fail (1 POSIX separator, 2 atomic-write binding, 2 worktree trust) |

The overlaid tests were restored afterward; the base-proof clone is clean.
Each drill saves the final committed source bytes, changes one guard, runs
the manifest suite, restores in `finally`, then checks byte-exact SHA-256
equality. The first four use selector `refuses reviewed spelling\|refuses
generated members\|refuses Windows identity collisions`; the grammar drill
selects the first two groups and the allowed-set drill selects `accepts
generated portable segments`. Unselected tests are pending under the
selector, not disabled.

| Drill           | Intentional break                                                                             | Exit / failures |
| --------------- | --------------------------------------------------------------------------------------------- | --------------- |
| V3-backslash    | Remove backslashes only from the character check, admitting their original spelling           | 1 / 9           |
| V3-trailing-dot | Remove the trailing-dot/space segment refusal                                                 | 1 / 23          |
| V3-reserved     | Remove the reserved-device-name refusal                                                       | 1 / 9           |
| V3-case         | Replace case-folded uniqueness with raw spelling                                              | 1 / 2           |
| V3-grammar      | Remove path grammar refinement; all 78 table rows plus the forbidden-class property test fail | 1 / 79          |
| V3-allowed-set  | Exclude `@` from the allowed character set; the generated acceptance property fails           | 1 / 1           |

All six restored SHA-256 values:
`f830f1a9c7a63827607456708069b6d7b01d2070f3607ab32d6561b5efde52f3`.
Logs: `C:/lanes/_ctx/FIXM100P2V3-drill-final-*.log` and
`FIXM100P2V3-base-round1.log` / `FIXM100P2V3-base-round2.log`.

#### Fresh-clone CI gates

Fresh clone with `git clone --no-hardlinks` at implementation
`7a1ae34606f5e88c1dd32bbb5f163b48f3b92a2c`:
`C:/lanes/_verify/FIXM100P2V3-ci-20261008`. Each shell sets `CI=true`.
`npm.cmd ci` exits **0**, with 898 packages installed; the unchanged install
audit still reports 12 issues (2 low, 10 high). No dependency was changed.

Every group ran with `npx.cmd vitest run <files> --maxWorkers=3`, at most
three files per invocation, repository-default deadlines and no `--testTimeout`.
Existing real-Git checkpoint tests retain their named `REAL_GIT_TIMEOUT_MS`
deadline and documented reason; no test was given a new timeout.

| Suites                                                                 | Round 1                                        | Round 2                                        | Round 3                                        | Exits     |
| ---------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | --------- |
| `deviceInputManifest`, `deviceCapability`, `workspacePath`             | 131 passed; 3.37 s                             | 131 passed; 2.97 s                             | 131 passed; 2.94 s                             | 0 / 0 / 0 |
| `permissions`, `heldTree`, `fsAtomic`                                  | 146 passed, 1 existing platform skip; 3.31 s   | 146 passed, 1 existing platform skip; 3.11 s   | 146 passed, 1 existing platform skip; 3.03 s   | 0 / 0 / 0 |
| `worktreeConversations`, `checkpointLocation`, `checkpointStoreBundle` | 28 passed; 17.59 s                             | 28 passed; 16.66 s                             | 28 passed; 16.54 s                             | 0 / 0 / 0 |
| `checkpointStore`, `checkpointStoreGuards`, `checkpointStorageGuards`  | 37 passed, 3 existing platform skips; 170.05 s | 37 passed, 3 existing platform skips; 165.05 s | 37 passed, 3 existing platform skips; 178.24 s | 0 / 0 / 0 |
| `checkpointStoreWindows`                                               | 33 passed; 122.63 s                            | 33 passed; 127.08 s                            | 33 passed; 156.02 s                            | 0 / 0 / 0 |

Total **375 passed per round, 1,125 passing executions across 13 suites**.
The four pre-existing Windows skips each round are POSIX permission/execute-bit
semantics and a colon filename Windows cannot create. No new test is skipped;
the native Windows case proof runs and passes each round. After the final
drills, the restored worktree's manifest/capability/workspace-path group also
passes **131/131**, exit **0**, default deadlines (3.25 s).

| Gate                                    | Exit / receipt                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                 | 0; host, webview, unit, e2e and integration projects                                                                                                                          |
| Changed-file ESLint, `--max-warnings=0` | 0; all eight surviving changed TypeScript files                                                                                                                               |
| Changed-file Prettier                   | 0; all eight TypeScript files; certification separately checked after formatting                                                                                              |
| Plain `npx.cmd knip`                    | 0; the same two pre-existing configuration hints                                                                                                                              |
| `npm.cmd run duplication`               | 0; jscpd, zero clones                                                                                                                                                         |
| `npm.cmd run check:l10n`                | 0; 14 tables, 169 manifest strings, 656 source files, zero problems                                                                                                           |
| `npm.cmd run check:reference`           | 0; 53 features, 46 commands, 60 settings, 26 slash entries, 122 CLI entries, 18 Devices entries; current                                                                      |
| `npm.cmd run check:host-api`            | 1; only the inherited generated `node:crypto` reader count, 55 → 56; restoring the helpers removed the prior `node:path` count difference                                     |
| `npm.cmd run build`                     | 0; size, split, host-global and notices checks all pass with unchanged caps; extension 441.6/600 KiB, Devices 80.6/100 KiB, webview startup 738.0/900 KiB, ACP 823.6/850 KiB  |
| `npm.cmd run quality`                   | 1 at `check:host-api`; global formatting, JS/CSS/PowerShell lint (zero analyzer findings), all five typechecks, badges, localization and reference passed before that refusal |

Normal implementation-commit hooks passed: changed-file ESLint/Prettier and
staged gitleaks, no leaks. The staged diff was re-read after the hook run
(empty after commit), then the committed source/test diff was read in full.
The source hash matches every final drill restore. No manual stash, merge,
rebase, push, live model call or real-device pairing occurred.

Lane W owns `docs/ide-compatibility/host-api.md`, README, CHANGELOG and the
joined-tree full gate in the PLAN ownership table and shared brief. Request:
regenerate the host API record at integration, carry the strict grammar and
shared restoration into the Unreleased changelog, then run the joined-tree
quality/coverage/integration/a11y/security gates. No gate was weakened to hide
the mismatch and no full-quality or audit success is claimed here. Existing
wiring and capability-contract requests in the original lane V section remain;
this redesign requests no additional contract change.

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
