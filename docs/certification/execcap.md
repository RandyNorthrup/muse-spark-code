# EXECCAP — every read of `EXEC_MAX_BUDGET_USD` (= 20)

Branch `fix/exec-budget-ceiling`, base `main-now` (`81dacaf5a`).
Measured 2026-10-18 on this worktree with
`grep -rn "EXEC_MAX_BUDGET_USD" src/ test/ scripts/ docs/ action/`.

## Definition

- `src/shared/constants.ts:4126`: `export const EXEC_MAX_BUDGET_USD = 20`

## Enforcement reads (all refuse a person's amount above 20 USD)

1. `src/runtime/exec/execArgs.ts:13,132` — `budgetUnits()` accepts only
   `units > 0 && units <= 20 * EXEC_USD_UNITS`; anything above fails
   `parseExec` with `execNumberInvalid`. This is the `serve`/`exec`
   `--max-budget-usd` gate.
2. `src/runtime/exec/runLedger.ts:5,101,152` — `createRunLedger` throws on
   `cap > 20 USD`; `previewResponseReservation` builds its throwaway ledger
   with `capUsd: 20 USD`.
3. `src/runtime/exec/execProtocol.ts:15,228-234` — `capAmount` schema
   (`budgetUsd`, `capUsd` fields) refines `0 < value <= 20`.

## Catalog / reference reads

4. `src/shared/reference/referenceSource.ts:42` — re-exported into the
   `source` namespace the reference generator reads.
5. `scripts/lib/reference.mjs:864` — `'max-budget-usd': { exclusiveMinimum: 0,
maximum: source.EXEC_MAX_BUDGET_USD, … }`. This `maximum: 20` is what
   `serve --help` / the reference render as the "(at most 20 USD)" ceiling.
6. Generated from the above (regenerate, do not hand-edit):
   - `src/shared/reference/reference.generated.json` (serve + exec
     `max-budget-usd` entries carry `"maximum":20`)
   - `docs/reference.md` (same `"maximum":20` snippets)
   - `docs/schemas/exec-event-v1.schema.json`,
     `docs/schemas/exec-result-v1.schema.json`,
     `docs/schemas/exec-event-output-schema-v1.schema.json`
     (`"maximum": 20` on budget/cap fields; via `npm run schema:exec`)

## Test reads (encode the ceiling; must change with it)

- `test/unit/execArgs.test.ts:84` — `'20.01'` in the reject list;
  `:112` — `'20.000000'` in the accept list.
- `test/unit/runLedger.test.ts:269` — `20.000001` cap in the throw list (L5).

## Historical record (left as history, not edited)

- `docs/certification/m80.md` rows A-12/A-13/B03-cap-maximum name the cap as
  the then-tested behaviour.

## Help / error text

- `src/shared/l10n/en.ts`: `max-budget-usd` CLI text
  (`Set the hard spending limit in USD for this run.`) and `execNumberInvalid`
  name no dollar ceiling, so no English or translated string changes are
  expected; `npm run check:l10n` still gates the change.
- `src/shared/featureCatalog.ts`: no `max-budget` entry (verified by grep).

## Provider-limit check

The 20 USD value is ours, not a provider's: Meta's published Model API pricing
(`dev.meta.ai/docs/pricing-rate-limits`) is per-token with no per-run dollar
cap, and no provider capability record in this repo names a run budget. Per
the owner's Limits rule the ceiling is removed, not kept.
