# Lane PANELTEXT certification: the panel says plain, true things

Worktree `/home/randy/lanes/PANELTEXT`, from origin/main 0.18.2 (898a26c5e).
Commit 8abd37ecb. No model calls, no pushes. All commands run in the worktree.
Review RVPANELTEXT (branch `rv/panel-text`) amended this record where its
claims were not true of the code; its fixes are commits c58fb2bf0,
771e41da1, 8ae3be363 and e647d8ba7, each noted inline below.

## Reproduction (from the product's code path) and fix

### F59 — Getting Started key column overflows into the text

Cause: `src/webview/styles.css:3268` (`.onboarding-list li { display: flex }`)
with `src/webview/styles.css:3276` (`kbd { flex: 0 1 auto; max-width: 50%;
min-width: 2em }`). In a narrow sidebar the key shrinks to `min-width: 2em`
(about 26 px, below "Shift+Tab"), and its default visible overflow runs into
the description: "Shift+Tabcycles".
Fix: rows are `grid-template-columns: fit-content(50%) minmax(0, 1fr)`; the
key keeps the room its text needs up to half the row (the all-platform
shortcuts wrap inside their half) and the description keeps the rest. Grid
columns cannot overlap at any width, and the capped key column cannot
starve the description (review RVPANELTEXT: the lane's first cut used an
uncapped `auto` column).
Proof: `npm run build` exit 0; `dist/webview/main.css` contains
`.onboarding-list li{display:grid;grid-template-columns:fit-content(50%) minmax(0,1fr);…}`.
Local look (light + dark) NOT RUN here: no browser on the rig
(`which google-chrome chromium chromium-browser`: all "no ... in ...").
The lead runs the one small look.

### F60 — pill said "Starting Mus...", click showed "Loading..."; sign-in after 68 s

Causes:

- `src/webview/App.tsx:418` (`modelLabelFor`): while `auth.status` is
  `checking` the pill read `notSignedIn`; once signed in but model-unknown it
  read `hostStarting` ("Starting Muse Code…"), truncated by the sidebar.
  Neither says the panel is reading the sign-in facts.
- `src/host/auth/cliAccount.ts` (`signIn` → `probe()`): confirming the
  sign-in spawns a short-lived `muse serve` for `account/read`
  (`src/extension.ts:1798`). On a cold start that answers late (measured
  68 s); nothing publishes before it. Corrected in review (RVPANELTEXT):
  a credential file the structure settles never reaches that probe —
  `signIn` returns the file's verdict at once (`cliAccount.ts:247`); for
  such a file the refresh's remaining wait is the stored-key read
  (`choose()` awaits `hasModelApiCredential`, a secret-storage read that
  can be slow where no keyring runs, as in the measured code-server).
  Which of the two waits made the measured 68 s is UNMEASURED; the fast
  publish below skips the second, and only the wording covers the first.
- The pill opens the deferred palette (`src/webview/App.tsx:199`), whose
  `Suspense` fallback (`src/webview/components/DeferredSurface.tsx:93`) read
  bare `loadingOutput` ("Loading…") with no surface label.
  Fixes:
- New `checkingSignIn` ("Checking sign-in…"), returned by `modelLabelFor`
  while checking.
- `CliAccount.peekFile()` (sync file-structure verdict, no process) and
  `AuthService.publishFastSignIn` (called first in `refresh()`): a signed-in
  file (or `META_API_KEY`) publishes `signedIn/museCode` at once; the probe's
  full facts still overwrite it (same ticket ordering). Only a signed-in
  answer ever jumps ahead.
