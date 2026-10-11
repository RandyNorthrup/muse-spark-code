# M117 lane 0: contract freeze candidate

Base: `2aa9cbff7`, branch `m117/l0`, Mac mini, 2026-10-06. This is lane 0
only. The lead must review these contracts before G/C/S/U start. No model,
provider, paid, credential-store or other network call was made; no dependency
was installed. Production has schemas and injected ports, with all fakes in
`test/**`.

## Contract entry points

- `src/shared/estimate.ts`: strict application schemas for goals, requests,
  fleet snapshots, lanes, history, inputs, the estimate section and provider
  result projections; `parseEstimateGoal` implements the goal grammar.
- `src/shared/machineClasses.json`: provider-agnostic sizes, covering Linux,
  Windows and macOS, x64 and arm64, plus a GPU class. These are resource
  classes, not offers or availability claims. A class has no provider price.
- `src/shared/constants.ts`: the six D97 tunables, the 40-lane performance
  envelope, and bounds on application document identifiers and collections.
- `test/unit/helpers/estimator/fakes.ts`: a three-OS fleet, an isolated
  metadata journal, a five-operation provider with fictional prices and
  refused billing/payment/sign-up/account paths, a prerequisite-audited board,
  and installation/pairing/wipe ports. There is no socket or HTTP server.
- `test/unit/helpers/estimator/fixtures.ts`: valid section and history builders.
- `test/fixtures/estimator/dags.json`: chain, fan-out, diamond and affinity
  cases, with hand-checkable fixed-duration critical paths, schedules, finish
  hours and P50/P90 dates.
  Lane S adds seeded Monte Carlo schedule/date goldens; these inputs do not
  pretend that a calibrated simulation has already run.

Grammar, consuming the entire trimmed goal: `M112`, `12`, `m110a0`,
`pr:123`, `issues:1,2`, `label:good first issue`, `release:0.16.0`,
`M112:Q,U`. Milestone ids canonicalize to uppercase M and lowercase suffix;
custom lane ids preserve their case. Unknown identifiers are resolved by G,
not guessed here. U parses command flags. Dates are UTC ISO instants; time
comparisons parse instants, so equivalent fractional precision is safe.

The estimate is an `estimate` section payload, schema version 1, rather than
an invented `report-v1` envelope. Identical `asOf` values are required across
request, fleet and section. Quantities are finite and nonnegative; capacities
and identities are validated. CI minutes may be absent when not reported.
Account identifiers are opaque aliases. Their optional `usageLimits` preserve
all simultaneous hard windows (daily and weekly, for example), each with an
opaque id, unit, remaining and full allowance, renewal instant, recurrence and
time zone. `rolling` repeats after `periodSeconds` of elapsed time from
`resetsAt`; `calendar` repeats daily, weekly or monthly at that instant's
local time/day in `timeZone`, with month-end clamped to the last local day.
Units include `percent` (0–100), and remaining cannot exceed the allowance.
These are normalized application projections, not inferred provider fields.
An adapter unable to describe renewal must report the source unavailable,
not invent a renewal schedule. Absence means not reported;
S must never quietly treat an unreported quota as a reported unlimited one.
Lane resources carry requests, tokens, USD and percentage points per hour for
matching limit units, plus slots and CI jobs/minutes. Each quantity carries
`status`, `value`, `basis`, `samples` and `uncertainty`; known values use
`history`, `calibration` or `assumption`. History/calibration require positive
samples; assumptions use zero. Unknown values have `status: unknown`,
`value: null`, `basis: unknown`, zero samples and unknown uncertainty. A known
value may explicitly have unknown uncertainty. An interval must contain its
value. Unknown never means zero demand or unlimited supply.

Machines carry `disks` per opaque `volumeId`, with opaque allocation roles such as `workspace`, `worktrees`, `temp`,
`logs`, `data` and `state`; several roles on one volume share its one headroom. A role
cannot occur on two volumes. The role vocabulary does not impose a limit on
watched volumes; an explicit regression preserves four independent volumes. Known disk snapshots contain safe-integer byte
counts for total/free/floor/headroom, with headroom exactly
`max(0, freeBytes - floorBytes)` and free/floor no greater than total. Unknown
volume measurements retain their identity and roles without fabricated
numbers. Lanes require disk demand per role with peak and steady byte
quantities; steady cannot exceed peak when both are known. Peak includes the
retained demand while running; steady remains after completion until cleanup,
so S must reserve concurrent peaks plus retained bytes from completed lanes
on each physical volume. The ordinary DAG fixtures use 4 GiB peak/2 GiB
steady, fitting the fake's 12 GiB headroom even when completed lanes retain
their demand; an explicit regression uses two 8 GiB lanes against that same
12 GiB volume. `disk` is a possible limiting resource.

