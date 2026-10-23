// A task's merge flow: review before merge, the merge card and settlement
// (M96 lane X, C-M96-3 round 4). It loads lazily on the first merge so the
// activation bundle stays out of it: `beginMerge` in teamHost.ts owns the
// synchronous guard and phase claim, then hands the task to `runMergeFlow`
// here with everything it needs. The flow never imports `TEAM_MODEL_TEXT`
// (which is carried whole wherever it is read); the host passes the few
// strings this flow reads. Every effect but the pure reviewer choice goes
// through the passed ports, so the VS Code host, the ACP agent and the
// other editors' panels drive the same code. Must not import `vscode`.

import { UI_TEXT } from '../../shared/constants'
import type { TeamRoleConfig } from '../../shared/team'
import type { TeamWorkerConfirmation } from '../../shared/paid'
import { isProtectedPath } from '../protectedPaths'
import { isSameTeamModel } from './sameModel'
import type {
  TeamCardPort,
  TeamMergeDecision,
  TeamMergePlanFile,
  TeamMergePort,
  TeamPaidPort,
  TeamWorkerOutcome,
} from './teamHostService'
import type { StaffedEntry, TeamTaskRecord } from './teamHost'
import type { DelegateArgs } from './teamTools'
import type { TeamToolContext, TeamToolResult } from './teamSeams'

/** The model strings this flow reads, passed by the host (never imported). */
export interface TeamMergeFlowText {
  readonly brief: (taskId: string, role: string, brief: string) => string
  readonly reason: string
  readonly running: (taskId: string) => string
  readonly started: (taskId: string) => string
  readonly paidDeclined: string
  readonly mergeNotReady: string
  readonly mergeCancelled: string
}

/** Everything `runMergeFlow` needs from the host service. */
export interface TeamMergeFlowApi {
  readonly record: (
    role: TeamRoleConfig,
    item: Pick<DelegateArgs['tasks'][number], 'brief' | 'files' | 'reason'>,
    sessionId: string,
    phase: 'starting',
  ) => TeamTaskRecord
  readonly admit: (task: TeamTaskRecord, entry: StaffedEntry) => { release: () => void }
  readonly launch: (task: TeamTaskRecord) => Promise<void>
  readonly persist: () => Promise<void>
  readonly changed: () => void
  readonly discard: (task: TeamTaskRecord) => Promise<void>
  readonly exclusive: <T>(task: TeamTaskRecord, work: () => Promise<T>) => Promise<T>
  readonly checkOwner: (task: TeamTaskRecord, context: TeamToolContext) => void
  readonly confirmReview: (entry: StaffedEntry) => TeamWorkerConfirmation
  readonly agentScope: (agent: StaffedEntry['agent']) => string
  readonly forget: (taskId: string) => void
  readonly reviewStaff: () => { role: TeamRoleConfig; entries: readonly StaffedEntry[] } | undefined
  readonly hasReviewRoom: (entry: StaffedEntry) => boolean
  readonly findRunningReview: (of: TeamTaskRecord) => TeamTaskRecord | undefined
  readonly answer: (value: unknown, visible: string) => TeamToolResult
  readonly refusal: (reason: string) => TeamToolResult
  /**
  Fixed-vocabulary merge notes; absent the flow stays silent. Warn-only so
  every host service log shape satisfies it.
  */
  readonly log?: { warn(message: string): void }
  readonly describeError: (error: unknown) => string
  readonly paid: TeamPaidPort
  readonly cards: TeamCardPort
  readonly merges: TeamMergePort
  readonly text: TeamMergeFlowText
}

/** A reviewer with headroom, preferring a model that did not write the branch. */
const reviewerFor = (
  task: TeamTaskRecord,
  entries: readonly StaffedEntry[],
  hasReviewRoom: (entry: StaffedEntry) => boolean,
): StaffedEntry | undefined => {
  const ready = entries.filter((entry) => hasReviewRoom(entry))
  return (
    ready.find((entry) =>
      task.writerModels.every((model) => !isSameTeamModel(entry.agent.model, model)),
    ) ?? ready[0]
  )
}

/**
Review before merge (acceptance 19): with a reviewer that has headroom,
a branch head nobody reviewed starts a review task first; the merge waits
for it. Answers the refusal the caller passes on, or undefined to merge.
*/
const requireReview = async (
  task: TeamTaskRecord,
  context: TeamToolContext,
  api: TeamMergeFlowApi,
): Promise<string | undefined> => {
  const head = task.outcome?.head
  if (head === undefined || task.reviewedHead === head) return undefined
  const running = api.findRunningReview(task)
  if (running !== undefined) return api.text.running(running.taskId)
  const staff = api.reviewStaff()
  const reviewer =
    staff === undefined ? undefined : reviewerFor(task, staff.entries, api.hasReviewRoom)
  const reviewRole = staff?.role
  if (reviewer === undefined || reviewRole === undefined) return undefined
  const review = api.record(
    reviewRole,
    {
      brief: api.text.brief(task.taskId, task.role.role, task.brief),
      files: [...(task.outcome?.changedFiles ?? [])],
      reason: { code: 'different_model', detail: api.text.reason },
    },
    task.sessionId,
    'starting',
  )
  review.reviewOf = task
  let isLaunched = false
  try {
    context.signal.throwIfAborted()
    const lease = api.admit(review, reviewer)
    const cancelReview = (): void => {
      review.controller.abort()
    }
    context.signal.addEventListener('abort', cancelReview, { once: true })
    review.lease = {
      release: () => {
        context.signal.removeEventListener('abort', cancelReview)
        lease.release()
      },
    }
    await api.persist()
    api.checkOwner(task, context)
    if (
      reviewer.agent.pays === 'key' &&
      !(await api.paid.allowKeyTasks([api.confirmReview(reviewer)], undefined, context))
    )
      return api.text.paidDeclined
    api.checkOwner(task, context)
    review.consented = new Set([api.agentScope(reviewer.agent)])
    await api.launch(review)
    isLaunched = true
    api.checkOwner(task, context)
    return api.text.started(review.taskId)
  } finally {
    if (!isLaunched) {
      review.lease?.release()
      api.forget(review.taskId)
      await api.persist()
      api.changed()
    }
  }
}

