# RLF-M103WIRE — Maker host activation wiring

Worktree: `/home/randy/lanes/RLF-M103WIRE` (linuxlt rig), branch
`rec/rlf-m103wire`. Base: rv/int9 `72d8d5003`. Model attempts: **0**.
Provider calls: **0**. No paid or live model call was made in this lane.
No hardware was connected. No budget, gate threshold or timeout was
changed; every suite below ran with the repository's own timeouts and
`--maxWorkers=3`. Nothing was pushed, rebased, stashed or tagged.

## What landed

M103 has an activation caller. Activation registers the six maker
commands (`enable/disableHardware`, `add/removeMachine`, `stopMachine`,
`openDeviceLog`) and the `ide` maker tools behind the lazy bundles: the
loader shim stays in `dist/extension.js`, the assembly and UI load in
`dist/makerHost.js` on first use, the engine in the new
`dist/makerEngine.js`, the preview panel in `dist/makerPreviewHost.js`.
The window engine mirrors the runtime service (latch, registry,
lease-guarded send, serial, ungated Stop) on window storage and secrets;
machine-engine construction, the lease-guarded send, the serial audit,
summaries and tool-result shaping live once in
`src/core/maker/machineEngines.ts`, used by both services. The serial
helper's bare `python3` resolves through the pinned governed lookup, and
OctoPrint enrolls over application keys (probe → request → poll) without
a pasted key; the enrollment flow lives in
`src/core/maker/machines/octoprintAppKeys.ts` because only the window
engine enrolls. The device log accepts a folder-less window and reads a
never-appended log as empty. Commands, titles, reference, host-API
record and all 14 localization tables are regenerated.

Measured bundles on the final tree (`npm run build`, exit 0): extension
540.6/600 KiB, makerHost 21.0/25, makerPreviewHost 12.1/25, makerEngine
90.5/125, runtimeMaker 125.9/126 KiB. No budget raised. The refactor
pushed runtimeMaker to 126.2/126 first; the appkeys split brought it
back to 125.9.

## Suites run on the final tree

Green, exit 0 (repo timeouts, `TMPDIR=<worktree>/temp`):

- `makerLease.test.ts` — 31 passed.
- `makerSerial.test.ts`, `makerSerialAdapters.test.ts`,
  `makerSerialSession.test.ts` — 44 passed.
- `makerLeaseCrashes.test.ts`, `makerLeaseIdentity.test.ts`,
  `makerOctoprintAppKeys.test.ts` — 18 passed, 2 skipped (the two
  Windows-only lease-folder tests, `runIf(win32)`, correct here).
- `makerWindowEngine.test.ts` (14), `makerRegistryLog.test.ts`,
  `makerMachines.test.ts` — green in every batch run (138, then 21
  with `pathGuardSpawns.test.ts`, 116 and 106 after the refactors).
- `vitest related` for the host maker sources — 14 passed; the
  vscode-only UI files have no affected unit file (the integration
  suite below is their proof).
- Integration in the real Extension Host (VS Code 1.144.1 stable under
  xvfb, `test/integration/maker.test.ts`): 2 passing — the six
  commands registered at activation; disable, Stop and the empty
  device log run for real with no modal.

One transient red: a `makerWindowEngine` + `makerMachines` batch showed
1 failed / 115 passed once, then 116/116 on the immediate rerun and
again on the next. No assertion was touched between the runs; recorded
as a rig flake, not waived.

Red, pre-existing on the base and unrelated to this lane (proven
identical on pristine base `72d8d5003` in a linked worktree, then
removed): two `runtimeMakerStop.test.ts` Stop-index cases (the machine
Stop over the simulator fails alongside the lease-owner Stop, so the
failure sentence names an extra machine) and one
`makerEmulatorRig.test.ts` case (the live lease worker parse). This
lane neither caused nor worsened them: the same 3 fail with and without
this lane's changes.

## Regressions found and fixed in this run

- **The lease dropped codeless holder-query doubts.** `isSameHolder`
  held only fs/lease-/zod failures, but the real runner rejects with a
  codeless `Error` (the code rides on `cause`), so a query doubt
  escaped as a claim failure instead of holding busy. Every `Error`
  from the query now holds, per its undefined-proves-absent contract;
  only a non-Error throw propagates. Red: `makerLease.test.ts`
  "distinguishes PID reuse…" failed with `test-query-denied` (exit 1).
  Green after the fix: 31/31.
- **The storage guard pinned the `file` URI scheme.** Current VS Code
  hands storage URIs as `vscode-userdata:` (observed in the host log),
  so every maker command failed with `makerUnavailable` and nothing
  opened. The guard now requires definedness plus the realpath and
  workspace-containment checks, matching the rest of the codebase.
  Red: integration 1 passing / 1 failing, no document opened.
  Green after the fix: 2/2. The loader also names its failure in the
  log now (name only, never message text).
- **The shared audit resolved its log eagerly.** The first extraction
  called `deviceLog()` while building the serial options; the
  companion test, whose storage is unavailable by design, then failed
  with `deviceLogInWorkspace`. The appender takes a log factory, as
  before. Red then green on `runtimeMakerStop.test.ts` (11 passed +
  the 2 base failures).

Earlier in this lane (prior session's receipts): the serial
interpreter drill (win32-undefined, missing, planted-workspace-copy),
the appkeys enrollment drill, and the window-engine drill (a broken
`refresh()` forced red, repaired, 14/14 green).

## Gates on the final tree

`prettier --check` 0, `eslint --max-warnings 0` 0, `npm run typecheck`
0, `node scripts/check-l10n.mjs` 0, `npm run check:reference` 0, `npm
run check:host-api` 0 (regenerated twice: +3 adapter files and 76 → 82
commands, then the `node:buffer` count for the shared module),
`npm run check:plan` 0, `npm run check:roadmap` 0, `npm run
check:catches` 0 (the stat probe names `isErrno`), `npm run
duplication` 0 clones (was 12 before the extraction), `npm run cycles`
0, `npm run deadcode` 0, `npm run build` 0 with every budget holding.

## Stays out, for the lead/owner

The installed Arduino IDE 2 run, lane E's one counted live call, and
the owner's Pi/ESP32 session were not run here, per the brief. The
three base failures above belong to their owning lanes. Tab (M94) and
schedule-background integration suites fail in this host for unrelated
reasons (no model, no native scheduler binding); only the maker file
is this lane's proof.
