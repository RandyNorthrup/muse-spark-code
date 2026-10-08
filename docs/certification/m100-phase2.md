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
