# RLSCHED certification (M115 remainder + M115w)

Recovery lane on 0.19.0 main (branch `rec/rlsched`), 2026-10-22/23.
Windows 11 leg, owner PC, VS Code stable 1.143.1, real timers throughout;
no stand-in clock, no live model or paid calls in this lane.

Landed: C-M115-4 production event intake, lane RA with the `schedule_report`
agent tool, C-M115-6 OS wake re-arm, C-M115-8/9 recorded blocked (M96, M104),
M115w W0, WA, WS, WD, WV, WT, WU; WQ is this record plus the suites below.
`SCHEDULE_EDITOR_DELIVERY_CERTIFICATION` stays off: the lead's complete
receipts (Windows/Linux/macOS admission and safety, native modal decline,
independent review, aggregate/artifact qualification) are not all in, and
this lane produced only the Windows leg.

## Suites (all real code, `--maxWorkers=3`)

- Schedule intake/report: 34 pass
  (`scheduleEventIntake/Engine/FileWatcher/GitRefs`,
  `scheduleReportBinding/Secrecy`,
  `scheduleBackgroundReconcile`, `scheduleLazyOwners`).
- Watchdog: captures across 9 recorded GitHub fixture folders
  (`test/fixtures/m115w/github-issues/`, receipt hashes), contracts,
  `Ack/Poll/Decide/Triage` (8), command surfaces (15); watchdog+auth 46
  pass.
- CLI/help/reference/agent-outcome/auth suites touching the changed files:
  green (cli 98+47).

## Red/green drills (each broke on purpose, failed, restored, green)

| Drill                           | Break                                                | Red                                                                   | Restore                          |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| WT self-exclusion               | triage counts the issue's own body as evidence       | 2 triage tests fail, vitest exit 1                                    | restored; 8 pass                 |
| WU approval gate                | forced-off: posts beyond ack without `--approve`     | posted assertion fails, exit 1                                        | restored; 15 pass                |
| Catch guard                     | removed the NARROW guard the fix added               | `check:catches` GENERIC 265→266, exit 1                               | restored; `check:catches` exit 0 |
| C-M115-4 self-trigger           | fire the loop without awaiting the skip              | `test(schedules)` drill commit `e48212dbc5` awaits it directly        | green                            |
| Reference gate (fired for real) | new `watchdog` CLI command without catalog/help rows | `check:reference` fails: `CLI command lacks entry: watchdog` + README | added rows, regenerated; exit 0  |

Catch-debt fix (commit `b9016c12ed`): the lane's six new GENERIC
sites went NARROW (typed `GitHubError` poll guard, rethrow otherwise; zero
behaviour change) or REPORTED (report runner/tool, re-arm) via
`wireWordForLog(error.name)` with a fixed sentence and a threaded logger.
Baseline regenerated: core GENERIC 265 after the fix (2 fixed pins dropped,
1 identity churn re-pinned); `check:catches` exit 0.

## Certification leg: VS Code integration, Windows

`npx vscode-test --label stable`, lane tree, combined
`scheduleBackground` + `extension` run: `scheduleBackground` 2 pass /
1 pending (win32-gated register row) with long timings (104 s, 92 s);
`extension` 11 pass / 1 fail — `creates AGENTS.md (D15)` fails in `finally`
cleanup with `ENOENT unlink .../test/fixtures/workspace/AGENTS.md`.
Extension suite alone on the lane tree: same single failure, exit 1.

Base comparison: fresh worktree of untouched `v0.19.0`, same VS Code
1.143.1, extension suite alone: `creates AGENTS.md` fails with the
identical ENOENT signature (10 passing, 2 failing — the second, the
panel-focus test, passed on the lane tree, a timing flake either way).
The AGENTS.md failure is therefore measured on the base, unrelated to
this lane (rules-file creation path, untouched by the lane diff); left
for the lead/hosted CI. Worktree removed after the run.

## Still waiting on other milestones

- M113 lane Q destinations: reports refuse `destinationsPending` until its
  backend binds; `dist/schedules.js` 250 KiB budget unmeasured after the bind.
- M96 board binding: C-M115-8 role/team targets refuse `targetUnavailable`.
- M104 native hosts: C-M115-9 native rows wait.
- M109 taint lane T: the watchdog stays report-only (ack, triage, findings
  shown; nothing else posted).
- Governed git `poll()` success is unproven in the sandbox (`Native
governed process launch unavailable`); needs the lead/CI outside it.
