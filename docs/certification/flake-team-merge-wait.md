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

`test/harness/index.html`: `playScenario` claims the scene by name. A scene
is played only when it says so: its final continuation calls
`scenarioDone()` (see the third review below for the history), and the page
then carries `<html data-scenario-played="<name>">` once nothing the scene or
the fake host scheduled is outstanding.

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

## Review RVTEAMFLAKE (Codex, P2): awaited native events (superseded below)

Finding: the `jump` scene registered a raw `scroll` listener. Its last
`whenFound` returned, both counters reached zero and the page read
`data-scenario-played="jump"` before the scroll ran its nested
`whenFound('main', …)`, sent the new-message frames or waited for
`.jump-latest`; a failure after the scroll left the mark in place.

Repair at the root: one counted step (`beginStep`) behind `later`, the new
`whenEvent(target, type, fn)` for awaited native events and `track(promise)`
for awaited promises. The mark is withheld while any of them is outstanding,
withdrawn when new counted work starts, and withdrawn for good when a step
fails (`failScene`). A source guard in `harnessWaits.test.ts` follows every
`steps` entry and the fake host's `postMessage` replies through the helpers
they call and fails on any listener, `on…` callback, `then`/`catch`/
`finally`, `fetch`, `new Promise`, frame, timer or microtask started outside
the counted helpers, unless a `// counted: <reason>` comment records a count
kept by hand.

Audit of every listener, callback and promise chain in the harness:

| Site                                                                                                                | Before                                  | Now                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| `jump`: native `scroll` on `main`                                                                                   | raw listener, uncounted                 | `whenEvent`                                               |
| Fake host `readReference`: two fetches, then `referenceValues` (Help scenes)                                        | promise chain, uncounted                | `track`, until the reply is sent                          |
| Page theme (`?theme=`): fetch and apply                                                                             | promise, uncounted                      | `track`                                                   |
| `long`: `MessageChannel` continuation and the window `message` listener                                             | one event counted by hand               | unchanged count, `// counted:`; failure calls `failScene` |
| Fake host replies and scene polls through `later` and `whenFound`                                                   | counted                                 | counted (now through `beginStep`)                         |
| Traffic harness: `import().then(mount)` and the `traffic-outgoing` listener                                         | own `data-traffic-ready` signal         | not a claimed scene; unchanged                            |
| `DOMContentLoaded` (starts `playScenario`), window `error` (harness errors)                                         | page setup and reporting                | unchanged                                                 |
| Accessibility scan: `loadAxe` load/error, `whenReady` frames and timers, `blur`/visibility, the `themed.then` chain | readiness for the scan, after the scene | unchanged                                                 |

Messages a scene posts are still delivered to the webview after the mark;
the target's own wait covers their handling and rendering.

Regressions (`harnessWaits.test.ts`): the jump scene stays unplayed until its
scroll has run its steps (premature completion); it never reads played when
a step after the scroll fails (failure after the event); the mark is withdrawn
while new work runs and for good after a later failure; a tracked promise
holds the scene and its rejection fails it; the guard passes on the harness
and catches a raw listener, a promise chain, a port callback, a frame
callback and work inside a called helper.

| Drill                                                                | Result                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `harnessWaits.test.ts` against the harness of `de4b2f552`        | exit 1, 6 failures: both jump regressions (`expected { scenarioPlayed: 'jump' } to deeply equal {}`), the guard, withdraw-on-new-work, tracked promise, long-stream failure |
| Red drill: `jump` back to a raw `main.addEventListener('scroll', …)` | exit 1, 6 failures: the guard (`uncounted addEventListener: main.addEventListener('scroll', …`), both jump regressions and the three native-scroll cases                    |

Both restored the harness byte for byte (SHA-256
`fe1e1cfd93974a931d81e3c57f16bd086cd4cf43cc7f6889efdfe80344843078`).

