import { Usd, sumUsd } from '../../shared/usd'
// The M75 paired runner (PLAN.md D49): every task runs once per arm, task by
// task so both arms of a pair run under the same conditions. The arms take
// turns going first: a task's first run warms Meta's prompt cache with the
// system prompt and message every arm of that task sends, so a fixed order
// would credit the later arm with cached tokens it did not earn. Each run
// gets a fresh workspace, a fresh harness and its own trace; the verifier
// then judges the files the turn left. Each arm's pass rate per split is
// held against the capability floors fixed in advance, and an arm below
// either floor fails the run.

import { ModelApiClient, type ModelApiClientDeps } from '../backends/modelapi/client'
import plan from './plan.json'
import type { ToolIo } from '../backends/modelapi/tools'
import type { ContextIo } from '../context/contextFiles'
import type { CoreLogger } from '../logging'
import {
  EVAL_BUDGET_USD,
  EVAL_FLOOR_ACCEPT_PASS_RATE,
  EVAL_FLOOR_HELDOUT_PASS_RATE,
  EVAL_MODEL_ID,
  EVAL_REPORT_VERSION,
  EVAL_SPLITS,
  EVAL_TURN_COMPLETED,
  EVAL_TURN_NOT_RUN,
  EVAL_ROOT_MASK,
  type EvalSplit,
} from '../../shared/constants'
import {
  createEvalCompactionLedger,
  evalPaidUseFence,
  runEvalTurn,
  type EvalCompactionAdmission,
  type EvalHostChange,
  type EvalTurnOutcome,
} from './driver'
import type {
  EvalArmReport,
  EvalFloorResult,
  EvalReport,
  EvalSplitSummary,
  EvalTaskResult,
} from './report'
import { EVAL_TASKS, evalWindowTokens, type EvalTask } from './tasks'
import {
  EVAL_ARMS,
  freezeEvalHarness,
  type FrozenEvalHarness,
  frozenBundleChange,
} from './mechanisms'
import type { ArmBundle } from './armSources'
import { judgeArmBaseline, judgeArmDecision } from './mechanisms'
import { type JudgeFastReplayRecorder, type JudgeReplayRecorder } from './judgeReplay'
import type { JudgeAdvisory } from '../judge/use'
import type { JudgeFastTurnDecision } from '../../shared/judgeFastTurn'
import {
  createEvalWire,
  wireTotals,
  type EvalBudget,
  type EvalWire,
  type EvalWireTotals,
  type EvalWireTruncation,
} from './wire'
import {
  createEvalWorkspace,
  evalWorkspaceFailureForReport,
  removeEvalWorkspace,
  runEvalVerifier,
  type EvalFolders,
} from './workspace'

export interface EvalArm {
  readonly name: string
  /** Frozen program entry; source is bundled, never imported by the parent. */
  readonly program?: string | undefined
  /** What the arm changes, for the report; absent on the baseline. */
  readonly mechanism?: string | undefined
  readonly change?: EvalHostChange | undefined
}

/**
D107 (M125 lane V): the run's judge wiring. The recorders start empty
and the report carries their measurements; the advisory judges the
turns (a real `JudgeUse` on the live run, a scripted one on the fake
replay); the labels answer ground truth per run when an independent
labelling pass judged it (D77), and stay undefined otherwise.
*/
export interface EvalRunJudge {
  readonly recorder: JudgeReplayRecorder
  readonly fast: JudgeFastReplayRecorder
  readonly advisory?: JudgeAdvisory | undefined
  readonly labels?:
    ((taskId: string, decision: JudgeFastTurnDecision) => boolean | undefined) | undefined
}

