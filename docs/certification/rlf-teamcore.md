# RLF-TEAMCORE — M96c ported onto RLM96's team core

Lane: RLF-TEAMCORE (rig macmini, worktree `RLF-TEAMCORE`, branch
`rec/rlf-teamcore`). Base: int/recovery at `3198954c9` (0.19.0, holding
RLM96/RLM96B/RLM120). Source read, not merged: RLM96C
(`src/RLF-TEAMCORE/01-rec-rlm96c`, `ad029573d`) and its record
`docs/certification/rlm96c.md` on that branch. The lane was resumed
2026-10-30 after a quota stop; the first five commits below are the
interrupted run's, the rest this resume's.

## What landed

One launch architecture and one hook system. M96c's capabilities, each
built on the team core int/recovery already has:

- **Window scheduler on the core** (`99c23fa64`): board ownership claim,
  the launch gate's ownership compare-and-set, unspawned-admission
  settlement, the stall sweep and the window-owned binding
  (`scheduler/window.ts`) behind `TeamSchedulingPort`.
- **Host binding** (`5c3a87234`): `pump()` delegates to the scheduler's
  wake; `finalAdmit` re-checks pause, trust, governor slot and caps after
  every await; merges enqueue into the ordered merge queue and land one
  turn at a time, refusals keeping their kind for Traffic.
- **Traffic and retirement** (`3ca90a8c9`): `projectTeamTraffic` (board,
  lanes, leases, conflicts, merge queue with refusal reasons, metrics,
  recovery rows), `AttemptRetirement` and `StallRecovery` constructed in
  the window scheduler over the host's retirement port; Traffic Stop,
  Cancel and Reassign go through them, and an unprovable retirement
  offers Continue anyway / Hand off anyway / Restart the team host with
  the decision journalled.
- **Governor joins and landing** (`7bc459102`): `TaskPicker` gates
  fair-ordered picks through `pickResourceReady`; worker checks route
  through `ResourceRunnerRouter` (which reads
  `resourceRunnerPreference`); `ResourceRelocator` already had its caller
  in `launchHost.ts` on the base (verified, unchanged). `landTeamTask`
  lands through the staging copy, workspace checks and the landing
  journal; recovery reads every window's owner store — own records at
  once, foreign ones only after confirmed takeover, receipted first.
- **Recovery fixes the drills found** (`7e6366e80`, `4303c6b0e`): a
  reopened interrupted attempt returns its slot and lease; a quarantined
  replacement begins and the old lease is withdrawn; owner-store recovery
  settles the intent **in its owner's store** (next section).

## Findings fixed on this resume

1. **Recovery closed a copy in the recovering window's store**
   (`4303c6b0e`). The killed-lander proof failed its final landing
   (`expected 'rework' to be 'merged'`): the dead owner's record stayed
   open forever, blocking every later landing — RLM96C's record names
   this exact contract. `recoverOpenLandings` now resolves each intent
   to its owner's journal store (the takeover runs first, so the write
   is admitted).
2. **Every new catch now names its condition or reports** (`6952f27ab`).
   The port added 15 core catch sites: 1 SWALLOW, 4 GENERIC, 6 CLEANUP
   over the base, plus two pre-existing handlers whose try bodies the
   port edited (identity churn). All now log through `failureForLog`,
   carry their cause, test `BoardRefusal` and rethrow the rest, or reach
   the scheduler's `deps.failure` port. The catch classifier learned that
   port (receiver-scoped to `deps`/`this.deps`, verified against its
   production binding, with positive and negative cases). Measured
   against the untouched base the lane adds **no** new bad site; core
   counts sit at or below base (SWALLOW 83 = base, GENERIC 287 < 289,
   CLEANUP 242 < 243). The gate stays red on base and lane alike from
   the base's own rise over `scripts/catch-baseline.json` (73 problem
   lines on base; 74 on the lane, the extra line being the
   accepted-sites-removed notice from debt reduction, already present in
   the lane before these fixes at 87 lines). No baseline was regenerated:
   that would bless every other lane's unreviewed sites with it.
3. **Bundle budgets** (`6d5df9ea6`). The port had inlined the window
   scheduler into `dist/teamScheduler.js` (110.8/75 KiB) and checked
   landing into `dist/teamHost.js` (174.9/130), with Traffic over in
   `dist/teamRunners.js` (102.4/100), and the stall handoff dragged the
   whole `TEAM_MODEL_TEXT` block into the scheduler bundle (+16.8 KiB,
   also against its split-gate readers). The stall handoff's three
   strings are now `TEAM_HANDOFF_MODEL_TEXT`; `dist/teamWindow.js`
   (49,841 B) and `dist/teamLanding.js` (61,885 B) load on their first
   team action, budgets 75 KiB by D6's measured +15% rule, no existing
   budget raised; the window bundle rides the scheduler bundle's
   board/slots/pool and the runners bundle rides the window bundle's
   write-set matching through the deferred cohort (the M120CAP pattern).
   The team journal's generic `z.parse` joins the shared validation
   surface; without it `check-bundle-split` failed (3 problems, now 0).
   The size gate's only remaining overs are the base's own seven,
   unchanged numbers. Packed proof: all new bundles `require()` cleanly
   and a packed `dist/teamWindow.js` scheduler launches a task through
   its externals (`temp/packed-window-smoke.cjs`: `launched: smoke-1`,
   board `smoke-1:running`).

