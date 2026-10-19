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

## Codex threads on PR #217 (lane PR217FIX, 2026-10-17): disposition

One line per thread; fixes and red drills below, answers with the
measurement that decides them.

- `dailySpend.ts:6` concurrent admission — ANSWER: D121 supersedes the cross-process admission lock; the daily total is lock-free by design.
- `paidDailyBudget.ts:106` unknown charge blocks — ANSWER: D121 counts cost unknown as nothing; blocking or bounded liability is the removed behaviour.
- `runtimeAccountingEntry.ts:625` swallowed settle failure — FIX: preserve the rejection instead of the no-op retry.
- `fileSessionStore.ts:497` concurrent session-spend increments — FIX: merge deltas instead of keeping the larger snapshot.
- `execArgs.ts:248` output-token floor — FIX: parse at 1; the selected model's own policy minimum applies at admission and at the send.
- `configured.ts:554` injected-transport dispatch state — FIX: an injected-send failure keeps ambiguous liability instead of `not_sent`.
- `dailySpend.ts:43` legacy current-day journal — FIX: compatibility read of the legacy current-day total.
- `paidDailyBudget.ts:306` unknown charges in Account & usage — FIX: surface the unknown-charge count in `readToday`.

### Answers, measured

- **Concurrent admission (`dailySpend.ts:6`).** PLAN.md D121: "A daily
  budget's total is lock-free: each process adds to its own file in the
  day's folder, and a read sums the files", and D121 "supersedes the
  LEDGER design (§3, §6, §7): the atomic claim journal, its
  cross-process admission lock, the 100 ms admission bound and its
  benchmark." Cross-process admission coordination IS that removed lock.
  The accepted bound is stated in the same decision: "A reply may cost
  more than its estimate; the next request is then the one stopped."
  Changed nothing.
- **Unknown charge blocks (`paidDailyBudget.ts:106`).** PLAN.md D121:
  "A reservation is never spend. A response that ended without its
  usage counts as cost unknown, with what is known, and adds nothing
  to the total", and §3's resolved LEDGER question: "the owner chose
  not to count an unresolved reservation at all". Both asks — block
  admission on unknown, retain bounded liability — restore the
  unresolved-liability blocking the lane removed. Verified in code
  that admission consults only settled dollars: `isWithinLimit`
  (`paidDailyBudget.ts`), `check` (`runtimeAccountingEntry.ts`) and
  `judgeLedger.remainingUsd` all read `spentUsd` alone. Changed
  nothing.

### Fixes, with red drills

All drills: the break made, the failure seen, the code restored, green rerun.

