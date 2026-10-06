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
  queried admission period. Refuse finite account caps when unbounded or
  unpriced cost cannot supply an authoritative finite liability; never invent
  zero. Reconcile the ISO local-week boundary with D82's
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

## Startup split guard and direct daily composition

The first production build passed every size budget but exited 1 at the
unchanged split guard: dist/extension.js carried the backend-only
src/core/backends/modelapi/sessionBudget.ts through the shared wrapper import.
The daily module now imports only AccountBudgetAdmission's type and directly
binds/calls its injected guard. The session wrapper stays with the backend.
No gate, bundle budget or ownership boundary was changed, and no helper module
or production placeholder was introduced.

Two additional paid tests prove a factory failure itself, as well as a returned
guard's refusal, refunds the initial extra/Judge claim. The three owning suites
now contain 60 tests. The direct implementation's guards were drilled again;
the corrected Judge binding mutation targets its assignment specifically (the
first broad substring also matched the extra declaration and was discarded).
The eight verified cases below bring deliberate drill cases to **46**. Every
case exited 1 at a named assertion and restored byte-exact to SHA-256

`2aeab0218a38d907c66919e37f5ed053bb1f9193470ccbca4e7227008a48740a`

| Deliberately broken final daily guard | Named failing test (first reported)                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| direct-extra-binding                  | refunds a refused extra account preflight and preserves its structured trigger           |
| direct-extra-initial                  | refunds a refused extra account preflight and preserves its structured trigger           |
| direct-extra-final                    | rechecks image account thresholds after key retrieval, before fetch                      |
| direct-judge-binding                  | refunds a refused judge account preflight and preserves its structured trigger           |
| direct-daily-budget-raised            | rechecks the same bound account before a 429 retry and sends no request after revocation |
| direct-daily-final-budget             | rejects a final send if another window reserved the last funds meanwhile                 |
| direct-extra-refund                   | refunds a refused extra account preflight and preserves its structured trigger           |
| direct-judge-refund                   | refunds a refused judge account preflight and preserves its structured trigger           |

## Changed files

- src/core/accounts/thresholds.ts
- src/core/backends/modelapi/sessionBudget.ts
- src/host/paid/paidDailyBudget.ts
- test/unit/thresholds.test.ts
- test/unit/sessionBudget.test.ts
- test/unit/paidDailyBudget.test.ts
- docs/certification/m108-t-thresholds.md

## Final verification and delivery limits

All checks ran directly on macmini (Node 24.21.0), with unchanged gates.
No exploratory or final invocation raised the repository's 5-second per-test
timeout. No test filter, skip, credential-store access, live/paid model call,
new dependency, push, merge or rebase was used. Temporary drill scripts and
logs are removed after recording their named failures and restoration hashes.
All local commits use the existing lint-staged and gitleaks hooks.