Review gates, repository deadlines: `harnessWaits.test.ts` (44),
`teamHarness.test.mjs` (24) and `harnessCapture.test.mjs` (7) passed 75/75
three times on Kubuntu and three times on the Win11 VM; `typecheck:unit`,
ESLint `--max-warnings=0` and Prettier on the changed files and jscpd (0
clones) all exit 0.

## Review RVTEAMFLAKE2 (Codex, P2 + P3): redesigned to explicit completion

This was the third review round of the played signal, so the mechanism was
redesigned rather than patched. Finding: the static `uncountedAsync` guard
above accepted ordinary uncounted forms (a bound `addEventListener`, an
aliased `setTimeout`, an async helper awaiting a stored promise, detached
timers inside `track(...)`, one `// counted:` comment for several
registrations, computed listener access, `readinessLater`, a method-shorthand
`postMessage`, `steps.extra = ...`). A scan for asynchronous constructs can
never be complete. P3: an unexplained `as` on the extracted `track`.

Design:

- **Explicit completion.** Scenes must schedule all work through the counted
  helpers and call `scenarioDone()` from their final continuation; a scene is
  played only when it does. The mark is set by that call alone,
  as soon as nothing the scene (`later`, `whenFound`, `whenEvent`, `track`) or
  the fake host (`hostLater`, `hostTrack`, the page theme included) scheduled
  is outstanding, and never after a failure. Running out of scheduled work no
  longer marks anything.
- **Runtime enforcement.** A scene helper called after `scenarioDone()` fails
  the scene, as does a second call. The fake host may still answer the
  webview afterwards. A counted failure at any time, before or after the call,
  removes the mark for good and records itself in
  `<html data-scenario-failed>`.
- **Scope.** The scenes a test waits on are `PLAYED_SCENARIOS`
  (`scripts/lib/harnessServer.mjs`): `team-tree`, `team-tree-320`,
  `team-cards`, `question`, `legal-preview` (the team and capture tests'
  scenes) and `jump`. Each ends with `scenarioDone()`; the question card moved
  into `questionFixture()` so the scenes that go on from it do not inherit
  the call. `harness()` refuses any other scene. Other scenes carry no mark.
- **Behavioural coverage** replaces the static guard (removed). In a real
  browser, with the page's host messages, synthetic events and scripted
  clicks logged from before its scripts run, each `PLAYED_SCENARIOS` scene
  must be marked exactly once, at its own end (its final action logged, or
  its end control on screen at the moment the mark appears), and make no
  logged move for `SCENE_QUIET_WINDOW_MS` (1.5 s, five times the longest
  scripted pause of these scenes) afterwards. An injected failure in the final
  step must leave the mark unset and the failure recorded, and `banner`, which
  never calls `scenarioDone()`, must fail the check. These checks test order,
  not speed, so navigation and the scene share `SCENE_DONE_TIMEOUT_MS` (15 s,
  the case deadline less the window and diagnostics); a first run with the
  team tests' 8 s bound timed out twice on the loaded VM. A DOM snapshot was not
  used as the settled signal: after the mark the webview still renders what
  the scene delivered (the team cards' lazy chunk is exactly what the team
  tests then time) and its status line keeps changing, so the scene's own
  logged moves are what must stop. The coverage verifies ordering, a quiet
  window for logged moves and (since the next review) the absence of page
  errors. Work started outside the helpers (raw timers, detached promises) is
  not detected: keeping it out of scenes is a code-review rule for scene
  authors, not something the harness proves.
- **P3.** The extracted page function is checked at runtime
  (`pageFunction`: `typeof` guard, then `Reflect.apply`); no assertion remains.

Regressions: `harnessWaits.test.ts` (46) covers the reviewer's bound-listener
jump variant and the async-helper fixture (neither marked before its end),
outstanding work at the call, a scene that never calls it, each scene helper
after the call, a late host reply and its failure, the injected final-step
failure, tracked promises and the nested jump failure. `teamHarness.test.mjs`
adds 14 browser cases: one end name per scene, six completion checks, six
injected failures and the missing-call case.

