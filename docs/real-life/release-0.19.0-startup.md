# Real use — first-open startup on release 0.19.0 (linuxlt, 2026-10-18, TONIGHT)

Product: Muse Spark Code (Unofficial) 0.19.0, packed on this branch
(`1c96f27127` includes the fix; the before-runs below used the pre-fix
build from the same base). VSIX 3309634 bytes (budget 3788800). VS Code
1.139.0 under a private Xvfb (`:97`), isolated `--user-data-dir` and
`--extensions-dir` in the worktree's `temp/startup/`, panel driven over
CDP (text reads only, no screenshots). Scratch workspace: a fresh folder
in `temp/startup/ws`. HOME untouched, so Muse Code's own sign-in stood as
the owner left it. Backend: Muse Code (`muse` 1.4.10). Model calls: zero
throughout — no turn was ever sent; only `muse serve` plus its model
listing over MSP.

Packaging note (as the earlier lane found): the single `.vsix` requires
the arm64 `muse-created` helper, which needs a cross toolchain this rig
lacks. Built with the same local-only, never-committed trim (arch list
`['x64']`), then reverted `scripts/package-vsix.mjs`; `git status` clean
of it. `npm run build` passes with budgets held, no trim needed.

## Before the fix — reproduced twice, then measured

Quiet machine (load ~5 on 8 cores), fresh profile, panel opened at once:

- Pill read "Starting Muse Code…" and sat there 120 s+ with no change.
- The extension log showed activation and, ~75 s later, `Sign-in state:
signedIn on the museCode backend` — and nothing else. No `Spawning
muse serve`, no warm-up warning, no governor notice. No `muse serve`
  process of ours ever started.
- `Muse Spark: Restart Muse Code` → pill `muse-spark-1.3 High` in ~1 s
  (spawn to connected 360 ms). The engine path is fast; the first-open
  warm never ran it.

Loaded machine (7 detached `yes` loops I started and stopped myself,
machine CPU ~90–95%), same fresh-profile first open: identical stuck
pill. Once the backend ran, the governor reached pause and the workbench
showed `Machine busy: CPU Use is 87–90% (limit 85%). New background work
is paused. Waiting: machine busy: 0 …` with the `Resources: Paused`
chip. Restarting while paused: request 21:14:00, old serve out at
21:14:31, new spawn 21:14:52 — ~21 s of it the admission hold, then
connected in ~1.8 s.

## Cause (measured, not load)

1. Deterministic, and the recorded symptom: nothing probes sign-in until
   the first panel opens (`onSurfaceReady` runs the first `auth.refresh`
   when the snapshot is still `checking`). `surfaceReady` calls
   `warmModels` first, which stands down while checking — and nothing
   re-ran it when the sign-in landed seconds later. Stuck forever, quiet
   or loaded; the governor merely happened to be visible in the earlier
   run. Restart's `warmUp` and the first turn's `ensureHost` were the
   only paths left, exactly as recorded.
2. Under load on top: pause holds even the foreground `museServe`
   admission for the twenty-second `RESOURCE_FOREGROUND_WAIT_MS` bypass,
   with no word — and the notice calls it background work, which it is
   not. The start a person waits for queued behind paused work.

## Fix (on this branch, commit `1c96f27127`)

- `src/extension.ts`: the `authState` broadcast now warms every cold
  panel on `signedIn` (reuses the path `surfaceReady` would have taken).
- `src/host/conversation/conversationController.ts`: new
  `warmUpAfterSignIn()` — starts only panels that never warmed; warm
  panels are untouched (no extra posts, no respawn).
- `src/core/resources/queue.ts`: a foreground `museServe` admission is
  the engine, not work — granted at once at any level. Background
  admissions keep pause semantics (refused with `ResourcePausedError`).
- Test `test/unit/museServeAdmission.test.ts` drives the real queue
  (capacity `() => 0`, exactly what the governor returns at pause):
  shown failing before the fix (`waited` after 500 ms instead of a
  permit), passing after (15 ms), with the background-refusal guard.
  No stand-ins anywhere in it. CHANGELOG entry under `[Unreleased]`.

## After the fix — pill reaches ready on first open, quiet and loaded

- Quiet, fresh profile: sign-in 21:33:47 → spawn +461 ms → connected →
  pill `muse-spark-1.3 High`. No restart, no turn.
- Loaded (~90% CPU), fresh profile: sign-in → spawn +225 ms → ready.
  No restart, no turn.
- Restart while paused (CPU 90%, pause notice live): new spawn +161 ms
  after the old host exited (was +~21 s). Pill ready right after.

Gates on the final tree: prettier clean, eslint zero warnings on all
touched files, full `npm run typecheck` clean, `check:l10n` 0 problems,
`check:reference` current, `npm run build` with budgets held, the new
suite 2/2 with the repository's own timeout, and `vitest related` over
the queue and controller changes: 13 files, 155 passed, 0 failed.

## Notes for the lead

- The `limit 85%` is our own default (`RESOURCE_CPU_DEFAULT_PERCENT`,
  governor on by default) — not a provider limit and not person-set.
  Pre-fix it held a behaviour the person asked for (panel-open start, up
  to ~20 s). Post-fix the engine start never queues, so the default no
  longer stops it. Left unchanged in this lane as instructed.
- Unrelated, seen in every run: `MSP schema fingerprint mismatch`
  (pinned vs served) warning; the host proceeds under additive-optional
  evolution. Pre-existing, not touched.
- The old-serve shutdown under 90% CPU took ~26–30 s (SIGKILL/exit);
  admission-independent, noted not fixed.

## Verdict

First-open startup PASS, quiet and loaded. Zero model calls.

## Carried onto the joined release tree (linuxlt, 2026-10-18)

The fix was cherry-picked onto the joined release (`8fb477883f`) as
`d93d6d4c3c` (conflicts in CHANGELOG.md and `src/extension.ts` resolved by
keeping this tree's code: the warm-up now hooks this tree's `loadAuth`
broadcast and the entry sits in this tree's `[0.19.0]` section) with this
record as `4b79d8ca29`. Re-ran here with the repository's own timeout:
`test/unit/museServeAdmission.test.ts` 2/2 (shown failing first with the
queue hunk reverted: `expected 'waited' to be 'permit'`), and `vitest
related` over the queue and controller changes: 357 passed, 8 failed —
the same 8 fail on the untouched base (measured in a base worktree), so
unrelated to this fix.
