import {
  isTaskAuthor,
  canMeetTaskConditions,
  teamBorrowTimersSchema,
  type TeamBorrowTimers,
  type TeamCandidateConditions,
  type TeamHandoffRecord,
  type TeamSkip,
  type TeamTaskConditions,
} from '../../shared/teamPreference'
// D212's borrow and recall decisions (M120 lane 0): pure functions over a
// snapshot and the caller's clock. No timers here; lane S calls both decisions
// on each scheduler tick with `nowMs`; lane H executes the recall event.
//
// Windows are half-open: "at least" a wait holds at the wait itself, and
// "within" a window holds strictly before its end. A demand that has waited
// 60 s borrows and one at 59.999 s does not; main-role work due in 9:59 keeps
// the agent home and work due in 10:00 does not.

/** A task an agent is running now. */
export interface BorrowRunningTask {
  readonly taskId: string
  readonly roleId: string
  readonly startedAtMs: number
  readonly timeBoxMs: number
  /** True when the agent runs it for a secondary role. */
  readonly borrowed: boolean
  /** When the main role asked for the agent back, if it has. */
  readonly recallAskedAtMs?: number
}

/** One agent (a D103 candidate) with its D212 roles and live state. */
export interface BorrowAgent {
  readonly candidateId: string
  /** The engine identity review ≠ author compares. */
  readonly engine: string
  readonly mainRole: string
  readonly secondaryRoles: readonly string[]
  readonly conditions?: TeamCandidateConditions
  /** Under its own caps and the team's, for one more task. */
  readonly underCaps: boolean
  /** Lane S's live selector refusal, preserved for the roster/panel. */
  readonly skip?: TeamSkip
  readonly running?: BorrowRunningTask
  /** When its last borrowed task ended. */
  readonly lastBorrowEndedAtMs?: number
}

/** A queued task: the demand side, and main-role work due now. */
export interface BorrowQueuedTask {
  readonly taskId: string
  readonly roleId: string
  readonly queuedAtMs: number
  /** Since when every main candidate has been busy, capped, limited or unavailable, without a break. */
  readonly unmetSinceMs: number
  /** A candidate on the role's own preference list can take it now. */
  readonly mainCandidateFree: boolean
  /** The role's preference list, candidate ids in order. */
  readonly preference: readonly string[]
  readonly conditions?: TeamTaskConditions
}

/** A running task that will produce work for another role when it ends (coding → review, review → fix). */
export interface BorrowProducingTask {
  readonly taskId: string
  readonly roleId: string
  readonly startedAtMs: number
  readonly timeBoxMs: number
  readonly produces: { readonly roleId: string; readonly conditions?: TeamTaskConditions }
}

/** A role's D212 settings and its recorded median task duration. */
export interface BorrowRoleFacts {
  readonly timers?: TeamBorrowTimers
  readonly medianDurationMs?: number
}

export interface BorrowSnapshot {
  readonly nowMs: number
  readonly agents: readonly BorrowAgent[]
  readonly queued: readonly BorrowQueuedTask[]
  readonly producing: readonly BorrowProducingTask[]
  readonly roles: ReadonlyMap<string, BorrowRoleFacts>
}

export type BorrowDecision =
  | {
      readonly kind: 'borrow'
      readonly taskId: string
      readonly roleId: string
      readonly candidateId: string
      readonly skips: readonly TeamSkip[]
    }
  | {
      readonly kind: 'none'
      readonly taskId: string
      readonly roleId: string
      /** `demandYoung`: under the demand wait; `mainFree`: a main candidate is or was free inside it. */
      readonly reason: 'demandYoung' | 'mainFree' | 'noLender'
      readonly untilMs?: number
      readonly skips: readonly TeamSkip[]
    }

export type RecallDecision =
  | {
      readonly kind: 'keep'
      readonly candidateId: string
      readonly taskId: string
      readonly reason: 'noMainWork' | 'mainCandidateFree'
    }
  | {
      readonly kind: 'finish'
      readonly candidateId: string
      readonly taskId: string
      readonly expectedFinishMs: number
    }
  | {
      readonly kind: 'recall'
      readonly candidateId: string
      readonly taskId: string
      /** Stop and capture if no safe point comes by then. */
      readonly deadlineMs: number
    }
  | { readonly kind: 'stop'; readonly candidateId: string; readonly taskId: string }

