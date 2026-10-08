# Windows team harness hang — FLAKETH20 (2026-10-07)

Rig: `win11`, `C:/lanes/FLAKETH20`, branch `fix/team-harness-hang`.
Base: `a715a834b` (0.15.0). Authority: the FLAKETH20 rig brief,
`C:/lanes/_ctx/codex/common.md` and repository `AGENTS.md`.
Node: 24.21.0; Vitest: 5.0.2; real headless Chromium and production bundles.
No live or paid model call, credential read, dependency, push, merge or rebase.

## Cause and evidence

The harness loads `main.js` using a dynamic `import()` from a classic script.
`DOMContentLoaded` does not wait for that import. Its handler called
`playScenario()` immediately, set `hasPlayedScenario` and started `whenFound`
with its existing three-second surface deadline. A cold bundle that arrived
later left no surface during that deadline. The callback threw, and the later
webview `ready` handshake could not restart playback because the already-played
flag had been set. The team tree therefore never arrived. Playwright's implicit
30-second locator wait then outlived the case's 20-second deadline.

Ordinary timing did not reproduce the failure: one unchanged complete file
passed all 22 cases, and the unchanged case 20 passed 100 consecutive repetitions
with `CI=true` and V8 coverage (0/100 failures, 116,385.6 ms across those repeats).
An initial unmatched name filter ran no tests and is excluded. An exploratory
30-repetition complete-file run was interrupted for the controlled capture;
none of its unfinished repetitions is counted.

The controlled real-browser capture held `/dist/webview/main.js` until after
parsing, then advanced Playwright's browser clock by 4,000 ms before releasing
the real response. The unchanged startup threw:

```text
clock.runFor: Error: never rendered: textarea, .gate, .todo-surface, [role="alert"]
```

The stack named `look` at harness line 177 and its timer callbacks at lines 180
and 150. The new browser regression failed in 8,353.5 ms, exposing an initialized
ordinary chat with no team tree instead of the case deadline. The four startup
ordering unit cases also failed before the repair. This establishes a concrete
startup race consistent with the hosted symptom; the original hosted run had no
browser capture, so its exact request timing cannot be asserted.

Local receipts: `temp/flake-team-harness-20/startup-red.log`,
`startup-regression-red.json`, `startup-unit-red.log`, `baseline-case100.json`.

## Repair

`test/harness/index.html` records the existing `ready`, `modelsPanel/ready` and
`tasksReady` handshake. `playScenario` waits for both that handshake and
`DOMContentLoaded` before claiming the scenario or spending its DOM deadline.
Both event orders deliver exactly once. No scenario delay, polling interval,
case deadline, retry or existing assertion was relaxed. No product code changed.

`test/unit/teamHarness.test.mjs` keeps console messages, page errors, failed
requests and HTTP errors from before navigation. Navigation and team readiness
each have an explicit 8,000 ms timeout inside the existing 20-second case
budget. Failures retain the original error as their cause, include a root
snapshot and identify scenario/theme/language. Diagnostics retain at most 8,192
characters, with a 4,096-character root snapshot and 1,024-character original
error message. Page cleanup remains in `finally`.

The real delayed-bundle regression advances a browser clock rather than
sleeping or raising a deadline. `harnessWaits.test.ts` checks both startup event
orders for both main and Models surfaces, including duplicate callbacks.

## Gate-fire drills

| Control                                   | Result                                                                    | Byte-exact restoration                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Original startup, new browser regression  | Failed before repair; missing team tree surfaced inside the case deadline | Original was replaced by the planned repair                                                 |
| Original startup, four new ordering cases | Four failures before repair, then all 30 owning unit cases passed         | Original was replaced by the planned repair                                                 |
| Remove `hasWebviewReady` admission        | Owning unit file exits 1                                                  | Harness SHA-256 `18cb0a0705d1160dd81fc018b37256a242a777f48233a9b25aab16f924c24e19` restored |
| Remove `hasPageLoaded` admission          | Owning unit file exits 1                                                  | Same harness SHA-256 restored                                                               |
| Disconnect console listener               | Diagnostic assertion fails for missing console evidence                   | Source SHA-256 recorded in `diagnostic-drill.json`                                          |

