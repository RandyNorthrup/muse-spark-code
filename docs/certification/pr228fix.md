# PR228FIX — Codex threads on PR #228 (branch fix/exec-budget-ceiling-fix)

Triage committed 2026-10-18 on rig macmini, one line per thread (measured below).

1. `src/runtime/exec/runLedger.ts:100` (P2, quote vs run cap): CONFIRMED —
   `previewResponseReservation` admits against the user's cap, so a valid
   low budget throws `execModelUnpriced` before `runExec` can report
   `budget_exceeded` with the required minimum. Fix: quote the reservation
   without admitting it against any cap.
2. `src/runtime/exec/execArgs.ts:131` (P2, BigInt budgets): CONFIRMED —
   `parseExec` accepts e.g. `9007199254.740992`, but `units()` in
   `runLedger.ts:124` and `microUsd()` in `execProtocol.ts:338` refuse
   anything above `Number.MAX_SAFE_INTEGER` micro-USD. Fix: carry the exact
   BigInt through ledger/protocol validation; both downstream paths
   (`totals()`, `isSumEqual`, `runExec` minimum comparison) are bigint-exact.
3. `test/unit/execArgs.test.ts:112` (P1, fabricated cases): CONFIRMED —
   `20.01`/`250.5` have no capture provenance. Fix: recorded a real CLI
   exchange on this rig and cited it at the cases (test now spells the
   second value exactly as run, `250.50`); existing `0.108134`/`1.409024`
   cases stay — they are the documented tariff reservations (`docs/ci.md`
   liability table).
4. `CHANGELOG.md:15` (P2, stale CI contract): CONFIRMED — `docs/ci.md:50`
   (`0 < value ≤ 20`), `:62–65` (`1–20,000,000 micro-USD`) and `:318`
   (Action inherits the range) still state the removed ceiling. Fix: update
   the three entries to positive-only with no upper bound. Out of scope:
   `docs/reference.md:3127` (`webSearchMaxPerRequest` 1–20, unrelated) and
   frozen v1 schemas (`exec-event-v1`/`exec-result-v1`, deliberately frozen
   per `docs/certification/execcap.md`).

## Recorded CLI exchange (thread 3 provenance)

Captured 2026-10-18 on rig macmini from the production build of this branch
(`npm run build`, then `node dist/acp.js`). No key is stored on this rig, so
every run stops past arg validation with no paid call (requests 0,
settled $0.000000):

- `node dist/acp.js exec --backend modelApi --max-budget-usd 250.50 'hi'`
  → exit 3 (`Backend Unavailable`), stderr names requests 0 and
  settled $0.000000. The above-$20 budget passed real arg validation.
- `node dist/acp.js exec --backend modelApi --max-budget-usd 20.01 'hi'`
  → exit 3. Same acceptance just past the old ceiling.
- `node dist/acp.js exec --backend modelApi --max-budget-usd 9007199254.740992 'hi'`
  → exit 3. The exact BigInt budget from the thread-2 report travels the
  whole real CLI path, including run-ledger admission.
- `node dist/acp.js exec --backend modelApi --max-budget-usd 0 'hi'`
  → exit 2 (usage error). Negative control: invalid budgets still fail
  arg validation.

## Lane PR228W1 triage (2026-10-18, rig macbook, at 1b06d92)

1. runLedger quote vs run cap: fixed in 1b06d92 — `previewResponseReservation`
   quotes via `quoteReservation` without admitting, and `runExec.ts:985`
   compares that quote against the budget, reporting the budget minimum with
   a budget latch. Covered by the `$0.01` `previewResponseReservation` case.
2. BigInt budgets through the ledger: fixed in 1b06d92 on the runtime side —
   `budgetUnits` parses the exact BigInt, ledger `units()` and protocol
   `microUsd()` carry it with no upper bound. The Action side stayed open
   (thread 5 below).
3. execArgs `20.01`/`250.50` cases: answered by 1b06d92 — both values are the
   recorded real CLI exchange above (date, rig, commands, exit codes), so
   they are not invented. Re-run on this rig below for corroboration.
4. Stale CI contract: fixed in 1b06d92 — the CLI table, the grammar and the
   Action entries in `docs/ci.md` are positive-only with no upper bound.
5. Action `result.mjs` ceiling: CONFIRMED OPEN — `microUsd` still returns
   `undefined` above `Number.MAX_SAFE_INTEGER`, so `isExecEvent`/`isExecResult`
   reject accounting records for exact BigInt budgets the CLI now carries.
   Fix: return the exact units with no upper bound, as the runtime protocol
   already does.
6. runLedger `1000` (and `20.000001`) caps: CONFIRMED — neither is in the
   recorded exchange. Fix: replace with recorded above-ceiling inputs
   (`20.01`, `250.50`), keeping above-ceiling coverage.

## Corroboration on rig macbook (lane PR228W1, production build of e090e9aec)

`node dist/acp.js exec --backend modelApi --max-budget-usd <b> 'hi'`, no key
stored, so every run stops past arg validation with no paid call:

- `250.50`, `20.01`, `9007199254.740992` → exit 3 (`Backend Unavailable`,
  requests 0, settled $0.000000): above-$20 and exact-BigInt budgets pass
  real arg validation, matching the macmini record.
- `0` → exit 2 (usage error): invalid budgets still fail arg validation.

Amount-form note (thread 5 probe): every `UsdAmount` the runtime emits is
canonical (`Usd.toString` strips trailing zeros, so `250.50` travels as
`250.5`), and the Action's decimal grammar accepts exactly that canonical
form — `microUsd('9007199254.740992')` is `9007199254740992n`, invalid
spellings (`abc`, 7dp, signs, whitespace) stay `undefined`. The low-budget
minimum comparison itself is covered by the `$0.01`
`previewResponseReservation` unit case; no key on this rig means the live
`budget_exceeded` path cannot run here.

## Base-code failures (new assertions run against the untouched base)

Via a throwaway clone of this branch's base with only the updated
`test/unit/runLedger.test.ts` overlaid: `F1/L9` fails with
`execModelUnpriced` ("This model has no known tariff.") on a valid $0.01
budget, and `L5` fails with `execNumberInvalid` on cap `9007199254.740992`.
Both pass with the fix; the clone was removed.
