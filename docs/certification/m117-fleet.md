# M117 C-M117-3 certification — estimator fleet binding (2026-10-11, kubuntu)

Lane CM1173, branch `c/m117-3`, base `7d0410526` (c/m117-1 round 4).
Scope: `fleet` and `candidatePool` ports only, plus one new module and its
tests. Not touched: `history`/`prices` ports (CM1172/CM1174), provision
(CM1176), `planSnapshot*.ts` (C-M117-1 in review).

## What was built

- `src/host/estimator/fleetBinding.ts` (new): `applyFleetBinding(base, io)`
  overlays three injected reader rows onto the measured local fleet and
  re-parses the whole snapshot through `fleetSnapshotSchema`, so a corrupt
  reader refuses instead of widening the fleet:
  - M107 `capacityCaps`: configured CPU/memory ceilings, validated 0–100
    (`fleet-caps-invalid` otherwise). Serial capacity (one lane at a time,
    one slot per lane kind) is unchanged.
  - M108 `accounts`: exactly one row rebinds the local slot to it; zero or
    several refuse (`fleet-accounts-ambiguous`) — one serial slot cannot
    choose between accounts. Usage-limit windows pass through validated;
    absent windows keep the schedule's existing unknown-limits disclosure.
  - CI `ci`: limit-with-occupied rows pass through validated; absent keeps
    `ci: []`, and lanes demanding CI without a row refuse via the schedule.
- `src/host/estimator/localFleet.ts`: `estimatorSourcePorts` takes an
  optional third argument (`fleetIo`); both `fleet` and `candidatePool`
  return `applyFleetBinding(localFleet(lanes, asOf), fleetIo ?? {})`. With
  no readers the fleet is byte-identical to the certified row (proven by
  test).
- Device/node rows: absent, never guessed. GPU-requiring and device-class
  lanes have no runnable machine; the schedule refuses them as
  `unschedulable:<lane>` / `estimateNoCapacity` (their true reasons).
- Deliberately not sampled: the governor's volatile level (throttle/pause).
  A forecast predicts configured capacity; sampling live load would make
  identical goals forecast differently minute to minute (acceptance 2).
- No new user strings (existing `estimateFailed` details only), no commands,
  settings, dependencies or cap changes.

## Tests (repository timeouts, never `--testTimeout`)

`test/unit/estimatorFleetBinding.test.ts`, 9 tests, all passing on kubuntu:

- Default binding reproduces the measured fleet exactly.
- `asOf` passthrough through the real `fleet` and `candidatePool` ports;
  both ports agree.
- M107 caps apply; out-of-range ceilings refuse (`fleet-caps-invalid`).
- M108 single-row rebind incl. usage windows; 0/2 rows refuse.
- CI rows carried; `occupiedJobs > concurrentJobs` refuses.
- Device/node absent; GPU and device-class lanes unrunnable.
- Acceptance 3 through the real fleet port: two serial lanes name
  `machines` via `findEstimateBottleneck`. Slots/rate/CI isolation is
  impossible on a one-slot fleet (any of those relaxations still leaves the
  serial slot, so they couple — verified during development); the rows bind
  fail-closed instead: over-committed CI refuses `unschedulable:A`, a rate
  below a single lane's demand refuses `unschedulable:A`, fitting rows
  schedule. Full five-kind bottleneck naming stays covered by
  `test/unit/estimatorBottleneck.test.ts` on engine fakes (22 tests green
  with the neighbouring `estimatorLocalFleet` and `runtimeEstimatorPorts`
  suites).

## Red drills (byte-exact restore, SHA-256)

Pre-drill:
`60d7cc373e8b29960504bbadf5dfb9b956b994555c8ccd9c5b1670daaabb9864`
fleetBinding.ts,
`472fcdbc6f78942efde5127f3195e4f73e496ddd6587e1cabc9ea4e0b2744777`
estimatorFleetBinding.test.ts.

1. Removed the final `fleetSnapshotSchema.parse` (returned the widened
   object cast): `carries CI concurrency rows and refuses a corrupt one`
   failed (corrupt row passed through). Restored; hash matches.
2. Weakened caps validation to a bare `typeof` check: `applies M107's
configured caps and refuses ceilings it cannot honour` failed (-1/101
   accepted). Restored; hash matches.

Post-drill suite: 9/9 green at repository timeouts.

## Review pass by class

- Validation/security: reader rows re-parsed; no credentials, paths or
  network in the binding (no file reads, no `gh`, no handles).
- Failure paths/honesty: corrupt/ambiguous readers refuse with named
  details; missing CI/device rows refuse via existing schedule reasons;
  unknown account windows stay disclosed as unknown, never zero.
- Concurrency/lifecycle: pure synchronous overlay, no shared state; ports
  stay `(lanes, asOf)`-pure with the request stamp passed through.
- Docs: CHANGELOG `[Unreleased]`, PLAN.md C-M117-3 record, this file.

## Open for the lead

- Live readers are not wired: the call sites are `src/extension.ts:2367`
  (`estimatorSourcePorts(`) for settings-backed caps and
  `src/runtime/estimator/ports.ts:39` for headless. The M108 registry mapping
  (which account backs the local slot) belongs to the accounts owner.
- Restore list (0.17.1 truth pass): nothing in this lane's scope was
  removed or hidden — no release text, command, setting or Help row to
  restore. No Help row added (no new command, setting or surfaced feature).
- Editors/OS: no UI changed; the binding runs wherever the estimator runs
  (extension, ACP/headless). Windows/macOS/Linux need no special path (no
  file-path comparison in this code). Cross-rig and a11y remain lead-owned.