| Check                                                                                                                          | Final result                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/thresholds.test.ts test/unit/sessionBudget.test.ts test/unit/paidDailyBudget.test.ts --maxWorkers=3` | Exit 0; three complete files, **60 tests passed**, default timeout                                                                            |
| `TZ=America/Santiago npx vitest run test/unit/thresholds.test.ts --maxWorkers=3`                                               | Exit 0; 19 tests passed, default timeout; both midnight guards deliberately failed and restored                                               |
| `npm run typecheck`                                                                                                            | Exit 0, all five projects; host and unit refreshed successfully after the type-only split fix                                                 |
| Changed-file ESLint, `--max-warnings=0`                                                                                        | Exit 0                                                                                                                                        |
| Changed-file Prettier and `git diff --check`                                                                                   | Exit 0                                                                                                                                        |
| `npm run deadcode`                                                                                                             | Exit 0; existing vendor/axe-core configuration hints only                                                                                     |
| `npx jscpd`                                                                                                                    | Exit 0; 1,176 files, **zero clones**, unchanged zero threshold                                                                                |
| `node scripts/check-l10n.mjs`                                                                                                  | Exit 0; 14 tables, 164 manifest strings, 602 source files, **0 problems**                                                                     |
| `npm run check:host-api`                                                                                                       | Exit 0; 332 APIs, 31 VS Code importers, 25 Node built-ins, 61 theme variables, **0 problems**                                                 |
| `npm run build`                                                                                                                | Exit 0; size, split, host-global and 83-package notices checks pass                                                                           |
| Deliberate guard drills                                                                                                        | **46 verified cases**, named failures, exit 1 and SHA-256 equality after restoration; an additional broad Judge probe was corrected and rerun |

Final production sizes: extension **438.4/600 KiB**, Model API
**448.3/475 KiB**, checkpoint store **76.9/225 KiB**, webview startup including
static imports **897.3/900 KiB**, deferred webview JS **49.7/50 KiB**.
No budget is raised and no new UI chunk ships. The threshold evaluator binds
into M95/P's lazy provider path when those owners integrate it; no substitute
registry, aggregate, pacing implementation or host wiring ships here.

Full `npm run quality`, aggregate coverage, cross-editor end-to-end and live
receipts remain with the lead, as the explicit lane brief requires. M102,
M106, P and W's named bindings above are integration handoffs, not completed
features falsely advertised in README or the absent feature catalogue.
The only calendar choice defaulted locally is an ISO Monday-start week;
reconcile it with D82 when M102 lands. Paid defaults, consent and all existing
spend caps retain today's behavior.

## FIXM108T — RVM108T findings (macmini, 2026-10-06)

Both confirmed P2 findings are fixed; no review residuals. Read the entire
RVM108T report and the rig/shared rules. No dependency or tool install,
credential access, paid/live call, network request, merge, rebase or push.

| Finding                    | Fixed behavior                                                                                                                                                                                  | Regression                                                                                                                                                                  | Deliberate red drill                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 decimal USD admission | Settled, reserved, uncertain and projected amounts are summed and compared as integer nano-USD for day/week/month. $0.10 + $0.20 may use a $0.30 cap; $0.70 + $0.10 trips an $0.80 reached cap. | `admits $0.10 plus $0.20 at $0.30 and stops $0.70 plus $0.10 at $0.80`; 600 seeded nano-USD cases compare admission to an independent bigint oracle.                        | `money-projection` restores binary projected addition; `money-reached-cap` restores binary settled/reserved/uncertain comparison. Both fail the named decimal regression; projection also fails the property test. |
| P2-2 headroom division     | Remaining × 100 and configured percentage × live limit are compared as integers before any quotient. Request/token buckets must be safe integers.                                               | Both `trips ... headroom at 7 of 25 remaining and exactly 28 percent` cases, including just above/below fractional percentages; malformed bucket and precision regressions. | `headroom-division` restores division first and fails both request/token cases. Integer/precision guard removal fails its named regression.                                                                        |

### Arithmetic audit and exact helper

Inspected every arithmetic operation in thresholds.ts, sessionBudget.ts and
paidDailyBudget.ts (operator/Math scan and manual review). Threshold money and
count aggregation/comparison use bigint. Rate-limit counts are validated safe
integers; percentages finer than the supported decimal unit refuse instead of
silently widening admission. Plan percentages compare their validated source
values directly, with no division. Date arithmetic remains local-calendar
integer arithmetic.

Session input byte/token accumulation and output affordability use integer
arithmetic. Token input/output/cache prices, reservations and helper settlements
use exact rational multiplication and addition. Daily token estimates, remaining
USD, raise proposals, cap validation and over-cap preflight use the same helper.
A newly entered cap is parsed as decimal text before conversion/publication.
Cap conversion rounds down, liability/rational-charge conversion rounds up to
a nano-USD; neither grants additional room. Ceiling display uses exact whole
and fractional Intl parts and the currently installed locale, including large
amounts. No positive amount disappears at the default precision.

Existing lane-0/M82 numeric contracts are compatibility boundaries on this
base: parse before arithmetic and convert the exact result only for the
existing output contract. T does not rewrite another lane's journal, UI or
wire contracts. The existing T-M102-AGGREGATE handoff also requires an exact
upstream sum: an authoritative reader must supply nano-USD totals rather than
first adding binary dollar numbers. Full journal migration and shared money
ports belong to M106H's integrated exact-money work.

### T-M106H-USD-API — keep one shared implementation

`src/shared/usd.ts` did not exist on this base; the brief's named local
`/Users/randy/lanes/M106H/src/shared/usd.ts` also does not exist on macmini,
and H's reported Git object is unavailable here. Therefore source-level API
parity with H cannot be independently asserted on this rig. This is the
explicit shared API handoff for the lead to consolidate with H, keeping one
`src/shared/usd.ts` implementation and these callers' signatures/semantics:

| API                                                                  | Contract                                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Usd`                                                                | Integer nano-USD, `bigint`.                                                                                                                                          |
| `parseUsd(number \| string, rounding = 'ceil'): Usd`                 | Parse the existing numeric boundary's decimal spelling or exact decimal text; caps pass `'floor'`. Finite nonnegative supported amounts only; bounded text/exponent. |
| `sumUsd(readonly Usd[]): Usd`                                        | Exact addition without numeric intermediate values.                                                                                                                  |
| `subtractUsd(Usd, Usd): Usd`                                         | Exact signed difference.                                                                                                                                             |
| `multiplyUsd(Usd, bigint, denominator = 1n, rounding = 'ceil'): Usd` | Exact rational multiplication; positive divisor; charge ceiling.                                                                                                     |
| `compareUsd(Usd, Usd): -1 \| 0 \| 1`                                 | Exact ordering.                                                                                                                                                      |
| `usdDecimal(Usd): string`                                            | Canonical decimal spelling.                                                                                                                                          |
| `usdNumber(Usd): number`                                             | Existing nonnegative output boundary only; no subsequent local dollar arithmetic.                                                                                    |
| `formatUsd(Usd, fractionDigits?): string`                            | Installed-language Intl display with a ceiling; visible sub-cent amounts.                                                                                            |

