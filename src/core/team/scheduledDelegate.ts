import { failureForLog } from '../backends/musecode/logText'
import { refuseKeySpend } from './teamPaid'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { teamSchedulerFieldsSchema, type TeamRoleConfig } from '../../shared/team'
import type { TeamWorkerConfirmation } from '../../shared/paid'
import type { TeamHostServiceDeps } from './teamHostService'
import type { PlanStep, StaffedEntry, TeamTaskRecord } from './teamHost'
import type { DelegateArgs } from './teamTools'
import type { TeamSchedulingPort } from './teamScheduling'
import type { TeamToolContext, TeamToolResult } from './teamSeams'

interface ScheduledDelegateApi {
  readonly scheduler: TeamSchedulingPort | undefined
  readonly deps: TeamHostServiceDeps
  readonly allTasks: () => readonly TeamTaskRecord[]
  readonly pool: (role: TeamRoleConfig) => readonly StaffedEntry[]
  readonly isUsable: (entry: StaffedEntry) => boolean
  readonly confirmationFor: (role: string, entry: StaffedEntry) => TeamWorkerConfirmation
  readonly isClosed: () => boolean
  readonly record: (
    role: TeamRoleConfig,
    item: DelegateArgs['tasks'][number],
    sessionId: string,
    phase: 'queued',
  ) => TeamTaskRecord
  readonly paidScope: (agent: StaffedEntry['agent']) => string
  readonly persist: () => Promise<void>
  readonly taskView: (task: TeamTaskRecord) => unknown
  readonly answer: (value: unknown, visible: string) => TeamToolResult
  readonly refusal: (reason: string) => TeamToolResult
  readonly describeError: (error: unknown) => string
  readonly forget: (taskId: string) => void
}

/** Paid consent precedes queue publication; only the scheduler can launch. */
export async function runScheduledDelegate(
  steps: readonly PlanStep[],
  context: TeamToolContext,
  api: ScheduledDelegateApi,
): Promise<TeamToolResult> {
  const {
    deps,
    pool,
    isUsable,
    confirmationFor,
    isClosed,
    record,
    paidScope,
    persist,
    taskView,
    answer,
    refusal,
    describeError,
  } = api
  const scheduled = api.scheduler
  if (scheduled === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
  const available = steps.filter(
    (step): step is Exclude<PlanStep, { readonly refused: string }> => 'role' in step,
  )
  // Consent binds to exactly what the popup quoted: entries usable at quote
  // time. An entry that becomes ready while confirmation is open was never
  // quoted, so it must not join the grant (finding: unquoted paid dispatch).
  const quoted = available.map((step) => {
    const entries = pool(step.role).filter((entry) => entry.agent.pays === 'key' && isUsable(entry))
    return {
      step,
      entries,
      scopes: entries.map((entry) => paidScope(entry.agent)),
    }
  })
  const confirmations = quoted.flatMap(({ step, entries }) =>
    entries.map((entry) => confirmationFor(step.item.role, entry)),
  )
  const declined = await refuseKeySpend(
    deps.paid,
    confirmations,
    context,
    () => isClosed() || context.signal.aborted || !deps.settings.isTrusted(),
  )
  if (declined !== undefined) return refusal(declined)
  const queued = quoted.map(({ step, scopes }) => {
    const task = record(step.role, step.item, context.sessionId, 'queued')
    task.selectedEntry = step.item.entry
    if ('entry' in step) {
      task.continueFrom = step.continueFrom
      task.isRaised = step.isRaised === true
    }
    task.consented = new Set(scopes)
    return {
      task,
      fields: teamSchedulerFieldsSchema.parse({
        key: step.item.key,
        depends_on: step.item.depends_on,
        priority: step.item.priority,
        size: step.item.size,
        writes: step.item.writes,
        overlap: step.item.overlap,
      }),
    }
  })
  try {
    await persist()
    await scheduled.submit(
      queued.map(({ task, fields }) => ({
        id: task.taskId,
        sessionId: task.sessionId,
        roleId: task.role.role,
        fields,
      })),
    )
    return answer(
      {
        tasks: [
          ...steps
            .filter((step) => 'refused' in step)
            .map((step) => ({ role: step.item.role, refused: step.refused })),
          ...queued.map(({ task }) => taskView(task)),
        ],
      },
      // Queued work is announced as queued: submission alone starts no worker
      // (pause, held pool or zero capacity all launch nothing here).
      fill(UI_TEXT.teamTasksQueued, { count: String(queued.length) }),
    )
  } catch (error: unknown) {
    deps.log.warn(failureForLog(error))
    for (const { task } of queued)
      if (
        task.phase === 'queued' &&
        scheduled.snapshot().tasks.every((item) => item.id !== task.taskId)
      )
        api.forget(task.taskId)
    await persist()
    return refusal(describeError(error))
  }
}
