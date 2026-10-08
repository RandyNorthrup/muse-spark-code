# Capacity estimator: calibration and prior (D97.4)

This is a local statistical model, with no model call, credential access or
network request. These parameters describe uncertainty; they are not a
delivery promise. Each result retains its supplied UTC `asOf` and duration
basis. Nothing reads the current clock.

## Duration model

For an evidenced lane estimate `E` hours, model duration as
`E * exp(mu + sigma * Z)`, where `Z` is a standard normal draw supplied by
lane S's seeded simulation. `mu` and `sigma` describe the **ratio** of actual
hours to estimated hours, not absolute hours. The shipped assumption is
`mu = 0`, `sigma = ESTIMATE_PRIOR_SIGMA = 0.5`: median duration equals the
estimate, and its approximate P90 multiplier is 1.90. The multiplier is
derived from the normal 90th percentile, not observed throughput. Its
parameter uncertainty is unknown. These are assumption-based numbers with
zero calibration samples.

`fitCalibration(history, kind, machineClassId, asOf, durationBasis)` fits
each exact kind/class pair independently. Its default basis is `agentTime`.
Git first-implementation-commit-to-integration-merge time includes queues,
waits, CI and reviews; it stays `gitElapsed` and is fitted **only** when the
caller explicitly requests that basis. A sparse machine class never borrows
another class's samples. A sparse kind never borrows another kind's samples.

Only positive actual durations completed by `asOf` enter the lognormal fit.
Zero actual hours remain in the journal but cannot enter a logarithm. Replayed
lane/basis records count once; conflicting observations or lane identities
are refused. At fewer than `ESTIMATE_CALIBRATION_MIN_SAMPLES = 20` eligible
lanes, the prior remains and `calibrationLabel` reads the installed language's
**Uncalibrated prior** label at call time. At exactly 20 and above, replace
the prior with the maximum-likelihood mean and population standard deviation
of `log(actualHours) - log(estimatedHours)`, using Welford's stable variance.
An identical-ratio sample uses `Number.EPSILON` as its positive sigma solely
to satisfy the frozen schema; this is a numerical floor, not an empirically
measured spread. Extreme finite inputs stay finite without dividing first.

The row's `samples` is the eligible duration count, including when still
using the prior. `evidence.durationParameters` gives the parameters' actual
basis and samples used: assumption/zero below threshold, calibration/the
eligible count above it. Parameter uncertainty is explicitly unknown; the
simulation's P50–P90 outcome band is not a confidence interval for the fit.

## Review and redesign model

The repository's existing narratives supply three **distinct**, deliberately
cautious prior observations. Their counts are observed lower bounds, not
complete M116 histories, and the selection favors work needing repairs:

| Lane/module                         | Recorded review rounds | Repository evidence                                                                                 |
| ----------------------------------- | ---------------------: | --------------------------------------------------------------------------------------------------- |
| M70 Revert (`M70:e`)                |                      4 | [M70](../certification/m70.md), “The fourth review round on Revert”                                 |
| M83 import (`M83:import`)           |                      5 | [M83e](../certification/m83e.md), “Five review rounds” (superseded M83b/M83d are not extra samples) |
| M91 foreign-hook adapters (`M91:P`) |                      3 | [M91 P](../certification/m91-p.md), “third round redesigns” after two named reviews                 |

The shipped review continuation probability is `(3 + 4 + 2) / (4 + 5 + 3)
= 9 / 12 = 0.75`, derived from those lower bounds. It is an **assumption**
with unknown uncertainty, not a claim that 75% of repository reviews fail.
The three narrative observations are exposed by `calibrationPrior`; they
do not become duration samples or complete review histories. More broadly
representative records may change this prior at a future decision.

For complete known histories of an exact kind/class, one lane's `rounds`
counts once, regardless of the number of module families, findings or
classes. Zero rounds and unknown review state do not imply a clean completed
review; exclude them from continuation-rate fitting. With at least 20 lanes
having positive complete rounds, use
`sum(max(rounds - 1, 0)) / sum(rounds)`. This is the geometric continuation
parameter, not an average number of findings. `reviewSamples` separately
shows available lanes, and `evidence.reviewRoundRate` shows whether its
parameter still comes from the prior or from calibration. Duration and
review thresholds are independent.

The historical narratives have **no complete denominator of eligible module
families**. They justify modelling redesign but cannot establish its
probability. Ship the mean of a uniform Bernoulli prior, `1 / 2 = 0.5`,
as an assumption with zero samples and unknown uncertainty.

For known projections, an observed eligible family has at least two current
strikes, or a named redesign event (which proves its past eligibility even
when `impossible` cleared its strikes). Count each family once for exposure,
and once for whether it had any redesign, regardless of repeated events or
outcomes. When at least 20 independent lanes have such families, replace
the redesign prior with `families with a redesign / observed eligible
families`. `redesignSamples` is the independent **lane** count, not the number
of events. This is conditional on observed eligibility: final counters
cannot recover unrecorded, subsequently cleared patch-only exposures.
That coverage limitation and parameter uncertainty remain explicit.