No alternate helper, duplicate journal or fallback backend is introduced.
T-M102-AGGREGATE, T-M106-PACING, T-P-ADMISSION and T-W-DOCS-HELP remain the
previously named integration handoffs. The shared evaluator/helper run in all
editors and ACP/headless; no VS Code-only arithmetic is added.

### Executed FIXM108T drills

Each command runs the complete owning test file directly on macmini with
`--maxWorkers=3` and the repository's default timeout. Every mutation exits 1
with the named test failure and restores the original bytes in finally;
SHA-256 before/after restoration matches. The session division mutation throws
the budget refusal in the test that requires an affordable request to succeed;
it is a named test failure, not a compile/suite-loading failure.

| Drill                     | First named failing test                                                 | Restored SHA-256                                                   |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `money-projection`        | admits $0.10 plus $0.20 at $0.30 and stops $0.70 plus $0.10 at $0.80     | `c0470cde5476cc2e6de81a3926af029e55dd0fec37416c8a1271643a74f351da` |
| `money-reached-cap`       | admits $0.10 plus $0.20 at $0.30 and stops $0.70 plus $0.10 at $0.80     | `c0470cde5476cc2e6de81a3926af029e55dd0fec37416c8a1271643a74f351da` |
| `headroom-division`       | trips requests headroom at 7 of 25 remaining and exactly 28 percent      | `c0470cde5476cc2e6de81a3926af029e55dd0fec37416c8a1271643a74f351da` |
| `bucket-integers`         | refuses fractional and unsafe request/token buckets                      | `c0470cde5476cc2e6de81a3926af029e55dd0fec37416c8a1271643a74f351da` |
| `percent-precision`       | refuses headroom percentages finer than the exact decimal unit           | `c0470cde5476cc2e6de81a3926af029e55dd0fec37416c8a1271643a74f351da` |
| `session-output-division` | keeps exactly one output token affordable after decimal cap subtraction  | `20ccd19ecfb1f66221bb0ab0451a84e46a48a71f0b8fde63056235c3610c1885` |
| `session-base-count`      | refuses fractional, negative and overflowing input token counts          | `20ccd19ecfb1f66221bb0ab0451a84e46a48a71f0b8fde63056235c3610c1885` |
| `session-count-overflow`  | refuses fractional, negative and overflowing input token counts          | `20ccd19ecfb1f66221bb0ab0451a84e46a48a71f0b8fde63056235c3610c1885` |
| `helper-settlement`       | settles helper token costs exactly and retains unknown sent liability    | `20ccd19ecfb1f66221bb0ab0451a84e46a48a71f0b8fde63056235c3610c1885` |
| `daily-token-cost`        | reserves token extras at exact nano-USD prices                           | `3b8b3e279ebf1c7162e5a4d44d3ea7439349c7613c7ff29ce55d27868530be46` |
| `daily-count-validation`  | refuses fractional, negative and unsafe token estimates before reserving | `3b8b3e279ebf1c7162e5a4d44d3ea7439349c7613c7ff29ce55d27868530be46` |
| `daily-headroom`          | returns exact decimal headroom to Judge without binary subtraction       | `3b8b3e279ebf1c7162e5a4d44d3ea7439349c7613c7ff29ce55d27868530be46` |
| `daily-cap-parse`         | rounds a newly entered cap down to nano-USD before publication           | `3b8b3e279ebf1c7162e5a4d44d3ea7439349c7613c7ff29ce55d27868530be46` |
| `liability-ceiling`       | keeps sums, differences and rational multiplication in integer nano-USD  | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |
| `cap-floor`               | rounds liabilities up and caps down without binary arithmetic            | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |
| `display-ceiling`         | displays 0.00003375 with a ceiling and visible positive fractions        | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |
| `rational-divisor`        | refuses malformed, unbounded and negative amounts and invalid divisors   | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |
| `decimal-length`          | refuses malformed, unbounded and negative amounts and invalid divisors   | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |
| `decimal-exponent`        | refuses malformed, unbounded and negative amounts and invalid divisors   | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |
| `decimal-range`           | refuses malformed, unbounded and negative amounts and invalid divisors   | `75c415e119edeb22fec55183cb10d7333e20d4f651640315ff1809592239b8fe` |

After restoration, the complete threshold/session/daily suites pass 73 tests
and the helper suite passes 10, all with default timeouts. Static/build final
receipts are recorded below after those commands complete. No timeout, test
filter, gate, cap, paid default, consent flow or escape hatch is weakened.
