# M87 — the chat column, the approval choices and the composer toolbar

Scope: the owner's four requests of 2026-10-04 and Codex's review RVCOMP of
`33acd064` (P2, P3). PLAN.md D66, "The chat column", has the decisions.
Branch `m87/c2` in `mx-m87composer`, on `33acd064`. The gooey menu,
StatusLine and HeartbeatTrace are other lanes' and were not touched.

## What changed

- **Request 1, "the chat control stuff box should be centered in the chat
  not stretched to fill" (and review P2).** The first cut centred only the
  composer and the dock. Now one column holds:
  - the transcript, with its queued cards, the working line and the row
    menus;
  - the diff tally's text, and the goal, task and schedule panes;
  - the approval dock and the composer.

  The column is at most `--ms-column-max-width` (760 px with its gutters)
  and is centred in a wider panel. `--ms-column-inset` is measured on the
  panel, not on the transcript's scroller. That way the scrollbar cannot
  move the transcript off the composer's edges.

- **Request 2, "the always allow button wraps wierd and is too big in
  contrast to the allow once button".**
  - Every choice is one line at `--ms-button-height` (28 px). The fill alone
    tells approving from rejecting.
  - A row too short for the next choice moves that choice whole onto the
    next row.
  - A label longer than the card ellipsizes. Its `title` holds the full text
    (the rule preview, else the label).
  - In a card under 340 px the choices stack, each as wide as the card.
  - The DOM order and the keys are unchanged.
- **Request 3, "the pill spacing around the model on the top and bottom is
  too large and makes the pill too tall".**
  - The pill's fill is `--ms-chip-height` (20 px, the open-file chip's
    height). It sits inside transparent 3 px block borders, so the target
    stays a whole 26 px control (WCAG 2.5.8 asks for 24 px).
  - Forced colours paint those borders, so there the pill keeps a 1 px
    border.
- **Request 4, "the buttons and stuff in the mobile view look weird the
  buttons and stuff looks staggered and stacked".** In a composer under
  340 px, every control stays on one row, at one height and on one centre
  line.
  - The icon buttons are square, the mode button shows its icon, and the
    pill takes the room that is left.
  - A chip that no longer fits moves to its own row below the controls.
  - Only a composer under about 207 px puts the right group on a second
    row.
- **Review P3: the checks run in a browser.** `columnGeometry` in
  `test/harness/index.html` measures the layout after the fixture has
  drawn, in three scenarios:
  - `column`, at the runner's 690 px;
  - `column-narrow`, at 320 px;
  - `column-wide`, at 1400 px, with VS Code's 10 px webview scrollbar and a
    transcript long enough to scroll.

  The runners give a sized scenario its own viewport: `SIZED_SCENARIOS` and
  `withSizedPage` in `scripts/lib/harnessServer.mjs`, used by both
  `scripts/a11y.mjs` and `scripts/harness-shots.mjs`. `column-wide` keeps
  the scrollbars that headless Chrome otherwise hides.

  The check reads its tokens from the stylesheet. It measures:
  - the shared start and end edges, allowing for a scroller's scrollbar
    only where the panel is too narrow to give it room;
  - the cap and the centring;
  - each choice's height, its single line of text and where its row starts;
  - each toolbar control's height and centre line;
  - the pill's fill and the chip's height.

  A miss throws, naming the part and its numbers, and so fails the
  accessibility gate. `test/unit/chatColumn.test.mjs` replaces
  `composerCentered.test.ts`. It checks the declarations, and that the gate
  still opens these pages at these widths.

## Measurements

These come from the harness `column` fixture in host Chrome on Windows
(Segoe UI). Before is `33acd064`; after is this commit.

| What                                            | Before                                                                        | After                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| "Allow once" (690 and 1400 px)                  | 89 × 31                                                                       | 89 × 28                                                                                |
| "Always allow in this workspace: Set-Content …" | 288.7 × 31; at 320 px, 286 × **48** on two lines                              | 288.7 × 28; at 320 px, 286 × 28 on one line                                            |
| "Reject"                                        | 60.6 × 31                                                                     | 60.6 × 28; at 320 px, 286 × 28                                                         |
| Choices at 320 px                               | 89, 286 and 60.6 wide, staggered                                              | three 286 × 28 rows, all at x = 17                                                     |
| Model pill                                      | 26 px box, 26 px fill                                                         | 26 px box (the target), **20 px** fill                                                 |
| Open-file chip                                  | 20 px                                                                         | 20 px (`--ms-chip-height`)                                                             |
| Toolbar at 320 px                               | two rows, left group centred at y 696 and right group at 730, right-aligned   | every control centred at y 706; the chip alone below, at 733                           |
| Column at 1400 px                               | transcript, queued card and working line x 8, width 1384; composer x 328, 744 | transcript, queued card, working line, approval card and composer all x 328, width 744 |
| Column at 1400 px with the 10 px scrollbar      | (no such scenario)                                                            | transcript 328–1072, as the composer; centring in the scroller would give 323–1067     |
| Column at 320 and 690 px                        | x 8, widths 304 and 674                                                       | unchanged                                                                              |

