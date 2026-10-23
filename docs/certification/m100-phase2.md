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

### Linux continuation — M100P2HL (2026-10-07): contract blocker

Worktree `/home/randy/lanes/M100P2HL`, branch `m100/p2-h-linux`, base
`f4f6f3008`, on linuxlt. Read the rig brief, phase-2 shared rules, original
H brief, PLAN ownership/acceptance, planning record, threat model, Windows
driver and host port. This continuation changes this certification section
only. No Linux implementation or support claim is made.

The continuation brief explicitly requires **resource limits from the attempt**
and says: **"if the platform port needs a contract change, stop and write a
lead request instead."** That condition is met:

- `DeviceDispatch.caps` carries the admitted process ceiling
  (`src/shared/devices.ts`, `deviceCapsSchema` and `dispatchCommon`).
- `DeviceWorkerDriver.launch` accepts only `DeviceWorkerCommand` and the
  recorded environment (`deviceWorkerHost.ts:77`). The command contains an
  executable, arguments, cwd and required tools; neither input contains caps.
- The host has the validated request, but its sole launch call drops the
  request/caps (`deviceWorkerHost.ts:289`). The reservation also exposes no
  execution limits. Two otherwise identical commands with different admitted
  process ceilings are indistinguishable to this port.
- The Windows driver uses the global `DEVICE_LIMITS.processes`
  (`deviceWorkerNative.ts:163`). Copying that into a Linux unit would bound it
  at the protocol maximum, not at the admitted attempt's limit. Inferring limits
  from argv/environment or an ambient mutable map would bypass the typed port.

#### Lead request — pass admitted limits through the platform port

Approve and land a local, typed launch input carrying the validated attempt's
identity and caps, for example a third `launch` argument of
`Pick<DeviceDispatch, 'identity' | 'caps'>`, supplied directly by the host's
existing launch call. Update both platform implementations and portable tests
together; prove simultaneous attempts receive their own caps. Keep shared
protocol ceilings unchanged and forbid peer-supplied unit properties.

The existing caps schema has no CPU or memory limit. If "resource limits"
also means `CPUQuota`/`MemoryMax`, specify their locally admitted source and
units in the same port decision rather than guessing new protocol fields.
The Linux implementation can then apply the approved process/task limit to
its transient unit and refuse an unenforceable limit before activation.

#### Plan and Linux acceptance mapping

1. Contract review complete; implementation stopped at the brief's explicit
   contract-change boundary. Lead request above is the next dependency.
2. After that contract lands, implement the exclusive Linux driver and smallest
   host selection change, with unchanged M96 environment/preflight/result rules.
3. Run real unit/descendant/inhibitor receipts, unavailable-manager injection,
   red drills with byte-exact restoration, and committed fresh-clone gates.

| Brief item              | Linux status and next proof                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Own context          | Blocked before implementation. Prove a unique collected transient user unit with admitted limits, never a transport child/plain-spawn fallback.                          |
| 2. Host pressure        | Not implemented. Reuse H's typed capacity/unsupported-host recovery text; prove no silent retry or cap change.                                                           |
| 3. Recorded environment | Existing portable host records canonical M96 environment and verifies PATH/hook binaries before launch. Linux activation and actual environment receipt remain untested. |
| 4. Structured result    | Existing portable host validates exit code and JSON stdout. Linux closed stdin, bounded stdout/stderr and banner isolation remain unimplemented.                         |
| 5. Sleep and power      | Not implemented. Prove sleep:idle inhibitor held through observed whole-cgroup exit and released; power read errors remain unknown.                                      |
| 6. Factory self-test    | Not implemented. Prove real launch/query/retirement and clean typed refusal without a user manager.                                                                      |

Battery policy is the lead's supplied decision: retain already admitted work
on battery; ask locally before admitting new heavy checks on battery or unknown
power. Linux supplies facts; W owns the admission prompt. No policy was invented
or implemented in this documentation-only continuation.

#### Native receipts, drills and verification

`systemctl --user show --property=Version --value` succeeded with **257.9-0ubuntu2.5**;
the real user manager is available. `systemd-run --version` reported **257**.
This is a rig availability observation, **not** a native worker receipt.
No unit, descendant or inhibitor was created. No Linux native test or red drill
ran because the required launch contract is blocked; Windows skips on this
Linux rig must not be counted as native passes.

No code, dependencies, lockfile, strings, tests, gate thresholds or shared
ownership regions changed. No push, merge, rebase, manual stash, paid/model call,
credential inspection or OS policy change.

#### Committed fresh-clone checks

Documentation/lead-request commit **f23dca109**, with hooks enabled. Re-read
the index after the hook and the resulting committed diff; the worktree was
clean. Hook formatting and staged gitleaks both exited **0**. The normal
lint-staged hook created and cleaned its temporary backup; no manual stash
command was run.

Fresh local clone `/tmp/m100p2hl-verify-iEA319` at **f23dca109**, Node
**24.21.0**, npm **11.19.0**. Every command below ran with `CI=true`.
`npm ci` exited **0** and reported the unchanged dependency tree's 11 audit
findings (2 low, 9 high); no audit fix or dependency change was made.

| Check                                                                                                                     | Exit | Result                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| Owning files: `npx vitest run test/unit/deviceWorkerHost.test.ts test/unit/deviceWorkerHostNative.test.ts --maxWorkers=3` | 0 ×3 | **22 passed, 6 Windows cases skipped** each run; **1.16 / 2.13 / 1.63 s**. Default timeouts, no override. |
| `npm run typecheck`                                                                                                       | 0    | All five projects: host, webview, unit, e2e, integration.                                                 |
| `npm run lint`                                                                                                            | 0    | Full JS and CSS lint pass. Repository PowerShell lint reports its Windows-only skip on Linux.             |
| `npx prettier --check docs/certification/m100-phase2.md`                                                                  | 0    | Only changed file formatted.                                                                              |
| Plain `npx knip`                                                                                                          | 0    | No dead-code failures; two existing non-fatal configuration hints.                                        |
| `npx jscpd`                                                                                                               | 0    | Zero clones.                                                                                              |
| `npm run check:reference`                                                                                                 | 0    | Current; 18 Devices entries.                                                                              |
| `npm run check:l10n`                                                                                                      | 0    | 14 UI and 14 usage tables; zero problems.                                                                 |
| `npm run check:host-api`                                                                                                  | 1    | The same inherited stale Node import counts already recorded above; W owns regeneration.                  |
| `npm run build`                                                                                                           | 0    | Production sizes, splits, host globals and notices pass; every cap unchanged.                             |

Build sizes: activation **462.8/600 KiB**, Devices **81.7/100 KiB**, Model API
**456.0/475 KiB**. These measure the unchanged Windows-base implementation,
not a Linux driver. Host, Windows driver and C# helper SHA-256 values match
H's final-source hashes above. The clone remained clean after checks.

The host API failure is precisely the earlier six row differences:
`child_process` **16→17**, `crypto` **93→94**, `fs` **44→45**,
`fs/promises` **74→76**, `path` **125→127**, `timers/promises` **15→16**.
This continuation does not edit W's generated inventory. Full joined quality,
coverage and installed-host qualification remain W's work under the shared
lane rules. No passing Linux native receipt or drill is claimed.

### Linux continuation — M100P2HL2 (2026-10-08): transient user services

Worktree `/home/randy/lanes/M100P2HL2`, branch `m100/p2-h-linux2`, contract
base `b0fe91da3`. Explicitly authorized `git merge --no-ff m100/p2-h-linux`
produced **9abfac61a**. Its documentation conflict was resolved by preserving
both the caps-contract addendum and the earlier Linux blocker/verification
record. The caps blocker is superseded by this implementation. Existing
`DeviceWorkerDriver`, attempt caps and receiver contracts are unchanged.

#### Linux acceptance mapping

| Brief item              | Implementation, tests and deliberate failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Own context          | `deviceWorkerLinux.ts` starts a uniquely named transient user service with `--collect`, `Type=exec`, `ExitType=cgroup` and whole-group Stop. Readiness compares its cgroup with `/proc/self/cgroup`; the activation pipe gates the command. Portable context refusal and real independent-service/detached-descendant tests pass. Context and native-retirement drills fail.                                                                                                                                                                        | Linux done.                                                                                      |
| 2. Host pressure        | A systemd `Result=resources` is typed `capacity`, with existing localized `capacityHelp`; no retry or cap adjustment. Portable pressure test verifies one launch and recovery text. The pressure drill fails. The Windows heap path stays unchanged.                                                                                                                                                                                                                                                                                                | Linux done; V/W consumes typed capacity.                                                         |
| 3. Recorded environment | Host keeps M96's canonical `workerEnvironment`, PATH resolution, hook verification and recording before launch. Linux refuses noncanonical input and executes with `env -i`; XDG runtime metadata exists only in the control environment. Portable missing/unverified hook tests and the real stdin/environment case pass. Hook-preflight and credential-environment drills fail.                                                                                                                                                                   | Linux done; W still owns durable recording and M96 binding.                                      |
| 4. Structured result    | Closed worker stdin; separately bounded stdout/stderr, streaming UTF-8 decode, raw exit-code-plus-stdout result and existing host zod/JSON validation. Banners never become results. Portable and real structured/flood cases pass. Stderr-result and output-cap drills fail.                                                                                                                                                                                                                                                                       | Linux done.                                                                                      |
| 5. Sleep and power      | A separate fixed two-task transient user unit holds real `systemd-inhibit --what=sleep:idle --mode=block`. It acquires before worker creation and releases after observed whole-worker-cgroup exit; helper loss stops the unit, releases inhibition and rejects retirement as uncertain. Native logind listing, overlapping attempts and both launcher-loss cases pass. Power remains battery/ac/unknown; a battery or unreadable-power observation does not cancel admitted work. Portable and native release drills and unknown-power drill fail. | Linux done. W owns the lead-approved admission question for new heavy checks on battery/unknown. |
| 6. Factory self-test    | Cached per-factory probe launches a real one-task service, queries containment/accounting/power, activates a known command, observes cgroup retirement and releases/removes both units. Unsupported managers and failed probes refuse, with no ordinary command spawn fallback. Real probe and injected missing-manager test pass. Self-test and unsupported-manager drills fail.                                                                                                                                                                   | Linux done.                                                                                      |

The worker's `TasksMax` is exactly `admittedProcessLimit(attempt)`. Readiness
checks both the manager property and kernel `pids.max` before activation.
Native cap **2** makes a third task fail with exit **2** and no success output;
cap **3** permits the same command, returning `admitted`. Linux's task ceiling
also counts threads, so it can be stricter than a process-only ceiling. The
inhibitor's fixed two-task control unit is separate, like Windows' external
helper; it never consumes or raises the worker's admitted ceiling. Worker/check
occupancy, token/spend and artifact caps keep their existing reservation,
controlled-boundary and result-validation owners. CPU/memory remain M107's
observations, not newly invented caps.

No timer, cancellation acknowledgement, direct-parent exit or helper loss
resolves retirement. The previously observed cgroup must report `populated 0`,
or its removal must be confirmed by a live manager reporting inactive/dead
and an empty ControlGroup. Helper loss rejects as uncertain even if Stop later
empties the unit; removal of that unresolved attempt is refused.

The host gains one selection point, `deviceWorkerDriverForPlatform(windows,
lazyLinuxLoader, platform)`. Its caller supplies the lazy import, avoiding a
runtime host/driver dependency cycle. No existing production selection point
was present on this base; W must bind this factory at its owned receiver entry.
No new command, setting, public protocol field, dependency, escape hatch,
translated key or policy change. README, CHANGELOG and feature-reference
integration remain W's ownership under the brief.

#### Native receipts and preflight discovery

Rig `linuxlt`, systemd user manager **257.9-0ubuntu2.5**, real cgroup v2 and
logind. All **eleven Linux native cases** run real `systemd-run`, `systemctl`,
`systemd-inhibit` and kernel cgroup reads. The start port only records unit
names/PIDs and delegates to real spawn; no manager, cgroup or inhibitor is
substituted in the final native suite. The seven Windows cases skipped here
are **unrun**, not Linux receipts. Model attempts/spend: **0 / $0**.

An initial SSH-context `systemd-inhibit` probe returned `Interactive
authentication required`. The same probe launched by the user manager succeeds,
including with TasksMax=2. The final driver therefore owns its inhibitor in a
separate transient user service, without changing polkit, registry, firewall,
OS policy or account configuration. Early partial unit tests used a substituted
inhibitor; those exploratory results are superseded and are not certification.

Native cases cover own context/closed stdin/canonical environment/JSON versus
stderr; detached-descendant completion after parent exit; kernel task cap 2;
whole-unit cancellation; real factory self-test plus visible logind hold/release;
injected missing manager; overlapping holds; worker-launcher loss;
inhibitor-launcher loss; real stdout overflow; and honest process counting for a multithreaded worker. Finally/afterAll Stop only
that fixture's recorded units and assert each is collected, inactive and has
no ControlGroup. Post-suite `systemctl --user list-units --all` found no
`muse-spark-device-*` unit. Every support probe was also collected.

#### Final guard-fire record

Seventeen final drills exited **1** with named test assertion failures at
repository deadlines. Each source buffer was restored byte-exact in finally
and its SHA-256 checked. Thirteen portable drills run their complete owning file;
four extra native drills select the named native case and retain afterAll cleanup.

| Drill                | Deliberate break                                | Assertion that fired                                                           |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| retirement           | Remove cgroup-empty wait after pipe exit        | Retirement settles while descendant occupancy is still reported.               |
| power-release        | Omit inhibitor release at successful retirement | Inhibitor process has not exited.                                              |
| unsupported-manager  | Omit runtime-directory refusal                  | Even the injected working manager starts helpers without a runtime directory.  |
| context              | Omit transport-cgroup comparison                | Transport-owned launch resolves instead of refusing.                           |
| pressure             | Omit resources refusal                          | Pressure launch resolves instead of returning typed capacity.                  |
| hook-preflight       | Verify zero required tools                      | Missing/unverified/empty-PATH hooks start; receiver refused-state check fails. |
| environment          | Record inherited environment                    | Credential/loader/agent variable names enter the environment record.           |
| stderr-result        | Append stderr to stdout                         | Banner-bearing stdout differs from structured JSON.                            |
| output-cap           | Omit stdout byte ceiling                        | No whole-unit Stop is requested for excess output.                             |
| self-test            | Return true after probe failure                 | Missing runtime and unavailable manager falsely pass the probe.                |
| unknown-power        | Turn read failure into AC                       | Unknown power on an owned attempt becomes AC.                                  |
| admitted-cap         | Use protocol maximum in TasksMax                | Unit arguments differ from the admitted attempt ceiling.                       |
| native-retirement    | Use ExitType=main and omit cgroup wait          | Detached descendant's completion marker is absent.                             |
| native-power-release | Omit release at successful retirement           | Real logind listing still contains the retired worker's inhibitor.             |
| native-admitted-cap  | Use protocol max and bypass readiness checks    | Real kernel pids.max is 128 instead of admitted 2.                             |

Two process-count drills additionally replace the distinct-PID sample with
`pids.current`. The portable duplicated-PID test and the native multithreaded
Node test both fail (exit 1), then restore the same final Linux SHA-256.

Final drill source SHA-256:

- Linux driver: `5295020cd62eb717979d01b3ad40b784a244fa6609f39d1782a5b766f45bf646`.
- Host: `3ae50b53e1b1819f83725a16ac54d9b356b5d4ce4843d39702e3a740c41107b4`.

Local restored run: **68 passed, 7 Windows skipped**, three owning files,
default deadlines, no timeout flag. Scoped lint and unit typecheck pass;
plain knip passes with its two existing hints; duplication reports zero clones.
Implementation commits and the required committed-code fresh-clone gate receipts
follow below. No threshold, assertion or ignore weakened.

#### Review follow-up: processes versus tasks

Implementation **4f4438df5** passed the first fresh-clone sweep (66 tests x3,
five typechecks, full lint, formatting, knip, duplication, reference,
localization, default cycles and capped production build). Host API was the
expected stale W-owned inventory (exit 1). Review then caught that Linux's
`pids.current` counts threads, while `activeProcesses` promises processes.
The follow-up samples distinct positive PIDs from `cgroup.procs` instead;
TasksMax and cgroup retirement are unchanged. A portable repeated-PID test
and a real Node process with multiple kernel tasks prove the distinction.
The fifteen prior drills were repeated on the follow-up source, and the two
new metric drills also fail and restore byte-exact. Final committed-source
fresh-clone qualification below supersedes the initial sweep.

#### Final committed-source CI qualification and lead requests

Implementation **4f4438df5**, process-count correction **4b4fe4dc3**. Final
fresh clone `/tmp/m100p2hl2-final-ci-9d7ft_nu` checked out **4b4fe4dc3**;
`CI=true npm ci` exited **0** in **5.25 s**. The install reports the same
**11 audit findings (2 low, 9 high)**; no dependency or audit fix was made.
Every check below ran with `CI=true`. The clone remained clean and its Linux
and host SHA-256 values match the final guard-fire hashes above. Logs are in
`/tmp/m100p2hl2-final-ci-9d7ft_nu.logs` on linuxlt.

