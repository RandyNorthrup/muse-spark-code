# M96CINT — scheduler, collisions, runners and Traffic integration

Worktree `/Users/randy/lanes/M96CINT`, branch `m96c/int`, macmini.

The partial-integration receipts below are round-1 history. The current
round-2 C/O integration, reconciliation note and receipts are recorded at
the end of this document.
Base `dfbedc5c`. Read the rig brief, shared `codex/common.md`, repository
rules, PLAN D75 and M96c in full (including T20–T29), and every available
0c/S/C/Q/O/T2/V certification record before integration.

Scope: reviewed S/Q, T2 and V, in that order, as `--no-ff` merge commits.
C and O are left for the lead. X2 runtime wiring, public documentation,
manifest commands, lazy bundle entry points and packaging are left for the
lead after integration with M96. No main merge, rebase, push, credential
access, dependency addition, network call or live/paid model call.

## S/Q merge and the Mac fixture correction

`m96c/sqfix` at `5febc7d2` merged without conflicts. The reviewed production
source is preserved. Initial complete owned suites passed Board/Pick/Review
42 tests, Retire/Stalls/Pool 29, and Landing/StagingCopy/GitIndexLock 49.
MergeQueue/Cleanup passed 14, while all four real-repository batch cases
failed on this case-insensitive Mac volume.

The batch fixture's `A.txt`/`B.txt` candidate names aliased the base's
`a.txt`/`b.txt`. This made the interaction predicate miss A, and changed
base files with no corresponding landing owner. Candidate paths now use
`candidate-A.txt` through `candidate-D.txt` in writes, check predicates,
owner maps and final-file assertions. This is a fixture portability fix,
not a change to queue or landing policy. No assertion, timeout or gate
was removed or weakened.

The original source failed naturally: green/culprit/dependency reported
`missing landing file owner`; interaction admitted C unexpectedly. The
restored complete MergeQueue/BatchRepository/Cleanup run passes 18/18.
Thus all 138 S/Q cases pass directly on macmini, in four invocations of
at most three complete files, with `--maxWorkers=3 --testTimeout=120000`.

## Exact S change to M96 lane A's teamPool.ts

At `dfbedc5c`, `src/core/team/teamPool.ts` does not exist. S adds the entire
261-line file, enclosed by `M96c scheduler region (lane S)` markers.
It contains no pool/accounting implementation or changes to A's selection.
Its production bytes are identical to `m96c/sqfix` at `5febc7d2`.
SHA-256: `a4f6bb57d4ce7c67eac733d8ed1c05f509e3b32f45c99ffc0e8f7f60710e6fc1`.

- Imports: scheduler tick/UI text, shared board/task/attempt types,
  `TaskBoard`, `TaskPicker`/`PickContext`/`SchedulerEntry`, and
  `SchedulerSlots`/`SlotRequest`.
- Exports: `SchedulerDependencies` and `TeamScheduler` only.
- Dependency callbacks: clock/context/headroom/exhaustion; synchronous
  lease admission; authorization; durable board journal; launch admission
  returning started/notStarted/uncertain; uncertainty recording; timer
  scheduling/failure handling; shared-agent overload cap reduction.
- Internal state: one picker, attempt-keyed leases, one sweep cancellation,
  one drain promise, wake and stopped flags. Construction starts nothing.
- Private methods: build the next-attempt slot request/key; check dispatch,
  launch and active-attempt eligibility; drain ready tasks without
  preemption. Drain reserves slots/leases, authorizes, rechecks state,
  begins/counts the attempt, journals before launch, and retains uncertain
  slots/leases after pause or launch failure. Process stagger time is
  recorded after launch admission completes; stale launch outcomes cannot
  resurrect retired attempts.
- Public methods: `startSweep`, `wake`, `retired`, `providerOverloaded`,
  `stopSweep`. `retired` requires recorded retirement before releasing a
  slot/lease, journals, then wakes. Stopping the sweep releases no worker.

The M96 merge must splice this marked region beside A's pool/accounting
region, retaining both exports/behavior and reconciling shared imports.
Do not replace A's whole file with this S-only file. Wire A's real ordered
headroom, attempt accounting and shared-agent ceilings through the required
callbacks at X2; do not infer accounting or retirement from the scheduler.

## Reviewed merges

