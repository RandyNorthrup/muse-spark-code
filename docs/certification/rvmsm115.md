# RVMSM115 — Review that fixes: M115 scheduled prompts v2 (2026-10-17, macmini)

Review of lane MSM115 at `00074b947` against base `3d30a7321`, on branch
`rv/msm115`. Fixes are committed on this branch; nothing was pushed. No
model or paid call was made. The full report is the lane report
(`RVMSM115.report.md` with the lead).

## Verdict

Not mergeable as a finished, reachable M115. Automatic delivery is still
behind `SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady = false`
(`src/shared/constants.ts:4292`), so no person can make a v2 schedule fire:
the VS Code commands are hidden (`package.json` palette `when`), the
extension's schedule activity and the M52 v1 migration both require the
switch (`src/extension.ts`, `isScheduleActive` and the migration gate), and
the runtime binding strips every delivery port while it is off
(`src/runtime/schedules/binding.ts:68`). PLAN.md's M115 status says the
switch flips only on the lead's complete receipts (cross-platform VS Code
admission and safety, the installed native modal decline, independent
review, aggregate qualification), which this lane cannot produce from the
macmini sandbox, so the review did not flip it. Schedule management through
the terminal **is** reachable today (measured on the built product below),
but undocumented in help, which hides the route.

## Findings fixed

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                    | Proof                                                                                                                                                                                        | Commit      |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | P2       | `src/runtime/schedules/storeRoot.ts`: the pre-version carry renamed each entry, so a folder present on both sides threw `ENOTEMPTY` (failing runtime creation) and a stale legacy file silently overwrote the current `v1` file on POSIX                                                                                   | New real-temp-dir case in `test/unit/scheduleStoreRoot.test.ts` failed with `ENOTEMPTY` at `storeRoot.ts:23` before the fix; passes after (folders merge, `v1` file wins, legacy copy stays) | `243c51ed0` |
| 2   | P2       | `src/webview/schedules/prompt.ts:54` stamped `end: now + 7 days` into every v2 `/loop` draft, overriding any end the person chose: a limit of ours on schedule life (`end` is optional in `scheduleV2.ts`)                                                                                                                 | New `test/unit/schedulePromptLoop.test.ts` through the real parser, real bridge draft and real mapping: both cases failed on the stamped end (`atMs` = now + 7 days) before, pass after      | `915703267` |
| 3   | P3       | `src/core/schedules/time/loop.ts` (`parseScheduleLoop`) was dead code duplicating the reached mapping in `prompt.ts`, with the same seven-day default; only its knip/cycles entry rows named it                                                                                                                            | `grep -rn parseScheduleLoop src test`: no caller                                                                                                                                             | `915703267` |
| 4   | P2       | Tests with stand-ins (owner's rules): `test/unit/scheduleWorkspaceBridge.test.ts` used `vi.mock` of our own binding plus a hand-written binding; `test/unit/scheduleBinding.test.ts` injected a fake bundle factory; `test/e2e/schedulesStdio.e2e.test.ts` wrote a hand-written fake `schedules.js` into the packed layout | The three files at `00074b947`, quoted in the lane report. Rewritten through the real bridge/loader, or the fake-only case deleted; suites pass (below)                                      | `5cfc3c624` |
| 5   | P3       | `README.md` said the three v2 commands "open the v2 editor, list and timeline"; they are hidden while the switch is off                                                                                                                                                                                                    | `package.json` palette `when: museSpark.scheduleDeliveryCertified`; switch reads `false`                                                                                                     | `c9f3654ce` |

Tests removed or rewritten under the owner's rules: 3 files.
`scheduleWorkspaceBridge.test.ts` rewritten (6 real cases; the two cases
that only controlled a stand-in's timing — late window acquisition and late
bundle acquisition — were removed, not re-faked; close/disable refusals are
now proven through the real bridge). `scheduleBinding.test.ts` rewritten to
the real loader against a bundle path that is not on disk (refusal, and the
refusal is not cached). `schedulesStdio.e2e.test.ts`: the one fake-bundle
case (exit-3 cleanup) deleted; the remaining 3 cases run the real built
agent. That also corrects `msm115.md` §7's "builds the real product: 4/4"
for this suite: the fourth case ran a fake bundle, so that claim was not
true of the suite as shipped there. The exit-3 cleanup behaviour now has no
test proof; it is observable in the drill below and belongs in the lead's
real-life run.

## Findings not fixed

1. **P1 — delivery unreachable** (above). What the fix needs: the PLAN
   receipts and a deliberate lead commit flipping the switch, then the
   plan's live check. Everything the switch gates is wired (delivery ports
   in `src/extension.ts:3477-3676`, ACP/terminal binding, the v1 migration),
   so the flip itself is one line; the receipts are the work.
2. **P2 — every `schedule` CLI invocation exits 3 on this rig.** Measured on
   the built product (`node dist/acp.js schedule list --json` with a fresh
   `HOME`): correct stdout (`{"kind":"list","schedules":[]}`), stderr
   "Schedule request finished, but cleanup failed…", exit 3; `schedule add`
   was accepted (id returned, listed afterwards) and also exited 3 with
   "Background scheduling is unavailable on this host.". Cause chain from a
   direct bundle run (`createRuntimeSchedules` from `dist/schedules.js`,
   then `close()`): `runtime.ts:206` close → `background.reconcile()`
   (`background.ts:67`, which calls `entry.remove()` even with no consent
   record) → `retireLaunchd` → `isRegistered` → the governed
   `launchctl` runner (`nodeBackgroundIo.ts`, `backgroundProcessRunner`)
   throws `unavailable` with cause **"Resource admission unavailable"**.
   This sandbox may be what blocks the resource governor, so per the rig
   rules this was stopped and is reported, not worked around. The lead must
   reproduce from a real packaged install outside the sandbox: if it
   reproduces there, reconcile-on-close must not turn a successful read-only
   command into a cleanup failure when no background entry was ever
   consented to or recorded.
