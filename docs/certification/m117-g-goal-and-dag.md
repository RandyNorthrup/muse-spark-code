# M117 G — goal resolution and DAG

Base: `7f43e600`, branch `m117/g`, Mac mini, 2026-10-06.

## Implementation plan and ownership

D97.2 and D97.5's DAG only: implement `src/core/estimator/goal.ts` and
`dag.ts`, with `estimatorGoal.test.ts` and `estimatorDag.test.ts`. No model,
network, paid call, new dependency, editor adapter or startup import is needed.
W owns the final lazy entry, budgets, reference registration and product docs.
The supplied lane rules prohibit merges, pushes and aggregate quality runs.

- Resolve all six frozen structured goal kinds against a validated, injected
  application snapshot. M113's plan reader and git/PR/issue/CI sources are
  absent on this base. Its eventual adapter supplies explicit associations;
  the estimator never guesses a lane from issue prose or a branch name.
- Include transitive prerequisites. Merged lanes satisfy dependencies and
  have no remaining work. Running lanes subtract measured active agent hours
  and retain the calibrated minimum supplied in the frozen lane contract.
- Combine rig affinity with existing constraints and normalized relative
  file paths. Incompatible constraints fail explicitly. Rig OS/architecture,
  machine class and GPU facts come from the injected rig catalog, allowing
  arbitrary rig names without hard-coded host assumptions.
- Compute a stable topological order, forward/backward times, critical path,
  downstream priority and slack. A duration map lets S analyze sampled
  durations; it must cover exactly the lanes and never revive merged work.
  These are dependency-only hours, not a resource-constrained schedule or
  P50/P90 forecast. Sort by code units, never locale or input order.
- Exercise chain, fan-out, diamond, affinity and repository-history fixtures,
  cross-process TZ/LANG determinism, default-timeout performance and byte-exact
  red drills for every guard and calculation.

## Named integration handoffs

- `M117-G-M113-snapshot`: bind the source port to the checked plan reader,
  explicit goal associations and captured source projections. Apply M96
  active agent time and C's calibrated minimum before projecting each lane.
  Open PR CI demand stays in the lane's resource contract. Unavailable data
  must fail the adapter or retain explicit unknown resource quantities;
  missing hour estimates cannot be invented to satisfy the lane schema.
- `M117-G-S-dag`: S consumes the resolved frozen lanes and DAG timing, and
  supplies its sampled remaining durations through the exact duration map.
- `M117-G-W-docs`: W owns CHANGELOG, help-reference registration, the final
  lazy chunk and split/budget checks. This core piece exposes no new command,
  setting or user-facing feature. All editor, ACP and headless surfaces use
  the same functions through U/W; no VS Code dependency is introduced.
- `M117-G-history-hours`: the M103/M104 fixture records dependencies and
  some git elapsed durations, but every original estimate is unavailable.
  Its topology can be certified; a measured critical-path duration cannot.
  Tests must label any substituted duration as a test assumption.

## Verification and red drills

All 59 deliberate mutations ran both complete owning Vitest files directly
on Mac mini with `--maxWorkers=3` and the repository default timeout. Each
exited 1 and failed its intended named regression; none depended on a compiler
or import failure. Every changed source was restored from saved bytes in
`finally` and its SHA-256 rechecked before the next drill. No production
mutation, suppressed gate, test-name filter, skip or raised timeout is retained.

The table names one actual failing regression per drill. G01–G08 cover source
identity/reference guards; G13 removes boundary parsing altogether. G14–G19
cover remaining work and dependency closure. G20–G33 cover affinity and paths.
G34–G39 cover stable ordering and association/graph bounds. D01–D10 cover DAG
validation; D11–D18 alter timing, slack, priority, critical flags, resources,
sampled durations and determinism. D14 divides durations by slots and proves
additional resources cannot shorten the dependency path. D18 adds a clock
read, and the same-input byte comparison fails. G40–G41 protect completed
work from future scheduling affinity, using the resolved merge evidence.

| Drill (deliberately bypassed or altered) | Observed named regression | Exit |
| ---------------------------------------- | ------------------------- | ---- |

