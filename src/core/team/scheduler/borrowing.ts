import {
  TEAM_MINUTE_MS,
  TEAM_TASKS_PER_TURN_DEFAULT,
  TEAM_TASK_MINUTES_DEFAULT,
} from '../../../shared/constants'
import type { TeamBoardTask } from '../../../shared/team'
import type {
  TeamCandidate,
  TeamPreferenceList,
  TeamRoleAssignment,
  TeamTaskConditions,
} from '../../../shared/teamPreference'
import {
  decideBorrow,
  decideRecall,
  type BorrowAgent,
  type BorrowDecision,
  type BorrowProducingTask,
  type BorrowRoleFacts,
  type BorrowSnapshot,
  type RecallDecision,
} from '../borrow'
import { selectTeamEntry, selectionConditions } from '../selection'
import type { TeamSelectionSnapshot } from '../teamPool'
import type { TaskBoard } from './board'
import type { TaskPicker, PickContext, SchedulerEntry } from './pick'

/** Lane H consumes this decision; S never stops a worker or captures work. */
export interface SchedulerRecallEvent {
  readonly taskId: string
  readonly attempt: number
  readonly atMs: number
  readonly decision: RecallDecision
}
export interface SchedulerBorrowPort {
  lists(): readonly TeamPreferenceList[]
  assignments(): readonly TeamRoleAssignment[]
  /** Recorded history survives board archival; absent falls back to retained attempts. */
  medianDurationMs(roleId: string): number | undefined
  /** Future review/fix work even when it has not been submitted to the board. */
  produces(
    task: TeamBoardTask,
  ): { readonly roleId: string; readonly conditions?: TeamTaskConditions } | undefined
  recall(event: SchedulerRecallEvent): Promise<void>
  decisions(decisions: readonly BorrowDecision[]): void
}

/** Board-derived live D109 state; no independent timers or hidden task queue. */
export class SchedulerBorrowing {
  constructor(
    private readonly board: TaskBoard,
    private readonly port: SchedulerBorrowPort,
    private readonly picker: TaskPicker,
  ) {}

  private selection(
    context: PickContext,
    task: TeamBoardTask,
    candidate: TeamCandidate,
  ): TeamSelectionSnapshot {
    const snapshot = context.selection?.(task)
    if (snapshot?.preference === undefined || snapshot.availability === undefined)
      throw new Error('team:borrowSelectionMissing')
    // The candidate keeps its own caps; role/team/turn budgets stay in the task snapshot.
    return {
      ...snapshot,
      nowMs: context.now,
      preference: { ...snapshot.preference, pool: [candidate] },
    }
  }

  private timeBox(task: TeamBoardTask, lists: readonly TeamPreferenceList[]): number {
    return (
      (lists.find((list) => list.role === task.roleId)?.minutesPerTask ??
        TEAM_TASK_MINUTES_DEFAULT) * TEAM_MINUTE_MS
    )
  }

