# Spend simple: no spending check without a limit the person set (D121)

Lane spend-simple, branch `fix/spend-simple` (continues `rv/ledger` at
`3e5b3aad2d`, origin/main merged at `f6acebd838`), 2026-10-17.

The owner, verbatim: "why are there spending checks each call this seems
like not the right way to do it make sure you research properly. whatever
get the app to pruduction faster with no bugs. i dont care about the
credits if the app is proven working." Standing rule of the same day: the
only hard-coded limits are each provider's own; every other limit is the
person's, none by default.

## The two live defects

Jobs run through `C:\Users\Randy\Coding\mx-lanebuild\dist\acp.js` (built
from `d383d9b7e9`, not an ancestor of this branch) stopped with:

> Stopped: the next request (about $3.03) would pass the session budget of
> $120.00 ($117.09 used). It was not sent.

and logged "Session budget: a response ended without its usage; its
remaining reservation of 27.13 USD counts as spent".

### Where the $120.00 came from

- **The value:** `C:\Users\Randy\AppData\Local\Muse Spark Code\settings.json`
  holds `{"paidDailyBudgetUsd":120}` (created 2026-10-14 17:19:04, last
  written 22:39:11 local; read only, never edited). That is the ACP agent's
  **daily** limit (`RUNTIME_SETTINGS_FILE`), not a session budget.
