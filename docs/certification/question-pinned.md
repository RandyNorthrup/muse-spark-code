# QPIN — One question card, pinned above the composer

Rig: win11, `C:/lanes/QPIN`, `fix/question-pinned`, release base
`50b5f1ec5`. Scope: the owner's 2026-10-07 correction to D92.7.
No live or paid model calls, dependencies, wire changes or gate changes.

Waiting and deferred questions keep a compact transcript marker with a
question icon, Open question, title, accent and a labelled native Answer
button. Answer selects and expands the docked card, scrolls it into view,
and focuses its first control. MCP forms use the same marker. The dock
preserves drafts through deferral and lazy remounts. Settled summaries,
exactly-once late delivery, typing protection and approval priority remain.

## Regression drill

Temporarily added `isDockCard` to the transcript's `DeferredQuestionCard`
in `ToolRow.tsx`, restoring a second full interactive waiting question.
Ran the complete owning file with the single-test name filter for the drill:

```text
npx.cmd vitest run test/unit/questionApp.test.tsx --maxWorkers=3 \
  -t "renders one interactive waiting question" --reporter=dot
FAIL: expected [ …(2) ] to have a length of 1 but got 2
Exit 1; 1 failed, 15 skipped.
```

The source was restored from its original byte buffer in `finally`; SHA-256
before and after:
`53de14bf1e5e0221257a531cfdbaf4c91887d11f87376e0e3cf143672383d0bd`.
The restored owning suites passed at the repository's default timeouts.
The MCP regression also caught the old card's blur clearing a newly selected
form, before the transition was repaired.

## Keyboard and screen reader checks

In headless Chrome over the real webview bundle and fake harness,
`questions-open`: focused the transcript marker, pressed Enter, and observed
focus on the dock's first radio. Collapsed the card, focused the marker,
pressed Space, and observed the same focus after reopening. The button's
accessible name is `Answer Open question Colour`, composed through
`aria-labelledby` from localized text and the question title. Tests cover
deferral, manual collapse, late-answer delivery, MCP focus, modal inertness,
typing protection and every terminal label/icon.

## Screenshots and reference

Restored `media/readme/question.png` using the mapped `question` scenario,
690 × 760, light theme. Visually inspected it: one compact transcript
marker plus the pinned card with Colour/Toppings tabs, choices, Other,
Submit and Explain instead. Regenerated and inspected `open-question.png`
and `help.png`; compared the former with its release-base screenshot.
README and Marketplace place question beside approval, with open-question
on its own row beside Help & Reference. The catalog and generated reference
describe the single docked card; all 14 translated tables are updated.

## Verification receipts

Local complete owning suites, changed-file lint, zero-clone duplication,
webview typecheck and development build passed. Localization reported
14 UI tables, 14 usage tables, 197 manifest strings, 961 source files,
0 problems. Four-theme screenshots and accessibility scans are in progress.
Fresh-clone CI verification and its commit identity are recorded below
once completed.

The rig note's shared `common.md` and `review-common.md` were absent from
both `C:/lanes/_ctx` and `~/lanes/_ctx`; the supplied rig brief and repository
instructions were followed.
