# M117 C-M117-3 certification — estimator fleet binding (2026-10-11, kubuntu)

Lane CM1173, branch `c/m117-3`, base `7d0410526` (c/m117-1 round 4).
R2 fixes review RVCM1173 (all four findings) in the lane's files plus the
two production call sites `src/extension.ts` and
`src/runtime/estimator/ports.ts`.

## What was built (R2)

- `src/host/estimator/fleetBinding.ts`:
  - `applyFleetBinding(base, io)` is async; every reader may resolve
    synchronously or as a promise, and readers run at fleet-call time, once
    per `fleet`/`candidatePool` call (proven by test).
  - M107 `capacityCaps` set the percent fields AND derive admission:
    `fleetSlotsForCaps(cores, cpuMax, memMax)` (ceil of cores scaled by the
    tighter ceiling; a nonzero ceiling keeps the serial lane, a zeroed one
    forecasts zero slots) drives `governorSlots`, `caps.slots`,
    `capacityByKind` and the `local-N` slot rows. The same two 1-hour lanes
    finish in 2 h under 1/1 and 1 h under 100/100 on an 8-core fleet.
    The governor's live `capacity()` is deliberately not sampled: a forecast
    predicts configured capacity (D97 acceptance 2).
  - M108 `accounts` takes the pre-selected ACTIVE row or undefined
    (`FleetAccountDraft`; an absent rate inherits the measured demand budget
    for that one dimension). Zero accounts or no usable limits keep the
    measured row — never a `fleet-accounts-ambiguous` refusal for a normal
    multi-account user. `selectFleetAccount` (active wins, else first by
    order) and `fleetAccountFromLimits` (sustainable allowance rates plus
    measured-remaining rolling windows; depleted waits for reset; blocked
    pins zero; expired/absent yields undefined) run against the real
    `Account`/`AccountLimitsReader` shapes.
  - CI `ci` rows pass through validated. No captured shape names a
    concurrency limit (AGENTS.md rule 14), so production carries no CI row
    and a lane declaring CI demand refuses with the schedule's true reason
    (`unschedulable:<lane>`).
  - Every override re-parses through `fleetSnapshotSchema`; a corrupt row
    refuses named (`fleet-caps-invalid`, `fleet-account-invalid`,
    `fleet-ci-invalid`), never a raw `$ZodError` and never a widened fleet.
    Corrupt workspace settings refuse as `fleet-caps-invalid`.
- `src/host/estimator/localFleet.ts`: `fleet` and `candidatePool` await the
  binding. With no readers the fleet is byte-identical to the certified row.
