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
- Manual entry connects with discovery fully blocked. Test:
  `deviceDiscoverySwitch.test.ts` › "pairs over typed text while multicast
  stays denied and silent" (the mDNS port denies every open while pairing
  over typed text succeeds).
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

## Lane 0 re-review (RVM100P2L0B): the byte cap counts UTF-8 bytes

The re-review confirmed the six fixes and found one P2: `deviceCapabilitySchema` compared `JSON.stringify(value).length` (UTF-16 code units) with `capabilityBytes`, so an advertisement of 64 tool names padded with U+4F60 was 5,893 code units but 15,801 UTF-8 bytes and parsed. The refine now measures `new TextEncoder().encode(JSON.stringify(value)).byteLength`, as `tableArchive.ts` does.

- Test: "counts the byte cap in UTF-8 bytes, not string length" (string length under the cap, UTF-8 bytes over it, parse refused); the existing fixture check now measures UTF-8 bytes.
- Drill: with the previous schema the new test fails (1 failed, 35 passed); with the fix 36 passed. `devicePhase2Contracts` and `devices` together: 130 passed.
- ESLint (`--max-warnings=0`), Prettier and `tsc -p tsconfig.json` clean on the host, 2026-10-07.