## Proofs (real processes, the repository's own timeouts)

- `teamLandingPause`: while the workspace check runs in the staging copy
  the user tree keeps `before\n`; after release it reads `after\n`.
- `teamLandingKilled`: a bundled child runs `landTeamTask` and is
  SIGKILLed with its journal intent durable and `.git/index.lock` held.
  Recovery returns 0 while the lock stands; after the person removes it,
  confirmed takeover recovers 1, keeps a later user edit, and landing a
  freshly admitted change merges.
- `teamSchedulerRecovery`: kill -9 mid-task, then a fresh window resumes
  the attempt from the on-disk journal; an unprovable retirement (no
  containment proof on this platform) stays uncertain through both
  bounded waits until Hand off anyway; throughput: eight real child
  processes clone/write/commit in their own copies through four lanes —
  the lane ceiling is filled (max active 4), never exceeded, every task
  finishes `done` and every copy holds its commit.
- The merge-queue, final-admission and Traffic behaviour stay covered by
  `teamHostService` (76 tests, merge expectations on the enqueue
  contract from `5c3a87234`).

## Red/green drills

- **Owner-store recovery**: the killed-lander suite as first written
  failed at the final landing (owner's copy left open); the fix above
  turned it green. No revert was needed — the red came first.
- **Catch classifier sink**: with the `deps.failure` wiring disabled
  (`if (false && isFailurePortCall(...))`), `catchInventory.test.mjs`
  fails 1 of 14 (exit 1, "names REPORTED when every path rethrows,
  carries the cause or records"); restored, 14/14 pass.
- **Journal prepare**: removing `LandingJournal.prepare`'s store write
  makes `teamLandingKilled` fail (`expected +0 to be 1`: the next window
  finds no open intent to recover); restored byte-exact (`git diff`
  clean), suite green again in the final related run.
- **Lock exclusivity probe (no drill claimed)**: dropping `open`'s `wx`
  for `w` in `takeIndexLock` did **not** fail any suite — the
  known-holder probe ahead of it keeps the killed-lander behaviour. This
  is reported, not papered over: exclusive create matters for two
  concurrent landers, which no suite here drives; RLM96C's two-window
  suite (on its branch, built on the since-deleted fixtures) is where
  that proof lived.

## Gates on the final tree

Run on macmini, one heavy command at a time. Base = detached worktree at
`3198954c9` with this worktree's `node_modules`, same commands.

| Gate                               | Exit | Note                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| eslint (touched files, 0 warnings) | 0    |                                                                                                                                                                                                                                                                                                              |
| prettier (touched files)           | 0    |                                                                                                                                                                                                                                                                                                              |
| typecheck (host + webview + unit)  | 0    | unit caught two bad literals in the proofs, fixed in `168b65548`                                                                                                                                                                                                                                             |
| `check-l10n`                       | 0    | 0 problems                                                                                                                                                                                                                                                                                                   |
| `check:reference`                  | 0    |                                                                                                                                                                                                                                                                                                              |
| `check:host-api`                   | 0    | after regenerating the three Node-count rows (`76233a802`)                                                                                                                                                                                                                                                   |
| `check:plan`                       | 1    | PLAN.md is 3,721,495 bytes on base and lane alike: the 85% budget failure is the base's, measured; the M96c status replacement is size-neutral in kind                                                                                                                                                       |
| `check:roadmap`                    | 0    | M96c entry updated, regenerated                                                                                                                                                                                                                                                                              |
| `check:catches`                    | 1    | identical failure shape on base (73 lines); lane 74 with zero new sites (see Finding 2)                                                                                                                                                                                                                      |
| `duplication`                      | 1    | lane back to the base's single pre-existing clone (judge suites)                                                                                                                                                                                                                                             |
| `cycles`                           | 0    |                                                                                                                                                                                                                                                                                                              |
| `deadcode`                         | 1    | output byte-identical to base                                                                                                                                                                                                                                                                                |
| `npm run build`                    | 1    | only the base's seven bundle overs, identical numbers; every team budget holds                                                                                                                                                                                                                               |
| `check-bundle-split`               | 0    | run past the size gate's stop                                                                                                                                                                                                                                                                                |
| lazy registry `--check`            | 0    | regenerated in `6d5df9ea6`                                                                                                                                                                                                                                                                                   |
| `check-host-globals`               | 0    |                                                                                                                                                                                                                                                                                                              |
| SAST (`security:sast`)             | 1    | 5 blocking findings, all in `src/host/backend/deviceWorkerDarwin.ts`, identical bytes on the base and untouched by this lane (targeted semgrep on that file alone: 5 findings, exit 1). Two full-tree base attempts were invalidated by this session's own scan/cleanup overlap and are not used as evidence |
| `security:audit`                   | 1    | the lane changes no dependency (`package.json`/`package-lock.json` untouched), so the advisory input is the base's                                                                                                                                                                                           |
| unit suites                        | 0    | teamLandingPause, teamLandingKilled, teamSchedulerRecovery, teamHostService, catchInventory, lazyBundleFiles, teamChunkPackaging; plus `vitest related` over every changed source file                                                                                                                       |

Nothing was run against a model provider; no paid or live call. The
real-life run is not this lane's brief. Teams remain behind the release
latch at their current defaults.
