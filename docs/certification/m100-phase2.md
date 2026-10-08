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
- **Windows device storage (P-I-WINDOWS-STORAGE): fixed by a native binding**,
  see "Windows device storage binding" below. It was not a fixture gap:
  production had no `DeviceStorageProtection` for any platform, so pairing
  could never open on Windows.
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

## Windows device storage binding (P-I-WINDOWS-STORAGE), 2026-10-08

**Cause.** On win32 `DeviceStore` (`deviceStore.ts` `checkFile`) and
`AttemptJournal` refuse without a `DeviceStorageProtection`, and no production
code supplied one for any platform. So Devices pairing could never open on
Windows. The 76 failing tests (94 once lane D's `deviceDiscoverySwitch` 17/17
and `deviceMdns` 1/15 joined) were correct signals, not fixture mistakes.

**Fix.** `src/host/devices/windowsStorageProtection.ts`, in the lazy Devices
bundle, implements the shared interface `src/core/devices/storageProtection.ts`
(the journal's `AttemptJournalProtection` is now the same type). A C# helper is
compiled once per source by `jobBuild.compileJob`, like the job helpers. It
runs as one long-lived child answering one request per line, and is unreferenced
while idle. It reads owner, DACL, attributes and link count from one handle
(`CreateFile` with backup semantics and open-reparse-point, `GetSecurityInfo`).
It installs a protected, owner-only DACL plus owner on paths the store has just
created exclusively (`SetSecurityInfo`, `:116`). It replaces files with
`MoveFileEx(REPLACE_EXISTING | WRITE_THROUGH)` (`:132`) and flushes folders with
`FlushFileBuffers` (`:137`). TypeScript makes every decision:

- `isPrivateReading` (`:229`) accepts only the shape `secureFresh` installs. It
  uses the token file's rule, now shared as `src/core/fs/ownerOnlyAcl.ts`. Any
  extra, inherited or deny ACE, another owner, an unprotected DACL, a reparse
  point or a second hard link refuses.
- `isSafeAncestorReading` (`:279`) runs over the whole chain in one request
  (`:314`). It refuses a folder another account owns, can rewrite (WRITE_DAC,
  WRITE_OWNER or GENERIC_ALL), can empty and refill (DELETE_CHILD plus add), or
  can rename away and replace (`:295`). A folder others may add to but not
  delete from passes. That is the case for `%TEMP%` on this host, where
  CodexSandboxUsers holds Modify. A fresh `mkdtemp` folder under it inherits
  that DELETE, so the guard refuses it until it is claimed.
- The helper protocol fails closed on a mismatched answer (`:330`), an answer
  missing past `DEVICE_STORAGE_REQUEST_MS` (`:318`, added after RVM100WS), an
  exit, a relative path or any error code.

`deviceStore.ts` and `attemptJournal.ts` now take an injected platform
(default `process.platform`). They claim every fresh folder, file, lock and
stage through `secureFresh` (store `:74`, `:98`, `:102`, `:222`; journal `:144`,
`:152`, `:157`, `:251`) and replace through the binding (store `:229`, journal
`:265`). The win32 no-binding refusal stays (store `:307`, journal `:510`). The
store now checks ancestors on Windows too (`:330`; before, it returned early)
and refuses hard-linked files on every OS (`:303`), as the journal already did.
`deviceStorageProtection()` (`deviceBundle.ts:42`) is the seam the bundle's
`dependencies` callback uses to hand one binding to both stores: Windows needs
the binding and a system root, and other platforms get none. The C# handle
declarations are shared with team hints through `src/host/windowsHandleInterop.ts`.

**Tests.** On Windows the store, pairing, integration, discovery and mDNS
suites run against the real binding (`deviceStorage()` and `privateDeviceRoot()`
in `test/unit/helpers/deviceFixtures.ts`). Elsewhere they run with POSIX rules.
Permission tampering goes through each OS's own model (`grantOthers`: chmod, or
`icacls` on Everyone), and so do reparse aliases (symlink, or junction) and the
owner-only evidence (mode bits, or .NET SDDL). One shared fake
(`fakeDeviceStorage`) records and refuses steps, and runs the Windows rules on
every OS through the injected platform: no binding refuses, and a refused
`assertPrivate`, `secureFresh`, `assertSafeAncestor`, `syncDirectory` or
`replace` refuses or latches the store. `windowsStorageProtection.test.ts` (32)
covers the decisions from recorded readings, plus the line protocol through a
Node stand-in, on every OS. The journal's win32 pass-through in
`deviceExecutionFixtures.ts` is retired (follow-up below).

| Run (default timeouts)                                                                 | Before                         | After                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Windows 11 host, `deviceStore`/`PairingAdapter`/`Integration`                          | 76 failed of 77                | 19/19, 51/51 pass; `deviceIntegration` see below                                                                                |
| Windows 11 host, all `device*` files                                                   | 94 failed, 618 passed, 6 files | 27 of 29 pass; `deviceStore`, `devicePairingAdapter`, binding rerun 102/102 at the final tree; `deviceIntegration` 4/11 (below) |
| Win11 VM `f03957dd`, 29 files (device*, Devices views, journal, binding, hints, token) | not run                        | **827 passed, 0 failed**                                                                                                        |
| Kubuntu `6503a6f4` and final tree, same 29 files                                       | green before                   | **833 passed, 0 failed**                                                                                                        |

