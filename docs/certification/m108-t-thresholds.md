# M108 T — account thresholds (macmini, 2026-10-06)

Read the rig brief, shared codex/common.md, AGENTS.md, PLAN D88 and M108
in full, the named account-terms research, m108-policy.md, m108-0.md and
m108-k.md. Branch m108/t, base f57948c20. No credentials, network requests,
paid/live model calls, dependency installs, merges, rebases or pushes.

## Delivered evaluator

Shared core evaluates all contract metrics over local calendar day, ISO
Monday–Sunday week and calendar month. Calendar arithmetic preserves DST
and leap months. Half-open journal ranges are scoped to provider and account.
Spend includes settled, reserved and uncertain amounts, without moving another
account's liability. Input/output tokens and requests support every period
lane 0's contract accepts. A reached cap trips at equality. A projected request
may use the final allowance exactly, but cannot cross a cap or admit another
request after a cap is reached. Exclude its own already-published claim from
the reader before passing that request separately.

Normalized live plan percentages and request/token headroom use the latest
account-specific reader, never a fixed vendor limit or guessed wire shape.
Active rateLimited/quota/usageLimit blocks retain their reset, including an
unknown reset; expired windows and Retry-After blocks release at equality.
Vendor triggers precede user caps, so policy cannot be bypassed by choosing
a simultaneous user cap. The pool receives all triggers, with structured
kind, metric/reason and reset. The evaluator never selects an account.

Invalid configuration, identity, clock, totals, projections or snapshots and
missing configured live readings fail closed. Reader failures propagate.
Existing translated strings are read at call time; no strings, UI, settings,
commands, casts, suppressions, dependencies or wire codecs are added.

## Named integration handoffs

- **T-M102-AGGREGATE:** M102's aggregate.ts is absent on this base. Bind the
  existing AccountJournalReader.read(query) contract to its real validated
  journal/rollups, with account=default for pre-M108 rows. Maintain separate
  settled/reserved/uncertain totals without double counting, and pending token
  and request reservations. Keep outstanding liability even across a period
  reset; the reader must conservatively carry unresolved claims into the
  queried admission period. Reconcile the ISO local-week boundary with D82's
  implementation when it lands (D82 is also absent here). No substitute
  journal reader is shipped in production.
- **T-M106-PACING:** pacing.ts is absent. Bind AccountLimitsReader.read(provider,
  account) to its account-specific request/token bucket and captured plan
  usage/OpenRouter limit adapters. Normalize limit/remaining/resetAt only
  after the provider's captured codec and capability check. Unknown configured
  values must remain unavailable. M106 owns minute refresh and rate reservations;
  this evaluator only reads them. A limit group's scope must be honored.
- **T-P-ADMISSION:** P owns pool selection and ModelApiHost's per-request client.
  Evaluate every candidate and every final synchronous send with current
  metadata, journal and limits; use vendor triggers before user caps. Bind
  selected-account identity, preserve the parent's conversation and fixed daily
  scopes, and retain each account's uncertain liability. Bind AccountBudgetAdmission to the concrete owned claim through
  withAccountBudgetAdmission in sessionBudget.ts and accountAdmission in
  createPaidDailyBudget. P must catch initial/final refusal and durably refund
  known nonsends; the daily extra/Judge paths already refund initial refusal.
- **T-W-DOCS-HELP:** featureCatalog.ts and its generator are absent. W owns
  README/CHANGELOG/PLAN and the integrated reference: document account spend,
  tokens, requests, plan-window and rate-headroom thresholds and their reset
  periods, including refusal when data is unavailable. Add reference entries
  when the file lands. This lane does not edit another lane's owned files.

The same core runs in every editor and ACP/headless runtime through P/H/U's
bindings. Editor end-to-end, consent/policy, devices, live captures and full
integrated quality remain with their owners. The brief prohibits full quality
and full unit runs; no gate is weakened. This is a scoped lane receipt.

## Evaluator verification

Direct macmini: 19 tests pass using the repository's default timeout and
--maxWorkers=3; host typecheck and changed-file ESLint pass. Every invocation
uses complete owning test files, with no test-name filter or skip. The DST
mutation failed under the rig's America/Los_Angeles local timezone.