3. **P2 — limits of ours that remain** (none introduced by the delivery
   lane's own commits, all still in force): v1 `/loop` jobs still expire
   after seven days (`src/core/backends/modelapi/schedulesEntry.ts:309`;
   removing it needs a stored-schema change and a bounded way to search
   cron expressions that may never match, e.g. `0 0 31 2 *` — a design
   decision, not a review edit); a schedule auto-pauses after 3 consecutive
   failures (`src/core/schedules/store.ts:653`, `SCHEDULE_PAUSE_AFTER_FAILURES`)
   although retry should be the person's; caps at
   `src/shared/constants.ts:4252-4318` (200 per workspace, 4,000 prompt
   chars, 60 s minimum interval, agent 10 active / 15 min / depth 1, audit
   100 rows / 30 days). These belong to the owner's no-limits decision
   (2026-10-16) and its lanes; listed here so none is mistaken for done.
   The question-defer bounds (`QUESTION_DEFER_MIN/MAX_SECONDS`, clamped
   person setting `questions.deferAfterSeconds`) are M112's, noted for
   completeness.
4. **Still unwired, already disclosed by the lane and still true**:
   `ScheduleReportActionRunner` and `scheduleReportTool`
   (`src/core/schedules/reportAction.ts:53,163`) and `mountScheduleSurface`
   (`src/webview/schedules/ScheduleSurface.tsx:441`) keep their `@unwired`
   tags; report-action schedules refuse truthfully
   (`reportAction.unavailable`).

## The merge with main

`git merge --no-ff 898a26c5e3` (release 0.18.2) answered "Already up to
date": `898a26c5e3`, local `main` and `main-now` (`3d30a7321`, the lane's
base) are all ancestors of this branch. No conflicts, no merge commit.

## Gates on the final tree (macmini, exit codes)

- `npm run typecheck`: 0 (all projects).
- ESLint `--max-warnings=0` and Prettier `--check` on every file this
  review changed: 0 / 0.
- `npm run check:l10n`: 0 (0 problems). `npm run check:reference`: 0 (74
  features, current). `npm run check:host-api`: 0. `npm run check:plan`: 0
  drift. `npm run check:roadmap`: current.
- `npm run deadcode` (knip): 0. `npm run cycles`: 0. `npm run duplication`:
  0 clones.
- `npm run build`: 0 to third-party notices (`dist/schedules.js` 198.6/200
  KiB; schedule surface 40.9/50 KiB; no cap raised).
- `npm run security:audit`: 0 (2 advisories: 1 excepted, 1 noted).
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: **2 — could not
  run**: semgrep itself fails to start in this sandbox
  (`ca-certs: empty trust anchors`), measured from its own output. The
  lane's own SAST 0 on wslpc is neither confirmed nor contradicted here.
- Tests (repo default timeouts, `--maxWorkers=3`, at most 3 files a run):
  `scheduleStoreRoot` 3/3, `schedulePromptLoop` 2/2 (red before the fix),
  `scheduleWorkspaceBridge` 6/6, `scheduleBinding` 1/1,
  `scheduleRestoreSwitch` 2/2, `schedules` 11/11, `scheduleTime` 9/9,
  `scheduleLazyOwners` 1/1, `scheduleLegacyDailyBudget` 1/1,
  `scheduleRegistration` 6/6, `scheduleProvenance` 6/6,
  `test/e2e/schedulesStdio.e2e.test.ts` 3/3 (real built agent).
- Packed-product drill (no model call): built once, then
  `node dist/acp.js --help` exit 0 with no schedule route listed;
  `schedule list --json` and `schedule add --draft … --json` as in finding
  "not fixed 2" — management works against `schedules/v1`, every invocation
  exits 3 on this rig.
- Not run: the full dependent sweep (the lead's four-machine gate), the
  VS Code integration suite and any UI look (no GUI in this lane; no person
  -visible surface changed — prompt mapping behaviour only), and the plan's
  live check (needs a provider; forbidden here).

## The person's steps for the lead's real-life run

1. In the packed product, open the Command Palette: the three schedule
   commands are absent. In a terminal, `muse-spark-code-acp schedule list
--json` still answers (management is reachable, help hides it): decide
   whether that split is intended before the switch flips.
2. On a real packaged install outside any sandbox (macOS first), run
   `schedule list --json` with a fresh data folder and record the exit
   code. Exit 3 there confirms finding 2 as a product bug; exit 0 confines
   it to this sandbox's resource governor.
3. For the certification receipts: flip the switch in a dev build only;
   create a schedule in the editor, check create/pause/revoke/remove and
   the timeline round-trip through `schedules/v1`; confirm `/loop` opens
   the editor with **no end preset** (this review's fix 2).
4. Pre-version store: put a folder and a file under
   `<dataDir>/schedules/`, start once on a tree that already has
   `schedules/v1/` content of the same names; the folder's other files
   appear under `v1`, the existing `v1` file is unchanged, and the stale
   legacy file is still beside `v1` (fix 1).
5. Model API schedule consent: creation names payer, model, key, tariff and
   both caps once; changing the model makes the next fire refuse until an
   interactive renewal; no popup ever opens from an unattended fire.
6. The plan's live check (one once-schedule per backend, approval outside
   the grant, a question, a file read inside the grant) remains the only
   proof of unattended delivery and still needs its counted provider run.
