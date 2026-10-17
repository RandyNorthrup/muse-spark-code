# MENUFAN — menus close to the row opener

Owner brief: 2026-10-10, `owner-2026-10-10-menu-fan`.
Branch: `fix/menu-fan`, based on `82d50d5e4` (0.17.0). Machine: Kubuntu.
No model attempts, paid calls, dependencies, or installs.

The selected transcript row supplies its own `.row-actions-button` centre
in viewport coordinates. Only a row without that button uses the pointer.
Both bursts keep the existing whole-stack edge shift, now with 6 px gaps,
a 16 px bow and the unchanged 16 px reach. Mid-panel fans centre on the
opener. Pills remain crisp, one width per burst, measured from the widest
label. Row actions already use ids; the named host/protocol English matches
were comments, which now quote the current labels.

The visual driver's settled quote replay previously tried to select prose
while the existing menu had made it inert. That collapsed the selection and
captured Copy Response / Reply to This Output. Closing the existing menu
before selecting again captures all three quote actions. The browser test
requires three pills, each 16–32 px horizontally from the opener, a centred
stack and 6 px gaps, at both 320 and 690 px.

English labels changed (translations retain their casing):

- `promptSave`: Save Prompt
- `sharePrompt`: Share Prompt…
- `askAboutThis`: Ask About This
- `commentOnThis`: Comment on This
- `copyResponse`: Copy Response
- `replyToOutput`: Reply to This Output
- `rewindConversationToHere`: Rewind Conversation to Here
- `rewindCodeToHere`: Rewind Code to Here
- `restoreFilesToHere`: Restore Files to Here
- `rewindAndRestore`: Rewind Conversation and Restore Files
- `promptUseSaved`: Use Saved Prompt…
- `promptLibrary`: Prompt Library
- `rowOpenOutput`: Open Output
- `rowMoreActions`: More Actions
- `messageActions`: Message Actions
- `quoteMenuLabel`: Highlighted Text
- `rewindMenuLabel`: Fork or Rewind
- `queuedMenuLabel`: Queued Message Actions
- `queuedDelivered`: Already Delivered to the Running Turn

Existing action labels already in Title Case: Fork Conversation, Fork and
Rewind, Rewind, Copy, Edit, Redo, Review, Revert, Dismiss. Disabled explanatory
notes remain sentences.

The English keyboard reference captions also follow their current action
labels: `referenceRowKeys` is `ContextMenu / Shift+F10: More Actions`, and
`referenceOutputKeys` is `Open Output`. Manifest command names remain the
names supplied by the manifest.

## Screenshots and measurements

All twelve 320×800 / 690×800 PNGs are outside git:

| Scene              | Before                                   | After                                   |
| ------------------ | ---------------------------------------- | --------------------------------------- |
| rewind, 320 px     | `temp/menufan/before/rewind-320.png`     | `temp/menufan/after/rewind-320.png`     |
| rewind, 690 px     | `temp/menufan/before/rewind-690.png`     | `temp/menufan/after/rewind-690.png`     |
| assistant, 320 px  | `temp/menufan/before/assistant-320.png`  | `temp/menufan/after/assistant-320.png`  |
| assistant, 690 px  | `temp/menufan/before/assistant-690.png`  | `temp/menufan/after/assistant-690.png`  |
| quote-menu, 320 px | `temp/menufan/before/quote-menu-320.png` | `temp/menufan/after/quote-menu-320.png` |
| quote-menu, 690 px | `temp/menufan/before/quote-menu-690.png` | `temp/menufan/after/quote-menu-690.png` |

`temp/menufan/{before,after}/measurements.json` records all pill bounds. After:
user-menu near ends 24.11–32 px, assistant-menu near ends 29.86 px, selection
near ends 27.94–32 px; every gap 6 px at both widths. The five-item user
menu's last centre is 144 px below its opener (previously 220 px).
README `quote.png`, `rewind.png` and `history.png` were regenerated with
`node scripts/readme-shots.mjs --only quote,rewind,history`; curated media
uses 1,502,404 of its 2,097,152-byte cap.

## Regression drills

- Before implementation the new 320/690 px layout cases failed: near end
  43.7128 px exceeded 32 px (`temp/menufan/geometry-before.log`).
