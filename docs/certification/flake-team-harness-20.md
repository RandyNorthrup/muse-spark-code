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

## Verification and remaining receipts

The repaired startup unit file passed 30/30 at repository deadlines. Required
final case-20 repetitions, 30 separate complete-file invocations and scoped
static gates are in progress and will be recorded in the completion commit.

All coverage invocations use `--shard=1/1`, the repository's existing CI shard
coverage contract. This includes every selected test; global coverage thresholds
are applied to merged full-suite reports by the lead. `--coverage.reporter=json-summary`
only keeps the repeated receipts small. No `--testTimeout`, retry, skip or
threshold change is used.

Linux: `ssh -o BatchMode=yes -o ConnectTimeout=5 kubuntu hostname` failed with
`Host key verification failed`; WSL is not installed. No host-key trust or
machine settings were changed. The optional ten Linux runs are unavailable.
Aggregate `npm run quality` remains with the lead under the shared lane rules.