| `G01-lane-identity` | validates unique identities and all references across plan/source projections | 1 |
| `G02-catalog-identities` | validates unique identities and all references across plan/source projections | 1 |
| `G03-source-identities` | validates unique identities and all references across plan/source projections | 1 |
| `G04-lane-associations` | refuses an invalid milestone-lane association in isolation | 1 |
| `G05-exact-milestone` | refuses an invalid milestone-namespace association in isolation | 1 |
| `G06-release-associations` | refuses an invalid release-milestone association in isolation | 1 |
| `G07-prerequisite-associations` | refuses an invalid prerequisite association in isolation | 1 |
| `G08-rig-associations` | refuses an invalid rig association in isolation | 1 |
| `G09-snapshot-time` | rejects stale snapshots, unavailable reads and malformed projected data | 1 |
| `G10-unknown-milestone` | rejects unknown goal M999 instead of estimating a partial success | 1 |
| `G11-unknown-label` | rejects unknown goal label:missing instead of estimating a partial success | 1 |
| `G12-unknown-custom-lane` | rejects unknown goal M112:missing instead of estimating a partial success | 1 |
| `G13-strict-source-parse` | rejects stale snapshots, unavailable reads and malformed projected data | 1 |
| `G14-merged-remainder` | computes remaining merged work with 0 active hours | 1 |
| `G15-running-floor` | computes remaining running work with 8 active hours | 1 |
| `G16-active-hours` | computes remaining running work with 3 active hours | 1 |
| `G17-merged-pr-evidence` | uses merged PR evidence and stops traversing satisfied prerequisites | 1 |
| `G18-prerequisite-closure` | resolves pr:12 with its transitive prerequisites | 1 |
| `G19-satisfied-edges` | uses merged PR evidence and stops traversing satisfied prerequisites | 1 |
| `G20-affinity-conflicts` | intersects explicit OS, architecture, class and GPU constraints rather than broadening them | 1 |
| `G21-ambiguous-architecture` | rejects contradictory architecture hints in a single builder path | 1 |
| `G22-unknown-architecture` | refuses unknown builder architecture for os/** | 1 |
| `G23-relative-paths` | rejects nonrelative file /Users/example/file instead of retaining a profile path | 1 |
| `G24-windows-separators` | derives file affinity without rig hints for native\windows\** | 1 |
| `G25-windows-affinity` | derives file affinity without rig hints for native\windows\** | 1 |
| `G26-darwin-affinity` | derives file affinity without rig hints for .\native\darwin\** | 1 |
| `G27-linux-affinity` | derives file affinity without rig hints for os/x64/** | 1 |
| `G28-x64-affinity` | derives file affinity without rig hints for os/x64/** | 1 |
| `G29-arm64-affinity` | derives file affinity without rig hints for os/arm64/** | 1 |
| `G30-gpu-kind` | infers OS and architecture from files without a rig and requires GPUs for GPU kinds | 1 |
| `G31-gpu-rig` | preserves GPU requirements from the rig and refuses contradictory native file constraints | 1 |
| `G32-rooted-files` | does not infer native or builder affinity from unrelated nested directories | 1 |
| `G33-dot-and-repeat-separators` | derives file affinity without rig hints for native//./windows/** | 1 |
| `G34-catalog-order` | returns stable goal bytes when source row and association order changes | 1 |
| `G35-graph-bound` | bounds the resolved graph without silently truncating lanes | 1 |
| `G36-code-unit-order` | marks both equal longest paths critical and picks a stable representative by lane ID | 1 |
| `D01-duplicate-lanes` | rejects duplicate identities, missing prerequisites, self edges and cycles | 1 |
| `D02-missing-prerequisite` | rejects duplicate identities, missing prerequisites, self edges and cycles | 1 |
| `D03-self-edge` | rejects duplicate identities, missing prerequisites, self edges and cycles | 1 |
| `D04-cycle` | rejects duplicate identities, missing prerequisites, self edges and cycles | 1 |
| `D05-duration-coverage` | requires exact sampled-duration coverage 0 | 1 |
| `D06-valid-duration` | rejects invalid sampled duration NaN | 1 |
| `D07-merged-duration` | never revives completed work or samples running work below its calibrated floor | 1 |
| `D08-running-duration-floor` | never revives completed work or samples running work below its calibrated floor | 1 |
| `D09-overflow` | rejects duration overflow and overlarge graphs instead of emitting invalid forecasts | 1 |
| `D10-graph-bound` | rejects duration overflow and overlarge graphs instead of emitting invalid forecasts | 1 |
| `D11-forward-critical-path` | matches the chain fixture critical path and forward/backward timing | 1 |
| `D12-backward-slack` | gives the diamond noncritical branch one hour of slack and downstream priority | 1 |
| `D13-numerical-slack` | handles fractional durations without false slack on critical nodes | 1 |
| `D14-resource-critical-path` | does not let slot, account or CI capacity shorten a dependency critical path | 1 |
| `D15-downstream-priority` | gives the diamond noncritical branch one hour of slack and downstream priority | 1 |
| `D16-sampled-durations` | honors an exact sampled remaining-duration map for scheduling simulations without mutation | 1 |
| `D17-completed-critical-flag` | returns a zero-duration empty or fully merged goal | 1 |
| `D18-clock-read` | produces identical bytes twice and in children with different TZ and LANG | 1 |
| `G37-association-uniqueness` | rejects duplicate references inside a milestone association | 1 |
| `G38-association-bound` | bounds association lists even when the selected goal is empty | 1 |
| `G39-release-uniqueness` | rejects duplicate references inside a release association | 1 |
| `G40-completed-affinity` | does not require scheduling affinity for already merged git work | 1 |
| `G41-resolved-merge-status` | does not require scheduling affinity for already merged pullRequest work | 1 |

Restored source hashes for the first 57 drills (identical within each file):

- `goal.ts`: `6dab7b47dea9e97b568aeefd1c6240b066216a1f33b3a55c8c247352073c6599`.
- `dag.ts`: `34ae9dd66a643b631430a1a19a82cb75bde424061aaf66ba3391d248daff7de1`.

The first exploratory golden run exposed incorrect test expectations for
M103/M104 endpoints and a fixture with dangling unrelated milestone refs.
The expectations were corrected by reading the captured dependency rows
(M103 ends at E, M104's longest unit-weight chain ends at H); the size fixture
now contains only its own milestone. These are fixture corrections, not
weakened checks or fabricated historical duration measurements.

## Final review correction

A new regression first failed on the committed implementation: a completed
lane with Windows, macOS and unknown-architecture builder files incorrectly
required future scheduling affinity. Only unfinished lanes now derive
scheduling affinity; completed records retain their declared source affinity.
Both git-merged and PR-merged evidence give zero remaining work without a
future machine requirement. File normalization and privacy validation still
apply to every returned record. G40 forces affinity derivation for completed
work; G41 reads the pre-projection state instead of resolved PR evidence.
Both fail the new named regression and restore `goal.ts` byte-exact to
`df449e3a6d2e4d95d390ee8bec1fb3d59e019471ce5fd059f6a08525bf75888d`.

The unchanged zero-duplication gate found three repeated test blocks. Shared
chain construction and snapshot resolution now live in the owned fixture
helper, and child-process results are compared together. The final contexts
use Asia/Kolkata (a fractional-hour zone) and Etc/GMT+12, with Turkish and
German language environments. Fakes stay under `test/**`; no gate is ignored.

Dag timing numbers are arithmetic on the projected remaining estimates or
S's samples. Determinism does not give them zero uncertainty. C/U/W must carry
the inputs' basis, samples and uncertainty through the frozen `disclosures`
index when producing a user-visible section. G introduces no forecast dates,
calibration claims, price, spending behavior or editor-only entry point.

## Scoped gate results

All commands below ran directly in this worktree on Mac mini, one heavy
process at a time. Final tests use the repository timeout, without
`--testTimeout`, skips or name filters.

| Check                                                                                          | Result                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run test/unit/estimatorGoal.test.ts test/unit/estimatorDag.test.ts --maxWorkers=3` | Exit 0; 97 tests: 72 goal, 25 DAG. Cross-process comparisons pass in two TZ/LANG contexts.                               |
| `npm run typecheck`                                                                            | Exit 0; all five projects on the final code.                                                                             |
| Scoped `npx eslint --max-warnings=0`                                                           | Exit 0 on both core files, both tests and the fixture helper; hooks also run ESLint.                                     |
| Scoped `npx prettier --check`                                                                  | Exit 0 on all six changed files; hooks also format them.                                                                 |
| `npm run deadcode`                                                                             | Exit 0; existing vendor/axe-core configuration hints only. No configuration changed.                                     |
| `npx jscpd`                                                                                    | Exit 0; zero clones across 1,192 files after sharing the repeated test setup. Threshold remains zero.                    |
| `node scripts/check-l10n.mjs`                                                                  | Exit 0; 14 tables, 166 manifest strings, 609 source files, zero problems. Existing translated estimator keys are reused. |
| `npm run check:reference`                                                                      | Exit 0; 53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI entries; generated reference current.          |
| `npm run check:host-api`                                                                       | Exit 0; zero problems.                                                                                                   |
| `npm run build`                                                                                | Exit 0; size, split, host-globals and third-party-notice checks all pass.                                                |
| Commit hooks                                                                                   | Exit 0 on implementation commits; ESLint, Prettier and staged gitleaks found no leaks.                                   |

Build measurements from the final Mac mini production build: extension
439.5 KiB / 600 KiB, Model API 446.9 KiB / 475 KiB, checkpoint store
76.9 KiB / 225 KiB, webview startup 797.1 KiB / 900 KiB, deferred webview
JavaScript 50.0 KiB / 50 KiB. These are measured artifact sizes, not forecasts;
no cap changed. G has no shipped entry yet: W still owns the estimator's
lazy chunk, production consumers and final integrated budget proof.

The final forty-lane fixture test took 20.4 ms including its setup and
assertions, a single measured Vitest sample with unknown timing uncertainty.
The timed goal/DAG operation passed the 2,000 ms bound. This certifies G on
Mac mini, not S's complete Monte Carlo engine or a cross-rig performance claim.
The final determinism test took 414.6 ms, likewise one measured sample with
unknown timing uncertainty; its bundle is built once in `beforeAll`.

Implementation commits: `03c52932` and `3083f719`, both with hooks enabled.
The first commit installs the resolver, DAG and regression/drill record; the
second fixes completed-work affinity and the duplication gate's findings.
Final certification is committed separately, also with hooks enabled.
No dependency was installed, credential read, live/paid/model call made,
cap weakened, branch merged/rebased or push performed. Only G's six files
changed. Scratch drill reports and logs are removed from the tight-disk rig.

Aggregate `npm run quality`, live M113/M96/C/S bindings, the final estimator
bundle, UI/editor and complete milestone acceptance remain with their named
owners. The brief expressly prohibits this lane from running aggregate quality;
these scoped receipts do not claim it passed. W also owns CHANGELOG and the
user-facing help/reference rows when the feature is wired. No new command,
setting or surface is registered by this library-only lane.