export interface EvalRunDeps {
  /** The live entry's certified immutable snapshots, prepared before credentials. */
  readonly frozenHarness?: FrozenEvalHarness
  /** The judge wiring; absent, the run records no judge section. */
  readonly judge?: EvalRunJudge | undefined
  /** The network: the live `fetch`, or the fake Model API's. */
  readonly fetch: typeof fetch
  /** The client's settings but its `fetch`, which is each run's trace. */
  readonly client: Omit<ModelApiClientDeps, 'fetch'>
  /** The tools' file and shell access for one task's workspace. */
  readonly toolIo: (workspace: string) => ToolIo
  readonly contextIo: ContextIo
  readonly platform: NodeJS.Platform
  /** The key's SHA-256 digest; never the key. */
  readonly accountId: string
  readonly log: CoreLogger
  readonly now: () => number
  readonly newId: () => string
  readonly generatedAt: string
  /** Hard ceiling for model calls the run sends; the counted run sets it from its plan. */
  readonly maxAttempts?: number | undefined
  readonly maxTaskAttempts?: number | undefined
  readonly turnTimeoutMs?: number | undefined
  /** Looks at a run's folder before it is removed (the live run's key scan). */
  readonly inspect?: ((root: string) => Promise<void>) | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function turnFailures(outcome: EvalTurnOutcome): string[] {
  const failures = [...outcome.problems]
  if (outcome.terminal !== EVAL_TURN_COMPLETED) {
    const reason = outcome.reason === undefined ? '' : `: ${outcome.reason}`
    failures.unshift(`the turn ended ${outcome.terminal}${reason}`)
  }
  if (outcome.paidUses > 0) {
    failures.push(`${String(outcome.paidUses)} paid uses happened`)
  }
  return failures
}

/** One step of a task: an error fails that task, never the whole run. */
async function step<T>(
  what: string,
  failures: string[],
  run: () => Promise<T>,
  failureText: (error: unknown) => string = describe,
): Promise<T | undefined> {
  try {
    return await run()
  } catch (error: unknown) {
    failures.push(`${what}: ${failureText(error)}`)
    return undefined
  }
}

/** The turn, the verifier, the key scan and the removal, each a step of its own. */
async function runInFolders(
  task: EvalTask,
  arm: EvalArm,
  bundle: ArmBundle | undefined,
  deps: EvalRunDeps,
  wire: EvalWire,
  folders: EvalFolders,
  failures: string[],
  admission: EvalCompactionAdmission,
  ledger: ReturnType<typeof createEvalCompactionLedger>,
): Promise<EvalTurnOutcome | undefined> {
  const settledBefore = ledger.tally.settled
  const outcome = await step('the turn could not run', failures, () =>
    runEvalTurn({
      deps: {
        client: new ModelApiClient({ ...deps.client, fetch: wire.fetch }),
        io: deps.toolIo(folders.workspace),
        contextIo: deps.contextIo,
        platform: deps.platform,
        accountId: deps.accountId,
        log: deps.log,
        now: deps.now,
        newId: deps.newId,
        turnTimeoutMs: deps.turnTimeoutMs,
        admission,
        ...(deps.judge?.advisory !== undefined && { judge: deps.judge.advisory }),
      },
      workspace: folders.workspace,
      prompt: task.prompt,
      change: bundle === undefined ? arm.change : frozenBundleChange(bundle),
      // The window is harness condition, shared by both arms of the pair
      // (M101 R2): the evaluation window on a long-context task, the
      // shipped window otherwise.
      windowTokens: evalWindowTokens(task),
    }),
  )
  await wire.settle()
  const admitted = ledger.tally.settled - settledBefore
  if (admitted > 0) {
    deps.log.info(
      `Evaluation ${arm.name} ${task.id}: ${String(admitted)} admitted compaction ${admitted === 1 ? 'attempt' : 'attempts'} settled against the run budget`,
    )
  }
  if (outcome !== undefined) {
    failures.unshift(...turnFailures(outcome))
    const verdict = await step('the verifier could not run', failures, () =>
      runEvalVerifier(task, folders),
    )
    if (verdict?.passed === false) {
      failures.push(`the verifier failed: ${verdict.detail}`)
    }
  }
  await step('the folder could not be inspected', failures, async () => {
    await deps.inspect?.(folders.root)
  })
  await step('the folder could not be removed', failures, () => removeEvalWorkspace(folders.root))
  return outcome
}

async function runTask(
  task: EvalTask,
  arm: EvalArm,
  bundle: ArmBundle | undefined,
  deps: EvalRunDeps,
  budget: EvalBudget,
  order: number,
  admission: EvalCompactionAdmission,
  ledger: ReturnType<typeof createEvalCompactionLedger>,
): Promise<{ result: EvalTaskResult; truncated: readonly EvalWireTruncation[] }> {
  const callBudget =
    deps.maxTaskAttempts ?? plan.tasks.find((row) => row.id === task.id)?.callBudget
  const wire = createEvalWire({
    fetch: deps.fetch,
    baseUrl: deps.client.baseUrl,
    budget,
    maxAttempts: callBudget,
  })
  const ledgerBefore = { ...ledger.tally }
  const settledBefore = ledgerBefore.settled
  const steps: string[] = []
  const folders = await step(
    'the workspace could not be made',
    steps,
    () => createEvalWorkspace(task),
    evalWorkspaceFailureForReport,
  )
  const outcome =
    folders === undefined
      ? undefined
      : await runInFolders(task, arm, bundle, deps, wire, folders, steps, admission, ledger)
  // The report is committed: the temporary path (under the owner's
  // profile) is masked wherever a reason carries it.
  const root = folders?.root
  const failures = [
    ...steps,
    ...wire.refusals.map((reason) => `refused: ${reason}`),
    ...wire.problems,
  ].map((failure) =>
    root === undefined ? failure : failure.replaceAll(root, () => EVAL_ROOT_MASK),
  )
  const totals = wireTotals(wire)
  const isPassed = failures.length === 0
  deps.log.info(
    `Evaluation ${arm.name} ${task.id}: ${isPassed ? 'passed' : 'failed'} after ${String(totals.attempts)} attempts`,
  )
  recordJudgeRun(deps.judge, task, arm, outcome, totals, isPassed)
  // Released D78 claims remain attempt evidence; accepted history replacement
  // and its known settlement are recorded independently below.
  const compactionsSettled = ledger.tally.settled - settledBefore
  return {
    result: {
      taskId: task.id,
      title: task.title,
      split: task.split,
      passed: isPassed,
      terminal: outcome?.terminal ?? EVAL_TURN_NOT_RUN,
      ...(outcome?.turnWallMs !== undefined && { wallMs: outcome.turnWallMs }),
      failures,
      attempts: totals.attempts,
      requests: totals.requests,
      inputTokens: totals.inputTokens,
      cachedTokens: totals.cachedTokens,
      outputTokens: totals.outputTokens,
      costUsd: totals.costUsd,
      toolCalls: outcome?.tools.length ?? 0,
      approvals: outcome?.approvals ?? 0,
      questions: outcome?.questions ?? 0,
      paidRefusals: outcome?.paidRefusals ?? 0,
      order,
      ...(outcome?.packedTokensAvoided !== undefined && {
        packedTokensAvoided: outcome.packedTokensAvoided,
      }),
      recalls: outcome?.recalledOutputs.length ?? 0,
      compactionsSettled,
      compactionsApplied: outcome?.compactionsApplied ?? 0,
      ...(callBudget !== undefined && { callBudget }),
      overBudget: wire.isOverBudget,
      compactionsAttempted: ledger.tally.started - ledgerBefore.started,
      compactionLedger: {
        reservedUsd: Usd.from(ledger.tally.reservedUsd)
          .subtract(Usd.from(ledgerBefore.reservedUsd))
          .toAmount(),
        settledUsd: Usd.from(ledger.tally.settledUsd)
          .subtract(Usd.from(ledgerBefore.settledUsd))
          .toAmount(),
        outstandingUsd: ledger.tally.outstandingUsd,
        retainedUsd: Usd.from(ledger.tally.retainedUsd)
          .subtract(Usd.from(ledgerBefore.retainedUsd))
          .toAmount(),
      },
      requestEvidence: wire.calls.flatMap((call) =>
        call.requestEvidence === undefined ? [] : [call.requestEvidence],
      ),
    },
    truncated: wire.truncated,
  }
}

/** The arms in the order they run the task at `index`: each task starts one arm further on. */
function runOrder<T>(runs: readonly T[], index: number): T[] {
  const first = index % runs.length
  return [...runs.slice(first), ...runs.slice(0, first)]
}

function sum(results: readonly EvalTaskResult[], pick: (result: EvalTaskResult) => number) {
  let total = 0
  for (const result of results) {
    total += pick(result)
  }
  return total
}

function summarize(split: EvalSplit, results: readonly EvalTaskResult[]): EvalSplitSummary {
  const sliced = results.filter((result) => result.split === split)
  const passed = sliced.filter((result) => result.passed).length
  return {
    split,
    tasks: sliced.length,
    passed,
    passRate: sliced.length === 0 ? 0 : passed / sliced.length,
    attempts: sum(sliced, (result) => result.attempts),
    requests: sum(sliced, (result) => result.requests),
    inputTokens: sum(sliced, (result) => result.inputTokens),
    cachedTokens: sum(sliced, (result) => result.cachedTokens),
    outputTokens: sum(sliced, (result) => result.outputTokens),
    costUsd: sumUsd(...sliced.map((result) => result.costUsd)),
  }
}

function floorFor(split: EvalSplit): number {
  return split === 'accept' ? EVAL_FLOOR_ACCEPT_PASS_RATE : EVAL_FLOOR_HELDOUT_PASS_RATE
}

/**
The frozen full arm set, by name: a run that covered anything else (a
missing arm, an extra arm) decided nothing, whatever its floors say.
*/
function isFrozenArmSet(arms: readonly EvalArm[]): boolean {
  return (
    arms.length === EVAL_ARMS.length &&
    EVAL_ARMS.every((expected) => arms.some((arm) => arm.name === expected.name))
  )
}

function verdictOf(
  floors: readonly EvalFloorResult[],
  incompleteReasons: readonly string[],
): EvalReport['verdict'] {
  // A truncated run decided nothing: refusals manufacture failures, so the
  // missing sends are neither a pass nor a fail, whatever the floors say.
  if (incompleteReasons.length > 0) {
    return 'incomplete'
  }
  if (floors.some((floor) => floor.tasks > 0 && !floor.held)) {
    return 'fail'
  }
  return floors.some((floor) => floor.tasks === 0) ? 'incomplete' : 'pass'
}

/** The receipt's words for why the run stopped before every task could send. */
function stopReason(code: EvalWireTruncation, budget: EvalBudget): string {
  switch (code) {
    case 'call-ceiling': {
      return `the run stopped at its call ceiling of ${String(budget.maxAttempts)} model calls`
    }
    case 'budget-spent': {
      return `the run stopped after its budget of $${EVAL_BUDGET_USD.toFixed(2)} was spent`
    }
    case 'unknown-usage': {
      return 'the run stopped because a sent model call has unknown usage'
    }
  }
}

/**
D107 (M125 lane V): one arm's run of one task into the judge recorders.
The arm row carries the turn's own numbers. The decision row carries
the arm's isolated decision alone: other decisions are pinned off on a
judge arm, so their tallies would dilute that decision's own pair.
Fence samples arrive separately, through the advisory's `onFence`,
which the harness binds to the run's recorder.
*/
function recordJudgeRun(
  judge: EvalRunJudge | undefined,
  task: EvalTask,
  arm: EvalArm,
  outcome: EvalTurnOutcome | undefined,
  totals: EvalWireTotals,
  isPassed: boolean,
): void {
  if (judge === undefined || outcome === undefined) return
  const backend = 'modelApi'
  const model = EVAL_MODEL_ID
  judge.fast.recordArm({
    backend,
    model,
    arm: arm.name,
    taskId: task.id,
    passed: isPassed,
    wallMs: outcome.turnWallMs,
    attempts: totals.attempts,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    recalls: outcome.recalledOutputs.length,
    failed: outcome.terminal === 'failed',
  })
  const isolated = judgeArmDecision(arm.name)
  if (isolated === undefined) return
  let isActed = false
  let applied = 0
  let evaluated = 0
  for (const turn of outcome.fastTurns) {
    for (const entry of turn.decisions) {
      if (entry.decision !== isolated) continue
      evaluated += 1
      if (!entry.acted) {
        continue
      }

      isActed = true
      applied += 1
    }
  }
  if (evaluated === 0) return
  const shouldFire = judge.labels?.(task.id, isolated)
  judge.fast.recordDecision({
    backend,
    model,
    arm: arm.name,
    taskId: task.id,
    decision: isolated,
    acted: isActed,
    appliedTurns: applied,
    evaluatedTurns: evaluated,
    ...(shouldFire !== undefined && { shouldFire }),
  })
}

/** Runs the tasks on every arm (the first is the baseline) and builds the report. */
export async function runPairedEval(
  tasks: readonly EvalTask[],
  arms: readonly [EvalArm, ...EvalArm[]],
  deps: EvalRunDeps,
): Promise<EvalReport> {
  const budget: EvalBudget = {
    spentUsd: Usd.from(0).toAmount(),
    ...(deps.maxAttempts !== undefined && { maxAttempts: deps.maxAttempts }),
  }
  // Lane E's spend authority for the run: the real shared D78 admission
  // over a ledger against this budget. Launching the counted run is the
  // opt-in, so its consent admits; every admitted attempt is trace-counted
  // and settled here, and the fence revokes once the budget is spent or a
  // sent call's bill is unknown.
  const ledger = createEvalCompactionLedger(budget)
  const admission: EvalCompactionAdmission = {
    ledger,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => {
      ledger.tally.started += 1
    },
    paidUseFence: () => evalPaidUseFence(budget),
    dailyBudgetUsd: () => Usd.from(EVAL_BUDGET_USD).toAmount(),
  }
  const frozen = deps.frozenHarness ?? freezeEvalHarness(arms, tasks)
  if (frozen.selection !== JSON.stringify({ arms: arms.map((arm) => arm.name), tasks }))
    throw new Error('the frozen evaluation selection does not match the run')
  if (deps.judge !== undefined) {
    for (const arm of arms) {
      if (judgeArmDecision(arm.name) !== undefined)
        deps.judge.fast.pair(arm.name, judgeArmBaseline(arm.name))
    }
  }
  const runs = arms.map((arm) => ({
    arm,
    bundle: frozen.bundles.get(arm.name),
    results: [] as EvalTaskResult[],
  }))
  const stoppedEarly: string[] = []
  for (const [index, task] of tasks.entries()) {
    for (const [position, run] of runOrder(runs, index).entries()) {
      const finished = await runTask(
        task,
        run.arm,
        run.bundle,
        deps,
        budget,
        position + 1,
        admission,
        ledger,
      )
      run.results.push(finished.result)
      for (const code of finished.truncated) {
        const reason = stopReason(code, budget)
        if (!stoppedEarly.includes(reason)) {
          stoppedEarly.push(reason)
        }
      }
    }
  }
  if (budget.hasUnknownUsage === true) {
    const reason = stopReason('unknown-usage', budget)
    if (!stoppedEarly.includes(reason)) stoppedEarly.push(reason)
  }
  if (Usd.from(budget.spentUsd).compare(Usd.from(EVAL_BUDGET_USD)) >= 0) {
    const reason = stopReason('budget-spent', budget)
    if (!stoppedEarly.includes(reason)) stoppedEarly.push(reason)
  }
  const reports: EvalArmReport[] = runs.map(({ arm, results }) => ({
    name: arm.name,
    ...(arm.mechanism !== undefined && { mechanism: arm.mechanism }),
    results,
    summaries: EVAL_SPLITS.map((split) => summarize(split, results)),
    compactionLedger: {
      reservedUsd: sumUsd(
        ...results.map((result) => result.compactionLedger?.reservedUsd ?? Usd.from(0).toAmount()),
      ),
      settledUsd: sumUsd(
        ...results.map((result) => result.compactionLedger?.settledUsd ?? Usd.from(0).toAmount()),
      ),
      outstandingUsd: sumUsd(
        ...results.map(
          (result) => result.compactionLedger?.outstandingUsd ?? Usd.from(0).toAmount(),
        ),
      ),
      retainedUsd: sumUsd(
        ...results.map((result) => result.compactionLedger?.retainedUsd ?? Usd.from(0).toAmount()),
      ),
    },
  }))
  const floors: EvalFloorResult[] = reports.flatMap((arm) =>
    arm.summaries.map((summary) => {
      const floor = floorFor(summary.split)
      return {
        arm: arm.name,
        split: summary.split,
        tasks: summary.tasks,
        passRate: summary.passRate,
        floor,
        held: summary.tasks > 0 && summary.passRate >= floor,
      }
    }),
  )
  const incompleteReasons = [...stoppedEarly]
  if (
    tasks.length !== EVAL_TASKS.length ||
    EVAL_TASKS.some((task) => tasks.every((candidate) => candidate.id !== task.id))
  ) {
    incompleteReasons.push('narrowed selection')
  }
  if (floors.some((floor) => floor.tasks === 0)) incompleteReasons.push('empty split')
  if (!isFrozenArmSet(arms)) incompleteReasons.push('arm set differs from the frozen arms')
  if (frozen.bundles.size !== arms.length)
    incompleteReasons.push('bundle count differs from the arm count')
  return {
    version: EVAL_REPORT_VERSION,
    model: EVAL_MODEL_ID,
    generatedAt: deps.generatedAt,
    ...(frozen.bundles.size === arms.length && { harnessDigest: frozen.sha256 }),
    arms: reports,
    ...(deps.judge !== undefined && {
      judge: {
        fence: [...deps.judge.recorder.measurements()],
        fast: deps.judge.fast
          .measurements()
          .map((measured) => ({ ...measured, blockedBy: [...measured.blockedBy] })),
      },
    }),
    compactionLedger: {
      reservedUsd: ledger.tally.reservedUsd,
      settledUsd: ledger.tally.settledUsd,
      outstandingUsd: ledger.tally.outstandingUsd,
      retainedUsd: ledger.tally.retainedUsd,
    },
    floors,
    ...(stoppedEarly.length > 0 && { stoppedEarly }),
    ...(incompleteReasons.length > 0 && { incompleteReasons }),
    verdict: verdictOf(floors, incompleteReasons),
  }
}