- The deferred palette renders pass `label` (`modelListLabel` /
  `paletteLabel`), so the box reads "Models: Loading…" / "Actions: Loading…".
  Proof: `test/unit/startupWords.test.tsx` (2 passed), `test/unit/cliPeek.test.ts`
  (3 passed, real temp credential files), `test/unit/authFastSignIn.test.ts`
  (3 passed, rewritten in review through one real `CliAccount` over a temp
  file: fast publish before the stored-key read answers; wait for the CLI
  when the file settles nothing; never jump ahead with a signed-out file.
  The lane's first version paired a signed-in peek with a pending probe, a
  state the real `CliAccount` cannot reach, and its "full facts overrule"
  case was dropped with it);
  `test/unit/authService.test.ts` 113 passed, `test/unit/cliAccount.test.ts`
  28 passed after the change.

### F62 — model picker: no price, no tier, no contributor indication

Cause: the CLI's `model/list` sends only id/label/context (parsed at
`src/core/backends/musecode/MuseCodeHost.ts:280`), so
`src/host/conversation/conversationController.ts:3729` had no pricing or
tier to forward, and the picker (`src/webview/components/Palette.tsx`)
named only the context window.
Fix (only facts the app has; nothing guessed): contributor-suffixed models
show the `pickerContributorTier` mark ("1M context · Contributor"); other
models are unmarked (their tier is the CLI's to report — see UPSTREAM).
The picker reads the `-contributor` suffix itself; the controller also
forwards `trainsOnContent: true` for such ids in the model list, a
protocol field no webview code reads today (corrected in review
RVMSM114: the visible mark does not depend on that field, and the
palette test's fixture no longer sets it, so the test proves the suffix
path the code takes).
Not done: per-model prices for CLI models — the app holds no subscription
price facts and must not invent them (see UPSTREAM). Also unchanged for
the measured case: CLI 1.4.7 lists plain ids (no `-contributor` suffix),
so none of its models carries the mark until the CLI reports a tier or
the contributor switch (F8 lane) supplies the state (review RVPANELTEXT).
Proof: `test/unit/palettePanelText.test.tsx` (4 passed, real render).

### F66 — "Not Now" asked again in a new window

Cause (a path proven in code; whether it is the measured window's path is
UNMEASURED — review RVPANELTEXT): `src/host/skills/bundledSkills.ts`
(`decline()`): a click arriving with `shown === undefined` silently did
nothing. That happens after a host restart between the offer and the click,
or when the click reaches a window that never offered (its own
`isClaimed`/`shown` are fresh while a restored panel still shows the
button). A same-window click after a normal offer already wrote
`globalState` before this lane, so the lead's two-window check below is
what decides whether this was the measured path.
Fix: the fallback reads the copy's state now (`readShown`/`readStrayAnswer`):
not installed → install decline; an older installed tag → that release's
update decline; a current copy or someone else's folder → nothing. A broken
read keeps nothing rather than a wrong memory.
Proof: `test/unit/skillsOfferDecline.test.ts` (4 passed, real module with an
in-memory state table); `test/unit/bundledSkillsInstall.test.ts` 45 passed
(one expectation updated to the new contract).

### F67 — composer placeholder is the shortcut tip

Cause: `src/shared/l10n/en.ts:1133` (`composerPlaceholder`) named all three
platforms' keys instead of inviting a message; `src/host/views/webviewSetup.ts:65`
sent it verbatim.
Fix: `composerPlaceholder` is "Ask Muse…"; the host fills
`composerPlaceholderWithShortcut` ("Ask Muse… ({shortcut} to focus)") with
only its own platform's key (`composerPlaceholderFor`). The all-platform tip
stays in Getting Started.
Proof: `test/unit/composerPlaceholder.test.ts` (2 passed: per-platform
values; never all three platforms, one line);
`test/unit/webviewSetup.test.ts` 15 passed; built `dist/uiText.js` decodes
to the new strings (see build proof below).

### F68 — skill entries show model-facing text

Cause: `src/shared/paletteRegistry.ts:313` (`skillItems`) used
`skill.description` (SKILL.md's instructions: "requires a silent read_skill
call … as FIRST ACTION") for both tip and detail.
Fix: tip is `paletteSkillTip` ("Run the {name} skill."), detail is the
display name plus the argument hint. The model still reads the description
from the skill file when the skill runs.
Proof: `test/unit/palettePanelText.test.tsx` (skill row has no model text);
`test/unit/paletteRegistry.test.ts` 49 passed (two expectations updated);
`test/unit/Palette.test.tsx` 18 passed.

### F69 — palette: doubled descriptions, raw Backend label, Session Usage "—"

Causes:

- `src/webview/components/Palette.tsx` (`RowView`) and
  `src/webview/components/SlashMenu.tsx` rendered the visible `detail` plus
  the same sentence again as the hover `title` and the `aria-describedby`
  sr-only span (e.g. `resumeDetail` vs `paletteTips.resume`, differing only by
  a trailing period).
- `src/shared/l10n/en.ts` (`backendDetail`) was the literal setting id
  "museSpark.backend: auto / museCode / modelApi".
- Session Usage "—": NOT REPRODUCED (see below).
  Fixes: `rowTip`/`slashTip` drop a tip that repeats the visible detail
  (trailing period ignored); distinct tips keep tooltip and description.
  `backendDetail` is now "Which engine runs this conversation: automatic,
  Muse Code, or the Model API."
  Proof: `test/unit/palettePanelText.test.tsx` (dup reads once; real tips
  kept); `test/unit/Palette.test.tsx` 18 passed (M87 contract updated to
  single descriptions); `test/unit/Composer.test.tsx` 100 passed.

### F71 — Share dialog headed "Confirm Sharing" twice

Cause: `src/webview/sharing/ChatShareDialog.tsx:303` used `shareConfirm`
(the confirm button's own words, line 353) for the destination group's
legend.
Fix: the legend reads the new `shareDestination` ("Share as"); the button
keeps "Confirm Sharing".
Proof: `test/unit/ChatShareDialog.test.tsx` 11 passed.

## NOT REPRODUCED

- F69c (Session Usage "—"): traced `session/tokenUsage`
  (`src/core/backends/musecode/mapNotification.ts:287`) through
  `tokenUsage` (`src/webview/state/uiState.ts:2056`) into
  `usageValue` (`src/shared/paletteRegistry.ts:30`), which renders counts
  whenever the events arrive and "—" only while `state.usage` is undefined.
  The Model API backend emits the events (`ModelApiHost.ts:5494`), so the
  row's display is proven; whether Muse Code 1.4.7 emits
  `session/tokenUsage` per turn could not be observed here (no signed-in CLI,
  no credentials on the rig, no live calls allowed). If the CLI stays silent,
  the row honestly reports no usage yet. No change made.

## UPSTREAM (Muse Code CLI, not ours)

Request: include pricing and tier facts in `model/list` (or a companion
capability both backends already forward: `pricing`, `inputUsdPerMTokens`,
`outputUsdPerMTokens`, and a tier/training flag per model). Suggested text:

> `model/list` today returns only `modelId`, `displayLabel`, `contextLimit`,
> `isDefault`/`isActive`. The picker therefore shows subscription models as
> "1M context" with no price, no tier and no contributor indication, while
> wording like "Standard rates" vs "contributor rates" exists only in prose.
> Please report, per model, the billing tier (standard vs contributor, or an
> enum you own) and, where the subscription has one, the effective per-token
> price pair — or an explicit "unpriced" marker when there is none — so
> third-party panels can show price and tier without guessing. The wire
> fields must come from a captured `model/list` frame per our AGENTS.md rule
> 13; we will not hard-code CLI 1.4.7's ids or prices.

## Red drills (broke on purpose, watched fail, reverted byte-exact)

- `Palette.tsx` `rowTip` bypassed → `palettePanelText` "reads a duplicated
  description once" failed (1 failed / 3 skipped); restored, 4 passed.
- `bundledSkills.ts` decline fallback removed → `skillsOfferDecline` 2 failed
  (stray-click cases); restored, 4 passed.
- `authService.ts` `publishFastSignIn` call removed → `authFastSignIn`
  2 failed (fast-publish cases); restored, 3 passed.
- Review (RVPANELTEXT): the same removal against the rewritten
  `authFastSignIn` → 1 failed (the stored-key case), 2 passed; restored
  byte-exact (SHA-256 `a800c5fa…62b2` before and after), 3 passed.

## Gates on the final tree (exit codes)

- `npm run typecheck`: exit 0 (all five projects).
- ESLint `--max-warnings=0` on all changed files: exit 0.
- Prettier `--check` on all changed files: exit 0 (stylelint ran via the
  pre-commit hook on styles.css).
- `npm run check:l10n`: exit 0, 0 problems (4 new keys × 14 locales, real
  translations; key order verified identical to en.ts in all 14 files).
- `npm run check:reference`: exit 0 (73 features, 65 commands, 89 settings).
- `npm run check:host-api`: exit 0, 0 problems.
- `npm run deadcode` (knip): exit 0.
- `npm run cycles`: exit 0, no circular dependencies.
- `npm run duplication` (jscpd): exit 0, no duplicates.
- `npm run build`: exit 0; English table decoded from built
  `dist/uiText.js` carries all six new/changed strings; built
  `dist/webview/main.css` carries the grid rows.
- `npm run security:audit`: exit 0 (2 advisories, 1 exceptioned).
- `npm run security:sast`: semgrep NOT installed on this rig — the script
  prints `semgrep is not installed: pip install -r
.github/semgrep/requirements.txt` and exits 0. Not run.

## Suites run (repo default timeouts, `--maxWorkers=3`, one at a time)

Review RVMSM114 note: the existing-suite counts below ran on this lane's
0.18.2 base. Several named files (`authService`, `cliAccount`,
`webviewSetup`, `App`, `conversationController`, `Composer`, `uiState`,
`bundledSkillsInstall`, among others) were deleted on main by TESTCUT
before MSM114 merged this lane, so they do not exist on the merged tree
and their counts are history, not current coverage. On the merged tree
the coverage is the new suites below plus the `vitest related` runs in
`docs/certification/msm114.md` §3; the same caveat applies to the F60,
F66 and F67 proof lines above that cite those deleted files.

New: skillsOfferDecline (4), authFastSignIn (3), cliPeek (3),
composerPlaceholder (2), startupWords (2), palettePanelText (4) — all passed.
Existing, each file alone: paletteRegistry (49), Palette (18),
bundledSkillsInstall (45), authService (113), cliAccount (28), webviewSetup
(15), App (189), AppPaletteEnglish (3), conversationController (688),
ChatShareDialog (11), Composer (100), l10n (26), store (11), uiState (182),
TeamApp (7), harnessInit (1), AppLazy (4) — all passed. Three existing
expectations were updated to the new intended contracts (skill tip/detail,
M87 single descriptions, skills stray decline, webviewSetup init
placeholder); no test was deleted or skipped.

## Real-life scenarios for the lead's run

- Narrow the sidebar with Getting Started visible, one light and one dark
  theme: keys and text never touch, and the two all-platform shortcut rows
  (focus, new tab) wrap inside their half without squeezing the text.
- Fresh start signed in: pill reads "Checking sign-in…" then the model pill;
  the sign-in state lands at once.
- `/` palette: skill rows read "Run the … skill."; no row repeats itself;
  Backend row in plain words; model picker marks contributor models.
- Skills offer: answer Not now, open another window: no second ask.
- Empty composer: "Ask Muse… (… to focus)" with this machine's key only.
- Share Chat dialog: destination group headed "Share as".

## Not run and why

- Small local look in light and dark: no browser on the rig (`which`
  google-chrome/chromium/chromium-browser all report "no … in …"); the lead
  runs it. No screenshot gate was run (`check:visual` never runs per owner).
- `security:sast` needs semgrep (see above).