- **Who set it:** not the owner. The lead orchestrator session
  `61ab1443-23c9-4e1a-996e-4150ffd5e0f5` wrote it with its own tool calls:
  `{"paidDailyBudgetUsd": 30}` at 17:19 (transcript line 100436, "Set our
  app's daily paid budget to $30 on this PC"), 60 at 19:25 (line 101209),
  and 120 at 22:39 (line 106392, "Raise this PC's daily paid budget from $60
  to $120"). No owner message in those windows names a budget amount.
  Before the file existed, the code's default was $5
  (`f6acebd838:src/shared/constants.ts:701`).
- **Where the code read it:** `src/runtime/runtimeAccountingEntry.ts:111-112`
  at `f6acebd838` (line 64 at `d383d9b7e9`), checked on every request:
  `daily.precheck` at `:312` and `:317`, and `daily.reserve` at `:510`.
- **Why the stop said "session":** at `d383d9b7e9` the daily journal was
  built at `src/runtime/runtimeAccountingEntry.ts:49` without `dailyStop`,
  so its stop used the session-budget sentence.
- **Why $117.09 was "used":** the day's ledger under `paid-daily` summed
  $77.7726 settled plus $39.3120 never spent: 13 reservations of $3.024 held
  by a process that had died (owner `38e373b4`, 18:43–18:47 UTC), each
  counted as spent until a release that never came.

### Where "counts as spent" came from

`d383d9b7e9:src/core/backends/modelapi/ModelApiHost.ts:4155-4176`: when a
response ended without its usage, the whole remaining reservation was added
to the session's spent total. In
`acp\fd8c8a4129791d65\modelapi-sessions\budget-journal\…\0666fa39-c804-47df-a2b7-3bc01e46f23b`
thirteen such responses counted about $27.13 each, $352.66 in all, none of
it reported by a provider. On main before this lane (`f6acebd838:4226`) the
same amount was kept as "unresolved" liability, still blocking requests.

### What this lane changes about them

- No limit is ever assumed: `museSpark.paidDailyBudgetUsd` and the agent's
  `paidDailyBudgetUsd` default to none (`src/shared/constants.ts:703`,
  `package.json` default 0, no maximum). With none set,
  `createRuntimeDailyBudget().admit` returns at
  `src/runtime/runtimeAccountingEntry.ts:145` before any read or write.
- A reservation is never spend; a response without usage is cost unknown and
  adds nothing (`src/core/backends/modelapi/ModelApiHost.ts:4066-4101`).
- The agent's daily stop says "daily budget" and names
  `paidDailyBudgetUsd` (`src/runtime/runtimeAccountingEntry.ts:155-160`).
- The old ledger files are not read, so a day's total restarts from what
  calls report under the new files.
- **Not changed:** the `120` in that settings file. The code cannot tell an
  agent's write from a person's, so it treats the file as a limit the
  person set. Removing the key is the owner's decision (lead, 2026-10-17:
  leave it untouched). `mx-lanebuild\dist` keeps the old behaviour until it
  is rebuilt from this branch.

## The design (PLAN.md D121)

- **No limit, no check.** `ModelApiSession.assertEstimateFits`
  (`ModelApiHost.ts:3986`) returns at once without a cap; the daily paths
  return `undefined` (`src/host/paid/paidDailyBudget.ts:194`, `:319`;
  `src/runtime/runtimeAccountingEntry.ts:145`). Nothing is reserved, locked,
  read or written for spending before a send.
- **Session running total** in the owning session
  (`ModelApiHost.ts:4015-4032`), added after each call from reported usage,
  saved as `StoredSession.budgetSpentUsd`, restored on resume.
- **Daily running total** without a lock
  (`src/host/paid/dailySpend.ts:34`): each process adds to its own
  `paid-daily/<day>/spent/<uuid>.json`; a read sums the files; a zero-cost
  call writes nothing.
- **Stop before, in plain words:** `sessionBudgetStopped` and
  `execPaidDailyStopped` name the estimate, the limit and what was used.
  One warning (`sessionBudgetNearLimit`, `ModelApiHost.ts:4038`) when what
  is left no longer fits a request like the last one.

## Every removal, with proof it is unused

`git grep -w <name> -- src test scripts action` returns 0 for every name
below (the recorded activation baseline
`test/fixtures/models-activation-baseline/sources.json` keeps old source
text and is excluded):

| Removed                                                                                                                                                                                                                                                           | What it was                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/core/paid/spendLedger.ts` (`createSpendLedger`, `SpendLedgerDeps`, `LedgerClaim`, `LedgerEntry`, `LedgerScope`, `LedgerTotal`, `SPEND_LEDGER_VERSION`, `SPEND_LEDGER_LOCK_TIMEOUT_MS`)                                                                       | The atomic claim journal and its cross-process lock       |
| `SPEND_LEDGER_ADMISSION_BOUND_MS` and `test/unit/spendLedger.process.mjs`                                                                                                                                                                                         | The 100 ms admission bound and its benchmark              |
| `src/host/backend/sessionBudgetJournal.ts` (`createSessionBudgetJournal`, `SessionBudgetJournal`, `SessionBudgetJournalDeps`, `SessionBudgetTotal`, `PaidBudgetStopError`, `PaidStopDetails`)                                                                     | The session/daily journal adapter over the ledger         |
| `SessionBudgetClaim`, `BudgetReservation`, `AccountBudgetAdmission`, `SpendState`, `helperRequestSettlement` (`sessionBudget.ts`)                                                                                                                                 | Per-request claims and reservation state                  |
| `AutoCompactionLedgerClaim`, `MediaCostLedger`, `PaidRequestClaim`, `DAILY_BUDGET_LOCK_WAIT_MS`                                                                                                                                                                   | Ledger claim types and the daily lock wait                |
| ModelApiHost: `budgetJournal`, `budgetWrites`, `openReservation`, `persistReservation`, `persistBudgetReservation`, `isPaidBudgetAllowed`, `recordBudgetCost`, `refreshBudgetSpend`, `settleReservation`, `retainedLiabilityUsd`, `uncertainUsd`, `budgetOverage` | The per-call journal write, refresh and reservation paths |
| runtime: `daily.precheck`, `dailyCapUsd`, `dailyStop`, `initialBudget`                                                                                                                                                                                            | The per-request daily precheck and the journal options    |
| UI text: `spendLedgerBudget`, `spendLedgerBusy`, `spendLedgerRecovery`, `sessionBudgetLegacyFeesUnknown`, `sessionBudgetConversationFeesUnknown`, `execPaidOpenRequests` (en and the 14 tables)                                                                   | Sentences only the removed paths said                     |
| `museSpark.paidDailyBudgetUsd` minimum 0.5 and maximum 500; `PAID_DAILY_BUDGET.minimumUsd`, `.maximumUsd`; default 5                                                                                                                                              | Limits of ours (D121 and the standing rule)               |
| PLAN.md §8 row for `spendLedger.ts` `serialise`                                                                                                                                                                                                                   | Its escape hatch went with the file                       |

Kept, changed: `LedgerFailureKind` and `SpendLedgerError` (the daily files'
damaged/unreadable/integrity errors), `reserveMediaRequest` and
`reserveRequest` (media estimate, no claim).

## Tests

Deleted, because each drove only removed code:
`test/unit/spendLedger.test.ts`, `spendLedger.process.mjs` (ledger and
benchmark), `sessionBudgetJournal.test.ts`, `judgeAdmissionLedger.test.ts`
(judge admission through the journal), `execPaidRefusal.test.ts` and
`runtimeAccountingInterruptions.test.ts` (daily claims through the journal).
`test/unit/execCliFindings.test.ts` came from `rv/ledger` and imports
`test/unit/helpers/fakes`, which main deleted in `33150b3cf4` ("delete
every fake test"); it goes with them.

New, real code only (real files, real processes, the real clock):

- `test/unit/dailySpend.test.ts`: three real processes add 20 priced and 2
  unknown-cost calls each; the day's total is the sum, one file per
  process, no lock or journal; a zero-cost call writes nothing.
- `test/unit/runtimeDailyBudget.test.ts`: with no limit nothing is read or
  written; a limit of 0 is none; a request whose estimate would pass the
  limit is refused with the daily sentence; cost unknown counts nothing; a
  settled call counts once.
- `test/unit/sessionBudgetFit.test.ts`: the output allowance is lowered to
  fit what is left; a request whose smallest estimate passes the limit is
  refused with the session sentence.

Changed: `test/unit/paidMoneyStructure.test.ts` drops the removed minimum
and maximum from its allow-list.
