# M117 R — recommendations and public catalog prices

Base: `85fab2d5a`, branch `m117/r`, Mac mini, 2026-10-06.

## Implementation plan and ownership

D97.6 only, after reading D97 and M117 in full, the shared lane rules,
AGENTS.md, and the lane 0/G/S certification records. The plan names no
additional estimator research capture. C's prior document and M113's network
package are absent on this base. Own `src/core/estimator/recommend.ts`,
`prices.ts`, their unit tests and this certificate. Do not edit another lane's
files. No dependency, model call, credential read or public network request.

- Search a finite, explicit pool of candidate machines, governor-approved
  slots and real/projected account limits. Enumerate slot subsets, removing
  unused machines/accounts. Refuse an oversized search before evaluating;
  never silently truncate and call the result optimal. Minimum means minimum
  machines, then slots, then distinct accounts, within this disclosed pool.
- Inject a forecast evaluator returning S's simulation evidence or an explicit
  infeasible result. Forecast dates, sample sizes, unknown limits and duration
  models remain available for U/W's required disclosure index. No production
  duration or capacity is fabricated. The binding may batch/memoise paired
  trials; this lane does not rewrite S or C.
- Select minima meeting the deadline separately at P50 and P90. Cost is
  incremental server rental through the P90 finish, excluding existing fleet,
  account/CI charges, taxes and fees. Only public dated catalog prices can
  support a rental cost. Speed starts with the fully used existing fleet (or
  a minimum feasible extension if affinity requires it), then adds a machine
  only when its P90 gain reaches the existing four-hour marginal floor.
- Keep individual addition marginal values and group machine/slot/account
  counts by class. A class without a feasible predecessor has an explicitly
  unknown marginal, with zero only as a disclosed nonnegative lower bound.
  Never promise that marginal gains universally decrease for arbitrary DAGs;
  certify diminishing gains on the planned parallel-work fixture.
- Catalog lookup and cache use injected ports for M113. Parse normalized
  application projections, not guessed provider wire shapes. Enforce the
  resolved network permission before dispatch; cache dates, source and age
  remain visible. No adapter claims a live catalog without a captured shape.
- Existing lane-0 translations cover all result labels and failures. No new
  command, setting, surface or UI chunk is registered by this core lane.
  W owns CHANGELOG, reference registration, lazy budgets and aggregate quality.

Named bindings: `M117-R-S-forecast` (U/W bind the evaluator to S/C, retaining
paired uncertainty evidence); `M117-R-fleet-pool` (M107/M108 and P supply
explicit candidate capacities/account projections; resource class sizes
alone cannot invent governor slots or disk headroom); `M117-R-M113-public-catalog` (N binds the no-account public transport, captured adapters, network
policy, freshness and persistent cache); `M117-R-U-disclosures` (U/W render
search scope, unavailable objectives, input evidence, marginal uncertainty
and dated price caveat using lane-0 strings); `M117-R-W-shipping` (W binds
all editor/ACP/CLI/TUI paths and measures the lazy bundle, without cap raises).

## Receipts

Verification, red drills and commit receipts follow implementation. Aggregate
`npm run quality` is prohibited by the supplied lane rules and remains the
lead's gate. No merge, rebase or push is authorized.

## Core API and limits

`recommendEstimate(inputs, candidatePool, forecastPort, catalogPrices)` returns
all five available setup kinds, explicit unavailable kinds, the chosen fleet
indices, complete forecast evidence and per-machine marginal predecessors.
The pool must preserve the current machines, roles, slots, accounts and CI;
only projected machines/accounts/slots are added. No role, CI allowance or
existing account quota is manufactured. Every rental matches the frozen
provider-neutral class (OS, architecture, vCPU, RAM and GPU). Candidates carry
explicit disk measurements, caps and governor capacities. Every slot subset
is considered; unused accounts/machines are removed. Idle current resources
remain visible in the current card and do not contaminate minimum counts.

Minimum uses machine count, then slot count, then distinct account count;
finish time and stable identity resolve ties. Cost compares total incremental
P90 rental charges, rather than hourly rates alone. A rental with no dated
public price makes that candidate's cost unknown, never zero. Existing fleet
has zero **incremental rental** cost by assumption. This excludes account and
CI charges, taxes, fees, provider billing increments and continuing idle time;
it is advice, never a quote or an authorization to provision. Speed explores
all qualifying one-machine expansion paths, including paths a greedy first
choice would miss. It retains every existing slot, and stops when no reachable
expansion saves four P90 hours. If the current fleet is infeasible, roots are
the smallest feasible extensions that retain those slots. All optima are
conditional on the supplied candidate pool and forecast evidence.

