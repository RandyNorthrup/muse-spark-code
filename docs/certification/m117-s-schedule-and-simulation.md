# M117 S — schedule and simulation

Base `dced6ca3`, branch `m117/s`, Mac mini, 2026-10-06. Ownership is
`schedule.ts`, `simulate.ts`, `bottleneck.ts`, their three unit suites and
this record. D97/M117 and the frozen-contract/G certification were read
before implementation. The prior documentation belongs to C and is absent
on this base; no calibration constants or rates will be invented here.

## Implementation and integration plan

- Validate projected lanes/fleet once and prepare deterministic list
  scheduling: downstream critical-path priority, stable identity ties,
  nonpreemptive lanes, OS/architecture/class/GPU affinity, governor/kind
  slots and role compatibility. Slots share account rate and usage windows.
- Reserve CI jobs and reported minutes, simultaneous per-volume disk peaks
  and completed-work retention. Unknown demand/headroom is an explicit
  failure when needed for admission; unreported account/CI limits remain
  explicit qualifications, never reported unlimited capacity.
- Supply C's duration/review distributions through an injected, validated
  port. Own the seeded PRNG, lognormal sampling, lane review rounds and
  module third-strike redesign draws. Canonical inputs and distribution
  parameters determine the SHA-256 seed unless the request supplies one.
- Run the configured 2,000 trials, select nearest-rank P50/P90 finish dates
  and a real P50 trial's schedule. Compare resource relaxations with the
  same duration draws; additional resources never shorten a dependency path.
- Certify fixture goldens, quota/disk constraints, resource bottlenecks,
  same-process and child-process determinism and the forty-lane budget.
  Every new guard/calculation gets a named byte-exact red drill.

Named handoffs: `M117-S-C-distributions` binds C's fitted/prior parameters and
evidenced review/redesign duration overheads to S's duration-model port.
`M117-S-R-engine` exposes prepared scheduling/simulation to setup search.
`M117-S-U-W-results` binds result fragments and retained input evidence into
the frozen section, exhaustive disclosures, translated bottleneck callout,
all editor/ACP/headless surfaces and W's lazy bundle/budgets/help/docs.
No command, setting, UI, model/provider call or production fake is introduced
by this library lane. W owns PLAN, CHANGELOG and featureCatalog integration.
The brief prohibits aggregate quality, pushes, merges and rebases; scoped
verification runs directly here with the repository default test timeout.

## Verification

The engine returns library fragments, not a partially assembled report section.
C/U/W retain numeric input/model evidence, quantify the P50–P90 band and
cover all numbers/forecast dates in the frozen disclosure index. Conditional
Monte Carlo spread does not imply zero uncertainty in assumed parameters or
unreported supply. `unknownLimits` must be rendered by U/W with the existing
translated unknown/input labels. Existing running work is projected as a
remaining nonpreemptive lane; M96/M107's live adapter must supply capacity
without double-counting its measured current occupancy. Initial merged work
is already included in measured as-of disk free space; new completed lanes
retain their steady demand during the forecast.

Quota demand is a constant-rate projection over a lane, with total lane demand
split in proportion to allocated account slots. Reported simultaneous windows
all apply. The search includes remaining-budget boundaries between renewals,
not just renewal instants. Calendar recurrences preserve anchor day/time;
month ends clamp, DST folds pick the earlier instant and gaps shift forward.
These are explicit normalized-contract scheduling assumptions, not claims
about any provider's wire. Calendar/rolling recurrence and placement searches
are bounded by the existing 512-item contract constant; an expired history
beyond that bound fails explicitly. CI occupied jobs remain occupied until
more source data is available; no future minute allowance is invented.

The calibration port provides actual/estimate lognormal parameters, overhead
evidence and review/redesign rates. Fixed models are explicitly supplied exact
remaining-duration assumptions, not a production fallback. Unknown module
state refuses nonzero redesign exposure. The frozen calibration/quantity
schemas validate model evidence; a separate guard rejects the divergent
geometric rate of one. The kind/class model product is bounded before calling
calibration, preventing an unbounded Monte Carlo memory/work expansion.
Review overhead must exclude time already included in the fitted duration.
Mathematical PRNG coefficients, calendar/ISO format bounds and quantile ranks
are immutable algorithm parameters, not new user tunables.

