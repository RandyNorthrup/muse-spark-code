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
