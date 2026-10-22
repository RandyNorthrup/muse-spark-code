# M96 catch review (RLM96 recovery lane, 2026-10-22)

Landing `src/RLM96/01-ms-msm96` adds M96's `src/core/team`,
`src/host/team` and related call sites. The source branch never ran
`npm run check:catches` (it has no `scripts/catch-baseline.json`), so
every debt-class site below is new against HEAD's baseline. Each site
was read (not guessed from the snippet) and judged against AGENTS.md
rule 18: a catch handles a named condition or reports. Fixes first,
then `node scripts/catch-inventory.mjs --write-baseline` records the
reviewed remainder. `npm run check:catches` exits 0 after the regen.

## Fixed in this lane

- `src/core/team/workers/acpWorker.ts:273` (`acpFsWrite`) — the merge
  had dropped the `input.role` argument, breaking every worker write
  (5 real-code test failures, fixed). The restored catch returns typed
  refusal values, so the classifier still reads GENERIC; the rewrite
  additionally rethrows non-`Error` throws instead of stringifying
  them. All failures reach the caller as the same typed sentences the
  `teamWorkerCreate` suite asserts.
- `src/host/teamHostBinding.ts:135` — the bundle-load catch
  interpolated the raw error message into `log.warn`. Now a fixed
  sentence, the `lazyBundle.ts` convention; no bundle path reaches the
  log. No test asserted the old text.
- `src/core/resources/commands.ts:313` — best-effort limits report;
  reason comment added (CLEANUP).
- `src/host/providers/credentialRecords.ts:160` (`providerKeyDigest`)
  — unreadable credential keeps legacy unattributed matching per the
  function's own doc comment; reason comment added (CLEANUP).
- `src/host/team/teamEnginePorts.ts:588` — failed `rev-parse` leaves
  the expected commit unknown and the ref check below refuses the
  merge as a moved ref; reason comment added (CLEANUP).
- `src/core/team/teamHost.ts:1132` — admission refusal stops the drain
  (`break`); a later open or reload retries the queue. Reason comment
  added (CLEANUP).

## Reviewed, kept, recorded (rule-18 reporters)

Each handler below records the failure where its caller handles it
(task record, merge card, typed refusal, promise rejection, warning or
rethrow after best-effort teardown). Narrowing any of them with an
`instanceof` rethrow would change behavior: a non-`Error` from worker
bodies must still fail the task, and a helper refusal must still become
its typed sentence.

- `src/core/resources/commands.ts:291` — a failed governed stop
  rejects the tree's outcome with its own typed error.
- `src/core/team/teamHost.ts:1173,1204,1605,1725` — worker-body,
  launch, reserve and stop failures land in `finish`/task
  failure/persisted record or the collect answer's `refused` slot.
- `src/core/team/teamHost.ts:1509` — missing lazy merge chunk marks
  the card failed with its reason and refuses without hanging.
- `src/core/team/teamHost.ts:1676` — a persist failure warns; the
  durable `saveFailure` in `persist`/`observe` is the record admission
  refusals carry. Same pattern as the baselined `persist` site.
- `src/core/team/teamHost.ts:1858`, `src/core/team/workers/workerCreateEntry.ts:150`,
  `src/core/team/workers/workerOps.ts:434,446,450,488,504,511,579,582`,
  `src/core/team/workers/workerToolIo.ts:217`,
  `src/host/team/teamEnginePorts.ts:268` — best-effort teardown with
  the reason in place (CLEANUP).
- `src/core/team/teamMergeFlow.ts:237` — merge failure lands in the
  task record and the merge card.
- `src/core/team/teamTry.ts:156,169` — turn failure rejects the
  `sendTurn` promise with a normalized `Error`; the outer catch keeps
  the failure the `finally` close runs under.
- `src/core/team/workers/workerCreateEntry.ts:147,219,233,258`,
  `src/core/team/workers/workerOps.ts:559,604` — helper/git/refusal
  outcomes become `changed` statuses, kept records or the typed
  `TeamGitError`/role-denied errors the fence handles.
- `src/extension.ts:3085` — a budget-scope failure throws the typed
  `teamBudgetUnavailable` refusal the worker entry documents.
- `src/host/conversation/conversationController.ts:5432,8016,9983` —
  effort-not-applied warning, restricted-start refusal, attachment
  rejection; each names its condition.
- `src/host/team/teamEnginePorts.ts:535` — a task-made copy is removed
  on failure (reason in place) and the error is rethrown.

## Counts

Regenerated baseline reflects the reviewed tree; every SWALLOW,
GENERIC and CLEANUP site above is listed by identity. No NARROW or
REPORTED site changed class.