The first merge is `c0552443`, with hooks enabled (lint/format and Gitleaks
passed). `m96c/t2fix` at `515b805d` conflicts only at the introductory M96c
paragraph in PLAN. Keep both the integration scope and T2's cancellation/
annotation correction record. The T2 §7 proof also survives. No source,
test or localization conflict occurs; S's final scheduler, helper and
regression files remain byte-identical to `m96c/sqfix` after the merge.

T2's three complete owned files pass 21/21 directly on macmini against the
final S board and shared test helper, including cancellation, journal
acknowledgement, local dependency defaults, atomic edge refusal and frozen
orchestrator/worker declarations.

The T2 merge is `4692dd58`, with hooks and Gitleaks passing.
`m96c/vfix` at `a9bf9060` also conflicts only in PLAN's M96c introduction.
Keep all three introductory records and V's named §9 integration residuals.
Every V source, test, translation and capture artifact merges unchanged;
no table conflict or generated-file conflict occurs. The fourteen real
translations and English keys are retained together.

V's handler/view/metrics files pass 79/79, and its harness file passes 1/1.
The same three-file run as the harness also passes 0c's schema/text tests,
29/29. All runs use the rig's prescribed flags and complete files.

The V merge is `258ad3d7`, with hooks and Gitleaks passing. Each merge has
two parents and the named reviewed lane tip as its second parent. C and O
were not merged. The final S, T2 and V production sources are unchanged
from their respective reviewed branches; only the Q fixture differs.

## Interface verification

- S, T2 and V use 0c's shared `TeamBoard`, task/attempt, event, write-lease
  and traffic metric schemas. All compiler projects and the focused
  shared-boundary tests pass together.
- S's synchronous `TaskBoard.reschedule` satisfies T2's
  `TeamRescheduleBoard` capability. T2 waits for an asynchronous adapter
  to acknowledge a durable journal when X2 supplies one. The final S board
  and its helper keep required terminal archive/read callbacks, archived
  attempt usage and open-only capacity semantics. Board SHA-256:
  `a8233e376b7f5023b5d2486299a80940e972b691e7c83b97451393979f1b3b0f`.
- Q's staging snapshots and landing lock ports compose through the real
  repository test adapters. Admission checks and landing use the exact
  final passing cumulative tree. T2's injected `TeamMergeEnqueue` must
  supply Q's reviewed admission and one-based position; enqueue does not
  invoke M96's former immediate merge. The concrete runtime binding is X2.
- T2 keeps the fixed tool declarations and base cancellation answer;
  scheduler/usage observations occur in tool answers. Constructing the
  declarations neither dispatches workers nor buys a model request.
- V consumes the shared board/metrics. X2's rank projection must map S's
  `priorityWeight`/`criticalPathFactor` to V's `priority`/`criticalPath`,
  and format Q's numeric queue reasons as localized strings.
  X2 also supplies nonreused identity/generation values and
  dispatch admission rechecks after asynchronous waits. V's handler
  confirmation remains separate from paid first-charge consent. Existing
  runner authorization and wiring residuals in PLAN §9 are retained.

No production interface change or runtime adapter was needed in this partial
merge. No uncaptured provider wire shape was introduced.

## Complete-file test receipts

All commands are `npx vitest run <files> --maxWorkers=3 --testTimeout=120000`,
directly on macmini. Files below are under `test/unit/`; no test was filtered
or skipped. These seven green runs total **268 tests in 21 files**:
239 owned S/Q/T2/V cases and 29 shared 0c cases.

| Complete files                                                                            | Passed |
| ----------------------------------------------------------------------------------------- | -----: |
| `teamSchedulerBoard.test.ts`, `teamSchedulerPick.test.ts`, `teamSchedulerReview.test.ts`  |     42 |
| `teamSchedulerRetire.test.ts`, `teamSchedulerStalls.test.ts`, `teamSchedulerPool.test.ts` |     29 |
| `teamLanding.test.ts`, `teamStagingCopy.test.ts`, `teamGitIndexLock.test.ts`              |     49 |
| `teamMergeQueue.test.ts`, `teamMergeBatchRepository.test.ts`, `teamCleanup.test.ts`       |     18 |
| `teamSchedulerTools.test.ts`, `teamSchedulerRoster.test.ts`, `teamServerToolList.test.ts` |     21 |
| `trafficHandlers.test.ts`, `trafficView.test.tsx`, `trafficMetrics.test.ts`               |     79 |
| `trafficHarness.test.tsx`, `teamSchedulerSchemas.test.ts`, `teamSchedulerText.test.ts`    |     30 |

## Integration drill