## Executed evaluator red drills

Each mutation ran the complete thresholds.test.ts file, exited 1 with a named
assertion failure, and restored the original bytes in finally. SHA-256 before
and after restoration matched for all 24 drills:

`0ed366125667e6d535b98127190c4422b8a19cc6b13bac0ce4eafe72c929cee3`

| Deliberately broken guard | Named failing test (first reported)                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| user-cap-equality         | trips spendUsd at its exact day, week and month value, from generated journals           |
| pending-breach            | admits the last affordable request but refuses a projected breach or a reached cap       |
| reserved-liability        | keeps provider and account spend isolated, including outstanding and uncertain liability |
| uncertain-liability       | keeps provider and account spend isolated, including outstanding and uncertain liability |
| provider-scope            | trips spendUsd at its exact day, week and month value, from generated journals           |
| account-scope             | trips spendUsd at its exact day, week and month value, from generated journals           |
| iso-week                  | queries each configured period once, with local half-open calendar boundaries            |
| calendar-day              | uses calendar dates for DST transitions and leap-month resets                            |
| calendar-month            | trips spendUsd at its exact day, week and month value, from generated journals           |
| plan-equality             | trips captured plan-window percentages at equality, including zero and 100               |
| headroom-equality         | uses the live requests limit for headroom and trips at equality                          |
| live-limit                | uses the live requests limit for headroom and trips at equality                          |
| vendor-priority           | keeps rateLimited and Retry-After ahead of a simultaneous user cap                       |
| retry-reset               | keeps rateLimited and Retry-After ahead of a simultaneous user cap                       |
| required-live-reader      | refuses missing configured live data and malformed snapshots                             |
| required-plan-window      | refuses missing configured live data and malformed snapshots                             |
| required-rate-bucket      | refuses missing configured live data and malformed snapshots                             |
| snapshot-validation       | refuses missing configured live data and malformed snapshots                             |
| journal-validation        | refuses invalid identities, clocks, thresholds and invalid journal totals                |
| identity-clock            | refuses invalid identities, clocks, thresholds and invalid journal totals                |
| threshold-validation      | refuses invalid identities, clocks, thresholds and invalid journal totals                |
| pending-validation        | admits the last affordable request but refuses a projected breach or a reached cap       |
| cost-overflow             | refuses invalid identities, clocks, thresholds and invalid journal totals                |
| count-overflow            | admits the last affordable request but refuses a projected breach or a reached cap       |

## Delivered request admission

AccountBudgetAdmission is an explicit injected factory receiving the owned
claim (claimId and reservedUsd). It binds the selected account once and returns
a synchronous guard which rereads current account thresholds/limits at initial
admission and every final claim check. The injected reader must exclude that
same owned claim before supplying its projected request to the evaluator; all
other open/uncertain claims remain included. It must bind the account chosen
for the actual client, not consult a later global picker selection. P owns
credential/currentness matching and the actual per-request client choice.

withAccountBudgetAdmission preserves the original claim's identity, charge,
settlement and cap check. With no factory it returns the original claim object.
The paid daily extra and Judge paths compose this guard with their existing
fixed shared daily journal. Initial refusal refunds only the known nonsent
claim, before a budget-raise popup. A final refusal stays structured, and the
client's existing nonsent cleanup refunds it. Sent/ambiguous liability is not
refunded. Each retry calls the same bound guard. Paid consent/defaults and the
existing daily/account/session settings are untouched. No account id becomes
a new daily or conversation spend scope.

Real local filesystem tests prove a new account-bound guard cannot reset
settled or outstanding daily and conversation spend. Fake HTTP tests move an
account to its cap during key retrieval and deny before both image and token
fetches. A 429 retry invokes its bound guard again and cannot dispatch after
revocation. Single-model ordinary requests and replay/cache prefixes retain
the existing byte-exact test. Judge final admission retains unsettled spend.

Direct macmini admission suites: sessionBudget.test.ts and
paidDailyBudget.test.ts pass 39 tests using default test timeouts, three workers
and complete files. Changed-source ESLint and unit typecheck pass.

