# MSM82 lane: merge main and re-verify M82 on the current tree

Lane branch `ms/msm82` (PR #203), continued on `fix/pr203-review` as lane
PR203FIX, worktree on rig `macmini`. Milestone M82 (Awareness and budgets,
PLAN.md D49) shipped long before this lane: main carries its lineage evolved
through later milestones (M105 media reservations, M108 accounts, M109
vault, M117 estimator, M121 exact money, D78 shared ledger). This lane
merges that main, keeps the test-overhaul deletions deleted, and re-proves
M82 on the merged tree. It also fixes the two P1 review findings on PR
#203: the notifier unit tests certified scripted closures, and the earlier
record called a red full unit gate a re-verification.

## What was merged from which branch

- Starting point: `rigs/kubuntu/review-m82-review` (`17cca2f47`), which
  already contains `rigs/kubuntu/gate-m82-review` (`22106486a`): no
  separate merge needed between the candidates.
- Merged `main-now` (`3d30a7321`) into the lane (`f6e63edab`). Both
  candidate commits predate main by ~3 weeks; main is a strict
  superset of their source changes, verified per file:
  - `sessionBudget.ts`: ours 145 lines, main's 400 (exact-USD
    journal, image fees, search/voice admission, D78 scopes).
  - Every M82 setting, string, and wiring exists on main:
    `museSpark.notifyOnBackgroundTurn`,
    `museSpark.modelApiReplyUsage`, `museSpark.modelApiSessionBudgetUsd`
    (`package.json`), `BackgroundNotifier` per window
    (`src/extension.ts:3201`), `attentionNotice` in the controller
    (`src/host/conversation/conversationController.ts:2269`),
    `reply-usage` harness scenario, M82 case19 preserved as live
    case22 (`test/e2e/modelApi.live.e2e.test.ts:40`).
- Conflict resolution: main's version taken for all source, locale,
  manifest, script, harness, PLAN, README, CHANGELOG, and cert files
  (our PLAN/CHANGELOG/README additions are already in main's released
  sections). Decision numbers: no new D-numbers added, so no
  renumbering from D140 was needed; our old §3 Q10 (OS toast) is
  answered in main's archived M82 text. Test-overhaul deletions kept
  deleted (`git rm` of the six modify/delete test files), including
  `test/unit/turnNotifications.test.ts`, which the merge had
  resurrected and this lane re-deleted.
- Merge repair (lane's own change): auto-merge kept two
  `.response-usage` blocks in `src/webview/styles.css`; the older
  hardcoded duplicate is removed, leaving the single token-based rule.
  Stylelint passes. No visual change versus main (main has one block).
- Incidental: `docs/certification/m95-captures.md` formatted with
  prettier (2 lines; pre-existing `format:check` failure, file and
  config byte-identical to main).
- PR203FIX confirmed `main-now` still merged (`git merge --no-ff
main-now` → Already up to date) and added: `NoticeMemory` plus the
  live-host deps factory (`turnNotifications.ts`,
  `vscodeBackgroundNotices.ts`), the activation rewiring
  (`src/extension.ts`), the rewritten unit suite, the new integration
  suite, the regenerated host-API record, and this record.

## What was finished (finding 1)

- `test/unit/turnNotice.test.ts` (7 tests): M82 notice policy through
  the real modules — events parsed by the real `agentEventSchema`,
  real `attentionNotice`/`notifyOpenQuestions`, the real `NoticeMemory`
  (once-per-key plus bounded eviction against the real
  `BACKGROUND_NOTICE_KEYS_MAX`), real constants and English table,
  real timers. No `vi` import, no module mock, no casts, no ports at
  all: the four `BackgroundNotifier` closure tests are deleted (see
  Removals), and the file's header names the integration suite as the
  ports' proof.
- `src/host/conversation/turnNotifications.ts`: the once-per-key rule
  extracted from `BackgroundNotifier` into the port-free `NoticeMemory`
  (`:83`), which the notifier owns; `notify` behavior is byte-for-byte
  the old semantics (`take` first and always, then the setting/focus
  gates, then `raise`).
- `src/host/conversation/vscodeBackgroundNotices.ts` (new):
  `vscodeBackgroundNoticeDeps` (`:16`) builds the production ports
  from the live host — the real setting read, the live
  `vscode.window.state.focused`, VS Code's real `showInformationMessage`
  with the real **Show conversation** button. `src/extension.ts:3201`
  wires it; the old inline closures are gone.
- `test/integration/backgroundNotice.test.ts` (4 tests, real Extension
  Development Host): the setting adapter follows live config updates,
  the focus adapter reports the live window state, the real notifier
  stays quiet with the real setting off (a wrongly reached notice
  would really appear: `show` delegates to the real editor API and
  only counts the call), and `show` displays a real notification —
  still awaiting its human click after 2 s, which proves the real API
  accepted and displayed it. 4/4 on stable and on the manifest floor.
- Red drills: `isReplayed === true` broken to `=== false` →
  `names an approval and a question, but not a replayed card` fails;
  `NoticeMemory.take` dedup disabled → both memory tests fail;
  reverted → 7/7 pass, no diff left in source.
- Withdr
  ...[truncated 6154 chars]