| Thread                          | Fix                                                                                                                                                                                                                                             | Test                                                                                                                                                                                            | While broken                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runtimeAccountingEntry.ts:625` | The stream `finally` awaits `settle()` once; its rejection propagates instead of a second no-op `settle()` swallowing the write error                                                                                                           | `runtimeDailyBudget.test.ts`: a settlement the disk refuses rejects with `SpendLedgerError` (real files; a file stands where the day's folder belongs)                                          | No wrapper drill: driving the stream needs a provider stand-in, which the testing rules forbid. The daily-layer contract above plus the spend suites are the proof |
| `fileSessionStore.ts:497`       | Each store instance keeps its loaded/saved total as its base and adds only its snapshot's delta onto the file's total                                                                                                                           | `fileSessionSpend.test.ts`: two windows from 1 save 3 and 5, the file holds 7; an older snapshot never lowers the file                                                                          | `expected '5' to be '7'`, the thread's own example                                                                                                                 |
| `execArgs.ts:248`               | `--max-output-tokens` parses at 1; Meta's 16 still applies at its own send path (`execFetch.ts`), a configured provider's own minimum at its send (`configured.ts:1175`) with its sentence, and run-ledger admission floors qualified refs at 1 | `execArgs.test.ts`: 1 and 15 parse, 0 does not                                                                                                                                                  | `docs/acp.md` minimum updated alongside                                                                                                                            |
| `configured.ts:554`             | An injected-send failure skips the `not_sent` branch and keeps the uncertain mapping, so accounting holds liability instead of releasing the ticket at zero                                                                                     | `configuredInjectedSend.test.ts`: the real key probe over the real transport with a failing injected send returns the uncertain sentence, through no network and no lookup (IP-literal address) | Old mapping returns the probe's `providerProbeUnparseable` fallback instead                                                                                        |
| `dailySpend.ts:43`              | The day's read adds the pre-D121 `budget-journal/<account>/<day>` total (seed plus settled, open reservations as the old total counted them), read-only                                                                                         | `dailySpend.test.ts`: legacy 2.5 + 1.25 + 0.5 reads 4.25 and a new 0.75 settles to 5; another day's journal is ignored and a mismatched seed refuses as damaged                                 | `expected '4.25'` reads `'0'`; the mismatched seed reads clean instead of damaged                                                                                  |
| `paidDailyBudget.ts:306`        | `readToday` carries `unknownChargeCalls` (new optional `usageBudgetSchema` field) when above zero; the budget card and the text summary name the count beside the settled total, in all 15 usage tables                                         | `usageLiability.test.ts`: `Uncertain: 2 calls with unknown cost` beside `$0.25 of $1.00`; `usageL10nTables`/`usageL10nGate` green (the gate caught three tables missing the `other` form first) | Row removed: the count line is gone; tables without `other` fail the gate                                                                                          |

D121 holds throughout: with no limit set nothing new is read or
written before a send (every addition above runs only under a limit the
person set), no default limit exists, and no reservation, journal or
lock came back.

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

## PR217FIX2 — Codex re-review threads (2026-10-18, lane PR217FIX2)

One line per thread: the two-window spend base is each window's own unmerged
total stored after the write lands; the upgrade-day legacy read counts only
settled charges; a resolved provider policy replaces the cached pre-resolution
output cap; a model present only under `catalog.unpriced` keeps its no-price
warning. Red drills: each fix reverted alone, the new test fails as quoted,
the fix restored, green rerun.

| Thread                                  | Fix                                                                                                                                                                                                                                                                                                                                                                                                                      | Test                                                                                                                                                 | While broken                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `fileSessionStore.ts:526` (security P2) | The save stored the merged file total as the window's base, dropping that window's next increment. The base is now the window's own unmerged `incomingSpend`, stored only after `writeFileAtomically` lands (a failed save no longer advances the base either)                                                                                                                                                           | `fileSessionSpend.test.ts`: two windows load 1 and save 3/5 (file 7), then the second saves 6 — the file holds 8                                     | `expected '7' to be '8'`, the thread's own numbers                   |
| `dailySpend.ts:152` (P1)                | The upgrade-day fallback added an open claim's `reservedUsd` to `spentUsd`. D121: a reservation is never spend (the old ledger's own stop text subtracted held), so only `settledUsd` enters the migrated total — a dead process's unsettled claim no longer stops paid requests until midnight                                                                                                                          | `dailySpend.test.ts`: legacy seed 2.5 + settled 1.25 reads 3.75 (was 4.25), a new 0.75 settles to 4.5; the open 0.5 stays out                        | `expected { spentUsd: '4.25' } to deeply equal { spentUsd: '3.75' }` |
| `runExec.ts:1222` (P1)                  | The start line's no-arg `outputCap()` ran before model resolution and the `??=` cache pinned the global Model API cap; the model bind's resolved policy (`wrap` → `modelOutputMaxTokens`, plus every request body) could not replace it. New `createExecOutputCap` in `runLedger.ts` (used by `runExec`): a passed policy always recomputes and replaces the cache, so admission and bodies reserve the provider maximum | `runLedger.test.ts`: no-arg reads 32768, the resolved 16384-maximum policy reads 16384, later no-arg reads keep 16384; an explicit flag still floors | `expected 32768 to be 16384`                                         |
| `providerExec.ts:199` (P2)              | `isModelUnpriced` treated an `unpriced` catalogue entry as price evidence. It is capability evidence only — configured resolution still leaves the model unpriced and an exec run refuses it — so only a priced record or a user-entered price suppresses the warning in `providers add`, `test` and `list`                                                                                                              | `providerUnpriced.test.ts`: unpriced-only warns; priced, user-priced, custom and keyless stay silent                                                 | `expected false to be true`                                          |

Correction to the earlier row (`dailySpend.ts:43`): "open reservations as
the old total counted them" was wrong — the pre-D121 ledger subtracted held
from spend in its stop text, and D121 settled that a reservation is never
spend. The migrated total is seed plus settled only.

Gates on the final tree: typecheck (all projects) 0, eslint zero warnings on
all nine changed files, prettier clean, `check:plan` 0 drift, `check:l10n` 0
problems, `npm run build` green, suites `fileSessionSpend` (3),
`dailySpend` (5), `runLedger` (47) and `providerUnpriced` (3) all pass with
the repository's own timeout. Commits `11f98e72b` (threads 1–2) and
`5b72b8607` (threads 3–4); the second commit's hook run of `eslint --fix`
was re-read and changes nothing of logic.

## PR217FIX3 — triage, one line per thread (2026-10-18, lane PR217FIX3)

The brief lists 8 `###` lines; one is the security-review section header,
so there are 7 file threads. Threads 1–4 were fixed and red-drilled on this
branch under PR217FIX2 (commits `11f98e72b`, `5b72b8607`); threads 5–7 are
open and were re-verified against the current tree below.