The frozen document bound limits the search to 512 evaluated configurations,
including a distinct current snapshot if it contains idle resources. An
oversized pool fails explicitly before the evaluator is called. This is an
operation bound, not a timing promise or a fleet limit. W's integrated local
two-second acceptance still needs a batched/memoised S/C evaluator and an
appropriately bounded candidate pool; this lane does not claim that hundreds
of independent 2,000-trial simulations meet that budget. No threshold rises.

Each setup has one row per machine, preserving distinct offers and the
marginal value of removing that particular machine. U can sum class/slot
counts, but must count distinct account aliases from the selected fleet,
rather than adding per-machine account counts. P50/P90 gains are nonnegative
lower bounds under the list scheduler; an infeasible predecessor has explicit
`unknown` status and no predecessor evidence, with zero only as a lower
bound. Complete input and S/C model evidence remains in `evaluations` for
U/W's numeric/date disclosure index. This API is not a complete report-v1
section and does not replace that index. Diminishing gains are certified on
parallel work; arbitrary affinity/DAG/account combinations can have coupled
gains, so no universal monotonicity claim is made.

`lookupEstimatePrices(options, pricePort)` accepts the injected snapshot time,
lookup enablement, **resolved** M113 network/terminal permission, freshness
bound and an explicit public catalog list. N owns transport public-address
and redirect checks, source timeouts, captured provider adapters and atomic
persistent cache writes. The returned modified/not-modified shapes are
normalized **application projections**, not invented provider wire shapes.
Cache and response parsing reject unknown fields, nonpublic rows, unknown
classes, duplicate/conflicting provider size identities, wrong catalog
URLs/dates, future evidence and invalid numeric rates. HTTPS without URL
credentials/fragments is required before access. An offline cache retains its
date and stale label. Revalidation updates retrieval time without changing
catalog date. Cache-read, fetch, parsing and write failures retain safe evidence
or return a fixed unavailable reason; private exception text is never returned.

All editors, providers and selected models use these shared core APIs. The
lane adds no VS Code, backend, provider client, startup or DOM dependency.
U/W's panel, ACP, CLI, TUI and native-host bindings remain the named handoffs;
no reachable product surface is claimed on this branch. Existing lane-0
strings and fourteen translations supply all labels and errors. No package
manifest key is added without its W-owned registration.

## Test development evidence

The first recommendation run had three failed tests: the uncertainty fixture's
26-hour deadline missed its measured two-machine P90, a repeated large setup
exceeded the default five-second test timeout, and an oversized child `-e`
argument could not launch. An exploratory direct S receipt gave P50/P90 hours
25.62591980906191 / 40.53004255920821 for one slot and
15.862689642381703 / 26.745828334900423 for two slots. These are deterministic
fixture outputs with explicit prior assumptions and zero history samples,
not measured project delivery predictions. The fixture deadline is now 28
hours. Children receive bundled code on stdin. Equivalent fake fleets share
real S forecasts by canonical aliases/resource layouts, and expensive shared
setup runs once in `beforeAll`; no timeout was raised. A subsequent ten-second
setup timeout was fixed by reusing equivalent forecasts too. Final tests use
the repository's defaults and no test-name filter or skip.

A new adversarial speed test failed against the initial greedy search: it
selected two machines instead of the reachable four-machine optimum. The
search now explores every qualifying expansion path; the same named test
passes. Its hours are explicit test assumptions, not calibrated predictions.
The unit typecheck also caught unparsed JSON class OS/architecture strings;
tests now parse the frozen class schema before using those values.

## Guard-fire receipts

All 51 distinct accepted mutations ran a complete owning suite, directly on
Mac mini, with `--maxWorkers=3` and the repository's default timeout. Each
exited 1 and failed its intended named assertion. No test-name filter, skip,
raised timeout, gate threshold or production suppression was used. Original
bytes were saved before each mutation, restored in `finally`, and compared
by SHA-256 before the next drill. P16 and P17 were also repeated on final
code after a formatting-only error-status rewrite.

