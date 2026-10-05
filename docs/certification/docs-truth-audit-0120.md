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

## RVAUDIT round 2 — FIXAUDIT (2026-10-04)

This section supersedes the round-1 claims of complete diagnostic redaction
and contributor dispatch protection. The seven findings in the supplied
`RVAUDIT.report.md` were treated as the acceptance criteria, with the source
and permanent tests reviewed before implementation. The existing `PLAN.md`
D4 and this record remain the plan/proof ledger; no parallel tracker was
introduced. No dependency, permission setting, localization key, wire schema
or gate threshold was changed by these fixes.

Started at `fe609687`, in `C:/Users/Randy/Coding/mx-docaudit`, branch
`docs/truth-audit-0120`. The obsolete `integrate/m72-on-24ff` ref was absent;
the merge was started against the available newer `origin/main` at
`23f38dd6`. Release/CI changes and audit corrections were preserved in the
five documentation conflicts. Later changes to the shared remote-tracking
ref are not silently included in these receipts.

### Findings, fixes and permanent tests

| Finding                                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                             | Permanent regression                                                                                                                                                                                                                                                           | Deliberate failure                                                                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1, P1: existing contributor sessions could dispatch after confidentiality changed | `requireNonConfidentialModel` checks the current panel selection and session model immediately before send/steer, fallback sends, review, scheduled run, session start/attachment and resume. `confidentialWorkspaceChanged` cancels/retires contributor sessions and refreshes the model catalogue; the configuration listener calls it. Muse Code updates its session model after successful `setModel`, so a later standard selection works. | `conversationController.test.ts`: active/idle sends, autosave await, queued text-file preparation, refused-steer fallback, start/resume setup awaits, configuration retirement and return to a standard model. `MuseCodeHost.test.ts`: successful selection updates `modelId`. | Shared admission/configuration guards and model-state update disabled; unexpected turn/RPC counts and absent cancellation were observed. |
| 2, P1: confirmation await could authorize a newly confidential workspace          | Recheck after confirmation before remembering it, after `allowsModel` resolves before `session/setModel`, and before resume/adoption dispatch.                                                                                                                                                                                                                                                                                                  | Controller tests: confidentiality changes inside confirmation; a microtask changes it between guard resolution and model RPC. Rejected stale confirmation must ask again after confidentiality is off.                                                                         | Confirmation and final model guards disabled; the forbidden RPC was observed.                                                            |
| 3, P1: failed-turn reasons reached event consumers and saved panel history        | One `redactDiagnosticEvent` in existing `core/redact.ts` protects failed-turn/retry/withdrawal diagnostic reasons and backend notices. MSP mapping and Model API event emission apply it before subscribers; the panel post boundary applies it again to raw diagnostic events and redacts notices. Ordinary conversation/tool content is preserved.                                                                                            | `mapNotification.test.ts`, `redact.test.ts`, and controller tests for MSP failed-turn reasons, raw backend events and Model API failures seen by both a direct subscriber and the panel.                                                                                       | Shared event redactor replaced with identity; raw synthetic credential values reached the asserted diagnostic events.                    |
| 4, P1: MCP picker failure details bypassed redaction                              | `liveState` redacts `state.reason` before filling the picker detail.                                                                                                                                                                                                                                                                                                                                                                            | `museConfigCommands.test.ts`: failed connection detail contains the redaction mark and excludes the synthetic token.                                                                                                                                                           | Reason redaction removed; picker displayed the token.                                                                                    |
| 5, P1: voice error/close notices bypassed redaction                               | Panel notice boundary redacts text; notice logging redacts before even an injected logger receives it.                                                                                                                                                                                                                                                                                                                                          | Controller voice tests inject both error-frame and close-reason failure text through the dictation listener, asserting safe notice and log.                                                                                                                                    | Notice post/log redaction disabled; both probes leaked the synthetic token.                                                              |
| 6, P2: CLI errors logged account/profile text                                     | RPC failures use `failureForLog` in log descriptions and notice logs while retaining redacted panel detail. Async failure log reasons use `stderrForLog`. Skill activation stdout/stderr uses fixed-word/length descriptions; summary logs use counts. Notification-handler failures use fixed failure words, and protocol faults use a fixed line.                                                                                             | Controller direct/asynchronous CLI log tests; `skillsCommands.test.ts` checks stderr and stdout; `MuseCodeHost.test.ts` checks notification-handler privacy and fixed protocol logging. Existing panel assertions remain detailed.                                             | Fixed log helpers bypassed; account/profile text and raw activation output were observed.                                                |
| 7, P3: scanner forced-signal docs omitted an earlier latched stop                 | `docs/ci.md` and `docs/acp.md` now state first-stop precedence: POSIX timeout already latched keeps 6; 130/143 apply when a signal latched first. Windows forced process exit is 1.                                                                                                                                                                                                                                                             | `execLimits.test.ts`: timeout, SIGINT, SIGTERM and forced cleanup produce exit 6.                                                                                                                                                                                              | Forced exit changed to use the later signal; test observed 143 instead of 6.                                                             |

