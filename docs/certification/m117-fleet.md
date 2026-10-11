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
