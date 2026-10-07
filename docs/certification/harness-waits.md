# Harness waits — certification (2026-10-06)

Kubuntu, `/home/randy/lanes/HARNESSWAIT`, branch `fix/harness-waits`.
Main base: `582af0470394ac3710d762a01eae52ea5c593163` (0.14.3).
Authority: the HARNESSWAIT rig brief, shared lane rules and AGENTS.md.

## Changes and timer inventory

| Original `later` calls | Converted to readiness waits | Removed obsolete no-ops | Kept with individual reasons |
| ---------------------: | ---------------------------: | ----------------------: | ---------------------------: |
|                     77 |                           38 |                       5 |                           34 |

The 34 retained timers comprise 23 asynchronous fake-host responses, five
intentional scene events (sign-in, child closure, cancellation, goal progress
and report failure), two bounded control-polling timers, and four readiness
clock/deadline/frame timers. Every retained call has an immediately preceding
`// kept-timing: ...` reason. No deadline or gate setting changed.

The five removed callbacks were the transcript fixture's click on a header
that has no click handler, and attempts to expand already folded rows in
`muse-tools`, `code-intel`, `muse-web` and `web-fetch`. The latter controls are
absent while the groups are folded; the old loops/optional clicks did nothing.
The obsolete optional `.fork-button` focus in `resume` was removed too; its
existing card hover remains. Main's reached states are preserved.

Dependent steps nest `whenFound` calls. Axe waits for outstanding callbacks
and for startup. The DOM deadline starts at `DOMContentLoaded`, after the
module graph loads. Failure still names the missing selector and fails the
page. The AST unit guard checks every timer's reason, recognizing direct DOM
methods, computed method calls, value/scroll assignments and named helpers;
DOM words inside strings do not count as code.

Chrome's command-line virtual-time capture stalled before rendering. Adding a
capture deadline returned blank pages; those images were discarded. The
existing screenshot helper now uses the already installed Playwright dependency
and the harness's timed-event settle plus `whenReady` condition. It captures
only after readiness and closes its browser on success or failure. No dependency
was installed and no shipped bundle changed.

Files: `test/harness/index.html`, `scripts/lib/harnessCapture.mjs`,
`test/unit/harnessWaits.test.ts`, `test/unit/harnessCapture.test.mjs`,
`CONTRIBUTING.md`, `CHANGELOG.md`, `PLAN.md`, and this record.

## Visual comparison

Both runs used the same production bundles, Playwright capture helper, light
theme and 690 × 760 viewport. Main's original harness source was saved before
editing under `temp/harness-waits/main/test/harness/index.html` inside this
worktree (SHA-256
`5cba3e9b30f926e31d8a64e0f5037a105af8f9e47fdb7c58914eeb0f505b7a56`,
verified against `git show` at the main base). Each run used:

```sh
node scripts/harness-shots.mjs chips transcript chat-tool-menu dictation agents jump quote-chip plan history-archived review-comment --theme=light
```

All ten reached the same state. Side-by-side sheets were inspected at original
resolution: `temp/harness-waits/compare-final-1.png` and `compare-final-2.png`.
The jump image was recaptured after the native-scroll and repin fixes with
`node scripts/harness-shots.mjs jump --theme=light`.
The final individual images are in `harness-shots/light/`; main's images are in
`temp/harness-waits/main/harness-shots/light/`.

| Scene            | Reached state                                                         | Observed difference                                                                                       |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| chips            | Image attached, draft filled                                          | Native caret blink                                                                                        |
| transcript       | Initial message and steer, both echoes                                | None; identical pixels                                                                                    |
| chat-tool-menu   | Expanded steps, edit actions open                                     | None; identical pixels                                                                                    |
| dictation        | Microphone listening                                                  | None; identical pixels                                                                                    |
| agents           | Map open with two children                                            | Elapsed-time label                                                                                        |
| jump             | Scrolled to the top, New messages button, completed highlighted reply | Glyph-edge/color-fringe rendering differs on 40,090 pixels; text, highlighting, layout and controls match |
| quote-chip       | Quote reference and follow-up draft                                   | None; identical pixels                                                                                    |
| plan             | Plan reply, Save/Implement, Plan mode                                 | Message clock time                                                                                        |
| history-archived | Archived toggle checked, second row selected                          | None; identical pixels                                                                                    |
| review-comment   | Accepted/reverted/refused changes and comment draft                   | 15 border pixels differ by one RGB level                                                                  |

## Verification

All commands ran directly on Kubuntu. Vitest used repository default per-test
timeouts, at most three files per invocation and `--maxWorkers=3` throughout.
Final invocations were:

```sh
npx vitest run test/unit/harnessWaits.test.ts test/unit/harnessCapture.test.mjs test/unit/chatColumn.test.mjs --maxWorkers=3
npx vitest run test/unit/readmeShots.test.mjs --maxWorkers=3
```

Both exited 0. The owning files are `harnessWaits.test.ts` (20), `harnessCapture.test.mjs` (2),
`chatColumn.test.mjs` (6), and `readmeShots.test.mjs` (10): 38 tests total.

The first full accessibility run printed zero violations but found 24 scene
errors: six scenarios in four themes. Incorrect model/stream selectors were
corrected; four waits for intentionally folded controls were removed. The
correction run passed all 24 pages with zero violations, undecided rules or
missing results. A subsequent full sweep found five cold-start pages where
script loading spent the DOM polling deadline. Startup now waits for the
module-load event and is included in readiness; its regression uses the actual
harness startup code, runs before/after the event, and checks once-only delivery.

