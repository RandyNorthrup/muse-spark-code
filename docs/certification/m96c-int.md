# M96CINT — partial scheduler and Traffic integration

Worktree `/Users/randy/lanes/M96CINT`, branch `m96c/int`, macmini.
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