| Drill                                                         | Result                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New `harnessWaits.test.ts` against the harness of `ec6e062e0` | exit 1, 14 failures, among them both reviewer variants (`expected { scenarioPlayed: 'jump' }` / `{ scenarioPlayed: 'example' } to deeply equal {}`)          |
| New browser coverage against the harness of `ec6e062e0`       | exit 1, 8 failures: `banner` reads played without the call, no injected failure is possible, and `legal-preview` was marked before its preview was on screen |
| Red drill: scene helpers allowed after `scenarioDone()`       | exit 1, the four after-done cases fail                                                                                                                       |
| Red drill: `team-cards` without `scenarioDone()` (Kubuntu)    | exit 1, 6 failures: its four target cases, its completion and injected-failure checks, each reporting `team-cards never called scenarioDone()`               |

Every drill restored the harness byte for byte (SHA-256
`30500a7fb9782853df1cf7232be3ce5409f873793cacece1926f06e1afec995f`).

Review gates, repository deadlines: `teamHarness.test.mjs` (38),
`harnessWaits.test.ts` (46) and `harnessCapture.test.mjs` (7) passed 91/91
three times on Kubuntu and three times on the Win11 VM, on snapshots equal to
the commit; `typecheck:unit`, ESLint `--max-warnings=0` and Prettier on the
changed files and jscpd (0 clones) all exit 0.

## Review RVTEAMFLAKE3 (Codex, P2): page errors and honest limits

Finding: the completion coverage could not see work started outside the
counted helpers. A raw `setTimeout` that removed the tree or threw after the
mark, a microtask after `scenarioDone()`, and a raw timer longer than the
1.5 s window all passed, and page errors were not collected.

Final round, no further redesign. `sceneLog` now collects every page error
and console error (only the browser's own `/favicon.ico` request, which has
no file to serve, is ignored) from page creation to the end of the quiet
window, and `expectSceneFinished` fails a listed scene on any of them; the
injected-failure cases expect exactly that one page error. The reviewer's
raw-timer-throw probe is a regression: `team-tree` served with a raw
`setTimeout` that throws 600 ms after its final click passes every logged
check, and fails only on its page error.

The claims now say what is proved. Scenes must schedule all work through the
counted helpers and call `scenarioDone()` from their final continuation. The
coverage test verifies ordering, a quiet window for logged moves and the
absence of page errors. Work started outside the helpers (raw timers,
detached promises) is not detected, so it is a code-review rule for scene
authors, not something the harness proves: a raw timer that changes the DOM
without failing, or that runs after the window, still passes.

| Drill                                                   | Result                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The probe with page errors collected (Kubuntu)          | exit 0: the regression sees `pageerror: review raw scene failure` and the check fails on it |
| Red drill: page errors not collected, as in `7422708dd` | exit 1: the regression fails (`expected [] to deeply equal [ Array(1) ]`)                   |

The drill restored `teamHarness.test.mjs` byte for byte.

Gates: `teamHarness.test.mjs` (39), `harnessWaits.test.ts` (46) and
`harnessCapture.test.mjs` (7) passed 92/92 on Kubuntu at repository
deadlines; ESLint `--max-warnings=0` and Prettier on the changed files and
jscpd (0 clones) exit 0.

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
| The same on the commit rebased onto `67099ce1b`, Win11 VM                    | 57/57 three times, exit 0 |
| The same on the rebased commit, Kubuntu                                      | 57/57 three times, exit 0 |
| `typecheck:unit`                                                             | exit 0                    |
| ESLint `--max-warnings=0` on the changed test files                          | exit 0                    |
| Prettier on every changed file                                               | exit 0                    |
| jscpd                                                                        | 0 clones, exit 0          |

The Windows workstation was too loaded to finish the browser file's 60 s
setup (its production build alone took 63 s), so the real file ran on rigs.
On the VM and on Kubuntu the first run after installing the rebased lockfile
hit that unchanged 60 s setup deadline before any case ran (cold caches, as
the baseline's first runs did); the three runs after it are the ones counted.
Hosted CI remains the merge gate.
