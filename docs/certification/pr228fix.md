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

## Base-code failures (new assertions run against the untouched base)

Via a throwaway clone of this branch's base with only the updated
`test/unit/runLedger.test.ts` overlaid: `F1/L9` fails with
`execModelUnpriced` ("This model has no known tariff.") on a valid $0.01
budget, and `L5` fails with `execNumberInvalid` on cap `9007199254.740992`.
Both pass with the fix; the clone was removed.