This host ran at 78% CPU from other sessions. Here `deviceIntegration` passed
4 of 11: seven flows polled with `vi.waitFor`'s default 1 s while each durable
journal write takes about 100 ms. The follow-up below replaces those polls.

**Cost (this host, real binding).** Helper start about 0.5 to 0.7 s once per
process. `assertPrivate` 1.6 ms, whole-chain ancestor check 6.7 ms, folder flush
1.9 ms, claim plus write-through replace 19 ms. `readNow` was 25 ms with one
request per ancestor, and is **16 ms** with the one-request chain. `update` is
97 ms, mostly durability flushes.

**Red drills (each restored byte-exact, `git diff --quiet`).**

1. Removing the store's win32 no-binding refusal turns the binding test red (1
   failed, 18 passed).
2. Removing the owner-only DACL rule from `isPrivateReading` fails 8 tests,
   including the real-binding `icacls` tamper test on Windows.
3. Replacing through `rename` instead of the binding fails "replaces only
   through the binding".
4. Removing the rename-away-and-replace ancestor rule fails 3 tests.

**Gates (first commit).** All five typechecks exit 0. ESLint
`--max-warnings=0` and Prettier are clean on the 19 changed files. `knip`,
`jscpd` (0 clones) and `check:l10n` (0 problems) exit 0. `check:host-api` exits 0
after `--write`: four Node built-in counts each go up by 1, with no new VS Code
API. `npm run build` exited 1 with `dist/devices.js` at 107.1 KiB against its
100 KiB cap; the follow-up resolves it.

### Follow-up: native source, completion signals, journal binding (lead decisions)

- **Bundle.** The helper's C# now ships as `native/windows/MuseSparkDeviceStorage.cs`,
  as the job helpers' sources do (PLAN.md D6). It is whitelisted in
  `.vscodeignore`, listed in `package-acp.mjs` (which ships `devices.js`), and in
  the manifest and package fixtures. `startWindowsStorageProtection` reads it
  from the extension or package folder (`extensionPath`) and compiles it once per
  source digest through `compileJob`. Team hints keep their own C# string again,
  byte-identical to before, so `windowsHandleInterop.ts` is gone. `dist/devices.js`
  is now 102,364 bytes (100.0 KiB) against 102,400, so the build passes and the
  cap does not move. Only 36 bytes are left: by the D6 rule (measured +15%,
  rounded up to 25 KiB), the next re-measure gives 99.96 × 1.15 = 115.0, so
  125 KiB.