- `src/extension.ts:2367`: passes `fleetIo` built by `extensionFleetSources`
  over the live workspace configuration (`readResourceSettings` with the
  configuration's own `inspect`, so the test proves the exact keys). The M108
  registry is not instantiated in the extension host and no captured shape
  names CI concurrency, so those stay absent with the measured row and the
  schedule's true refusals standing in (named in code).
- `src/runtime/estimator/ports.ts:39`: passes `fleetIo` built by
  `headlessFleetSources` — the configured defaults (85/90) through the same
  settings contract; networked `gh` reads stay off (M80, D65).
- Device/node rows: absent, never guessed. GPU-requiring and device-class
  lanes have no runnable machine (their true reason).
- No new user strings (existing `estimateFailed` details only), no commands,
  settings, dependencies or cap changes. No `eslint-disable`, no cast, no
  `any`.

## Tests (repository timeouts, never `--testTimeout`)

`test/unit/estimatorFleetBinding.test.ts`, 20 tests, all passing on kubuntu:

- Default binding reproduces the measured fleet exactly (async).
- `asOf` passthrough through the real `fleet` and `candidatePool` ports;
  both ports agree.
- Slots derivation unit table (8/100/100→8, 85/90→7, 1/1→1, 0/0→0,
  out-of-range and zero-core refuse).
- M107 caps apply (percents, governor/cap/kind slots, 6 slot rows) and
  out-of-range ceilings refuse (`fleet-caps-invalid`).
- Finish-time shaping: two 1-hour lanes finish in 2 h under 1/1, 1 h under
  100/100, through the real port plus `prepareEstimateSchedule`.
- Active-row rebind incl. usage windows; undefined keeps the measured row
  (no ambiguous refusal).
- Corrupt account row → `Estimate failed: fleet-account-invalid`; account
  draft without a rate on a fleet without accounts → same (fail-closed).
- CI rows carried; `occupiedJobs > concurrentJobs` →
  `Estimate failed: fleet-ci-invalid`.
- Selector: 0→undefined, 1→it, N→first, active honoured, unknown active
  falls back to first.
- Translator: buckets→rates/windows values; expired buckets dropped; empty
  limits→undefined; blocked→zero rates; broken clock refuses.
- Extension sources: the 8 real settings keys are read (spy), 50/50 caps
  flow to a 4-slot fleet, corrupt settings refuse.
- Headless sources: 85/90 defaults flow to a 7-slot fleet on 8 cores.
- Composition: all three sources through the real fleet port to one
  forecast — each source read once; caps shape slots; the depleted window
  pins the forecast past the reset (`finishHours > 2`) with an `accountRate`
  bottleneck; the CI row is carried.
- Device/node absent with true reason; machines bottleneck on the serial
  row; CI over-commit refuses `unschedulable:A` while fitting rows finish in
  1 h; a binding rate refuses `unschedulable:A` while the budgeted row
  finishes in 1 h; async readers run once per call on both ports.

Neighbour suites green: `estimatorLocalFleet` (5), `estimatorBottleneck`
(9), `runtimeEstimatorPorts` (8) — 22 tests.

## Red drills (byte-exact restore, SHA-256)

Pre-drill:
`176fa28902030765d3c9c88eb3ede21ca5e94107060582269685f4b0d601046c`
fleetBinding.ts,
`09b6634cad666106e056e7e7fc858ab19788a9febf50c9a780c917d89eb9d7b2`
estimatorFleetBinding.test.ts.

1. Replaced the final `fleetSnapshotSchema.safeParse` with an
   always-successful stub: `carries CI concurrency rows and refuses a
corrupt one with a named detail` failed (corrupt row passed through).
   Restored; hash matches.
2. Weakened caps validation to a bare finiteness check: `applies M107's
configured caps and refuses ceilings it cannot honour` failed
   (`fleet-binding-invalid` instead of `fleet-caps-invalid`). Restored; hash
   matches.
3. Forced `parallel = 1` (the old hard-coded serial row): `finishes the same
lanes at a different time under 1/1 than 100/100` failed (`expected 1 to
be 8`). Restored; hash matches.
4. Translated buckets at the remaining rate instead of the allowance rate:
   `drives all three sources through the real fleet port to one forecast`
   failed (`unschedulable:A` — the rate check bound permanently instead of
   waiting for the reset). Restored; hash matches.

Post-drill suite: 20/20 green at repository timeouts.

## Review pass by class (corrections to the R1 record)

- Validation/security: reader rows re-parsed with named details; no
  credentials, paths or network in the binding (no file reads, no `gh`, no
  handles). R1's claim that "slots/rate/CI cannot be named on a one-slot
  fleet" is superseded: slots are now derived, and rate/CI rows bind
  fail-closed with their lane.
- Failure paths/honesty: corrupt/ambiguous readers refuse with named
  details; missing CI/device rows refuse via existing schedule reasons;
  unknown account windows stay disclosed as unknown, never zero; zero
  accounts keep the measured row.
- Concurrency/lifecycle: async overlay, no shared state; ports stay
  `(lanes, asOf)`-pure with the request stamp passed through; readers run
  once per call.
- Docs: CHANGELOG `[Unreleased]` (R2 entry), PLAN.md C-M117-3R2 record, this
  file. R1's recorded drill hashes did not match the committed bytes
  (finding 4); R2 hashes above are `sha256sum` of the working files at drill
  time, verified byte-exact after each restore.

## Open for the lead

- Production carries no account row: the M108 registry (store, limits
  reader, active selector) is not instantiated in the extension host, and
  headless estimator ports have no providers path or keyring in their deps.
  The selection (`selectFleetAccount`) and translation
  (`fleetAccountFromLimits`) run against the real store/reader shapes and
  are proven with fakes; the accounts owner plugs in a constructed store.
- Production carries no CI row: no captured wire shape names a concurrency
  limit or occupied count (rule 14); the port, the named refusal and the
  over-commit test are ready for the milestone that captures one.
- `npm run build` exits 1 on the pre-existing webview estimator-panel OVER
  (25.3 KiB vs 25 KiB budget) — reproduced at pristine HEAD `768259f23` in
  a clean worktree, so not this lane's. `dist/extension.js` 554.1 KiB
  (budget 600, +1.6 KiB over HEAD's 552.5), `dist/modelApi.js` 515.8 KiB
  (budget 525, unchanged).
- Restore list (0.17.1 truth pass): nothing in this lane's scope was
  removed or hidden — no release text, command, setting or Help row to
  restore. No Help row added (no new command, setting or surfaced feature).
- Editors/OS: no UI changed; the binding runs wherever the estimator runs
  (extension, ACP/headless). No file-path comparison in this code; slot ids
  are constructed (`local-N`), never matched. Cross-rig and a11y remain
  lead-owned.

---

# Round 3 (2026-10-11, kubuntu): redesign on the real contracts (review RVCM1173B)

Commit `34c661efd` (machine capacity, settings, account and CI binding)
plus the composition tests below. The estimator never computes a fleet
number: `fleetSlotsForCaps` is deleted, and every test that pinned its
invented counts is deleted with it (listed below). Three P2 and two P3
fixed as classes; every finding has a failing-then-passing test and a
byte-exact red drill.

## Surface table (new state)

| Surface         | Entry                                                                                              | Machine capacity                                                                        | Settings source                                                                                                                                       | Accounts                                                                                                                                                                                                                                                                  | CI                     |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| VS Code panel   | `src/extension.ts` `estimatorSourcePorts` ← `fleetIoFromSources(extensionFleetSources({inspect}))` | Certified one serial slot; live thresholds as caps facts; nothing with the governor off | Live workspace configuration (`readResourceSettings` over the configuration's own `inspect`)                                                          | `unknown: no account reader in this editor` (typed seam; the panel reads the AccountStore registry and static capability names, live usage sits on the backend's account home, and `MuseCodeAccountHomes` is never constructed in production, so no limits reader exists) | `ci unknown: not read` |
| CLI `estimate`  | `src/runtime/main.ts` `runRuntimeEstimateCommand` ← `runtimeEstimatorPorts`                        | Same one slot; same facts/off rule                                                      | The headless governor's own `resourceMachineStore` over `<agent data>/resources.json` (missing file: schema defaults; present file: configured value) | Registry identity (`meta` account named, limits unknown) or `unknown: no account reader in this runtime`                                                                                                                                                                  | `ci unknown: not read` |
| ACP `/estimate` | `src/runtime/main.ts` `createRuntimeEstimate` ← the same ports                                     | Same                                                                                    | Same file and reader as CLI (the ACP agent's `resources` object shares the agent data folder)                                                         | Same as CLI                                                                                                                                                                                                                                                               | `ci unknown: not read` |

No fourth assembly calls `estimatorSourcePorts`. On CI templates: no
repository reader exists — the only `concurrentJobs`/`occupiedJobs`
mentions in `src` are the fleet schema, this binding and the schedule that
consumes them; no producer reads them from anywhere.

## Finding → fix → test → drill

1. P2, throttle thresholds as parallelism (`fleetBinding.ts:133`): deleted.
   Slots stay the certified 1 on every surface; thresholds ride
   `caps.cpuPercent/memoryPercent` as read facts (the schedule never reads
   them for admission). Governor off keeps the certified row. Tests:
   `states the throttle thresholds as facts and never writes a slot count`,
   `keeps the certified row with the governor off or no reading`,
   `refuses a corrupt machine reading with fleet-caps-invalid`
   (production reader shape). Drill D1: hardcoded `cpuPercent: 85` —
   4 failures (snapshot sharing, threshold facts, extension keys, headless
   resources.json). Deleted pins: `fleetSlotsForCaps` unit table
   (8/100/100→8), caps-shaping-admission (6 slots), the 1h-vs-2h finish
   split.
2. P2, CLI/ACP package defaults (`ports.ts:59`): `createRuntimeEstimate`
   and `runRuntimeEstimateCommand` now receive `machineDir` plus the
   registry, and `runtimeEstimatorPorts` builds the governor's own
   `resourceMachineStore` over it. Tests: `reads headless settings through
the governor resources.json reader` (missing→85/90 defaults, CPU
   40→40, off→certified, malformed→`fleet-caps-invalid`) and the CLI/ACP
   composition tests below. Drill: D1's hardcoded 85 fails the 40/50
   assertions through the same assembly.
3. P2, demand-sized account rate (`fleetBinding.ts:361`): the translator
   takes the owner's raw snapshot; `planWindows` with a captured duration
   shape fixed rolling windows over that period (short window
   `windowDurationMins`, now carried by `accountHomes.read`); any other
   percent window is stated; a full window with no read rate refuses as
   `fleet-account-blocked` naming the reset, with a read rate it waits
   behind a zero-remaining window (`accountRate` bottleneck); unread rates
   record `local:requestsPerMinute` (schema now optional) instead of
   passing against demand. Tests: translator shape/stated/skip/enforce/
   blocked quartet plus the seam and registry rows. Drills D2 (no-reader
   keeps the demand row — 2 failures) and D4 (precheck removed —
   `Estimate failed: unknown-demand:A:percent`, the review's exact probe
   error). Deleted pins: rolling plan window over the time remaining,
   zeroed blocked rates, undefined-reader-keeps-demand-row, the
   demand-rate `unschedulable:A` schedule pin.
4. P3, error blame (`fleetBinding.ts:200`): each source re-parses on its
   own on the production reader shape (base structure first, then machine,
   account, CI). Test: `names the account source on the production reader
shape, never the CI row`. Drill D3 (account parse skipped): the corrupt
   account reports `fleet-ci-invalid` — 1 failure.
5. P3, double fleet read (`localFleet.ts:125`): fleet and candidate pool
   share one memoised snapshot per estimate. Test: `derives the current
fleet and the candidate pool from one snapshot` (one read; re-read on a
   new estimate). Drill D5 (memo bypassed): readers run twice — 1 failure.

## Composition tests (production assemblies, fake owners, real readers)

- VS Code panel assembly (`estimatorFleetBinding.test.ts`, `reads the
extension host's real settings keys`): the 8 real settings keys are
  read; 50/50 caps land on the 1-slot fleet with the editor seam row;
  governor-off keeps 100/100; corrupt settings refuse. Fails without its
  binding per D1/D2.
- CLI `estimate` (`runtimeEstimatorPorts.test.ts`): a scratch agent-data
  folder behind the real `resourceMachineStore` — missing file→85/90,
  CPU 40→40, then 50 after the owner rewrites it, off→100/100,
  malformed→exit 1 with `estimate-unavailable` (no byte leak) — plus the
  registry row. Fails without its binding per D1 (same assembly).
- ACP `/estimate` (same file): `createRuntimeEstimate` with a scratch
  folder — 40 lands with the registry row, 60 after the rewrite. Same
  assembly as CLI (`portsWith` → `runtimeEstimatorPorts`); fails without
  its binding per D1.
- Skipped by lead order: `reads the active account limits through the
panel reader` (`it.skip`) names the unbuilt binding; the passing seam
  tests pin the unknown rows until it lands.

## Red drills (byte-exact restore, SHA-256)

Pre-drill (committed tree at `34c661efd`):
`db012be0aa0520a836d755039ec1e02b5e82c5efed655cebea6f2c7c6bb1f904`
fleetBinding.ts,
`88550b02664cf8977074235b6f27570d8fbb2a4ba6f4b2f475dc80a6a34b7bca`
schedule.ts,
`17f7c6453c121c6262c97d52c2239339f1e4a9978dbcc6dcecd1699e0bd54d66`
localFleet.ts.
Test files at drill time:
`7c45915be554411b3093fe788ade88cf515f2832002ed517bc9f63e3c944e5f2`
estimatorFleetBinding.test.ts,
`8c475f1a98e8a5cec01f240048503c01f31fc698b503dcb01168ba707c9c82d6`
runtimeEstimatorPorts.test.ts,
`b1a1faba55cea7c60e914677a2fbc37ef62c99d0f3775ae8bcb27580e75f5c04`
accountHomes.test.ts.

- D1, ignore the owner's reading (hardcode `cpuPercent: 85`): 4 failures
  listed above. Restored; hash matches.
- D2, no-reader seam keeps the demand row: 2 failures (seam markers,
  extension composition). Restored; hash matches.
- D3, skip the account re-parse: corrupt account reports
  `fleet-ci-invalid`: 1 failure. Restored; hash matches.
- D4, remove the percent skip: `Estimate failed: unknown-demand:A:percent`:
  1 failure. Restored; hash matches.
- D5, bypass the fleet memo in `candidatePool`: readers run twice:
  1 failure. Restored; hash matches.

Post-drill: binding 24 passed + 1 lead-ordered skip, ports 10 passed,
schedule/bottleneck/localFleet 61, contracts/simulate/recommend 103,
accountHomes 52, thresholds/pool/accountUsage 69, acpEstimate/
estimateCommand 27 — all at the repository default timeout, never
`--testTimeout`. `accountHomes` carries the short-window duration into
the snapshot (new test).

## Gate figures (exact bytes)

- `dist/estimator.js`: 69,555 B — ok (budget 75 KiB).
- `dist/planSnapshot.js`: 68,699 B — ok (budget 75 KiB).
- `dist/extension.js`: 570,135 B — ok (budget 600 KiB; +2.7 KiB over R2's
  554.1 KiB figure: the binding rewrite).
- `dist/acp.js`: 251,325 B — ok (budget 850 KiB).
- `dist/modelApi.js`: 528,216 B — ok (budget 525 KiB, unchanged).
- Estimator panel chunk: 25,908 B total — OVER the 25 KiB (25,600 B)
  budget by 308 B. Pre-existing (identical 25.3 KiB figure at R2 and at
  pristine HEAD `768259f23`): `FJ4L3LOG.js` 861, `DHQ2E5ND.js` 9,427,
  `THYGJREI.js` 11,214, `UP3UIL7H.js` 2,453, `2C6CMX2H.js` 140,
  `UWAEJOB6.css` 1,813. No estimator row was added or changed this round
  (`EstimatorPanel.tsx` untouched; unknown rows render through the
  existing uncertainty line), so the chunk is reported, not trimmed.
- No new UI strings: unknown rows are technical splices rendered under
  the existing `estimateUncertainty` label. `check:l10n` 0 problems;
  `check:reference` current; `check:host-api` 0 problems; knip and jscpd
  clean; `typecheck` (host) and `typecheck:unit` clean; eslint and
  prettier clean on every touched file.
- `npm run build` exits 1 only on the pre-existing panel OVER above.

## What remains (for the lead)

- No live account-limits reader exists on any surface: the skipped panel
  test names it. Wiring a real one means constructing
  `MuseCodeAccountHomes` (capture, CLI version, storage root, owner-only
  dir) in the extension host or the headless process and feeding it
  `usage/changed` observations — a cross-milestone change, not a binding
  tweak.
- Blocked-without-rate refuses instead of waiting: the post-reset rate is
  unknowable from a percent snapshot, so the forecast names the reset and
  stops. A future rate-carrying snapshot would flow through the existing
  zero-remaining window path with no binding change.
- The forecast cannot data-distinguish 85/90 schema defaults from
  85/90 configured values: both are the governor's real thresholds and
  both ride the caps identically. A data-visible origin marker would need
  a fleet-schema field.
- The throttled-state second scenario was declined: at throttle the
  governor's own capacity is 1, identical to the certified serial slot,
  so a second scenario would duplicate the main one.
- `fleet-account-blocked` and other fleet details surface end to end as
  `estimate-unavailable` (`estimateFailureText` allowlists
  `estimateDiagnostic` only): the names exist at the ports level and in
  the JSON evidence path, but the CLI/ACP text does not carry them.
- Browsers, integration tests and a11y stay lead-owned (lane sandbox).