## Executed admission and compatibility red drills

All mutations exit 1 with named assertion failures and restore byte-exact in
finally, comparing SHA-256. The daily-budget pooling mutation deliberately
lets an account guard bypass both the existing cap preflight and final check;
the swap-across-windows regression fails. The conversation mutation disables
the original cap inside the composed check; the M82 swap/liability test fails.

| Deliberately broken guard      | Named failing test (first reported)                                                       | Restored SHA-256                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| initial-admission              | keeps an unbound claim identical and binds a guard once for initial and every final check | `bdcf1c04a1e38e49d45558445a682da768193da85df2d88e4cf360c20da9ec6b` |
| final-admission                | keeps an unbound claim identical and binds a guard once for initial and every final check | `bdcf1c04a1e38e49d45558445a682da768193da85df2d88e4cf360c20da9ec6b` |
| conversation-cap-after-swap    | keeps an unbound claim identical and binds a guard once for initial and every final check | `bdcf1c04a1e38e49d45558445a682da768193da85df2d88e4cf360c20da9ec6b` |
| daily-account-guard            | refunds a refused extra account preflight and preserves its structured trigger            | `275d0fea6604be9e7390e7f284c187f4e609299a598bef1625b2d0d0140581ef` |
| judge-account-guard            | refunds a refused judge account preflight and preserves its structured trigger            | `275d0fea6604be9e7390e7f284c187f4e609299a598bef1625b2d0d0140581ef` |
| daily-budget-raised-by-pooling | rechecks the same bound account before a 429 retry and sends no request after revocation  | `275d0fea6604be9e7390e7f284c187f4e609299a598bef1625b2d0d0140581ef` |
| daily-final-budget             | rejects a final send if another window reserved the last funds meanwhile                  | `275d0fea6604be9e7390e7f284c187f4e609299a598bef1625b2d0d0140581ef` |
| daily-refund                   | refunds a refused extra account preflight and preserves its structured trigger            | `275d0fea6604be9e7390e7f284c187f4e609299a598bef1625b2d0d0140581ef` |
| judge-refund                   | refunds a refused judge account preflight and preserves its structured trigger            | `275d0fea6604be9e7390e7f284c187f4e609299a598bef1625b2d0d0140581ef` |
| unconfigured-journal-read      | uses calendar dates for DST transitions and leap-month resets                             | `0ed366125667e6d535b98127190c4422b8a19cc6b13bac0ce4eafe72c929cee3` |
| structured-trigger-error       | carries the structured trigger with translated user-cap and vendor-limit errors           | `0ed366125667e6d535b98127190c4422b8a19cc6b13bac0ce4eafe72c929cee3` |
| single-account-identity        | keeps an unbound claim identical and binds a guard once for initial and every final check | `bdcf1c04a1e38e49d45558445a682da768193da85df2d88e4cf360c20da9ec6b` |

## Midnight DST regression and fix

The final calendar review found an additional real boundary case:
America/Santiago skips midnight on 2026-09-06. The original start became
01:00, then calendar date changes incorrectly preserved that hour for the
next day, the week's start/end and the month's start/end. The strengthened
`uses calendar dates for DST transitions and leap-month resets` test constructs
its expected boundaries independently. With `TZ=America/Santiago`, the whole
thresholds file failed 1/19 before the fix (next day 04:00Z instead of 03:00Z).

The start now normalizes after selecting its calendar date, and the end
normalizes after advancing to its own date. Both the Santiago run and the
original local-calendar cases pass, with no timeout change or machine setting
change. TZ was supplied only to the individual test process.

Two additional deliberate drills separately restored the old start ordering
and removed end normalization. Each whole-file Santiago run exited 1 at the
named DST test. Both restored byte-exact to SHA-256
`64a67cd1bbdf270d971c1e7d1b672e8a3bac701891ebf0673e4e385d89017438`.
This brings executed deliberate drills to **38**, plus the before-fix
regression failure. Earlier hashes above identify the earlier committed
pieces; this hash identifies the final calendar implementation.