| Drill                         | Observed named regression                                                                       | Exit |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ---: |
| `R01-input-boundary`          | parses inputs and candidate fleets before invoking an infeasible evaluator                      |    1 |
| `R02-fleet-boundary`          | parses inputs and candidate fleets before invoking an infeasible evaluator                      |    1 |
| `R03-pool-time`               | bounds combinatorial work before forecasting and validates every projection                     |    1 |
| `R04-existing-resources`      | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R05-shared-resources`        | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R06-rental-class`            | rejects every mismatched rented class dimension without forecasting guessed capacities          |    1 |
| `R07-duplicate-price`         | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R08-price-machine`           | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R09-price-provenance`        | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R10-search-limit`            | bounds combinatorial work before forecasting and validates every projection                     |    1 |
| `R11-forecast-consistency`    | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R12-cost-overflow`           | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R13-infeasible-reason`       | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R14-public-price-schema`     | rejects every mismatched rented class dimension without forecasting guessed capacities          |    1 |
| `R15-quantile-schema`         | refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles        |    1 |
| `R16-minimum-p90`             | keeps P50 and P90 minima distinct with seeded duration uncertainty                              |    1 |
| `R17-minimum-p50`             | keeps P50 and P90 minima distinct with seeded duration uncertainty                              |    1 |
| `R18-minimum-size`            | finds deadline minima and cost/speed optima from real S forecasts                               |    1 |
| `R19-missing-rate`            | never assigns a missing public price zero cost and optimizes total P90 rental cost              |    1 |
| `R20-cheapest-cost`           | never assigns a missing public price zero cost and optimizes total P90 rental cost              |    1 |
| `R21-cost-p90-deadline`       | keeps P50 and P90 minima distinct with seeded duration uncertainty                              |    1 |
| `R22-marginal-floor`          | rejects positive speed gains below four hours, including coupled expansions                     |    1 |
| `R23-existing-speed-slots`    | retains every existing slot while searching speed expansions                                    |    1 |
| `R24-speed-reachability`      | finds the fastest qualifying expansion even when a greedy first choice is a dead end            |    1 |
| `R25-marginal-p50`            | reports decreasing marginal gains on parallel work and preserves shared accounts                |    1 |
| `R26-marginal-p90`            | reports decreasing marginal gains on parallel work and preserves shared accounts                |    1 |
| `R27-marginal-unknown`        | reports decreasing marginal gains on parallel work and preserves shared accounts                |    1 |
| `R28-evaluator-isolation`     | preserves input bytes against an evaluator mutation and input ordering                          |    1 |
| `R29-stable-order`            | preserves input bytes against an evaluator mutation and input ordering                          |    1 |
| `R30-account-subsets`         | drops idle machines and unused accounts from minimum setups without conflating current evidence |    1 |
| `R31-cache-identity`          | drops idle machines and unused accounts from minimum setups without conflating current evidence |    1 |
| `R32-clock`                   | is byte-identical across processes, time zones and languages                                    |    1 |
| `P01-lookup-off`              | requires the optional lookup before any cache or network access                                 |    1 |
| `P02-network-off`             | honors the resolved network setting and terminal floor before dispatch                          |    1 |
| `P03-source-options`          | validates options, bounded catalogs/rows, HTTPS and credentials before accessing ports          |    1 |
| `P04-cache-schema`            | rejects poisoned/future caches and never returns their prices offline                           |    1 |
| `P05-cache-provenance`        | rejects poisoned/future caches and never returns their prices offline                           |    1 |
| `P06-future-retrieval`        | rejects poisoned/future caches and never returns their prices offline                           |    1 |
| `P07-future-catalog`          | refuses invalid future evidence before caching or displaying a price                            |    1 |
| `P08-known-class`             | refuses invalid class evidence before caching or displaying a price                             |    1 |
| `P09-catalog-origin`          | refuses invalid origin evidence before caching or displaying a price                            |    1 |
| `P10-catalog-date`            | refuses invalid date evidence before caching or displaying a price                              |    1 |
| `P11-source-freshness`        | conditionally revalidates an old entry while retaining its actual catalog date                  |    1 |
| `P12-public-row-schema`       | refuses invalid public evidence before caching or displaying a price                            |    1 |
| `P13-response-provenance`     | refuses invalid origin evidence before caching or displaying a price                            |    1 |
| `P14-304-requires-cache`      | refuses not-modified when there is no trustworthy cached evidence                               |    1 |
| `P15-distinct-provider-sizes` | refuses one provider size mapped to conflicting machine classes                                 |    1 |
| `P16-cache-isolation`         | keeps the persisted snapshot independent of returned price mutations                            |    1 |
| `P17-clock`                   | conditionally revalidates an old entry while retaining its actual catalog date                  |    1 |
| `P18-cache-read-status`       | isolates a cache read failure and can still use an allowed public catalog                       |    1 |

| `R33-idle-speed-root` | drops idle machines and unused accounts from minimum setups without conflating current evidence | 1 |

Restoration hashes:

- `src/core/estimator/recommend.ts`, R01–R32: `4a5a89313930316db99c254413f3a921e328589e7fdbdd261471ce6a6d7668f6`.
- `src/core/estimator/recommend.ts`, final R33: `08313a7b83eb9a358d4998b7351dd324828568b56ee7005f491711dab2200d01`.
- `src/core/estimator/prices.ts`, P01–P15: `46eaeb1e46fbad65418a1fc9a2c8d5bcb23f442a3c657c0ee023dfc1f192b9af`.
- `src/core/estimator/prices.ts`, first P16–P17: `9060029b2c7eac5b6d2bba2585172782b914260e87f39689de4d7d7813833972`.
- `src/core/estimator/prices.ts`, final P16–P18: `e8dfa59dc1a9326796ce4e824927a2b392fb0ddba1d8544b1a6c84b0e511263b`.

