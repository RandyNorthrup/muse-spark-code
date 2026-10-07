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
Ran the owning file with a single-test name filter for the drill, invoking
Vitest's installed entry directly through Node:

```text
node node_modules/vitest/vitest.mjs run test/unit/questionApp.test.tsx --maxWorkers=3 \
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

A second deliberate drill changed `control?.focus()` to `card.focus()` in
`QuestionUi.tsx`. Both owning files, filtered by
`one interactive|reopens a deferred|pins the only MCP`, failed all four
focus checks: waiting marker, deferred reopening, dock marker and MCP form.
Exit 1; 4 failed, 24 skipped. Byte-exact restoration was checked against
SHA-256 `fd4e5153751442e7192992785416af74eddeb39158662c82eb13e0845fa5957f`.
Both complete owning files then passed: 28 tests, default timeouts.

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
Compared Help & Reference with its release-base image and inspected the
final question, filled-question, explanation, MCP form and all M112 state
scenes in contact sheets for light, dark, high-contrast light and high-contrast
dark. Final captures: 28 scenes per theme, 112 PNGs under
`docs/certification/question-pinned/`, including 320 px variants.
README and Marketplace place question beside approval, with open-question
on its own row beside Help & Reference. The catalog and generated reference
describe the single docked card; all 14 translated tables are updated.

## Verification receipts

Verified implementation commit
`71eaccdd07c7bff1226517c8c1755fa77167e86a` in a fresh clone made with
`git clone --no-hardlinks C:/lanes/QPIN <tmp>`, followed by `npm.cmd ci`,
with `CI=true`. The later receipt commit changes documentation and PNGs only.

| Check                                                 | Result                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fifteen complete owning files, three consecutive runs | 308 tests per run; 924 passed, zero skipped/failures; default repository deadlines, no `--testTimeout` |
| `npm.cmd run typecheck`                               | All five projects passed: host, webview, unit, e2e, integration                                        |
| `npm.cmd run lint`                                    | JS, CSS and PowerShell passed; 0 PSScriptAnalyzer findings                                             |
| `npm.cmd run format:check`                            | Repository-wide formatting passed                                                                      |
| `npx.cmd knip`                                        | Exit 0, plain mode; only two existing configuration hints                                              |
| `npm.cmd run duplication`                             | 1,864 files, 0 clones                                                                                  |
| `npm.cmd run build`                                   | Production build, size/split/host-global checks passed; all caps unchanged                             |
| `npm.cmd run check:reference`                         | 61 features, 59 commands, 69 settings, 28 slash, 226 CLI; current; sharing reference matches           |
| `npm.cmd run check:l10n`                              | 14 UI tables, 14 usage tables, 197 manifest strings, 961 source files; 0 problems                      |
| Four-theme focused accessibility                      | 116 pages: 29 scenes × 4 themes; 0 violated/undecided rules, 0 exemptions, 0 missing results           |
| README refresh                                        | `node scripts/readme-shots.mjs --only question,open-question,help` passed; final images inspected      |

Test batches (each command `npx.cmd vitest run <files> --maxWorkers=3
--reporter=dot`, repeated three times):

1. `questionApp.test.tsx`, `attentionDock.test.tsx`, `QuestionCard.test.tsx` — 35 tests.
2. `deferredQuestionUi.test.tsx`, `deferredQuestionFailure.test.tsx`, `elicitationCard.test.tsx` — 8 tests.
3. `toolRows.test.tsx`, `questionUiState.test.ts`, `questionStrings.test.ts` — 70 tests.
4. `ReferencePage.test.tsx`, `referenceGenerator.test.mjs`, `readmeShots.test.mjs` — 151 tests.
5. `harnessCapture.test.mjs`, `harnessWaits.test.ts`, `questionRegistry.test.ts` — 44 tests.

Intermediate checks caught the reference's lost answer-destination sentence,
then a lint/format conflict in the form's loading fallback. Both were fixed
before final verification. Parallel early screenshots hit Chrome capture
errors; inspection also found loading-state narrow images. Sized captures
now share wide captures' scenario/font/paint readiness, with the same existing
deadlines, and all 112 scenes were regenerated from the final bundle. The
first accessibility attempt had one unready page under load; the complete
final 116-page run passed. No failing result was accepted as a receipt.

The rig brief scopes the lane's gates; full `npm run quality` and unrelated
repository coverage, native/editor and live certification remain with release
integration, as recorded in PLAN §7. No rule, ignore, threshold or timeout
was weakened. No added escape hatch.

The rig note's shared `common.md` and `review-common.md` were absent from
both `C:/lanes/_ctx` and `~/lanes/_ctx`; the supplied rig brief and repository
instructions were followed.
