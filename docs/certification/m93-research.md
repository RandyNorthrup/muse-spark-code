# M93 — Report a problem: research and planning record

2026-10-04. **Planning only; no recorder, report command or crash recovery is
implemented or certified by this lane.** Owner's approved brief: `M93PLAN.md`
and `common.md`, session `f5e67bec-452c-4384-85e7-efedc257d060`. Decisions and
implementation acceptance are PLAN D72/M93; Muse implements, Codex reviews.

## Current support path

Read `src/extension.ts`'s `museSpark.diagnostics` registration,
`src/core/support/report.ts`, `src/host/logger.ts`, `src/core/redact.ts`,
`src/shared/palette.ts`, `package.json`, and `docs/PRIVACY.md` in the requested
checkout. Diagnostics formats D14 facts into the redacting log channel;
Support's Report an issue item opens `ISSUES_URL`. The manifest supplies
`bugs.url`. None is a persisted, exact-preview report workflow.

`SupportFacts` has booleans/counts and fixed status fields, but also strings
such as CLI install paths and failure reasons. Reusing the renderer alone
does not establish the new allowlist. `redactSecrets` covers known credential
shapes, not arbitrary confidential prose or personal identifiers. Do not
attach existing logs; the brief's raw MSP/skill-stderr audit fix is a separate
lane (`docs/truth-audit-0120`), not proved by this task.

## VS Code issue reporter at the 1.99 engine floor