const defaultTimers: TeamBorrowTimers = teamBorrowTimersSchema.parse({})

function timersOf(snapshot: BorrowSnapshot, roleId: string): TeamBorrowTimers {
  return snapshot.roles.get(roleId)?.timers ?? defaultTimers
}

/** Start plus the role's median, never past the time box; the box alone without a median. */
export function expectedFinishMs(
  task: Pick<BorrowRunningTask, 'roleId' | 'startedAtMs' | 'timeBoxMs'>,
  roles: BorrowSnapshot['roles'],
): number {
  const median = roles.get(task.roleId)?.medianDurationMs
  return (
    task.startedAtMs + (median === undefined ? task.timeBoxMs : Math.min(median, task.timeBoxMs))
  )
}

function canTake(agent: BorrowAgent, conditions: TeamTaskConditions | undefined): boolean {
  return (
    canMeetTaskConditions(agent.conditions, conditions) &&
    !isTaskAuthor(agent.candidateId, agent.engine, conditions)
  )
}

/**
Time until the agent's next main-role work: 0 for a queued main-role task
it can take, else the earliest expected finish of a running task that will
produce main-role work for it, else Infinity.
*/
export function nextMainWorkInMs(agent: BorrowAgent, snapshot: BorrowSnapshot): number {
  if (
    snapshot.queued.some(
      (task) => task.roleId === agent.mainRole && canTake(agent, task.conditions),
    )
  ) {
    return 0
  }
  let next = Infinity
  for (const task of snapshot.producing) {
    if (task.produces.roleId === agent.mainRole && canTake(agent, task.produces.conditions)) {
      next = Math.min(next, Math.max(0, expectedFinishMs(task, snapshot.roles) - snapshot.nowMs))
    }
  }
  return next
}

function lenderSkip(
  agent: BorrowAgent,
  task: BorrowQueuedTask,
  snapshot: BorrowSnapshot,
  taken: ReadonlySet<string>,
  nextMs: number,
): TeamSkip | undefined {
  if (agent.skip !== undefined) return agent.skip
  const id = agent.candidateId
  const main = timersOf(snapshot, agent.mainRole)
  if (agent.running !== undefined || taken.has(id)) {
    return { candidateId: id, reason: 'busy' }
  }
  if (
    agent.lastBorrowEndedAtMs !== undefined &&
    snapshot.nowMs - agent.lastBorrowEndedAtMs < main.cooldownMs
  ) {
    return {
      candidateId: id,
      reason: 'borrowCooldown',
      untilMs: agent.lastBorrowEndedAtMs + main.cooldownMs,
    }
  }
  if (!agent.underCaps) {
    return { candidateId: id, reason: 'capped' }
  }
  if (!canMeetTaskConditions(agent.conditions, task.conditions)) {
    return { candidateId: id, reason: 'conditions' }
  }
  if (isTaskAuthor(id, agent.engine, task.conditions)) {
    return { candidateId: id, reason: 'author' }
  }
  // Queued main-role work always keeps the agent home, whatever the
  // lookahead (0 included): the lookahead only covers work that is not
  // queued yet (a producing task's expected finish).
  if (
    snapshot.queued.some(
      (queued) => queued.roleId === agent.mainRole && canTake(agent, queued.conditions),
    )
  ) {
    return { candidateId: id, reason: 'mainWorkDue', untilMs: snapshot.nowMs }
  }
  return nextMs < main.lookaheadMs
    ? { candidateId: id, reason: 'mainWorkDue', untilMs: snapshot.nowMs + nextMs }
    : undefined
}

/** Longer time to main-role work first; Infinity ties with Infinity. */
function idlestFirst(left: number, right: number): number {
  if (left === right) {
    return 0
  }
  return left > right ? -1 : 1
}