  private snapshot(
    context: PickContext,
    tasks: readonly TeamBoardTask[],
    lists: readonly TeamPreferenceList[],
  ): BorrowSnapshot {
    const roles = new Map<string, BorrowRoleFacts>()
    for (const list of lists) {
      const durations = tasks
        .filter((task) => task.roleId === list.role)
        .flatMap((task) =>
          task.attempts.flatMap((attempt) =>
            attempt.state === 'retired' && attempt.endedAt !== undefined
              ? [attempt.endedAt - attempt.startedAt]
              : [],
          ),
        )
        .toSorted((a, b) => a - b)
      const middle = Math.floor(durations.length / 2)
      let median = this.port.medianDurationMs(list.role)
      if (median === undefined && durations.length > 0) {
        median =
          durations.length % 2 === 0
            ? ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2
            : durations[middle]
      }
      roles.set(list.role, {
        ...(list.borrow !== undefined && { timers: list.borrow }),
        ...(median !== undefined && { medianDurationMs: median }),
      })
    }
    const queued = tasks
      .filter((task) => task.state === 'ready' && !task.held)
      .map((task) => {
        const isMainFree = this.picker.rank([task], context).length > 0
        this.board.demand(task.id, context.now, isMainFree)
        const selection = context.selection?.(task)
        const conditions = selection === undefined ? undefined : selectionConditions(selection)
        return {
          taskId: task.id,
          roleId: task.roleId,
          queuedAtMs: task.readyAt ?? task.createdAt,
          unmetSinceMs: this.board.task(task.id).unmetSinceMs ?? context.now,
          mainCandidateFree: isMainFree,
          preference:
            lists
              .find((list) => list.role === task.roleId)
              ?.pool.map((candidate) => candidate.id) ?? [],
          ...(conditions !== undefined && { conditions }),
        }
      })
    const cooldowns = this.board.snapshot().borrowCooldowns ?? []
    const first = tasks[0]
    const identities = first === undefined ? undefined : context.selection?.(first)
    const agents: BorrowAgent[] = this.port.assignments().map((assignment) => {
      const candidate = lists
        .find((list) => list.role === assignment.mainRole)
        ?.pool.find((item) => item.id === assignment.candidateId)
      const profileId =
        candidate?.agent?.agentId ??
        context.entries.find((entry) => entry.id === assignment.candidateId)?.agentProfileId
      const running = tasks.find((task) =>
        task.attempts.some(
          (attempt) =>
            (attempt.entryId === assignment.candidateId || attempt.agentProfileId === profileId) &&
            attempt.state !== 'retired',
        ),
      )
      const attempt = running?.attempts.findLast((item) => item.state !== 'retired')
      const isBorrowed =
        running?.handoff?.chain.some(
          (link) =>
            link.kind === 'borrow' &&
            link.candidateId === assignment.candidateId &&
            link.atMs === attempt?.startedAt,
        ) ?? false
      const endedAt = cooldowns.find((row) => row.candidateId === assignment.candidateId)?.endedAtMs
      return {
        ...assignment,
        engine:
          (candidate === undefined ? undefined : identities?.engine?.(candidate)) ??
          candidate?.agent?.model ??
          context.entries.find((entry) => entry.id === assignment.candidateId)?.modelId ??
          '',
        underCaps: true,
        ...(candidate?.conditions !== undefined && { conditions: candidate.conditions }),
        ...(running !== undefined &&
          attempt !== undefined && {
            running: {
              taskId: running.id,
              roleId: running.roleId,
              startedAtMs: attempt.startedAt,
              timeBoxMs: this.timeBox(running, lists),
              borrowed: isBorrowed,
              ...(running.recallAskedAtMs !== undefined && {
                recallAskedAtMs: running.recallAskedAtMs,
              }),
            },
          }),
        ...(endedAt !== undefined && { lastBorrowEndedAtMs: endedAt }),
      }
    })
    const producing: BorrowProducingTask[] = tasks.flatMap((task) => {
      const attempt = task.attempts.at(-1)
      const produces = this.port.produces(task)
      return attempt !== undefined && produces !== undefined && task.state === 'running'
        ? [
            {
              taskId: task.id,
              roleId: task.roleId,
              startedAtMs: attempt.startedAt,
              timeBoxMs: this.timeBox(task, lists),
              produces,
            },
          ]
        : []
    })
    return { nowMs: context.now, agents, queued, producing, roles }
  }