- **`deviceIntegration` waits.** The seven flows now await their own completion
  signals, with no `vi.waitFor` poll. `running()` awaits the moment the source's
  fake receives the `running` outcome. That comes after the receiver's durable
  admission, launch and running writes and its reply. The flood test awaits the
  fake's capacity-refusal count and its final delivery count. The three
  simulator Stops await the receiver's own `receive` promise for the cancel
  frame, which covers cancellation and the journal write that blocks on the
  corrupt state. The helper is `untilCalls`, test-only. Every assertion is
  unchanged. Win11 VM: 11/11 idle (load 1%, 10.5 s), and 11/11 with 12 busy
  loops on its 10 logical CPUs (load 100% before and after, all 12 loops alive at
  the end, 15.9 s). Kubuntu 11/11. This host could not start a jsdom worker under
  added load (vitest's 60 s worker start, before any test ran), so the
  deliberate-load proof is the VM's.
- **Journal binding.** `executionProtection` is now `deviceStorageBinding`:
  the real Windows binding on win32, started on first use, and the shared fake
  elsewhere, which round-trips through the real filesystem and POSIX folder
  fsync. The journal fixture's root is a `privateDeviceRoot`. Three journal tests
  changed:
  - Permission refusals use `grantOthers` on every OS; the win32 early return is
    gone, and a positive reopen control is added.
  - The forged private file is claimed with `secureFresh`, the Windows
    equivalent of mode 0600.
  - The flush-order and failed-replacement tests observe the binding's `replace`
    and `syncDirectory`.

  Every suite can use the binding. The POSIX-only uid substitution case in
  `attemptJournal.test.ts` keeps its existing platform gate: Windows has no
  uid, and the binding's other-owner refusal is covered by recorded readings.

- **Runs at the final tree (default timeouts).** Win11 VM idle, the same 29
  files: **827 passed, 0 failed** (152 s). Kubuntu, the 29 plus the manifest
  and two packaging files (32): **882 passed, 0 failed**.
- **Gates.** All five typechecks, `knip`, `jscpd` (0 clones), `npm run build`
  (every cap held, devices 100.0 KiB), `check:host-api` (0 problems) and
  `check:l10n` exit 0. ESLint `--max-warnings=0` and Prettier are clean on the
  changed files.

### RVM100WS (Codex) review fixes: two P2s, 2026-10-08

1. **A helper that stops answering.** Every request now has the named bound
   `DEVICE_STORAGE_REQUEST_MS` (`src/shared/constants.ts:3599`). That is
   `PROCESS_TABLE_TIMEOUT_MS`, the 20 s every Windows helper run already gets.
   On expiry (`windowsStorageProtection.ts:318`) the request fails closed, so
   the store refuses. The helper is killed (`:281`) and every other waiting
   request fails. `supervisedStorageHelper` (`:359`) starts a fresh helper for
   the next request, and `exited` reports when a process has ended. Tests
   (`windowsStorageProtection.test.ts`, "a helper that stops answering") use a
   stand-in that never answers `hang`, with a 200 ms bound for that helper only.
   Drill: removing the expiry's failure fails both tests at the 15 s test
   timeout (2 failed, 34 passed).
2. **The binding's disposer was dropped.** `deviceStorageProtection` hands it
   to the `DeviceDependencyScope` that `deviceMethods` now passes its
   `dependencies` callback (`deviceBundle.ts:41`, `:70`). A failed or revoked
   preparation ends what it started (`:107`, `:124`). `dispose()` ends the
   current one (`:140`). The test file and fixtures that start the shared
   native helper end it in `afterAll` (`endDeviceStorage`). Tests: two failed
   preparations and one success start three helpers; the two failures have
   exited before the retry, and `dispose()` ends the third. An owned binding
   (the real native helper on Windows, the stand-in elsewhere) has exited
   after disposal. Drill: dropping `scope.own` fails the lifecycle and seam
   tests (2 failed, 34 passed).

Both drills were restored from a backup, with SHA-256 identical before and
after. Neither new test can pass on `bdf5d1f19`: the deadline test hangs
without a bound, and the API the lifecycle tests use (`supervisedStorageHelper`,
the scope argument, `exited`) does not exist there.

**Runs (default timeouts).** Win11 VM, idle apart from review lanes, the same
29 files: **831 passed, 0 failed** (116 s). Afterwards no
`MuseSparkDeviceStorage-*` process was running. Kubuntu, those 29 plus the
manifest and two packaging files (32): **886 passed, 0 failed**.

**Cap.** The fixes bring `dist/devices.js` to 102,770 bytes (100.4 KiB), over
its 100 KiB cap. The lead's D6-rule approval applies:
`25 × ceil(100.4 × 1.15 / 25) = 125 KiB`. This is recorded in
`scripts/check-bundle-size.mjs` and the PLAN.md M100 cap note. No other cap
moves.

**Gates.** All five typechecks, `knip`, `jscpd` (0 clones), `npm run build`
(devices 100.4 of 125 KiB, every other cap unchanged), `check:host-api`
(0 problems) and `check:l10n` exit 0. ESLint `--max-warnings=0` and Prettier are
clean on the changed files.

### RVM100WSB (Codex) re-review fix: one P2, 2026-10-08

The lead confirmed the D6 cap of 125 KiB.

**In-flight preparations kept their helper.** `dispose()` drained only
completed preparations' disposers. So a binding registered by a preparation
still awaiting its dependencies or the service factory stayed alive, forever
if that preparation never settled. Now every registration joins the method
lifetime (`deviceBundle.ts:97`) the moment it is made (`:110`) and is released
at most once (`:98`). `dispose()` ends every live registration at once,
in-flight ones included (`:145`). A registration made after revocation ends
immediately (`:112`). The pending preparation then releases its own
registrations, which are already released, and settles as `revoked` (`:128`,
`:129`).

**Tests** (`windowsStorageProtection.test.ts`, "disposal while a preparation
is still pending"; on Windows the real native helper, elsewhere the stand-in):

- With dependencies held, disposal ends the helper. Its process has exited and
  `ping` is refused. Releasing the held dependencies settles as `revoked`, with
  exactly one binding disposal and no factory call.
- With the factory held, the same holds, and the late service is disposed once.
- A resource registered after revocation is disposed immediately, and only once.

**Regression and drill.** Against `2712a2192`'s `deviceBundle.ts`, both held
tests fail at the 15 s test timeout (2 failed, 37 passed). Drill: keeping
registrations out of the method lifetime fails 3 tests (2 failed in the new set,
1 in the earlier lifecycle test). It was restored from a backup, with SHA-256
identical before and after.

**Runs (default timeouts).** Win11 VM, the same 29 files: **834 passed, 0
failed** (100 s). Afterwards no `MuseSparkDeviceStorage-*` process was running.
Kubuntu, the 32 files: **889 passed, 0 failed**.

**Gates.** All five typechecks, `knip`, `jscpd` (0 clones), `npm run build`
(devices 100.4 of 125 KiB), `check:host-api` (0 problems) and `check:l10n` exit 0. ESLint `--max-warnings=0` and Prettier are clean on the changed files.