const mergeCard = (
  task: TeamTaskRecord,
  outcome: TeamWorkerOutcome,
  planned?: readonly TeamMergePlanFile[],
) => {
  // The planner's words when it ran (it throws for unsafe paths before any
  // card); the outcome's own list only for the failure card a refused plan
  // leaves behind.
  const files = planned?.map((file) => file.path) ?? outcome.changedFiles ?? []
  return {
    itemId: `team-merge-${task.taskId}`,
    kind: 'teamMerge' as const,
    teamMerge: {
      taskId: task.taskId,
      roleId: task.role.role,
      brief: task.brief,
      branch: outcome.branch ?? '',
      filesChanged: files.length,
      affectedFiles: files,
      protectedPaths:
        planned?.filter((file) => file.isProtected).map((file) => file.path) ??
        files.filter((file) => isProtectedPath(file.toLowerCase())),
      review: task.review ?? ('not-reviewed' as const),
      ...(task.reviewVerdict !== undefined && { reviewVerdict: task.reviewVerdict }),
      ...(task.reviewSummary !== undefined && {
        reviewerFindings: task.reviewFindings?.length
          ? task.reviewFindings.map(
              (finding) =>
                `${finding.severity ?? ''} ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`} ${finding.title}${finding.detail === undefined ? '' : `\n${finding.detail}`}`,
            )
          : [task.reviewSummary],
      }),
    },
  }
}

/** Own review admission and exactly one card waiter through final settlement. */
export const runMergeFlow = async (
  task: TeamTaskRecord,
  context: TeamToolContext,
  api: TeamMergeFlowApi,
): Promise<TeamToolResult> => {
  let cancel: (() => void) | undefined
  let refused: TeamToolResult | undefined
  try {
    api.checkOwner(task, context)
    await api.persist()
    api.checkOwner(task, context)
    const review = await requireReview(task, context, api)
    api.checkOwner(task, context)
    if (review !== undefined) {
      task.mergePhase = 'idle'
      return api.refusal(review)
    }
    const outcome = task.outcome
    if (outcome === undefined) throw new Error(api.text.mergeNotReady)
    // The merge planner binding: what the merge would do, planned before
    // the card is shown, so unsafe paths and ref breaches refuse here and
    // the card lists the planner's files and protected paths.
    const planned = await api.merges.plan({ taskId: task.taskId, role: task.role, outcome })
    api.checkOwner(task, context)
    const card = mergeCard(task, outcome, planned)
    const decision = new Promise<TeamMergeDecision | 'cancelled'>((resolve) => {
      task.awaiting = resolve
      cancel = () => {
        resolve('cancelled')
      }
      context.signal.addEventListener('abort', cancel, { once: true })
      task.mergePhase = 'awaiting-decision'
      api.cards.show(task.sessionId, { ...card, status: 'inProgress' })
      task.mergeReady?.()
      api.changed()
    })
    const chosen = await decision
    task.awaiting = undefined
    api.checkOwner(task, context)
    if (chosen === 'cancelled') throw new Error(api.text.mergeCancelled)
    task.mergePhase = 'merging'
    await api.persist()
    api.checkOwner(task, context)
    if (chosen === 'discard') {
      await api.discard(task)
      task.mergePhase = 'done'
      api.cards.show(task.sessionId, { ...card, status: 'completed', teamDecision: chosen })
      return api.answer({ task_id: task.taskId, state: 'discarded' }, UI_TEXT.teamWorkerDiscarded)
    }
    const merged = await api.exclusive(task, async () => {
      api.checkOwner(task, context)
      const result = await api.merges.merge(
        { taskId: task.taskId, role: task.role, outcome },
        context.signal,
        { allowProtected: card.teamMerge.protectedPaths.length > 0 },
      )
      if (result.status === 'merged') task.phase = 'merged'
      await api.persist()
      return result
    })
    task.mergePhase = merged.status === 'merged' ? 'done' : 'failed'
    api.cards.show(task.sessionId, { ...card, status: 'completed', teamDecision: chosen })
    return api.answer(
      { task_id: task.taskId, ...merged },
      merged.status === 'merged' ? UI_TEXT.teamWorkerMerged : UI_TEXT.teamMergeRework,
    )
  } catch (error: unknown) {
    task.mergePhase = 'failed'
    task.failure = api.describeError(error)
    api.log?.warn(`Team merge failed: ${task.failure}`)
    if (task.outcome !== undefined)
      api.cards.show(task.sessionId, {
        ...mergeCard(task, task.outcome),
        status: 'completed',
        teamDecision: task.failure,
      })
    refused = api.refusal(task.failure)
  } finally {
    if (cancel !== undefined) context.signal.removeEventListener('abort', cancel)
    task.awaiting = undefined
    task.mergeReady?.()
    api.changed()
  }
  // The try above always returns or throws, and the catch always records
  // its refusal, so the refusal is set here.
  return refused
}