All slots sharing an account share its limits. The history schema admits only lane
identities, classes, UTC instants, hours, counts and provenance, with explicit
`agentTime` versus `gitElapsed` duration basis. A critical-path bottleneck
cannot promise gains from more agents. Calibration labels must match D97's
20-sample threshold. Nonempty sections require calibration for every input
lane kind and every scheduled kind/machine-class pair, without duplicate pairs.
They also require `disclosures`, a unique JSON Pointer index covering every
numeric leaf in inputs/results and each P50/P90 finish date, including setup
predictions. Each disclosure names history/calibration/assumption/unknown,
sample size and an interval/time band or explicit unknown uncertainty.
History/calibration require positive sample sizes; assumptions/unknown use
zero. Unknown basis requires unknown uncertainty. Every interval contains its
target. Coverage includes numeric evidence metadata but excludes the
disclosure index's own metadata to prevent infinite self-description. Missing,
extra, duplicate or wrong-target disclosures are refused. Empty-lane results
may have an empty index. Catalog prices require a public HTTPS catalog and date.

Lanes and history use the same typed `review` projection: unknown, or complete
lane `rounds`, module-family `strikes`, per-finding-class strikes, and redesign
events (`moduleFamilyId`, `afterRound`, outcome). A complete review pass counts
once per lane even if it finds problems in several modules. Strikes are the
current M116 counters for rounds with unresolved findings, not finding counts,
and are never summed across modules to produce lane rounds. Class counters
cannot exceed their module counter; modules cannot exceed lane rounds. Module
families and classes are unique. Redesign events refer to declared families
and completed rounds, without duplicate family/round events. `caught` does
not clear a strike; only `impossible` closes it under D96, as reflected by
M116's projected counters. C/S must use the module state for redesign risk,
not a sum or maximum presented as a lane-round count. Unknown history is
excluded from round-rate fitting, rather than represented as zero.

## Repository history evidence and missing measurements

`test/fixtures/estimator/repository-history.json` freezes the 14 M103 and 11
M104 lanes from `PLAN.md` at `bfc27a28f208085bcc4c082f8f747c6cdd139128`.
The fixture records the plan's SHA-256, the dependencies' origin, 11 actual
first-implementation-commit-to-integration-merge durations, both commit
hashes, and UTC timestamps. Git reads were restricted to objects in this
repository. The supplied shared lead records read were `codex/M103INT.md`,
`codex/M104INT.md`, `codex/M103S.report.md` and `codex/M104F.report.md`.

The original M103/M104 tables have **no per-lane Hours column**, and these
lead records supply no hour estimates, active agent time, review-round
counts or CI durations. They cannot honestly form estimate-versus-actual
calibration samples yet. Missing estimates are `null` with `notRecorded`,
never zero or a fabricated prior. Undocumented review counts remain `null`.
The fixture test recomputes every captured elapsed duration from its dates
and checks privacy. The user was asked for any additional lead estimate
record while independent work continued. C must exclude these rows from
fitting until evidenced estimates arrive. Git elapsed time includes waits,
reviews and queues and must not be fitted as active agent time silently.

## Named integration handoffs

The base does not contain the following milestone packages. No implementation
or external wire shape is fabricated for them.