### Rig evidence and restoration

Every test command used `rig-test.sh`; every build and multi-project typecheck
used `rig-run.sh`. Complete files were run without test-name filtering, new
skips or timeout changes. No local vitest, full `npm test`, full `npm run quality`,
live/paid model call, external push or credential read was performed.

- Mac mini first: pre-fix snapshot `afdfb264`, four complete files,
  **12 failed / 513 passed**, exit 1. This includes the seven findings'
  original probes and changed log-contract assertions.
- Mac mini reached **761 passed**, but five PDF-fixture writes failed with
  `ENOSPC`. That run is not green. No other rig's files were deleted; testing
  moved to the permitted Kubuntu fallback.
- Kubuntu baseline `65450a5a`, seven complete files: **768 passed**, exit 0.
- Kubuntu deliberate fault batch, slot `fixaudit-0120-drill`: **35 failed /
  733 passed**, exit 1. Failures included each finding's listed regression;
  they were behavioral assertion failures, not setup or disk failures.
- Six mutated source files were restored from byte copies and independently
  compared by SHA-256. Every before/after digest matched. Details are in
  `temp/fixaudit-drill-hashes.json`; full baseline/drill/restored output is in
  `temp/fixaudit-green6.log`, `temp/fixaudit-drill.log` and
  `temp/fixaudit-restored.log` in this worktree.
- Restored Kubuntu snapshot `cf5dfb6a`, eight complete files (adding the full
  Model API suite): **1,321 passed**, exit 0. Its tree and the baseline tree
  both equal `cddd43047a01a543a2d127ca3f6f9e557a3534cc`.

The source files drilled were `conversationController.ts`, `core/redact.ts`,
`MuseCodeHost.ts`, `museConfigCommands.ts`, `skillsCommands.ts` and
`runtime/exec/execLimits.ts`. The lifecycle source has no final change.
The fixture model ids and diagnostic fields reuse existing captured parsers
and test shapes; the secret-shaped strings are synthetic and built at runtime.

### Limits and checks still owned by the lead

An additional controller-level retry probe was stopped per `common.md` after
two unsuccessful fixture approaches (`response.failed/server_error`, then
the existing `error/server_shutting_down` shape) produced no retry event in
that controller harness. It was not turned into a passing claim or a skipped
test. The required asynchronous failed-turn probe is permanent and passes;
the shared redactor's retry case and the full existing Model API retry suite
pass. This lane does not claim an independent credential-bearing controller
retry-flow certification.

No UI layout was changed in round 2. Browser accessibility/responsiveness,
full quality/coverage, hosted CI/platform gates and live certification remain
the lead's checks under the lane rules. Unit lifecycle evidence does not
certify OS signal delivery. Mac mini disk exhaustion remains an environment
issue; successful Kubuntu checks are identified separately.

Final static/build receipts and hook result are recorded below after execution.

### Final validation receipts

Kubuntu `fixaudit-0120-last-green`, snapshot `a145de14`: all eight complete
files passed, **1,322 tests**, exit 0. This follows test-only naming/arity
corrections and parameterization of both start/resume admission cases to
remove duplication; neither case was dropped.

The final review also protected the outer action handler from logging an
uncaught MSP stack. Its real fake-MSP regression passed in the complete
controller file (503 tests); disabling only that guard produced **1 failed /
502 passed**, exit 1 (`8c4e2f66`). Restoration matched SHA-256
`dd0885bb02d25aaa561457bf28280d97333cccb8113ef2f7663423ac6f55cf05`.
The before/mutated/after receipt is `temp/fixaudit-stack-hashes.json`.

