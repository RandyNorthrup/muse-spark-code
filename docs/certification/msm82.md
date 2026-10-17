# MSM82 lane: merge main and re-verify M82 on the current tree

Lane branch `ms/msm82`, worktree on rig `macmini`. Milestone M82
(Awareness and budgets, PLAN.md D49) shipped long before this lane:
main carries its lineage evolved through later milestones (M105 media
reservations, M108 accounts, M109 vault, M117 estimator, M121 exact
money, D78 shared ledger). This lane merges that main, keeps the
test-overhaul deletions deleted, and re-proves M82 on the merged tree.

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
    (`src/extension.ts:3199`), `attentionNotice` in the controller
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

## What was finished

- `test/unit/turnNotice.test.ts` (9 tests, new): M82 notice logic
  through the real modules — events parsed by the real
  `agentEventSchema`, real `attentionNotice`/`BackgroundNotifier`/
  `notifyOpenQuestions`, real constants and English table, real
  timers. The notifier's own ports (show, focus, setting, log) are
  recording closures supplied to its real constructor. No `vi`
  import, no module mock, no casts.
- Red drill: `isReplayed === true` broken to `=== false` in
  `turnNotifications.ts` → 1 failed (`names an approval and a
question, but not a replayed card`); reverted → 9 passed, no diff
  left in source.

## Connections (all on main's evolved code, verified by grep)

- Notification: `BackgroundNotifier` per window
  (`src/extension.ts:3199`), setting read per notice
  (`src/host/conversation/turnNotifications.ts:79`), attention keys
  from the controller (`conversationController.ts:2267`).
- Reply usage: read per reply (`ModelApiHost.ts:754`,
  `modelApiBackendManager.ts:118`), rendered under the reply
  (`.response-usage`), persisted with the transcript.
- Budget cap: read per request (`ModelApiHost.ts:738`),
  machine-scoped setting, reservation preflight before PreLLMCall
  hooks, turn cost against the cap in the transcript.
- Cache savings: `src/webview/usage/SavingsSection.tsx` in Account &
  usage, Model API only.
- Docs: README "Awareness and budgets" + settings table,
  `docs/reference.md` settings, Help via README/CHANGELOG entry
  (M82 shipped in an earlier release section; no new entry needed —
  this lane changes no user-visible behaviour versus main).

## Gates (final tree, exit codes)

- `format:check` 0; `lint` 0; `typecheck` (all five projects) 0.
- `check:badges` `check:tokens` `check:l10n` `check:reference`
  `check:host-api` `check:plan` `check:roadmap` — all 0.
- `deadcode` (knip) 0; `cycles` 0; `duplication` 0 clones.
- `build` 0 (`dist/extension.js` 551.0 KiB,
  `dist/modelApi.js` 507.2 KiB, budgets enforced).
- `security:audit` 0; `test:a11y` on `reply-usage` + `usage-api`
  0 (8 pages, 0 violations; one first-run "never became ready" did
  not repeat).
- Touched tests: `turnNotice` 9/9; `sessionBudget` 42/42;
  `turnNotifications` (old suite) removed per overhaul;
  `manifest` 40, `sessionStore` 21, `mapNotification` 39,
  `usageText` 18, `judgeAdmissionLedger` 8 — all pass.
- Full `test:unit`: 9170 passed, 54 failed in 20 files — every
  failure a 5 s timeout (or one `ENOTEMPTY` fixture-cleanup race)
  under the 24-minute fully-loaded parallel run on this rig;
  `usageL10nGate` re-run alone passes 8/8. Failing files are
  byte-identical to main (this lane's tree differs from main in
  four files: this record, the certification index line, the
  prettier fix and the new test). No M82 file fails.
- `security:secrets` (`gitleaks git`) exits 1 on this clone for 2
  `generic-api-key` hits in commit `3e8ea2c25`, which belongs to
  another lane's branch (`rv/cm1134i`) and is in neither main's nor
  this lane's history; worktree findings are all in git-ignored
  `dist/`/`temp/` build output.
- `security:sast` blocked on this rig: the semgrep binary crashes at
  startup (`ca-certs: empty trust anchors`, also with proxy env
  unset and `--offline`). The lead runs it outside the sandbox.

## Real-life steps for the lead

1. Start the Model API backend, turn on `museSpark.modelApiReplyUsage`,
   send a turn with a tool call: each reply shows its tokens and
   dollar estimate; the turn's lines add to its cost.
2. Set `museSpark.modelApiSessionBudgetUsd` to a small cap, send a
   turn past it: the unfitting request is never sent and the turn
   says why; the transcript shows each turn's cost against the cap.
3. Unfocus the VS Code window, start a turn over a minute long (or
   wait on an approval): one VS Code notification with **Show
   conversation**; nothing while focused.
4. Open Account & usage on the Model API backend: the cache-savings
   row with dollars and share.
5. No live or paid model call was made from this lane.

## APP PROBLEMS

- `security:sast` cannot run in this lane's sandbox (semgrep
  `ca-certs: empty trust anchors` at startup).
- `security:secrets` on a shared clone scans other lanes' refs; the
  2 hits are not on main or this branch.
- Full-suite 5 s timeouts fail under parallel load on this small rig
  (24 min run); each re-run in isolation passes.