- Origin: remove the row-button origin, restoring the pointer. The browser
  regression exits 1: a selection pill is 344.9375 px from the opener,
  exceeding 32.02 px (`temp/menufan/drill-origin.log`). Restore SHA-256:
  `5a4797e99861415d1b94c67a7b0374fb5deb31f0c557d7dd6875e2e42a61a5f1`.
- Gap: restore 20 px while retaining the 16 px bow. The layout suite exits
  1: the 6 px gap assertions fail, as do the explicit centred-stack and
  second-burst positions (`temp/menufan/drill-gap.log`). Restore SHA-256:
  `f9a29e96d0500e3afb100385a99123dd690b218ad866450fa0609626bb02b1c3`.

- Additional guard drill: replace the selection origin with the page corner
  and omit the capture's close-before-reselect step. Both native App origin
  cases fail, and the browser requires three selection pills rather than two
  row actions (`temp/menufan/drill-guards.log`). Restore SHA-256:
  - `src/webview/App.tsx`: `5a4797e99861415d1b94c67a7b0374fb5deb31f0c557d7dd6875e2e42a61a5f1`.
  - `test/harness/goldens/capture.mjs`: `f4ed4684611cd5cd23a33bd48a84f70a17191d4ac004b5349e8cce6c025cfb3d`.

Both restored files matched their saved bytes. Final verification uses
repository default test/hook timeouts and at most three files per run.
The immutable models-activation baseline and historical certification
records were left intact. The shared React panel provides the same layout
for every host that mounts it; ACP/headless has no visual action menu.

## Verification

`npm run typecheck`: all five projects passed. The 18 focused suites passed
1,197 tests: App/Transcript/HistoryDialog (269), layout/GooeyMenu/QuoteMenu
(39), controller/questions/deferred surfaces (712), visual matrix/gate/source
(22), visual capture/stability/readiness (15), reference/harness/README shots
(140). After the additional guard drill, App/browser/README shots passed
206 tests again. All Vitest runs used `--maxWorkers=3`, at most three files and
repository default timeouts; final runs had no skipped tests. Scoped ESLint, Prettier, stylelint, localization (0 problems), reference,
roadmap, plan, host API (0 problems), plain knip and duplication all pass.
`npm run build` passes token, size, split, host-global and notice gates:
activation 550.14/600 KiB, Model API 515.81/525 KiB, checkpoint store
87.27/225 KiB, chat startup 742.4/900 KiB, original deferred JS 31.9/50 KiB
and overlays 6.7/10 KiB. No cap changed. The keyboard-caption follow-up also
passed 133 reference/README tests, ESLint, Prettier, localization, reference
freshness and the production build. The three visual unit suites passed
their 22 tests again after the final capture. The rig brief forbids running full `quality` here;
the lead retains that gate. No gate, timeout, coverage threshold, ignore,
hook, or hook configuration was weakened.

The README global-input fingerprint failed before refresh, as designed.
After `npm run harness:shots -- rewind quote-menu history --theme=light`
and the README runner's three recaptures, `README_INPUTS_DIGEST` was refreshed
following the test's own instructions to
`76e954e5561bf4169777940d5e3ab0bae626facbf05bd876268d8e66d677619c`.

## Reviewed visuals

Implementation commit: `1d73ab0fdddca2271351bdc67098c57a383cb389`.
Keyboard-caption and final capture source:
`71ca4b93e89e60e50225e5d5114f345a4a518042`.
Installed hooks passed both commits; their staged and committed diffs matched
byte-exact. The capture inputs were committed before each reviewed update.
An intermediate full capture preceded the keyboard-caption follow-up; the
final archive was captured again from the complete source revision.

The initial `npm run check:visual` failed at
`panel/chat-tool-menu-narrow/default/light/320`: 9,835 changed pixels,
allowance 12 (`temp/menufan/visual-before-update.log`). The final update used
`npm run check:visual -- --update --review=owner-2026-10-10-menu-fan --archive=/var/tmp/l-MENUFAN/visual-owner-2026-10-10-menu-fan-final`.
It captured 9,792 PNGs / 447,111,110 bytes (426.4 MiB of the 512 MiB cap),
with Chrome 150.0.7871.186 on Linux: 136 scenes, six states, six themes,
320/690 px widths and 760 px height. Full PNG sets remain outside git.
The separate before/after request uses 800 px height, as listed above.