Kubuntu `fixaudit-0120-last-gates`, snapshot `fb628f2b`, exit 0:

| Check                                                           | Observed result                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ESLint on the 15 affected source/test files, `--max-warnings=0` | pass                                                                                    |
| Prettier on affected source/tests and product documentation     | pass                                                                                    |
| `npm run typecheck`                                             | host, webview, unit, e2e and integration all pass                                       |
| `npm run deadcode`                                              | pass; pre-existing `vendor/**` configuration hint only                                  |
| `npx jscpd`                                                     | 0 clones; threshold remains 0                                                           |
| `npm run check:l10n`                                            | 14 tables, 120 manifest strings, 421 source files; 0 problems                           |
| `npm run check:host-api`                                        | 271 APIs, 18 VS Code-importing files, 23 Node built-ins, 59 theme variables; 0 problems |
| `npm run build`                                                 | all size/split/global/notice checks pass                                                |

Final sizes: extension **555.1 KiB / 600**, Model API **426.6 KiB / 475**,
checkpoint store **109.1 KiB / 225**, shared English **105.3 KiB / 125**.
The source at the starting `fe609687` already budgets Model API at 475 KiB;
this lane changed no cap. `common.md` still lists 400 KiB, so these receipts
prove the inherited repository gate, not a 400 KiB bound. The lead must
reconcile that stale brief limit before claiming it satisfied.

Full output remains in `temp/fixaudit-last-green.log`,
`temp/fixaudit-last-gates.log` and `temp/fixaudit-stack-red.log`. The commit
uses the existing lint-staged and gitleaks pre-commit hooks; its observed
outcome is reported in the completion handoff.

## PR #116 integration with M87 (MRG116, 2026-10-04)

Merged `main-sync` at `244d5905` into the hardening branch at `856536a8`
with `git merge --no-ff --no-commit main-sync`, on Kubuntu in
`/home/randy/lanes/MRG116`. No push, rebase, live model call, paid call or
credential read was performed. The lane's shared rules assign the full
quality/coverage, accessibility and hosted platform gates to the lead.

### Conflict resolutions and generated material

- `README.md`: kept imported conversations' Copy-only code blocks and the
  backend-specific approval choices, together with M87's reply menus,
  highlighted-text pills, step summaries and diff tally. The commands table
  keeps the truth audit's accessibility exceptions and two-turn live-test
  description, and M87's screenshot script and shared-English bundle facts.
- `conversationController.ts`: kept M87's in-flight revert admission checks
  and both final confidentiality checks. The edit-review failure retains
  M87's running-turn refusal and the hardening's original error argument,
  so MSP failures still log by kind/code.
- `conversationController.test.ts`: retained both sets of imports, M87's
  regressions and the hardening coverage. Four older sandbox-warning
  expectations on main are superseded by the existing hardening tests,
  which warn even when the user chose off and claim the warning once per
  window. Three new regressions cover M87's queued-edit refusal boundary,
  failed queued edit and failed Tasks tab. No wire parser or schema was added.
- The fifteen conflicting `media/readme/*.png` files were regenerated,
  together with all four walkthrough images, from the merged dev build.
  `npm run readme:shots` and `npm run harness:shots -- empty tools
slash-palette signin` succeeded with a lane-local Playwright adapter via
  `CHROME_PATH`: the Chrome CLI stalled before its first image both with
  its normal arguments and with extensions/background networking disabled.
  The adapter uses each script's declared scenario, viewport, language,
  theme and six-second virtual time, and emulates focus. It is an ignored
  local capture aid, not a shipped script or gate change. Modes and turn
  screenshots were visually checked.
- `CHANGELOG.md` merged cleanly: one Unreleased section, in Added, Changed,
  Fixed, Security order; every byte from the first released heading onward
  matches `main-sync`. The diagnostic bullet now names M87's two paths.
- `SECURITY.md` and `docs/PRIVACY.md` had no incoming changes from
  `main-sync`; both keep the complete hardening versions.
- Regenerated `docs/ide-compatibility/host-api.md` with its own `--write`
  script and the ignored pseudo-locale with `npm run harness:pseudo`.
  `node scripts/exec-schema.mjs --check` confirms the exec schemas match.

### Boundary fix and drills

The first complete controller run failed exactly the new raw queued-edit
refusal regression: **1 failed, 543 passed**. M87's `withdrawRefused`
message now passes its `reason` through the same `redactSecrets` function
in the existing host-to-webview `post` boundary. Task-tab notices already
pass its notice branch. Ordinary message/tool content remains intact.

