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
  `src/runtime/runtimeAccountingEntry.ts:147` after reading only the
  settings file: no spend record is read and nothing is written.
- A reservation is never spend; a response without usage is cost unknown and
  adds nothing (`src/core/backends/modelapi/ModelApiHost.ts:4024-4032`).
- The agent's daily stop says "daily budget" and names
  `paidDailyBudgetUsd` (`src/runtime/runtimeAccountingEntry.ts:157-162`).
- The old ledger files are not read, so a day's total restarts from what
  calls report under the new files.
- **The `120` in that settings file:** the lead removed the key earlier on
  2026-10-17 (review RVRVSPENDSIMPLE). Nothing on this branch depends on
  it: a missing file or a missing key reads as the default, none
  (`src/runtime/runtimeAccountingEntry.ts:110-131`), proven by
  `runtimeDailyBudget.test.ts`. While the key was there, the code could
  not tell an agent's write from a person's, so it treated the file as a
  limit the person set. `mx-lanebuild\dist` keeps the old behaviour until
  it is rebuilt from this branch.

## The design (PLAN.md D121)

- **No limit, no check.** `ModelApiSession.assertEstimateFits`
  (`ModelApiHost.ts:3986`) returns at once without a cap; the daily paths
  return `undefined` (`src/host/paid/paidDailyBudget.ts:194`, `:319`;
  `src/runtime/runtimeAccountingEntry.ts:147`). Nothing is reserved, locked
  or written, and no spend record is read, before a send. What is still
  read is where a person's limit lives: the agent's `settings.json`, and in
  the editor its setting plus the day's raise or stop files
  (`paidDailyBudget.ts:67-94`).
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
- `test/unit/runtimeDailyBudget.test.ts`: with no limit nothing is written,
  and a damaged spend record is never read (with a limit the same record
  refuses); a limit of 0 is none; a request whose estimate would pass the
  limit is refused with the daily sentence; cost unknown counts nothing; a
  settled call counts once.
- `test/unit/sessionBudgetFit.test.ts`: the output allowance is lowered to
  fit what is left; a request whose smallest estimate passes the limit is
  refused with the session sentence.

Changed: `test/unit/paidMoneyStructure.test.ts` drops the removed minimum
and maximum from its allow-list. The daily files' call counter is named
`unknownChargeCalls`, so the guard reads it as a count.

## Red drills (each break made, the failure seen, the code restored)

Restored state checked with `git diff -- src` (comment edits only) and a
green rerun: 4 files, 58 tests, exit 0.

| Break                                                                                          | Suite                        | Result while broken                                                                                    |
| ---------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `dailySpend.ts` `read`: other processes' files add 0                                           | `dailySpend.test.ts`         | exit 1: "sums every process file" `expected '0' to be '0.6'`                                           |
| `dailySpend.ts` `add`: zero-cost early return removed                                          | `dailySpend.test.ts`         | exit 1: "writes nothing for a call that cost nothing" `expected true to be false`                      |
| `runtimeAccountingEntry.ts` `admit`: no-limit return removed                                   | `runtimeDailyBudget.test.ts` | exit 1: both no-limit tests and "a limit of zero" get a claim instead of `undefined`                   |
| `runtimeAccountingEntry.ts` `settle`: unknown cost counted as the estimate                     | `runtimeDailyBudget.test.ts` | exit 1: "counts a call that reported no usage" `{ spentUsd: '0.9' }`                                   |
| `runtimeAccountingEntry.ts` `check`: the estimate left out of the comparison                   | `runtimeDailyBudget.test.ts` | exit 1: "stops a request whose estimate would pass" `expected undefined to be an instance of Error`    |
| `runtimeAccountingEntry.ts` `settle`: the settled-once guard removed                           | `runtimeDailyBudget.test.ts` | exit 1: "counts a settled call once" `{ spentUsd: '0.6' }`                                             |
| `sessionBudget.ts` `fitRequest`: what was spent left out of what is left                       | `sessionBudgetFit.test.ts`   | exit 1: "lowers the output allowance" and "refuses a request whose smallest estimate passes the limit" |
| `paidMoneyStructure.test.ts` before its change (stale minimum/maximum, counter named `…Cost…`) | `paidMoneyStructure.test.ts` | exit 1 in the touched-suite run: two stale entries and one unexpected money name                       |

## A refused request books nothing (found by PROVERRORS)

The PROVERRORS lane's real run: a headless run refused with a real
Anthropic 401 ended "uncertain $3.39", and the next run in the same data
folder reported "$3.40 used" with nothing billed.

- **The next run's "$3.40 used"** was the old daily ledger counting the
  refused request's reservation. Under D121 the daily total holds only
  reported costs, so it cannot recur.
- **Inside the run**, `withRuntimeAccounting` settled a refused attempt
  through the run ledger. When the error reached it untyped (an adapter
  rethrowing without the status) the attempt was "sent with no usage" and
  its whole reservation stayed uncertain. When it reached it typed (this
  branch: `src/core/providers/configured.ts:922` passes a `ModelApiError`
  through `isUserRefusal`), the run ledger released the money but recorded
  `lastResponse` as `settlement: 'priced'` with no terminal, which the
  published v2 schema (`src/runtime/exec/execProtocol.ts:321-330`) and
  `action/lib/result.mjs:206-220` reject. The first real run on this branch
  (refusal hook in, withdrawal not yet) ended in exactly that `ZodError`.
