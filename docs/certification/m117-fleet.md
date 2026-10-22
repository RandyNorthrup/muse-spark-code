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
  (`fleetAccountFromLimits`) run against the real store/reader shapes with
  schema-valid fixtures through the committed suites; the live registry
  plugs in at M108.
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

| Surface         | Entry                                                                                              | Machine capacity                                                                        | Settings source                                                                                                                                       | Accounts                                                                                                                                                                                                                  | CI                     |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| VS Code panel   | `src/extension.ts` `estimatorSourcePorts` ← `fleetIoFromSources(extensionFleetSources({inspect}))` | Certified one serial slot; live thresholds as caps facts; nothing with the governor off | Live workspace configuration (`readResourceSettings` over the configuration's own `inspect`)                                                          | R3 left the existing usage/read and usage/changed owners unbound and emitted an unknown editor row; R4 binds those owners. `MuseCodeAccountHomes` is not constructed in production and is not required for these readers. | `ci unknown: not read` |
| CLI `estimate`  | `src/runtime/main.ts` `runRuntimeEstimateCommand` ← `runtimeEstimatorPorts`                        | Same one slot; same facts/off rule                                                      | The headless governor's own `resourceMachineStore` over `<agent data>/resources.json` (missing file: schema defaults; present file: configured value) | Registry identity (`meta` account named, limits unknown) or `unknown: no account reader in this runtime`                                                                                                                  | `ci unknown: not read` |
| ACP `/estimate` | `src/runtime/main.ts` `createRuntimeEstimate` ← the same ports                                     | Same                                                                                    | Same file and reader as CLI (the ACP agent's `resources` object shares the agent data folder)                                                         | Same as CLI                                                                                                                                                                                                               | `ci unknown: not read` |

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
- R3 skipped `reads the active account limits through the panel reader`.
  R4 restores it as a passing usage/read composition regression.

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
  budget by 308 B. Correction from RVCM1173C: 258 B existed at base b026dfdd8 and R3 added
  50 B through shared account validation; the aggregate was not byte-identical. Components: `FJ4L3LOG.js` 861, `DHQ2E5ND.js` 9,427,
  `THYGJREI.js` 11,214, `UP3UIL7H.js` 2,453, `2C6CMX2H.js` 140,
  `UWAEJOB6.css` 1,813. No estimator row was added or changed this round
  (`EstimatorPanel.tsx` untouched; unknown rows render through the
  existing uncertainty line), so the chunk is reported, not trimmed.
- R3 incorrectly classified explanatory sentences as technical splices.
  R4 moves all explanations into translated runtime templates. `check:l10n` 0 problems;
  `check:reference` current; `check:host-api` 0 problems; knip and jscpd
  clean; `typecheck` (host) and `typecheck:unit` clean; eslint and
  prettier clean on every touched file.
- `npm run build` exits 1 only on the pre-existing panel OVER above.

## What remains (for the lead)

- R3 left existing usage/read and usage/changed readers unbound. R4 binds
  them without constructing MuseCodeAccountHomes; standalone CLI has only
  registry identity because no backend is running.
- R3 discarded full windows and invented bucket refill rates. R4 retains
  the owner's captured windows and initial admission separately from rates.
- R3 discarded settings origin. R4 carries per-threshold provenance.
- The throttled-state second scenario was declined: at throttle the
  governor's own capacity is 1, identical to the certified serial slot,
  so a second scenario would duplicate the main one.
- `fleet-account-blocked` and other fleet details surface end to end as
  `estimate-unavailable` (`estimateFailureText` allowlists
  `estimateDiagnostic` only): R3 details existed at the ports level only. Refused estimates have no JSON
  evidence document. R4 carries validated diagnostics through shared formatting.
- Browsers, integration tests and a11y stay lead-owned (lane sandbox).

---

# Round 4 (2026-10-11, kubuntu): RVCM1173C owner constraints

The initial regression suite failed 23 checks before repair. The provenance
regression separately failed before the owner origin was carried. No model
attempt, credential access, install, merge, push, hook substitution or cap
increase occurred. Full quality remains lead-owned under the rig/common brief.

| Finding | Fix                                                                                                            | Regression in estimatorFleetReview.test.ts                                         | Drill                            |
| ------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| 1       | Bind backend usage/read and the UI's live usage/changed recording; standalone CLI reads registry identity only | real recording on panel/ACP; restored panel reader test                            | D1                               |
| 2       | Current allowance/reset, future refill/rate unknown; no rate from time remaining                               | same bucket at minutes 0/50                                                        | D2                               |
| 3       | Full captured percent window retains 100% allowance and its period after initial reset                         | full three-hour lane ends at 19:20, not 16:00                                      | D3                               |
| 4       | Initial admission uses latest simultaneous reset                                                               | state/reset/vendor table, later vendor and later plan window                       | D4                               |
| 5       | Full unknown reset refuses, never becomes absent                                                               | full/null/vendor table                                                             | D5                               |
| 6       | Raw owner schema validates before translation; registry errors retain owner code                               | malformed limits; metadata unavailable                                             | D6, D6b                          |
| 7       | Invocation-owned memo shared only by that request's fleet and candidate pool                                   | overlapping estimates, equal and unequal timestamps                                | D7                               |
| 8       | CI uncertainty applies only to demanded CI capacity                                                            | actual first-wave starter, zero CI demand                                          | D8                               |
| 9       | Allowlisted diagnostics keep source/reset; raw IO errors stay private                                          | safe formatting and CLI failure; host/panel boundary regressions                   | D9, D9H, D9P                     |
| 10      | Runtime templates in English and all fourteen translations; Intl numbers/percent/dates                         | installed language read at estimate time                                           | D10                              |
| 11      | Per-threshold default/configured origin travels with the value and forecast qualification                      | equal thresholds with distinct origins; default forecast sentence; runtime sources | D11                              |
| 12      | Correct inherited vs added panel bytes; cap repair and final build receipts follow below                       | existing production size/split gates                                               | D12, D12L; baseline gate failure |

## Surface ownership

- Panel: live workspace configuration, backend usage/read when already running,
  and the same recording.limits() the usage page consumes. It does not start
  a backend or construct account homes for an estimate.
- ACP: governor's resources.json, AccountStore's metadata/identity and the
  same running recording.limits() as the ACP usage page. Empty registry is
  distinguished from corrupt metadata by the metadata owner's own read.
- Standalone CLI: governor's resources.json and account metadata/registry.
  No backend is running, so missing live observations remain unknown with
  their surface named; no credential method is called.
- CI: no repository owner reports concurrent/occupied jobs. Unknown supply
  never invents a zero-capacity row.

These are existing captured SubscriptionUsage and UsageLimitSnapshot contracts
(M8 usage/read + usage/changed; normalized accountHomes/thresholds). This round
adds no wire parser or guessed field. Tests use the existing normalized shapes;
new model attempts: zero. Captured windowDurationMins is carried verbatim.

## Deliberate gate fires and exact restoration

Each mutation ran the named owning test at the repository deadline, exited 1,
and restored the source's original bytes in finally. Filtered drill runs are
followed by full owning-suite and related-suite verification, not reported as
full-suite passes.

- D1: `binds the real usage changed recording` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D2: `never invents a bucket` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D3: `retains the captured full percent allowance` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D4: `window 100 reset` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D5: `window 100 reset null` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D6: `refuses malformed limits` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D6b: `preserves the account metadata owner refusal` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D7: `isolates overlapping estimates` failed; `src/host/estimator/estimatorEntry.ts` SHA-256 before/after `7619a7a8deadbad2263e5fcbe256dbd33e266eb6556dd60e3f41c5f2de5c7451`.
- D8: `starts a first wave without CI` failed; `src/core/estimator/schedule.ts` SHA-256 before/after `943642b1c5c5daac2bff4802eb2cace54fc54628fdb23622ae6a69f8eefabac8`.
- D9: `keeps fleet refusal source` failed; `src/runtime/estimator/command.ts` SHA-256 before/after `32afdb36a316dfae239a222ce72477a7d928be380ec34c364b1969f5ee524888`.
- D10: `reads explanation templates` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.
- D11: `distinguishes defaults` failed; `src/host/estimator/fleetBinding.ts` SHA-256 before/after `174ecb6955b235d174666ff39b34da6691a2edb69c7d21014d6f97fc451f6023`.

Expanded test file at certification draft: SHA-256 `7a81b123fbeb85a061dc5f7a518b64bbbe418adeb95372dc8064346ca68e625c`. The original 27-test assertions remain, with additional sibling coverage afterward.

Post-drill owning verification: estimatorFleetReview (30),
estimatorFleetBinding (25, restored reader test; no skip), runtimeEstimatorPorts
(10): all 65 tests passed at repository timeouts. A further unused-CI-row
regression failed with unknown-capacity before repair, then passed. Initial
five-project typecheck passed; final provenance/build checks follow in the
completion record. Baseline panel 25,908 B, estimator 69,555 B; no cap changes.

### R4 boundary and budget completion

The real panel port had a second generic-error catch. It now distinguishes a
validated, localized host refusal from a raw client error. The host uses the
same allowlisted formatter as CLI, ACP and report output before sending that
refusal. The panel and real App regressions check source/reset retention;
the host and panel regressions also prove raw filesystem errors stay private.
Their assertions failed before repair (panel: one failed assertion; host:
one failed assertion, one existing source-retention assertion passed).

The panel's shared contract reuses identical scalar schemas and uniqueness
checks. Disclosure traversal uses one accumulator, and section validation
indexes lanes/machines while retaining unknown-reference rejection. The panel
reuses date formatting and setup selection and its already parsed initial
section. Defaults and uncertainty sentences are made in the estimator engine,
not computed in panel rendering. No DOM structure, style, token, accessibility
attribute, gate threshold or dependency changes.

The shared common brief's 2026-10-11 hub-file exception applies: changed English,
feature catalog and generated reference hubs are marked **HUB: integration run**.
Local related selection covers every other changed source plus the affected
localization/reference identifier suites. The initial all-hub inventory of
1,141 suites was a selection count, not an execution result.

Additional restoration receipts:

- D9H: `src/host/conversation/conversationController.ts`; mutant exit 1; before/after SHA-256 `d87af2fb991e132f7395a5f4a0591a64ac34e9826159c9e82444771994943378`.
- D9P: `src/webview/estimator/EstimatorPanel.tsx`; mutant exit 1; before/after SHA-256 `7da51213f7103a8db47b78658fd8206bc623885cd9519990b69914f4176d8578`.
- D12: `dist/webview/chunks/NB6XDKWK.js`; mutant exit 1; before/after SHA-256 `ddc8db400b704c6612d21e74f82e379ecd6d296a117196e7c35a18a715645e5c`.

D12 appended 132 bytes to one emitted panel chunk, making the production
size gate fail, then restored the chunk exactly. Source bytes and caps were
unchanged. The initial reviewed-source build also failed this gate.

The production split gate then exposed the existing direct runtime settings
import in ACP. The estimator now loads the same resourceMachineStore through
the existing resourceGovernor bundle, on first estimate use; settings remain
read-only and no governor/process is started. Its factory is exported from
that owner's existing entry and the loader validates the export. No split
allowlist or cap was changed.

| Production estimator row             | Reviewed HEAD (74b85d6fb) | R4 bytes | Unchanged cap |
| ------------------------------------ | ------------------------: | -------: | ------------: |
| Estimator panel dependency aggregate |                    25,908 |   25,568 |        25,600 |
| dist/estimator.js                    |                    69,555 |   70,084 |        76,800 |

Panel components now: 861 + 9,236 + 11,065 + 2,453 + 140 + 1,813 =
25,568 B. Relative to R3: shared schema −191 B, panel rendering −149 B;
340 B total saved. The base's 258 B and R3's added 50 B were real overage,
not byte-identical artifacts. Build is green through sizes, splits, host
globals and 92 third-party notices. Settings factory changes do not change
the panel/engine bytes. Five-project typecheck passed; localization has all
fourteen tables and zero problems; reference, roadmap and host API are current.

### Related execution and rig restriction

All 376 selected dependent suites ran at repository defaults, in 126 sequential
batches of at most three specifications with maxWorkers=3. Vitest's returned
module collection is cumulative across batches; totals are taken from the final
collection, not added across receipts. The first pass: 362 passing suites,
9 opt-in/platform skips, 5 failed suites; 8,748 passing assertions and four
failed assertions, plus one hook timeout. No live opt-in was enabled.

One assertion pinned unconditional CI uncertainty despite having zero CI demand.
Its fixture now declares CI demand and keeps its original unread-capacity and
input-immutability assertions; the zero-CI starter regression remains separate.
The hung-compiler deadline, usageIntegration deadline and windowsTrustedPath
hook are rerun separately below without increasing their deadlines.

The foreign-user probe in test/unit/vault/peer.test.ts is externally blocked:
its compiled client lives under /var/tmp/l-CM1173, which is owner-only mode 700.
`sudo -n -u nobody -- <client> <socket>` reported client command not found;
that UID cannot traverse the parent. The fixture does make its own child folder
searchable, but cannot change its private parent. No chmod of the rig root,
alternate launcher, path relocation, shim or other bypass was attempted.
The lead must run that probe from its permitted test environment before a green
integration claim. The suite itself ran; its foreign-user client did not.

The review's four baseline setup failures did not reproduce here: all 681
conversationController assertions passed, including native material admission /
held Host admission retarget=false/true and held Plan admission retarget=false/true.
Those paths were not changed to cure the historical setup failures.

Isolated default-timeout follow-up: estimatorSchedule + estimatorPanel +
runtimeEstimatorPorts passed all 72 assertions; spawnBootstrap passed its full
suite, and windowsTrustedPath passed its full suite. usageIntegration's
integrated authenticated-page case still times out at 5 s. Its read-only base
comparison uses 74b85d6fb source supplied by an in-memory Vite plugin; no base
checkout or file mutation. A first baseline probe mistakenly selected too many
files and was cancelled; its results are excluded. The corrected baseline
probe asserts that exactly this one specification is selected before running.

D12L rejected the valid settings factory deliberately: CLI owner regression
failed, exit 1; src/runtime/estimator/ports.ts SHA-256 before/after
`ffbdb20e28725b8dfb146d4a13bfe8bb926ebc90f6fc460842004ce7229b5f59`. Final owner suites passed 55 assertions;
final boundary/schedule/runtime suites passed 72.

The usageIntegration authenticated-page deadline failure was reproduced with
all changed source supplied from reviewed HEAD 74b85d6fb in memory: the same
case timed out at 5 s, with its other two assertions passing. It is inherited,
not cured by increasing a timeout or changing unrelated host code. The lead
owns this baseline issue alongside the blocked foreign-user probe. Full quality,
coverage and other-OS integration remain lead-owned as explicitly required by
the rig/common brief. No skipped test or gate weakening was added.

The mandatory broad dependency run and final verification exceeded the brief's
90-minute timebox. This record does not claim the timebox was met.

Shared rig load observed during final verification: 10.95 / 23.42 / 25.81
(1 / 5 / 15 minute averages). Deadline failures were isolated and rerun with
the repository defaults; no deadline was raised.

Final production build exits 0 through tokens, size budgets, split ownership,
host globals and third-party notices. Panel 25,568 B (32 B under its unchanged
25,600 B cap), estimator 70,084 B (76,800 B cap). A literal restoration of the
price JSX briefly produced 25,608 B and failed the size gate; using one fragment
outside the same price conditional preserves empty custom-price rendering and
removes the duplicated emitted wrappers. No gate or fallback policy changed.

Final static receipts: all five typecheck projects pass; ESLint passes at
max-warnings=0; deadcode passes (two inherited configuration hints), jscpd
reports zero clones, and localization reports zero problems across fourteen
UI and fourteen usage tables. Reference and host API checks pass.

Canonical estimator visual subset: all 72 captures (six states in each of
six themes at 320 and 690 px), zero changed pixels. Baseline revision
`6636c84beb804af52e49363ac10ede3223d3d295`, Chrome `150.0.7871.186`, Linux;
rasterization fingerprint matches the stored manifest. Uses captureMatrix,
manifest coverage/hash validation and comparePixels with the production
tolerance; no baseline updates. This is the complete estimator subset, not
the full 9,792-image visual gate. `node dist/acp.js estimate --help` exits 0.

# Round 5 (2026-10-11, kubuntu): RVCM1173D owned facts

The redesign begins with a single strict fact schema and one translator table
for normalized account limits, subscription usage, all four usage observation
sources and machine thresholds. Every amount may independently be unknown;
owner identity/generation, UTC instants and observer remain structured. No
credential, live model attempt, install, dependency or wire parser was added.

Initial table suite: estimatorLimitFacts, 13 passed at repository deadlines.
The following deliberate mutations each exited 1 and restored
limitFacts.ts byte-exact, SHA-256
`703b33333c8d11972bc9267caf6a7e7744ad743c261505869d2f81e3a5db0070`:

- R5-D1: replacing remaining percent with 100 failed `keeps known percentage
allowance with an unknown period`.
- R5-D2: dropping every account balance failed all four `retains a partial
account balance` source cases.
- R5-D7: bypassing timestamp validation failed the source-refusal tests.

Source contracts are the existing captured SubscriptionUsage,
UsageLimitSnapshot and AccountLimitsSnapshot; model attempts: zero.
The available c/m117-1 tip is 5b952fa3c and has no round-7 shared diagnostic
contract. The join must unify its code/parameters schema with this lane's
fleet, scheduling and engine diagnostics and retain presentation-only labels.

Translator-stage final verification: all five typecheck projects pass; the
restored table suite passes 13 tests; localization reports zero problems;
production build exits 0 through every unchanged size/split/global gate.
Panel remains 25,568 B. Aggregate quality remains lead-owned under the brief.

# Round 5 continued (2026-10-11 evening, kubuntu): finding drills

Each guard below was broken on purpose, the named suite failed, and the file
was restored byte-exact (SHA-256 verified after each restore). Red runs
used `-t` name filtering except F2 (five matched tests) and F7 (whole
table file); every run used repository deadlines.

- R5-F1 (schedule keeps known percentage allowance, unknown period):
  `fleetBinding.ts` window `remaining: fact.remaining` replaced with
  `fact.limit ?? fact.remaining`: `delays known percentage demand with unknown
renewal period` failed. Restored `6ee3a928d1d46d43d5f99ed6aafdb265a9d09eec32c67a7357272064fed90d2f`.
- R5-F2 (every vendor balance binds): `(before.providerId ?? 'meta')`
  narrowed to `'meta'`: the three non-Muse `enforces a known exhausted balance`
  cases plus the `carries exhausted balances` port case failed; the Muse case
  still passed. Restored to
  the same hash. A blanket-restore over-match briefly rewrote three genuine
  `'meta'` defaults; repaired by line and re-verified byte-exact before
  proceeding.
- R5-F3 (no locale in forecast data or seed): `limitNote` gained a
  time-zone field: `returns byte-identical bound forecasts in two ambient time
zones without a seed` failed. Restored
  `efbf05ebc9539c78abb74eb0370afcc9b3ccecc47055c8f42f3aa61dcba46620`.
- R5-F4 (observations fenced by account and generation): dropped
  `row.owner.generation === before.generation`: `does not reuse account A
observations after switching account or sign-in generation` failed. Restored
  to the F1 hash.
- R5-F5 (typed scheduling refusals survive): `EstimateSchedulingError`
  re-based on `Error`: `preserves typed scheduling refusals and hides raw I/O
errors` failed with `estimate-unavailable`. Restored
  `a412fea2af820167c4fd6d69ba98820580037cce2c8a4b6c5225f2597203f86b`.
  A first drill attempt against the schedule fallback text did not fire: every
  review test supplies labels, so the fallback never triggers. The recorded
  drill breaks the real guard instead.
- R5-F6 (labels only): removed `context.labels.push`: `uses labels in
unknowns and blocked diagnostics, never account ids` failed, expecting
  `Work`. Restored to the F1 hash. A restore of the schedule fallback dropped
  its indent; repaired and re-verified to the F5 hash.
- R5-F7 sibling (account-limits timestamp sweep): with both the snapshot
  schema gate and the plan-window `checked()` bypassed, all three new
  `refuses invalid account-limits timestamps` cases failed; either layer alone
  still refuses. Restored
  `8dcc104292ee3ae149f9d7646489002519561dfec6181ab78e4e886aa93774c5`;
  the table suite passes 17.

Round 5 evening verification (kubuntu, repository deadlines throughout, no raised timeout): estimator, schedule, simulate, entry, bottleneck, localFleet and recommend suites green (80 + 43 tests; 712 controller/command/ports tests; facts-review 17 and table 17 green after every restore); `vitest related` over all changed non-hub sources in three runs: 44 files with 1,544 passed and 19 files with 1,184 passed fully green; the 61-file core run passed 1,917 with only the two environmental items below; hub files (`estimateFacts`, `en`, catalog, reference, l10n) covered transitively plus `check:l10n` (14 UI + 14 usage tables, 0 problems) and `check:reference` (current). All five typecheck projects pass with zero errors. ESLint at max-warnings 0 and Prettier pass on every changed file (five inherited style errors in the uncommitted translator/binding/formatter/probe code were rewritten, not suppressed). Production build exits 0: panel sources untouched, so the aggregate stays at the reviewed 25,568 of 25,600 bytes with `dist/webview estimator panel: 25.0 KiB (budget 25 KiB)` passing; extension.js 587,184 bytes (573.4 KiB, 600 KiB cap); estimator.js 71.7 KiB (75 KiB cap); modelApi.js 515.8 KiB.

Not run here, lead-owned: `test/e2e/estimator.e2e.test.ts` cannot launch Chrome in this sandbox (`socketpair: Operation not permitted` at `chromium.launch`, before any test logic); `test/unit/usageIntegration.test.ts:212` times out at 5 s as RVCM1173D already recorded on HEAD. A different appearance of that file (401 vs proxy 502 on `/usage.js`) traced to this sandbox's proxy (`NODE_USE_ENV_PROXY=1` with empty `no_proxy` intercepting loopback HTTP; body `upstream connection failed`); with a loopback bypass the file returns to its known `:212` inherited timeout. No browser, server, or daemon of mine is left running.