| Check                                                                                                                                           | Exit   | Final result                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/deviceWorkerHost.test.ts test/unit/deviceWorkerHostNative.test.ts test/unit/deviceWorkerLinux.test.ts --maxWorkers=3` | 0 x3   | **68 passed, 7 Windows skipped** each run; suite durations **5.79 / 5.32 / 5.05 s**. Repository per-test deadlines; no timeout flag. All **11 Linux native cases** run each time. |
| `npm run typecheck:host` / `typecheck:webview` / `typecheck:unit` / `typecheck:e2e` / `typecheck:integration`                                   | 0 each | Five projects pass: **20.42 / 9.84 / 44.85 / 22.11 / 9.16 s**.                                                                                                                    |
| `npm run lint`                                                                                                                                  | 0      | Full lint, **250.78 s**; PowerShell analysis is Windows-only and unrun here.                                                                                                      |
| `npx prettier --check` on all six changed files                                                                                                 | 0      | **10.24 s**; PLAN, this certification, Linux driver, host selector, portable and native tests.                                                                                    |
| Plain `npx knip`                                                                                                                                | 0      | **3.35 s**; two existing nonfatal configuration hints.                                                                                                                            |
| `npx jscpd`                                                                                                                                     | 0      | **0.97 s**; zero clones.                                                                                                                                                          |
| `npm run check:reference`                                                                                                                       | 0      | **1.95 s**; 18 Devices entries current.                                                                                                                                           |
| `npm run check:l10n`                                                                                                                            | 0      | **2.00 s**; 14 UI and 14 usage tables, zero problems.                                                                                                                             |
| `npm run check:host-api`                                                                                                                        | 1      | **16.97 s**; W-owned generated Node inventory stale, exact deltas below.                                                                                                          |
| `npm run cycles`                                                                                                                                | 0      | **6.35 s**; default production-entry graph, 867 modules.                                                                                                                          |
| `npm run build`                                                                                                                                 | 0      | **11.08 s**; unchanged budgets, bundle splits, host globals and notices pass.                                                                                                     |

Production build: activation **462.8/600 KiB**, Devices **81.8/100 KiB**,
Model API **456.0/475 KiB**, browser startup **733.8/900 KiB**. The new Linux
factory is not bound by the existing production entry yet; these sizes do
not certify the final Linux bundle. W must measure again after binding it.
Post-final-suite native cleanup found no `muse-spark-device-*` units.

Precise acceptance pointers on the final source (tests and drills named in
the mapping/guard record above):

| Item                             | Code                                                                                                     | Owning regression                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Context and retirement        | `src/host/backend/deviceWorkerLinux.ts:195`, `:355`, `:407`, `:421`                                      | `test/unit/deviceWorkerLinux.test.ts:153`, `:217`; `test/unit/deviceWorkerHostNative.test.ts:398`         |
| 2. Host pressure                 | `src/host/backend/deviceWorkerLinux.ts:403`; existing host recovery mapping                              | `test/unit/deviceWorkerLinux.test.ts:226`                                                                 |
| 3. Environment and preflight     | `src/host/devices/deviceWorkerHost.ts:164`, `:310`; `src/host/backend/deviceWorkerLinux.ts:322`, `:373`  | `test/unit/deviceWorkerLinux.test.ts:117`, `:269`; `test/unit/deviceWorkerHostNative.test.ts:380`         |
| 4. Bounded structured channel    | `src/host/backend/deviceWorkerLinux.ts:71`, `:378`, `:390`                                               | `test/unit/deviceWorkerLinux.test.ts:280`, `:296`; `test/unit/deviceWorkerHostNative.test.ts:537`         |
| 5. Inhibition and power          | `src/host/backend/deviceWorkerLinux.ts:212`, `:262`, `:435`                                              | `test/unit/deviceWorkerLinux.test.ts:345`; `test/unit/deviceWorkerHostNative.test.ts:454`, `:487`         |
| 6. Factory self-test and refusal | `src/host/backend/deviceWorkerLinux.ts:158`, `:486`; selector `src/host/devices/deviceWorkerHost.ts:104` | `test/unit/deviceWorkerLinux.test.ts:237`, `:358`, `:372`; `test/unit/deviceWorkerHostNative.test.ts:480` |

Lead requests, within the shared lane ownership rules:

- **W: regenerate and review** `docs/ide-compatibility/host-api.md` with
  `npm run check:host-api -- --write`. Exact Node count deltas:
  `child_process` **16 -> 18**, `crypto` **93 -> 95**, `fs` **44 -> 45**,
  `fs/promises` **74 -> 77**, `path` **125 -> 128**, `string_decoder`
  **1 -> 2**, `timers/promises` **15 -> 17**. Totals remain 366 VS Code
  APIs, 43 vscode-importing files, 28 Node built-ins and 70 theme variables.
  This lane leaves that W-owned file untouched and does not claim a green
  joined `npm run quality`.
- **W/M96 owner: repair the inherited cycle before production binding.**
  Targeted `npx dpdm --no-warning --no-tree --exit-code circular:1 -T src/host/devices/deviceWorkerHost.ts`
  exits **1** for `src/core/team/refFence.ts -> src/core/team/workers/workerFence.ts -> src/core/team/workers/workerEnv.ts -> refFence.ts`.
  All three files are byte
  unchanged from contract base `b0fe91da3` (`git diff` empty). The new lazy
  selector avoids introducing a host/Linux-driver cycle. The default cycle
  gate passes because this port is not reached by its current entry.
- **W: bind** `deviceWorkerDriverForPlatform` at the receiver's lazy entry,
  install the caller's language table, bind M96's real command and durable
  environment record, and keep reservations/uncertain occupancy until
  observed retirement. **V/W: consume** typed pressure and power facts;
  W asks locally before new heavy checks on battery or unknown power.
- **W: finish joined documentation/reference/packaging, full quality and
  coverage, and installed-host qualification**, including Windows/macOS
  rigs. No Windows native pass, public supported command or shipped Linux
  support is asserted by this continuation. No contract change is needed.

### Linux review — M100P2HL3 (2026-10-08): RVM100P2HL

Base **625d95ecb**, branch `m100/p2-h-linux3`, rig `linuxlt`. Shared
`M100P2-common.md` and the rig brief govern verification; no model calls,
policy changes, merges or pushes. This subsection supersedes the two reviewed
lifetime/slot claims; other M100P2HL2 receipts remain historical.

**P2 readiness-slot leak: fixed.** Slot ownership has its own idempotent
release, independent of whether readiness supplied a cgroup. Failed inhibition,
spawn, readiness/query and retirement paths release it; successful jobs keep
it until removal. The two `200 resources/tasksMax refusals` regressions use
one factory each and assert every helper start, including launch 201 (402
starts per case). Fake pipes make the churn run inside the repository deadline.
On base 625d95ecb both fail at launch 129: resources has 256 starts instead
of 258, TasksMax returns capacity instead of preflight. Base run: exit 1,
2 failed, 22 deselected. Red drill sets initial slot ownership false: same two
failures, exit 1. Source restored byte-exact, SHA-256
`c6985867937e9a03e1ff80bc8e94fce0b980e55404fb1b96c7e446a23067e3eb`.
Restored owning-file run: 24 passed, default timeout, exit 0.

**P2 host-loss containment/recovery: fixed.** Worker transient units have
`BindsTo` and `After` on the pipe-owned inhibitor. When the host is SIGKILLed,
pipe EOF ends the inhibitor and systemd stops the whole worker cgroup without
any callback in the dead host. Unit names encode PID/kernel starttime, the
receiver incarnation, the already-journaled attempt ID, and a launch nonce.
Those journal keys identify the original attempt without a new shared schema.
First manager access discovers matching units, checks `/proc/<pid>/stat`
(including PID reuse and zombie/dead states), stops only dead-host units and
confirms inactive/empty manager state. Live hosts remain untouched; unreadable
ownership or unproved Stop blocks startup. A collected unit racing Stop is
accepted only after the same empty-state observation.

`DeviceWorkerHost.retain` performs this Linux query before restoring local
occupancy. The unchanged `DeviceReceiver.open` then journals original
nonterminal attempts as `uncertain`; cleanup never supplies a success result,
paid settlement, artifact or occupancy release. The durable regression uses
the real AttemptJournal/DeviceReceiver and asserts the old identity, caps and
retained liability survive. Shared contracts and lane R's files are untouched.

Native crash cases bundle the real driver once in beforeAll and launch a
separate owning Node process, real worker unit and real inhibitor. SIGKILL of
that process alone makes both units inactive/collected within the default
bounded poll. The second case seeds an unbound unit carrying the killed host's
identity, confirms it is still active, then a fresh driver removes it before
query returns. All thirteen Linux native cases run; seven Windows cases remain
unrun on Linux. Cleanup verifies every named unit is not-found/inactive with
an empty ControlGroup, including units left by deliberate base/drill failures.
The native manager/proc/cgroup observations are real, not invented model wire
frames; model calls/spend remain **0 / $0**.

Combined regression run on **625d95ecb**: exit **1**, **7 failed**, **42
nonselected** across two files. Two churn cases fail at launch 129 (256 helper
starts); both SIGKILL cases observe an active worker after host death; dead
owner/PID-reuse cleanup cases send no Stop; durable recovery fails because
cleanup did not precede retention. Restored local owning run: **78 passed,
7 Windows skipped**, three files, default deadlines. Receiver/recovery:
**86 passed**, two files, exit **0**.

Seven final guard drills, default deadlines, all exit **1**:

| Drill            | Deliberate break                | Failing regressions                                |
| ---------------- | ------------------------------- | -------------------------------------------------- |
| Slot release     | Initialize slot ownership false | 2 churn cases fail at launch 129.                  |
| Host bind        | Remove worker BindsTo           | 2 native SIGKILL cases still see an active worker. |
| Orphan discovery | Skip recovery                   | 3 dead/reused/durable recovery cases fail.         |
| Live owner       | Stop live owners too            | Live-host preservation fails.                      |
| Unreadable owner | Treat EACCES as absent          | Ownership refusal fails.                           |
| Empty proof      | Omit inactive/empty check       | New launch succeeds after unproved Stop.           |
| Journal order    | Omit Linux query before retain  | Durable cleanup-before-retain assertion fails.     |

Every mutation restored byte-exact in finally. Final SHA-256:

- Linux driver: `95021905a67aa843bb77062e3f62dd1bc477629319886d2a080f8713b087a900`.
- Host: `78bbee1ebcedb4118025748fd063922509023b9faa1a1896ae646856c909beeb`.

#### Final committed-clone qualification and handoff

Implementation commits: **603bd7089** (slots), **64c7ea757** (containment and
recovery). Hooks ran normally on explicit paths; post-hook committed diffs were
re-read and source hashes match the drilled bytes. No push, stash command or
extra merge. Final documentation-only commit preserves those tested bytes.

Fresh clone `$TMPDIR/verify`, committed HEAD **64c7ea757**, `npm ci`,
`CI=true`, Node **v24.21.0**, npm **11.19.0**, systemd **257.9-0ubuntu2.5**.
The literal base clone `$TMPDIR/base-regression` checked out **625d95ecb**,
installed with `npm ci`, and copied only the two new owning test files:
**7 failed / 43 nonselected**, exit **1**, confirming the initial source-swap
base result above. The extra nonselected case is the final unproved-Stop guard.
Both private clones were removed after qualification; original worktree stays
clean. All support and deliberate-failure units were stopped/collected; final
`systemctl --user list-units --all --output=json 'muse-spark-*.service'` is `[]`.

| Verification                                                                                                                                                | Exit   | Result                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                                                    | 0      | Fresh committed install.                                                                                          |
| Three runs: `npx vitest run test/unit/deviceWorkerHost.test.ts test/unit/deviceWorkerHostNative.test.ts test/unit/deviceWorkerLinux.test.ts --maxWorkers=3` | 0 each | 78 passed each; all 13 Linux native cases execute; 7 Windows cases unrun. Default deadlines, no timeout override. |
| `npx vitest run test/unit/deviceReceiver.test.ts test/unit/deviceRecovery.test.ts --maxWorkers=3`                                                           | 0      | 86 passed.                                                                                                        |
| Five `npm run typecheck:<host,webview,unit,e2e,integration>` projects                                                                                       | 0 each | All five compiler projects.                                                                                       |
| `npm run lint`                                                                                                                                              | 0      | Full JS/TS and CSS; unchanged Windows-only PowerShell skip. 224.81 s.                                             |
| `npx prettier --check` on all six changed files                                                                                                             | 0      | PLAN, certification, driver, host, two owning tests.                                                              |
| Plain `npx knip`                                                                                                                                            | 0      | Two existing configuration hints only.                                                                            |
| `npx jscpd`                                                                                                                                                 | 0      | Zero clones; thresholds unchanged.                                                                                |
| `npm run check:reference`                                                                                                                                   | 0      | Generated reference current.                                                                                      |
| `npm run check:l10n`                                                                                                                                        | 0      | 14 UI/14 usage tables; zero problems.                                                                             |
| `npm run check:host-api`                                                                                                                                    | 1      | Same inherited W-owned inventory deltas listed in M100P2HL2; no extra delta from this repair.                     |
| `npm run cycles`                                                                                                                                            | 0      | Unchanged production entry graph.                                                                                 |
| Host-port `npx dpdm --no-warning --no-tree --exit-code circular:1 -T src/host/devices/deviceWorkerHost.ts`                                                  | 1      | Existing refFence -> workerFence -> workerEnv -> refFence cycle; all three files byte unchanged from base.        |
| `npm run build`                                                                                                                                             | 0      | Production budgets, split, globals and notices pass with unchanged caps.                                          |

Build: activation **462.8/600 KiB**, Devices **81.8/100 KiB**, Model API
**456.0/475 KiB**. The driver remains outside production callers on this base,
so these budgets do not qualify W's future binding or shipped Linux support.
No full-quality/coverage or Windows/macOS/installed-host receipt is claimed.

| Reviewed finding                        | Fixed code                                                                              | Regression                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| P2 readiness slot leak                  | `src/host/backend/deviceWorkerLinux.ts:383`, `:385`, `:538`                             | `test/unit/deviceWorkerLinux.test.ts:180`: both 200-refusal cases reach launch 201.                                               |
| P2 kill-on-host-loss                    | `src/host/backend/deviceWorkerLinux.ts:432`                                             | `test/unit/deviceWorkerHostNative.test.ts:410`: both real parent-SIGKILL cases.                                                   |
| P2 restart recovery and journal honesty | `src/host/backend/deviceWorkerLinux.ts:174`; `src/host/devices/deviceWorkerHost.ts:197` | `test/unit/deviceWorkerHostNative.test.ts:410` (leftover=true); `test/unit/deviceWorkerLinux.test.ts:521` (real durable journal). |

**Lead next steps / blockers.** Both review findings are repaired, none deferred.
W must regenerate/review its host API inventory, arrange repair of the inherited
M96 cycle before binding this port, bind the Linux selector and durable environment
record, and complete README/CHANGELOG/reference integration, joined quality,
coverage and installed-host qualification. No shared-contract request is needed.
No dependency, translated text, setting, command, shared contract, escape hatch
or policy change was added. Detailed temporary logs remain under this lane's
private `$TMPDIR`; the certification above is the durable handoff.

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

##### HM9 default-deadline fixture follow-up

Initial committed implementation **`82a114c0e`** passed the installed hooks;
its staged/committed diff was reread, and its source hash matches the drill hash.
Its first fresh clone ran all gates with `CI=true` after fresh `npm ci` (exit 0).
The three owning exits were **0 / 0 / 1**, counts **502 / 502 / 501 passed**,
**0 / 0 / 1 failed**, and seven Windows skips each. All **31 native cases**
passed in every run. On run three, the ordinary 128-attempt fake case exceeded
5 s; its partner took 4812.7 ms. This is a failed qualification, not a passing
receipt. Receiver and every compiler/static/build gate passed there except the
known inherited W-owned host API inventory (exit 1).

The cause was the global child-process module spy wrapping every method of
thousands of synthetic ChildProcess instances. The fixture now obtains the
actual **unspawned** constructor through `vi.importActual` and assigns its safe
synthetic kill behavior directly. Every spawn still crosses the injected port;
none of these children is spawned or runs native kill. Real filesystem removal,
all 128 attempts, all process-boundary deliveries, native cases, assertions and
repository deadlines remain. No production byte changes. The two stress cases
then passed together in **4.17 s**, including transform/setup.

With this final fixture, the exact base and both red drills were repeated:
base **exit 1, 9 failed / 0 passed / 454 filtered, 3.96 s**;
remove-stop **exit 1, 7 failed / 0 passed / 456 filtered, 3.79 s**;
early-return **exit 1, 2 failed / 0 passed / 461 filtered, 1.57 s**.
Every run restored the same production SHA-256 above byte-exact in finally.
Changed-fixture ESLint/Prettier and plain jscpd pass, with zero clones.
Restored complete local H suite: **exit 0, 502 passed, 0 failed,
7 Windows-only skipped**, **66.78 s**, including all 31 native cases.
Final qualification restarts from a fresh clone of the committed fixture fix.

##### HM9 final committed-source fresh-clone qualification

Final source/test checkpoint **`05971149c`**, production fix **`82a114c0e`**.
Both commits used the repository's installed hooks exactly, with
`core.hooksPath=.husky/_`: ESLint/Prettier and staged gitleaks **exit 0**.
Their staged/committed diffs were reread after each hook. No hook substitution,
wrapper, copy, edit or manual stash. The source and both test-file SHA-256s in the
clone match the committed worktree:

- Driver: `9446c710de978490e940b882977f363c3395c7d33536c83074babaf6b38b29b5`.
- Owning test: `4185c648193739eca23f36ab9f8eb29c1e935191a3d398534d82a03cda65d13b`.
- Spawn fixture: `8d2427f163ddac6dcb97f23ae5778cdb312e8fe8f36bfa432dcd2797c5fa73c2`.

Fresh clone **`$TMPDIR/M100P2HM9-BrnrBL/final/checkout`**, Node **24.21.0**,
npm **11.19.0**, macOS **15.7.4**, UID **502 / Aqua gui/502**.
Fresh **`CI=true npm ci: exit 0`**, 902 packages installed; unchanged lockfile,
same 11 inherited audit findings (2 low, 9 high), no audit fix or dependency change.
Every verification command uses **CI=true**. Vitest uses repository deadlines,
`--maxWorkers=3`, and at most three complete files per invocation. No raised
or named timeout, new skip, weakened assertion, threshold or ignore.

| Final gate                                                 | Exit / receipt                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete H owning files, three consecutive runs            | **0 / 0 / 0**. Each **502 passed, 0 failed, 7 Windows-only skipped**; **67.85 / 68.09 / 66.82 s wall**. All **31 / 31 / 31 macOS-native cases** ran and passed.                                                                                                                              |
| Lifecycle/spawn completeness in all three JSON reports     | **105 lifecycle cases**, including the **90 original table cells**, **6 new waiting-helper cells**, and **2 new independent-sweep cells**; **312 spawn-table cells** and all native cases passed each time. All 200/128 stress cases and real identity/substitution assertions are retained. |
| Default-deadline 128-attempt stress cases                  | Pending probes **1754.3 / 1844.9 / 1992.3 ms**; ordinary attempts **1594.2 / 1910.2 / 1890.2 ms**. Every assertion passes under the unchanged 5000 ms deadline.                                                                                                                              |
| Complete deviceReceiver file                               | **0**, **49 passed, 0 failed, 0 skipped**, **11.90 s**.                                                                                                                                                                                                                                      |
| Host / webview / unit / e2e / integration compiler scripts | **0 / 0 / 0 / 0 / 0**, each script run separately.                                                                                                                                                                                                                                           |
| Changed-file ESLint, max-warnings=0                        | **0**, all three changed TS files.                                                                                                                                                                                                                                                           |
| Changed-file Prettier                                      | **0**, all five changed files; final receipt prose checked again after its hook.                                                                                                                                                                                                             |
| Plain knip                                                 | **0**, unchanged configuration.                                                                                                                                                                                                                                                              |
| Plain jscpd                                                | **0**, zero clones, unchanged zero threshold.                                                                                                                                                                                                                                                |
| check:reference                                            | **0**, reference coverage and freshness current.                                                                                                                                                                                                                                             |
| check:l10n                                                 | **0**, 14 UI tables, 14 usage tables, 197 manifest strings, 991 source files; zero problems.                                                                                                                                                                                                 |
| check:host-api                                             | **1**, the exact inherited six W-owned import-count differences below. No regeneration, suppression or gate change.                                                                                                                                                                          |
| Production build including size/split/host-globals/notices | **0**, every cap unchanged: activation **462.8/600 KiB**, Devices **82.0/100 KiB**, Model API **456.0/475 KiB**, Devices browser **34.0/50 KiB**, chat startup **733.8/900 KiB**, original deferred JS **31.9/50 KiB**.                                                                      |

**Final H status:** P2 and P3 are implemented in the reclaim table, tested on
both probe/ordinary attempts, proved red on the required base and deliberate
guard removal, and qualified above. Native assertion release is observed even
with failed bootout. All pending attempts are visited, failures are reported as
uncertain, and definitive failures retain their capacity. No H finding is deferred.

**Lead/W requests:** regenerate the inherited host API inventory:
child_process **16→18**, crypto **93→95**, fs **44→45**, fs/promises **74→77**,
path **125→128**, timers/promises **15→17**. Totals remain **366 VS Code APIs,
43 importing files, 28 Node built-ins, 70 theme variables**. Carry the Unreleased
CHANGELOG note above. Aggregate `npm run quality`, production lazy factory
binding/status wiring, and installed cross-platform qualification remain W's
explicit integration obligations under PLAN §7 and the shared ownership table.
This build measures existing lazy entries, not an installed Darwin-driver receipt.

Only five owned files changed: the Darwin driver, its owning test, the injected
spawn fixture, PLAN's H scope/gate regions, and this H/macOS subsection.
Both verification clones and private scratch receipts are removed after final
validation. No push, merge, rebase, manual stash, credential read, paid/live
model call or nonloopback listener.

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
   used a mounted-document bypass, invalidated by RVM100P2UB. FIXM100P2U2
   replaces it with the strict Devices ready handshake. Four-theme
   a11y/keyboard and pseudo-locale receipts
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

| Finding | Root repair and regression                                                                                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 P2    | `scripts/lib/webviewBundles.mjs:140`: QR inventory derives into the split gate, separate 25 KiB cap; `webviewBundles.test.mjs:42` proves complete closure and unchanged 50 KiB legacy/Devices caps with Windows paths.                                                            |
| 2 P2    | `test/harness/index.html:567`: initial states omit setup, replies alone supply correlated facts; `devicesPhase2Harness.test.mjs:34` tests all six actual fixture declarations and Chrome readiness. The mounted-document startup bypass is superseded by FIXM100P2U2 below.       |
| 3 P2    | `test/harness/index.html:6298` owner/step-up scenes click peer-bound Pause; `devicesPhase2Harness.test.mjs:57` asserts selectors and real owner/prompt readiness.                                                                                                                 |
| 4 P2    | `DeviceCard.tsx:49` receives the observation independently of action facts and matches its pair; combined `devicesPhase2Views.test.tsx:540` tests matching and foreign throttles, status and unknown time.                                                                        |
| 5 P2    | `DevicesView.tsx:277` mounts `OwnerGrants` for a bound refusal alone; `devicesPhase2Views.test.tsx:566` tests revoke then refusal-only `grant-expired` and `owner-mismatch`, with no stale revoke button.                                                                         |
| 6 P2    | `OwnerGrants.tsx:110` labels all six quota dimensions using existing translations and Intl formats; `devicesPhase2Views.test.tsx:602` checks two grants differing only in heavy checks/artifact bytes visibly differ.                                                             |
| 7 P2    | `QrFigure.tsx:53` clamps SVG width and auto height, preserves aspect ratio/viewBox/quiet zone; `devicesPhase2Views.test.tsx:635` plus `devicesPhase2Harness.test.mjs:133` checks the real 177-module matrix in a 320 px harness.                                                  |
| 8 P3    | `DevicesApp.tsx:43,212` skips QR rendering/import without an encoder; configured QR announces loading, keeps selectable text, reports failure with Retry, and owns a fresh lazy intent on the next Pair. `devicesQrLoading.test.tsx:44,65` and `DevicesApp.test.tsx:48` prove it. |

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

**Final fresh clone:** `/tmp/fixm100p2u-verify-20261007-2`, cloned at
`3415a2859e7ca222ef7b1d948acc28a537dfd2be`. `CI=true npm ci` exit **0**;
all following commands also use `CI=true`. Six owning files, three complete
passes: **43 + 113 = 156 passed each**, **468 checks total**, repository
case deadlines, at most three files/workers per invocation and no
`--testTimeout`. Shared production build/browser startup is in one named
`beforeAll` preparation hook; no case has a raised timeout. Extra
`harnessWaits`, `devicesPanel` and `devicePhase2Contracts`: **81 passed**.

| Gate on final committed-code clone                                                                                      | Exit / result                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (five projects)                                                                                     | 0                                                                                                                          |
| ESLint on every changed code/script file, `--max-warnings=0`                                                            | 0                                                                                                                          |
| Prettier on every changed text file                                                                                     | 0                                                                                                                          |
| Plain `npx knip`                                                                                                        | 0; two inherited configuration hints                                                                                       |
| `npm run duplication`                                                                                                   | 0; no clones                                                                                                               |
| `node scripts/check-l10n.mjs`                                                                                           | 0; 14 UI tables, 0 problems                                                                                                |
| `npm run check:reference`                                                                                               | 0; 18 Devices entries current                                                                                              |
| `npm run check:host-api`                                                                                                | 0; 0 problems                                                                                                              |
| `npm run build`                                                                                                         | 0; all existing caps unchanged, measured budgets above                                                                     |
| `npm run test:a11y -- devices-qr devices-discovery devices-owners devices-prompts-narrow devices-power devices-blocked` | 0; 24 pages, 0 violated/undecided rules, every page ready                                                                  |
| Same six-scene a11y command with `--lang=pseudo`                                                                        | 0; 24 pages, 0 violated/undecided rules, every page ready                                                                  |
| `node scripts/devices-keyboard.mjs`                                                                                     | 0; pairing/copy/comparison/caps/unlink at 320 px in four themes, missing asset honestly refused with Retry and no requests |

The first clone at `d7f54ecf8` passed the same owning/static/build/a11y
checks, but exposed the keyboard script's inherited stale Devices-specific
failure/Reload wording. The shared panel actually says `surfaceLoadFailed`
and offers `surfaceLoadRetry`. `3415a2859` reads both expectations from the
English table; positive failure/retry and no-pair/no-request assertions remain.
The final committed script passes in the second fresh clone.

**Accessibility red proof:** temporarily blank the native address label in
`DeviceCard.tsx`, rebuild production assets, and run real axe on discovery in
four themes: exit **1**, `label` violated on **4 elements**, all **4 pages**
returned results. Restore exact bytes, SHA-256
`e9b29cee4382a13605bc186ad39bc03cb4b80e76eaf86a6cbc7430e4c5c55517`;
final English/pseudo runs above are green. This supplements all nine finding
drills rather than replacing any assertion.

**Browser/visual proof:** all six scenes ready at **320 px** in four themes
and pseudo-locale (**30 scenes**, 0 page errors, every scroll width 320).
All 30 full-page screenshots reviewed, plus the large-QR screenshot. The
177-module test matrix, with four-module quiet zone, has `viewBox="0 0 185 185"` and renders **296 × 296 px** in its **296 px** container at a 320 px
viewport. Browser capture is stamped `d7f54ecf8`; runtime/UI source is unchanged
in `3415a2859` (only the keyboard check and docs changed). These public synthetic
fixtures certify UI and recovery, not physical pairing or an actual encoder.

Committed machine-readable receipts:
`m100-p2-u-verification.json`, `m100-p2-u-browser.json`,
`m100-p2-u-keyboard.json`, `m100-p2-u-drills.json`; screenshots in
`m100-p2-u-shots/`. All local commits kept hooks on (lint-staged's
`--no-stash` prevents its automatic backup stash; staged lint/format and
Gitleaks still run), and their diffs were re-read after hooks. Every drilled
source hash still matches after hooks. No merge, push, rebase, stash, dependency
change, model call or paid call. **All eight findings fixed; no lane blocker.**
Aggregate quality/coverage and real-host/encoder qualification remain lane W's
joined-tree obligations under the brief, recorded in PLAN §7.

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

### FIXM100P2U2 — review round 2 repair (2026-10-08, linuxlt)

Branch `m100/p2-u-fix2`, base `efebef2842f2e0b208e5b86782350fbead961210`.
Read both RVM100P2U and RVM100P2UB reports and M100P2-common. This brief
explicitly includes the host handshake; changes to the existing editor-neutral
DevicePanel and service are limited to readiness/cache/replay, with no listener,
pairing, grant or execution authorization. No dependencies or caps changed.

1. **P2 fixed:** `src/webview/models/sections/agents/DevicesApp.tsx:196`
   subscribes then posts strict `{ type: 'devicesReady' }`.
   Schema: `src/shared/devicesPanel.ts:120`; host cache/publication:
   `src/core/devices/devicePanel.ts:44`, `src/host/devices/deviceEntry.ts:170`;
   unconditional harness wait: `test/harness/index.html:6346`.
   `devicesReady.test.tsx` verifies one mount handshake and synchronous host
   delivery; the shared schema refuses chat/task/extra-field handshakes.
   DevicePanel holds observations until ready, captures an initial snapshot
   when necessary, and replays the latest complete cached observation on
   reload. Service validates readiness and denies it after disposal. Owning
   tests: `devicePanel.test.ts`, `deviceIntegration.test.ts`,
   `devicesPanel.test.ts`. Harness requires the real handshake for every
   surface again; all six real Chrome scene checks assert it is the first
   outgoing message before checking readiness and 320 px width.
2. **P3 fixed:** `test/harness/index.html:571` owners' Pause reply contains
   owners only; grant refusal first
   appears in the correlated revoke reply. `devicesPhase2Harness.test.mjs`
   executes the actual fixture and proves no pre-revoke refusal and typed
   `grant-revoked` afterwards. Suppressing the actual rendered refusal now
   makes the Chrome owners scene miss its readiness marker.

**Base run before product changes:** on `efebef284`, the new two mount tests
plus the strengthened actual harness suite: **9 failed / 9 passed (18)**,
exit **1** at repository defaults. P2: two mount failures and six Chrome
handshake failures. P3: one pre-revoke fixture failure. The base harness still
had its bypass, so the six browser failures specifically saw `deviceRequest`
instead of `devicesReady`; they did not depend on an artificial timeout.

**Red drills:** intentional guard breaks; each exits 1, restores exact bytes
and verifies the SHA-256 below. Selected drills leave unrelated cases skipped;
final owning runs execute every case without selection or timeout overrides.

| Drill           | Failure receipt                    | Restored source SHA-256                                            |
| --------------- | ---------------------------------- | ------------------------------------------------------------------ |
| P2-mount        | 2 failed (2), exit 1               | `ac6f67a48fc63d47ca35c5b7e8a9898c9b9906513c8a2d0143e5dc987a90f5b5` |
| P2-host         | 1 failed ; 9 skipped (10), exit 1  | `f33b1aad93f1c51c46cd0a36696470a444698f40af374597d50579638d18f799` |
| P3-fixture      | 1 failed ; 15 skipped (16), exit 1 | `a9520a6ae26381d4c924faef148c7c8973cc7be7f09f1955eeaa2494ac2a312f` |
| P3-render       | 1 failed ; 15 skipped (16), exit 1 | `7d06b97407b5f73e4f33a78e44c9c2f63c082c405f33bac3565281bd5d304495` |
| P2-host-service | 2 failed ; 20 skipped (22), exit 1 | `f33b1aad93f1c51c46cd0a36696470a444698f40af374597d50579638d18f799` |
| P2-replay       | 3 failed ; 19 skipped (22), exit 1 | `f33b1aad93f1c51c46cd0a36696470a444698f40af374597d50579638d18f799` |
| P2-schema       | 2 failed ; 26 skipped (28), exit 1 | `30c2606da72b0ac98e0c316ffe85c86bca39bd44cf2a99f8b08ccbd7f4def794` |

**Keyboard recorder correction:** readiness must not enter its action list.
The script now checks the exact ready envelope on each page, keeps every other
message in the action check, and asserts its existing no-grant-request receipt.
Both additional red drills exit **1**: replace the first handshake with Pair,
and inject a revokeGrant into the recorded messages. Both restore
`scripts/devices-keyboard.mjs` exactly to SHA-256
`2e8a71b8166fe0e5ec2163fe24fc204fbdf7d949818e346d54f8400f76f2fb63`.
Restored four-theme keyboard execution exits **0**, with all four
`noApprovalGrantRequests` values true and missing-asset refusal still empty.
Refreshed receipt: `docs/certification/m100-u-keyboard.json`, Chrome
153.0.8010.52, Linux Control+A, all four themes at 320 px.

**Final fresh-clone verification:** `/tmp/fixm100p2u2-final-20261008`,
cloned from committed `aecac0c8196dd4dff55c768462efa1c5584f1c90`.
`CI=true npm ci` exits **0**. Every command below uses `CI=true`; each
Vitest invocation has at most three files and `--maxWorkers=3`, with the
repository's case deadlines and no timeout override, selection or case skip.
The existing named 60 s beforeAll is build/browser preparation, not a case.

| Owning batch (all paths under `test/unit/`)                                     | Pass 1 | Pass 2 | Pass 3 |
| ------------------------------------------------------------------------------- | ------ | ------ | ------ |
| `DevicesApp.test.tsx`, `DevicesView.test.tsx`, `devicesPhase2Views.test.tsx`    | 125    | 125    | 125    |
| `devicesQrLoading.test.tsx`, `webviewBundles.test.mjs`, `devicesPanel.test.ts`  | 32     | 32     | 32     |
| `devicesReady.test.tsx`, `devicePanel.test.ts`, `devicesPhase2Harness.test.mjs` | 28     | 28     | 28     |
| `deviceIntegration.test.ts`, `deviceMessageHandler.test.ts`                     | 23     | 23     | 23     |
| Total                                                                           | 208    | 208    | 208    |

**624 passed**, zero failed/skipped; all twelve invocations exit **0**.
The six scene-readiness cases run in headless Chrome each time: the first
outgoing message is exactly `devicesReady`, the real marker appears, one
card mounts and document scrollWidth is at most 320. The large-QR check
still measures the real 177-module square within its container.

| Gate                                 | Exit and receipt                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Five typecheck projects              | `typecheck:host`, `:webview`, `:unit`, `:e2e`, `:integration`: each **0**                                         |
| Changed-file ESLint / Prettier       | Each **0**; includes the keyboard script and refreshed JSON                                                       |
| Plain `npx knip`                     | **0**, two inherited configuration hints, no unused code                                                          |
| `npx jscpd`                          | **0**, zero clones                                                                                                |
| `check:l10n`                         | **0**, fourteen UI/usage tables, zero problems                                                                    |
| `check:reference`                    | **0**, 61 features, Devices' eighteen reference entries current                                                   |
| `check:host-api`                     | **0**, 366 VS Code APIs, zero problems                                                                            |
| Production `npm run build`           | **0**, every size/split/host-globals/notices gate passes                                                          |
| `test:a11y` on all six scenes        | **0**, English: 24 pages, four themes, zero violations/undecided/missing results                                  |
| Same six scenes with `--lang=pseudo` | **0**, 24 pages, four themes, zero violations/undecided/missing results                                           |
| `node scripts/devices-keyboard.mjs`  | **0**, four themes at 320 px, strict readiness, all no-grant flags true, missing-asset refusal with zero requests |

Caps unchanged: startup **733.9/900 KiB**, original deferred aggregate
**31.9/50 KiB**, Devices **40.2/50 KiB**, QR **0.9/25 KiB**, host Devices
**82.7/100 KiB**. Axe reports eight English and sixteen pseudo elements
whose contrast it cannot see (obscured or off-screen), unchanged measurement
limits; no returned rule is undecided. All nine restored hashes still match
following commit hooks. The refreshed keyboard JSON is byte-identical to the
final clone's output. Final source and generated receipts leave both trees clean.

**Next / blockers:** no lane U blocker. Lead fetches `m100/p2-u-fix2` and
integrates these local commits. Lane W retains real host facts, approved encoder
installation/measurement and installed four-device/full joined-quality
qualification. No push, rebase, merge, paid/live model call, real second-device
pairing or listener beyond loopback. Model attempts and spend: **0**.

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

### RVM100WSC (Codex) re-review: one P3, 2026-10-08

The late-registration test asserted its immediate disposal inside the
`dependencies` callback. A failed expect there only rejected the preparation,
which settles as `revoked`, so the test could not fail. The callback now just
records how many disposals had happened when `own` returned, and the test body
asserts that count is 1 (`windowsStorageProtection.test.ts:429`). Drill:
removing the guard at `deviceBundle.ts:112` now fails that test (1 failed, 38
passed). It was restored from a backup, with SHA-256 identical before and after.
No other test added on this branch asserts inside a callback whose error is
discarded.

## Lane E — receiver test teardown race (FIXE3RACE, 2026-10-08)

Kubuntu rig, `/home/randy/lanes/FIXE3RACE`, branch `m100/p2-e3race`,
base `2a0636760`. Test-only repair; no production changes, model attempts
**0**, inference spend **0**. Shared rules:
`/home/randy/lanes/_ctx/codex/M100P2-common.md`, with the direct-rig,
default-timeout, eight-busy-loop and 40-minute scope in `FIXE3RACE.rig.md`.

### Cause, repair and audit of both owning files

The held cancellation confirmation resolves before its asynchronous
`record-uncertain` effect enters the receiver's ordered queue. An immediate
reconciliation can therefore finish with `running`, while the later durable
write overlaps fixture directory removal (`ENOTEMPTY` on macmini).

`test/unit/helpers/deviceExecutionFixtures.ts:59` exposes a narrow
`observeOutcome` promise. It arms before the triggering event, delegates to
the real journal `advance`, and resolves only after that write completes for
the requested attempt and state. This observes the next completion even when
an earlier write already stored `uncertain`; it adds no polling or deadline.
The spy is installed only in tests that request the observer.

The reset test at `test/unit/deviceReceiver.test.ts:226` awaits that durable
completion at line 243 before reconciliation and verifies the returned
`uncertain` state and retained occupancy. All original assertions about
immediate Stop, held persistence/confirmation, framing failure and no release
remain. The same completion barrier covers saturated Stop, both corrupt-frame
timings (both live attempts), pair-scoped reset with a queued retry, channel
Stop during held start confirmation, and Stop beside another held approval.
Cancel-before-reservation/coalesced retry cases await the journal's existing
`cancellations()` operation so their asynchronous tombstone writes finish.

Recovery now waits for the new durable write after retirement-proof rejection,
including the case whose prior cancellation already persisted `uncertain`.
A rejected local cancellation also drains its concurrent tombstone write.
Every remaining resolve/reject/disconnect case in both files was inspected:
awaited cancellation already joins its effects; terminal-release waits occur
after durable retirement; late confirmation/pause replies after retirement
cannot write; ordinary disconnect pause does not write the journal; and
late-reservation confirmation while still reserved does not write uncertainty.
Their original assertions remain unchanged.

### Baseline, red drill and restored-tree gates

Each full run uses `npx vitest run test/unit/deviceReceiver.test.ts
test/unit/deviceRecovery.test.ts --maxWorkers=3`, repository default timeouts
and no retries. Node **24.18.0**, npm **12.0.1**. Load is exactly eight owned
Python `while True: pass` processes, stopped after the phase.

- Unmodified `2a0636760`: **30 idle runs, 0 failed; 30 loaded runs, 0 failed**,
  86 tests per run. The macmini filesystem flake did not reproduce on this rig.
- Fixed commit `bb5f7f508`: **30 idle runs, 0 failed; 30 loaded runs, 0 failed**,
  86 tests per run. Both full files run every time: **120 complete runs / 10,320
  passing test executions** across the before/after phases. All logs were checked
  for the full 86-test pass count, not just their process exit code.
- Red drill: remove only the reset test's `await uncertain`; three loaded
  targeted runs each exit **1**, **1 failed / 48 skipped**. Every reconciliation
  returns `running` instead of `uncertain`, directly proving the same ordering
  race before relying on filesystem cleanup timing. No `ENOTEMPTY` occurred
  in these drill runs. Restore the entire mutated file byte-exact: SHA-256
  `6219d9dafccb2b282e4f197eea5033b23cf906576fd231763a3218b39234119e`
  both before and after.
- Restored full owning run: **86 passed**, exit **0**.
- `npm run typecheck:unit`: **0**. Changed-file ESLint with
  `--max-warnings=0`: **0**. Changed-file Prettier: **0**.
  `npm run duplication` (`jscpd`): **0**, **0 clones**, thresholds unchanged.

Receipts and the loop/drill drivers are under
`$TMPDIR/e3race-proof` (`/var/tmp/l-FIXE3RACE/e3race-proof`), outside the repo.
Aggregate `npm run quality`, joined CHANGELOG/help and installed-host/four-device
qualification remain with the lead/lane W under the phase-2 ownership table;
this lane changes no runtime feature, command, setting, dependency or gate.

### Final committed-code fresh-clone receipt

Verified `bb5f7f508b468cc2fa28d5dc02c5622699be4848`, cloned directly from
the worktree into `$TMPDIR/e3race-proof/verify`. `CI=true npm ci` exited
**0**. Three consecutive complete owning runs at default timeouts and
`--maxWorkers=3` each passed **86 tests**. Shared-fixture neighbours
`attemptJournal.test.ts`, `actionGrants.test.ts` and `deviceReconnect.test.ts`
passed **126 tests** in one three-file batch at the same defaults.

| Fresh-clone gate                                           | Exit | Result                                                                                       |
| ---------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                        | 0    | All five projects, including `typecheck:unit`                                                |
| `npm run lint`                                             | 0    | Full ESLint and CSS lint, zero warnings; PowerShell analyzer reports its Linux platform skip |
| Prettier on the three changed tests/helper and this record | 0    | Clean                                                                                        |
| Plain `npx knip`                                           | 0    | Only inherited `vendor/**` and `axe-core` configuration hints                                |
| `npm run duplication`                                      | 0    | Zero clones; no threshold or ignore changes                                                  |
| `npm run check:reference`                                  | 0    | Current, 18 Devices entries                                                                  |
| `node scripts/check-l10n.mjs`                              | 0    | 14 UI tables, 14 usage tables, zero problems                                                 |
| `npm run check:host-api`                                   | 0    | Zero problems                                                                                |
| `npm run build`                                            | 0    | All production size, split, host-global and notices checks pass; caps unchanged              |
| `git status --short` after all checks                      | 0    | Empty; clone clean                                                                           |

Final source SHA-256 (worktree and clone match):

- `test/unit/deviceReceiver.test.ts`:
  `6219d9dafccb2b282e4f197eea5033b23cf906576fd231763a3218b39234119e`.
- `test/unit/deviceRecovery.test.ts`:
  `2f78ebe398cc4f8f36023ac792e27c1287e6cfef772a5e50d188c19b652328f0`.
- `test/unit/helpers/deviceExecutionFixtures.ts`:
  `fa5bca785336cd1ea8b0f16e5e911abb97b7fd10fd7c8225eeed78c6adbbb8b4`.

The initial fix commit passed ESLint/Prettier and Gitleaks hooks; its staged
and committed diff was reread and source hashes checked after the hooks.
The final follow-up changes only this certification record. The temporary
clone is removed after verification; the receipts remain under
`$TMPDIR/e3race-proof`. No push, merge, paid call or live model
call was made. Work finished within the brief's 40-minute time box.

## Lead integration: final phase 2 join (M100JOIN, 2026-10-08)

Kubuntu rig, worktree `/home/randy/lanes/M100JOIN`, branch
`m100/p2-int-lead2` from `2a0636760` (phase 2 with lanes 0, C, D, A, R).
Seven `git merge --no-ff` steps in brief order, tips fetched from
`~/gates/muse.git` as `refs/heads/m100join/*`. Model attempts **0**,
inference spend **0**; no push, no rebase. Hooks (lint-staged, gitleaks)
ran on every merge commit; each staged diff was re-read after the hooks.

### Merges

| #   | Merge commit | Lane tip                                                  | Conflicts and resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `631884576`  | V `90e65e308` verified inputs                             | `m100-phase2.md` only: both sides appended sections; kept both (integrated sections, then lane V). New `capability.ts`/`inputManifest.ts` plus 3 test files merged clean.                                                                                                                                                                                                                                                                                                                                        |
| 2   | `1e773be3d`  | H caps `b0fe91da3` Windows driver + attempt-caps contract | `m100-phase2.md` only (kept both). `deviceReceiver.ts` auto-merged lane A's `bindDeviceReceiverActionGrants`/`finishAdmission` with H's `refused`-retirement rework; both symbols verified present.                                                                                                                                                                                                                                                                                                              |
| 3   | `b0322726d`  | H linux `21147c4cf`                                       | None: clean ort merge (built on h-caps).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | `ff30ed5fa`  | H darwin `8aa69e1cb`                                      | `m100-phase2.md` (kept both: Linux continuations, then macOS). `deviceWorkerHost.ts`: Linux's `deviceWorkerDriverForPlatform` vs macOS's `selectDeviceWorkerDriver` — kept BOTH functions, so every assertion on both sides passes (`selectDeviceWorkerDriver('linux')` still throws per the Darwin test; `deviceWorkerDriverForPlatform(..., 'linux')` still selects per the Linux test). W must pick one selector at wiring time. Darwin's `failure: capacity` outcome/tombstone schema additions auto-merged. |
| 5   | `8cee7c3f1`  | U `a0a5466ce` Devices UI                                  | `CHANGELOG.md` (kept H-darwin Fixed lines, then U lines), `PLAN.md` phase-2 status + §7 (kept HM lifecycle notes, then U repair notes), `m100-phase2.md` (kept both). All view/panel code auto-merged.                                                                                                                                                                                                                                                                                                           |
| 6   | `03e5f4416`  | win-storage `8218ab946`                                   | `m100-phase2.md` (kept both). `host-api.md`: HEAD (child_process 16/crypto 95) vs lane (17/93) — resolved by regenerating with `node scripts/check-host-api.mjs --write` (ground truth wins; see below). `deviceIntegration.test.ts` `host()` helper: kept BOTH behaviours — win-storage's `deviceStorage()` + `privateDeviceRoot` + protected `DeviceStore.create` AND U's `isReady` handshake flag.                                                                                                            |
| 7   | `a43169c3c`  | e3race `fab90e81c` test-only race fix                     | `m100-phase2.md` only (kept both). Fixture/test changes auto-merged.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Regenerated files (reviewed, never hand-edited)

- `docs/ide-compatibility/host-api.md` via `node scripts/check-host-api.mjs
--write`: exit 0, 0 problems. This resolves the six W-owned mismatches the
  macOS run recorded (H-linux list: `child_process` 16 -> 18, `crypto`
  93 -> 95, `fs` 44 -> 45, `fs/promises` 74 -> 77, `path` 125 -> 128,
  `string_decoder` 1 -> 2, `timers/promises` 15 -> 17). Final joined counts:
  `child_process` **20**, `crypto` **99**, `fs` **45**, `fs/promises` **79**,
  `net` **16** (new row), `path` **131**, `string_decoder` **2**,
  `timers/promises` **18**. Totals unchanged: 366 VS Code APIs, 43
  vscode-importing files, 28 Node built-ins, 70 theme variables.
- Reference: `npm run check:reference` current (61 features, Devices
  reference 18 entries) — no new feature/setting/command, no regeneration.
- `CHANGELOG.md`: hand-added Unreleased lines for lanes V, H and
  win-storage, all marked unshipped Devices work with no user-visible claim
  (U and H-darwin brought their own lines). e3race is test-only and gets no
  product line. Lanes C/A/R lines remain the earlier lead scope.

### Test counts per merge (default repo timeouts, `--maxWorkers=3`)

This container's `/` ancestry is uid-nobody (65534), so every test that opens
a real `AttemptJournal`/`DeviceStore` with the production ownership check
fails with `DeviceJournalError: storage` — including phase-1 suites on the
unmerged base (`attemptJournal.test.ts` 29/29 fail on `2a0636760`). No source
change can fix that here; weakening the check is out of scope. Every
journal-dependent suite below was therefore verified by failure-set parity:
same tests run on the unmerged lane tip in a sister worktree, and the merged
tree fails exactly the same set (names compared, only duration suffixes
differ). Suites that do not touch a real journal run green directly.

| Merge       | Suites run                                                                                                                                                         | Merged result                                                                                                                                                  | Unmerged-tip parity                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| V           | deviceCapability, deviceInputManifest, workspacePath                                                                                                               | 130 passed, 1 skipped                                                                                                                                          | n/a (clean merge, green)                                                                           |
| H caps      | deviceWorkerHost, deviceWorkerHostNative, actionGrants                                                                                                             | host 31 passed + 4 env-fail; native 7 win32-skipped; grants 80 env-fail                                                                                        | host tip 4 failed / 31 passed, identical                                                           |
| H linux     | deviceWorkerLinux                                                                                                                                                  | 24 passed + 6 env-fail (all `DeviceJournalError` in receiver-integration cases; all 11 native Linux cases among the 24 passes)                                 | tip 6 failed / 24 passed, identical                                                                |
| H darwin    | deviceWorkerDarwin, deviceWorkerHost, deviceWorkerLinux                                                                                                            | darwin-only 432 passed, 31 skipped, 0 failed; combined 489 passed + 12 env-fail + 31 skipped                                                                   | tip host+linux 6 failed / 33 passed, identical                                                     |
| U           | devicesPhase2Views, devicesQrLoading, devicesReady, devicePanel, devicesPanel, DevicesApp, devicesPhase2Harness, webviewBundles, deviceIntegration                 | views/panels 78 passed; harness file-level fail (Chrome cannot launch in this sandbox: `socketpair: Operation not permitted`); integration 12 env-fail         | tip harness fails identically; tip integration 12 failed, identical                                |
| win-storage | windowsStorageProtection, deviceStore, deviceDiscoverySwitch, deviceMdns, devicePairingAdapter, manifest, runtimeChatGptPackage, usagePackaging, deviceIntegration | storage+store 58 passed; D suites 83 passed; packaging 47 passed + 2 env-fail (`npm pack` EROFS: read-only `~/.npm` cache in sandbox); integration 12 env-fail | ws tip integration 11 failed; the +1 on the join is U's readiness test (env-fail on the U tip too) |
| e3race      | deviceReceiver, deviceRecovery                                                                                                                                     | 86 env-fail                                                                                                                                                    | tip 86 failed; failure-name sets identical                                                         |

### Final gates on the joined tree (this worktree)

| Gate                                                 | Exit | Result                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-host-api.mjs`                    | 0    | 0 problems (regenerated)                                                                                                                                                                                                                       |
| `npm run check:reference`                            | 0    | current, Devices 18 entries                                                                                                                                                                                                                    |
| `node scripts/check-l10n.mjs`                        | 0    | 14 UI + 14 usage tables, 197 manifest strings, 1012 files, 0 problems                                                                                                                                                                          |
| `npm run typecheck` (five projects)                  | 0    | host, webview, unit, e2e, integration clean                                                                                                                                                                                                    |
| eslint `--max-warnings=0` (changed TS/TSX + scripts) | 0    | clean                                                                                                                                                                                                                                          |
| `npm run format:check`                               | 0    | clean (one `.vitest/` run-cache file removed first)                                                                                                                                                                                            |
| plain `npx knip`                                     | 0    | two pre-existing configuration hints only                                                                                                                                                                                                      |
| `npm run duplication`                                | 0    | 0 clones                                                                                                                                                                                                                                       |
| `npm run cycles`                                     | 0    | no cycles                                                                                                                                                                                                                                      |
| `npm run build`                                      | 0    | all caps pass; `dist/devices.js` **102.4 KiB / 125 KiB** (win-storage moved the cap under D6, no cap raised), webview Devices 40.4/50, Devices QR 0.9/25, surface English 24.1/25, deferred 31.9/50, activation 462.8/600, Model API 456.0/475 |
| `npm run quality` (once)                             | 1    | stops at `test:unit`; every earlier gate green (tail below)                                                                                                                                                                                    |

Fresh clone (`/var/tmp/l-M100JOIN/join-clone`, `npm ci`, `CI=true`) repeats:
typecheck 0, host-api 0 problems, reference current, l10n 0 problems,
device sample (capability, inputManifest, workerDarwin) 554 passed /
32 skipped / 0 failed, build 0 (devices.js 102.4/125 KiB), knip 0 (same two
hints), duplication/cycles clean, prettier + changed-file eslint 0.

`npm run quality` tail: `test:unit` 43 files failed / 819 passed,
446 tests failed / 17759 passed / 162 skipped, 20 unhandled errors, then
`ERROR: "test:unit" exited with 1` / `ERROR: "quality:gates" exited with 1`
(aggregate exit **1**; build, audit, a11y, secrets and sast never ran).
Every failing file was re-run on the unmerged base `2a0636760` (and every
device file on its unmerged lane tip): all fail identically there — this
container's `/` ancestry is uid-nobody (journal ownership checks), and its
sandbox blocks interface enumeration, Chrome launch, the systemd user bus
and npm-cache writes. No join regression: 17759 passing tests include the
whole non-device tree, and all device suites that can run here pass
(432 darwin, 58 storage/store, 83 lane-D, 78 U views/panels, 130 V, 24
native Linux driver cases).

## Lane W — wiring, qualification, docs (M100W, 2026-10-08)

Kubuntu rig, worktree `/home/randy/lanes/M100W`, branch `m100/p2-w` from
`m100/p2-int-lead2` (`a4007f56c`). Model attempts **0**, inference spend
**0**; no push, no rebase, no merge. Commits with hooks on (lint-staged,
gitleaks); each staged diff re-read after the hook run.

### Delivered

1. **One driver selector.** Kept `selectDeviceWorkerDriver`, now async with
   lazy `darwin`/`win32`/`linux` factories; deleted
   `deviceWorkerDriverForPlatform`. Rationale: the Linux continuation
   requires a lazy loader (it avoids the host/driver cycle), and the
   sync macOS function cannot select Linux lazily. Every caller and test
   moved onto it with every assertion kept (async-adapted), plus an
   unsupported-platform refusal and a laziness proof per factory.
   Commit `b95f8beb5`.
2. **The QR encoder.** Installed `qrcode-generator@2.0.4` pinned exact into
   `dependencies` (MIT, zero dependencies, no peers, own types; peer check
   via `npm info` empty). `npm audit` shows 11 findings, none touching the
   new package; `npm run security:audit` exits 0 under the existing
   exceptions. `QrFigure` falls back to the installed encoder when none is
   injected; the Devices surface loads it lazily beside the figure, so
   startup carries no QR bytes (Devices QR **21.6/25 KiB**, inside the
   pre-sized budget). The published tarball ships no licence file, so the
   notices gate carries upstream's LICENSE verbatim from
   `vendor/qrcode-generator/LICENSE` (copyright also named in the shipped
   `dist/qrcode.mjs`); the manifest's MIT declaration is still checked and
   any other licence-less package still fails. Structural finder-pattern
   plus oversize-refusal regressions in `test/unit/deviceQrEncoder.test.ts`.
   No other new dependency. Commit `de010e41b`.
3. **Production wiring (extension host).** `museSpark.openDevices` opens one
   `DevicesPanelTab` serving the `devices` surface; the first host message
   lazily loads `dist/devices.js` through the shared port with the
   production authorities (`openDeviceProductionDeps`: pairing store
   opened-or-created once, attempt journal with a real owner check,
   SecretStorage secrets on the local host, Windows storage protection).
   ACP/headless pairing is Q-M100 (out of scope), so no ACP/runtime wiring:
   PLAN names no other production caller. Eight regressions in
   `test/unit/deviceProductionWiring.test.ts` fail on the join base (the
   modules do not exist there). The tab shares its panel construction with
   the tasks tab (`createAuxWebviewPanel`, zero-clone gate green).
4. **Gates and records.** Build, split, size, host-globals, notices,
   packaging, knip, dpdm, `check:l10n`, `check:reference`, regenerated
   host API record, new `devices` reference feature with command coverage,
   new `museSpark.openDevices` manifest strings in all 15 tables, new
   `referenceDevices` UI string in all 14 tables (both English-pending via
   `l10n/untranslated.json`, hooks-command precedent). The worker C# asset
   ships (`.vscodeignore` + manifest test). One `§8` row for the single
   test-bundle cast.
5. **Docs.** README, PRIVACY (`docs/PRIVACY.md`), SECURITY.md, CHANGELOG
   (real user-facing `Added` entry), `featureCatalog` availability left at
   `unshipped` until installed-host qualification, this record.

### Lane K preconditions (stated, not stubbed)

Lane K (blocked on M109) binds after its owner-validity check: remote
execution with its worker driver (supplied through the unified selector —
kept out of `dist/devices.js` on purpose, since all three native drivers
with M96's environment record measure 40.4 KiB over the unchanged 125 KiB
cap), approval policy, the channel source, the listener facts
(`setup`/`otherAction`, including the canonical listener-port decision),
and the panel snapshot mapping. M96's engine `reserve`/`command`/
`recordEnvironment` adapters are likewise K's. Until then every K-owned
action refuses with typed `unsupported-host` (mapped to the Devices
recovery UI), paid use stays off, and teardown never throws. The Devices
surface itself — command, tab, ready handshake, off-state, QR with text
fallback — is reachable in VS Code on a local desktop window only;
remote, web and headless hosts refuse, and the other editors wait for
Q-M100 (see "Editor reach" in the fix round below; corrected by RVM100W
finding 13).

### Gate receipts (this worktree)

| Gate                                            | Exit | Result                                                                        |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| five typechecks                                 | 0    | host, webview, unit, e2e, integration clean                                   |
| eslint `--max-warnings=0` (full `npm run lint`) | 0    | clean                                                                         |
| prettier                                        | 0    | clean (changed files checked)                                                 |
| plain `npx knip`                                | 0    | same two pre-existing configuration hints                                     |
| `npm run duplication`                           | 0    | 0 clones (after the shared panel helper)                                      |
| `npm run cycles`                                | 0    | no cycles                                                                     |
| `node scripts/check-l10n.mjs`                   | 0    | 14 UI + 14 usage tables, 198 manifest strings, 0 problems                     |
| `npm run check:reference`                       | 0    | current (62 features, Devices 18 entries)                                     |
| `node scripts/check-host-api.mjs`               | 0    | 0 problems (regenerated)                                                      |
| `npm run build`                                 | 0    | devices.js **104.4/125 KiB**, activation 465.9/600, QR 21.6/25, no cap raised |
| `npm run security:audit`                        | 0    | 2 advisories, 1 exception file; no QR findings                                |

### Suites the lead must certify outside the sandbox

The sandbox refuses: the device journal's storage (ownership check),
Chrome launches (harness/a11y/keyboard scenes), `npm pack` (packaging
suites), interface enumeration and the systemd user bus. The lead runs,
on a qualified host: `deviceIntegration`, `deviceReceiver`,
`deviceRecovery`, the Devices harness/a11y/keyboard scenes, the
packaging suites. (The real-filesystem path of
`openDeviceProductionDeps` is now covered by
`deviceProductionStorage.test.ts`, run natively on Windows and on Kubuntu
in the RVM100W fix round below.)

### Installed-host qualification (lead-run, four machines)

Machines: Windows PC, Kubuntu VM, Mac mini, Win11 VM. Prerequisites: lane
K bound (pairing setup facts, execution, policy, source, snapshot) and the
M96 engine adapters; simulators rule where hardware is missing (D215).
Record for each machine: actual listener address/port, OS permission and
firewall facts, and who authorized each step.

1. **Open.** Command Palette → `Muse Spark: Open Devices in a Tab`.
   Expected: one Devices tab beside the editor; no bundle load until its
   first message (host log shows the lazy load once); the document posts
   `devicesReady` and renders the off-state; opening the tab starts no
   listener (no new listening socket) and sends no traffic.
2. **Pair (QR, then text).** On A: Pair → invite shows QR plus copyable
   text. Scan/import the text on B; compare fingerprints on both screens;
   confirm both. Expected: both sides list the pair with identical
   fingerprints; the invitation carries public certificate, fingerprint,
   address, protocol version and bounded validity, never a private key.
   Red drills: copy a public invite without its private key and try to
   pair (must fail); confirm a mismatched fingerprint (must refuse).
3. **Discover (mDNS).** Enable discovery on both; each sees the other's
   opaque service id, port and protocol version only. Expected: discovery
   off by default; a spoofed record never replaces the saved peer pin;
   manual entry connects with discovery fully blocked. Drill: enable
   discovery without consent in a golden (zero-traffic test fails).
4. **Run a lane on the remote device (needs K).** Offer a lane from A to B;
   B admits under its receiver grant; pause the offer; drop the transport
   and reconnect. Expected: resume resends only unacknowledged messages
   and never launches twice; a failed poll reads unknown-since, never
   running; re-dispatch only after lease expiry under a new epoch from
   the last acknowledged checkpoint; late results quarantined; results
   content-addressed and acknowledged once. Cancel: Stop reaches the local
   cancellation port first, without waiting for approval or persistence;
   cancellation proves neither retirement nor release.
5. **D215 physical-safety refusals (needs K).** Attempt a physical/maker
   action. Expected: a fresh receiver-local approval of the exact payload
   every time — no unattended action, ordinary approval, pairing grant or
   Bypass substitutes; `Waiting for approval on {device}` shows while
   pending; Stop still reaches the fail-safe channel reset with the
   journal unavailable. Physical support stays unavailable until an actual
   executor, exact-payload approval UI and printer/CNC/MCU simulators are
   supplied with passing receipts; simulator receipts never qualify
   hardware.
6. **Sign-off row per machine.** Listener application/interface/address/
   port, firewall exception (or refusal), storage directory ownership and
   SecretStorage/OS-store backend, worker driver in use (Windows service
   context / systemd user unit / launchd Aqua job), battery/AC reading
   during the run.

Checkable shell probes (run on each machine; trusted local paths only):

```sh
# Listening sockets before (expect none new) and after listen (expect the
# recorded pair port on the recorded interface only).
node -e "require('os').networkInterfaces()" # cross-check the setup facts
# Storage ownership: pairing dir and journal dir owner-only, ancestors safe.
# Windows: the storage helper answers ping; journal uses the DPAPI binding.
```

A step that needs K fails closed today (typed `unsupported-host` with
recovery guidance, never an empty success); record each such step as
K-blocked, not passed.

### Base-failure proof for the new regressions

The new test files cannot collect on `a4007f56c` (verified: none of
`deviceProduction.ts`, `views/devicesPanelTab.ts`, `deviceProductionWiring.test.ts`,
`deviceQrEncoder.test.ts`, `qrGeneratorEncoder.ts`, `auxWebviewPanel.ts`
exists there). The modified suites assert contracts absent on the base:
the migrated selector tests call the async three-factory
`selectDeviceWorkerDriver` (base has the sync two-factory variant plus the
deleted `deviceWorkerDriverForPlatform`); the QrFigure fallback test renders
QR pixels with no injected encoder (base renders nothing); the wiring, html
surface, manifest worker-file and reference/command assertions reference
`museSpark.openDevices`, the `devices` surface and
`MuseSparkDeviceWorker.cs`, none of which exist on the base.

### Lane W fix round — RVM100W findings (2026-10-08)

Windows 11 PC (native), worktree `mx-m100w2`, branch `m100/p2-w2` from
`3bda1b1c6`. Model attempts **0**, inference spend **0**; no push. The
parallel join-fix (`m100/p2-join-fix`) owns the launch/retire contract in
`deviceWorkerHost.ts`/`deviceReceiver.ts`; this round touches only the
selector region of the first and `DeviceReceiver.open`'s retention in the
second, and calls no `launch()`.

| #   | Finding                                                    | Fix                                                                                                                                                                                                                                        | Regression                                                                                                                               |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1 `museSpark.openInNewTab` registration deleted           | restored in `src/extension.ts`                                                                                                                                                                                                             | `commandRegistration.test.ts`: every contributed command has a registration call (TypeScript AST over `extension.ts` and `tabBundle.ts`) |
| 2   | unbound K stops the service opening                        | `DeviceReceiver.open` asks `retain` only for a non-empty journal; the tab answers a request whose service cannot open with its typed refusal (`unsupported-host`/`storage`), correlated, and keeps that document's revisions its own after | `deviceProductionStorage.test.ts` (real factory, real storage, production ports: ready observes, Pair refuses typed); tab refusal cases  |
| 3   | first use never provisions the Devices folder              | `openDeviceProductionDeps` creates it recursively `0700`; on Windows the folder this call created is claimed with `secureFresh` before the journal                                                                                         | real filesystem (native helper on Windows); claim-only-when-created case                                                                 |
| 4   | opened store never closed                                  | store `close()` on every failure path and on disposal, before the helper ends (last-in first-out)                                                                                                                                          | real `.pairing.lock` release after a journal failure and after disposal; ordered release counts                                          |
| 5   | window-owned service has no lifetime disposer              | `devicesWindow` (in `devicesPanelTab.ts`) owns service and tab; `context.subscriptions` holds it                                                                                                                                           | in-flight preparation revoked (no service built, storage released); bound service and storage ended                                      |
| 6   | fabricated local-host facts                                | `deviceExecutionHost` from `vscode.env.uiKind`, `vscode.env.remoteName` and the extension kind; the builder asserts D80 before any storage                                                                                                 | SSH, WSL, dev container and tunnel refuse `unsupported-host` with no folder, helper, store or secrets; web and UI-kind remote refuse     |
| 7   | encoder resolution replaces `postMessage`, cancelling Pair | one `postMessage` for the document's lifetime in `src/webview/main.tsx`                                                                                                                                                                    | real Chrome: Pair held across the encoder chunk; one `devicesReady`, no alert, the held reply is accepted and its QR drawn               |
| 8   | storage seam bundles fail the expanded predicate           | the seam bundles come from one shared `fakeDevicesBundle` carrying every predicate export; predicate and disposal assertions unchanged                                                                                                     | `windowsStorageProtection.test.ts` lifecycle cases pass natively                                                                         |
| 9   | owner-check tests not portable                             | injectable `userId` probe; the check still compares the folder's real owner                                                                                                                                                                | pass on Windows; a different owner and an absent user id refuse `storage`                                                                |
| 10  | QR harness locator matches two images                      | the probe's holder is marked; the locator is scoped to it; every size and quiet-zone assertion kept                                                                                                                                        | see the harness note below                                                                                                               |
| 11  | encoder chunk failure silent                               | the QR spot shows the localized load failure with Retry; Retry reloads the document, since Chrome keeps a failed module fetch for the document's lifetime (measured: no second request on re-import)                                       | real Chrome: refused chunk shows the alert beside the complete text invitation; Retry reloads and draws the QR                           |
| 12  | two strings English-pending in 14 languages                | both translated in all 14 tables; the exemptions removed (`l10n/untranslated.json` is identical to the join base)                                                                                                                          | `check:l10n` with no new exemption                                                                                                       |
| 13  | "every editor" reach claim                                 | corrected above and below                                                                                                                                                                                                                  | —                                                                                                                                        |
| 14  | selector lost the driver-platform assertion                | `selectDeviceWorkerDriver` refuses a driver naming another platform (`unsupported-host`, detail `helper`)                                                                                                                                  | `deviceWorkerLinux.test.ts` typed mismatch cases (darwin, win32, linux)                                                                  |

**Editor reach (finding 13).** Only VS Code's activation wires the Devices
command and tab today, and only on a local desktop window: Remote SSH,
Tunnels, WSL, dev containers, Codespaces and web windows refuse with typed
`unsupported-host` before any storage (D80 "Supported first"). The ACP
agent, the standalone runtime and the companion bridges have no Devices
caller: ACP/headless pairing is out of this phase's scope (PLAN M100 phase
2, "Out of scope … ACP/headless pairing … (still Q-M100)"), so under D84
those editors are deferred to Q-M100's host/key-location qualification,
which owns their entry point. The Help entry correctly lists VS Code only.

**Red drills (each reverted after).**

- P1: deleting the registration fails both `commandRegistration` cases
  (`missing: ["museSpark.openInNewTab"]`).
- 2: making `retain` unconditional again fails the real-factory case with
  `unsupported-host` from the unbound port.
- 4: dropping the store's release fails six cases (lock still held, release
  order missing `store`).
- 7: a per-render `postMessage` in `main.tsx` fails the real-Chrome case
  (`expected 2 to be 1`: a second `devicesReady` after the encoder loaded).

**Harness note.** On this PC the harness page posts its first message
1.0–1.4 s after load, and the readiness scenes become ready 2.1–3.1 s after
`goto`; the base `3bda1b1c6` webview measures the same. At the suite's 2 s
ready deadline (unchanged) the six readiness scenes and the QR sizing case
therefore time out intermittently here; with a one-off 10 s deadline
(reverted, never committed) all 18 cases pass, including the scoped
maximum-size QR. The lead re-runs this suite at its default deadline on a
qualified host.

**Suites run.** Natively on this Windows PC (at most three files per run,
`--maxWorkers=3`, default timeouts): `deviceProductionWiring` +
`deviceProductionStorage` + `windowsStorageProtection` 63/63;
`deviceRecovery` + `deviceReceiver` 86/86 and `deviceIntegration` 12/12
(run alone after one forks-worker start timeout, an unhandled pool error,
not a test result); `DevicesApp` + `devicesPhase2Views` + `deviceBundle`
53/53; `commandRegistration` + `deviceProductionStorage` + `manifest` 40/40;
`devicesPhase2Harness` 14/18 at its 2 s deadline (harness note above), 18/18
with the one-off longer deadline. On Kubuntu through
`rig-test.sh` (slots 1 and 2): `deviceProductionStorage` +
`deviceProductionWiring` + `deviceWorkerLinux` 55/55, exit 0;
`deviceRecovery` + `deviceReceiver` + `deviceIntegration` 98/98, exit 0.
`deviceWorkerLinux` natively: 30/31 in each of four runs, the failing case
being a spawn-timing wait (`vi.waitFor` default 1 s for a real child's exit);
the base `3bda1b1c6` fails the same case alone in one of two runs and
another spawn case in one of two full runs, so it is a pre-existing host
timing flake in the driver suite (join-fix territory), not a pass.
`deviceWorkerHost` is not run here: its `throughReceiver` fixture belongs
to the join-fix.

**Gate receipts** (`CI=true`, this worktree):

| Gate                      | Exit | Result                                                                                         |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| five typechecks           | 0    | host, webview, unit, e2e, integration; unit re-run after the fixture change, 0                 |
| `npm run lint:js` (full)  | 1→0  | 4 errors, all in a test file edited during the run; fixed, the three changed files re-linted 0 |
| `prettier --check .`      | 0    | clean; changed files re-checked after the fixture change                                       |
| plain `npx knip`          | 0    | the same two configuration hints                                                               |
| `npm run duplication`     | 1→0  | 3 test-fixture clones; one shared `fakeDevicesBundle` and `readyWindow`, then 0 clones         |
| `npm run cycles`          | 0    | no cycles                                                                                      |
| `npm run check:l10n`      | 0    | 14 UI + 14 usage tables, 198 manifest strings, 0 problems, no new exemption                    |
| `npm run check:reference` | 0    | current; Devices 18 entries                                                                    |
| `npm run check:host-api`  | 0    | regenerated with `--write` (`env.uiKind`, `UIKind.Web`; extension kind now also in activation) |
| `npm run build`           | 0    | devices.js **104.6/125 KiB**, activation 467.0/600, Devices QR 21.6/25; no cap raised          |

### Lane W final round — RVM100W2 findings (2026-10-08)

Same worktree and branch, on `f56eea7a4`. Model attempts **0**; no push.
The join-fix files are untouched.

| #   | Finding                                                                | Fix                                                                                                                                                                                                                                                                                                                                                                                                                            | Regression                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | a transient Windows helper failure leaves an unsecured folder forever  | the Devices folder only ever appears already private: POSIX creates it with `mkdir` mode `0700`; Windows claims a uniquely named sibling stage with `secureFresh` and renames it into place. The helper compiles into `devices-helper` beside it (`DEVICES_HELPER_DIR`), so nothing else creates the folder first                                                                                                              | real filesystem: the step before the folder fails once (the Windows helper; the pairing store elsewhere), nothing half made remains, the retry provisions it and the journal opens                                                                |
| 2   | a recursive `mkdir` result does not prove the leaf was created here    | the leaf is created exclusively (POSIX `mkdir` without `recursive`; Windows `rename`, which refuses an existing folder, measured `EPERM` with the target untouched). An existing folder, or one another creator makes mid-call, is never claimed; it is checked and refused if not private                                                                                                                                     | interleaving: another creator makes Devices (with data) inside this call's claim; only the stage was claimed, their file is intact, no stage remains. Real filesystem: a non-private folder with data is refused, its ACL/mode and data unchanged |
| 3   | encoder Retry silently drops pairing state and a waiting reply         | Retry is disabled while any Devices request waits for its reply; the alert says Retry reloads the panel, that pasted text is kept and that Pair device shows the invitation again (`devices.qrReload`, all 14 languages); the unsent draft is kept in the document's webview state and restored after the reload                                                                                                               | jsdom: Retry disabled while a Pair waits, enabled after its reply; draft restored and saved. Real Chrome: the same, across the actual reload                                                                                                      |
| 4   | lane U's QR-figure Retry re-imports a failed module and never recovers | the figure's failure recovers the same way (document reload, same safeguards). The figure also loads with the document and is handed to the view loaded, so a failed figure chunk is reported at once and a QR draws in the same frame as its invitation                                                                                                                                                                       | jsdom: the misleading re-import test now proves the reload (no second import). Real Chrome: a refused figure chunk, and a refused encoder chunk, each recover after Retry                                                                         |
| 5   | `devices-qr` readiness margin                                          | measured first: on the Win11 VM every product chunk but the QR figure finished ~0.24 s after navigation; the figure loaded only after the invitation reply (~1.2 s), and the rest was the harness's fixed 300 ms settle before each of the scene's four waits. Fix: the figure loads with the document (above), and Devices steps, which only wait for elements a host message or reply creates, probe at once (still bounded) | before/after on the Win11 VM, below; the 2 s deadline is unchanged                                                                                                                                                                                |

**Win11 VM, `goto` to ready marker, seconds (three rounds each).** Before
(`f56eea7a4`): devices-qr 2.08, 1.99, 1.99; the five other scenes 1.39–1.92.
After: devices-qr 1.42, 1.44 (a first, cold navigation in that run took 1.0 s
for `goto` itself and 2.4 s to ready); the other scenes 1.40–1.44, blocked
0.89. The QR now draws in the same frame as its invitation (`qrSvg` equals
the ready time). The harness suite passed 19/19 there at its default
deadlines. On this PC, heavily loaded by other sessions (CPU ~65%), the
Devices document itself takes 1.3–1.8 s to mount, and the readiness scenes
still flip at 2 s; the drill below shows the settle change saves ~0.35 s
here too.

**Red drills (each reverted after).**

- 1: creating the leaf before the helper again (the old order) fails three
  real-filesystem cases, including the retry case.
- 2: claiming the existing folder (after a refused rename, or when it is
  found) fails the interleaving case, the claim-once case and the
  real-filesystem refusal case.
- 3: an always-enabled Retry fails the waiting-reply case; dropping the
  draft save fails the draft case.
- 4: QrBoundary's re-import Retry fails the reload case in jsdom; that Retry
  with the old lazy-only figure never recovers a refused figure chunk in
  real Chrome (15 s timeout).
- 5: restoring the 300 ms settle for Devices steps adds ~0.35 s to
  `devices-qr` view→ready on this PC (1.41 s against 1.04–1.11 s).

**Suites.** Natively here: `deviceProductionStorage` + `deviceProductionWiring`
28/28; `devicesQrLoading` + `DevicesApp` + `devicesPhase2Views` 53/53;
`harnessWaits` 30/30; `devicesPhase2Harness` 16–19/19 by host load (all three
new Chrome cases pass). Kubuntu: `deviceProductionStorage` +
`deviceProductionWiring` + `devicesQrLoading` 33/33, exit 0. Win11 VM:
`devicesPhase2Harness` 19/19 plus the timing probe, exit 0.

**Gate receipts** (`CI=true`): five typechecks 0; `prettier --check .` 0;
`check:l10n` 0 (the new `devices.qrReload` string in all 14 tables, each
naming that table's own Try again and Pair device labels); `check:reference`
0; `check:host-api` 0; `npm run duplication` 0 clones; `npm run cycles` 0;
`npm run build` 0 (devices.js **105.2/125 KiB**, Devices QR 21.6/25,
`main.js` + static imports 736.8/900; no cap raised). Plain `npx knip` first
crashed out of memory (`Array buffer allocation failed`) while other
sessions held this PC's memory, not a finding; rerun alone, 0 with the same
two configuration hints. Full `npm run lint:js` 1: five errors in this
round's files (`prefer-await`, `no-useless-undefined`,
`no-await-expression-member`); fixed, and the twelve changed source and test
files re-linted 0.

## Join review fixes (RVM100JOIN, 2026-10-08)

Branch `m100/p2-join-fix` from the joined tree **`a4007f56c`**
(`refs/rigs/kubuntu/m100/p2-int-lead2`), worktree
`C:/Users/Randy/Coding/mx-m100jfix` on the lead's Windows 11 host. Review
RVM100JOIN (Codex) found two P2s and no P1 or P3. Model attempts **0**,
inference spend **0**. No push, merge, rebase, stash, credential read, ACL
change, dependency change or cap change. The two driver selectors in
`deviceWorkerHost.ts` (`deviceWorkerDriverForPlatform`,
`selectDeviceWorkerDriver`) are untouched: lane M100W deletes one when it wires
production callers.

### Contract change: a driver states what a failed launch left behind

`DeviceWorkerDriver.launch` now resolves a `DeviceWorkerLaunch`
(`deviceWorkerHost.ts:86`). Each driver must construct one case, so a plain
throw can never be read as a refusal:

| Case        | Meaning                                                                                                                                              | Host settles retirement                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `launched`  | The job to activate and observe, as before.                                                                                                          | Only by observed whole-job exit (unchanged).                                                             |
| `refused`   | Proof that nothing remains for this attempt: no job, unit, helper or attempt storage, and nothing can still start (`deviceWorkerRefused`, `:101`).   | `{ refused: true, usage }`: journaled `refused`, occupancy zero, released once.                          |
| `uncertain` | The driver retains the attempt. Optional `reclaimed` resolves only after the driver observes reclamation, never on a timer or failed query (`:105`). | Pending until `reclaimed` resolves, then `refused` (never activated, proved gone). Without it, rejected. |
| rejection   | A plain throw from `launch()`, even a typed `DeviceWorkerHostError`.                                                                                 | Rejected as uncertain. Never `refused`.                                                                  |

The host (`settleFailedLaunch`, `:347`; branch at `:445`) settles `refused`
directly only when the driver was never asked to launch (failed self-test,
preflight, hook verification, boundary refusal: `isLaunchCalled`, `:410`) or
when the driver returned `refused`. The receiver (`deviceReceiver.ts:589`,
`:614`) journals a start that itself rejected as `uncertain`, with its admitted
occupancy, queued after the dispatch. An already observed retirement is
journaled first and wins. A later proved reclamation moves the record from
`uncertain` to `refused` and releases once, through the existing `retire`
effect. The journal already allowed `uncertain → refused`; no schema changed.

- **macOS** (`deviceWorkerDarwin.ts`). Admitted-cap, preparation and
  entry-sweep failures come before this attempt's record: `refused` (`:950`).
  After registration the existing catch-path reclamation runs first. A record
  that reached `reclaimed` is `refused`; otherwise `uncertain` with
  `reclaimed: attempt.reclaimed.promise` (`:785`). That signal resolves only on
  the lifecycle's transition to `reclaimed` (`:528`), so HM8/HM9's sweeps at
  preparation entry, launch, capacity refusal and query are the release path.
  No native helper, lifecycle row, cap or interval changed.
- **Windows** (`deviceWorkerNative.ts`). The cap check, the oversize request
  (now checked before the attempt directory exists) and allocation or capacity
  failures are `refused` (`:164`, `:185`, `:189`). A refused helper or a failed
  request write, before any helper call, is `refused` once its directory is
  removed, else `uncertain` (`:200`, `:202`). After `--launch`, a failure is
  `uncertain` with its evidence kept (`:294`), with one proved exception: the
  task's own last result is STATUS_DLL_INIT_FAILED while it is not running (the
  single on-demand run ended before any job or child), `--remove` succeeded and
  the directory is removed (`:216`, `:285`). Windows has no sweep, so other
  failures stay `uncertain` until local recovery (D80.7).
- **Linux** (`deviceWorkerLinux.ts`). Everything before the slot and any unit
  is `refused` (`:403`). Once any unit could have started, `failed()` (`:417`)
  refuses only when the live manager shows both the worker and inhibitor units
  with no control group, inactive and dead (`isUnitGone`, `:377`). Otherwise the
  attempt is `uncertain` and keeps its driver slot against
  `DEVICE_LIMITS.unresolvedAttempts`. Linux has no sweep, so `reclaimed` is
  absent.

### Finding map

| Finding                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                          | Owning tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 1, `deviceWorkerHost.ts:370`: a rejected launch read as `refused` | Typed `DeviceWorkerLaunch` above. Host `:347`, `:445`; receiver `:589`, `:614`; macOS `:528`, `:785`, `:950`; Windows `:164` to `:294`; Linux `:377` to `:583`.                                                                                                                                                                                                                                                                              | `deviceWorkerDarwin.test.ts:557` commits the reviewer's probe: the real macOS driver fails pre-ready readiness with bootout unavailable, through the real host, receiver and schema-validated journal; occupancy kept, no release, `uncertain` until the existing sweep reclaims it, then `refused` and one release. `deviceWorkerHost.test.ts:807` (rejected launch; uncertain with no reclamation observation), `:816` (uncertain until reclaimed, then refused once), `:562` (Windows heap proved and unproved); `deviceWorkerLinux.test.ts:348` (an unproved unit keeps its slot). The four existing pre-allocation refusal cases keep their single release. |
| P2 2, `deviceWorkerHost.test.ts:138`: plain `mkdtemp` receiver root  | `protectedWorkerJournal()` (`helpers/deviceWorkerReceiver.ts:17`) builds every worker-receiver journal under `privateDeviceRoot()`; the host file ends the shared helper (`afterAll(endDeviceStorage)`, `:161`). The fixture sweep found one more journal over a plain `mkdtemp` parent: the macOS native capacity case, now also under `protectedWorkerJournal` (`deviceWorkerDarwin.test.ts:1347`). The production ACL check is unchanged. | The six cases RVM100JOIN listed (two capacity retirements, four refused starts), plus the three new receiver cases, with the real native binding on Windows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Every other journal or store fixture (`deviceExecutionFixtures`,
`deviceIntegration`, `deviceMdns`, `deviceDiscoverySwitch`,
`devicePairingAdapter`, `deviceStore`, `deviceRecovery`, `attemptJournal`)
already used `privateDeviceRoot`, `useDeviceStorageRoot` or the execution
fixture.

### Base proof and red drills

All runs use repository default timeouts and `--maxWorkers=3`, at most three
files. On `a4007f56c` on this host, the three H files (`deviceWorkerHost`,
`deviceWorkerHostNative`, `windowsStorageProtection`) exit **1: 7 failed, 78
passed, 13 skipped**. Six are RVM100JOIN's `DeviceJournalError: storage`
cases; the seventh is a native scheduled-task case at the 15 s default on this
loaded host. The new tests copied over the unchanged base sources fail
**8 of 11** host selections, plus the macOS real-driver case and the Linux slot
case. The three that pass on base are the two host-level refusals (correct on
base once the root is protected) and the no-reclamation variant, which passes
only because the base host reads the new union object as a malformed job and
rejects it.

Each drill below ran in a throwaway worktree of the fix commit and restored the
mutated file byte-exact (SHA-256 compared; `git status` clean). The first set
ran on `ec6e1c9bf`; the three drills that touch the refactored tests ran again
on `30413d3e9` with the same results.

| Drill                                 | Deliberate break                                           | Result                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| rejected launch read as refused again | Host settles a rejected launch through the not-run branch  | **Exit 1**, 1 failed: the rejected-launch receiver case.                                                                              |
| plain `mkdtemp` fixture               | `realpath(mkdtemp(...))` instead of `privateDeviceRoot`    | **Exit 1**, 9 failed with `DeviceJournalError: storage`: the six listed cases, the new receiver cases and the macOS real-driver case. |
| no uncertainty on a failed start      | Receiver no longer records `started`                       | **Exit 1**, 1 failed: the reclaimed case (journal stays `launch-intent`).                                                             |
| macOS never signals reclamation       | Remove the `reclaimed` resolve on the lifecycle transition | **Exit 1**, 1 failed: the macOS real-driver case never releases.                                                                      |
| Linux refuses an unproved unit        | Drop the per-unit proof in `failed()`                      | **Exit 1**, 1 failed: the Linux slot case.                                                                                            |

### Verification

| Run                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows host: `deviceWorkerHost`, `deviceWorkerHostNative`, `windowsStorageProtection`           | **87 passed, 2 failed, 13 skipped.** `deviceWorkerHost` 43/43 and the storage binding pass; the two failures are native scheduled-task cases at the 15 s default on this loaded host (the base timed out one of them here).                                                                                                                                                                                        |
| Win11 VM (Windows 11, idle), same three files, final tree                                        | **Exit 0: 89 passed, 13 Linux-only skipped**; all **7 Windows-native** cases pass.                                                                                                                                                                                                                                                                                                                                 |
| Win11 VM, the reviewer's 42 device, Devices UI, journal, grants and storage files, three per run | **41 of 42 files pass: 1,604 passed, 0 failed, 60 skipped** (31 macOS-native, 13 Linux-native, and the 16 harness cases). That is RVM100JOIN's 1,608 less the 16 harness passes, plus its 6 storage failures now passing and 6 new tests. `devicesPhase2Harness.test.mjs` fails at file level there and on this host, also on the unchanged base (60 s hook timeout launching Chrome); it passes 16/16 on Kubuntu. |
| Windows host, the same sweep                                                                     | **1,489 passed, 5 failed, 60 skipped**; 37 files pass. Load symptoms the base shares: three jsdom/worker files lost at startup, the harness, and five macOS stress cases at the 15 s default (four fail identically on base here; all pass on macmini).                                                                                                                                                            |
| Kubuntu rig, final tree: `deviceWorkerLinux`, `deviceWorkerHostNative`, `deviceWorkerHost`       | **Exit 0: 87 passed, 7 Windows-only skipped**; all **13 native Linux** cases ran.                                                                                                                                                                                                                                                                                                                                  |
| Kubuntu rig: `deviceReceiver`, `deviceRecovery`, `devicesPhase2Harness`; and `attemptJournal`    | **Exit 0: 102 passed**; earlier `deviceReceiver`, `deviceRecovery`, `attemptJournal`: **115 passed**.                                                                                                                                                                                                                                                                                                              |
| Mac mini rig, final tree: `deviceWorkerDarwin`, `deviceWorkerHost`                               | **Exit 0: 507 passed, 0 skipped**; all **31 native macOS** cases ran. Earlier with `deviceReceiver`: 556 passed.                                                                                                                                                                                                                                                                                                   |
| Five typechecks                                                                                  | **0** (`npm run typecheck`, 924 s on this host); unit typecheck **0** again after the test follow-up.                                                                                                                                                                                                                                                                                                              |
| ESLint `--max-warnings=0`, Prettier on every changed file                                        | **0 / 0**, and the installed hooks (lint-staged ESLint and Prettier, staged gitleaks: no leaks) passed on both commits.                                                                                                                                                                                                                                                                                            |
| Plain knip; cycles; `check:host-api`                                                             | **0**; **0**; **0** (no new Node import rows).                                                                                                                                                                                                                                                                                                                                                                     |
| jscpd                                                                                            | **1** on `ec6e1c9bf` (7 clones in the new tests), then **0 clones** after `30413d3e9` shared the receiver assertions and journal setup. Threshold unchanged.                                                                                                                                                                                                                                                       |
| Production build                                                                                 | Kubuntu rig on the final tree: **exit 0**, `dist/devices.js` **102.5 / 125 KiB**, every cap unchanged. On this host the build's bundle-split check exits 1 with 8 "no longer carries node_modules/..." findings in unrelated bundles; the unchanged base gives the identical 8 in the same node_modules-junction worktree, so it is the junction, not this change.                                                 |

Files changed: `src/host/devices/deviceWorkerHost.ts`,
`src/host/devices/deviceReceiver.ts`, `src/host/backend/deviceWorkerDarwin.ts`,
`src/host/backend/deviceWorkerNative.ts`, `src/host/backend/deviceWorkerLinux.ts`,
`test/unit/deviceWorkerHost.test.ts`, `test/unit/deviceWorkerDarwin.test.ts`,
`test/unit/deviceWorkerLinux.test.ts`, `test/unit/deviceWorkerHostNative.test.ts`,
`test/unit/helpers/deviceWorkerReceiver.ts`,
`test/unit/helpers/deviceDarwinEscape.ts` and this record. Commits
`ec6e1c9bf` (fix) and `30413d3e9` (test sharing), then this record.

**W request:** production callers of `DeviceWorkerDriver.launch` receive a
`DeviceWorkerLaunch`; only `DeviceWorkerHost` should call it. Carry an
Unreleased CHANGELOG line that a failed device-worker launch is now refused only
with proof and otherwise held as uncertain until its driver reclaims it.

### RVM100JFIX Linux repairs (2026-10-08)

Codex review RVM100JFIX of `a4007f56c..c828a76f0` found no P1 and confirmed the
host/receiver contract and fixtures. Its two P2s, both in
`src/host/backend/deviceWorkerLinux.ts`, are fixed in **`cc7d17b62`**. Model
attempts **0**, inference spend **0**; no push.

1. **An uncertain launch lost its slot through the retirement observer.** The
   observer starts before launch completes. When the final query failed and
   cleanup could not prove the worker unit gone, releasing the inhibitor
   rejected the observer, whose catch called `releaseSlot()`; 129 unresolved
   attempts were admitted against the 128 cap. The slot now belongs to the
   attempt's lifecycle: only `remove()` after observed retirement, or a proved
   refusal in `failed()` (`:419`, which also drops the unit from `jobs`, `:426`),
   releases it. The observer's catch no longer does (`:554`). A launched job
   whose retirement is unproved keeps its slot until local recovery, like any
   other unresolved attempt.
2. **Absent units were taken as reclamation while the launcher could still
   submit its unit.** A failed launch now stops the worker's `systemd-run`
   client without activating it, observes it closed and exited (or never
   spawned) within the frame deadline (`isLauncherTerminal`, `:498`;
   `hasLauncherEnded`, `:502`), and only then asks the manager whether both
   units are gone (`:600`). Until both hold, the launch is `uncertain` and keeps
   its slot.

| Regression (`deviceWorkerLinux.test.ts`)                                                    | Proves                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:385` a never-activated unit left unproved (before / after its retirement observer exists) | The reviewer's 129-launch probe: readiness passes, the final query cannot read `cgroup.procs`, Stop is refused. All 128 results are `uncertain` with no `reclaimed`; the 129th is refused for capacity before any start. The earlier table row keeps the pre-observer case. |
| `:406` absent units after a failed readiness query                                          | The reviewer's stream and manager probe: the first readiness query fails, Stop is refused, the manager then shows both units gone. With the launcher still running the result is `uncertain`; once it ends, `refused`. No activation is sent in either case.                |

| Base proof and drills (Windows host, `--maxWorkers=3`, default timeouts, file restored byte-exact) | Result                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driver from `c828a76f0` under the new tests                                                        | **Exit 1, 3 failed**: the 129th launch is admitted (`uncertain`), the stuck launcher gives `refused`, and the control never stops its launcher. The pre-observer row still passes, as on that base. |
| Observer releases the slot again                                                                   | **Exit 1, 1 failed**: the post-observer slot case.                                                                                                                                                  |
| Absence refused without the launcher proof                                                         | **Exit 1, 2 failed**: the stuck launcher is refused, and the control never stops its launcher.                                                                                                      |
| Restored final source                                                                              | **Exit 0**, 4 passed.                                                                                                                                                                               |

Kubuntu rig, natively: `deviceWorkerLinux`, `deviceWorkerHostNative` and
`deviceWorkerHost` **exit 0, 90 passed, 7 Windows-only skipped**, all **13
native Linux** cases included; the final committed tree again **34/34** for
`deviceWorkerLinux`. Production build there **exit 0**, `dist/devices.js`
**102.5 / 125 KiB**. On the committed tree: host and unit typechecks, plain
knip, cycles and `check:host-api` **exit 0**; ESLint `--max-warnings=0`,
Prettier and jscpd (**0 clones**) **exit 0**; the installed hooks passed.

## Join (W + JFIX), 2026-10-08

Branch `m100/p2-joined` from lane W's final **`aa31aabcf`**, then
`git merge --no-ff m100/p2-join-fix` (**`d1a776f40`**), in worktree
`C:/Users/Randy/Coding/mx-m100w2` on the lead's Windows 11 host. Merge base
`a4007f56c`: 10 W commits and 5 join-fix commits. The worktree's
`node_modules` is a real directory and the installed hooks were present, so
`npm run prepare` was not needed. Model attempts **0**, inference spend **0**;
no push, rebase, stash, credential read, ACL change, dependency change or cap
change.

### Conflicts and resolutions

| File                                 | Conflict                                                                                                                                                                                           | Resolution                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/deviceWorkerHost.test.ts` | Both added helpers after `helperRequestSchema`: W's `wrongPlatformFactory` (async selector test); JFIX's `afterAll(endDeviceStorage)`, `launchTwice`, `dispatchHeldUncertain`, `expectRefusedOnce` | Both kept verbatim, W's helper first. No test dropped or assertion changed.                                                                                                                                                                                                                                                                          |
| `docs/certification/m100-phase2.md`  | Both appended after the final-join record                                                                                                                                                          | Both kept whole, in order: lane W (with its RVM100W and RVM100W2 rounds), then the join-fix records (RVM100JOIN, RVM100JFIX), then this section. Line references in the join-fix record are against `d1a776f40`; in the joined tree, `deviceWorkerHost.ts` after the selector (from `:145`) reads +17 and `deviceReceiver.ts` after `:148` reads +4. |

Auto-merged without conflict: `src/host/devices/deviceWorkerHost.ts` (W's one
async three-factory `selectDeviceWorkerDriver` with its driver-platform check;
JFIX's `DeviceWorkerLaunch` union and `settleFailedLaunch`, in separate
regions) and `src/host/devices/deviceReceiver.ts` (W: `open` asks `retain`
only for a non-empty journal; JFIX: a start that rejects is journaled
`uncertain` with its occupancy). These are different guards, and neither
weakens the other: a journal holding JFIX's `uncertain` record is non-empty,
so `retain` still restores its occupancy on reopen. The two
`deviceWorkerLinux`/`deviceWorkerDarwin` tests carry W's selector migration
and JFIX's driver cases side by side.

**Survival check.** For every file, the joined tree's changed lines against
one parent equal the other parent's changed lines against the base, with zero
differences. For example, `deviceWorkerHost.ts` has 87 against W and 87 for
JFIX; `deviceWorkerHost.test.ts` has 273/273 against W and 28/28 against JFIX;
`deviceWorkerLinux.test.ts` has 233/233 and 54/54. Eight of JFIX's twelve
files have identical patch-ids, including `deviceReceiver.ts` and
`deviceWorkerDarwin.test.ts`, which W also touched.

**JFIX request to W, carried here.** Only `DeviceWorkerHost` calls
`driver.launch` (`deviceWorkerHost.ts:428`). W wires no production launch
caller (lane K owns execution), and the deleted `deviceWorkerDriverForPlatform`
has no remaining caller. The requested Unreleased CHANGELOG line is added under
Fixed: a failed Devices worker launch is refused only with proof and otherwise
held as uncertain.

### Suites per machine

Repository default timeouts, at most three files per run, `--maxWorkers=3`.
All rig runs used `rig-test.sh` snapshots of one tree, **`65c4d3e9a`** (the
resolved merge with the CHANGELOG line). The two "later" VM runs used
snapshots that differ from it only in this record and the PLAN line.

| Machine         | Files                                                                    | Result                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Win11 VM        | `devicesPhase2Harness`                                                   | **exit 0, 19/19**                                                                                                                                                                                                                                                                   |
| Win11 VM        | `deviceWorkerHost`, `deviceWorkerHostNative`, `windowsStorageProtection` | **exit 0, 89 passed, 13 skipped**                                                                                                                                                                                                                                                   |
| Kubuntu         | `deviceWorkerLinux`, `deviceWorkerHostNative`, `deviceWorkerHost`        | **exit 0, 91 passed, 7 skipped**                                                                                                                                                                                                                                                    |
| Kubuntu         | `deviceReceiver`, `deviceRecovery`, `attemptJournal`                     | **exit 0, 115/115**                                                                                                                                                                                                                                                                 |
| Kubuntu         | `devicesPhase2Harness`                                                   | **exit 0, 19/19**                                                                                                                                                                                                                                                                   |
| Kubuntu         | `deviceProductionStorage`, `deviceProductionWiring`, `devicesQrLoading`  | **exit 0, 33/33**                                                                                                                                                                                                                                                                   |
| Kubuntu         | `deviceIntegration`, `deviceStore`, `deviceWorkerDarwin`                 | **exit 0, 464 passed, 31 skipped**                                                                                                                                                                                                                                                  |
| Mac mini        | `deviceWorkerDarwin`, `deviceWorkerHost`                                 | **exit 0, 507/507** (native macOS cases)                                                                                                                                                                                                                                            |
| Win11 VM, later | `devicesQrLoading`, `DevicesApp`, `devicesPhase2Views`                   | **exit 0, 53/53**                                                                                                                                                                                                                                                                   |
| Win11 VM, later | `deviceWorkerLinux`, `deviceWorkerDarwin`, `deviceQrEncoder`             | exit 1: **467 passed, 3 failed, 31 skipped**; `deviceWorkerLinux` passes in full; the three are `deviceWorkerDarwin` fake-port stress cases (two 15 s timeouts, one follow-on `unsupported-host`), run while the VM was shared with another lane; JFIX head on the VM: JOIN_VM_JFIX |

The Kubuntu worker trio is JFIX's 90 plus W's driver-platform mismatch case
(RVM100W 14). The VM trio equals JFIX's VM receipt (89/13), and the Mac mini
equals JFIX's 507.

**Windows host, natively** (the lead's PC, 58 to 91% CPU from other sessions
throughout; 43 device and Devices UI files, the harness going to the VM). A
one-file batch first reached vitest split into single characters (a bug in
this lane's runner script). That ran most of the unit suite for 15 minutes
before it was stopped, and the run is discarded; `DevicesView` was rerun
alone. Host test runs ended at 19:10 when the coordinator reserved the
overloaded host for git and file edits.

| Run                                                                        | Result                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deviceProductionStorage`, `deviceProductionWiring`, `commandRegistration` | **exit 0, 30/30**                                                                                                                                                                                                                                                                                                                                      |
| `DevicesApp` (+ two files lost at pool start, below)                       | 20/20; vitest could not start the forks worker for `devicesQrLoading` and `devicesPhase2Views` ("Timeout waiting for worker to respond"), exit 1                                                                                                                                                                                                       |
| `devicesPhase2Views` alone; `DevicesView` alone                            | **28/28**; **78/78**                                                                                                                                                                                                                                                                                                                                   |
| `deviceReceiver`, `deviceRecovery`, `deviceIntegration`                    | **exit 0, 98/98**                                                                                                                                                                                                                                                                                                                                      |
| nine further runs: every other `device*`/`devices*` file, three at a time  | **all exit 0: 716 passed** (62, 58, 153, 45, 83, 52, 89, 62, 112)                                                                                                                                                                                                                                                                                      |
| `deviceWorkerHost`, `deviceWorkerHostNative`, `windowsStorageProtection`   | exit 1: **86 passed, 3 failed, 13 skipped**; the three are real scheduled-task cases (two 15 s timeouts, one `vi.waitFor`); the VM passes all                                                                                                                                                                                                          |
| `deviceWorkerLinux`, `deviceWorkerDarwin`, `deviceQrEncoder`               | exit 1: **464 passed, 6 failed, 31 skipped**; five macOS stress cases (three 15 s timeouts, two follow-on), one Linux real-child wait (below)                                                                                                                                                                                                          |
| the three driver files alone, joined tree (while knip and the build ran)   | `deviceWorkerDarwin` **429 passed, 4 failed, 31 skipped** (the same stress cases); `deviceWorkerLinux` **34/35** plus one unhandled rejection (below); `deviceWorkerHostNative` **1 passed, 6 failed, 13 skipped** (scheduled-task timeouts)                                                                                                           |
| `devicesQrLoading` alone                                                   | once **4 passed, 1 failed** (a `findByRole` wait for the QR image), once no tests (forks worker start timeout, 91% CPU); on the VM with its trio, **53/53**                                                                                                                                                                                            |
| JFIX head `d1a776f40`, same host, same files alone                         | `deviceWorkerDarwin` **429 passed, 4 failed, 31 skipped** (the same four cases); `deviceWorkerLinux` **31 passed, 3 failed** plus one unhandled error (the same real-probe case and two more timing waits); `deviceWorkerHostNative` **1 passed, 6 failed, 13 skipped** (the same six). The join's host failures reproduce on the join-fix head alone. |

None of the host failures is in code the join changed. `devicesQrLoading`
imports only webview, shared and UI-fake modules, none of which the join-fix
touches, so for that suite the joined tree is byte-identical to W's tip. The
driver files pass on their own platforms' rigs on the same tree. W's record
already lists the Linux real-child wait as a host flake predating both lines.
The JFIX record already lists the native scheduled-task and macOS stress
timeouts on this host.

**Finding, predating both lines (not fixed here).** In
`src/host/backend/deviceWorkerLinux.ts`, the self-test's catch path calls
`await ignoreFailure(job?.remove())` (`:633`). `remove()` throws synchronously
while the job is unretired (`:582`), so the throw escapes the catch and
`selfTest()` rejects with `DeviceWorkerHostError('result')` instead of
resolving `false`. It is identical on the base `a4007f56c` (`:533`, `:580`),
on W and on JFIX. On this host, after the "caches a real per-factory probe"
case's 1 s wait timed out, it surfaced as an unhandled rejection. Left for the
lead: changing driver behaviour needs its own regression test and review.

### Gates (this worktree, `CI=true`, on the resolved tree)

| Gate                                                 | Exit                                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| five typechecks                                      | **0, 0, 0, 0, 0** (host 105 s, webview 65 s, unit 285 s, e2e 109 s, integration 46 s)                                                                                              |
| ESLint, full repository (`npm run lint:js`)          | **0** (`--max-warnings=0`, 2,581 s)                                                                                                                                                |
| `prettier --check .`                                 | **0**                                                                                                                                                                              |
| plain `npx knip`                                     | **0**, the same two configuration hints                                                                                                                                            |
| `npm run cycles`                                     | **0**, 885 modules, no cycle                                                                                                                                                       |
| `npm run duplication` (jscpd)                        | **0**, no clones                                                                                                                                                                   |
| `check:l10n`, `check:reference`, `check:host-api`    | **0, 0, 0** (198 manifest strings, 0 problems; 62 features, Devices 18 entries; 368 VS Code APIs, 0 problems)                                                                      |
| `check:plan`                                         | **1**: no such script in this repository or on `main` (npm "Missing script"); `teamPlanRecord.test.ts`, the test that reads `PLAN.md`: **exit 0, 2/2** with the PLAN line in place |
| `npm run build` (size, split, host globals, notices) | **0**: `dist/devices.js` **105.4 / 125 KiB**, `extension.js` 467.0 / 600, `main.js` + static imports 736.8 / 900, Devices QR 21.6 / 25, 89 notices; no cap changed                 |

`npm run quality` as one aggregate was not run here: its `test:unit` is the
whole suite, and this record runs the device suites per machine instead. The
aggregate run stays with W and the lead, as the final-join record says.

### Join completed and verified (lane M100JOIN resume, 2026-10-08 evening)

The merge above was left uncommitted when the host paused at 19:26. On
resume (20:28) the working tree held the resolution described above: no
conflict markers, W's record whole as a prefix of this file, the join-fix
record byte-identical after it, and `deviceWorkerHost.test.ts` equal to the
join-fix version plus W's selector hunk. It was committed unchanged as
merge **`8303ff76f`** (parents `aa31aabcf`, `d1a776f40`) with the installed
hooks (lint-staged ESLint and Prettier, gitleaks: no leaks). The tables
above were collected before the pause on snapshot `65c4d3e9a`; everything
below ran on the committed merge's tree. Model attempts **0**, inference
spend **0**.

#### Suites per machine (merge tree, default timeouts, `--maxWorkers=3`)

All 46 device and Devices files: every `device*`/`devices*`/`Devices*`
file plus `actionGrants`, `attemptJournal`, `commandRegistration` and
`windowsStorageProtection`.

| Machine                        | Run                                         | Result                                                                                                                                          |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubuntu (Linux, `rig-test.sh`) | the 45 non-harness files in one run         | **exit 0: 45 files, 1,648 passed, 39 skipped** (31 macOS-native, 7 Windows-native, 1 Windows-only manifest case); all 13 native Linux cases ran |
| Kubuntu                        | `devicesPhase2Harness`                      | **exit 0, 19/19** (42.7 s)                                                                                                                      |
| Windows host (this PC)         | the 45 non-harness files, 15 runs of three  | **all 15 exit 0: 1,643 passed, 44 skipped** (31 macOS-native, 13 Linux-native); all 7 native Windows scheduled-task cases ran                   |
| Windows host                   | `devicesPhase2Harness`, three runs          | **exit 0 ×3, 19/19 each** (20.9 s, 37.7 s, 33.7 s; host CPU 65 to 79% busy)                                                                     |
| Win11 VM                       | `devicesPhase2Harness`                      | **exit 0, 19/19** (57.9 s; readiness cases 1.19 to 1.41 s each). The base harness (`d1a776f40`) there: **exit 0, 16/16**, 1.76 to 2.42 s each   |
| macOS                          | the 31 native cases in `deviceWorkerDarwin` | not rerun on this tree: hosted macOS CI. The Mac mini passed `deviceWorkerDarwin` + `deviceWorkerHost` **507/507** on `65c4d3e9a` above         |

The host runs that failed before the pause (scheduled-task timeouts, macOS
fake-port stress cases, `devicesQrLoading`) all pass here with the host
less loaded; nothing in them changed.

#### Gates on the merge tree (Kubuntu, `CI=true`)

| Gate                                                          | Exit                              |
| ------------------------------------------------------------- | --------------------------------- |
| ESLint, full repository (`node eslint.js . --max-warnings=0`) | **0** (441 s); W had not rerun it |
| five typechecks (`npm run typecheck`)                         | **0** (181 s)                     |
| `format:check`                                                | **0**                             |
| `check:host-api`, `check:l10n`, `check:reference`, `cycles`   | **0, 0, 0, 0**                    |

#### The whole unit suite, run once by mistake: three real failures

A setup call for the ESLint slot passed `--version` to `vitest run`, which
vitest 5 does not treat as a version flag: it ran the entire unit and e2e
suite on Kubuntu alongside the device run (872 files: **858 passed, 6
failed**). It was not planned and is not a qualification run, but it found
three failures that the per-lane device sweeps never execute. Each was then
rerun on its own on the merge tree and on the unchanged base (the join-fix
head `d1a776f40`, whose webview, l10n and packaging equal `a4007f56c`):

1. **`browserUiText.test.mjs`, W regression.** Base passes 6/6; the merge
   fails "loads surface English on demand": `EN.devices` no longer throws
   before the Devices English chunk loads. Root cause: W added
   `export const DEVICES_STORAGE_DIR = 'devices'` to `src/shared/constants.ts`,
   a browser startup source. `browserTextKeys` (`scripts/lib/uiTextRegions.mjs`)
   treats any string literal equal to an English key in a startup source as an
   eager reader, so the whole `devices` table moved into the startup English.
   Proof: with only that literal changed in a rig copy, the test passes.
2. **`webviewBundle.test.mjs` FIXDIET1 startup baseline (733.8 KiB =
   751,411 bytes).** Base already fails at **751,541** (+130 bytes, before W).
   The merge measures **754,498**: **+2,400** from the eager `devices` table
   (item 1; 752,098 with the literal changed) and **+557** from W's
   `main.tsx` Devices mount code. `main` has the same baseline.
3. **`test/e2e/execStdio.e2e.test.ts`, 29 cases, base too.** The storage lane
   (`bdf5d1f19`) added `native/windows/MuseSparkDeviceStorage.cs` to
   `scripts/package-acp.mjs` `JOB_SOURCES` but not to this test's staged
   fixture (it writes only the two job sources), so every package guard fails
   with `ENOENT … copyfile 'native/windows/MuseSparkDeviceStorage.cs'`. CI
   also runs this file in the packaging job (`build.yml`). Fixed
   here in `5b370cf8d` (test fixture only, the third file written like the
   other two): Kubuntu **44/44**, against 29 failed without it on the merge
   and on the base.

The other three files (`usageRollup`, `usageIntegration`,
`vsixCompression`) failed by the 5 s test timeout while Kubuntu ran at load
18 on 10 cores; the base fails the same way at that load. They are load
results, not join results.

Items 1 and 2 are left for the lead: item 1 needs a choice between renaming
the unreleased storage folder, keeping host-only folder names out of the
browser-scanned constants, or teaching the collector to ignore them (AGENTS
rule 5 puts constants in `src/shared/constants.ts`); item 2 then needs either
a diet of about 3 KiB or a reviewed baseline. Neither cap nor baseline was
changed.

#### Leftovers: root causes

**Host Devices harness readiness (2.1 to 3.1 s against the 2 s bound).**
Measured with a read-only Playwright probe on this PC, same build, same
page and same 320 px dark scenes, timing each step in the page:

| Step (page clock, idle host)                                              | Time            |
| ------------------------------------------------------------------------- | --------------- |
| navigation, `main.js` and the 55 startup chunks fetched                   | 0 to 0.10 s     |
| the three Devices chunks (DevicesApp, QR encoder, QR figure) fetched      | 0.15 to 0.21 s  |
| module evaluation, table install, React mount, `devicesReady` posted      | 0.46 to 0.50 s  |
| harness `playScenario`: fixed 300 ms settle before the scene's first step | +0.32 s         |
| scene steps (fixture reply, card, any clicks) to `data-devices-ready`     | +0.05 to 0.19 s |
| ready                                                                     | 0.86 to 1.00 s  |

With the suite's own 2 s wait (Playwright then polls every 100 ms), the
test sees ready at **1.00 to 1.23 s** after `goto` with the host 65 to 87%
busy; under 3x renderer CPU throttling the page is ready at 1.16 to 1.54 s.
So the page's own work is about 0.6 s plus a fixed 0.3 s harness settle, and
the rest is CPU contention: the recorded misses came from runs on a loaded
host (the join record above notes 58 to 91% CPU from other sessions; on
Windows `vitest.config.ts` runs files one at a time, so the load was not the
suite's own).

The "2.1 to 3.1 s" figures overstate it. They came from runs with a
temporary 10 s deadline, and Playwright's `waitFor` backoff
(`retryWithProgressAndBackoff`: `[20, 50, 100, 100, 500]`, the 500 ms step
dropped only when it exceeds a fifth of the timeout) then polls every
500 ms, so readiness was detected up to 0.5 s late. At the real 2 s deadline
the last poll falls at about 1.9 s after `goto`.

The bound was not raised. Margin can be recovered without it: the Devices
surface already exists when `devicesReady` arrives, so `playScenario`'s
`whenFound(surface, …)` could probe at once for Devices scenes (the steps
already do since RVM100W2 5), which saves 0.3 s per scene. That is a
harness change for the lead's review, not made here.

**Lane U QR Retry module cache (RVM100W2 4).** Fixed by W in `aa31aabcf`:
a failed QR figure or encoder chunk now recovers by the guarded document
reload instead of re-importing the cached failed module. The real-Chrome
cases "recovers a refused encoder/figure chunk by reloading, never over a
waiting reply, keeping the draft" pass on Kubuntu, three times on this PC
and on the Win11 VM.

**`devicesPhase2Harness` file-level failure on Windows.** It does not
reproduce now: the base harness (`d1a776f40`) passes 16/16 on the Win11 VM,
and the merge passes there and three times on this PC. The failure is the
named 60 s `beforeAll` budget running out, and its cost is almost all the
synchronous production build (`execFileSync scripts/build.mjs --production`).
An instrumented copy of the suite (never committed) logged each hook step:

| Machine, run                                        | module load | `beforeAll` (build share)   | tests  | `afterAll` |
| --------------------------------------------------- | ----------- | --------------------------- | ------ | ---------- |
| this PC, warm                                       | 1.1 s       | 5.6 s (build 5.2 s)         | 13.7 s | 0.2 s      |
| Win11 VM, slot already used once                    | 1.6 s       | 8.3 s (build 7.8 s)         | 16.0 s | 0.2 s      |
| Win11 VM, first run in a fresh slot, uninstrumented | n/a         | about 35 s (by subtraction) | 15.0 s | n/a        |

A step-by-step probe agrees (VM: build 7.5 s, server 0.16 s, Chrome launch
0.24 s, QR probe bundle 2.4 s cold; Kubuntu at load 18: build 9.9 s). The
fresh-slot run spent 50.8 s in the file against 24.4 s for the warm one on
the same VM and tree, so the first production build after a checkout and a
fresh `node_modules` copy costs about four times a warm one there. That fits
Windows on-access scanning of newly written files (Defender's service is
running on the VM; it is off by policy on this PC) and a cold file cache.
Kubuntu's slots hard-link `node_modules` and have no scanner, consistent
with it never failing there. The recorded failures add load on top of the cold
build: the join-fix sweep ran on a VM shared with other lanes (its three-file
batches still run one file at a time on Windows), and this PC was then at 58 to 91% CPU with vitest itself timing out
starting workers. Hosted Windows CI runs this file in its test job right
after `npm ci` on a cold runner (`build.yml`: no build step before
`npx vitest run`), so it carries the cold-build part of the same risk. The 60 s
budget was not raised. Options for the lead: build once in a vitest global
setup or reuse a current `dist/` instead of rebuilding inside the hook.

The first readiness case after the browser starts (`devices-qr`, first in
`SCENES`) also pays the browser's first-page start-up: 2.6 s for the case
in the warm VM run against 1.2 to 1.3 s for the others, its 2 s wait
included. That is one more reason `devices-qr` misses first under load.

### Lead decisions on the open items (2026-10-08, 21:13 onward)

Same worktree and branch, hooks on, no push; no cap, baseline, readiness
bound or preparation budget changed; the 300 ms harness settle is unchanged.
Model attempts **0**.

**Gotcha (filed by the lead).** A shared constant whose string equals a
browser text group's name (here `DEVICES_STORAGE_DIR = 'devices'` in
`src/shared/constants.ts`) makes the l10n splitter
(`browserTextKeys`, `scripts/lib/uiTextRegions.mjs`) load that whole group
eagerly in the webview startup, silently: only `browserUiText.test.mjs` and the
startup byte baseline notice.

#### 1. Devices storage folder renamed (`DEVICES_STORAGE_DIR = 'device-storage'`)

The folder value is never released, so there is no migration. The constant
now says why it must never equal a text key. Every use follows it:
`extension.ts` already used the constant; `deviceProductionStorage` and
`deviceProductionWiring` now build their folders and the Windows stage-name
pattern (`.device-storage-<32 hex>.stage`) from `DEVICES_STORAGE_DIR` and
`DEVICES_HELPER_DIR` instead of literals. No user doc names the folder.

- `browserUiText.test.mjs`: **6/6** (it failed "loads surface English on
  demand" on the merge, passes on the base: that pair is the red/green
  drill). The startup-source scan finds **495** eager keys, `devices` not
  among them (496 with it on the merge), so the Devices English table is
  back in its own lazy chunk.

#### 2. Startup bytes: W's Devices mount moved into the lazy Devices chunk

None of W's `main.tsx` additions were first-paint code: the zod schema for
the saved draft, the draft store, the single `postMessage` callback and the
QR chunk loading run only for the Devices surface, and that surface's first
paint is the loading line it already showed before W. They now live in
`DevicesSurface`, exported from `DevicesApp.tsx` (the existing lazy chunk
entry); `main.tsx` is back to the base shape: one lazy import, the loading
fallback, `DevicesUnavailable` when the chunk fails. Two jsdom cases cover
`DevicesSurface` (saved draft restored and saved, QR chunks handed over,
exactly one `devicesReady`; an oversized saved state dropped and a refused QR
chunk reported at the QR spot). The `main.tsx` source check now also refuses
any of that logic in the entry (drill: W's `main.tsx` fails it).

| Webview startup (`webviewBundle` FIXDIET1 measure, bytes) | Value       |
| --------------------------------------------------------- | ----------- |
| review baseline 733.8 KiB                                 | 751,411     |
| base `d1a776f40`                                          | 751,541     |
| merge `8303ff76f` (eager `devices` table + W mount)       | **754,498** |
| after item 1 only                                         | 752,098     |
| after items 1 and 2                                       | **751,511** |

The merge's +2,957 over the base is gone (30 bytes under the base). The
baseline itself still fails by 100 bytes, as the base does; it was not
edited: the 0.17 integration lane re-pins it, and M100 is re-measured
against that when it merges after 0.17. Production build (Kubuntu): `main.js` + static imports **733.9 / 900 KiB** (736.8 on the merge), Devices webview chunk **41.8 / 50 KiB** (40.6; it now carries the mount), Devices QR 21.6 / 25, `dist/devices.js` 105.4 / 125; no cap changed.

#### 3. One shared production build per run (vitest global setup)

`test/unit/productionBuild.ts` (registered as `globalSetup` in
`vitest.config.ts`) runs `scripts/build.mjs --production` once, before any
file starts and outside every hook deadline, only when the run selects a
suite that serves `dist/` (`devicesPhase2Harness`, `teamHarness`), and
provides `productionBuild` to the suites. Both suites dropped their own build
and refuse with "No shared production build in this run" when it is missing;
`teamHarness` keeps its pseudo-locale step. A run without those suites
skips the build (`productionBuild.test.ts`, 2/2, covers the selection with
either path separator). The 60 s preparation budgets and the 2 s readiness
bound are unchanged; the build has its own named 10-minute bound so a hung
build fails the run with its output. Drill: with `globalSetup` emptied the
Devices harness fails at file level with that refusal; restored, 19/19.

`devicesPhase2Harness` preparation, before and after (instrumented copy,
never committed):

| Machine, slot                    | `beforeAll` before (build inside) | `beforeAll` after | file result       |
| -------------------------------- | --------------------------------- | ----------------- | ----------------- |
| this PC, warm                    | 5.6 s (build 5.2 s)               | **0.45 s**        | 19/19 ×3          |
| Win11 VM, cold (fresh slot)      | about 35 s                        | **0.84 s**        | 19/19, copy 19/19 |
| Win11 VM, warm (same slot again) | 8.3 s (build 7.8 s)               | **0.53 s**        | 19/19, copy 19/19 |

On the VM the cold run was a fresh slot (new checkout and `node_modules`
copy; snapshot `62c991e8`, the four items before the lint-only test
refactors) and the warm run the same slot again on the committed tree
(`eff4fd60`). Each ran the instrumented copy and the real suite together:
**38/38** both times (68.9 s and 47.7 s for the run, global build
included); the readiness cases took 1.20 to 1.94 s cold and 1.22 to 2.23 s
warm, page start and close included, every 2 s wait met. The hook's 60 s budget now covers well under a
second of work on either machine. On this PC there is no colder state to
measure: its `node_modules` is long-lived and Defender is off by policy.

#### 4. Linux self-test answers false, never a rejection

`deviceWorkerLinux.ts`: the self-test's cleanup now catches `remove()`'s
synchronous refusal for an unretired probe job, so the job keeps its slot
and `selfTest()` resolves `false`. New case "answers false, never a
rejection, when a probe fails with its job unretired" (real probe child,
inhibitor lost while the cgroup is still populated). Drill: with the old
`await ignoreFailure(job?.remove())` the case fails, "promise rejected
… { reason: 'uncertain', detail: 'result' } instead of resolving"; with the
fix it passes, and the cached second self-test also answers `false`.

#### Verification

Kubuntu, one run of the working tree as committed up to `a97163630`, less
the helper commit `09eba821a` (which only restructures two of the new
tests; both rerun green on this PC), snapshot `17712e60`, `--maxWorkers=3`,
default timeouts: the 46 device and Devices
files plus `teamHarness`, `browserUiText`, `webviewBundle` and
`productionBuild`, 50 files: **49 passed; 1,736 tests passed, 1 failed, 39
skipped**. The one failure is the FIXDIET1 baseline above (751,511 against
751,411), left for the 0.17 re-pin. `devicesPhase2Harness` 19/19 and
`teamHarness` 23/23 ran on the one shared build; `deviceWorkerLinux` 36/36
natively, the new case included. Gates on the same content there (snapshot `5472e663`): five
typechecks, `format:check`, `check:host-api`, `check:l10n`,
`check:reference`, `cycles`, plain `knip` (the same two configuration hints)
and the production build with caps all **exit 0**; `duplication` exit 1 on
two clones in the new tests, fixed in `09eba821a` (0 clones after).
ESLint `--max-warnings=0` on every changed file: exit 0.

This PC, natively: `DevicesApp`, `deviceProductionWiring`,
`deviceProductionStorage` 50/50; `deviceWorkerLinux`, `DevicesApp`,
`productionBuild` 60/60 (58/58 after the helper commit); `devicesQrLoading`,
`devicesPhase2Views`, `DevicesView` 111/111; `browserUiText` 6/6;
`teamHarness` 23/23 (40.0 s) on the shared build; `devicesPhase2Harness`
19/19 in three runs (one instrumented). `webviewBundle` fails only the same
baseline case, with the same 751,511 bytes as Linux.

### RVM100J2 review fixes (2026-10-08, 21:45 onward)

Codex review RVM100J2 (MacBook, macOS 15.7.9) ran the macOS device sweep,
**1,786 passed** with the Darwin-native group green, and found one P2 and one
P3. Both are fixed; no timeout, budget or bound changed.

**P2: the shared build's proof outlived watch reruns.** Vitest keeps a
global setup for the whole watch session, so after a source edit a rerun
accepted the first run's build. Now:

- the global setup registers `project.onTestsRerun` and builds again
  whenever a rerun selects a serving suite (a rerun without one provides no
  proof);
- the proof is no longer a flag but the generation it was built from: a
  SHA-256 over the path and bytes of every tracked build input (`src`,
  `scripts`, `l10n`, `vendor`, `native`, `media`, `resources`, `skills`,
  `first-party-skills`, the package, lock, NLS and tsconfig files, the
  notices), computed after the build (about 0.1 s here);
- both harnesses call `assertCurrentProductionBuild` in their preparation:
  no proof refuses with "No shared production build in this run", a proof
  from other sources with "Stale shared production build: its sources
  changed after this run built it".

Regressions in `productionBuild.test.ts` (5/5): generation A, an edit, no
rebuild, is refused, and accepted again once rebuilt; a rerun that selects
a serving suite builds again and provides the new generation, a rerun
without one builds nothing. Drills, each restored after: without the
`onTestsRerun` registration the rerun case fails ("expected to be called 2
times, but got 1 times"); with the comparison removed the A to B case fails
("expected [Function] to throw").

**P3: portable self-test fixtures polled for the probe's exit.** Both probe
cases waited for the real probe child with `vi.waitFor`'s 1 s default and
failed on the loaded Mac at 1,003 to 1,014 ms. The Linux fixture now keeps
the first worker child's own `exit` event and the shared `probing()` helper
awaits it, bounded by the case's own deadline (unchanged). Drill: with the
probe child slowed to 1.2 s, the old poll fails both cases at 1,011 and
1,023 ms with the Mac's signature ("expected null to be +0"); the event wait
passes both; restored, 36/36.

Results: this PC, `productionBuild` + `deviceWorkerLinux` 41/41 and
`devicesPhase2Harness` 19/19 on the generation-checked build. Kubuntu,
`productionBuild`, `deviceWorkerLinux`, `deviceWorkerHostNative`,
`devicesPhase2Harness`, `teamHarness` in one run: **96 passed, 7 skipped**
(Windows-native), exit 0; `typecheck:unit`, `duplication` (0 clones) and
plain `knip` exit 0 there. ESLint `--max-warnings=0` on the changed files:
exit 0.

The review's caveat stands as recorded, not changed here: an unsharded
whole-suite run lets `webviewBundle.test.mjs` rebuild webview chunks into
the same `dist/` the Chrome suites serve; the hosted shard placement keeps
them apart today.
