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