function rankOf(list: readonly string[], id: string): number {
  const at = list.indexOf(id)
  return at === -1 ? list.length : at
}

/**
For each queued task, oldest first: the agent to borrow, or why none is.
A task borrows only after the demand wait, with every main candidate
unmet the whole time. Lenders list the role as a secondary role, are idle,
out of cooldown, under caps, meet the conditions, did not author the work
and have no main-role work due within the lookahead. The idlest main role
goes first, then the agent's secondary-role order, then the borrowing
role's preference order. One task per borrow.
*/
export function decideBorrow(
  snapshot: BorrowSnapshot,
  demandTaskId?: string,
): readonly BorrowDecision[] {
  const now = snapshot.nowMs
  const taken = new Set<string>()
  const ordered = snapshot.queued
    .filter((task) => demandTaskId === undefined || task.taskId === demandTaskId)
    .toSorted(
      (left, right) =>
        left.queuedAtMs - right.queuedAtMs || left.taskId.localeCompare(right.taskId),
    )
  return ordered.map((task): BorrowDecision => {
    const wait = timersOf(snapshot, task.roleId).demandWaitMs
    const base = { taskId: task.taskId, roleId: task.roleId }
    if (now - task.queuedAtMs < wait) {
      return {
        kind: 'none',
        ...base,
        reason: 'demandYoung',
        untilMs: task.queuedAtMs + wait,
        skips: [],
      }
    }
    if (task.mainCandidateFree) {
      return { kind: 'none', ...base, reason: 'mainFree', skips: [] }
    }
    if (now - task.unmetSinceMs < wait) {
      return {
        kind: 'none',
        ...base,
        reason: 'mainFree',
        untilMs: task.unmetSinceMs + wait,
        skips: [],
      }
    }
    const skips: TeamSkip[] = []
    const ready: { readonly agent: BorrowAgent; readonly nextMs: number }[] = []
    for (const agent of snapshot.agents) {
      if (agent.mainRole === task.roleId || !agent.secondaryRoles.includes(task.roleId)) {
        continue
      }
      const nextMs = nextMainWorkInMs(agent, snapshot)
      const skip = lenderSkip(agent, task, snapshot, taken, nextMs)
      if (skip === undefined) {
        ready.push({ agent, nextMs })
      } else {
        skips.push(skip)
      }
    }
    const best = ready.toSorted(
      (left, right) =>
        idlestFirst(left.nextMs, right.nextMs) ||
        rankOf(left.agent.secondaryRoles, task.roleId) -
          rankOf(right.agent.secondaryRoles, task.roleId) ||
        rankOf(task.preference, left.agent.candidateId) -
          rankOf(task.preference, right.agent.candidateId) ||
        left.agent.candidateId.localeCompare(right.agent.candidateId),
    )[0]
    if (best === undefined) {
      return { kind: 'none', ...base, reason: 'noLender', skips }
    }
    taken.add(best.agent.candidateId)
    return { kind: 'borrow', ...base, candidateId: best.agent.candidateId, skips }
  })
}

