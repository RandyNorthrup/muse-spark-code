import {
  TEAM_DIVERGE_REPEATS,
  TEAM_DIVERGE_SIZE_FACTOR,
  TEAM_HANDOFF_TOOL_CALLS,
  TEAM_MAX_REASSIGNMENTS,
  TEAM_MODEL_TEXT,
  TEAM_SCHED_TEXT_MAX_CHARS,
  TEAM_STALL_MS,
  TEAM_STALL_RATE_LIMIT_MS,
} from '../../../shared/constants'
import { type TeamAttempt, type TeamBoardTask } from '../../../shared/team'
import { type RetirementOutcome } from './retire'

type StallReason = NonNullable<TeamAttempt['stallReason']>
interface Ref {
  taskId: string
  attempt: number
}
export interface StallActivity {
  lastEventAt: number
  commandDeadline?: number
  requestCount: number
  requestCeiling: number
  isWorkLeft: boolean
  isOwnStepLimit: boolean
  rateLimitedSince?: number
  isUsageLimited: boolean
  isRetryBudgetSpent: boolean
  isProcessExited: boolean
  hasReport: boolean
}

/** Inputs are engine facts or already captured/parsed native adapter events. */
export function detectStall(activity: StallActivity, now: number): StallReason | undefined {
  if (activity.isProcessExited && !activity.hasReport) return 'crashed'
  if (activity.commandDeadline !== undefined && now < activity.commandDeadline) return undefined
  if (activity.isRetryBudgetSpent) return 'providerDown'
  if (activity.isUsageLimited) return 'usageLimited'
  if (
    activity.rateLimitedSince !== undefined &&
    now - activity.rateLimitedSince >= TEAM_STALL_RATE_LIMIT_MS
  )
    return 'rateLimited'
  if (
    activity.isWorkLeft &&
    (activity.isOwnStepLimit || activity.requestCount >= activity.requestCeiling)
  )
    return 'outOfSteps'
  return now - activity.lastEventAt >= TEAM_STALL_MS ? 'noProgress' : undefined
}

export class DivergenceWatch {
  private readonly regions = new Map<string, { contents: Set<string>; repeats: number }>()
  rewrite(region: string, content: string): boolean {
    const history = this.regions.get(region) ?? { contents: new Set<string>(), repeats: 0 }
    if (history.contents.has(content)) history.repeats++
    history.contents.add(content)
    this.regions.set(region, history)
    return history.repeats >= TEAM_DIVERGE_REPEATS
  }
  oversized(changedLines: number, estimatedLines: number): boolean {
    return changedLines > TEAM_DIVERGE_SIZE_FACTOR * estimatedLines
  }
}

export interface HandoffEntry {
  id: string
  agentProfileId: string
  modelId: string
  isKey: boolean
  hasHeadroom: boolean
}
export interface Checkpoint {
  commit: string
  files: readonly string[]
  diffStat: string
}
export interface Handoff {
  instruction: string
  originalBrief: string
  checkpoint: Checkpoint
  data: {
    kind: 'untrustedData'
    open: string
    close: string
    lastMessage: string
    reason: StallReason
    toolCalls: readonly { name: string; outcome: string }[]
  }
}

export function handoffEntry(
  entries: readonly HandoffEntry[],
  previous: TeamAttempt,
  reason: StallReason,
): HandoffEntry | undefined {
  const available = entries.filter((entry) => entry.hasHeadroom)
  return ['rateLimited', 'usageLimited', 'providerDown', 'crashed'].includes(reason)
    ? available.find((entry) => entry.agentProfileId !== previous.agentProfileId)
    : (available.find((entry) => entry.modelId !== previous.modelId) ?? available[0])
}

export interface StallDependencies {
  isCurrent(ref: Ref): boolean
  retire(ref: Ref): Promise<RetirementOutcome>
  checkpoint(ref: Ref): Promise<Checkpoint>
  settleUsage(ref: Ref): Promise<void>
  entries(roleId: string): readonly HandoffEntry[]
  consent(entry: HandoffEntry): Promise<boolean>
  /** New admission: every cap, current trust, fresh copy, refresh and leases. */
  reassign(ref: Ref, entry: HandoffEntry, handoff: Handoff): Promise<boolean>
  switchRow(ref: Ref, entry: HandoffEntry, reason: 'stall'): void
  block(
    ref: Ref,
    reason: 'uncertain' | 'thirdStall' | 'ask' | 'stop' | 'diverging' | 'exhausted' | 'consent',
  ): void
}

/** One recovery per attempt; retirement always precedes checkpoint and dispatch. */
export class StallRecovery {
  private readonly recovering = new Set<string>()
  constructor(private readonly deps: StallDependencies) {}

  async recover(
    task: TeamBoardTask,
    reason: StallReason | 'diverging',
    input: {
      policy: 'reassign' | 'ask' | 'stop'
      brief: string
      lastMessage: string
      toolCalls: readonly { name: string; outcome: string }[]
    },
  ): Promise<'reassigned' | 'blocked' | 'stale'> {
    const ref = { taskId: task.id, attempt: task.currentAttempt }
    const key = JSON.stringify(ref)
    const previous = task.attempts.at(-1)
    if (!previous || !this.deps.isCurrent(ref) || this.recovering.has(key)) return 'stale'
    this.recovering.add(key)
    try {
      const outcome = await this.deps.retire(ref)
      await this.deps.settleUsage(ref)
      if (!this.deps.isCurrent(ref)) return 'stale'
      if (outcome.state !== 'retired') {
        this.deps.block(ref, 'uncertain')
        return 'blocked'
      }
      const checkpoint = await this.deps.checkpoint(ref)
      if (!this.deps.isCurrent(ref)) return 'stale'
      if (reason === 'diverging') {
        this.deps.block(ref, 'diverging')
        return 'blocked'
      }
      let blocked: 'thirdStall' | 'ask' | 'stop' | undefined
      if (task.reassignments >= TEAM_MAX_REASSIGNMENTS) blocked = 'thirdStall'
      else if (input.policy !== 'reassign') blocked = input.policy
      if (blocked) {
        this.deps.block(ref, blocked)
        return 'blocked'
      }
      const entry = handoffEntry(this.deps.entries(task.roleId), previous, reason)
      if (!entry) {
        this.deps.block(ref, 'exhausted')
        return 'blocked'
      }
      if (entry.isKey && !(await this.deps.consent(entry))) {
        this.deps.block(ref, 'consent')
        return 'blocked'
      }
      if (!this.deps.isCurrent(ref)) return 'stale'
      const handoff: Handoff = {
        instruction: TEAM_MODEL_TEXT.handoff,
        originalBrief: input.brief,
        checkpoint,
        data: {
          kind: 'untrustedData',
          open: TEAM_MODEL_TEXT.handoffDataOpen,
          close: TEAM_MODEL_TEXT.handoffDataClose,
          lastMessage: input.lastMessage.slice(0, TEAM_SCHED_TEXT_MAX_CHARS),
          reason,
          toolCalls: input.toolCalls.slice(-TEAM_HANDOFF_TOOL_CALLS).map((call) => ({
            name: call.name,
            outcome: call.outcome.slice(0, TEAM_SCHED_TEXT_MAX_CHARS),
          })),
        },
      }
      if (!(await this.deps.reassign(ref, entry, handoff))) {
        this.deps.block(ref, 'exhausted')
        return 'blocked'
      }
      this.deps.switchRow(ref, entry, 'stall')
      return 'reassigned'
    } finally {
      this.recovering.delete(key)
    }
  }
}
