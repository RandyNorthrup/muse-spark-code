# Docs truth audit of the 0.12.0 tree

Recorded 2026-10-04, on branch `docs/truth-audit-0120` from main `bd1aafd8`
(the 0.12.0 release and its hotfix). The owner found three false docs that
day (an npm claim, "Python 3" for 3.12, a profile text implying Bypass), so
every user-facing claim in README.md, docs/PRIVACY.md, docs/acp.md,
docs/ci.md, docs/RELEASING.md, CONTRIBUTING.md, SECURITY.md and the
manifest's English text was checked against the code.

## Method

- Fifteen read-only auditors, one per slice (README in nine parts, then each
  other document and the manifest), each reporting only claims the code
  contradicts, with file:line evidence. The lead re-read the code for each
  finding before changing a word; findings the code did not bear out, and
  claims about Muse Code or Meta that only a live capture could settle,
  were left as they were.
- External facts were read, not assumed: `npm view muse-spark-code-acp`
  (0.11.0 and 0.12.0, both with SLSA provenance), `gh release view`
  (the agent's `.tgz` from v0.10.0), `gh run list` (Release run
  37217939475 was a `workflow_dispatch`; `action-check.yml` passes on
  same-repository pull requests), the repository rulesets and the
  `marketplace` environment's secret names.
- No model call was made.

## What changed in code

The Modes menu's Auto line on the Model API backend ignored the paid Auto
reviewer. `permissionModeDetail` (`src/shared/permissionModes.ts`) now takes
`AutoReviewers` (`museCode`, `modelApi`); the panel passes the Muse Code
reviewer's setting and whether the paid `autoReviewer` feature is on
(setting on and price accepted), and the Model API backend's Auto line is
`modelApiReviewedAutoDetail` while it is. The ACP agent passes neither.
Fourteen tables carry the new key.

The panel's focus hints (`composerPlaceholder`, `onboardingShortcuts.focus`
and `.newTab`) now name Cmd+Esc and Cmd+Shift+Esc on macOS, as
`package.json` binds them.

## Red drill

`test/unit/permissionModes.test.ts`, "names the paid Auto reviewer on the
Model API while it is on (M78)": the Model API branch was disabled
(`&& false` added to its condition), the file was run with vitest and failed
(1 failed, 8 passed; exit 1), the source was restored from its copy, and the
file passed again (9 passed).

The longer shortcut text could not wrap (`flex-shrink: 0` on the tip's
`kbd`), so in German its description overflowed the card at 690 px. The
`kbd` now wraps within half the row (`src/webview/styles.css`). The harness
host's English placeholder fallback (`test/harness/index.html`) carries the
new text.

## Screenshots

`modes.png` still showed Auto's old "safety check" line, and every
screenshot predated the header's board button, so the README's claim that
the screenshots are harness renders of the build was false. All of them,
and the walkthrough's four, were rendered again from this tree's
`npm run build:dev`, with `scripts/harness-shots.mjs`'s own Chrome
arguments, page and server. On this host each headless Chrome stayed alive
for minutes after writing its PNG (and its crashpad handler held the
harness's pipe), so a scratch runner ended each Chrome once its file was
complete. The two alt texts that no longer matched (`slash-commands.png`,
`paid-always.png`) were corrected.

## Gates

| Gate                                            | Result                                                          |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `prettier --check` on every changed text file   | exit 0                                                          |
| `node scripts/check-l10n.mjs`                   | 14 tables, 120 manifest strings, 418 source files; 0 problems   |
| eslint (`--max-warnings=0`) on the touched code | exit 0 (after one `unicorn/no-duplicate-loops` fix in the test) |
| stylelint on `src/webview/styles.css`           | exit 0                                                          |
| tsc: host, webview and unit projects            | exit 0                                                          |
| Targeted vitest on the Kubuntu rig (13 files)   | 481 passed                                                      |
| `npm run test:a11y`                             | not run here (the same Chrome stall); CI runs it on the PR      |
