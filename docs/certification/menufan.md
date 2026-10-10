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