An initial R25 scratch mutation matched a variable declaration and failed
transformation; it was rejected as a drill receipt, restored and corrected
to mutate only the numeric calculation. P16 initially showed that copying
parsed cached rows was redundant: Zod already isolates that input. That
copy was removed. Final P16 bypasses the actual persistence copy, and the
new stored-snapshot mutation test fails. Only named assertion failures are
counted above; a syntax/import failure or passing mutation is not proof.
The first price hash change removes only that redundant copy. Final lint
found an ESLint/Prettier conflict on a nested ternary; two simple assignments
preserve the error-status behavior, with P18 proving the cache-read-failure
status. Parsing/provenance/freshness guards are unchanged. No suppression.

## Final scoped gates

Final receipts and hooked commits follow below. Aggregate quality, shipping
entry/budget measurements and the integrated cross-rig timing acceptance
remain W's explicitly assigned work.

Self-review extended the idle-resource test to the speed card. It failed:
two current inventory machines (one governor-disabled) were counted as the
speed root instead of one active machine. The root now uses the evaluated
projection retaining every current slot and omitting idle machines/accounts.
Thus each expansion adds exactly one active machine; inventory remains in the
current card. The regression passed, and R33 reintroduces the old root to
prove its failure and restore the final hash. No other R guard changed.

The first `jscpd` check correctly failed on seven duplicated assertion lines
(65 tokens) in the price suite. A shared complete-result rejection assertion
preserves those checks, adds the empty-source assertion, and removes the clone.
The final check reports zero clones across 1,204 files. No threshold or ignore
was edited.

Final verification directly on Mac mini, heavy commands run serially:

| Check                                                                                                  | Result                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/estimatorRecommend.test.ts test/unit/estimatorPrices.test.ts --maxWorkers=3` | Exit 0; 46/46 (20 recommendations, 26 prices); repository default timeouts, no skips or filters. Final restored-code run: 15.74 s total command time, one observed sample with unknown repeatability; not the integrated two-second operation benchmark. |
| `npm run typecheck`                                                                                    | Exit 0; all five projects on final source/test code.                                                                                                                                                                                                     |
| Scoped ESLint / Prettier                                                                               | Exit 0; zero warnings, all six changed files formatted.                                                                                                                                                                                                  |
| `npm run deadcode`                                                                                     | Exit 0; existing vendor/axe-core configuration hints only.                                                                                                                                                                                               |
| `npx jscpd`                                                                                            | Exit 0; zero clones across 1,204 files after the assertion consolidation.                                                                                                                                                                                |
| `node scripts/check-l10n.mjs`                                                                          | Exit 0; 14 tables, 166 manifest strings, 614 source files; zero problems. No new user-facing key.                                                                                                                                                        |
| `npm run check:reference`                                                                              | Exit 0; 53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI entries; current. W owns the new runtime/surface registration.                                                                                                                 |
| `npm run check:host-api`                                                                               | Exit 0; 332 APIs, 31 VS Code import files, 25 Node built-ins, 61 theme variables; zero problems.                                                                                                                                                         |
| `npm run build`                                                                                        | Exit 0; size/split, host-global and third-party notice checks pass; 83 bundled packages.                                                                                                                                                                 |

Build measurements from one production build, rounded to 0.1 KiB (display
resolution, not a forecast uncertainty): extension **439.5/600 KiB**, Model
API **446.9/475 KiB**, checkpoint store **76.9/225 KiB**, webview startup
**797.1/900 KiB**, deferred webview JavaScript **50.0/50 KiB**, ACP
**821.4/850 KiB**. No cap or gate changed. R has no shipped entry on this
base; these existing product measurements do not certify an absent lazy
estimator bundle. W must bind and measure it and finish aggregate quality,
real-source capture/adapter bindings, the editor surfaces and cross-rig
integrated timing acceptance.

Only the six R paths changed: `recommend.ts`, `prices.ts`, the recommendation
and price suites, their new `helpers/estimatorRecommendFixtures.ts`, and this
certificate. No other lane's source, shared contract, constant, localization,
manifest, catalog, generated record, build script or documentation was edited.
No dependency/install, suppression, unsafe cast, credential read, live/paid
model request, public network request, merge, rebase or push was made.

Final source hashes match the final restoration records:

- `src/core/estimator/recommend.ts`: `08313a7b83eb9a358d4998b7351dd324828568b56ee7005f491711dab2200d01`.
- `src/core/estimator/prices.ts`: `e8dfa59dc1a9326796ce4e824927a2b392fb0ddba1d8544b1a6c84b0e511263b`.

The existing `.husky/_/pre-commit` is present. The implementation is committed
with hooks enabled, explicit path staging and the required co-author footer;
its actual hook and commit receipt is recorded below after completion.
