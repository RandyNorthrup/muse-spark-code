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
    (`src/host/conversation/conversationController.ts:2267`),
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
- Withdrawn claims: clicking **Show conversation** and the
  focus gate end to end are not proven by any test here; they are
  real-life steps below. The full unit gate is not claimed green
  (finding 2).

## What was finished (finding 2)

- The earlier record called a full `test:unit` run with 54 failures
  a re-verification. That claim is withdrawn. The lane diagnosed
  every failure (two full runs; see the PLAN.md §7 deferral this
  lane added): eight cases cannot pass in this rig's sandbox
  (seven need `/bin/ps`, which answers `Operation not permitted`
  here; one fixture hook times out on this rig's slow disk), and
  the rest were disjoint parallel-load flakes that pass file-alone
  on the same tree. No timeout, threshold, gate, or assertion was
  changed. Hosted CI is the binding full gate; the lead re-runs
  the eight cases outside the sandbox or takes the CI macOS shard.

## Removals

- `test/unit/turnNotifications.test.ts` (created by M82,
  `22106486a`): deleted on main by the test overhaul
  (`f2b00c094`, an ancestor of `main-now`); the merge resurrected
  it and this lane re-deleted it. Its scripted notifier closures
  are finding 1; the replacement is `turnNotice.test.ts` plus the
  integration suite. PLAN.md's planned M88 lane table still names
  the file; that table is equally stale on `main-now`, which also
  lacks the file.
- Six further candidate test files the merge kept deleted
  (`Transcript`, `UsageDialog`, `conversationController`,
  `modelApiHost`, `settings`, `uiState`): all absent on the merged
  main by the same overhaul; none is this lane's deletion.
- Four `BackgroundNotifier` closure tests from this lane's first
  `turnNotice.test.ts` (9 tests → 7): replaced by the integration
  suite; the once-per-key rule they covered moved to
  `NoticeMemory` and is unit-proven there.
- The inline notifier closures in `src/extension.ts` and the
  `raised` set in `BackgroundNotifier`: moved, not lost — to
  `vscodeBackgroundNoticeDeps` and `NoticeMemory` respectively,
  with identical semantics (`currentSettings()` was itself
  `readSettings(getConfiguration(SETTINGS_SECTION), log)`).
- Review fix (RVPR203FIX): the quiet-test reveal callbacks'
  inline `assert.fail` calls are removed because `raise` catches
  reveal errors and only logs them, so they could never fail;
  reveals are counted and asserted after the settle instead.

## Gates on the merged tree (RVPR203FIX review, 2026-10-17)

Merged `main-now` (`e49e65ac7`, 51 commits) with no conflicts;
`main-now` then advanced during the review and was merged again
(`81dacaf5a`, also conflict-free; typecheck, host-api, plan,
roadmap, ESLint, unit 7/7 and `build` re-run green after it —
`build` first failed only on the review's own leftover
`dist/test` dev bundles and passes with them removed). The
lane's ten files survive unchanged in intent. Exit codes:
`typecheck` (all projects) 0; ESLint `--max-warnings=0` on the
five touched code/test files 0 (including main's new
no-stand-ins lint); Prettier on all ten touched files 0;
`check:l10n` 0; `check:reference` 0; `check:host-api` 0 (381
APIs, 49 files); `check:plan` 0; `check:roadmap` 0; `deadcode`
0; `cycles` 0; `duplication` 0 (0 clones); `build` 0;
`build:dev` 0; `security:audit` 0. `security:sast` exits 2 in
this sandbox (`ca-certs: empty trust anchors` at semgrep
startup, also reported by the lane); the lead runs it outside
the sandbox. Tests: `turnNotice` 7/7 (repo default timeout);
red drill — `NoticeMemory.take` dedup disabled → both memory
tests fail, reverted → 7/7; integration `backgroundNotice`
4/4 on stable (VS Code 1.142.0) through the real Extension
Development Host. The lane's 4/4 on the manifest-floor version
and its two full unit runs are lane-reported, not re-run in
this review; the full unit suite remains hosted CI's gate.
This record's tail was committed truncated at `0d1646306`
(it ended mid-word); the review completed it from the runs
above.

## Real-life steps for the lead

1. Unfocus the VS Code window, run a turn over a minute (or one
   that waits on an approval/question): exactly one VS Code
   notification; click **Show conversation** → the conversation
   comes into view. Focused: no notification. Setting
   `museSpark.notifyOnBackgroundTurn` off: none either way.
2. Model API reply usage and session budget steps are unchanged
   from `m82.md`; this lane changed no product behaviour there.
3. No live or paid model call was made from this lane or review.
