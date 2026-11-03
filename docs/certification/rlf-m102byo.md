# RLF-M102BYO — headless BYO accounting (2026-11-02, linuxlt)

Base `72d8d5003` (rv/int9). No live or paid model call, no credential
read, no dependency change. The follow-up Q-M102INT3 asks for:
production headless BYO accounting and ACP/headless shared paid-daily
admission, exact money end to end, no cap of ours added, uncertainty
liability never spend (D208).

## Reproduction (the stopped attempt's failure, on this base)

`docs/certification/m102.md` round 3 stopped the headless accounting
path: a successful BYO run still returned `incomplete/no_completion`
with one recorded request and retained full liability. The new
real-stack suite `test/unit/headlessByoAccounting.test.ts` reproduces
that signature on the unmodified base: the captured OpenAI stream
(m95-captures `openai/03-tool-result-stream`, 2026-10-04) completes
through the real providers file, vendored catalogue, configured
client, Responses codec, runtime accounting wrapper, run ledger and
daily budget — only the socket outcome is injected, replaying the
recorded exchange — yet the ledger reads settled $0, tokens 0,
`lastResponse: null` and the full reservation ($0.009971) still held.
At exec level that is the accounting-unverified / no-completion end
the stopped attempt reported.

## Cause and fix

`withRuntimeAccounting` (`src/runtime/runtimeAccountingEntry.ts`,
`attempt.prepare`) admitted each request against the run ledger and
discarded the returned ticket on success, so settlement never ran.
The Meta headless path was unaffected (it keeps its ticket in
`execFetch.ts`); every BYO, plan-model and team exec run through the
wrapper leaked its reservation and settled nothing. Fix `262a60e96`
keeps the ticket (`ticket = admission`), one line.

With the fix, the captured run settles exactly: usage input 1497,
cached 1444, cache writes 50, output 12 at the vendored catalogue
card (input $0.20, cached $0.02, write $0.25, output $1.20 per
million) is 56.38 micro-dollars, ceilinged by the ledger to
$0.000057 — the same figure in the run ledger and in the shared
daily total (`readToday`). Money is exact decimal (`Usd`) end to
end; no float enters admission or settlement.

## What the suite proves (5 cases, repository timeouts)

1. A priced BYO run settles $0.000057 in both the run ledger and
   the shared daily total, one `/v1/responses` dispatch, no refusal.
2. With no daily limit set, the run settles and no daily record is
   written or read into existence (D208: no limit, no check).
3. A sent stream cut before its terminal usage frame keeps the
   full reservation as uncertain liability in the run ledger,
   settles $0, and counts one unknown-charge call — never spend —
   in the daily total.
4. A provider refusal before generation (captured 404,
   `openai/06-error-invalid-model`) withdraws the ticket with its
   request count and books nothing anywhere.
5. Shared admission: a second process over the same agent data
   folder, with the person's daily limit set to exactly what the
   first run spent, is stopped before dispatch with the budget
   refusal; zero `/v1/responses` sends, zero ledger requests, the
   first run's $0.000057 still the day's total. ACP sessions and
   headless exec construct the same `createRuntimeDailyBudget`
   over the same agent data folder (`src/runtime/backends.ts`), so
   the pool the test exercises is the pool both surfaces share.

## Red/green drills

Each drill breaks one guard on purpose, runs the whole new suite,
then restores byte-exact (`git checkout -- <file>`, SHA-256 checked).

| Drill | Break                                                        | Red                       | Restored                                                                                                                 |
| ----- | ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D1    | remove `ticket = admission`                                  | exit 1, 5/5 fail          | exit 0, 5/5 pass; `runtimeAccountingEntry.ts` SHA-256 `45a7a8702b67aa5c1767bbece29291f57df80cdb87df5105b9392b746fc886c5` |
| D2    | make the daily `limitCheck` always return                    | exit 1, only case 5 fails | same SHA-256 as D1                                                                                                       |
| D3    | `dailySpend.add` drops an undefined cost without counting it | exit 1, only case 3 fails | `dailySpend.ts` SHA-256 `43a3fe7d52b09beb6a7b137733cae66b548742b1918258301e9dc9fea052822c`                               |

## Removed leftover

`execProviderNotReady` — the stopped path's refusal sentence,
unread since provider runs began dispatching through the accounting
wrapper — is deleted from English, all 14 UI tables and the
generated desktop tables (`d78bc6176`); `check-l10n` passes.

## Suites run (all `--maxWorkers=3`, repository timeouts)

- `headlessByoAccounting`: 5/5.
- `runtimeDailyBudget`, `dailySpend`, `runtimeAccountingEntry`: 25/25.
- `execFetch`, `execTeamLedger`, `execExactCount`: 13/13.
- `execCountBound`, `providerExec`, `execLimits`: 20/20.

Gate exit codes are recorded in the lane's final message. Packed
`exec --provider` against a live provider remains unrun by design
(no paid call in this brief); the proof is the real stack over
recorded exchanges above.
