# Lane NOLIMITS5 certification — no default Tab budget, no default CLI request limit

First-result record (what the person sees now → what they will see after this lane).
Design: `0` means no Tab budget (the `modelApiSessionBudgetUsd: 0` = no-cap
precedent); an unset `--max-requests` means no request limit (`null` through
the exec protocol, which already models it).

## Tab daily budget

- `package.json` `museSpark.tabDailyBudgetUsd` (Settings UI): now
  `default 1, minimum 0.05, maximum 50` → `default 0 (= no budget),
minimum 0`, no maximum. The settings editor stops showing "$1.00" as the
  provisioned budget and stops refusing values above $50.
- `src/shared/constants.ts` `TAB_DAILY_BUDGET_DEFAULT_USD = 1` /
  `TAB_DAILY_BUDGET_MAX_USD = 50`: now the $1 fallback behind Account &
  usage, the usage-page reader and the spend gate → both removed; nothing
  reserves or locks spend the person did not cap. `TAB_DAILY_BUDGET_MIN_USD`
  stays as the dust floor for a budget the person does set.
- `src/host/settings.ts` validation: now any value outside $0.05–$50 falls
  back to $1 → `0` (no budget) or any positive amount validates; no ceiling.
- `src/host/usage/usagePanelEntry.ts:88`: now reads the setting with a
  `$1.00` fallback and marks spend stopped at/over it → falls back to no
  budget, and with no budget nothing is ever reported stopped.