With `redactSecrets` deliberately changed to identity, the complete
controller suite failed **9 tests, 535 passed**, including all three new
regressions. The source was restored byte-for-byte: before and after
SHA-256 `6d53f7aa5ba926db99c1cbce8a502c6800f66967ebcb1595ae06d2dd63b6d692`;
mutated `38b451da9e0a7e50e76dc11edb6eba6ced3b7db68e280cdc8c0b16ffd6fa2f4c`.
The restored controller, redactor and App batch passed all **785** tests.
Logs and the hash receipt are under the ignored `temp/mrg116/` directory.

The continuation also drilled the final switch-based panel boundary directly:
replaced only `redactSecrets(message.reason)` with `message.reason` in
`withdrawRefused`. The complete controller file failed **1 test, 543 passed**,
the queued-edit boundary regression. Restoration matched SHA-256
`7921009c305816c4cd6157f3a682eeb28f1f09242718d6748f890deed5b42549`;
mutated `0f41b2ca8c2d34372ede764841ef460d0bbb4ecb99fabbc7fd35102f273ec6a1`.
The restored controller/redactor/App batch again passed all **785** tests.
Receipt: `temp/mrg116/resumed-boundary-drill.json`.

### Owning tests on Kubuntu

Every run used complete files, `--maxWorkers=3 --testTimeout=120000`, with
at most three files per invocation. The continuation reran the original
17 owning files and three tasks/protocol files against the final source:
all **1,936 tests in 20 files** passed, with no skipped tests:

| Files                                               | Tests | Result |
| --------------------------------------------------- | ----: | ------ |
| conversationController, redact, App                 |   785 | pass   |
| permissions, museCodeProtectedWrites, approvalRules |   164 | pass   |
| permissionModes, permissionPolicy, sandbox          |    48 | pass   |
| sandboxSetup, mapNotification, museConfigCommands   |    68 | pass   |
| changelogVersion, manifest, MuseCodeHost            |   129 | pass   |
| modelApiHost, readmeShots                           |   594 | pass   |
| TasksApp, tasksPanel, protocol                      |   148 | pass   |

### Final static/build receipts on Kubuntu

| Check                                  | Observed result                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run typecheck`                    | all five projects pass                                                        |
| `npm run lint`                         | JS and CSS pass; existing Windows-only PowerShell gate skips                  |
| Prettier on all 164 changed text files | all matched files pass; inherited CHANGELOG ignore stays intact               |
| `npm run deadcode`                     | pass; existing `vendor/**` configuration hint only                            |
| `npx jscpd`                            | 0 clones; unchanged threshold                                                 |
| `npm run cycles`                       | 415 files, no circular dependencies                                           |
| `npm run check:l10n`                   | 14 tables, 121 manifest strings, 434 source files; 0 problems                 |
| `npm run check:host-api`               | 279 APIs, 19 VS Code files, 23 Node built-ins, 57 theme variables; 0 problems |
| `node scripts/exec-schema.mjs --check` | committed schemas match                                                       |
| `npm run build`                        | all size, split, host-global and notice checks pass                           |
| Changelog release-byte comparison      | released sections byte-identical to `main-sync`                               |
| `git diff --check`, unresolved index   | no whitespace errors, merge markers or unmerged entries                       |

The interrupted lint run's switch-style finding was fixed without a
suppression; three style findings in the ignored capture adapter were fixed
too. The complete resumed lint run exits 0. Final bundle sizes include
extension **566.3 KiB / 600**, Model API **428.6 KiB / 475**, checkpoint
store **109.3 KiB / 225**, shared English **111.5 KiB / 125** and webview
**889.6 KiB / 900**. No cap changed.

Fresh logs and command/exit-code receipts are in `temp/mrg116/resumed-*.log`,
`resumed-static.json` and `resumed-tests.json`. The pre-commit lint-staged
and gitleaks checks remain enabled. Only lint-staged's automatic backup is
disabled with its `--no-stash` option for the commit invocation, to comply
with the brief's prohibition on stashing; the hook's original bytes are
restored afterward. The observed commit/hook outcome is reported in the
completion handoff. Full quality/coverage, accessibility and platform
acceptance remain the lead's checks under the lane rules (PLAN.md §7).
