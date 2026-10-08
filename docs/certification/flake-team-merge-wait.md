# Team harness merge-card wait — FLAKEMERGE (2026-10-08)

Branch `fix/team-harness-merge-wait`, from `origin/main` `4da4ef666` (0.16.0).
Hosted failure: CI run 37732929826 attempt 1, `tests (windows-latest, shard 4)`
(job 113165939685), release/0.16.0 head `c2e0932aa`:
`19 preserves targets on waiting and merge cards at 320 px in the
pseudo-locale` timed out after 8,000 ms waiting for `.activity-team-merge`.
Attempt 2 of the same commit passed the case in 1,343 ms. No live or paid
model call, credential, dependency, push, merge or machine setting.

## Cause and evidence

The case's 8 s DOM wait started when `page.goto` returned at the load event.
The harness imports the webview bundle dynamically, so that wait also paid for
the bundle's evaluation and start-up (with the 500 KB pseudo table installed),
the ready handshake, the harness's 300 ms settle and 50 ms polls before the
scene, the scene's steps, and only then the lazy team chunk and the cards. PR
#139 moved the harness's own 3 s step deadline behind the ready handshake; the
test's own deadline still started at load.

- **Not a hang.** In the failing job every other harness page took
  999–1,058 ms; the failing page drew its whole transcript and status line
  (the scene had run) with no card, and recorded no console message, page
  error, failed request or HTTP error.
- **A slow tail on hosted Windows.** Across the 21 Windows test jobs since
  2026-10-07 18:00Z that ran this file, the pseudo-locale case took 1,173–2,216
  ms in 15 runs, then 2,575, 2,671, 4,176, 4,244 and 7,090 ms (passes) and
  8,210 ms (the failure): a continuous tail up to the deadline. English
  team-cards pages on Windows (n=84): p50 1,190 ms, p90 1,688 ms. Pseudo on
  Linux (n=22) peaked at 2,077 ms, on macOS (n=22) at 4,182 ms.
- **Where the time goes.** With the played signal below and widened waits
  (measurement only), Chrome's renderer throttled 22× on Kubuntu:
  navigation 0.9–1.8 s, page start-up plus playback 5.2–8.0 s, the target
  after playback 1.2–2.4 s, for all 16 harness pages. The pseudo page had the
  longest playback (8.0 s) and target (1.9 s). The old wait therefore spent
  about 80% of its budget before the merge step was even played. An idle
  Windows VM, unthrottled: playback about 0.9 s, target 3–50 ms.
- **Reproduced on Windows.** The real file with every harness page's
  renderer throttled 12× once navigation had loaded (the hosted profile:
  the failing page loaded in about 0.2 s) on the Win11 VM failed 4 of 15
  harness pages, among them the pseudo case with the hosted message
  unchanged (`waiting for locator('.activity-team-merge')`, transcript and
  status line drawn, no card).

No hang was reproduced: 360 unthrottled team-cards pseudo pages on the loaded
Windows workstation (up to four at a time) all rendered the merge card within
8 s (maximum 6.6 s from page creation), and 24 pseudo and English pages in six
fresh browsers on the idle VM kept the phases above every time.

## Repair

`test/harness/index.html`: `playScenario` claims the scene by name, and
`later` notes when the claimed scene's steps, every `whenFound` and every
scheduled event have run; the page then carries
`<html data-scenario-played="<name>">`. A step that throws (including a
control that never rendered) marks the scene failed, so the attribute is
never set after a failure. The long-stream scene, which ends outside `later`,
reports itself.

`test/unit/teamHarness.test.mjs`: navigation and playback share the existing
`REAL_HARNESS_WAIT_TIMEOUT_MS` (8 s), measured from before navigation; the
merge-card and tree wait keeps its 8 s and starts at the played signal. Both
explicit waits plus the diagnostics stay inside the unchanged 20 s case
deadline. A failed wait now also lists requests still open. No deadline,
retry, skip or assertion changed; the pseudo case still asserts every card
target at 320 px.

## Regressions and gate-fire drills

| Control                                            | Result                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `later` no longer notes the scene played           | `harnessWaits.test.ts` exit 1: the nested-waits played case fails          |
| `later`'s catch no longer marks the scene failed   | exit 1: "never reports a scene played once one of its steps has failed"    |
| `playScenario` no longer claims the scene          | exit 1: the four start-once cases fail                                     |
| Original harness with the new test file (Mac mini) | exit 1: the new browser regression and the pseudo case wait for the signal |

The first three drills restored the sources byte for byte (SHA-256
`test/harness/index.html` `18fc43a0dc259920d96717be72ccf058e1b8b7e3ab779310f14a4b188ec33f12`,
`test/unit/harnessWaits.test.ts` `34595cafa10e95ac2828d8af95c65fd5affbd092019e4181a9f4152f1c26d086`,
`test/unit/teamHarness.test.mjs` `c16968d7c809aa54b90931918a285641d0758a88a87345d3c7748feac300c754`).
The new browser regression holds the real team UI chunk until the harness
reports the scene played, then checks no card exists yet.

## Before and after under starvation

Each run is the complete file (CI coverage flags, repository deadlines) with
one added line per harness page throttling Chrome's renderer after navigation
loaded; the throttled copy was never committed. Counts are harness pages.

| Rig and throttle         | Before (`4da4ef666`)                                                         | After (this branch)                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Kubuntu, 20× after load  | 5 of 5 runs failed; 59 of 75 pages, every one at the merge-card or tree wait | 20 runs, 11 fully green; 27 of 320 pages failed, every one at the played wait; none at the target wait |
| Win11 VM, 12× after load | 2 clean runs failed; 15 of 30 pages, all at the target wait                  | 9 clean runs, 4 fully green; 11 of 144 pages failed at the played wait; none at the target wait        |

Kubuntu was idle throughout. On the VM other lanes ran at the same time: of
11 before and 32 after runs, 8 and 23 lost every case to SSH resets or the
60 s setup deadline, and one before run whose unthrottled Traffic cases took
over 3 s was set aside as outside load.

After the repair no merge-card or tree wait failed in 464 throttled pages.
What still fails at these throttles is the page's own start-up and playback
passing 8 s, and it now fails as that, by name, instead of as a missing merge
card. These throttles are harsher than any hosted run so far: by the measured
split (about 80% start-up and playback), the slowest hosted pass and failure
(7.1 s and 8.2 s) correspond to roughly 5.7–6.6 s of start-up and playback,
inside the 8 s bound. Cutting the per-case cold start is the §8 exit
plan for `REAL_HARNESS_CASE_TIMEOUT_MS` (one page per theme with in-page
scenario switching), not part of this change.

## Gates

Repository deadlines, no `--testTimeout`, retry or skip.

| Check                                                                        | Result                    |
| ---------------------------------------------------------------------------- | ------------------------- |
| `harnessWaits.test.ts` (Windows workstation)                                 | 33/33, exit 0             |
| `harnessCapture.test.mjs` (Windows workstation; slices the same harness)     | 7/7, exit 0               |
| `teamHarness.test.mjs` + `harnessWaits.test.ts`, CI coverage flags, Mac mini | 57/57 three times, exit 0 |
| `typecheck:unit`                                                             | exit 0                    |
| ESLint `--max-warnings=0` on the changed test files                          | exit 0                    |
| Prettier on every changed file                                               | exit 0                    |
| jscpd                                                                        | 0 clones, exit 0          |

The Windows workstation was too loaded to finish the browser file's 60 s
setup (its production build alone took 63 s), so the real file ran on rigs.
Hosted CI remains the merge gate.