- Status bar tooltip (`tabStatusTooltip`, "…{spend} of the {budget} daily
  budget"): now always names a budget → with no budget it says there is none.
- First-run consent popup (`paidUseTabDetail`, "Today's budget is {budget};
  Tab stops for the day if it is reached"): now always names a budget →
  with no budget it says requests are uncapped instead.
- Composer/badge text (`paidConfirmTab`, "capped by a daily budget you can
  change in settings"): now states a cap exists → states the person may set
  one, and that nothing is capped otherwise.

## Account & usage, Tab row (`PaidUsageSection.tsx:118`, shown at 136/139)

- Now: while Tab state has not arrived (`paid.tab === undefined`) the row
  renders `Daily budget: $1.00` from the hard-coded fallback.
- After: it renders that the budget value is not known yet; once state
  arrives it renders the person's budget, or that no daily budget is set.

## CLI request limit (`EXEC_DEFAULT_MAX_REQUESTS = 30`)

- Now: `exec --backend modelApi` without `--max-requests` stops the run
  after 30 model requests (`request_cap`), and `--help`/`docs/ci.md`/the
  generated reference document `30` as the default.
- After: without `--max-requests` there is no request limit; `--max-requests
<n>` (1–500) still caps the run exactly as before. Help, `docs/ci.md` and
  the generated reference say so.

## Texts and docs

- `package.nls.json` `config.tabDailyBudgetUsd.description`, `README.md`
  Tab section + settings table, `docs/ci.md` `--max-requests` rows, CLI
  `--max-requests` help: updated to the above, then `npm run check:l10n`
  and `npm run check:reference` green.

## What changed (commits 94fda3a, 9425bf5, 68e66fe, 05d5b57)

- `src/shared/constants.ts`: `TAB_DAILY_BUDGET_DEFAULT_USD` (1) and
  `TAB_DAILY_BUDGET_MAX_USD` (50) removed; `TAB_NO_BUDGET_USD = 0` added
  (`0` is no budget, the `modelApiSessionBudgetUsd: 0` = no-cap precedent).
  `SETTING_DEFAULTS.tabDailyBudgetUsd` is `0`. `TAB_DAILY_BUDGET_MIN_USD`
  (0.05) stays as the dust floor for a set budget.
  `EXEC_DEFAULT_MAX_REQUESTS` (30) removed; `EXEC_MAX_REQUESTS` (500)
  still bounds a set value.
- `src/host/settings.ts`: validation is `0` or `>= 0.05`, no ceiling.
- `src/host/tab/tabLedger.ts`: `admit` skips the cap check at budget `0`
  but still writes the reservation, so spend accounting continues.
- `src/host/tab/tabBundle.ts`: `isBudgetReached` is false at budget `0`;
  the status tooltip uses `tabStatusTooltipNoBudget` then.
- `src/core/paid/paidUseQuestion.ts`: consent uses
  `paidUseTabDetailNoBudget` at budget `0`.
- `src/host/usage/usagePanelEntry.ts`: falls back to no budget; with none
  the `tab-daily` row carries spend with no `capUsd` and `stopped: false`.
- `src/webview/components/PaidUsageSection.tsx`: no `paid.tab` renders
  `usagePaidTabBudgetUnknown`; budget `0` renders
  `usagePaidTabBudgetNone`; otherwise the set budget.
- `src/runtime/exec/execArgs.ts`: `--max-requests` unset leaves
  `maxRequests: undefined` (invalid strings and out-of-range still refused).
- `src/runtime/exec/runLedger.ts`: `maxRequests: number | undefined`;
  the request refusal only applies when set.
- `src/runtime/exec/runExec.ts`: the run ledger is created whenever a
  Model API budget is set (budget enforcement no longer needs a cap).
- `src/runtime/exec/execProtocol.ts`: a completed run may carry a null
  request limit (budget/cost/request accounting still required).
- `scripts/lib/reference.mjs`: no `default` on `max-requests`; its
  self-check asserts unset leaves no limit and 500 still parses.
- Out of scope, left untouched: `action/lib/tools.mjs`
  `DEFAULT_MAX_REQUESTS = 30` is the CI Action's own explicit input
  default (frozen under M80's live receipts), not the CLI default.

## Fixes during the run

- `muse.edit` forward reference: `SETTING_DEFAULTS.tabDailyBudgetUsd`
  first referenced the later `TAB_NO_BUDGET_USD` (TDZ at module load);
  used the allowed literal `0`.
- New `runLedger` test first settled with mismatched usage
  (`request_shape`): now uses the suite's own valid outcome shape.
- New render test first passed `features={[]}`, which renders no Tab row:
  now `features={['tab']}`.
- `PaidUsageSection` nested ternary failed `unicorn/no-nested-ternary`:
  rewritten as if/else.
- First commit missed `src/runtime/exec/runExec.ts` in `git add`;
  committed in the second chunk (nothing lost).
- `npm run ui:look -- usage` BLOCKED on this rig: headless Chrome aborts
  with `Socket path too long` under the lane's long app-data path (exact
  error in the run log). No workaround attempted. The Tab row's three
  states are instead proven by `test/unit/paidUsageTabRow.test.tsx`,
  which renders the real component.
- `test/unit/inspectNative.test.ts` (18 failures) measured UNRELATED on
  the untouched base: same 18 failures at `81dacaf5a7` in an isolated
  worktree (native helper refuses system files in this sandbox:
  `cat: {"refused":"systemFile"}`). Worktree removed afterwards.

## Final gates (all on the final tree, exit codes)

- typecheck all 5 projects: 0 (webview + unit re-run after last edit: 0)
- eslint changed files: 0 warnings, 0 errors (one nested-ternary fixed)
- prettier changed files: clean
- `npm run build`: 0, no budget errors
- `check:l10n`: 0 problems (14 UI + 14 usage tables, 252 manifest strings)
- `check:reference`: 0 (matches catalog)
- `check:host-api`: 0 problems
- `check:plan`: 0 drift
- `deadcode` (knip): 0
- `cycles`: 0; `duplication`: 0 clones
- `schema:exec -- --check`: schemas match
- SAST (semgrep): 0 findings; `security:audit`: exit 0
- `vitest related` on all changed src files: 288 files passed,
  5439 tests passed; only `inspectNative.test.ts` fails (pre-existing,
  measured on base as above)
- Focused suites: tabConstants (10), tabLedger (2), tabBudgetSetting (2),
  paidUsageTabRow (3), execArgs, runLedger (36), tabSpend — all pass.
  No `--testTimeout` raised anywhere (repo default).

## PR239W1 fix record (review threads: none; CI failure: activation budget)

- Review threads: 0 unresolved on PR #239 at lane start — nothing to fix.
- `modelsActivationBudget` (shard 3): growth 3104 B > 3072 B budget.
  Cause measured in-worktree: `src/host/tab/tabBundle.ts` (this lane's
  no-budget tooltip + `isBudgetReached` guard) added 203 B; the lane's
  other activation-reachable edits netted 0 B. Fix at cause, budget
  untouched: the two zero-budget checks now reuse the existing
  `isPositiveUsd` helper (the same "0 is uncapped" precedent as
  `hookModelEntry`/`reviewerEntry`) and read the budget once. Bundle
  564456 → 564394 B (growth 3042 B, 30 B under budget).
  Negative budgets stay rejected by settings validation, so `> 0` and
  `!== 0` agree on every valid input; no suite feeds a negative budget.
- Other CI failures (quality ×3, .vsix, dictation helper, capacity-repo
  tests): downstream-of-another-failure requires, no independent cause;
  they clear with the budget fix.

## Real-use drills (packed `dist/` from this tree, no model calls)

- `node dist/acp.js exec --help`: `--max-requests` reads "Set the
  maximum number of model requests; without it, there is no request
  limit." with `minimum: 1, maximum: 500` and no default.
- `node scripts/gen-reference.mjs` drove the real `parseCommandLine`:
  unset `--max-requests` parses to `maxRequests: undefined`, `500`
  parses to `500`.
- Tab UI (settings editor, status bar, consent popup, usage page) cannot
  run headless here; covered by the render test, the ledger test, and
  the settings test above. The person-facing steps: leave
  `museSpark.tabDailyBudgetUsd` at `0` (no budget, nothing reserved);
  set e.g. `5` to cap the local day; run `exec` without
  `--max-requests` for an uncapped run.