`laneRedesignRisk(fit, review)` applies the conditional parameter only to
families that **currently** have at least two unresolved strikes. With `k`
such families it returns `1 - (1 - risk)^k`, under an explicit independence
assumption between families. A `caught` event does not clear a strike; the
M116 projection must retain it. An `impossible` event may clear it, so its
family does not trigger future risk unless its current counter again reaches
two. A known state with no such family has structurally zero trigger risk;
unknown review state returns unknown/null, never zero. S must not replace
unknown review state with a clean history.

CI is a separate observed mean of reported **job-hours**, with history basis,
its lane sample count and unknown uncertainty. Missing CI is unknown/null;
an observed zero is known zero. Both duration bases may measure one lane,
but review and CI metadata count that lane once. A known projection can
enrich an unknown one; contradictory known projections are refused.

Active duration includes the lane's build and fix effort. S must avoid adding
that same observed review/fix effort a second time. Likewise, a git-elapsed
fit already includes its waits/CI: it cannot silently become active work plus
another wait allowance. Neither prior supplies a fabricated per-round fix
duration or redesign duration. Further segmented measurements need a named
interface change before they can support such a decomposition.

## Journal and builders

`EstimateHistoryJournal(privateDirectory)` implements `EstimateHistoryPort`
for all editors and runtimes. It stores only the frozen strict `HistoryRecord`
metadata: lane ids, kind/class, hours, UTC dates, counts and provenance. It
keeps no author, branch subject, account identity, file contents, conversation
or credential. Invalid inputs fail before writing. Errors use fixed technical
codes and the existing translated estimator failure template; raw filesystem
and source messages do not become user text.

One immutable JSON file per SHA-256(lane id / duration basis) gives idempotent
retries. A private staging file is written and fsynced, then published through
a no-clobber hard link. POSIX also fsyncs its directory; Windows relies on the
filesystem's name journalling. Competing processes cannot overwrite a lane
or lose another lane's record. A conflicting completed observation is refused
with the existing bytes intact. A failed flush/publication reports failure;
a post-publication directory flush failure can leave a complete record, so
retry the same observation. Local filesystems must support hard links; an
unsupported store fails explicitly.

Published files are checked for symlinks, size, strict UTF-8, schema and hashed
identity. The read bound is 128 KiB, derived from the existing 512-item and
256-character contract bounds; a growing file cannot bypass it. Corrupt
records are kept and reported, never skipped or erased. Interrupted `.tmp`
files are unpublished and ignored; this reader does not guess whether another
writer owns them or delete them. The storage owner may reclaim these staging
orphans after closing its writers. Storage is private application data, not
a repository folder, and the caller owns retention/export/deletion policy.
It is metadata, not encrypted secret storage. Windows rejects links observed
before open; POSIX also uses `O_NOFOLLOW`. The trusted private directory is
not a defense against a malicious process running as the same user.

`buildHistory(lanes, ports, asOf)` consumes normalized application projections
through `HistoryBuilderPorts`, after each source adapter's captured-wire
parser. It validates all returned metadata before use; it never spawns git,
looks up credentials or makes HTTP requests. Board active time takes priority;
only an absent board measurement allows git elapsed fallback. Invalid or
failed board data is a failure, not a reason to use a different measurement.
Review state remains unknown when absent; missing CI remains absent in the
record. Unmerged lanes, unavailable estimates/durations and measurements
ending after `asOf` get explicit exclusion reasons. `collectHistory` builds
then appends the completed observations, propagating journal failure.

The frozen M103/M104 fixture contains 25 lanes and 11 git elapsed observations,
but **no evidenced hour estimates**, review counts or CI job-hours. Its null
estimates are excluded before any source call; zero, guessed estimates and
the narrative review prior cannot turn those rows into calibration samples.

## Integration bindings (other owners)

- **C → S/G/U/W:** consume `CalibrationFit.calibration` as the frozen result
  row; retain `durationBasis`, independent review/redesign counts and `evidence`
  in honesty/disclosure rendering. Read `calibrationLabel` at render time.
  G supplies any remaining-work floor; C does not invent a calibrated minimum.
- **M117-M96-history-board:** bind the board duration port to completed active
  lane accounting, including pauses and fixes correctly; supply merged state
  and evidenced estimate from M113's plan projection.
- **M117-M113-history-git/CI:** bind git to the evidenced first implementation
  commit and integration merge; CI returns summed job-hours. These adapters
  parse real captured service shapes before producing these projections.
- **M117-M116-history:** bind the review port to complete lane rounds, current
  module-family/class strikes and named redesign outcomes. Finish enrichment
  before appending; immutable records refuse later conflicting corrections.
- **M117-W-storage/docs:** choose private storage per editor/runtime, bind the
  journal only in the lazy estimator bundle, and document its metadata and
  retention policy in PRIVACY/README/CHANGELOG. Register the completed feature
  in `featureCatalog`; C adds no command, setting or user surface of its own.

The same portable code serves VS Code, JetBrains, Visual Studio, Eclipse, Zed,
Xcode, Neovim/Emacs/Sublime, ACP/headless and the TUI through those bindings.
The absent milestone adapters are injected ports, not production fakes.
