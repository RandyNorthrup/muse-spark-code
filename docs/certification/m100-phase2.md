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

## Lane 0 re-review (RVM100P2L0B): the byte cap counts UTF-8 bytes

The re-review confirmed the six fixes and found one P2: `deviceCapabilitySchema` compared `JSON.stringify(value).length` (UTF-16 code units) with `capabilityBytes`, so an advertisement of 64 tool names padded with U+4F60 was 5,893 code units but 15,801 UTF-8 bytes and parsed. The refine now measures `new TextEncoder().encode(JSON.stringify(value)).byteLength`, as `tableArchive.ts` does.

- Test: "counts the byte cap in UTF-8 bytes, not string length" (string length under the cap, UTF-8 bytes over it, parse refused); the existing fixture check now measures UTF-8 bytes.
- Drill: with the previous schema the new test fails (1 failed, 35 passed); with the fix 36 passed. `devicePhase2Contracts` and `devices` together: 130 passed.
- ESLint (`--max-warnings=0`), Prettier and `tsc -p tsconfig.json` clean on the host, 2026-10-07.

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
| Re-dispatch from the last acknowledged checkpoint   | `reconnect.ts:108`, derives checkpoint from parsed accepted/duplicate acks no later than the expired epoch                                                              | `deviceReconnect`: ignores quarantine; refuses missing/future acknowledged checkpoints                                                     | R6                                  |
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
takes envelopes/acks and derives its checkpoint, rather than accepting an
unproved digest. The result store must atomically persist the full bounded
receipt record before resolving a save, reject unavailable or corrupt
initialized storage, and return undefined only for a genuinely new attempt.
The portable lane adds no installed listener, physical executor or storage
adapter: lane W owns wiring and installed-host qualification. README,
CHANGELOG, feature catalog and the complete joined-tree `npm run quality`
remain with lane W as assigned by PLAN, not a claim of this lane's certification.

Lead request: regenerate `docs/ide-compatibility/host-api.md` in lane W
with `npm run check:host-api -- --write` (the expected change on this base is
`node:crypto` imports 55 to 56). No shared-contract change is requested.
