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

## Remaining integration evidence

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

Interface verification and final scoped gate receipts follow
in the next checkpoint. Full `npm run quality`, native Windows/Linux
containment, installed-editor/golden/live acceptance and final production
team/runner bundle certification remain lead/X2 work under the rig brief.
