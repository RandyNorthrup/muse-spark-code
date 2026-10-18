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