/**
For each borrowed agent: keep the borrow, let the task finish within the
finish grace, recall it at the next safe point by the recall wait, or stop
and capture after it. The main role takes an agent back only for queued
work it can take that no main candidate can. Unmet tasks pair with
borrowed agents by maximum bipartite matching; agents already asked go
first, then the earliest to finish, only as a deterministic tie-break
among maximum matchings. The finish grace counts from when unmet
main-role work first appeared for that agent: the task finishes only
while now and its expected finish are both inside that window.
*/
export function decideRecall(snapshot: BorrowSnapshot): readonly RecallDecision[] {
  const now = snapshot.nowMs
  const borrowed = snapshot.agents
    .filter(
      (entry): entry is typeof entry & { running: NonNullable<typeof entry.running> } =>
        entry.running?.borrowed === true,
    )
    .map(({ running, ...agent }) => ({
      agent,
      running,
      finishMs: expectedFinishMs(running, snapshot.roles),
    }))
    .toSorted(
      (left, right) =>
        (left.running.recallAskedAtMs ?? Infinity) - (right.running.recallAskedAtMs ?? Infinity) ||
        left.finishMs - right.finishMs ||
        left.agent.candidateId.localeCompare(right.agent.candidateId),
    )
  const queued = snapshot.queued.toSorted(
    (left, right) => left.queuedAtMs - right.queuedAtMs || left.taskId.localeCompare(right.taskId),
  )
  // Unmet main-role work: queued with no main candidate free, oldest first.
  const unmet = queued.filter((task) => !task.mainCandidateFree)
  const canPair = (agentIdx: number, taskIdx: number): boolean => {
    const entry = borrowed[agentIdx]
    const task = unmet[taskIdx]
    return (
      task?.roleId === entry?.agent.mainRole &&
      entry !== undefined &&
      task !== undefined &&
      canTake(entry.agent, task.conditions)
    )
  }
  // Kuhn's augmenting paths: agents go in priority order and each scans
  // tasks oldest-first, so that order only breaks ties among maximum
  // matchings. Tiny at this size.
  const matchOfTask: number[] = unmet.map(() => -1)
  const matchOfAgent: number[] = borrowed.map(() => -1)
  // True when the agent takes a task, recording the pairing on success.
  const canMatch = (agentIdx: number, seen: boolean[]): boolean => {
    for (let taskIdx = 0; taskIdx < unmet.length; taskIdx += 1) {
      if (seen[taskIdx] === true || !canPair(agentIdx, taskIdx)) {
        continue
      }
      seen[taskIdx] = true
      const other = matchOfTask[taskIdx]
      if (other === undefined || other === -1 || canMatch(other, seen)) {
        matchOfTask[taskIdx] = agentIdx
        matchOfAgent[agentIdx] = taskIdx
        return true
      }
    }
    return false
  }
  for (let agentIdx = 0; agentIdx < borrowed.length; agentIdx += 1) {
    canMatch(
      agentIdx,
      unmet.map(() => false),
    )
  }
  return borrowed.map((entry, agentIdx): RecallDecision => {
    const { agent, running, finishMs } = entry
    const base = { candidateId: agent.candidateId, taskId: running.taskId }
    if (matchOfAgent[agentIdx] === -1) {
      const work = queued.filter(
        (task) => task.roleId === agent.mainRole && canTake(agent, task.conditions),
      )
      return {
        kind: 'keep',
        ...base,
        reason: work.some((task) => task.mainCandidateFree) ? 'mainCandidateFree' : 'noMainWork',
      }
    }
    const timers = timersOf(snapshot, agent.mainRole)
    if (running.recallAskedAtMs !== undefined) {
      return now - running.recallAskedAtMs >= timers.recallWaitMs
        ? { kind: 'stop', ...base }
        : { kind: 'recall', ...base, deadlineMs: running.recallAskedAtMs + timers.recallWaitMs }
    }
    // When unmet main-role work first appeared for this agent: the earliest
    // unmetSinceMs it can take, recorded on the queue. The task finishes
    // only while now is inside that window and its expected finish is inside
    // it too; a task already past its expected finish gets no grace.
    let demandSince = Infinity
    for (const task of unmet) {
      if (task.roleId === agent.mainRole && canTake(agent, task.conditions)) {
        demandSince = Math.min(demandSince, task.unmetSinceMs)
      }
    }
    const windowEnd = demandSince + timers.finishGraceMs
    return finishMs > now && now < windowEnd && finishMs < windowEnd
      ? { kind: 'finish', ...base, expectedFinishMs: finishMs }
      : { kind: 'recall', ...base, deadlineMs: now + timers.recallWaitMs }
  })
}

/**
Every candidate that wrote a task's work: the one it started on, each move's
target and each borrowed agent. A review of the task excludes them all and
their engines.
*/
export function taskAuthorCandidates(startedOn: string, record: TeamHandoffRecord): string[] {
  const authors = new Set([startedOn])
  for (const entry of record.chain) {
    if (entry.kind === 'move') {
      authors.add(entry.toCandidateId)
    } else if (entry.kind === 'borrow') {
      authors.add(entry.candidateId)
    }
  }
  return [...authors]
}