Comparison against the previous recorded source
`6636c84beb804af52e49363ac10ede3223d3d295` used the repository's unchanged
pixel policy. Exactly 360 captures exceeded its tolerance, across these
five scene ids:

- `chat-tool-menu-narrow`
- `history-archived`
- `palette`
- `prompt-library`
- `quote-menu`

The other 1,057 differing PNGs stayed within the existing tolerance; 8,375
PNGs matched the previous hashes. Representative menu, palette, archived
history and prompt-library frames were inspected. No other scene exceeded
the policy. Full comparison rows are in `temp/menufan/visual-comparison.json`;
the tracked `docs/certification/menufan-visual-review.json` records the review,
source, dimensions, environment, archive and changed scene ids. The 75-minute
checkpoint is in `temp/menufan/progress.md`.

The final `npm run check:visual` rerun passed all 9,792 captures: eight
changed pixels in total, at most one per image, under the unchanged
per-image tolerance. The manifest stayed unchanged during verification.
The receipt's manifest SHA-256 matched
`3951179a8aa655657632557845efdeca6c82c0916a5f60738aa0733efdd86542`.
Baseline/candidate PNG totals were 447,111,110 / 447,112,737 bytes, both
under 512 MiB. The full receipt is included in the tracked review JSON
and copied to `temp/menufan/visual-final-result.json`; the command log is
`temp/menufan/visual-final.log`.

## Additional smoke limitation

The extra `node test/e2e/webviewDiet.mjs` run is not a requested unit suite.
It passed dependency Retry and SignIn, then its global loading-count assertion
saw two other deferred renderers while GoalPanel was visible. An exploratory
use of the existing harness readiness wait passed GoalPanel, then the unchanged
legacy schedules scene timed out waiting for `.local-schedules` at 5 s.
That wait was reverted; this lane retains only the English opener-label
updates in the smoke. The fixture, schedule renderer and schedule handlers
match the base. The smoke is not claimed green; PLAN §7 records the deferral.
No selector, scenario, assertion, timeout or gate was weakened.

## Round 2 — RVMENUFAN findings (2026-10-10, Kubuntu)

Review: `owner-2026-10-10-menu-fan-r2`; starting head `d5f2381df`.
The two P2 findings are repaired in the shared React panel:

- `gooeyLayout.ts` limits the uniform width and whole-stack arc shift to
  the room on the fan’s side of the opener, minus edge padding and reach.
  The fan keeps its 16–32 px clearance; long labels stay one line, with
  an ellipsis and the full label in the existing tooltip. Both bursts use
  the same bound. No size, gap, height, colour or motion token changes.
- `App.tsx` retains the selected row’s opener element, passed through
  Transcript and QuoteMenu, so GooeyMenuContent’s existing ResizeObserver
  measures the moved button. A row without an opener still uses the pointer.

The layout test sweeps every integer width from 280 through 700, counts
one through six, left/right/centre openers and top/middle/bottom positions
in both bursts: 45,468 layouts, uniform widths, panel containment,
16–32 px clearance and no pill/pill or pill/opener overlap. The real Chrome
regression opens checkpoint-restore at 320 px and chooses Rewind; it checks
all four children, equal widths, 40 px heights, 6 px gaps, opener clearance,
nowrap/ellipsis styling and full tooltips. Another Chrome regression keeps
the selection menu open across 320→690→320 px and checks that its three
pills follow the button. The native App regression checks both coordinates.
The two inherited viewport-wide test expectations now require the smaller
side bound and preserve their uniform-size and containment assertions.

Both regressions failed against the original source before implementation:
layout opener overlap at 280 px; App origin 295 instead of 666 after resize.
After repair, reverting both fixes made all six sweep cases, the exact
checkpoint browser test and the native/browser resize tests fail. The browser
checkpoint pill ended at 293.328125 while the opener began at 283; resize
left the selection pills 185.078125 px away (maximum 32.02). The drill
exited 1 with 11 failed / 207 passed; no timeout was raised. Restore receipts
are in `temp/menufan/r2/drill-sha256.json` and the failure log is
`temp/menufan/r2/drill-revert-both.log`. Saved and restored bytes matched:

- `src/webview/gooeyLayout.ts`: `4b34669947c665376e1247484e203ba973db4043ebdcefa8e17f5a92e1cd9980`.
- `src/webview/App.tsx`: `cdd280486fc7395138244e20af3455ffff1f5249e55f20cd512880db656c5c89`.

README, changelog, M87’s plan/roadmap entry and the conversation-actions
feature reference move with the repair. Existing translated labels and
provider/host capabilities stay intact; no wire shape, model attempt, paid
call, dependency, install, cast, suppression or gate change is introduced.
The React review found no added hook, listener, eager import or focus change.

Round 2 verification ran directly in the lane, at repository deadlines and
with at most three files/workers per invocation. Fifteen focused suites
passed 514 tests: layout/GooeyMenu/QuoteMenu (45), App/Transcript/rowMenus
(280), visual stability/matrix/source (13), visual gate/capture/readiness
(26), and reference generator/README shots/HistoryDialog (150). After the
lint-driven test cleanup, the complete App/layout/browser stability owners
passed their 218 tests again. All five TypeScript projects pass; scoped
ESLint has zero warnings, all production CSS passes stylelint, localization
reports 14 tables and 0 problems, and reference/roadmap/plan/host API/token
gates, plain knip and zero-clone duplication pass. The initial duplication
gate fired on repeated origin-reading assertions; both tests now share one
reader, preserving their coordinate checks. No gate was weakened.

The production build passes size/split/host-global/notice/token gates:
activation 550.1/600 KiB, Model API 515.8/525 KiB, checkpoint store
87.3/225 KiB, original deferred JS 31.9/50 KiB and overlays 6.7/10 KiB.
Aggregate quality stays lead-owned under the rig/common brief.

The requested after image is
`temp/menufan/after/checkpoint-restore-320.png` (320×800). Its JSON beside
it records opener x=283–307/y=56–80 and every child x=8–279, a 4 px gap
from the opener; their y bounds are 8–48, 54–94, 100–140 and 146–186.
The longest label is clipped, with its complete tooltip. The image was
inspected. The source commit precedes the final verification receipt below.

### Round 2 visual receipt and committed source

Implementation: `cbb9bc70cb43eddafc4584db24ba23084b237037`. Installed hooks
passed lint-staged and gitleaks. The staged and committed patches matched
byte-exact after the hook; both were re-read and the drill SHA-256 values
were unchanged.

`npm run check:visual` passed all 9,792 captures: 136 scenes, six themes,
320/690 px widths, six states and 760 px height, with Chrome 150.0.7871.186
on Linux. Nine changed pixels in total, at most one per image, remain
within the unchanged per-image policy (12 pixels). Both baseline and
candidate archives remain within 512 MiB: 447,111,110 / 447,112,960 bytes.
The source was committed while the foreground comparison ran; its capture
inputs match the committed bytes, with the original candidate fingerprint
retained in the receipt.

Changed baseline scene ids: **none**. The complete matrix passed without
a refresh, so the instruction to regenerate only affected baselines calls
for no `--update` run. Every manifest byte and PNG stays as reviewed in
round 1; the baseline source remains
`71ca4b93e89e60e50225e5d5114f345a4a518042`, and the manifest SHA-256 is
`3951179a8aa655657632557845efdeca6c82c0916a5f60738aa0733efdd86542`.
The exact checkpoint submenu and open-menu resize interactions are covered
by the new real-browser assertions and the inspected 320×800 after image.

The named round 2 receipt is
`docs/certification/menufan-r2-visual-review.json`; the full gate log and
receipt copy are `temp/menufan/r2/visual-before-update.log` and
`temp/menufan/r2/visual-final-result.json`. No scene, state, theme, width,
threshold, timeout, ignore or gate was removed or weakened. No push, merge,
rebase, subagent, paid/live call or aggregate quality run occurred.

## Round 3 — RVMENUFAN2 classes (2026-10-10, Kubuntu)

Review: `owner-2026-10-10-menu-fan-r3`; starting head `32cb9a4df`.
Both P2 classes are repaired in the shared lazy GooeyMenuContent:

- One geometry watcher captures non-bubbling ancestor scroll, window resize
  and root ResizeObserver delivery, and samples frames while mounted to catch
  content reflow and transforms that do not resize the root. Placement changes
  state only when its coordinates, viewport or token-derived spacing change.
  It intersects every clipping ancestor and dismisses once when the opener is
  hidden, removed or outside the visible panel. Cleanup cancels the frame and
  removes listeners/observer. Focus returns with `preventScroll`, so dismissal
  does not bring an offscreen button back into view.
- Hover, active, selected and pressed decoration uses an inside border in the
  existing on-accent role. The sweep removed the later Gooey pressed-outline
  selector too; its approval-button sibling retains its existing behavior.
  Resting spacing reads CSS focus width + offset + 2 px clearance. A compressed
  short-panel gap or narrow fan's room beside its opener pulls the focus ring
  inward, keeping both pill and opener neighbours clear. The pure layout's
  existing 6 px default remains the fallback for callers without CSS.

All element origins (row, tool, deferred-question and highlighted-text menus,
including both bursts) use the same watcher. Pointer-origin history/row menus
retain their pointer origin. Header contains no custom radial title-bar menu;
VS Code owns its native overflow. Every React panel host shares this repair;
ACP/headless has no visual radial menu. No provider capability, paid feature,
wire shape, credential, dependency, suppression, cast or localization key changes.
The conversation-actions catalog records the corrected shared behavior;
regeneration preserves its existing descriptions, actions and translated text.

The unit regression proves capture-phase scroll, frame-only reflow, resize,
cleanup, exactly-once removal/hidden/clipped dismissal, installed 3/4 px focus
values producing 9 px spacing in both bursts, and inward focus in short/narrow
panels. Production Chrome tests sweep eight menus × 320/480/900 px × light,
dark, high-contrast light/dark. For every adjacent pair in both directions they
measure focus+hover, focus only, hover only, focus+active, focus+selected and
focus+pressed outline bounds, requiring at least 2 px between pills and from
an opener. Nine real scroll tests follow quote/tool/checkpoint openers through
reflow and 60 px scrolling, follow the checkpoint's second burst, then dismiss
when the button leaves view. The open-selection resize check keeps the actual
opener visible through 320→690→320 px.

Fixture qualification exposed two setup mistakes: `assistant` was not a menu
scenario, so the lane adds a real `assistant-menu` fixture; resizing a fixed
690 px capture document into a 320 px viewport legitimately hid its opener
before the next script changed document width. The resize test now uses the
real panel's fluid width and unpins the transcript before growing scroll room.
It preserves every resize/origin/clearance assertion. Two expensive state
cases hit the repository's 5 s deadline; batching independent CDP state writes
and resetting after each state set removes round trips without deleting a
combination, assertion or timeout. No timeout was raised.

### Round 3 red drills

Each drill runs full owning files, at most three per run, `--maxWorkers=3`,
and repository deadlines; every mutated production file restores byte-exact.

- Restore the pre-fix GooeyMenuContent from HEAD. Six new unit tests fail:
  scroll/reflow/resize cleanup, clipped/removed/hidden second-burst dismissal,
  CSS-derived spacing and compressed-panel focus. The other 45 tests pass.
- Restore the pre-fix CSS. All 96 scene/width/theme outline tests fail on the
  focus+hover collision (clearance −2 px rather than 2 px); the other 12 pass.
- Replace the opener-space cap with the drawn gap. The named narrow-fan focus
  test fails: 6 px outline-space input instead of the required 4 px, while
  the other 51 tests pass.

Logs and SHA-256 receipts: `temp/menufan/r3/drill-*.log` and
`temp/menufan/r3/drill-sha256.json`. Final verification and reviewed visual
receipts follow below.

Restore hashes (each before equals after):

- `anchor-and-token-guards`: `81c1f9ddad360ba2bb705a256f379c67f844174a6c6b5fc55acf4ecc181c022c`.
- `outside-hover-outline`: `acd7d5a33de7c29cec494d5cbc92e6a456c7c5880a3311bc1f227d70adfef4f8`.
- `opener-clearance`: `6aa8cbe270613303abd4b1e42fdf766c64159e14f9c59776a186eff1548fb989`.

### Round 3 source verification