The diagnostic drill also checks page-error/request/HTTP evidence, preservation
of the original cause, no execution of the success callback, cleanup after
failure and bounded output under 100,000-character console and DOM messages.

## Final verification

Implementation commit: `0d1d34c2d`, with the repository's normal hooks enabled.
Its three source files stayed byte-identical throughout final verification.

| Check                                          | Result                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Case 20, `--repeats=99 -t '20 keeps viewport'` | 100 consecutive passes, zero failures; 115,403.9 ms across repeats                  |
| Complete file, 30 separate CLI invocations     | 30/30 passes; 23 cases each, 690 executions, zero failures or skips                 |
| Slowest case 20 in those complete files        | 1,282.8 ms                                                                          |
| Complete-file invocation duration              | 61.0–69.1 seconds, including preparation and coverage; 1,943.6 seconds total        |
| Owning suites with CI-style V8 coverage        | 58 passes: teamHarness 23, harnessWaits 30, harnessCapture 5                        |
| Typecheck                                      | All five projects, exit 0                                                           |
| Changed-file ESLint                            | Zero warnings, exit 0; also passed in the commit hook                               |
| Changed-file Prettier                          | Exit 0                                                                              |
| Plain Knip and duplication                     | Exit 0; zero clones                                                                 |
| Localization, host API and reference           | All exit 0                                                                          |
| Production build                               | Exit 0, unchanged size/split/globals/notices gates pass                             |
| Focused accessibility                          | 40/40 pages across four themes; zero violations, undecided rules or missing results |

The accessibility sample covers empty/sign-in, Tasks, Models, Usage, team tree,
320 px team tree, team cards and isolated Traffic surfaces. Production sizes:
extension 462.8 / 600 KiB; original deferred webview 31.9 / 50 KiB;
team UI 16.6 / 25 KiB.

All repetitions used `CI=true`, `--coverage`, `--maxWorkers=3` and repository
deadlines. Each complete-file invocation ran its real `beforeAll` preparation,
created a fresh browser and retained every case. The case-20 block built once
and used Vitest's unconditional repetitions, opening a fresh page each time.
A single registered test is reported by Vitest's JSON reporter for this block;
its `--repeats=99` executes that test 100 times and retains any failure.

Receipts under `temp/flake-team-harness-20/`: `final-case100.json`,
`final-full-1.json` through `final-full-30.json`, `final-full-summary.json`,
`owning-green.json`, `gates-summary.json` and the matching command logs.
Final source SHA-256:

| Source                           | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `test/harness/index.html`        | `18cb0a0705d1160dd81fc018b37256a242a777f48233a9b25aab16f924c24e19` |
| `test/unit/teamHarness.test.mjs` | `e3c6b8cbf9ae78ff83bc2817d77b4e6f2542de834e6a673526fa99173df3ab61` |
| `test/unit/harnessWaits.test.ts` | `341509a3e9d663c9bcb74802335ff6aae9870bef6a8fcd09bbdbbebf3a588c7a` |

Both admission-removal drills produced exactly two failures and 28 passes,
then restored the harness hash above. The console-listener drill restored the
teamHarness hash above. Its ordinary evidence message was 212 characters;
100,000-character console and root messages produced only 8,250 characters
including the error and scenario prefix. Original cause and cleanup checks
passed. Final source bytes match those in the owning-suite pass.

All coverage invocations use `--shard=1/1`, the repository's existing CI shard
coverage contract. This includes every selected test; global coverage thresholds
are applied to merged full-suite reports by the lead. `--coverage.reporter=json-summary`
only keeps the repeated receipts small. No `--testTimeout`, retry, skip or
threshold change is used.

Linux: `ssh -o BatchMode=yes -o ConnectTimeout=5 kubuntu hostname` failed with
`Host key verification failed`; WSL is not installed. No host-key trust or
machine settings were changed. The optional ten Linux runs are unavailable.
Aggregate `npm run quality` remains with the lead under the shared lane rules.