In addition to the natural four-case fixture failure above, temporarily
replace `trial(tree, candidate)` with `trial(initial, candidate)` in Q's
serial admission path. The complete real-repository batch file exits 1:
culprit, interaction and dependency fail (1 passes, 3 fail). Restore the
source in `finally`, compare SHA-256, and rerun the same complete file:
**4/4 pass**, exit 0. Before/after source SHA-256 is
`3345353d0fe50a04530d9601730e99bd698585db76092cad357150328ce28e4d`.
The portable fixture therefore detects lost cumulative admission, including
the interacting A/C changes, on this Mac volume. Machine-readable receipt:
`docs/certification/m96c-int-drills.json`. Existing lane drill artifacts are
retained unchanged.

## Final scoped gates

| Command                                          | Macmini result                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run typecheck`                              | Exit 0, all five projects                                                    |
| `npx tsc -p test/harness/tsconfig.json --noEmit` | Exit 0                                                                       |
| `npm run lint`                                   | Exit 0, ESLint and Stylelint; PowerShell analyzer platform-skipped on darwin |
| `npm run format:check`                           | Exit 0, full repository; final record changes checked separately             |
| `npm run deadcode`                               | Exit 0, plain knip; existing `vendor/**` ignore advisory only                |
| `npm run duplication`                            | Exit 0, 891 files, 0 clones                                                  |
| `npm run check:l10n`                             | Exit 0, 14 tables, 120 manifest strings, 454 source files, 0 problems        |
| `npm run cycles`                                 | Exit 0, 400 dependencies, 0 cycles                                           |
| Additional dpdm on merged S/Q/T2/V entry points  | Exit 0, 46 dependencies, 0 cycles                                            |
| `npm run build`                                  | Exit 0, all 17 caps, split checks, host globals, 83-package notices          |
| `git diff --check`                               | Exit 0                                                                       |

The additional dpdm command uses the same `--no-warning --no-tree
--exit-code circular:1 -T` gate options. Its roots are teamPool;
scheduler retire/stalls/reviewFlow; mergeQueue/teamMerge/teamWorkspaces;
host gitIndexLock/landingJournal/stagingCopy/teamCleanup; teamTools/roster;
teamMcpServer; trafficMetrics/modelsPanelTraffic; TrafficSurface/TrafficView;
and RunnersSection. This checks new code that X2 has yet to wire into the
production roots.

The extra common-rule `npm run check:host-api` check exits 1, **1 problem**:
the generated inventory needs the following updates. It still counts
271 VS Code APIs, 18 VS Code-importing files, 23 Node built-in kinds and
59 theme variables. No generated-file merge conflict occurred. The brief
excludes X2 documentation work, and the existing S/Q/V records assign this
file to X2, so it is left unchanged. This check is not claimed as passing.
X2 must run `npm run check:host-api -- --write` and review the diff.

| Inventory entry        | Recorded | Merged source |
| ---------------------- | -------: | ------------: |
| `node:buffer`          |       27 |            28 |
| `node:crypto`          |       32 |            34 |
| `node:fs/promises`     |       34 |            38 |
| `node:path`            |       65 |            70 |
| `node:timers/promises` |        3 |             5 |

The theme-source list must also add
`src/webview/components/traffic/traffic.css` beside `src/webview/styles.css`.
No threshold, rule, ignore, assertion or timeout was weakened.

## Production bundle bytes

| Artifact                   |  Bytes |   KiB / cap |
| -------------------------- | -----: | ----------: |
| `dist/extension.js`        | 604857 | 590.7 / 600 |
| `dist/modelApi.js`         | 440523 | 430.2 / 475 |
| `dist/review.js`           |  44218 |   43.2 / 50 |
| `dist/sessionBoard.js`     |  63551 |   62.1 / 75 |
| `dist/reviewer.js`         |  55924 |   54.6 / 75 |
| `dist/planMarkdown.js`     | 142363 | 139.0 / 150 |
| `dist/checkpointStore.js`  | 138960 | 135.7 / 225 |
| `dist/agentImport.js`      | 118451 | 115.7 / 125 |
| `dist/bundledSkills.js`    |  23452 |   22.9 / 50 |
| `dist/codeIntel.js`        |  78781 |  76.9 / 100 |
| `dist/voice.js`            |  35548 |   34.7 / 50 |
| `dist/museCodeReviewer.js` |  43776 |   42.8 / 75 |
| `dist/uiText.js`           | 114209 | 111.5 / 125 |
| `dist/searchWorker.js`     |  18571 |   18.1 / 50 |
| `dist/pageWorker.js`       | 208040 | 203.2 / 300 |
| `dist/webview/main.js`     | 887994 | 867.2 / 900 |
| `dist/acp.js`              | 820209 | 801.0 / 850 |

Webview CSS is 44036 bytes, without a separate size cap. All 17 production
metafiles have zero inputs from core/host team code, Traffic components,
modelsPanelTraffic or runner components. These are size receipts for the
currently shipped graph; final team/runner bundles and lazy-loading
certification remain X2 work after integration with M96.

Full `npm run quality`, C/O, native Windows/Linux containment,
installed-editor/golden/live acceptance, final runtime wiring, public docs,
manifest commands and packaging remain lead/X2 work under the rig brief.

## Round 2 — complete reviewed-lane integration

The round-2 rig brief authorizes reviewed C and then O, integration-only
repairs, generated host-API/notices reconciliation and the scoped gates.
It supersedes round 1's C/O deferral and host-API regeneration exclusion.
No main merge, rebase, push, dependency, credential access, network, live
model call or paid call is part of this lane. X2 wiring, public docs and
packaging remain for the M96 integration.

| Merge      | Reviewed second parent  | Resolution                                                                                                                                            |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8603fb41` | `m96c/cfix`, `52d04b69` | Three PLAN conflicts: retain S/Q/T2/V integration evidence and C's repair/scope/residual records together; add the round-2 scope before source edits. |
| `11f692a8` | `m96c/ofix`, `19bb0703` | Three PLAN conflicts: retain every existing record and O's repair/native-Windows/cache-supervisor residuals together.                                 |

Both commits have two parents and ran the normal hooks and staged Gitleaks.
No source, test or generated-file conflict occurred. O's English key and
all fourteen real translations merged cleanly beside V's keys;
`node scripts/check-l10n.mjs` reports 0 problems. Every C and O production
source and native helper remains byte-identical to its reviewed tip.

### Interface repair: both conflict attempts survive

C's reviewed `PredictedConflict` includes `otherAttempt` on task-pair
predictions. The shared strict `predictedConflict` event omitted that field,
so spreading a real C prediction into a scheduler event threw at S's
`TaskBoard.applyEvent`; omitting the field would lose C's reviewed symmetric
attempt identity. `src/shared/team.ts` now carries optional `otherAttempt`
with the existing positive-integer attempt schema. Integration-state
predictions continue to omit it. No provider wire shape or runtime binding
is added.

The new regression in `teamSchedulerRoster.test.ts` polls the real C
predictor, admits its events through the real S board, serializes T2's
roster answer and drains T2's state note. It verifies both task attempts,
a second prediction after B is reassigned to attempt 2, integration events
with no second attempt, and refusal of zero/negative/fractional attempts.
It failed naturally before the repair (1 failed, 4 passed, exit 1:
`unrecognized_keys: otherAttempt`), then the full schema/roster/predictor
trio passed 24/24. The source fix is one schema field; S/C/T2 retain their
reviewed implementations.

Two deliberate drills run the complete roster file: remove the field, and
accept unconstrained numeric attempts. Each fails the new named regression,
exit 1, then restores byte-exact with a SHA-256 comparison. The restored
file passes 5/5, exit 0. Permanent receipt:
`docs/certification/m96c-int-round2-drills.json`. Round 1's cumulative-batch
fixture and drill receipt remain intact. No guard, timeout or test was
weakened.

### Current lane-A-owned teamPool.ts reconciliation note

`teamPool.ts` is still exactly S's original 261-line scheduler region,
SHA-256 `a4f6bb57d4ce7c67eac733d8ed1c05f509e3b32f45c99ffc0e8f7f60710e6fc1`.
Neither C nor O creates or changes this file on its reviewed branch; neither
merge changes its imports, exports, callbacks or behavior. The detailed
round-1 region inventory above still applies. The M96 merge must splice
this marked scheduler region beside lane A's pool/accounting region and
reconcile imports, retaining both; never replace A's whole file with this
S-only version.

C now supplies the concrete `WriteSetLeases`/`SharedFiles` logic behind
S's required synchronous lease port. Bind acquisition to the next attempt,
retain the lease on uncertainty, and release only with the board's recorded
retirement or the existing host-owned decision. Supply one consistent
volume case policy, canonical repository scope, inherited family and
combined wait graph. O's check slots/runners do not change S's worker-slot
accounting: K still supplies journalled, credential-free launches and actual
retirement proof, and uncertain check ownership stays retained.

O's `engineWorker.ts` and `mcpBridge.ts` are also marked region-only files.
M96's W/B owners must splice their routing/`run_checks` regions into the
full worker/bridge implementations, retaining authentication, tool policy,
all final-command guards, cancellation/trust rechecks and M73 packing.
C's `teamConfig.ts` is only the shared-files schema shape, to compose into
M96's strict configuration reader. Those runtime bindings remain X2 work.

### Other verified seams and retained limits

- S board/task/attempt and C lease snapshots use 0c's shared types; T2's
  board capability and live schema retain them without changing base tool
  declarations or dispatching work.
- Q's injected structured-merge ports compose with C's strict JSON and
  changelog results; prediction and landing share Q's dispatch. Q's staging
  formatter port and C's post-format two-intent check remain explicit
  adapters; final formatted blobs must be captured before check admission.
- O configuration, routing and V's runner view share the same `Runner`
  schema, including O's translated native-length refusal. No manifest,
  build entry point or lazy-loading change is made here.
- V still requires X2's nonreused identity/generation projection and final
  dispatch admission after each asynchronous wait. Its rank and queue-reason
  projections, runner-save authorization, paid first-charge consent and
  single-model golden/zero-traffic checks remain as recorded in PLAN §9.
- O's two real PowerShell/parser/kernel tests remain unchanged and
  platform-gated in `runnerHelperNative.test.ts`; both skip on this Mac.
  The lead's Windows rig must run that whole file at the M96 merge.
  Source/fake-transport tests are not native Windows certification.
- O's independently killed cache supervisor can retain an exclusion lease;
  expiry is not retirement proof. The named conservative residual remains.

Initial merged-lane checks: C 52/52 across all five complete files; O 49/49
across its four portable files plus two existing native tests platform-skipped.
All use `--maxWorkers=3 --testTimeout=120000`, at most three files per run,
directly on macmini. Complete branch gate and bundle receipts follow in the
final round-2 checkpoint. X2's suggested Unreleased integration note is:
“Preserve both task attempt identities in scheduler conflict events.”

### Final round-2 complete-file test receipts

All eleven invocations run directly on macmini with at most three complete
files and `--maxWorkers=3 --testTimeout=120000`; JSON reporters write only
ignored receipts under `temp/m96c-int-round2/`. There are **384 passed,
0 failed, 2 existing platform-skipped tests in 32 files**. No test-name
filter, new skip or timeout change is used. Source checkpoint `47431f88`.

| Complete files under `test/unit/`                                                         | Passed | Platform skipped |
| ----------------------------------------------------------------------------------------- | -----: | ---------------: |
| `teamSchedulerBoard.test.ts`, `teamSchedulerPick.test.ts`, `teamSchedulerReview.test.ts`  |     42 |                0 |
| `teamSchedulerRetire.test.ts`, `teamSchedulerStalls.test.ts`, `teamSchedulerPool.test.ts` |     29 |                0 |
| `teamLanding.test.ts`, `teamStagingCopy.test.ts`, `teamGitIndexLock.test.ts`              |     49 |                0 |
| `teamMergeQueue.test.ts`, `teamMergeBatchRepository.test.ts`, `teamCleanup.test.ts`       |     18 |                0 |
| `teamSchedulerTools.test.ts`, `teamSchedulerRoster.test.ts`, `teamServerToolList.test.ts` |     22 |                0 |
| `trafficHandlers.test.ts`, `trafficView.test.tsx`, `trafficMetrics.test.ts`               |     79 |                0 |
| `trafficHarness.test.tsx`, `teamSchedulerSchemas.test.ts`, `teamSchedulerText.test.ts`    |     30 |                0 |
| `teamCollisions.test.ts`, `teamConflictPredict.test.ts`, `teamJsonTable.test.ts`          |     45 |                0 |
| `teamChangelog.test.ts`, `teamCollisionRepositories.test.ts`                              |      7 |                0 |
| `runnerRouting.test.ts`, `checkSlots.test.ts`, `bridgeChecks.test.ts`                     |     29 |                0 |
| `sshRunner.test.ts`, `runnerHelperNative.test.ts`, `l10n.test.ts`                         |     34 |                2 |

The portable totals are S 71, Q 67, T2 22 (including the new cross-lane
regression), V 80, C 52, O 49 and shared 0c/localization 43. Both native
skips are the original guarded cases in `runnerHelperNative.test.ts`.

### Final round-2 scoped gates

| Check                                    | Result                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`                      | Exit 0, all five projects on the final source                            |
| Harness TypeScript project               | Exit 0                                                                   |
| `npm run lint`                           | Exit 0, full ESLint/Stylelint; existing PSScriptAnalyzer skip on darwin  |
| `npm run format:check`                   | Exit 0, full repository; final certification edits checked separately    |
| `npm run deadcode`                       | Exit 0, plain knip; existing vendor ignore advisory only                 |
| `npm run duplication`                    | Exit 0, 915 files, 0 clones                                              |
| `npm run check:l10n`                     | Exit 0, 14 tables, 120 manifest strings, 468 source files, 0 problems    |
| `npm run cycles`                         | Exit 0, production roots, no cycles                                      |
| Additional merged-team dpdm roots        | Exit 0, S/C/Q/O/T2/V roots, no cycles; exact command in the JSON receipt |
| Host API regeneration and check          | Both exit 0, 0 problems                                                  |
| `npm run build`                          | Exit 0, all 17 unchanged caps, split/host-globals/notices gates          |
| Notices regeneration and recheck         | Both exit 0, 83 packages; generated bytes unchanged                      |
| `bash -n native/runner/runner-helper.sh` | Exit 0                                                                   |
| `git diff --check`                       | Exit 0                                                                   |

The host API inventory is regenerated only by
`npm run check:host-api -- --write`. Review confirms these seven Node
import-count updates and the Traffic stylesheet source; VS Code API and
Node/theme-kind totals remain 271/18/23/59. This closes the historical
round-1 inventory failure without changing the gate or its scope.

| Node built-in          | Recorded at round 1 | Combined source |
| ---------------------- | ------------------: | --------------: |
| `node:buffer`          |                  27 |              29 |
| `node:crypto`          |                  32 |              36 |
| `node:fs`              |                  24 |              25 |
| `node:fs/promises`     |                  34 |              40 |
| `node:path`            |                  65 |              73 |
| `node:timers/promises` |                   3 |               5 |
| `node:zlib`            |                   1 |               2 |

`node scripts/third-party-notices.mjs --write` regenerates from the final
production metafiles; the recheck passes and the generated notice is
byte-identical to the committed notice. No dependency or notice conflict
needs a manual edit.

### Final round-2 production bundle bytes

| Artifact                   |  Bytes | KiB / unchanged cap |
| -------------------------- | -----: | ------------------: |
| `dist/extension.js`        | 604857 |         590.7 / 600 |
| `dist/modelApi.js`         | 440523 |         430.2 / 475 |
| `dist/review.js`           |  44218 |           43.2 / 50 |
| `dist/sessionBoard.js`     |  63551 |           62.1 / 75 |
| `dist/reviewer.js`         |  55924 |           54.6 / 75 |
| `dist/planMarkdown.js`     | 142363 |         139.0 / 150 |
| `dist/checkpointStore.js`  | 138960 |         135.7 / 225 |
| `dist/agentImport.js`      | 118451 |         115.7 / 125 |
| `dist/bundledSkills.js`    |  23452 |           22.9 / 50 |
| `dist/codeIntel.js`        |  78781 |          76.9 / 100 |
| `dist/voice.js`            |  35548 |           34.7 / 50 |
| `dist/museCodeReviewer.js` |  43776 |           42.8 / 75 |
| `dist/uiText.js`           | 114329 |         111.6 / 125 |
| `dist/searchWorker.js`     |  18571 |           18.1 / 50 |
| `dist/pageWorker.js`       | 208040 |         203.2 / 300 |
| `dist/webview/main.js`     | 888114 |         867.3 / 900 |
| `dist/acp.js`              | 820209 |         801.0 / 850 |

Webview CSS is 44036 bytes, with no separate cap. All 17
production metafiles still have zero inputs from core/host team/runner code,
Traffic components/handler or runner components. These are receipts for the
current shipped graph. Final `team.js`/`teamRunners.js` wiring, lazy-load
proof, remeasurement and packaging remain X2 work after the M96 merge.

Permanent machine-readable receipt:
`docs/certification/m96c-int-round2-gates.json`. Raw command output remains
in ignored `temp/m96c-int-round2/`. Two round-2 guard drills and the natural
pre-fix failure are recorded separately; all original reviewed-lane and
round-1 drill artifacts remain intact. No gate, threshold, assertion,
ignore, test registration or native platform guard changed. The required
round-2 scope is complete; no full quality, native Windows, editor/live or
X2 product-wiring receipt is claimed by this branch.
