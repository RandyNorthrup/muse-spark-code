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

## 2026-10-04 audit fixes

Two defects the audit found, fixed on this branch.

**Unredacted logging (AGENTS.md rule 8).** `describe(error)` in
`src/host/conversation/conversationController.ts` and the `failureOf`
first-stderr-line in `src/host/commands/skillsCommands.ts` reached the log
and panel notices as sent. Both now pass through `redactSecrets`
(`src/core/redact.ts`) first, as `src/host/logger.ts` does. The same sweep
(`describe(`, `stderr`, `error.message` in `src/host`) redacted every other
place raw external text is logged or shown: `sandboxSetup.ts` (helper
stderr/stdout), `cliFeatures.ts` (`muse export` stderr), `createRulesFile.ts`
(`muse init` output), `worktreeCommands.ts` (`gitMessage`, git stderr),
`sessionBoard.ts` (git worktree error), `memoryCommands.ts`,
`museConfigCommands.ts`, `verifyEditor.ts`, `bundledSkillsInstall.ts`,
`bestOfNManager.ts` (attempt errors reach the panel), `workspaceFiles.ts`
(git error), `storeErrors.ts` (`describeStoreError`), `mcpProcess.ts`,
`ideMcpServer.ts`, `mcpJobLaunch.ts`, and the goal-refused log line in
`conversationController.ts`. Reviewed and left alone: content/equality
checks (`importIo.ts`, `checkpointStore.ts`), rethrow constructors whose
text is formatted at the catch site (`processTree.ts`, `git.ts`), internal
require errors of shipped bundles/tables (already fixed words in the panel;
`lazyBundle.ts`, `l10n.ts`, `planMarkdownBundle.ts`, `reviewBundle.ts`,
`modelApiBackendManager.ts`), model-bound tool output (`toolIo.ts`,
`searchWorker.ts`), and the voice helper adapter (`voiceProcesses.ts`,
`voiceBundle.ts`: fixed commands, OS error text, `dist/voice.js` boundary).

**Confidential workspace gap.** `allowsModel`
(`src/host/conversation/conversationController.ts`) checked the
per-panel confirmation shortcut before `museSpark.confidentialWorkspace`,
so a confirmed contributor model kept sending after the workspace turned
confidential. The confidential check now runs first: a confidential
workspace refuses even a confirmed contributor model with the existing
`contributorBlocked` notice and never calls `session/setModel`; turning
the setting off lets the earlier confirmation stand without asking again.

Docs: SECURITY.md describes the redacted behaviour again, README.md and
`docs/PRIVACY.md` no longer except confirmed models from the confidential
block, CHANGELOG `[Unreleased]` → Fixed carries both bullets.

### Red drills

Each new guard was broken on purpose, watched to fail, and restored
byte-exact (the diff after each restore holds only the intended change).

- `test/unit/skillsCommands.test.ts`, "redacts secret-shaped values from
  failed skill stderr in the notice and the log": with the
  `redactSecrets` wrapper removed from `failureOf`, the run failed
  (1 failed, 8 skipped; exit 1), the raw secret reaching the notice;
  restored, the file passes (9 passed).
- `test/unit/conversationController.test.ts`, "redacts secret-shaped MSP
  errors in the log and the notice": with the wrapper removed from
  `describe`, the run failed (1 failed, 483 skipped; exit 1), the raw
  secret reaching the `skill/list failed` log line; restored, the test
  passes.
- `test/unit/conversationController.test.ts`, "blocks a confirmed
  contributor model once the workspace turns confidential": with the old
  shortcut-first order restored, the run failed (1 failed, 483 skipped;
  exit 1) with `session/setModel` sent twice to the contributor model;
  restored to check-first, the test passes with one `session/setModel`
  and no re-prompt after the setting is turned off.

### Gates

- `test/unit/skillsCommands.test.ts` whole file: 9 passed.
- `test/unit/conversationController.test.ts` whole file: 473 passed,
  10 skipped, plus the two new tests (one needed its failing-handler
  override moved before the first send: the attach-time skill load shares
  the call). Two suites (`deferred best-of-N`, `the Model API bundle`)
  error here on esbuild file access (`Access is denied` resolving files
  that exist): a sandbox limit of this machine, unrelated to the patch;
  the rig reruns everything.
- `tsc --noEmit` on the host project and on the unit-test project: exit 0.
- Full `npm run quality` not run here per the lane (reviewer reruns on a
  rig); no gate was weakened.
