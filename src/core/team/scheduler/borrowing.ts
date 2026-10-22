import {
  TEAM_MINUTE_MS,
  TEAM_TASKS_PER_TURN_DEFAULT,
  TEAM_TASK_MINUTES_DEFAULT,
  TEAM_BORROW_RECALL_WAIT_MS,
} from '../../../shared/constants'
import type { TeamAttempt, TeamBoardTask } from '../../../shared/team'
import {
  isTaskAuthor,
  type TeamCandidate,
  type TeamPreferenceList,
  type TeamRoleAssignment,
  type TeamSkip,
  type TeamTaskConditions,
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
import { isSameTeamModel } from '../sameModel'
import {
  candidateAgent,
  liveCandidateSkip,
  selectTeamEntry,
  selectionConditions,
} from '../selection'
import type { TeamSelectionSnapshot } from '../teamPool'
import type { TaskBoard } from './board'
import type { TaskPicker, PickContext, SchedulerEntry } from './pick'

/** Lane H consumes this decision; S never stops a worker or captures work. */
export interface SchedulerRecallEvent {
  readonly id: string
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

/**
Every fact the loan admission predicate reads, in the order it reads them.
`reservation` is the final gate's own: the held loan and attempt are unchanged.
*/
export const LOAN_FACTS = [
  'reservation',
  'authorization',
  'identity',
  'author',
  'conditions',
  'availability',
  'limit',
  'agent',
  'idle',
  'demand',
  'mainCandidate',
  'mainWork',
  'cooldown',
] as const
export type LoanFact = (typeof LOAN_FACTS)[number]

interface LoanLender {
  readonly candidateId: string
  readonly mainRole: string
}

/** A refused lender fact carries its roster skip; a refused D212 condition is the decision's. */
type LoanAdmission =
  | { readonly kind: 'admitted'; readonly candidate: TeamCandidate; readonly home: SchedulerEntry }
  | { readonly kind: 'refused'; readonly fact: LoanFact; readonly skip?: TeamSkip }

function refused(fact: LoanFact, skip: TeamSkip): LoanAdmission {
  return { kind: 'refused', fact, skip }
}

/** Which D212 lending condition a one-lender decision refused on. */
function lendingFact(decision: BorrowDecision | undefined, isMainFree: boolean): LoanFact {
  if (isMainFree && decision?.kind === 'none' && decision.reason === 'mainFree')
    return 'mainCandidate'
  if (decision === undefined || (decision.kind === 'none' && decision.reason !== 'noLender'))
    return 'demand'
  switch (decision.skips[0]?.reason) {
    case 'borrowCooldown': {
      return 'cooldown'
    }
    case 'mainWorkDue': {
      return 'mainWork'
    }
    case 'conditions': {
      return 'conditions'
    }
    case 'author': {
      return 'author'
    }
    case 'busy': {
      return 'idle'
    }
    default: {
      return 'authorization'
    }
  }
}

/** Board-derived live D212 state; no independent timers or hidden task queue. */
export class SchedulerBorrowing {
  private readonly pending = new Map<string, SchedulerRecallEvent>()
  private readonly delivered = new Map<string, SchedulerRecallEvent>()
  private readonly lastRecall = new Map<string, { signature: string; number: number }>()
  private delivering = false
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

  /** Ticks journal demand on the board; the final launch gate reads without writing. */
  private snapshot(
    context: PickContext,
    tasks: readonly TeamBoardTask[],
    lists: readonly TeamPreferenceList[],
    shouldRecord = true,
  ): BorrowSnapshot {
    const roles = new Map<string, BorrowRoleFacts>()
    for (const list of lists) {
      const durations = tasks
        .filter((task) => task.roleId === list.role)
        .flatMap((task) =>
          task.attempts
            .filter((attempt) => attempt.state === 'retired' && attempt.endedAt !== undefined)
            .map((attempt) => (attempt.endedAt ?? attempt.startedAt) - attempt.startedAt),
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
        const selection = context.selection?.(task)
        // Legacy tasks protect their main role but can never request a loan.
        const isDemand =
          selection?.preference !== undefined ||
          task.loan !== undefined ||
          this.port.assignments().some((assignment) => assignment.mainRole === task.roleId) ||
          tasks.some((item) => item.loan?.mainRole === task.roleId)
        // Exactly what `board.demand` records: a free main candidate restarts the window.
        const unmetSinceMs =
          isDemand && isMainFree ? context.now : (task.unmetSinceMs ?? context.now)
        if (shouldRecord && isDemand) this.board.demand(task.id, context.now, isMainFree)
        let conditions = selection === undefined ? undefined : selectionConditions(selection)
        if (selection !== undefined && conditions !== undefined) {
          // A review's captured identities belong to that review, including borrowed agents.
          const authors = lists
            .flatMap((list) => list.pool)
            .filter(
              (candidate) =>
                isTaskAuthor(
                  candidate.id,
                  selection.engine?.(candidate) ??
                    candidate.agent?.model ??
                    selection.defaultAgent.modelId,
                  conditions,
                ) ||
                isTaskAuthor(
                  candidate.id,
                  candidate.agent?.model ?? selection.defaultAgent.modelId,
                  conditions,
                ),
            )
          conditions = {
            ...conditions,
            authorCandidates: [
              ...new Set([
                ...(conditions.authorCandidates ?? []),
                ...authors.map((candidate) => candidate.id),
              ]),
            ],
          }
        }
        return {
          taskId: task.id,
          roleId: task.roleId,
          queuedAtMs: task.readyAt ?? task.createdAt,
          unmetSinceMs,
          mainCandidateFree: isMainFree,
          preference:
            lists
              .find((list) => list.role === task.roleId)
              ?.pool.map((candidate) => candidate.id) ?? [],
          ...(conditions !== undefined && { conditions }),
        }
      })
    const cooldowns = this.board.snapshot().borrowCooldowns ?? []
    const assignments = [...this.port.assignments()]
    for (const task of tasks) {
      const loan = task.loan
      if (loan?.attempt !== task.currentAttempt) continue
      const retained = {
        candidateId: loan.candidateId,
        mainRole: loan.mainRole,
        secondaryRoles: [task.roleId],
      }
      const index = assignments.findIndex((item) => item.candidateId === loan.candidateId)
      if (index === -1) assignments.push(retained)
      else assignments[index] = retained
    }
    const agents: BorrowAgent[] = assignments.map((assignment) => {
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
      const identities = running === undefined ? undefined : context.selection?.(running)
      const isBorrowed =
        (running?.loan?.candidateId === assignment.candidateId ||
          running?.handoff?.chain.some(
            (link) =>
              link.kind === 'borrow' &&
              link.candidateId === assignment.candidateId &&
              link.atMs === attempt?.startedAt,
          )) ??
        false
      const endedAt = cooldowns.find((row) => row.candidateId === assignment.candidateId)?.endedAtMs
      return {
        ...assignment,
        engine:
          (candidate === undefined ? undefined : identities?.engine?.(candidate)) ??
          attempt?.modelId ??
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
    const producing: BorrowProducingTask[] = []
    for (const task of tasks) {
      const attempt = task.attempts.at(-1)
      const produces = this.port.produces(task)
      if (attempt === undefined || produces === undefined || task.state !== 'running') continue
      producing.push({
        taskId: task.id,
        roleId: task.roleId,
        startedAtMs: attempt.startedAt,
        timeBoxMs: this.timeBox(task, lists),
        produces,
      })
    }
    return { nowMs: context.now, agents, queued, producing, roles }
  }

  private authorization(candidate: TeamCandidate, entry: SchedulerEntry): string {
    return JSON.stringify([
      this.port.assignments().find((item) => item.candidateId === candidate.id),
      candidate,
      entry.id,
      entry.roleId,
      entry.agentProfileId,
      entry.modelId,
      entry.kind,
    ])
  }

  /**
  The lender while its assignment lists the task's role and its candidate
  and home entry exist; with a loan, while they still match its fingerprint.
  */
  private authorized(
    context: PickContext,
    task: TeamBoardTask,
    lender: LoanLender,
    lists: readonly TeamPreferenceList[],
    loan: TeamBoardTask['loan'],
  ): LoanAdmission {
    const assignment = this.port
      .assignments()
      .find((item) => item.candidateId === lender.candidateId && item.mainRole === lender.mainRole)
    const candidate = lists
      .find((list) => list.role === lender.mainRole)
      ?.pool.find((item) => item.id === lender.candidateId)
    const home = context.entries.find(
      (item) => item.id === lender.candidateId && item.roleId === lender.mainRole,
    )
    if (candidate === undefined || home === undefined)
      return refused('authorization', { candidateId: lender.candidateId, reason: 'nodeOffline' })
    return assignment?.secondaryRoles.includes(task.roleId) === true &&
      home.eligible(task) &&
      (loan === undefined || this.authorization(candidate, home) === loan.authorization)
      ? { kind: 'admitted', candidate, home }
      : refused('authorization', { candidateId: lender.candidateId, reason: 'conditions' })
  }

  /**
  D212's admission predicate for one task and one lender: every fact a loan
  rests on except the capacity selection counts once (turn, caps,
  concurrency, slot). Selection reads it before ranking and reserving;
  the final gate reads only it, so the two cannot disagree. A `held`
  attempt is this admission's own and is set aside exactly once from the
  lender's live occupancy. `facts` carries D212's lending conditions.
  */
  private admission(
    context: PickContext,
    task: TeamBoardTask,
    lender: LoanLender,
    lists: readonly TeamPreferenceList[],
    reservation: { readonly loan: TeamBoardTask['loan']; readonly held?: TeamAttempt },
    facts: BorrowSnapshot,
  ): LoanAdmission {
    const authorized = this.authorized(context, task, lender, lists, reservation.loan)
    if (authorized.kind === 'refused') return authorized
    const supplied = context.selection?.(task)
    const { candidate, home } = authorized
    const skip = (reason: TeamSkip['reason']): TeamSkip => ({
      candidateId: candidate.id,
      reason,
    })
    if (supplied?.preference === undefined || supplied.availability === undefined)
      return refused('authorization', skip('conditions'))
    const conditions = selectionConditions(supplied)
    const selection: TeamSelectionSnapshot = {
      ...supplied,
      nowMs: context.now,
      ...(conditions !== undefined && { conditions }),
    }
    const agent = candidateAgent(candidate, selection)
    const held = reservation.held
    if (
      home.agentProfileId !== agent.key ||
      !isSameTeamModel(home.modelId, agent.modelId) ||
      home.kind !== agent.kind ||
      (held !== undefined &&
        (held.agentProfileId !== home.agentProfileId ||
          held.modelId !== home.modelId ||
          held.kind !== home.kind))
    )
      return refused('identity', skip('unhealthy'))
    const live = liveCandidateSkip(candidate, agent, selection)
    if (live !== undefined)
      return refused(
        live.reason === 'author' || live.reason === 'conditions' ? live.reason : 'availability',
        live,
      )
    const mark = selection.marks.at(agent.key, context.now)
    if (mark !== undefined)
      return refused('limit', {
        ...skip(mark.kind === 'rateLimited' ? 'rateLimited' : 'capped'),
        untilMs: mark.untilMs,
      })
    if (!selection.isAgentAvailable(agent)) return refused('agent', skip('signedOut'))
    const own = held === undefined ? 0 : 1
    if (
      (selection.runningByAgent.get(agent.key) ?? 0) > own ||
      (selection.runningByEntry.get(home.id) ?? 0) > own
    )
      return refused('idle', skip('busy'))
    const decision = decideBorrow(
      { ...facts, agents: facts.agents.filter((item) => item.candidateId === candidate.id) },
      task.id,
    )[0]
    if (decision?.kind === 'borrow' && decision.candidateId === candidate.id) return authorized
    return {
      kind: 'refused',
      fact: lendingFact(
        decision,
        facts.queued.some((item) => item.taskId === task.id && item.mainCandidateFree),
      ),
    }
  }

  private recordRecalls(snapshot: BorrowSnapshot, invalid: ReadonlySet<string>): void {
    for (let decision of decideRecall(snapshot)) {
      const task = this.board.task(decision.taskId)
      if (invalid.has(task.id)) {
        const wait =
          snapshot.roles.get(task.loan?.mainRole ?? '')?.timers?.recallWaitMs ??
          TEAM_BORROW_RECALL_WAIT_MS
        const deadlineMs = (task.recallAskedAtMs ?? snapshot.nowMs) + wait
        decision =
          snapshot.nowMs >= deadlineMs
            ? { kind: 'stop', candidateId: decision.candidateId, taskId: task.id }
            : { kind: 'recall', candidateId: decision.candidateId, taskId: task.id, deadlineMs }
      }
      if (decision.kind === 'recall') this.board.recallAsked(task.id, snapshot.nowMs)
      else if (decision.kind === 'keep') this.board.recallAsked(task.id, undefined)
      const key = JSON.stringify([task.id, task.currentAttempt])
      const signature = JSON.stringify(decision)
      const previous = this.lastRecall.get(key)
      if (
        previous === undefined &&
        decision.kind === 'keep' &&
        snapshot.queued.every((queued) => queued.roleId !== task.loan?.mainRole)
      )
        continue
      let hasPendingCancellation = false
      for (const event of this.pending.values()) {
        if (
          event.taskId !== task.id ||
          event.attempt !== task.currentAttempt ||
          event.decision.kind !== 'keep' ||
          event.decision.reason !== 'mainCandidateFree'
        )
          continue
        hasPendingCancellation = true
      }
      if (hasPendingCancellation && decision.kind === 'keep' && decision.reason === 'noMainWork')
        continue
      const number =
        previous?.signature === signature ? previous.number : (previous?.number ?? 0) + 1
      const id = JSON.stringify([task.id, task.currentAttempt, number])
      this.lastRecall.set(key, { signature, number })
      // A projection can supersede an undelivered decision in the same drain.
      for (const [pendingId, event] of this.pending)
        if (event.taskId === task.id && event.attempt === task.currentAttempt)
          this.pending.delete(pendingId)
      if (!this.delivered.has(id))
        this.pending.set(id, {
          id,
          taskId: task.id,
          attempt: task.currentAttempt,
          atMs: snapshot.nowMs,
          decision,
        })
    }
  }

  private project(context: PickContext, tasks: readonly TeamBoardTask[]): PickContext {
    const borrowed = new Map<string, { candidate: TeamCandidate; entry: SchedulerEntry }>()
    const lists = this.port.lists()
    const snapshot = this.snapshot(context, tasks, lists)
    const invalid = new Set<string>()
    for (const task of tasks) {
      const proposed = task.loan
      if (proposed === undefined) continue
      if (proposed.attempt === task.currentAttempt) {
        if (this.authorized(context, task, proposed, lists, proposed).kind === 'refused')
          invalid.add(task.id)
        continue
      }
      const lender =
        task.state === 'ready' && !task.held
          ? this.admission(context, task, proposed, lists, { loan: proposed }, snapshot)
          : undefined
      if (lender?.kind !== 'admitted') {
        this.board.loan(task.id, undefined)
        continue
      }
      const taskId = task.id
      const home = lender.home
      borrowed.set(taskId, {
        candidate: lender.candidate,
        entry: {
          ...home,
          roleId: task.roleId,
          eligible: (item) => item.id === taskId && home.eligible(item),
        },
      })
    }
    this.recordRecalls(snapshot, invalid)
    if (borrowed.size === 0) return context
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

  async tick(context: PickContext, journal: () => Promise<void>): Promise<PickContext> {
    const tasks = this.board.snapshot().tasks
    for (const task of tasks)
      if (task.loan !== undefined && task.loan.attempt > task.currentAttempt)
        this.board.loan(task.id, undefined)
    if (
      this.port.assignments().every((assignment) => assignment.secondaryRoles.length === 0) &&
      tasks.every((task) => task.loan === undefined)
    )
      return context
    const lists = this.port.lists()
    const snapshot = this.snapshot(context, tasks, lists)
    const taken = new Set<string>()
    const decisions: BorrowDecision[] = []
    const ordered = snapshot.queued.toSorted(
      (a, b) => a.queuedAtMs - b.queuedAtMs || a.taskId.localeCompare(b.taskId),
    )
    for (const queued of ordered) {
      const task = this.board.task(queued.taskId)
      if (context.selection?.(task).preference === undefined) continue
      // Each lender passes the same admission predicate as the final gate,
      // then capacity; decideBorrow ranks the lenders that remain.
      const admitted = new Map<string, { candidate: TeamCandidate; home: SchedulerEntry }>()
      const agents = snapshot.agents.map((agent): BorrowAgent => {
        if (
          agent.running !== undefined ||
          agent.mainRole === task.roleId ||
          !agent.secondaryRoles.includes(task.roleId)
        )
          return agent
        if (taken.has(agent.candidateId))
          return { ...agent, skip: { candidateId: agent.candidateId, reason: 'busy' } }
        const admission = this.admission(context, task, agent, lists, { loan: undefined }, snapshot)
        if (admission.kind === 'refused')
          return admission.skip === undefined ? agent : { ...agent, skip: admission.skip }
        admitted.set(agent.candidateId, admission)
        const result = selectTeamEntry(
          { roleId: task.roleId, entries: [], policy: 'queue', continueOnNext: false },
          this.selection(context, task, admission.candidate),
          TEAM_TASKS_PER_TURN_DEFAULT,
        )
        const skip = result.kind === 'exhausted' ? result.skips?.[0] : undefined
        return { ...agent, ...(skip !== undefined && { skip }) }
      })
      const decision = decideBorrow({ ...snapshot, agents }, task.id)[0]
      if (decision === undefined) continue
      decisions.push(decision)
      if (decision.kind !== 'borrow') continue
      const lender = admitted.get(decision.candidateId)
      if (lender === undefined) throw new Error('team:borrowCandidateMissing')
      const { candidate, home } = lender
      taken.add(decision.candidateId)
      this.board.loan(task.id, {
        candidateId: candidate.id,
        mainRole: home.roleId,
        authorization: this.authorization(candidate, home),
        attempt: task.currentAttempt + 1,
      })
    }
    this.port.decisions(decisions)
    this.apply(context)
    await journal()
    return this.apply(context)
  }

  /** Recheck proposed lenders against fresh facts without another borrow/recall tick. */
  apply(context: PickContext): PickContext {
    return this.project(context, this.board.snapshot().tasks)
  }

  /**
  The final launch gate for a held loan (D212): the board must still carry
  the loan the reservation holds, unrecalled, on this running attempt, and
  the admission predicate selection used must still hold. Nothing is
  selected or counted again: the lender's turn, caps, concurrency and slot
  belong to this admission. Answers the first refusing fact, if any. Reads
  only: no demand, loan, recall or selection callback is written.
  */
  validate(
    context: PickContext,
    task: TeamBoardTask,
    held: TeamBoardTask['loan'],
  ): LoanFact | undefined {
    const loan = task.loan
    const attempt = task.attempts.at(-1)
    if (
      held === undefined ||
      loan === undefined ||
      attempt === undefined ||
      loan.candidateId !== held.candidateId ||
      loan.mainRole !== held.mainRole ||
      loan.authorization !== held.authorization ||
      loan.attempt !== held.attempt ||
      loan.attempt !== task.currentAttempt ||
      attempt.number !== loan.attempt ||
      attempt.state !== 'running' ||
      attempt.entryId !== loan.candidateId ||
      task.recallAskedAtMs !== undefined
    )
      return 'reservation'
    if (context.selection === undefined) return 'authorization'
    // The task as selection saw it: its unstarted attempt set aside, so the
    // board reads the lender as idle for its own loan.
    const ready: TeamBoardTask = {
      ...task,
      state: 'ready',
      currentAttempt: task.currentAttempt - 1,
      attempts: task.attempts.slice(0, -1),
    }
    const lists = this.port.lists()
    const tasks = this.board.snapshot().tasks.map((item) => (item.id === task.id ? ready : item))
    // Main candidates are asked whether this admission could move to them, so
    // its own running place and turn are set aside for this task alone. Reading
    // facts reports no selection to the roster.
    const select = context.selection.bind(context)
    const quiet: PickContext = {
      ...context,
      selection: (item) => {
        const live = select(item)
        if (item.id !== task.id) return live
        const entries = new Map(live.runningByEntry)
        const agents = new Map(live.runningByAgent)
        entries.set(attempt.entryId, Math.max(0, (entries.get(attempt.entryId) ?? 0) - 1))
        agents.set(
          attempt.agentProfileId,
          Math.max(0, (agents.get(attempt.agentProfileId) ?? 0) - 1),
        )
        return {
          ...live,
          startedThisTurn: Math.max(0, live.startedThisTurn - 1),
          runningByEntry: entries,
          runningByAgent: agents,
          global: { ...live.global, running: Math.max(0, live.global.running - 1) },
          process: {
            ...live.process,
            running: Math.max(0, live.process.running - (attempt.kind === 'engine' ? 0 : 1)),
          },
        }
      },
    }
    delete quiet.selected
    const facts = this.snapshot(quiet, tasks, lists, false)
    const admission = this.admission(context, ready, loan, lists, { loan, held: attempt }, facts)
    return admission.kind === 'refused' ? admission.fact : undefined
  }

  /** The scheduler clears its drain before delivering; callbacks may wake or retire. */
  async deliver(): Promise<void> {
    if (this.delivering) return
    this.delivering = true
    try {
      for (const [id, event] of this.pending) {
        this.pending.delete(id)
        this.delivered.set(id, event)
        await this.port.recall(event)
      }
    } finally {
      this.delivering = false
    }
  }

  started(task: TeamBoardTask, entry: SchedulerEntry, nowMs: number): void {
    const loan = this.board.task(task.id).loan
    if (loan?.candidateId !== entry.id) return
    this.board.appendChain(task.id, {
      kind: 'borrow',
      atMs: nowMs,
      candidateId: entry.id,
      mainRole: loan.mainRole,
      borrowingRole: task.roleId,
    })
  }

  retired(task: TeamBoardTask, attemptNumber: number): void {
    this.lastRecall.delete(JSON.stringify([task.id, attemptNumber]))
    for (const [id, event] of this.delivered)
      if (event.taskId === task.id && event.attempt === attemptNumber) this.delivered.delete(id)
    const attempt = task.attempts.find((item) => item.number === attemptNumber)
    if (attempt?.endedAt === undefined) return
    const wasBorrowed = task.handoff?.chain.some(
      (link) =>
        link.kind === 'borrow' &&
        link.candidateId === attempt.entryId &&
        link.atMs === attempt.startedAt,
    )
    if (!wasBorrowed) return
    this.board.borrowEnded(attempt.entryId, attempt.endedAt)
    if (task.loan?.attempt === attemptNumber) this.board.loan(task.id, undefined)
  }
}