A following sweep had one missing jump result. Both waiting for the streamed
reply to finish and waiting for its lazy code block exceeded the existing
control deadline on the loaded rig. That path was stopped. Jump now preloads
the same completed reply; the separate `long` scene still streams it. A static
prototype missed the New messages control on three of four pages once the
readiness predicate required it. Waiting solely for a native scroll passed a
focused check, but its full sweep had one missing dark/jump result; completing
the preloaded reply still failed two of four focused pages. That path was
stopped too. Waiting for highlighted content plus a synthetic scroll and a
settling wait passed focused checks and reached main's visible state, but failed two
jump pages in the full sweep.

The warmed-context trace (`trace-jump-warm.log`, 12 concurrent pages × three
rounds) reproduced 25 lost buttons in 36 pages. It captured the synthetic
scroll, new message, then delayed native scroll: the latter recorded the new
message as already seen and hid the button. For example, one page delivered
the delta at 3,522 ms and the native scroll at 3,668 ms. The final fixture waits
for highlighted content, guarantees one native scroll (moving one pixel and
back if already at zero), then delivers new content after that event. It has
no synthetic scroll. The runtime regression delays the event at both initial
positions: both cases failed before the fix and passed after. The next
warmed run had one failure in 36: a pending layout repinned the panel after
the native event, before new content was sent. The fixture now requeues the
native scroll whenever the panel has moved from zero before publication.
The corresponding third regression case failed before this recheck and passed
after. All three check once-only delivery. No production scrolling behavior changed.

| Check                           | Result                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck`             | All five projects, exit 0                                                       |
| Final unit-project compile      | Exit 0 after startup and native-scroll regressions                              |
| Scoped ESLint, zero warnings    | Exit 0                                                                          |
| Scoped Prettier                 | All eight changed files, exit 0                                                 |
| Plain Knip (`npm run deadcode`) | Exit 0; existing configuration hints only                                       |
| `npx jscpd`                     | Exit 0; zero clones, repeated after native-scroll regression                    |
| `npm run check:l10n`            | 14 tables, zero problems                                                        |
| `npm run check:host-api`        | Zero problems                                                                   |
| `npm run check:reference`       | Current                                                                         |
| `npm run build`                 | Exit 0, size/split/globals/notices checks pass                                  |
| Full `node scripts/a11y.mjs`    | 716 pages (179 scenes × four themes), zero violations/undecided/missing, exit 0 |
| Final warmed-context jump trace | 36 pages, zero lost buttons/scenario errors/violations; exit 0                  |
| Final owning unit invocations   | 38 passes, zero failures, default timeouts                                      |

Final full receipt: `temp/harness-waits/a11y-complete-final.log`.
The existing gate reports 2,433 covered/off-screen contrast elements and 76
glyph-only elements that axe cannot measure; zero exemptions were taken.
The existing classification and all deadlines remain unchanged. Final unit
receipts are `complete-tests-final.log` (28 passes) and
`complete-readme-final.log` (10 passes). The 36-page warmed-context assertion
is `trace-jump-final-summary.log` (zero failures).

Production measurements: extension 441.6 / 600 KiB; Model API 447.3 / 475 KiB;
ACP 823.6 / 850 KiB; webview startup 733.1 / 900 KiB; uiText 54.1 / 125 KiB.
All other existing caps pass unchanged.

Aggregate `npm run quality`, full-suite coverage and hosted cross-platform
certification remain with the lead, as the rig/shared brief requires; PLAN §7
records that delegation. No merge, push, live/paid model call, credential read,
new escape hatch or dependency change occurred.

## Failure controls and exact restoration

Each control failed as intended, then its edited source was restored with
matching before/after SHA-256. Final owning tests passed again after restoration.

| Control                                                                                                                     | Observed failure                                                                | Receipt                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| Replace the agents-pill readiness wait with the original `later(300, () => document.querySelector('.agents-pill').click())` | Source guard identifies unexplained delayed DOM work; one failed test, exit 1   | `guard-complete-drill.log`  |
| Invoke startup immediately rather than once at `DOMContentLoaded`                                                           | Startup assertion sees two actions before the event; one failed test, exit 1    | `startup-drill-final.log`   |
| Remove `await` from screenshot readiness                                                                                    | Early screenshot and failure-handling assertions both fail, exit 1              | `capture-drill.log`         |
| Require `.missing-jump-drill` instead of `.jump-latest`                                                                     | All four jump pages report no readiness result, exit 1                          | `jump-readiness-drill.log`  |
| Replace the native-scroll listener with immediate callback delivery                                                         | All three ordering cases emit new content too early; three failed tests, exit 1 | `native-complete-drill.log` |
| Remove the zero-position recheck after the native event                                                                     | The repin case publishes too early; one failed test, exit 1                     | `repin-drill.log`           |

All local receipts are under `temp/harness-waits/` (untracked).

The old-click, native-order and repin drills were repeated against the final source;
their before/after
SHA-256 is
`e771d484fb7291ebe36a800f071bcb615dfa79363e8ae14069935b5bdb34c73f`.
Startup and missing-marker controls preceded the final jump fixture correction;
their matching before/after harness SHA-256 was
`2ca5659082073915efbdb5097cafbdf600b40faf6380ac757184924d5f60a3a4`.
The capture helper's matching before/after SHA-256 was
`5be83f6bc1003373c82e6da1f34f1e4d8371ce221cb09d55c1b67b6b0d7410fb`.