- `fileSessionStore.ts` (security P2, two-window base): already fixed by
  `11f98e72b` — the base is each window's own unmerged `incomingSpend`,
  stored only after the write lands.
- `dailySpend.ts` (P1, open legacy reservations): already fixed by
  `11f98e72b` — only `settledUsd` enters the migrated total.
- `runExec.ts:1215` (P1, output cap caching): already fixed by `5b72b8607`
  — a resolved provider policy replaces the cached cap.
- `providerExec.ts` (P2, unpriced catalogue): already fixed by `5b72b8607`
  — an `unpriced`-only entry no longer suppresses the no-price warning.
- `providerExec.ts:205` (P2, plan presets): OPEN — `isModelUnpriced` returns
  true for `mistral-plan` with an unpriced-only model while
  `configured.ts:806` assigns `{ kind: 'plan' }`, so add/test/list warn for
  a model the run never refuses as unpriced.
- `ModelApiHost.ts:16603` (P1, legacy session totals): OPEN — pre-D121
  `snapshot()` added the open reservation into the saved `budgetSpentUsd`
  (`b6ba938849^:16708-16713`) and `adopt` takes the stored value whole, so
  the phantom survives the upgrade.
- `ModelApiHost.ts:16400` (P2, unknown charges row): OPEN — `usageBudget()`
  returns only settled `budgetSpentUsd` while `addSpend` records only the
  `hasUnknownBudgetCost` boolean; the schema (`usagePage.ts:91`) and both
  renderers already carry `unknownChargeCalls` for the daily row.

## PR217FIX3 — fixes (2026-10-18, lane PR217FIX3)

Threads 1–4 were fixed under PR217FIX2 (`11f98e72b`, `5b72b8607`). Threads
5–7 were open; each was re-verified, fixed at its cause, and red-drilled
(new tests fail on the unfixed tree with the quoted message, pass after).

- `providerExec.ts:205` (P2, plan presets): `isModelUnpriced` returned true
  for `mistral-plan` with an unpriced-only model, so add/test/list warned
  for a model the run never refuses (`configured.ts:806` assigns
  `{ kind: 'plan' }`). Plan-key presets now return false up front, read
  from the same preset table the run resolves. Red drill for the new test:
  `expected true to be false`; 4/4 pass after. Commit `d3b765e4b0`.
- `ModelApiHost.ts:16603` (P1, legacy session totals): pre-D121
  `snapshot()` added the open reservation into the saved `budgetSpentUsd`
  (`b6ba938849^:16708-16713`, written mid-request by `persistSpend`), and
  `adopt` took it whole. `fileSessionStore.load` now rebuilds seed plus
  settled legacy claims (open reservations stay out; D121), stamps
  `spendSettledOnly`, and the save lands the rebuild instead of merging
  onto the phantom; later saves merge as before. Unreadable journals keep
  the stored total with a log line, and sessions without a journal keep
  what their file holds. Red drills: load `expected '10' to be '8.5'`,
  save `expected '10' to be '9'`; the three older two-window tests stay
  green on both trees. Commit `c99b90e4a1`.
- `ModelApiHost.ts:16400` (P2, unknown charges row): `usageBudget()`
  returned settled spend only while `addSpend` kept a boolean. The session
  now counts unknown-charge calls, the conversation row carries
  `unknownChargeCalls` (the schema and both renderers already did for the
  daily row; admission still counts reported costs only), and
  snapshot/adopt persist the count. Red drill: `expected undefined to be
3` on a real save/load round trip. A full-session unit test is not
  possible without stand-ins (no test builds a `ModelApiSession`), so the
  counting half is covered by the persisted round trip plus typecheck.
  Commit `c99b90e4a1`.