- **The fix** (`12049a0da4`): the transport tells the attempt guard of a
  refusal before throwing (`onRefused`,
  `src/core/backends/modelapi/transport.ts:484`, `:1124`); the configured
  adapter's guard already forwards it. `withRuntimeAccounting` withdraws a
  refused attempt with its request count, as it does one that never reached
  the wire (`src/runtime/runtimeAccountingEntry.ts:392-407`, `:473`), so the
  run ledger counts nothing, `lastResponse` stays valid and the daily total
  gets nothing. In the editor the open request is marked refused
  (`ModelApiHost.ts:4985`), so no "cost unknown" notice follows a refusal,
  and a retry after a 429 is not counted as cost unknown (`:4947`).
- **No automated test:** a test would need a local server answering 401,
  which the testing rules forbid. The proof is the real runs below.

## Real-use proofs (built `dist/acp.js` from this worktree)

Isolation: `LOCALAPPDATA` and `XDG_CONFIG_HOME` pointed at folders under
`temp/spend-simple/`; `providers.json` there names the `anthropic` preset;
the key `sk-ant-api03-invalid-spend-simple-proof-000000` came from standard
input (`--key-stdin`, memory only). No credential store, machine setting or
`AppData\Local\Muse Spark Code` file was written. Expected before the runs:
up to 2 requests per refused run (Anthropic's free token count and the
message), $0 cap (an invalid key cannot be billed). Counted from the logs:
12 requests to `api.anthropic.com` over 7 runs, every one answered 401
`invalid x-api-key`; the two stop runs sent none.

| Run                                                                                                                                                                       | Result                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refused, daily limit $10, three runs in one data folder (the last on the final build; the first two on a build differing only in the order of two conditions in one `if`) | each `auth_required`, `requests 0`, settled `0`, uncertain `0`, `lastResponse null`; no `paid-daily` folder written, session files carry no spent field                                                                |
| Refused, no daily limit                                                                                                                                                   | `auth_required`, `requests 0`, cost `0`; the data folder holds only the session file: no `paid-daily`, no journal, no lock                                                                                             |
| Daily limit $0.01 (no request sent)                                                                                                                                       | `budget_exceeded`: "Stopped: the next request (about $0.18) would pass the daily budget of $0.01 ($0.00 used today). It was not sent. The budget resets Oct 18, 2026, 12:00 AM; raise paidDailyBudgetUsd to continue." |
| `--max-budget-usd 0.01`, no daily limit (no request sent)                                                                                                                 | `budget_exceeded`: "Input at most 8,283 tokens ($0.010354) + output cap at most 32,768 tokens ($0.163840) = $0.174194; run cap $0.010000, $0.000000 used. Request not sent. …"                                         |

Not exercised by a real run: the untyped-rethrow path itself (on this
branch the 401 arrives typed, so the status came from the error as well as
from `onRefused`), and the editor's chat path.

## Gates (2026-10-17, this worktree)

| Gate                                                                                                          | Exit                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the 83 changed files                                                                    | 0                                                                                                                                                                                                                                                                                                                                                 |
| `eslint --max-warnings=0` on the 44 changed TS/MJS files                                                      | 0                                                                                                                                                                                                                                                                                                                                                 |
| `npm run typecheck` (host, webview, unit, e2e, integration)                                                   | 0                                                                                                                                                                                                                                                                                                                                                 |
| `npm run check:l10n`, `check:plan`, `check:reference`                                                         | 0, 0, 0                                                                                                                                                                                                                                                                                                                                           |
| `npm run build` (tokens, production build, bundle size and split, lazy registry check, host globals, notices) | 0                                                                                                                                                                                                                                                                                                                                                 |
| Touched suites (38 files, `--maxWorkers=2`)                                                                   | 1: 634 passed, 2 failed, 1 suite failed, none from this lane. `vault/sshImport.test.ts` fails on this machine's `ssh-keygen`; `commandHelp.test.ts` (prompt-library `museSpark.*` lines in help) and `providersPresets.test.ts` (`exactCount`) come from `rv/ledger` commits `57ebcfd7e4` and `8b93e40080`; this lane changes none of their files |

Not run, by the lead's rule that hosted CI is the full gate: knip, cycles,
duplication, the whole unit battery. One whole-battery run made earlier
found 9 failures; the 4 from this lane (lazy registry, packaged bundles,
lazy bundle files, money guard) are fixed, the other 5 are the three above
plus `test/e2e/reports.e2e.test.ts` (Windows symlink permission).

## Left undone, named plainly

- The `120` key in `C:\Users\Randy\AppData\Local\Muse Spark Code\settings.json`
  was removed by the lead earlier on 2026-10-17; with no key the agent has
  no daily limit (see above).
- The exec run ledger otherwise keeps its published v2 rules: a response
  that went out and reported no usage stays "uncertain" at its reservation
  within that run (never carried to another run or to the daily total), and
  `exec` still requires `--max-budget-usd`.
- A refused request whose provider bills its token count keeps the old
  settlement, so its JSON result would fail the v2 schema; no preset is
  known to bill its count, and this was not checked provider by provider.
- The configured adapter's error text ("Internal error: invalid x-api-key")
  is PROVERRORS's to fix.
- Untouched: the Tab ledger, the team meter, account thresholds; schedule
  paid consent still requires a non-zero shared daily budget; sessions saved
  before D121 keep their old, inflated `budgetSpentUsd`; old ledger files
  under `paid-daily` and `budget-journal` stay on disk, unread.
- After the VS Code crash, `dist/runtimeAccounting.js` was found without
  the fix while the source had it; it was rebuilt and every proof above
  ran on the rebuilt bundle (checked with a search for `onRefused`).
- Temporary files: all in `temp/spend-simple/` (gitignored). An earlier
  background job and its files had been in the session scratchpad; the job
  was stopped, its files were already gone, and nothing was written there
  or in `muse-fleet\tmp` afterwards.
