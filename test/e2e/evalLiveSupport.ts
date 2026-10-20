// The live harnesses use the ACP agent's existing OS credential entry in
// this process. No key comes from arguments, environment or a fixture file.
// Native entry access is deferred until the owner enables the live test.

import { Usd } from '../../src/shared/usd'
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import type { EvalReport } from '../../src/core/eval/report'
import { EVAL_TASKS, type EvalTask } from '../../src/core/eval/tasks'
import { listWorkspaceFiles } from '../../src/core/eval/workspace'
import {
  CredentialStore,
  isValidModelApiKey,
  type SecretStore,
} from '../../src/host/auth/credentialStore'
import { createToolIo } from '../../src/host/backend/toolIo'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { keyringSecretStore } from '../../src/runtime/keyStore'
import {
  EVAL_REPORT_VERSION,
  EVAL_TURN_TIMEOUT_MS,
  EVAL_VERIFY_TIMEOUT_MS,
} from '../../src/shared/constants'

const LEGACY_KEY_VARIABLE = 'MUSE_LIVE_MODEL_API_KEY'
const NOT_ENABLED = 'Live Model API tests are not enabled.'
const STORE_UNAVAILABLE =
  'No Model API key is available from the operating system credential store. Use muse-spark-code-acp auth set before enabling live tests.'

/**
Reject the old transport without reading, echoing or deleting its value.
Only an enabled run starts processes the model steers, so only it refuses:
a stale variable must not fail the default test run, which collects these files.
*/
export function assertNoLiveKeyEnvironment(env: NodeJS.ProcessEnv, isEnabled: boolean): void {
  if (isEnabled && Object.hasOwn(env, LEGACY_KEY_VARIABLE)) {
    throw new Error(
      'MUSE_LIVE_MODEL_API_KEY is not supported. Remove that environment variable and use muse-spark-code-acp auth set for the operating system credential store.',
    )
  }
}

export interface EvalLiveCredentials {
  readonly accountId: string
  readonly apiKey: () => Promise<string | undefined>
  readonly redact: (text: string) => string
  readonly contains: (value: string | Uint8Array) => boolean
}

async function liveSecretStore(): Promise<SecretStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  return keyringSecretStore(
    (service, account) => new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
  )
}

/** One live run stays bound to its initial stored account; replacement stops admission. */
export async function loadEvalLiveCredentials(
  isEnabled: boolean,
  secrets?: SecretStore,
): Promise<EvalLiveCredentials> {
  if (!isEnabled) {
    throw new Error(NOT_ENABLED)
  }
  let credentials: CredentialStore
  let key: string
  try {
    credentials = new CredentialStore(
      secrets ?? (await liveSecretStore()),
      () => {
        // Native error text is replaced by the fixed failure below, never logged.
      },
      'the operating system credential store',
    )
    const stored = await credentials.getApiKey()
    if (stored === undefined || !isValidModelApiKey(stored)) {
      throw new Error(STORE_UNAVAILABLE)
    }
    key = stored.trim()
  } catch {
    throw new Error(STORE_UNAVAILABLE)
  }
  const needle = Buffer.from(key)
  return {
    accountId: createHash('sha256').update(key).digest('hex'),
    apiKey: async () => {
      try {
        const current = await credentials.getApiKey()
        return current?.trim() === key ? key : undefined
      } catch {
        return undefined
      }
    },
    redact: (text) => text.replaceAll(key, '[key]'),
    contains: (value) =>
      typeof value === 'string' ? value.includes(key) : Buffer.from(value).includes(needle),
  }
}

export interface LiveToolIoOptions {
  readonly workspace: string
  /** The process's environment, read per command as the extension does. */
  readonly env: () => NodeJS.ProcessEnv
  /** The built search worker (`npm run build:dev`). */
  readonly searchWorkerPath: string
  readonly log: (message: string) => void
  /** Windows: the job helper's assembly (M27); undefined elsewhere. */
  readonly shellJobAssembly: (() => Promise<string | undefined>) | undefined
}

/**
The tools' file and shell access for a live harness. A shell command the
model asks for is allowed without a person reading it, so it gets the
environment without any credential variable (`*_API_KEY` and the named
ones), as every process the ACP agent starts does: another provider's key
the owner keeps in his shell must not reach a tool's output, Meta or the
report.
*/
export function liveToolIo(options: LiveToolIoOptions): ToolIo {
  return createToolIo({
    platform: process.platform,
    listFiles: () => listWorkspaceFiles(options.workspace),
    systemRoot: process.env['SystemRoot'],
    env: () => withoutCredentials(options.env()),
    searchWorkerPath: options.searchWorkerPath,
    log: options.log,
    unsavedFiles: () => [],
    shellJobAssembly: options.shellJobAssembly,
  })
}

const selectionSchema = z.object({
  MUSE_EVAL_TASKS: z.optional(z.string()),
  MUSE_EVAL_REPORT: z.optional(z.string()),
  MUSE_EVAL_MAX_ATTEMPTS: z.optional(z.string()),
})