A bottleneck comparison removes one class using a real P50 trial's unchanged
draws. Slots retain governor/user caps; machines are identical compatible
replicas with independent per-machine disk space and shared accounts/CI.
Largest positive improvement wins; ties prefer slots, accounts, CI or disk
before whole machines. If no single removal improves a resource-delayed
schedule, `coupled-resources` fails explicitly rather than falsely claiming
that the dependency path binds. R/U/W must present this limitation honestly;
there is no unsupported optimality claim or fabricated setup recommendation.

### Red drills

All rows below ran the complete owning Vitest file directly on Mac mini with
`--maxWorkers=3`, the repository timeout, no test-name filter and no skip.
Each exited 1 with its intended named regression, restored saved source bytes
in `finally`, and verified the restored SHA-256. No drill mutation remains.
The timing assertion sometimes also failed under shared-rig load; it was
never counted as proof of another guard. Rows require their intended failure.

The first weekly probe changed recurrence but exercised only the initial
renewal, so it exited 0 and is not counted. A new next-week regression then
failed under S27. The first governor probe was still blocked by the per-kind
cap and is not counted; the mixed-kind regression isolates aggregate caps
for S39. One formatted canonicalization selector needed adjustment before
T14 ran. These exploratory probes are not successful drill receipts.
Red-drill review also removed duplicated manual calibration/evidence checks;
the complete frozen schemas guard those facts without decorative duplicates.

