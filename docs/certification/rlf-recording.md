# RLF-RECORDING — M105 screen-recording drivers bound (2026-10-22/24/30)

- Branch `rec/rlf-recording`, worktree macmini `/Users/randy/lanes/RLF-RECORDING`, base
  `int/recovery` 397aca3dd (PC run 2026-10-22, Claude Sonnet 5.5 2026-10-24, Muse Spark
  2026-10-30). This record covers the whole lane; the 2026-10-30 run verified every suite
  and gate below itself and fixed what was red.
- M105's screen-recording side is bound: the recording command creates the platform's
  native recorder on first use and keeps one per window — Windows' helper through the R2
  factory, macOS' signed app through its own designated requirement, Linux' desktop
  portal through the shipped `muse-portal-record` helper (libc only). Each driver refuses
  in words where the computer cannot record; the refused-permission Settings recovery is
  wired to the refusal. The drivers ship in their own lazy bundle
  (`dist/screenRecordDrivers.js`, first recording start); the command bundle keeps the
  preview and the latest-file discovery.
- What the lane changed: the entry-point binding (`src/extension.ts`, one driver per
  window behind a failure-clearing shared creation), the shared factory
  (`recordingDriver`), ports (`recordingHelperProcess`, `linuxRecorderPort`,
  `macosRecorderDeps`, slimmed `windowsRecorderDeps`), the drivers' bundle split and
  sharing plugins, latest discovery and macOS permission recovery as their own core
  leaves (`record/latest.ts`, `record/macosPermissions.ts`), the C portal helper with its
  per-arch CI build and per-platform packing, real-helper suites per OS, and the
  generated reference/host-API/roadmap/registry/catch-baseline updates.

## Proof (this rig, 2026-10-30)

- `recordingDriver.test.ts` 4/4 (binds this platform's driver, remote refusal, worded
  missing-helper refusal, schema refusal); `linuxRecording.test.ts`,
  `windowsRecorderDeps.test.ts`, `recordingLatest.test.ts`, `resolveLatestRecording.test.ts`,
  `vsixTargets.test.mjs` (with the new binary in the sibling list), `hostFrames.test.ts`
  all green; `portalRecord.test.ts` skips on macOS by design (runs on Linux CI).
- `macosRecorderDeps.test.ts` 5/5 against the real signed helper the suite builds
  (the app's own `--probe` as oracle, real `codesign`): warm 66 s; cold module cache
  229 s inside the 240 s named budget (see drill 3).
- Related suites for the changed drivers/ports/bundle: 7 files 79 passed / 18 skipped;
  bundle batch 5 passed; `vitest related src/extension.ts` finds no unit importer
  (integration-only; Electron cannot start on this Mac). `vitest related` on `en.ts` was
  stopped: it fans out to the whole battery, which lanes never run; the l10n and
  reference gates cover the string change.
- Built production bundles smoked directly: `dist/screenRecordDrivers.js` exports the
  sync factory; missing-helper and bad-options refusals read as designed.
- `typecheck` 0; `eslint --max-warnings=0` on touched files 0; `prettier --check` 0;
  `check-l10n` 0 problems; `check:reference`, `check:host-api`, `check:roadmap`,
  `gen-lazy-registry --check`, `check-host-globals`, `check:catches`, `duplication`
  (0 clones), `cycles`, `deadcode` all green; `check-bundle-split` 0 problems;
  screenRecord 17.5/50 KiB and screenRecordDrivers 51.7/60 KiB within budget;
  `security:sast` 0 findings (533 rules, 4157 files).
- Pre-existing reds, measured on the untouched base where checkable, all reported not
  fixed: `npm run build` fails only on `resourceAdmission.js` 25.0/25,
  `modelApi.js` 527.7/525 and `vaultActions.js` 25.0/25 KiB (byte-identical sizes on
  base commit 9ede534af, built in a scratch worktree); `check:plan` fails only on the
  over-budget PLAN.md (byte-identical file on base); `security:audit` fails on 6 high
  advisories plus 2 stale exceptions (the lane changes no manifest, so the result is
  base-identical by construction).

## Drills (red shown, restored byte-exact, green)

1. Binding: dropped the macOS branch of `createRecordingDriver` → 3 failed, exit 1;
   restored (`git diff` empty) → 4 passed, exit 0.
2. Missing-helper refusal: `.findLast` back to `.find` for the `.app` segment → the
   refusal named the rig's `RLF-RECORDING.app` temp root instead of the helper app,
   1 failed, exit 1; restored → 4 passed. The `host.app` case in
   `macosRecorderDeps.test.ts` pins this on every machine.
3. Cold Swift toolchain: module cache moved aside with the old 120 s helper budget →
   `build.sh` killed at 120.6 s mid-sign, whole file failed in `beforeAll`; with the
   240 s named budget → 5 passed (cache restored exactly afterwards, 179 entries).
4. Gate regens went red→green on their own errors, each diff reviewed: reference
   (stale generated files), host-api (the permission pane's `Uri.parse`/`openExternal`
   plus node counts), catch baseline (5 edited sites, then 2 moved sites; classes and
   totals unchanged both times).

## Open receipts (owner steps)

- One real recording per OS through the packed product, with the permission recovery
  run — the only proof for actual capture and for the Settings-pane offer, which no
  headless run can drive. Hosted CI covers the Windows and Linux legs (real-helper
  suites, C build with `-Werror`, per-platform packing checks).
- The `treesLifecycleNative` suite shares the fixed helper budget but keeps its own
  120 s hook: unchanged behaviour, but a cold loaded Mac could still trip its hook
  first; left for its owning lane.