| Handoff                   | Binding and owner                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M117-M113-report`        | M113 lane 0 supplies the real `report-v1` envelope. W registers `estimateSectionSchema` as its estimate payload.                                                                                                                             |
| `M117-M113-goal-sources`  | G binds `EstimateSourcesPort.lanes` to the plan reader/git/PR/CI projections and resolves all goal kinds.                                                                                                                                    |
| `M117-fleet`              | Bind `EstimateSourcesPort.fleet` to M107 governor capacities, M100/M110 machines, M96 roles and M108 account limits. Adapters alias account ids and parse captured responses.                                                                |
| `M117-M116-history`       | C binds `EstimateHistoryPort` to its durable journal and M116 round records; no conversation content is kept.                                                                                                                                |
| `M117-M96-start`          | P implements `EstimateStartPort` with M96's board and M116's reviewed-contract/prerequisite audit, before any start.                                                                                                                         |
| `M117-M109-provider`      | P adapters implement exactly `sizes`, `images`, `create(size,image,cloudInit)`, `status`, `delete`; fixed-origin endpoint allow-lists are enforced before the vault broker dispatch, including redirects. Credentials never enter this port. |
| `M117-M110-node`          | P binds `EstimateNodePort` to M110f installation/teardown/wipe and M110d pairing. Until then, rented setups say `adviceOnly`.                                                                                                                |
| `M117-M104-estimate`      | M104 lane 0 owns its absent method/capability registry. U/W add capability-gated `estimate/*` using these schemas when that registry merges. No MHP envelope is invented here.                                                               |
| `M117-M115-drift`         | U binds lane-finished events to re-estimation; `drift` carries signed P50/P90 hour changes and the previous snapshot time.                                                                                                                   |
| `M117-surfaces-reference` | U/W own slash/ACP/CLI/TUI commands, palette/manifest registration, `featureCatalog` rows and generated reference. Lane 0 does not register unfinished commands or settings.                                                                  |
| `M117-docs`               | W owns README/PRIVACY/SECURITY/CHANGELOG and the final aggregate gate. Record the metadata journal, provider operation restriction and per-server consent/cap there when behavior ships.                                                     |

All editors consume these portable contracts; there is no `vscode`, backend,
OS, DOM or provider-client import. The estimator needs no model capability
and no model call; fleet account limits are provider-neutral. The existing
single-model user flow is untouched. Per-server spend consent and the hard
per-run budget remain P's guards; the fake endpoint restriction alone does
not certify production provisioning. No startup entry imports the contracts;
W owns lazy bundles, measured budgets and the split gate without cap raises.

## Validation

Initial contract/fake piece: host and unit typechecks, scoped ESLint and
Prettier pass. Both owned Vitest files pass: 52 tests with the repository's
default timeout, no skips, no `--testTimeout`. Detailed guard-fire receipts
are in `m117-0-contracts,-strings,-fakes-(lead).md`. Final lane checks and
translation results are appended after the strings piece. Full quality and
cross-rig integration remain the lead's gate, as the brief requires.

## Strings and registration handoff

98 estimator keys are translated in English and all 14 `l10n/ui.*.json`
tables, with no new English exceptions. These cover both fleet questions,
setup choices, input/calibration/honesty labels, the Gantt/accessibility text,
critical-path and bottleneck copy, catalog/date caveats, provisioning budget
and per-server consent, idle Keep/wipe, failures, CLI/slash help and settings.
Consumers read `UI_TEXT.estimate…` inside functions; `fill` supplies all
sentence values. Numeric labels are separate from their values, which U must
format with the existing Intl helpers. No paid default or existing user flow
changes in lane 0.

`test/fixtures/estimator/manifest-strings.json` supplies **five exact manifest
key → UI key mappings**, with English plus 14 real translations. W copies
these values into `package.nls*.json` in the same commit as registering their
`package.json` references. Those files cannot admit unused keys under the
existing localization gate, and the manifest registrations belong to W, so
lane 0 leaves the live manifest tables unchanged. The handoff test checks
that every prepared value exactly matches its canonical UI translation.

U/W register `/estimate`, ACP `/estimate`, CLI `estimate`, the TUI view and
M113's report kind. W registers `museSpark.openEstimator`,
`museSpark.estimator.optimize` (cost/speed, default cost), and
`museSpark.estimator.priceLookup` (follows the Reports network policy), all
with `featureCatalog` coverage and generated reference. The provisioning
budget is required **per run**, with no default, rather than being registered
as a standing spending grant. Existing paid consent is not bypassed.

## Final lane verification (Mac mini)

- Owned suites: `estimatorContracts.test.ts`, `estimatorFakes.test.ts`,
  `estimatorLocalization.test.ts`: 69 tests, default timeout, no skips.
  The existing `l10n.test.ts` also passes all 26 tests.
- 36 red drills, including damaged translations seen to fail the existing
  localization gate; all restores verified by SHA-256.
- Typechecks: all five projects; scoped ESLint with zero warnings; scoped
  Prettier; `git diff --check`.
- `npm run deadcode`: pass (existing configuration hints only).
- `npx jscpd`: zero clones over 1,187 files.
- `node scripts/check-l10n.mjs`: 14 tables, 166 live manifest strings,
  607 source files, zero problems.
- `npm run check:reference`: current (53 features, 44 commands, 59 settings,
  26 slash commands, 116 CLI entries; no unfinished feature registered).
- `npm run check:host-api`: zero problems (332 APIs, 31 VS Code import files,
  25 Node built-ins, 61 theme variables).
- `npm run build`: passes unchanged caps, split rules, host-global check and
  third-party notices. Extension activation 439.5/600 KiB; Model API
  446.9/475 KiB; ACP 821.4/850 KiB; shared English 54.7/125 KiB; webview
  startup 796.6/900 KiB; deferred webview code 50.0/50 KiB. The estimator
  contracts have no runtime entry yet; W adds the lazy estimator/panel chunks
  and measures their own budgets. No cap, rule, ignore or threshold changed.
- Hooks are enabled from this worktree's `.husky/_/pre-commit`; lint-staged
  and gitleaks pass. No push, merge or rebase. Scratch files are removed.

The actual M103/M104 estimates remain missing from the supplied evidence;
this is a named calibration input gap, not fabricated measurements. The
absent M113/M104 registries, manifest/Help wiring and remaining G/C/S/R/P/U/W
implementation/acceptance work remain with their named owners above. The
brief delegates aggregate `quality`, cross-rig/editor and live integration
certification to the lead; this lane does not claim those are complete.

## FIXM117L0: RVM117L0 repair (Mac mini, 2026-10-06)

All four P2 and both P3 findings are fixed before the contract freeze. No
finding is deferred, and no dependency, cap, gate, timeout or permission
policy changed. Portable schemas remain unused by startup/runtime surfaces;
all editors retain the same G/C/S/R/U/W binding handoffs above. The changes
are contracts, deterministic test data, translated prepared labels and docs.

| Finding                   | Resolution                                                                                                             | Regression in `estimatorContracts.test.ts`                                                                                                                                                                         | Red drills |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| P2-1 malformed goals      | Colon required for named kinds; release/lane names forbid extra colons; invalid-goal text explicitly reports rejection | `refuses ambiguous or malformed goal labels` / `releases`; `applies the same strict goal names to structured requests`                                                                                             | G01–G02    |
| P2-2 quota renewal        | Full allowance, rolling/calendar period, reset anchor and validated time zone; percentage units and bounds             | `distinguishes renewed quotas and preserves rolling percentage windows`; `requires renewal metadata and validates quota bounds`                                                                                    | W01–W04    |
| P2-3 disk constraints     | Per-volume measured/unknown headroom and floor; peak/retained byte demand per volume role; disk bottleneck             | `preserves per-volume disk headroom and peak versus retained demand`; `refuses inconsistent disk headroom, aliases and demand`                                                                                     | D01–D06    |
| P2-4 missing disclosures  | Kind/class duration calibration plus exhaustive numeric/forecast JSON Pointer evidence index                           | `requires calibration for every lane kind and scheduled machine class`; `requires a calibration disclosure for every number and finish prediction`; `validates calibration identities and dated uncertainty bands` | C01–C08    |
| P3-1 resource assumptions | Discriminated known/unknown quantities with basis, samples and uncertainty; unknown value is null                      | `distinguishes assumed, observed and unavailable resource quantities`; `requires resource provenance and honest unknown status`                                                                                    | N01–N03    |
| P3-2 review aggregation   | Complete rounds per lane, current module/class strikes and named redesign events; shared lane/history projection       | `counts rounds per lane and retains strikes per module family and class`; `rejects contradictory review aggregation and orphan redesign events`                                                                    | R01–R07    |

Every drill ran the complete owning test file directly on this rig with
`--maxWorkers=3` and the repository default timeout, without a test-name
filter, skip or `--testTimeout`. Each expected named regression failed, then
its changed file was restored from saved bytes and checked with SHA-256.
L01 also failed the production localization gate by deleting the German disk
headroom key. T01 made the fake seed depend on `TZ`; the cross-process
serialization regression in `estimatorFakes.test.ts` failed. That test builds
its fixture entry once and runs two children with explicit, different
`TZ`/`LANG` environments, never inheriting credentials; it uses the ordinary
five-second test timeout.

The initial percentage probe also exceeded remaining quota, and the initial
volume-alias probe omitted other referenced machines. Those exploratory
mutations were rejected by unrelated guards. The tests were corrected to
isolate each condition; W02 and D02–D04 then fired their intended guards.
No unsuccessful exploratory probe is counted as a passed drill.

| Drill | Deliberate break                                                                      | Observed named failure                                                                                                   |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| G01   | Remove the missing-colon guard                                                        | `refuses ambiguous or malformed goal labels` (2 expected assertion failure(s), exit 1)                                   |
| G02   | Allow colons in release/lane names                                                    | `applies the same strict goal names to structured requests` (2 expected assertion failure(s), exit 1)                    |
| W01   | Make rolling period optional                                                          | `requires renewal metadata and validates quota bounds` (1 expected assertion failure(s), exit 1)                         |
| W02   | Remove percentage allowance ceiling                                                   | `requires renewal metadata and validates quota bounds` (1 expected assertion failure(s), exit 1)                         |
| W03   | Remove remaining/full allowance bound                                                 | `requires renewal metadata and validates quota bounds` (1 expected assertion failure(s), exit 1)                         |
| W04   | Remove time-zone validation                                                           | `requires renewal metadata and validates quota bounds` (1 expected assertion failure(s), exit 1)                         |
| D01   | Remove headroom arithmetic                                                            | `refuses inconsistent disk headroom, aliases and demand` (1 expected assertion failure(s), exit 1)                       |
| D02   | Allow one volume role on multiple volumes                                             | `refuses inconsistent disk headroom, aliases and demand` (1 expected assertion failure(s), exit 1)                       |
| D03   | Remove free/total bound                                                               | `refuses inconsistent disk headroom, aliases and demand` (1 expected assertion failure(s), exit 1)                       |
| D04   | Remove floor/total bound                                                              | `refuses inconsistent disk headroom, aliases and demand` (1 expected assertion failure(s), exit 1)                       |
| D05   | Allow retained demand above peak                                                      | `refuses inconsistent disk headroom, aliases and demand` (1 expected assertion failure(s), exit 1)                       |
| D06   | Restrict allocation roles to three names, excluding watched worktree/log/data volumes | `preserves per-volume disk headroom and peak versus retained demand` (1 expected assertion failure, exit 1)              |
| N01   | Allow observed quantities with zero samples                                           | `requires resource provenance and honest unknown status` (1 expected assertion failure(s), exit 1)                       |
| N02   | Allow numeric values for unknown quantities                                           | `requires resource provenance and honest unknown status` (1 expected assertion failure(s), exit 1)                       |
| N03   | Remove resource uncertainty coverage                                                  | `requires resource provenance and honest unknown status` (1 expected assertion failure(s), exit 1)                       |
| R01   | Allow module strikes above lane rounds                                                | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| R02   | Allow class strikes above module strikes                                              | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| R03   | Allow orphan redesign families                                                        | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| R04   | Allow redesign events after uncompleted rounds                                        | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| R05   | Allow duplicate module families                                                       | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| R06   | Allow duplicate finding classes                                                       | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| R07   | Allow duplicate family/round redesign events                                          | `rejects contradictory review aggregation and orphan redesign events` (1 expected assertion failure(s), exit 1)          |
| C01   | Remove lane-kind/scheduled-class calibration coverage                                 | `requires calibration for every lane kind and scheduled machine class` (1 expected assertion failure(s), exit 1)         |
| C02   | Allow duplicate kind/class calibration rows                                           | `validates calibration identities and dated uncertainty bands` (1 expected assertion failure(s), exit 1)                 |
| C03   | Bypass exhaustive disclosure coverage                                                 | `requires a calibration disclosure for every number and finish prediction` (2 expected assertion failure(s), exit 1)     |
| C04   | Allow duplicate disclosure paths                                                      | `requires a calibration disclosure for every number and finish prediction` (1 expected assertion failure(s), exit 1)     |
| C05   | Allow history disclosures with zero samples                                           | `requires a calibration disclosure for every number and finish prediction` (1 expected assertion failure(s), exit 1)     |
| C06   | Allow unknown basis with a numeric interval                                           | `requires a calibration disclosure for every number and finish prediction` (1 expected assertion failure(s), exit 1)     |
| C07   | Remove numeric disclosure interval coverage                                           | `requires a calibration disclosure for every number and finish prediction` (1 expected assertion failure(s), exit 1)     |
| C08   | Remove forecast-date band coverage                                                    | `validates calibration identities and dated uncertainty bands` (1 expected assertion failure(s), exit 1)                 |
| L01   | Delete German disk-headroom translation                                               | `keeps all estimator copy and consent values in de` (1 expected assertion failure(s), exit 1)                            |
| T01   | Make the fake seed depend on environment time zone                                    | `serializes the revised contracts identically across time zones and languages` (1 expected assertion failure(s), exit 1) |

Byte-exact restoration receipts (SHA-256 at drill time; all 32 drills restored):

- `src/shared/estimate.ts`: `fd8d9d13409f660c23edec1f99694d7f62cb1f120058101b053a9a61bdc9fa79`.
- `l10n/ui.de.json`: `82fb6be5dbdfaf0dddc6741efa3a8172f2175884a6d0d50b2606e96fe19000cf`.
- `test/unit/helpers/estimator/fixtures.ts`: `64f526caaa1244221dc94e658f2cf11ff8efccc40c8297e5f2cbbfc6deea45ec`.

D06 restored the final schema source to SHA-256 `ac910f7bee62c1a424abbe90c7aa88b111988ab1e88c931a555c9076c2a6147a`.

Between the first 31 drills and D06, the source removes an unused
evidence-fields object and inlines its only used enum. Disk allocation roles use opaque IDs, so every watched volume
can be represented rather than imposing a three-volume limit. The fake's
repeated disk metadata is shared as input data and cloned by schema parsing
(the unchanged duplication gate caught the repeated literals). Final scoped verification below
uses the final source. The existing missing real history measurements and
unmerged integration bindings remain named handoffs, not new review residuals.

### Final repair verification

Implementation commit: `64c65467605c001174d997262e2e01eff9f2ff23`.
All checks below ran directly on Mac mini. Final heavy checks ran sequentially.

- `npx vitest run test/unit/estimatorContracts.test.ts test/unit/estimatorFakes.test.ts test/unit/estimatorLocalization.test.ts --maxWorkers=3`: **89/89**, after every source restore and the final changes; repository default timeout, no skips or timeout override.
- `npx vitest run test/unit/l10n.test.ts --maxWorkers=3`: **26/26**.
- `npm run typecheck`: all five projects pass on the final source.
- Scoped `npx eslint --max-warnings=0`: all seven changed TypeScript files pass.
- Scoped `npx prettier --check` and `git diff --check`: pass.
- `npm run deadcode`: pass, with only the two pre-existing configuration hints.
- `npx jscpd`: **zero clones** over 1,187 files after deduplicating fake input data; no threshold or ignore changed.
- `npm run check:l10n`: **14 tables, 166 manifest strings, 607 source files, zero problems**. All 98 estimator keys are present in English and fourteen translations.
- `npm run check:reference`: current, **53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI entries**. No unfinished surface is registered.
- `npm run check:host-api`: **zero problems**, 332 APIs, 31 VS Code import files, 25 Node built-ins and 61 theme variables.
- `npm run build`: pass, including unchanged size caps, split rules, host globals and third-party notices (83 bundled packages).

| Bundle                              | Final size / unchanged cap |
| ----------------------------------- | -------------------------- |
| Extension activation                | 439.5 / 600 KiB            |
| Model API                           | 446.9 / 475 KiB            |
| ACP                                 | 821.4 / 850 KiB            |
| Shared English                      | 55.0 / 125 KiB             |
| Webview startup with static imports | 797.1 / 900 KiB            |
| Deferred webview JavaScript         | 50.0 / 50 KiB              |

All other checked bundle groups pass. Estimator schemas still have no shipped
entry; W retains the lazy-bundle wiring and its own measurements. The new
labels increase the existing English/browser fallback only.

Hooks existed at `.husky/_/pre-commit` before committing and ran unchanged:
lint-staged checked/fixed seven TypeScript files and formatted eighteen
JSON/Markdown files; gitleaks scanned approximately 103.55 KB of staged text
and reported no leaks. The final schema SHA-256 remained
`ac910f7bee62c1a424abbe90c7aa88b111988ab1e88c931a555c9076c2a6147a`
after the hooks. No install, new dependency, live/paid call, push, merge or
rebase was performed. Lane scratch scripts and red-drill logs are removed;
the named failures, breaks and restoration hashes remain in this record.

No RVM117L0 finding remains open. The named pre-existing integration/history
handoffs above remain with their owners. Aggregate `npm run quality` is
prohibited by the lane brief and remains the lead's integration gate;
this scoped repair does not claim aggregate or cross-rig/editor certification.