| Drill / deliberate bypass | Observed failing regression                                                                                          | Exit |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---: |
| `S01-unknown-demand`      | M117 resource list scheduling refuses missing disk roles, unknown headroom and unknown admission demand              |    1 |
| `S02-affinity`            | M117 resource list scheduling enforces OS, architecture, class and GPU affinity                                      |    1 |
| `S03-affinity`            | M117 resource list scheduling enforces OS, architecture, class and GPU affinity                                      |    1 |
| `S04-affinity`            | M117 resource list scheduling enforces OS, architecture, class and GPU affinity                                      |    1 |
| `S05-gpu`                 | M117 resource list scheduling enforces OS, architecture, class and GPU affinity                                      |    1 |
| `S06-fixed-priority`      | M117 resource list scheduling prioritizes the longest downstream path before stable ID ties                          |    1 |
| `S07-roles`               | M117 resource list scheduling reserves governor slots, per-kind capacity and role compatibility                      |    1 |
| `S08-kind-capacity`       | M117 resource list scheduling reserves governor slots, per-kind capacity and role compatibility                      |    1 |
| `S09-physical-slots`      | M117 resource list scheduling holds actual slots even when the governor permits more than the fleet has              |    1 |
| `S10-requests`            | M117 resource list scheduling shares request and token rates across every slot using the same account                |    1 |
| `S11-tokens`              | M117 resource list scheduling shares request and token rates across every slot using the same account                |    1 |
| `S12-account-shares`      | M117 resource list scheduling splits a multi-slot lane rate across its allocated accounts                            |    1 |
| `S13-ci-occupied`         | M117 resource list scheduling reserves CI jobs including occupied jobs and refuses an exhausted minutes budget       |    1 |
| `S14-ci-jobs`             | M117 resource list scheduling reserves CI jobs including occupied jobs and refuses an exhausted minutes budget       |    1 |
| `S15-ci-minutes`          | M117 resource list scheduling reserves CI jobs including occupied jobs and refuses an exhausted minutes budget       |    1 |
| `S16-ci-identity`         | M117 resource list scheduling reserves CI jobs including occupied jobs and refuses an exhausted minutes budget       |    1 |
| `S17-ci-period`           | M117 resource list scheduling does not assume a new CI allowance after its reported period ends                      |    1 |
| `S18-disk-peaks`          | M117 resource list scheduling reserves concurrent disk peaks and retained bytes on the physical volume               |    1 |
| `S19-disk-retained`       | M117 resource list scheduling reserves concurrent disk peaks and retained bytes on the physical volume               |    1 |
| `S20-disk-headroom`       | M117 resource list scheduling refuses missing disk roles, unknown headroom and unknown admission demand              |    1 |
| `S21-disk-roles`          | M117 resource list scheduling refuses missing disk roles, unknown headroom and unknown admission demand              |    1 |
| `S22-quota-debit`         | M117 resource list scheduling charges both daily and weekly windows and reserves earlier inserted work               |    1 |
| `S23-quota-renewal`       | M117 resource list scheduling charges requests quotas and waits for rolling renewal                                  |    1 |
| `S24-quota-initial`       | M117 resource list scheduling charges requests quotas and waits for rolling renewal                                  |    1 |
| `S25-calendar-month`      | M117 resource list scheduling renews calendar month at anchored local time from 2026-01-31T12:00:00.000Z             |    1 |
| `S26-calendar-zone`       | M117 resource list scheduling renews calendar day at anchored local time from 2026-03-07T17:00:00.000Z               |    1 |
| `S27-calendar-week`       | M117 resource list scheduling renews a weekly quota again after its first renewal is consumed                        |    1 |
| `S28-duration-class`      | M117 resource list scheduling validates every sampled class even when it cannot be selected                          |    1 |
| `S29-merged-duration`     | M117 resource list scheduling validates boundaries, sampled durations, floors and date overflow                      |    1 |
| `S30-duration-floor`      | M117 resource list scheduling validates boundaries, sampled durations, floors and date overflow                      |    1 |
| `S31-date-year`           | M117 resource list scheduling refuses dates outside the frozen four-digit ISO wire format                            |    1 |
| `S32-dependency-time`     | M117 resource list scheduling matches the chain golden nonpreemptive schedule                                        |    1 |
| `S33-sampled-priority`    | M117 resource list scheduling recomputes sampled priorities, critical paths and slack without dividing lane time     |    1 |
| `S34-slack`               | M117 resource list scheduling recomputes sampled priorities, critical paths and slack without dividing lane time     |    1 |
| `S35-path-slots`          | M117 resource list scheduling matches the chain golden nonpreemptive schedule                                        |    1 |
| `S36-quota-horizon`       | M117 resource list scheduling bounds an expired quota recurrence rather than freezing the estimator                  |    1 |
| `S37-unknown-limits`      | M117 resource list scheduling keeps unreported supply limits explicit and inputs byte unchanged                      |    1 |
| `S38-between-resets`      | M117 resource list scheduling finds a feasible start between staggered renewal events                                |    1 |
| `S39-slot-governor`       | M117 limiting resource keeps aggregate governor and user caps across kinds during slot relaxation                    |    1 |
| `T01-prng`                | M117 seeded duration simulation pins the PRNG stream and keeps every draw strictly inside zero and one               |    1 |
| `T02-lognormal`           | M117 seeded duration simulation pins seeded lognormal quantiles, representative trial and review overhead            |    1 |
| `T03-reviews`             | M117 seeded duration simulation pins seeded lognormal quantiles, representative trial and review overhead            |    1 |
| `T04-redesign`            | M117 seeded duration simulation counts review rounds once per lane and redesigns once per module at the third strike |    1 |
| `T05-model-unknown`       | M117 seeded duration simulation retains unknown review history and refuses unavailable duration evidence             |    1 |
| `T07-quantity-schema`     | M117 seeded duration simulation rejects fractional evidence sample counts at the model boundary                      |    1 |
| `T08-identity`            | M117 seeded duration simulation validates distribution identity, calibration threshold, rates and overflow           |    1 |
| `T09-review-horizon`      | M117 seeded duration simulation validates distribution identity, calibration threshold, rates and overflow           |    1 |
| `T10-overflow`            | M117 seeded duration simulation validates distribution identity, calibration threshold, rates and overflow           |    1 |
| `T11-row-schema`          | M117 seeded duration simulation validates distribution identity, calibration threshold, rates and overflow           |    1 |
| `T12-unknown-modules`     | M117 seeded duration simulation retains unknown review history and refuses unavailable duration evidence             |    1 |
| `T13-auto-model-seed`     | M117 seeded duration simulation canonicalizes input sets and includes model evidence in the automatic seed           |    1 |
| `T14-canonical-order`     | M117 seeded duration simulation canonicalizes input sets and includes model evidence in the automatic seed           |    1 |
| `T15-clock`               | M117 process determinism produces byte-identical outputs twice and in children with different TZ and LANG            |    1 |
| `T16-p50`                 | M117 seeded duration simulation pins seeded lognormal quantiles, representative trial and review overhead            |    1 |
| `T17-p90`                 | M117 seeded duration simulation pins seeded lognormal quantiles, representative trial and review overhead            |    1 |
| `T18-completed-models`    | M117 seeded duration simulation does not request duration models for an empty or already completed goal              |    1 |
| `B01-resource-comparison` | M117 limiting resource names binding accountRate by paired resource relaxation                                       |    1 |
| `B02-same-samples`        | M117 limiting resource uses identical sampled durations for the baseline and every relaxation                        |    1 |
| `B03-more-agents`         | M117 limiting resource names binding machines by paired resource relaxation                                          |    1 |
| `B04-coupled`             | M117 limiting resource refuses to claim a critical path when coupled constraints require joint expansion             |    1 |
| `T19-model-limit`         | M117 seeded duration simulation bounds model cartesian work before calling calibration                               |    1 |
| `T20-singular-rate`       | M117 seeded duration simulation validates distribution identity, calibration threshold, rates and overflow           |    1 |
| `S40-duration-coverage`   | M117 resource list scheduling requires exact duration coverage and a valid projected fleet boundary                  |    1 |
| `S41-fleet-boundary`      | M117 resource list scheduling requires exact duration coverage and a valid projected fleet boundary                  |    1 |
| `S42-valid-duration`      | M117 resource list scheduling validates boundaries, sampled durations, floors and date overflow                      |    1 |
| `T21-input-boundary`      | M117 seeded duration simulation validates distribution identity, calibration threshold, rates and overflow           |    1 |