Seven complete owning suites pass 440 tests: GooeyMenu/layout/QuoteMenu (52),
production visual stability and geometric/scroll tests (108), and
App/Transcript/rowMenus (280). The maximum browser test duration is 3,266 ms.
All five TypeScript projects pass; unit's initial possibly-undefined test
reader was repaired by querying its named Copy action. Scoped ESLint (zero
warnings), stylelint, Prettier, plain knip, zero-clone duplication, localization
(14 UI tables, zero problems), reference freshness, roadmap, plan, host API
and tokens pass. The production build passes the existing size, split,
host-global, notice and token gates. Aggregate `quality` remains lead-owned,
as required by the rig/common brief. No threshold, timeout, coverage rule,
ignore, hook, hook configuration or visual policy changed.

### Round 3 reviewed menu pixels and README

Source commit: `a067f64cfab8c9b20e32094753f924cb1dc4e238`. The staged
and committed source patches match byte-exact after the installed hooks;
their SHA-256 is `977dbc996e389b10d62efa962c3f6ba4bb1c125d996ef77a5cea04c7dbb20293`.

The canonical capture renderer produced 576 PNGs: eight menu scenes × six
themes × 320/690 px × all six states, each 760 px high. Every frame was
inspected in 16 labelled contact sheets with the complete menu and outline
margin: clear labels, visible keyboard focus and space between pills in all
frames. Captures (25,595,158 bytes) remain outside git at
`/var/tmp/l-MENUFAN/menufan-r3-menu-frames`; contact sheets, their hashes
and capture facts are recorded in `menufan-r3-visual-review.json`.

Only the two existing menu scenes, `chat-tool-menu-narrow` and `quote-menu`,
are replaced in the reviewed manifest: 144 captures, 120 changed hashes.
All 9,648 non-menu records and PNG hashes remain identical to the prior
baseline. The new archive holds 9,792 verified PNGs / 447,973,530 bytes,
below the unchanged 536,870,912-byte cap, at
`/var/tmp/l-MENUFAN/visual-owner-2026-10-10-menu-fan-r3`.
The existing manifest validator validates coverage; the existing PNG verifier
checks every archive entry; the existing pixel comparator passes all 144
menu frames with zero changed pixels. It rejects the stale baseline on 108
frames under the identical policy. These checks use the canonical modules
from a lane-local scratch script, without changing any shipped gate.

The README input guard first fails on the stylesheet/harness fingerprint
(1 failed, 144 passed across its three complete owning files). Recapture via
`node scripts/readme-shots.mjs --only quote,rewind,history` and
`npm run harness:shots -- rewind quote-menu history --theme=light` succeeds.
Only `media/readme/history.png` changes; the other two PNGs stay byte-exact.
The reviewed README media totals 1,504,088 / 2,097,152 bytes. Refreshing the
fingerprint then passes all 145 tests in readmeShots/referenceGenerator/visualGate.
Together with source verification, ten owning files pass 585 tests under the
repository deadlines and at most three files/workers per run.

Production sizes: activation 550.1 / 600 KiB, Model API 515.8 / 525 KiB,
checkpoint store 87.3 / 225 KiB and GooeyMenuContent 7.5 / 25 KiB. The shared
watcher and focus geometry stay in the existing lazy menu chunk. No cap,
threshold, test timeout, hook, dependency or visual policy changed.

The shipped visual gate passes for the existing menu group:
`npm run check:visual -- --shard=15/1632` (six states, zero changed pixels).
All six themes and both widths of both baseline menu scenes are additionally
verified by the 144-frame canonical comparison above. Receipt:
`temp/m114-visual-result-15-of-1632.json`, preserved in
`docs/certification/menufan-r3-visual-review.json`.

A wider `--shard=1/12` attempt was terminated with signal 143 after 72
captures, with no reported pixel failure. Its retry stopped after 288 logged
captures on the unchanged `muse-workflow-map/light/320` fixture:
`never rendered: [data-entry-id="wft1"] .tool-toggle`. No readiness deadline,
fixture, scene, policy or gate was weakened to bypass that failure. Logs:
`temp/menufan/r3/visual-shard-final.log` and
`temp/menufan/r3/visual-shard-final-retry.log`. The full current visual matrix
is therefore **not certified by this lane**; wider verification remains with
the lead's aggregate run. Both RVMENUFAN2 findings are fixed, with no remaining
menu finding. This limitation is separate from the passing menu captures,
geometric tests and pixel checks. No push, merge, rebase, subagent, paid/live
call or aggregate quality run occurred.