The rig runs on Kubuntu measured the same geometry. Only the font-driven
heights differ: a padding-sized choice is 29 px there and 31 px here.

## Red drills

`scratchpad/m87c/drills.py` ran on kubuntu through `rig-run.sh` (slot
`m87drill`), in two runs.

- **Method.** Each drill applies one exact replacement and runs the checks
  it targets:
  - in the browser, `npm run build:dev` and then
    `node scripts/a11y.mjs column-narrow column-wide`, 8 pages;
  - in vitest, `chatColumn.test.mjs` and `cards.test.tsx`.

  Each drill then restores the original bytes and compares SHA-256.

- **Baseline before the drills:**
  - browser: 8 pages, 0 violations, exit 0;
  - vitest: 18 passed, exit 0.
- **After the restores:** the same results.
- **Scrollbar drill (second run):** after its restore, the browser check
  passed again (8 pages, 0 violations).

| Guard                     | Deliberate defect                                             | Failed                | Observed diagnostic                                                                              | Restored |
| ------------------------- | ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| Transcript cap (P2)       | remove the transcript's `max-width`                           | a11y exit 1, vitest 1 | `.transcript spans 328–1382, not 328–1072` (and the queued card, the working line)               | yes      |
| Scrollbar independence    | `width: 100%; margin-inline: auto` instead of the panel inset | a11y exit 1           | `.transcript spans 323–1067, not 328–1072` at 1400 px with the scrollbar                         | yes      |
| Shrink-wrapped transcript | `margin-inline: auto` alone                                   | a11y exit 1           | `.transcript spans 494.3–895.7, not 328–1072`; at 320 px `8–409.3, not 8–312`                    | yes      |
| Composer in the column    | drop the composer area's inset                                | a11y exit 1           | `the composer is 1384 px wide at 8, not 744 at 328`                                              | yes      |
| One line per choice       | remove `white-space: nowrap`                                  | a11y exit 1           | `the choice "Always allow in this workspace: Set-Content ..." is 28 px tall on 2 lines`          | yes      |
| One height per choice     | size the choices by padding again                             | a11y exit 1           | `the choice "Allow once" is 29 px tall …, not 28` (all three)                                    | yes      |
| Pill fill                 | remove the pill's `border-block-width`                        | a11y exit 1           | `the pill's fill is 24 px and the chip 20 px, not 20`                                            | yes      |
| Narrow toolbar row        | the left group on a row of its own again (`flex-basis: 100%`) | a11y exit 1           | `the control "Context 42% used …" is 26 px tall centred at 730, not 26 at 700` (the right group) | yes      |
| Gated scenario list       | drop `column-wide` from `SCENARIOS`                           | vitest exit 1         | `× opens the column at the default width, 320 px and 1400 px (with a scrollbar)`                 | yes      |
| Full-text title           | `title={choice.rulePreview}`                                  | vitest exit 1         | `× keeps each choice in its DOM order, with its full text as its title for an ellipsized label`  | yes      |

The stylesheet's SHA-256 was `3854229e4e91…` before every CSS drill and
after every restore.

The test helper was later reworded for ESLint, so the unit drills were run
again against the final `chatColumn.test.mjs` (snapshot `d6662d43`, with
`drills-unit.py`):

- the baseline passed 18 of 18;
- the transcript cap, the gated scenario list and the full-text title each
  failed 1 of 18 again;
- a new pill-fill drill failed `× paints the model pill at the chips’
height inside a whole control`;
- every file was restored and its SHA-256 matched;
- the run after the restores passed 18 of 18.

The script logs (`drills-1.log`, `drills-2.log`, `final-rig.log`) and their
JSON are kept in the session scratchpad.

## Screenshots

These are host Chrome renders of the `column` fixture, taken in one batch
from a bundle built on kubuntu. The bundle's SHA-256 values are `main.css`
`f96f637d…` and `main.js` `4b934412…`.

They show the approval card, the composer and the queued card at each
width. Every image was looked at.

- Before (`33acd064`):
  - [320 dark](m87-composer-before-320-dark.png),
    [320 light](m87-composer-before-320-light.png): the two-line "Always
    allow" button and the split toolbar;
  - [690 dark](m87-composer-before-690-dark.png),
    [690 light](m87-composer-before-690-light.png);
  - [1400 dark](m87-composer-before-1400-dark.png),
    [1400 light](m87-composer-before-1400-light.png): the rows spanning the
    panel while the composer is centred.
- After:
  - [320 dark](m87-composer-after-320-dark.png),
    [320 light](m87-composer-after-320-light.png): stacked full-width
    choices, one row of controls, and the chip below them;
  - [690 dark](m87-composer-after-690-dark.png),
    [690 light](m87-composer-after-690-light.png);
  - [1400 dark](m87-composer-after-1400-dark.png),
    [1400 light](m87-composer-after-1400-light.png): one column;
  - [1400 dark, scrolled with the scrollbar](m87-composer-after-1400-scrollbar-dark.png)
    and [light](m87-composer-after-1400-scrollbar-light.png): the
    `column-wide` scenario.

The two images from the first cut, `m87-composer-centered-{dark,light}.png`,
are removed. The before shots above show the same state at 1400 px.

## Tests and gates

All of these ran on kubuntu, through `rig-test.sh` and `rig-run.sh`.

- **Unit tests** (`--maxWorkers=1`), 102 passed:
  - `chatColumn.test.mjs`: 6;
  - `cards.test.tsx`: 12;
  - `ApprovalDock.test.tsx`: 11;
  - `Composer.test.tsx`: 72;
  - `reducedMotion.test.ts`: 1.
- **Static checks on the changed files** (snapshot `d6662d43`): ESLint
  `--max-warnings=0`, Stylelint `--max-warnings=0`, Prettier `--check`,
  `tsc` for the webview and unit projects, and `knip`. Each exited 0.
- **Not run:** the full `npm run quality`. By the owner's rule of
  2026-10-04, this host runs only formatting, linting and single-project
  `tsc`; the merge gate is hosted CI.
- **Targeted accessibility run** (12 scenarios × 4 themes):
  - `column-narrow` and `column-wide` pass.
  - Every other finding is pre-existing (below).
- **Full accessibility gate** (`npm run test:a11y` after `build:dev`). It
  ran on this tree and on the parent `33acd064`, side by side in separate
  slots:

  |           | Pages | Violated rules     | Undecided | Without result |
  | --------- | ----- | ------------------ | --------- | -------------- |
  | This tree | 536   | 2, on 115 elements | 1, on 4   | 0              |
  | Parent    | 524   | 2, on 112 elements | 1, on 4   | 0              |

  Both runs exit 1. The violated rules are the same two in both
  (`target-size` and `aria-required-children`), and so is the undecided
  contrast. The extra 12 pages are the three new column scenarios.
  - **Only in this tree:** the four `column` pages' `.tool-chevron`
    finding, the parent's defect on a new page.
  - **Only in the parent:** one `aria-required-children` on
    `hc-light/slash-palette`, a single-theme result in an area this lane
    does not touch.
  - **On every scenario the parent has,** this tree adds no finding.

## Pre-existing findings, not this lane's

- **`target-size` on `.tool-chevron`.** The chevron sits in a tool row
  beside the row's "…" button (the gooey row-actions migration,
  `fafa8783`). axe reports it partly obscured (4 × 24 px) with 2 px of
  safe space.
  - With the parent's stylesheet and card, `approval` and
    `approval-several` fail the same way. The parent's full gate also
    fails this rule on `steps-summary-open`, `chat-tool-menu`,
    `muse-shell`, `auto-review` and others.
  - The new `column` page (690 px) has a tool row, so it shows the same
    finding.
- **Undecided contrast on the context meter's single digit** in `narrow`:
  "content is too short". The ring reads "2" there.

## Limits

- **Native VS Code editor tab.** The editor tab was not checked in a
  native window. It uses the same renderer as the view
  (`webviewSetup.ts`).
- **Forced colours.** These were checked once, by a probe on kubuntu with
  `forced-colors: active` emulated:
  - the pill has 1 px borders, a 26 px box and a 24 px line;
  - the toolbar row, and the chip below it, look as in normal colours.

  The geometry check is for normal colours: under forced colours the pill's
  fill is the whole control by design.

- **Scrollbar at 760 px or narrower.** When the transcript shows a
  scrollbar, it still takes its width from the transcript's end side, as
  before. There is no slack to absorb it.
