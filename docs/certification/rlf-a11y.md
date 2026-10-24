# RLF-A11Y — the accessibility gates that fail on main, plus the sandboxes' axe runs

Rigs: MINI-DT (the owner's Windows PC, 2026-10-22: the fixes and a first
set of runs) and randy-lt (Linux, Google Chrome 153.0.8010.52,
2026-10-24: every run and every drill again, below). Base: int/recovery at
397aca3ddb.

## What was red

On the base, `npm run test:a11y` failed with 2 rules violated on 724
elements, 1 rule undecided on 24 elements, and 12 pages without a result
(1124 pages: 281 scenarios × 4 themes). `npm run test:legal-a11y` passed.

## The fixes (commit ae122b9c)

`label-content-name-mismatch` (axe needs the visible words as a contiguous
run of the accessible name's words):

- The model pill (`src/webview/components/Composer.tsx`): the name is now
  `Model: {model · effort}` instead of bare `Model`.
- The open-questions chip (`src/webview/components/OpenQuestionsChip.tsx`):
  the Answer button takes its name from its content; the ←/→ glyphs are now
  Back/Forward chevron SVGs (`src/webview/components/icons.tsx`), which axe
  can read (aria-hidden text is still visible text to axe, so hiding the
  glyphs did not work).
- The schedule buttons (`src/webview/components/SchedulePanel.tsx`): names
  are `{visible}: {id}`; the three dead `schedule*Job` templates left
  `src/shared/l10n/en.ts` and all 14 `l10n/ui.*.json` tables.
- The team tree rows (`src/webview/components/TeamTree.tsx`): no
  `aria-label`; the name comes from the row's content, as the history rows
  already do. `label` stays for type-ahead.
- The context meter (`src/webview/components/ContextMeter.tsx`): the name
  says the number the ring shows (clamped 100 past the window, `<1` under
  one percent); the detail keeps the exact figures.

`color-contrast` (`src/webview/styles.css`): controls on the active
menu/palette row inherit the on-selection color. This was hc-light only:
history Delete/Recap (#292929 on #0f4a85).

No-result pages:

- `sequences`, `sequences-narrow`: the scene typed `/sequences`, which the
  palette filter never matches (it matches labels, and the row is `Prompt
Sequences`); it types `sequences` now.
- `tab-usage`: a real product crash, not a scene bug. Pricing the paid
  badge for a token-rate feature reads deferred English
  (`tokenRatePrice`'s tariff line), which the money chunk never installed:
  with Tab on and no surface opened yet, the whole panel crashed
  (`English surface is not loaded: paidScheduledPrice`). The money factory
  (`src/webview/money.tsx`) now awaits `loadDeferredEnglish()` first, as
  every deferred surface does.
- `git-held`: the scene's hand-written `composerState` omitted
  `isFastEnabled` (the last such send; RLM77's merge fixed the shared
  object). It spreads the scripted composer with the Plan override, as the
  `plan` scene does.

Follow-up (commit 724f0d60f): the pill's fuller name broke the `models`,
`models-byo` and `pill-toggle` scenes, which clicked
`button[aria-label="Model"]`. They click `.pill` (only the model pill
carries it) via `whenFound`.

## The handed runs

- M88's four axe scenes: `node scripts/a11y.mjs sequences sequences-narrow
sequences-run history-bookmarked` → exit 0, 16 pages, 0/0/0.
- M77's axe gate: `board board-narrow bestofn bestofn-narrow` → exit 0,
  16 pages, 0/0/0.
- The companion look: `node scripts/ui-look.mjs
usage-page-nine-providers` → exit 0; the Usage & Cost page renders in
  light and dark (`temp/ui-look/usage-page-nine-providers.{light,dark}.png`).
- Both gates on the final tree: `npm run test:a11y` → exit 0
  (1124 pages, 0 violated, 0 undecided, 4 exempt, 0 without a result);
  `npm run test:legal-a11y` → exit 0 (96 checks; English and pseudo).
- Visual check of the changed chip: `node scripts/ui-look.mjs
questions-open` → exit 0; chevrons render.

## Red/green drills

Each drill: plant the break, rebuild (`--production`), show the non-zero
exit, restore byte-exact (`git status` shows only the pre-existing
CHANGELOG edit), rebuild, show exit 0.

- Drill A, the label rule (6 plants: pill, answer button, Run/Cancel
  buttons, tree rows, meter): `a11y.mjs empty questions-open schedules
team-tree context-meter-full` → exit 1, 60 elements, every plant named;
  restored → exit 0.
- Drill B, contrast (`.icon-button` out of the inherit rule): `a11y.mjs
history history-bookmarked` → exit 1, the 4 original hc-light findings;
  restored → exit 0.
- Drill C, the money crash (`loadDeferredEnglish()` out of the money
  factory): `a11y.mjs tab-usage` → exit 1, 4 pages without a result
  (`never rendered: .paid-badge`); restored → exit 0.
- Drill D, the harness (no rebuild): `/sequences` back → `a11y.mjs
sequences` exit 1 (`never became ready`); the git-held literal back →
  `a11y.mjs git-held --lang=pseudo` exit 1 (`Dropped malformed host
message (type composerState)`, the exact failure RLM110C/RLWINFIX
  reported); restored → both exit 0.
- The chevron swap's red is the pre-fix full run (24 undecided Next/Previous
  buttons failing the gate); the models-scene fix's red is the mid-lane full
  run (12 no-result `click('Model')` throws), green in the 3-scene re-run.

## Re-run on Linux (randy-lt, 2026-10-24)

Chromium ran with `TMPDIR=<worktree>/temp`; the repository's own test
timeouts applied. The untouched base was a shared clone of 397aca3dd built
with `node scripts/build.mjs --production` in `$TMPDIR/base`.

The base, measured here (not carried over from the Windows run):

- `node scripts/a11y.mjs` → exit 1: 2 rules violated on 752 elements
  (`label-content-name-mismatch`, `color-contrast`), 1 rule undecided on 26
  elements, 12 pages without a result (`sequences`, `sequences-narrow`,
  `tab-usage`, 4 themes each).
- `node scripts/legal-a11y.mjs` → exit 0 (96 checks). The RLM110C report of
  12 pseudo-locale pages failing on `isFastEnabled` does not reproduce on
  int/recovery; the one scene still sending a composer state without that
  field was `git-held` (Drill D).

The final tree, measured here:

- `npm run test:a11y` → exit 0: 1124 pages (281 scenarios × 4 themes), 0
  violated, 0 undecided, 0 exempt, 0 without a result (6 min 17 s).
- `npm run test:legal-a11y` → exit 0: 96 checks; English 12 pages and
  pseudo 12 pages, 0 violated, 0 without a result.
- M88's four axe scenes: `node scripts/a11y.mjs sequences sequences-narrow
sequences-run history-bookmarked` → exit 0, 16 pages, 0/0/0.
- M77's axe gate: `node scripts/a11y.mjs board board-narrow bestofn
bestofn-narrow` → exit 0, 16 pages, 0/0/0.
- The companion look: `npm run ui:look -- usage-page-nine-providers` →
  exit 0; the Usage & Cost page (the companion page's scene) renders in light
  and dark in `temp/ui-look/` (looked at: the title, range radios, group and
  metric selects, buttons and the metric tiles are laid out and legible).
- Suites: `npx vitest related` on `Composer.tsx`, `ContextMeter.tsx`,
  `OpenQuestionsChip.tsx`, `SchedulePanel.tsx`, `TeamTree.tsx`, `icons.tsx`
  and `money.tsx` → exit 0, 21 files, 782 tests; `teamHarnessFixture`,
  `harnessInit`, `feedbackScenes` → exit 0, 4 tests; `l10n`,
  `l10nPackParity`, `hostL10nTerminal` → exit 0, 47 tests. `en.ts` lost three
  dead keys; its `vitest related` would select nearly every suite, so the
  l10n suites and `check-l10n` stand for it.

### Drills on this rig

Each drill plants the pre-fix file from `ae122b9c3^` (or a one-line
plant), rebuilds with `--production`, runs the scenes, then restores the file
from `HEAD` and shows `git diff --quiet` exit 0 before the green run.

- Drill A (label rule: Composer, OpenQuestionsChip, TeamTree and
  ContextMeter pre-fix; the schedule Cancel button named by the bare id):
  `a11y.mjs empty questions-open schedules team-tree context-meter-full` →
  exit 1, 55 elements violated and 6 undecided; the findings name
  `.pill`, `button[aria-label="1 open question"]`, Previous/Next Open
  Question, `schedule-due`/`schedule-next`, the team tree rows and
  `.context-meter`. Restored → exit 0, 20 pages, 0/0/0.
- Drill B (contrast: pre-fix `styles.css`): `a11y.mjs history
history-bookmarked` → exit 1, `color-contrast` on 4 elements in hc-light
  (Delete and Recap on the selected row). Restored → exit 0.
- Drill C (pre-fix `money.tsx`): `a11y.mjs tab-usage` → exit 1, 4 pages
  without a result (`never rendered: .paid-badge`). Restored → exit 0.
- Drill D (pre-fix `test/harness/index.html`, no rebuild): `a11y.mjs
sequences` → exit 1 (`never became ready within 10 s`, 4 pages);
  `a11y.mjs git-held --lang=pseudo` → exit 1 (`Dropped malformed host
message (type composerState)`, 4 pages); the same scene in English → exit
  0, which is why only the pseudo pages fail. Restored → both exit 0.

- Drill E (the scripted host's stale paid state): `usage-install` sent a
  `paidState` whose tally had no `scheduledRuns`, which `paidTallySchema`
  requires, so the webview dropped it. The English gate never showed it
  (the harness records webview errors only when `?lang=` is set); the pseudo
  pages did. Pre-fix `a11y.mjs usage-install usage-install-narrow
--lang=pseudo` → exit 1, 8 pages without a result (`Dropped malformed host
message (type paidState)`); with `scheduledRuns: 0` in the scene's tally →
  exit 0, 8 pages, 0/0/0, and the English run → exit 0.

### Found beyond the gates (not fixed)

`node scripts/a11y.mjs --lang=pseudo`, every scene, is not a gate; run before
Drill E's fix it gave exit 1: 1124 pages, 36 pages without a result, 1 rule
violated on 24 elements. Of the nine scenes without a result, `usage-install`
(two) is fixed above. The other seven, with what was measured:

- `sequences`, `sequences-narrow`: never became ready; the scene types the
  English word `sequences` into the palette filter, which the pseudo row
  label does not contain (measured by reading the scene).
- `models-table`, `models-edit`, `models-table-filtered`, `models-narrow`:
  `no table key for the label "Models"` / `"Edit"` (the harness's own error).
- `session-lists`: never became ready; the cause is not measured.

The one violated rule is `label-content-name-mismatch` on the `report` and
`report-narrow` scenes (a Remove button and two `.notice-action` buttons);
its cause is not measured. Both scenes pass `test:a11y`'s English run; the 14
real tables were not run. Making every scene pseudo-clean is a
separate piece of work; the gates the brief names, `test:a11y` and
`test:legal-a11y`, are green.

## Gate exit codes (final tree, randy-lt, 2026-10-24)

| Gate                                                     | Exit | Note                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on every touched file and this record | 0    |                                                                                                                                                                                                                                                                                       |
| `eslint --max-warnings 0` on the touched .ts/.tsx        | 0    |                                                                                                                                                                                                                                                                                       |
| `stylelint src/webview/styles.css`                       | 0    |                                                                                                                                                                                                                                                                                       |
| `npm run typecheck`                                      | 0    | all five projects                                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                            | 0    | 0 problems                                                                                                                                                                                                                                                                            |
| `npm run check:reference`                                | 0    |                                                                                                                                                                                                                                                                                       |
| `npm run check:host-api`                                 | 0    |                                                                                                                                                                                                                                                                                       |
| `npm run check:roadmap`                                  | 0    |                                                                                                                                                                                                                                                                                       |
| `npm run check:catches`                                  | 0    | counts match the baseline                                                                                                                                                                                                                                                             |
| `npm run duplication`                                    | 0    | 0 clones                                                                                                                                                                                                                                                                              |
| `npm run cycles`                                         | 0    | no cycle                                                                                                                                                                                                                                                                              |
| `npm run deadcode`                                       | 0    | one tag hint (`TEAM_DEFAULT_ENTRY`), not from this lane                                                                                                                                                                                                                               |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`   | 0    | 533 rules, 4145 files, 0 findings                                                                                                                                                                                                                                                     |
| `npm run check:plan`                                     | 1    | PLAN.md is 3,670,057 bytes against the 3,565,158 budget; the untouched base is 3,668,951 bytes and fails the same way; this lane adds 1,106 bytes. Archiving closed history is the lead's                                                                                             |
| `npm run build`                                          | 1    | `check-bundle-size`: `dist/modelApi.js` 540,355 B over 525 KiB by 2,755 B; `dist/resourceAdmission.js` 25,639 B over 25 KiB by 39 B; `dist/vaultActions.js` 25,606 B over 25 KiB by 6 B. The untouched base builds the same three files to the same byte counts. No budget was raised |
| `npm run security:audit`                                 | 1    | three high advisories (`@azure/msal-node`, `undici`, `zod`) and one stale exception; the untouched base reports the same list; this lane changes no package file                                                                                                                      |

The build stops at its size step, so the later steps were run one by one on
the same `dist/`: `check-bundle-split` → 0, `gen-lazy-registry --check` → 0,
`check-host-globals` → 0, `third-party-notices` → 0,
`check-legal-build-records` → 0 (0 problems). Two things from running the
a11y gates and `ui:look` beforehand: they write `dist/traffic-harness/`
(through `scripts/lib/harnessServer.mjs`), which `gen-lazy-registry --check`
reports as three rows with no registry entry until that folder is removed;
and any file under `temp/` whose name holds a colon makes
`check-legal-build-records` exit 1 ("could not be admitted"). Both were
cleared from this lane's own scratch before the runs above; neither is a
repository change.
