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
   `20.01`/`250.5` have no capture provenance. Fix: record a real CLI
   exchange on this rig (capture date + command below) and cite it at the
   cases; existing `0.108134`/`1.409024` cases stay — they are the documented
   tariff reservations (`docs/ci.md` liability table).
4. `CHANGELOG.md:15` (P2, stale CI contract): CONFIRMED — `docs/ci.md:50`
   (`0 < value ≤ 20`), `:62–65` (`1–20,000,000 micro-USD`) and `:318`
   (Action inherits the range) still state the removed ceiling. Fix: update
   the three entries to positive-only with no upper bound. Out of scope:
   `docs/reference.md:3127` (`webSearchMaxPerRequest` 1–20, unrelated) and
   frozen v1 schemas (`exec-event-v1`/`exec-result-v1`, deliberately frozen
   per `docs/certification/execcap.md`).