export interface LiveEvalSelection {
  /** The tasks MUSE_EVAL_TASKS names, in task-set order; every task when it is unset. */
  readonly tasks: readonly EvalTask[]
  /** MUSE_EVAL_REPORT: a path without extension for the report's .json and .md. */
  readonly reportPath: string | undefined
  /** MUSE_EVAL_MAX_ATTEMPTS: the run's hard call ceiling; budget-only when unset. */
  readonly maxAttempts: number | undefined
}

/**
What an enabled live run evaluates; an unknown task id stops it. Read only
inside the enabled test, never while the suite is skipped: a stale or
mistyped selection must not fail the default run, which collects this file.
*/
export function liveEvalSelection(env: NodeJS.ProcessEnv, isEnabled: boolean): LiveEvalSelection {
  if (!isEnabled) {
    throw new Error(NOT_ENABLED)
  }
  const selection = selectionSchema.parse({
    MUSE_EVAL_TASKS: env['MUSE_EVAL_TASKS'],
    MUSE_EVAL_REPORT: env['MUSE_EVAL_REPORT'],
    MUSE_EVAL_MAX_ATTEMPTS: env['MUSE_EVAL_MAX_ATTEMPTS'],
  })
  const wanted = (selection.MUSE_EVAL_TASKS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const unknown = wanted.filter((id) => EVAL_TASKS.every((task) => task.id !== id))
  if (unknown.length > 0) {
    throw new Error(`unknown eval tasks: ${unknown.join(', ')}`)
  }
  const ceiling = selection.MUSE_EVAL_MAX_ATTEMPTS
  const maxAttempts = ceiling === undefined ? undefined : Number(ceiling)
  if (maxAttempts !== undefined && (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)) {
    throw new Error('MUSE_EVAL_MAX_ATTEMPTS must be a positive integer.')
  }
  return {
    tasks: wanted.length === 0 ? EVAL_TASKS : EVAL_TASKS.filter((task) => wanted.includes(task.id)),
    reportPath: selection.MUSE_EVAL_REPORT,
    maxAttempts,
  }
}

/**
The long-output tasks on which an arm never sent a packed placeholder
(M73): a packing run that passes its floors without packing proves
nothing about packing, so its acceptance needs every one of them to have
packed. The arm missing from the report counts as never engaged.
*/
/** One arm's saved results; an arm missing from the report counts as never engaged. */
function armResults(report: EvalReport, armName: string) {
  return report.arms.find((arm) => arm.name === armName)?.results ?? []
}

export function unengagedLongOutputTasks(
  report: EvalReport,
  armName: string,
  tasks: readonly EvalTask[],
): string[] {
  const results = armResults(report, armName)
  return tasks
    .filter((task) => task.isLongOutput === true)
    .filter((task) => {
      const saved = results.find((result) => result.taskId === task.id)?.packedTokensAvoided
      return saved === undefined || saved <= 0
    })
    .map((task) => task.id)
}

function engagementVerdict(
  verdict: EvalReport['verdict'],
  isHeld: boolean,
  taskCount: number,
): EvalReport['verdict'] {
  if (isHeld || verdict === 'incomplete') return verdict
  return taskCount === 0 ? 'incomplete' : 'fail'
}

/**
The report with M73's packing acceptance recorded in it (PLAN.md M73):
the arm's engagement on the run's long-output tasks, and the verdict
`fail` when it never packed on one, whatever the floors say. A selection
with no long-output task holds nothing: a `pass` becomes `incomplete`,
never stays a pass for want of evidence. Applied before the report is
printed or written, so both artifacts say what the run's acceptance
decided.
*/
export function withPackingEngagement(
  report: EvalReport,
  armName: string,
  tasks: readonly EvalTask[],
): EvalReport {
  if (report.version !== EVAL_REPORT_VERSION) {
    throw new Error('Packing engagement is recorded only in a current-version report.')
  }
  const longTasks = tasks.filter((task) => task.isLongOutput === true).map((task) => task.id)
  const unengaged = unengagedLongOutputTasks(report, armName, tasks)
  // An empty list is not held: nothing ran to engage on.
  const isHeld = longTasks.length > 0 && unengaged.length === 0
  return {
    ...report,
    packingEngagement: {
      arm: armName,
      longOutputTasks: longTasks,
      unengaged,
      held: isHeld,
    },
    verdict: engagementVerdict(report.verdict, isHeld, longTasks.length),
  }
}

/**
The long-context tasks on which the D78 admission settled no summary
for the arm (M101 lane E R2): "compaction engaged" means the runner's
accepted-history count reached at least one and its admission settled with no outstanding or unknown liability — more model
calls than the baseline is not evidence, in either direction. A shorter
continuation after a real summary still engaged; an extra tool round
without one never did. A task from before the settled count (absent) or
an arm missing from the report counts as never engaged. The baseline
arm missing from the report counts as never engaged.
*/
export function unengagedCompactionTasks(
  report: EvalReport,
  armName: string,
  baselineName: string,
  tasks: readonly EvalTask[],
): string[] {
  const arm = report.arms.find((candidate) => candidate.name === armName)?.results ?? []
  const baseline = report.arms.find((candidate) => candidate.name === baselineName)?.results ?? []
  return tasks
    .filter((task) => task.isLongContext === true)
    .filter((task) => {
      const result = arm.find((result) => result.taskId === task.id)
      const settled = result?.compactionsSettled
      const applied = result?.compactionsApplied
      const money = result?.compactionLedger
      const ran = baseline.find((result) => result.taskId === task.id)
      return (
        ran === undefined ||
        settled === undefined ||
        applied === undefined ||
        applied < 1 ||
        settled < applied ||
        money === undefined ||
        Usd.from(money.outstandingUsd).compare(Usd.from(0)) !== 0 ||
        Usd.from(money.retainedUsd).compare(Usd.from(0)) !== 0
      )
    })
    .map((task) => task.id)
}

/**
The selected tasks on which the strict-tools arm never proved strict
schemas (M101 lane E R6): a task engages only when it sent at least
one model call and every recorded request carried strict function
tools. A task with no recorded request, a request without strict
tools (as when a host regression drops
`modelFacts.supportsStrictTools`), or an arm missing from the report
counts as never engaged.
*/
export function unengagedStrictToolsTasks(
  report: EvalReport,
  armName: string,
  tasks: readonly EvalTask[],
): string[] {
  const results = armResults(report, armName)
  return tasks
    .filter((task) => {
      const evidence = results.find((result) => result.taskId === task.id)?.requestEvidence ?? []
      return evidence.length === 0 || evidence.some((request) => request.strictTools !== true)
    })
    .map((task) => task.id)
}

/**
The report with lane E's strict-tools acceptance recorded in it
(PLAN.md M101): the arm's engagement on the run's selected tasks.
Unlike packing and compaction, an unengaged run is `incomplete`,
never `fail` and never `pass`: without strict requests the run holds
no evidence about strict tools in either direction, so a passing
floor proves nothing and a failing floor keeps its own verdict.
Applied before the report is printed or written, so both artifacts
say what the run's acceptance decided.
*/
export function withStrictToolsEngagement(
  report: EvalReport,
  armName: string,
  tasks: readonly EvalTask[],
): EvalReport {
  if (report.version !== EVAL_REPORT_VERSION) {
    throw new Error('Strict-tools engagement is recorded only in a current-version report.')
  }
  const selected = tasks.map((task) => task.id)
  const unengaged = unengagedStrictToolsTasks(report, armName, tasks)
  // An empty list is not held: nothing ran to engage on.
  const isHeld = selected.length > 0 && unengaged.length === 0
  const verdict =
    isHeld || report.verdict === 'fail' || report.verdict === 'incomplete'
      ? report.verdict
      : 'incomplete'
  return {
    ...report,
    strictToolsEngagement: {
      arm: armName,
      tasks: selected,
      unengaged,
      held: isHeld,
    },
    verdict,
  }
}

/**
The report with lane E's compaction acceptance recorded in it (PLAN.md
M101): the arm's engagement on the run's long-context tasks, and the
verdict `fail` when it settled no compaction on one, whatever the
floors say. A selection with no long-context task holds nothing: a
`pass` becomes `incomplete`, never stays a pass for want of evidence.
Applied before the report is printed or written, so both artifacts say
what the run's acceptance decided.
*/
export function withCompactionEngagement(
  report: EvalReport,
  armName: string,
  baselineName: string,
  tasks: readonly EvalTask[],
): EvalReport {
  if (report.version !== EVAL_REPORT_VERSION) {
    throw new Error('Compaction engagement is recorded only in a current-version report.')
  }
  const longTasks = tasks.filter((task) => task.isLongContext === true).map((task) => task.id)
  const unengaged = unengagedCompactionTasks(report, armName, baselineName, tasks)
  // An empty list is not held: nothing ran to engage on.
  const isHeld = longTasks.length > 0 && unengaged.length === 0
  return {
    ...report,
    compactionEngagement: {
      arm: armName,
      longContextTasks: longTasks,
      unengaged,
      held: isHeld,
    },
    verdict: engagementVerdict(report.verdict, isHeld, longTasks.length),
  }
}

/** Outer deadline covers every task/arm run; each turn and verifier keeps its own limit. */
export function evalRunTimeoutMs(taskCount: number, armCount: number, marginMs: number): number {
  const counts = [taskCount, armCount, marginMs]
  const deadline = taskCount * armCount * (EVAL_TURN_TIMEOUT_MS + EVAL_VERIFY_TIMEOUT_MS) + marginMs
  if (
    counts.some((count) => !Number.isSafeInteger(count)) ||
    taskCount < 1 ||
    armCount < 1 ||
    marginMs < 0 ||
    !Number.isSafeInteger(deadline)
  ) {
    throw new Error(
      'The live eval deadline requires valid task and arm counts and a finite margin.',
    )
  }
  return deadline
}
