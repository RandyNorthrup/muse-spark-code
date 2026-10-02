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
import type { ToolIo } from '../backends/modelapi/tools'
import type { ContextIo } from '../context/contextFiles'
import type { CoreLogger } from '../logging'
import {
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
import { runEvalTurn, type EvalHostChange, type EvalTurnOutcome } from './driver'
import type {
  EvalArmReport,
  EvalFloorResult,
  EvalReport,
  EvalSplitSummary,
  EvalTaskResult,
} from './report'
import type { EvalTask } from './tasks'
import { createEvalWire, wireTotals, type EvalBudget, type EvalWire } from './wire'
import {
  createEvalWorkspace,
  evalWorkspaceFailureForReport,
  removeEvalWorkspace,
  runEvalVerifier,
  type EvalFolders,
} from './workspace'

export interface EvalArm {
  readonly name: string
  /** What the arm changes, for the report; absent on the baseline. */
  readonly mechanism?: string | undefined
  readonly change?: EvalHostChange | undefined
}

export interface EvalRunDeps {
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
  deps: EvalRunDeps,
  wire: EvalWire,
  folders: EvalFolders,
  failures: string[],
): Promise<EvalTurnOutcome | undefined> {
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
      },
      workspace: folders.workspace,
      prompt: task.prompt,
      change: arm.change,
    }),
  )
  await wire.settle()
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
  deps: EvalRunDeps,
  budget: EvalBudget,
  order: number,
): Promise<EvalTaskResult> {
  const wire = createEvalWire({ fetch: deps.fetch, baseUrl: deps.client.baseUrl, budget })
  const steps: string[] = []
  const folders = await step(
    'the workspace could not be made',
    steps,
    () => createEvalWorkspace(task),
    evalWorkspaceFailureForReport,
  )
  const outcome =
    folders === undefined ? undefined : await runInFolders(task, arm, deps, wire, folders, steps)
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
  return {
    taskId: task.id,
    title: task.title,
    split: task.split,
    passed: isPassed,
    terminal: outcome?.terminal ?? EVAL_TURN_NOT_RUN,
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
    costUsd: sum(sliced, (result) => result.costUsd),
  }
}

function floorFor(split: EvalSplit): number {
  return split === 'accept' ? EVAL_FLOOR_ACCEPT_PASS_RATE : EVAL_FLOOR_HELDOUT_PASS_RATE
}

function verdictOf(floors: readonly EvalFloorResult[]): EvalReport['verdict'] {
  if (floors.some((floor) => floor.tasks > 0 && !floor.held)) {
    return 'fail'
  }
  return floors.some((floor) => floor.tasks === 0) ? 'incomplete' : 'pass'
}

/** Runs the tasks on every arm (the first is the baseline) and builds the report. */
export async function runPairedEval(
  tasks: readonly EvalTask[],
  arms: readonly [EvalArm, ...EvalArm[]],
  deps: EvalRunDeps,
): Promise<EvalReport> {
  const budget: EvalBudget = { spentUsd: 0 }
  const runs = arms.map((arm) => ({ arm, results: [] as EvalTaskResult[] }))
  for (const [index, task] of tasks.entries()) {
    for (const [position, run] of runOrder(runs, index).entries()) {
      run.results.push(await runTask(task, run.arm, deps, budget, position + 1))
    }
  }
  const reports: EvalArmReport[] = runs.map(({ arm, results }) => ({
    name: arm.name,
    ...(arm.mechanism !== undefined && { mechanism: arm.mechanism }),
    results,
    summaries: EVAL_SPLITS.map((split) => summarize(split, results)),
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
  return {
    version: EVAL_REPORT_VERSION,
    model: EVAL_MODEL_ID,
    generatedAt: deps.generatedAt,
    arms: reports,
    floors,
    verdict: verdictOf(floors),
  }
}