  async tick(context: PickContext, journal: () => Promise<void>): Promise<PickContext> {
    if (this.port.assignments().every((assignment) => assignment.secondaryRoles.length === 0))
      return context
    const lists = this.port.lists()
    const tasks = this.board.snapshot().tasks
    const snapshot = this.snapshot(context, tasks, lists)
    const recalls = decideRecall(snapshot)
    for (const decision of recalls) {
      const task = this.board.task(decision.taskId)
      if (decision.kind === 'recall') this.board.recallAsked(task.id, context.now)
      else if (decision.kind === 'keep') this.board.recallAsked(task.id, undefined)
    }
    await journal()
    for (const decision of recalls) {
      const task = this.board.task(decision.taskId)
      await this.port.recall({
        taskId: task.id,
        attempt: task.currentAttempt,
        atMs: context.now,
        decision,
      })
    }
    const borrowed = new Map<string, { candidate: TeamCandidate; entry: SchedulerEntry }>()
    const taken = new Set<string>()
    const decisions: BorrowDecision[] = []
    const ordered = snapshot.queued.toSorted(
      (a, b) => a.queuedAtMs - b.queuedAtMs || a.taskId.localeCompare(b.taskId),
    )
    for (const queued of ordered) {
      const task = this.board.task(queued.taskId)
      const agents = snapshot.agents.map((agent): BorrowAgent => {
        if (agent.running !== undefined) return agent
        const candidate = lists
          .find((list) => list.role === agent.mainRole)
          ?.pool.find((item) => item.id === agent.candidateId)
        const home = context.entries.find(
          (entry) => entry.id === agent.candidateId && entry.roleId === agent.mainRole,
        )
        if (candidate === undefined || home === undefined)
          return { ...agent, skip: { candidateId: agent.candidateId, reason: 'nodeOffline' } }
        if (taken.has(agent.candidateId))
          return { ...agent, skip: { candidateId: agent.candidateId, reason: 'busy' } }
        const selection = this.selection(context, task, candidate)
        const result = selectTeamEntry(
          { roleId: task.roleId, entries: [], policy: 'queue', continueOnNext: false },
          selection,
          TEAM_TASKS_PER_TURN_DEFAULT,
        )
        const skip = result.kind === 'exhausted' ? result.skips?.[0] : undefined
        return { ...agent, ...(skip !== undefined && { skip }) }
      })
      const decision = decideBorrow({ ...snapshot, agents }, task.id)[0]
      if (decision === undefined) continue
      decisions.push(decision)
      if (decision.kind !== 'borrow') continue
      const agent = agents.find((item) => item.candidateId === decision.candidateId)
      const candidate = lists
        .find((list) => list.role === agent?.mainRole)
        ?.pool.find((item) => item.id === decision.candidateId)
      const home = context.entries.find(
        (entry) => entry.id === decision.candidateId && entry.roleId === agent?.mainRole,
      )
      if (candidate === undefined || home === undefined)
        throw new Error('team:borrowCandidateMissing')
      taken.add(decision.candidateId)
      borrowed.set(task.id, {
        candidate,
        entry: {
          ...home,
          roleId: task.roleId,
          eligible: (item) => item.id === task.id && home.eligible(item),
        },
      })
    }
    this.port.decisions(decisions)
    return {
      ...context,
      entries: [...context.entries, ...Array.from(borrowed.values(), (item) => item.entry)],
      selection: (task) => {
        const candidate = borrowed.get(task.id)?.candidate
        if (candidate !== undefined) return this.selection(context, task, candidate)
        const selection = context.selection?.(task)
        if (selection === undefined) throw new Error('team:borrowSelectionMissing')
        return selection
      },
    }
  }

  started(task: TeamBoardTask, entry: SchedulerEntry, nowMs: number): void {
    const assignment = this.port.assignments().find((item) => item.candidateId === entry.id)
    if (assignment === undefined || assignment.mainRole === task.roleId) return
    this.board.appendChain(task.id, {
      kind: 'borrow',
      atMs: nowMs,
      candidateId: entry.id,
      mainRole: assignment.mainRole,
      borrowingRole: task.roleId,
    })
  }

  retired(task: TeamBoardTask, attemptNumber: number): void {
    const attempt = task.attempts.find((item) => item.number === attemptNumber)
    if (attempt?.endedAt === undefined) return
    if (
      task.handoff?.chain.some(
        (link) =>
          link.kind === 'borrow' &&
          link.candidateId === attempt.entryId &&
          link.atMs === attempt.startedAt,
      )
    )
      this.board.borrowEnded(attempt.entryId, attempt.endedAt)
  }
}
