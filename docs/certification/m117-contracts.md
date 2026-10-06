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
opaque id, unit, remaining amount and reset time. Absence means not reported;
S must never quietly treat an unreported quota as a reported unlimited one.
Lane resources carry requests, tokens and USD per hour for matching limit
units, plus CI jobs/minutes. All slots sharing an account share its limits. The history schema admits only lane
identities, classes, UTC instants, hours, counts and provenance, with explicit
`agentTime` versus `gitElapsed` duration basis. A critical-path bottleneck
cannot promise gains from more agents. Calibration labels must match D97's
20-sample threshold. Catalog prices require a public HTTPS catalog and date.

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

76 estimator keys are translated in English and all 14 `l10n/ui.*.json`
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