Total: **66 completed deliberate mutations**, a count from execution receipts.

Restoration hashes at drill time:

- `src/core/estimator/schedule.ts`: `f948d9f151353f52a531910469f38ae363f416d4152635817e254a2e03f567d4`.
- `src/core/estimator/simulate.ts`: `21564f6b0f8aea919a471108e9a654e70aca73292faf2e5e269910f72d740e08`.
- `src/core/estimator/simulate.ts`: `e3275d62d6f4841cff9c341a0348392d64d25b4aa611b16284da04ae7646870b`.
- `src/core/estimator/bottleneck.ts`: `3c666441edb36a9504ba2c8ab7130d70932734d84a0e91e44d6fbd8985c745d4`.

The earlier simulation hash preceded removal of redundant validation;
T20/T21 verify the final singular-rate and input-boundary guards. Shared
schema checks, sampling, PRNG and quantile code retained their named proofs.
No `as` escape hatch, lint suppression, dependency, credential read, paid/live
model call, gate/cap/timeout change or external mutation was introduced.

### Performance investigation

The unchanged forty-lane, 2,000-trial test includes the paired bottleneck
comparison. It initially measured 5,131.6 ms, then passed after caching disk
co-fit checks and renewal calculations. A later measured sample was
2,199.6 ms; scanning only overlapping reservations and reusing DAG adjacency
then passed. Subsequent shared-rig samples still reached 2,196.1 ms. Each is
a single observed wall-time sample with unknown repeatability uncertainty,
not a calibrated speed forecast. Following the brief's stop rule, no further
performance rewrite, timeout override, skip or threshold reduction was made.
The final verification receipt below records the actual final timing result;
cross-rig performance remains the lead's integration acceptance.

### Final scoped gates

Final command receipts, build measurements and commit are appended after
verification. Aggregate `npm run quality` is expressly prohibited by this
lane brief and remains W's integration gate. W also owns product docs,
featureCatalog/reference registration and the lazy entry/budget proof; this
core lane adds no command, setting or separately reachable user-facing feature.