Fetched and read upstream tag `1.99.0`, resolved Git tree
`4437686ffebaf200fa4a6e6e67f735f3edf24ada`; this is source inspection, not a
running-editor receipt. Public [command reference](https://code.visualstudio.com/api/references/commands)
also documents the command's optional prefill argument.

- [Command registration and option schema](https://github.com/microsoft/vscode/blob/1.99.0/src/vs/workbench/contrib/issue/common/issue.contribution.ts#L18):
  both `workbench.action.openIssueReporter` and `vscode.openIssueReporter`
  accept `extensionId`, `issueTitle`, `issueBody`. The object is passed to
  `openReporter`; `telemetry.feedback.enabled=false` disables feedback, and
  a distribution without `reportIssueUrl` need not register a working reporter.
- [Data interface](https://github.com/microsoft/vscode/blob/1.99.0/src/vs/workbench/contrib/issue/common/issue.ts#L67)
  includes `data`; [desktop service](https://github.com/microsoft/vscode/blob/1.99.0/src/vs/workbench/contrib/issue/electron-sandbox/issueService.ts#L35)
  forwards it into extension data. It is absent from the command's documented
  option schema. Prefer supported `issueBody` for the complete scrubbed draft,
  with `extensionId: RandyNorthrup.muse-spark-code`, and a scrubbed title.
- The desktop service also gathers installed/enabled extension metadata,
  experiments and host posture, and consults existing GitHub sessions. Our
  extension must never request, receive or retain that token.
- [Reporter model](https://github.com/microsoft/vscode/blob/1.99.0/src/vs/workbench/contrib/issue/browser/issueReporterModel.ts#L48)
  defaults diagnostic sections on and serializes host information with the
  description. Its inclusion switches are not documented command options.
- [Reporter behavior](https://github.com/microsoft/vscode/blob/1.99.0/src/vs/workbench/contrib/issue/browser/baseIssueReporterService.ts#L124):
  `issueBody` fills the description. The host can search GitHub for related
  issues, submit through its own token after the user submits, or open a
  prefilled browser URL; an oversized URL has a clipboard-dialog fallback.

**Verdict: prefill works in the engine-floor source; native output is not an
exact-only, network-free export.** D72 therefore uses it as a separately
disclosed, explicit action after our preview, with body/title/extensionId,
alongside the exact GitHub/Copy/Save choices. Runtime proof must cover 1.99 and
current VS Code, disabled/missing commands, prefill visibility and the host's
additional-data/search/submission boundary. A promise resolving does not prove
a form opened. No private flags or host-setting changes are a workaround.

## Other extensions

- **Python:** Microsoft's [April 2024 release note](https://devblogs.microsoft.com/python/python-in-visual-studio-code-april-2024-release/#report-issue-command-improvements)
  describes Python and Python Debugger adopting the workbench reporter; users
  select the affected extension and supply more information. Useful precedent
  for host-native reporting, not proof that it excludes host diagnostics.
- **GitLens:** inspected commit `a3ab1179ac86a0d83cb35c63a0af9114a6003f99`.
  [`ReportIssueCommand`](https://github.com/gitkraken/vscode-gitlens/blob/a3ab1179ac86a0d83cb35c63a0af9114a6003f99/src/commands/help.ts#L30)
  opens its GitHub new-issue chooser. Its [URL constants](https://github.com/gitkraken/vscode-gitlens/blob/a3ab1179ac86a0d83cb35c63a0af9114a6003f99/src/constants.ts#L141)
  also define a bug-form URL and prefillable description/version fields;
  the [issue form](https://github.com/gitkraken/vscode-gitlens/blob/a3ab1179ac86a0d83cb35c63a0af9114a6003f99/.github/ISSUE_TEMPLATE/bug_report.yml)
  asks the user for context and optional logs. The inspected palette command
  itself does not collect or submit a diagnostic package. Adopt the explicit
  browser handoff, not optional raw-log attachments.

## Privacy and SoL-Pi review

D72/M93 specifies strict entry/value allowlists, write-time and export-time
scrubs, journal tamper validation, UTF-8/age caps, package-relative frames,
one offer per stale activation, live-window protection and exact draft binding.
No conversation ids or free-text errors enter the recorder. User descriptions
and host/browser/clipboard/file handoffs retain disclosed privacy limits.

Read the brief-named `sol-pi-invariants.md` (owner, 2026-10-04). Reporting must
not alter earlier request bytes, stable tools, ObservationPack/archive/sticky
swaps, consent/budgets, guarded `then_run`, hard-limit compaction or hidden
turns, or M75 comparability. M93 requires golden requests and owning invariant
tests; no model evaluation or paid/live call was made in this planning lane.

## Lane state and validation

The user's explicit worktree is `C:/Users/Randy/Coding/muse-extension`,
superseding the brief's proposed `mx-m93` worktree. Branch `feature/m93-report`
starts at `327094412dac315b1f8dcf971b014c6c69b27104`. Read D69/M89's style from
local `origin/main` (`1e93c67c1fa9b5f9cb5d25df887e847465b00399`).

Integration attempted before edits: `integrate/m72-on-24ff` is absent;
`git merge --no-edit origin/main` aborted because incoming tracked
`test/unit/handoffDialog.test.tsx` would overwrite the user's untracked file.
The file remains untouched. Lead must reconcile it before integration; no
reset, clean, stash, overwrite or push was used to bypass the conflict.

Windows: changed Markdown passes Prettier and `git diff --check`; commit hooks
run lint-staged and Gitleaks. Mac mini snapshot
`dfa122d0e8f3cc856e9010e39b1dcfc02b9d3260`: five-project `npm run typecheck`,
`npm run deadcode`, `npx --no-install jscpd` (0 clones), `npm run check:l10n`
(14 tables, 0 problems), `npm run check:host-api` (0 problems), and `npm run build`
all exit 0. Bundles: extension 561.7 KiB, Model API 390.3 KiB, ACP 781.2 KiB.
Log: `temp/m93-research/rig-static.log`; product inputs match this lane's HEAD.
These are the older checkout's sizes, not a measurement of integrated M93.
The rig's dependency install reports 11 existing vulnerabilities (2 low, 9
high); no audit remediation or security certification is claimed here.
ESLint/owning vitest: not applicable; no executable files changed.
The task's common rules delegate aggregate quality to the lead; no local full
run, product test or new guard drill was run. All M93 runtime receipts remain
open. No owner design question blocks the plan; integration is the blocker.