Gates on the final tree: typecheck host+unit clean, eslint zero warnings
on all six changed files, prettier clean, `check:plan` 0 drift,
`check:l10n` 0 problems, `npm run build` green with a clean tree after.
Suites with the repository's own timeout: `fileSessionSpend` (7),
`providerUnpriced` (4), `dailySpend` (5), `sessionStore` (21),
`sessionRecords` (11), `sessionImport` + `sessionTransfer` + `sessions`
(39), `usageLiability` + `usageContracts` + `runLedger` (61) — all pass.

Left named plainly: a legacy file with spend but no journal keeps its
total (nothing to rebuild from); legacy retained liability (sent but
usageless, once counted as spend) is dropped by the rebuild per D121 and
is not back-counted as unknown calls; the migration assumes all writers
are new builds (an old build's save keeps old merge behaviour).

## PR217W1 — triage, one line per thread and per CI failure (2026-10-18, lane PR217W1)

Threads 1–7 were fixed on this branch under PR217FIX2/FIX3
(`11f98e72b`, `5b72b8607`, `d3b765e4b0`, `c99b90e4a1`); each is
re-verified against the current tree as its fix lands below. Threads
8–12 are open. CI failures reproduced locally where marked.

- `fileSessionStore.ts` (security P2, two-window base): already fixed
  by `11f98e72b` — each window's base is its own unmerged
  `incomingSpend`, stored only after the write lands.
- `dailySpend.ts` (P1, open legacy reservations): already fixed by
  `11f98e72b` — only `settledUsd` enters the migrated total.
- `runExec.ts:1215` (P1, output cap caching): already fixed by
  `5b72b8607` — a resolved provider policy replaces the cached cap.
- `providerExec.ts` (P2, unpriced catalogue): already fixed by
  `5b72b8607` — an `unpriced`-only entry keeps its no-price warning.
- `providerExec.ts:208` (P2, plan presets): already fixed by
  `d3b765e4b0` — plan-key presets skip the no-price warning.
- `ModelApiHost.ts:16617` (P1, legacy session totals): already fixed
  by `c99b90e4a1` — the store rebuilds seed plus settled claims.
- `ModelApiHost.ts:16407` (P2, unknown charges row): already fixed by
  `c99b90e4a1` — the conversation row carries `unknownChargeCalls`.
- `fileSessionStore.ts:306` (security P2, retained claims): OPEN — a
  legacy claim with `retainedUsd` but no `settledUsd` is skipped as
  wholly open, so a resumed capped session can spend the incurred
  liability again. Fix: count it conservatively as spent.
- `ModelApiHost.ts:16511` (P2, unknown-count merge): OPEN — `save()`
  delta-merges `budgetSpentUsd` but writes `unknownChargeCalls`
  wholesale, so a second window's increment is lost. Fix: per-window
  count bases, merged like spend.
- `ModelApiHost.ts:16618` (P2, unknown-cost guard): OPEN — adopt
  restores the count but leaves `hasUnknownBudgetCost` false, so the
  next known-cost turn prints a misleading cost line. Fix: init the
  boolean from the restored count.
- `runLedger.ts:344` (P1, priced incomplete/failed): OPEN —
  `lastResponseSchema` allows `priced` only with
  `terminal === 'completed'`, so a billed `incomplete`/`failed`
  response fails validation. Fix: the invariant.
- `fileSessionStore.ts:305` (P2, claim ownership): OPEN — neither
  migration compares the legacy identity fields (`scopeId`,
  `claimId`, `sessionId`, `accountId`) before summing. Fix: parse and
  compare in both journals; a mismatch keeps the stored total.
- CI `duplication`: reproduced — 2 clones, both from this branch
  (legacy schemas `fileSessionStore.ts`/`dailySpend.ts`; a repeated
  two-window setup in `fileSessionSpend.test.ts`). Fix: one shared
  legacy-journal module plus a test helper.
- CI `packages` (VSIX 3801461 vs 3788800): measured — shipped `dist/`
  is 6.2 KB smaller than the merge base; `l10n/` grew ~87 KB raw
  (~24 KB gzip) from the branch's feature strings. Cuts TBD, budget
  untouched.
- CI `paidMoneyStructure`: reproduced — `unexpected:
["host/backend/fileSessionStore.ts:spentUsd"]` from the migration's
  `seeds` array typed `number | string`. Fix: `UsdAmount`.

## PR217W1 — fixes (2026-10-18, lane PR217W1)

Threads 1–7 re-verified green on the final tree (suites below); threads
8–12 fixed at their cause. Red drills: each fix reverted alone (the
four src breaks in one tree, the Action mirror on its own), the new
tests fail with the quoted message, the fix restored, green rerun.

- `fileSessionStore.ts:306` (security P2, retained claims):
  `legacyClaimSpendUsd` (`src/host/backend/legacyJournal.ts`) counts a
  settled charge, else a retained liability, else nothing. Retained is
  not a reservation: the removed journal wrote it at retain time for
  fees a run incurred past its reservation
  (`sessionBudgetJournal.ts:315` at `b6ba938849^`), so counting it
  refines thread 2's settled-only rule instead of contradicting it —
  held-but-never-spent money still stays out. Both migrations share the
  reader (also fixes the `duplication` clone). Red drill:
  `expected { spentUsd: '3.75' } to deeply equal { spentUsd: '5.75' }`
  (daily) and the session load reading `8.5` for `10.5`.
- `ModelApiHost.ts:16511` (P2, unknown-count merge):
  `fileSessionStore` keeps per-window unknown-count bases beside the
  spend bases (`load` sets them, `save` stores the window's own
  unmerged count after the write) and merges count deltas the same way
  as spend. Red drill: `expected 2 to be 3`.
- `ModelApiHost.ts:16618` (P2, unknown-cost guard): `adopt` sets
  `hasUnknownBudgetCost` from the restored count, so the turn-cost
  notice stays suppressed after a reload. No unit test can reach
  `adopt` (no test builds a `ModelApiSession`; stand-ins are
  forbidden), so the proof is the round-tripped count it derives from
  plus inspection; stated plainly as untested.
- `runLedger.ts:344` (P1, priced incomplete/failed): the
  `lastResponseSchema` invariant now mirrors the ledger's pricing
  condition (settled terminal, valid usage, no transport error) instead
  of requiring `completed`; `action/lib/result.mjs` carries the same
  mirror. The existing incomplete/failed ledger test now also validates
  the runExec-shaped settled attempt event against both validators.
  Red drills: `expected false to be true` on the schema alone and on
  the mirror alone.
- `fileSessionStore.ts:305` (P2, claim ownership): both migrations
  compare `claimId` (against the directory name, as the removed
  journal wrote it), `scopeId` (against the seed), `sessionId` and
  `accountId` before summing; a mismatch keeps the stored total with a
  log line (session) or refuses as damaged (daily). Fixtures completed
  to the real journal shape (identity fields, directories named for
  their claim ids). Red drill: `expected false to be 'damaged'`
  (daily); the session load keeps `10` unstamped.
- CI `paidMoneyStructure`: the migration's `seeds` hold `UsdAmount`
  (what `legacyUsdSchema` outputs); the dead `typeof === 'number'`
  finite checks went with it. Green.
- CI `duplication`: the two legacy schema blocks now live once in
  `legacyJournal.ts`; the repeated two-window setup and the repeated
  legacy-day seed are helpers. `jscpd`: 0 clones.
- CI `packages` (VSIX 3801461 vs 3788800): staged and measured to
  the byte, cut what is legitimately cuttable. A scratch harness
  (`temp/scratch/stage-measure.mjs`, not committed) replicates the
  repo's own staging, vsce pack, `compactVsix` and `compress-vsix`
  for the final tree and the merge base (platform helpers excluded
  on both sides — `native/` is unchanged, so they are byte-identical;
  archive constants and version identical): head 3291895, base
  3276124, branch delta **+15771 final bytes**, which reconciles with
  the CI number (helpers contribute the same constant on both sides).
  Per-member attribution: `l10n/ui.tables.json.br` +12099, code
  archive +1757, eager bundles +1486 (English fallbacks carrying the
  new strings), webview chunks +682, usage archive +345, nls −630,
  everything else 0. Removed the only provably dead strings (4 keys,
  zero readers repo-wide — src, test, scripts, action, native,
  skills, exact and literal): `execBudgetStartExact` (superseded by
  the Rule/Bytes start lines), `execStaleHoldsClosed` (holds-aging is
  gone under D121), `execBudgetMinimum` (no run minimum remains under
  D121) and `sessionBudgetWriteFailed` (the wizard reports through
  `sessionBudgetPartialSave` only); `check:l10n` 0 problems, l10n
  suites green. Re-staging after the removals measures the same total
  within solid-compression noise (±200 B on the brotli archives),
  which itself proves the point: only multi-KB content changes move
  this gate. Exhausted every other lever and proved each empty: exact
  duplicate values in `en.ts` are 4 trivial pairs in other features'
  code; the 43 unread `estimate*` keys are forward-held translated
  copy for the planned M117 provisioning flow (PLAN.md: provisioning
  waits for M109/M110d/M110f; scope says strings in all 14 tables;
  `estimatorLocalization.test.ts` guards them) — deleting them would
  sabotage that milestone; `team*`/`playbook*`/`reference*` keys are
  read through indirection (`UI_TEXT[x]`, `usageKey` tables) by live
  features; the catalog ships once by design (the `.json` is removed
  from stage); English fallbacks and archive regions are D6
  architecture. The remaining +15 KB is live feature text and code,
  so the gate cannot pass by cutting: that needs the lead's cap
  decision (the cap record itself says the hosted universal VSIX on
  the release PR sets the final cap) or structural packaging work.
  Budget untouched, no gate weakened, no feature cut.

## PR217W1 — packages follow-up: impossibility proof (2026-10-18)

Per the follow-up directive the whole hunt was redone strictly,
key by key. All 39 remaining branch-added strings are read by
product code (property access or table literal, verified per key);
the 4 removed keys were the only dead ones. The staged
`estimate*` block (44 keys × 14 locales) measures 24,945 raw value
bytes (~7 KB final) but is M117's planned provisioning copy, so it
is not this lane's to delete — and even deleting it (~7 KB) plus
the dead keys (~1.6 KB) totals ~8.6 KB, still short of the 12,661
bytes the gate needs. No combination of legitimate content removals
closes the gap: the rest is live feature text and code, and
sub-KB removals drown in solid-brotli noise (re-staging after the
4-key removal measures within ±200 B). The gate needs the lead's
cap decision or structural packaging work (the parallel vsix-room
lane's territory). Nothing further can be cut here without
breaking a live feature, another milestone's scope, or a gate.

## PR217W1 — gates on the final tree (2026-10-18, lane PR217W1)

Every check below ran in the lane worktree with the repository's own
timeout (no `--testTimeout`); suites at most 3 files per run,
`--maxWorkers=3`.

| Gate                                                     | Exit                          |
| -------------------------------------------------------- | ----------------------------- |
| `npm run typecheck` (all projects)                       | 0                             |
| `eslint --max-warnings=0` on the 10 changed TS/MJS files | 0                             |
| `prettier --check` on changed sources and the 14 tables  | clean                         |
| `npm run deadcode` (knip)                                | 0                             |
| `npm run cycles` (dpdm)                                  | no cycles                     |
| `npx jscpd`                                              | 0 clones                      |
| `node scripts/check-l10n.mjs`                            | 0 problems                    |
| `npm run check:plan`                                     | 0 drift                       |
| `npm run check:reference`                                | current                       |
| `npm run check:host-api`                                 | 0 problems                    |
| `npm run build`                                          | 0                             |
| SAST (`security:sast`)                                   | 0 findings                    |
| `security:audit`                                         | 0 (2 advisories, 1 exception) |

Suites, all with the repository's own timeout: `fileSessionSpend`
(10), `dailySpend` (7), `runLedger` (47), `paidMoneyStructure` (46),
`providerUnpriced` + `sessionStore` + `sessionRecords` (36),
`sessionImport` + `sessionTransfer` + `sessions` (39),
`usageLiability` + `usageContracts` + `l10n` (40),
`l10nPacked` + `runtimeDailyBudget` + `sessionBudgetFit` (12).

Not run here with a result claimed: the universal VSIX itself (its
`package` step needs CI-only helpers — no macOS artifacts and no
arm64 Linux helper exist on this rig, so `npm run package` stops at
the helper check; the numbers above are measured over the same staged
content instead). The `hasUnknownBudgetCost` restore line has no unit
test (named above); everything else is drilled.

Real-use note: no paid or live model calls in this lane (nothing
changed needs one); the proof is the packed-product-shaped suites and
gates above, plus the real-file journals the migration tests drive.