Final verification on Mac mini, one heavy command at a time:

| Check                                                                                                                                         | Result                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/estimatorSchedule.test.ts test/unit/estimatorSimulate.test.ts test/unit/estimatorBottleneck.test.ts --maxWorkers=3` | Exit 0; **61/61**: 36 schedule, 16 simulation, 9 bottleneck; default timeout, no skips/filters.                                                                                                                     |
| Forty lanes, 2,000 draws and paired bottleneck                                                                                                | Passed the unchanged 2,000 ms operation bound. Final Vitest test duration **1,914.6 ms**, including setup/assertions: one observed sample with unknown repeatability. Earlier slower samples remain recorded above. |
| `npm run typecheck`                                                                                                                           | Exit 0; all five projects on final code.                                                                                                                                                                            |
| Scoped ESLint / Prettier                                                                                                                      | Zero warnings; all eight owned files formatted. Commit hooks recheck staged files.                                                                                                                                  |
| `npm run deadcode`                                                                                                                            | Exit 0; existing vendor/axe-core configuration hints only.                                                                                                                                                          |
| `npx jscpd`                                                                                                                                   | Exit 0; zero clones across 1,199 files. No threshold/ignore changed.                                                                                                                                                |
| `node scripts/check-l10n.mjs`                                                                                                                 | Exit 0; 14 tables, 166 manifest strings, 612 sources, zero problems. Existing estimator translations reused.                                                                                                        |
| `npm run check:reference`                                                                                                                     | Exit 0; 53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI entries; current.                                                                                                                         |
| `npm run check:host-api`                                                                                                                      | Exit 0; 332 APIs, 31 VS Code import files, 25 Node built-ins, 61 theme variables; zero problems.                                                                                                                    |
| `npm run build`                                                                                                                               | Exit 0; existing size/split, host-global and third-party notice gates pass.                                                                                                                                         |

Build sizes are measurements from one production build, rounded to 0.1 KiB
(display resolution, not forecast uncertainty): extension **439.5/600 KiB**,
Model API **446.9/475 KiB**, checkpoint store **76.9/225 KiB**, webview startup
**797.1/900 KiB**, deferred webview JavaScript **50.0/50 KiB**. Caps are unchanged.
S has no shipped entry on this base; W must still bind and measure the actual
lazy estimator chunk and complete aggregate/cross-rig/editor acceptance.
These measurements do not certify an absent estimator bundle.

The first host-API check detected one new direct crypto import and correctly
failed its generated-file freshness check. S now reuses the existing pure
`core/verify/fingerprint.ts` SHA-256 function; converting its first eight hex
digits gives exactly the former unsigned big-endian word. Final PRNG, date
and cross-process goldens all pass unchanged. The host-API check then passed;
no W-owned generated record, gate or core helper was edited.

`M117-S-history-goldens`: the captured M103/M104 dependencies are scheduled
using explicit unit-hour test assumptions. Their original hour estimates are
null in the supplied evidence, so no historical P50/P90 receipt is invented.
G/C/W retain the named missing-history binding. The synthetic chain, fan-out,
diamond and affinity date/schedule goldens, and seeded lognormal golden, are
fully exercised here. Calibration and report assembly remain named C/U/W
bindings, not fake production implementations.

Final source hashes after reusing the existing hash helper:

- `src/core/estimator/schedule.ts`: `f948d9f151353f52a531910469f38ae363f416d4152635817e254a2e03f567d4`.
- `src/core/estimator/simulate.ts`: `918a45fb56abe244c0f4eb1a884ee77c55903def894a32244334af70980e1312`.
- `src/core/estimator/bottleneck.ts`: `3c666441edb36a9504ba2c8ab7130d70932734d84a0e91e44d6fbd8985c745d4`.

All eight changed paths belong to S. No other lane's file was edited. Source,
tests and the completed drill/verification record are committed with hooks
on; the final hooked commit receipt is recorded separately below. No push,
merge or rebase was performed. Lane scratch scripts, JSON receipts and logs
are removed after the certificate records their evidence.

Implementation commit: `aa2459f2c03a563cb1ff736b045bc6606bcd84ce`.
The worktree's existing `.husky/_/pre-commit` ran unchanged: lint-staged
checked/formatted all seven TypeScript files and this certificate, then
gitleaks scanned approximately 103.08 KB of staged text and reported no leaks.
All three source SHA-256 values above match after the hooks; runtime code is
byte-identical to final verification. The final worktree is clean after the
certificate-receipt commit. No source change or further test rewrite followed
that verified implementation.

## FIXM117S review repair — admission (2026-10-06)

All four RVM117S P2s are in scope; no P1/P3 was reported. The rig and shared
briefs were read in full. PLAN's M117 repair record preceded code changes.
The first three findings are fixed here; performance is the next piece.

- **F1 account combinations:** deterministic account-count enumeration covers
  the exhausted-account-1 / usable-accounts-2-and-3 two-slot case. Physical
  slots on an account are admission-equivalent. After 512 allocations a
  bounded greedy priority fallback explicitly qualifies its selected lane
  with `account-selection-approximate`; failure at this bound reports
  `account-selection-limit`, never a false assertion of infeasibility.
- **F2 disk measurement relevance:** only volumes serving a lane's declared
  disk roles participate. An unknown required volume admits a conditional
  forecast and qualifies that selected lane with `lane:disk:machine:volume`.
  Equal finish times prefer measured placement; unused alternatives/volumes
  add no disk qualification. Missing roles, known disk bounds and unknown
  admission demand retain their guards. Qualification state is per run.
- **F3 quota relevance:** only accounts reachable through an eligible role,
  compatible machine and nonmerged lane participate in renewal search.
  The unused 60-second quota no longer exhausts the 512-renewal guard while
  scheduling a ten-hour lane and its one-hour dependent.

Before the fixes the account-pair and both disk regressions failed. The first
quota fixture exceeded its machine's declared slot cap and was rejected by
Zod; it was corrected to a valid slot on an incompatible role. F3's red drill
then reproduced `quota-horizon` against that valid snapshot. After the fixes,
49/49 schedule and bottleneck tests passed (40 + 9, Mac mini, default timeout).
The explicit fallback regression also passed: 50/50 (41 schedule + 9 bottleneck).
Host typecheck passed; scoped lint found naming/control-flow style issues,
which were fixed before the unchanged hooks rechecked staged source.

| Drill                   | Deliberate regression                     | Required observed failure                                                                                | Result |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| F1-account-combinations | Restore one-account-first slot-ID filling | finds the feasible two-account combination beyond an exhausted first account                             | Exit 1 |
| F2-disk-selection       | Throw immediately on unknown disk volumes | ignores unknown disk headroom on unused alternatives and volumes; selected-lane qualification also fails | Exit 1 |
| F3-usable-accounts      | Enumerate every fleet account again       | ignores quota renewals on accounts no remaining lane can use (`quota-horizon`)                           | Exit 1 |

Each drill ran the complete `estimatorSchedule.test.ts` file with
`--maxWorkers=3`, no CLI timeout override, no filter/skip. Python `finally`
restored saved bytes and compared SHA-256:
`a04e657c858efe9dbb65104853a809465c02ba5d4df8bf05bf882107eaf4be0c`.
No drill mutation remains. No dependency or resource-admission gate changed.

## FIXM117S review repair — performance and final proof

Admission commit `f6084430` ran the unchanged pre-commit hook: lint-staged
checked/formatted the two staged TypeScript files and three Markdown files;
gitleaks scanned 13.61 KB and reported no leaks. The hook's own automatic
backup is the allowed lint-staged behavior; no manual stash was run.

**F4 is fixed.** Profiling the forty-independent-lane operation placed most
CPU time in placement retries and recursive allocation, with garbage
collection behind them. The engine now caches eligible slots, required
volumes and numeric rates; keeps per-account reachable users and per-run
potentially binding windows; uses conservative whole-lane demand bounds to
prove when rates/CI cannot bind; and indexes reservations by slot. Slot
search jumps to the first interval with enough slots, preserving gaps and
all subsequent admission checks. The ready queue follows the same sampled
critical-path priority and stable ID ties without rescanning every lane.
Assigned-lane lookup and reservation event points are reused. No measured
constraint, optimality claim, dependency, resource limit or gate was widened.

The benchmark now covers chain, independent and fan-out DAGs, each with
40 lanes, 2,000 lognormal trials and paired bottleneck comparisons. Its named
15-second per-test timeout lets the deliberately regressed synchronous
operation complete and report the actual two-second assertion failure;
the operation bound stays **2,000 ms** and no CLI timeout override was used.
Every other test uses the repository timeout. Existing PRNG/quantile/date
and cross-process determinism goldens remain unchanged. A new reuse test
runs short, quota-limited and short sampled durations through the same
prepared engine, proving quota/slot state is recomputed for each run.

Observed performance on this shared Mac mini, not a calibrated forecast:

| Forty-lane shape | Before optimizations: operation ms | Verified test duration ms | Separate final operation ms |
| ---------------- | ---------------------------------: | ------------------------: | --------------------------: |
| Chain            |                            2,343.3 |                   1,761.1 |                     1,668.9 |
| Independent      |                           13,068.0 |                   1,503.5 |                     1,426.7 |
| Fan-out          |                           13,072.9 |                   1,680.4 |                     1,233.0 |

Test duration includes fixture/assertion overhead; the separate operation
starts after fixture preparation and ends after the paired comparison.
The temporary probe bundled code once with esbuild `write: false` before
measurement, then ran the local bundle with the same fixture helpers,
models and seed. Build/startup time is excluded. Each number is one observed
sample; repeatability and cross-rig uncertainty are unknown. The first
co-fit/cache-only optimization still failed independent/fan-out budgets;
profiling identified slot retries, and the next indexed-placement/ready-queue
implementation passed. No third performance rewrite was attempted.

### Final byte-exact drills

These repeat F1–F3 against the final optimized engine and prove F4 plus the
rate/CI proof paths, bounded-search honesty and measured-headroom ties.
Every row ran its complete owning file, default CLI timeout,
`--maxWorkers=3`, no filter or skip, and exited 1 with its intended regression. Saved source bytes were restored in Python `finally`; every
SHA-256 comparison matched `7418d3b16148f72a0033e0d2dfce992f58353bea6b024fe20a79af2b2d362c0b`.
Subsequent formatting left that source hash unchanged.

| Drill                   | Deliberate bypass                                                             | Required observed regression                                                                             |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| F1-account-combinations | Restore one-account-first slot-ID filling                                     | finds the feasible two-account combination beyond an exhausted first account                             |
| F2-disk-selection       | Throw on any required unknown disk before selecting placement                 | ignores unknown disk headroom on unused alternatives and volumes; selected-lane qualification also fails |
| F3-usable-accounts      | Restore eager renewal traversal of every fleet account                        | ignores quota renewals on accounts no remaining lane can use (`quota-horizon`)                           |
| F4-parallel-budget      | Temporarily restore the admission-only scheduler from the first hooked commit | forty-lane independent and fan-out budget assertions fail                                                |
| F5-rate-proof           | Pretend no account rate can bind                                              | shares request and token rates across every slot using the same account                                  |
| F6-ci-proof             | Pretend no CI concurrency can bind                                            | reserves CI jobs including occupied jobs and refuses an exhausted minutes budget                         |
| F7-search-limit         | Return no placement when bounded exact/greedy search fails                    | labels bounded account-selection fallback instead of claiming exact search                               |
| F8-measured-tie         | Restore pruning at equal best finish                                          | prefers measured headroom when a waiting alternative finishes at the same time                           |

Final inspection found that the old best-finish pruning discarded an
alternative at an equal finish before the measured-headroom tie preference.
The regression pinned a busy Mac finishing B at the same instant as an
unknown Linux placement, failed with Linux selected, then passed after the
search preserved equal-finish candidates. F8 restores the premature prune
and reproduces that exact failure. The fallback test also rejects a false
`unschedulable` claim when the bounded search cannot establish placement;
F7 replaces the explicit search-limit error and makes that assertion fail.

All four reviewed P2s are fixed; **no review finding is a residual**.
PLAN §9 records bounded-search approximation and the existing named
`M117-S-cross-rig-and-W-bindings` integration handoff. W retains aggregate
quality, other rigs, C's calibration evidence, U/W's complete disclosures and
all-editor surfaces, and the shipped lazy estimator chunk/budget proof.
All code remains in the shared pure core and its owning unit suites; PLAN and
CHANGELOG contain the required repair/acceptance metadata. No new command,
setting, separately reachable feature or catalog entry is introduced.

Final gate and post-drill green-test receipts follow. No live/paid call,
network request, credential read, new dependency, escape hatch, cap or global tool/config change occurred.

### Completed scoped certification

All checks ran directly on Mac mini, sequentially, against the final source.
After the drills an unchanged three-file verification observed **67/70**:
the operation assertions measured chain **2,454.9 ms**, independent
**2,278.8 ms**, and fan-out **2,554.1 ms** on the shared rig. The immediately
following standalone operation probe passed all shapes (table above).
One unchanged complete three-file verification then passed **70/70**, with
its actual benchmark test durations retained in the table. This is timing
variability, not a calibrated claim about its cause. No third performance
rewrite, raised assertion bound, CLI timeout override or skip followed the
failed sample. Both receipts remain recorded here; W owns cross-rig and
aggregate acceptance. The final source SHA-256 matches all eight drills.

| Check                                                                                                                                                                       | Final result                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/estimatorSchedule.test.ts test/unit/estimatorSimulate.test.ts test/unit/estimatorBottleneck.test.ts --maxWorkers=3` (JSON reporter for durations) | Exit 0; **70/70**: 43 schedule, 18 simulation, 9 bottleneck; repository timeout except the three documented named benchmark timeouts; no CLI override, skips or name filters |
| `npm run typecheck`                                                                                                                                                         | Exit 0; all five projects, including the final affinity/tie regression                                                                                                       |
| Scoped `npx eslint --max-warnings=0`                                                                                                                                        | Exit 0; all three changed TypeScript files; no warning/suppression                                                                                                           |
| Scoped `npx prettier --check`                                                                                                                                               | Exit 0; all six changed paths. An earlier appended certificate needed formatting; it was formatted and rechecked                                                             |
| `npm run deadcode`                                                                                                                                                          | Exit 0; existing vendor/axe-core hints only                                                                                                                                  |
| `npx jscpd`                                                                                                                                                                 | Exit 0; zero clones across 1,199 files                                                                                                                                       |
| `node scripts/check-l10n.mjs`                                                                                                                                               | Exit 0; 14 tables, 166 manifest strings, 612 sources, zero problems                                                                                                          |
| `npm run check:host-api`                                                                                                                                                    | Exit 0; 332 APIs, 31 VS Code import files, 25 Node built-ins, 61 theme variables, zero problems                                                                              |
| `npm run check:reference`                                                                                                                                                   | Exit 0; 53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI entries; current                                                                                   |
| `npm run build`                                                                                                                                                             | Exit 0; size, split, host globals and third-party notices pass                                                                                                               |
| `git diff --check`                                                                                                                                                          | Exit 0                                                                                                                                                                       |

Production build measurements (one sample, rounded to 0.1 KiB): extension
**439.5/600 KiB**, Model API **446.9/475 KiB**, checkpoint store
**76.9/225 KiB**, webview startup **797.1/900 KiB**, deferred webview JS
**50.0/50 KiB**. Caps remain unchanged. There is no shipped S entry here;
these sizes do not certify W's future estimator chunk.

No reviewed finding is deferred. The final hooked performance/verification
commit includes the tie correction and the explicit search-limit assertion.
The worktree retains only S's six specified implementation/test/metadata
paths; no push, merge, rebase, dependency, gate or shared configuration change
was performed. Aggregate quality is expressly assigned to W in PLAN §7.
