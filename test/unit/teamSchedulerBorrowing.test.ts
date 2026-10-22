import { describe, expect, it } from 'vitest'
import {
  TeamAgentMarks,
  TeamScheduler,
  type SchedulerDependencies,
  type TeamSelectionSnapshot,
  answerExhausted,
} from '../../src/core/team/teamPool'
import { TeamLiveAvailability, selectTeamEntry } from '../../src/core/team/selection'
import { pickReviewer } from '../../src/core/team/reviewerPick'
import { isSameTeamModel } from '../../src/core/team/sameModel'
import { SchedulerSlots } from '../../src/core/team/scheduler/slots'
import type {
  LoanFact,
  SchedulerBorrowPort,
  SchedulerRecallEvent,
} from '../../src/core/team/scheduler/borrowing'
import { LOAN_FACTS, SchedulerBorrowing } from '../../src/core/team/scheduler/borrowing'
import { TaskPicker } from '../../src/core/team/scheduler/pick'
import type { TeamTaskConditions } from '../../src/shared/teamPreference'
import { teamBoardSchema, type TeamBoardTask } from '../../src/shared/team'
import type { TeamBoard } from '../../src/shared/team'
import {
  TEAM_BORROW_DEMAND_WAIT_MS,
  TEAM_BORROW_RECALL_WAIT_MS,
  TEAM_BORROW_COOLDOWN_MS,
  TEAM_MINUTE_MS,
  TEAM_SCHED_TICK_MS,
  TEAM_TASKS_PER_TURN_DEFAULT,
} from '../../src/shared/constants'
import {
  TeamMeter,
  ZERO_TEAM_METER_USAGE,
  teamDayKey,
  type TeamMeterRow,
} from '../../src/core/team/teamMeter'
import type { TeamCap, TeamSelection } from '../../src/core/team/teamPool'
import {
  boardAttempt,
  callsOf,
  keyAgent,
  makeBoard,
  pickContext,
  preferencePoolList,
  rolePool,
  schedulerEntry,
  selectionSnapshot,
  submission,
  tapped,
} from './helpers/teamFixtures'

interface FixtureOptions {
  /** The borrowing role's tasks per turn, read back from the real meter. */
  readonly tasksPerTurn?: number
  /** The lender's own caps, read back from the real meter. */
  readonly reviewerCaps?: readonly TeamCap[]
  /** The lender sends work through Default; its home entry keeps Default's first identity. */
  readonly isDefaultLender?: boolean
}

function fixture(options: FixtureOptions = {}) {
  const clock = { now: 0 }
  // Every admission is a real meter row, keyed by its attempt; a refund removes exactly it.
  const rows: TeamMeterRow[] = []
  const counted = new Map<string, TeamMeterRow>()
  const thisTurn = new Set<TeamMeterRow>()
  const meter = new TeamMeter({ rows: () => rows, openReservations: () => [] })
  const isMetered = options.tasksPerTurn !== undefined || options.reviewerCaps !== undefined
  const { board, countAttempt, refundAttempt } = makeBoard(new Map(), {
    countAttempt: (task, attempt) => {
      const key = JSON.stringify([task.id, attempt.number])
      if (counted.has(key)) throw new Error('test:countedTwice')
      const row: TeamMeterRow = {
        kind: 'task',
        entryId: attempt.entryId,
        agentKey: attempt.agentProfileId,
        roleId: task.roleId,
        taskId: task.id,
        dayKey: teamDayKey(attempt.startedAt),
        startMs: attempt.startedAt,
        usage: { ...ZERO_TEAM_METER_USAGE, tasks: 1 },
        estimated: false,
      }
      rows.push(row)
      counted.set(key, row)
      thisTurn.add(row)
      return true
    },
    refundAttempt: (task, attempt) => {
      const key = JSON.stringify([task.id, attempt.number])
      const row = counted.get(key)
      if (row === undefined) throw new Error('test:refundUncounted')
      rows.splice(rows.indexOf(row), 1)
      counted.delete(key)
      thisTurn.delete(row)
    },
  })
  const leases = { taken: 0, released: 0 }
  const scheduled: { callback: () => void; ms: number }[] = []
  const engineering = preferencePoolList('engineering', ['coder'])
  const review = preferencePoolList('review', ['reviewer'])
  if (options.tasksPerTurn !== undefined) engineering.tasksPerTurn = options.tasksPerTurn
  const lender = review.pool[0]
  if (lender !== undefined && options.reviewerCaps !== undefined)
    lender.caps = [...options.reviewerCaps]
  if (lender !== undefined && options.isDefaultLender === true) delete lender.agent
  // Facts the selection snapshot reads beyond the board; tests change them live.
  const live = {
    defaultAgent: keyAgent({ key: 'default', label: 'Default (muse-spark-1.3)' }),
    marks: new TeamAgentMarks(),
    unavailableAgents: new Set<string>(),
    /** Occupancy outside this task board, per agent key. */
    elsewhere: new Map<string, number>(),
    conditions: new Map<string, TeamTaskConditions>(),
  }
  const firstDefault = live.defaultAgent
  const lists = [engineering, review]
  const signedOut = new Set(['coder'])
  const unavailable = new Set<string>()
  const assignments = [
    { candidateId: 'reviewer', mainRole: 'review', secondaryRoles: ['engineering'] },
  ]
  const events: SchedulerRecallEvent[] = []
  const port: SchedulerBorrowPort = {
    lists: () => lists,
    assignments: () => assignments,
    medianDurationMs: () => undefined,
    produces: () => undefined,
    recall: tapped((event: SchedulerRecallEvent) => {
      events.push(event)
      return Promise.resolve()
    }),
    decisions: tapped(() => undefined),
  }
  const slots = new SchedulerSlots('workspace', () => ({
    workers: 4,
    processWorkers: 4,
    role: () => 4,
    entry: () => 1,
    agent: () => 1,
  }))
  const deps: SchedulerDependencies = {
    borrowing: port,
    now: () => clock.now,
    context: () =>
      pickContext({
        entries: lists.flatMap((role) =>
          role.pool.map((candidate) =>
            schedulerEntry({
              id: candidate.id,
              roleId: role.role,
              agentProfileId: candidate.agent === undefined ? firstDefault.key : candidate.id,
              modelId: candidate.agent?.model ?? firstDefault.modelId,
            }),
          ),
        ),
        selection: (task) => {
          const running = board
            .snapshot()
            .tasks.flatMap((task) => task.attempts.filter((attempt) => attempt.state !== 'retired'))
          const preference = lists.find((role) => role.role === task.roleId)
          if (preference === undefined) throw new Error('test:role')
          const byAgent = new Map(running.map((attempt) => [attempt.agentProfileId, 1]))
          for (const [key, count] of live.elsewhere)
            byAgent.set(key, (byAgent.get(key) ?? 0) + count)
          const conditions = live.conditions.get(task.id)
          return {
            ...selectionSnapshot({
              nowMs: clock.now,
              taskId: task.id,
              runningByEntry: new Map(running.map((attempt) => [attempt.entryId, 1])),
              runningByAgent: byAgent,
              agentLimit: () => 1,
              defaultAgent: live.defaultAgent,
              marks: live.marks,
              available: (agent) => !live.unavailableAgents.has(agent.key),
              ...(isMetered && {
                startedThisTurn: [...thisTurn].filter((row) => row.roleId === task.roleId).length,
                used: (entryId: string, cap: TeamCap) =>
                  Number(
                    meter.used(entryId, cap, {
                      taskId: task.id,
                      dayKey: teamDayKey(clock.now),
                    }).value,
                  ),
              }),
            }),
            preference,
            availability: new TeamLiveAvailability((candidate) => ({
              signedIn: !signedOut.has(candidate.id),
              healthy: true,
              nodeOnline: true,
              admitted: !unavailable.has(candidate.id),
            })),
            ...(conditions !== undefined && { conditions }),
          }
        },
      }),
    headroom: () => 'lane',
    exhausted: tapped(() => undefined),
    lease: () => {
      leases.taken++
      return {
        release: () => {
          leases.released++
        },
      }
    },
    authorize: () => Promise.resolve(true),
    journal: tapped(() => Promise.resolve()),
    start: tapped((): Promise<'started'> => Promise.resolve('started')),
    uncertain: () => Promise.resolve(),
    schedule: tapped((callback: () => void, ms: number) => {
      scheduled.push({ callback, ms })
      return () => {
        const at = scheduled.findIndex((item) => item.callback === callback)
        if (at !== -1) scheduled.splice(at, 1)
      }
    }),
    failure: tapped(() => undefined),
    halveAgentCap: tapped(() => undefined),
  }
  return {
    board,
    clock,
    scheduled,
    deps,
    port,
    lists,
    signedOut,
    unavailable,
    assignments,
    slots,
    events,
    counted,
    countAttempt,
    refundAttempt,
    leases,
    live,
    scheduler: new TeamScheduler(board, slots, deps),
  }
}
/** Admissions, refunds and worker starts so far. */
function ledger(f: ReturnType<typeof fixture>) {
  return {
    admissions: callsOf(f.countAttempt).length,
    refunds: callsOf(f.refundAttempt).length,
    starts: callsOf(f.deps.start).length,
  }
}

/**
Every admission ended exactly once: started (its meter row, running slot
and lease remain) or released (refunded, with its slot and lease returned).
*/
function expectReservationsSettled(f: ReturnType<typeof fixture>): void {
  const { admissions, refunds, starts } = ledger(f)
  expect(admissions).toBe(starts + refunds)
  const started = callsOf(f.deps.start).map(([task]) =>
    JSON.stringify([task.id, task.currentAttempt]),
  )
  expect(new Set(started).size).toBe(started.length)
  expect(f.counted.size).toBe(started.length)
  expect(new Set(f.counted.keys())).toEqual(new Set(started))
  const slots = f.slots.snapshot()
  expect(slots).toHaveLength(started.length)
  expect(
    new Set(
      slots.map((slot) =>
        JSON.stringify([slot.request.taskId, slot.request.attempt, slot.state === 'running']),
      ),
    ),
  ).toEqual(
    new Set(
      callsOf(f.deps.start).map(([task]) => JSON.stringify([task.id, task.currentAttempt, true])),
    ),
  )
  expect(f.leases.taken - f.leases.released).toBe(starts)
}

/** Runs `run` after `depth` chained microtasks; depth 0 runs it at once. */
function afterMicrotasks(depth: number, run: () => void): void {
  if (depth === 0) {
    run()
    return
  }
  queueMicrotask(() => {
    afterMicrotasks(depth - 1, run)
  })
}

function microtasks(depth: number): Promise<void> {
  return new Promise((resolve) => {
    afterMicrotasks(depth, resolve)
  })
}

function borrowedStarts(f: ReturnType<typeof fixture>): number {
  return callsOf(f.deps.start).filter(
    ([, worker]) => worker.id === 'reviewer' && worker.roleId === 'engineering',
  ).length
}

function randomChoices(seed: number): (bound: number) => number {
  let state = seed * 48_271
  return (bound) => {
    state = (state * 48_271) % 2_147_483_647
    return Math.floor((state / 2_147_483_647) * bound)
  }
}

async function waitForBorrow(f: ReturnType<typeof fixture>): Promise<void> {
  f.board.submit([submission('coding')], 0)
  await f.scheduler.wake()
  f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
}

async function borrowCoding(f: ReturnType<typeof fixture>): Promise<void> {
  await waitForBorrow(f)
  await f.scheduler.wake()
}

function expectNoAttempt(f: ReturnType<typeof fixture>): void {
  expect(callsOf(f.deps.start)).toHaveLength(0)
  expect(f.board.task('coding').attempts).toEqual([])
  expect(f.slots.snapshot()).toEqual([])
}

function retireCoding(f: ReturnType<typeof fixture>): void {
  retireTask(f, f.board.task('coding'))
}

function retireTask(f: ReturnType<typeof fixture>, task: TeamBoardTask): void {
  f.board.finishAttempt(task.id, task.currentAttempt, {
    state: 'retired',
    endedAt: f.clock.now,
    retirement: { kind: 'proved', method: 'linuxCgroup' },
  })
  f.board.transition(task.id, task.currentAttempt, 'done', f.clock.now)
}

async function resetBorrowDemand(f: ReturnType<typeof fixture>): Promise<void> {
  f.board.pause()
  for (const task of f.board.snapshot().tasks) {
    if (task.state === 'running') {
      retireTask(f, task)
      await f.scheduler.retired({ taskId: task.id, attempt: task.currentAttempt })
    } else if (task.id !== 'coding') f.board.transition(task.id, 0, 'cancelled', f.clock.now)
  }
  f.signedOut.add('coder')
  if (f.assignments.length === 0)
    f.assignments.push({
      candidateId: 'reviewer',
      mainRole: 'review',
      secondaryRoles: ['engineering'],
    })
  f.board.resume()
  f.clock.now += TEAM_BORROW_DEMAND_WAIT_MS
}

function overrideSelection(
  f: ReturnType<typeof fixture>,
  change: (task: TeamBoardTask, snapshot: TeamSelectionSnapshot) => TeamSelectionSnapshot,
): void {
  const context = f.deps.context
  f.deps.context = () => {
    const base = context()
    return {
      ...base,
      selection: (task) => {
        const snapshot = base.selection?.(task)
        if (snapshot === undefined) throw new Error('test:selection')
        return change(task, snapshot)
      },
    }
  }
}

async function requestReview(f: ReturnType<typeof fixture>): Promise<void> {
  f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
  await f.scheduler.wake()
}

async function expectNoMainRecall(f: ReturnType<typeof fixture>): Promise<void> {
  await requestReview(f)
  expect(f.events.at(-1)?.decision).toMatchObject({ kind: 'keep', reason: 'noMainWork' })
  expect(f.board.task('coding').recallAskedAtMs).toBeUndefined()
}

function suspendJournal(f: ReturnType<typeof fixture>, shouldHold: (board: TeamBoard) => boolean) {
  const previous = f.deps.journal
  const writing = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<undefined>()
  let isHeld = false
  f.deps.journal = tapped(async (snapshot) => {
    await previous(snapshot)
    if (isHeld || !shouldHold(snapshot)) return
    isHeld = true
    writing.resolve(undefined)
    await finished.promise
  })
  return {
    writing: writing.promise,
    release: () => {
      finished.resolve(undefined)
    },
    restore: () => {
      f.deps.journal = previous
    },
  }
}

const revocations = [
  'assignment',
  'main work',
  'native recovery',
  'candidate',
  'admission',
  'selection',
  'cooldown',
] as const
type Revocation = (typeof revocations)[number]

function revoke(f: ReturnType<typeof fixture>, change: Revocation): void {
  switch (change) {
    case 'assignment': {
      f.assignments.length = 0
      break
    }
    case 'main work': {
      f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
      break
    }
    case 'native recovery': {
      f.signedOut.clear()
      break
    }
    case 'admission': {
      f.unavailable.add('reviewer')
      break
    }
    case 'candidate': {
      const candidate = f.lists[1]?.pool[0]
      if (candidate?.agent) candidate.agent.model = 'replacement-engine'
      break
    }
    case 'selection': {
      const context = f.deps.context
      f.deps.context = () => {
        const base = context()
        delete base.selection
        return base
      }
      break
    }
    case 'cooldown': {
      f.board.borrowEnded('reviewer', f.clock.now)
      break
    }
  }
}

const awaitPoints = ['borrowing journal', 'authorization', 'launch journal'] as const

/** Changes a fact once, `depth` microtasks into the named await before the borrowed launch. */
function revokeDuring(
  f: ReturnType<typeof fixture>,
  point: (typeof awaitPoints)[number],
  change: (() => void) | undefined,
  depth: number,
): { readonly isReached: () => boolean } {
  let isReached = false
  const hit = async (): Promise<void> => {
    isReached = true
    await microtasks(depth)
    change?.()
  }
  const journal = f.deps.journal
  f.deps.journal = tapped(async (snapshot) => {
    await journal(snapshot)
    const coding = snapshot.tasks.find((task) => task.id === 'coding')
    const isPoint =
      point === 'borrowing journal'
        ? coding?.state === 'ready' && coding.loan?.attempt === coding.currentAttempt + 1
        : point === 'launch journal' && coding?.state === 'running'
    if (isPoint && !isReached) await hit()
  })
  const authorize = f.deps.authorize
  f.deps.authorize = async (task, worker) => {
    if (!isReached && point === 'authorization' && task.id === 'coding' && worker.id === 'reviewer')
      await hit()
    return await authorize(task, worker)
  }
  return { isReached: () => isReached }
}

/**
A readiness wake arriving `depth` microtasks after the final journal write
(an empty drain) or after the first worker's start, with the oracle's facts.
*/
async function wakeAround(
  shape: 'final write' | 'worker start' | 'worker start, D75 port',
  depth: number,
) {
  const f = fixture()
  f.signedOut.clear()
  let inFlight = 0
  let maxInFlight = 0
  const tracked = async <T>(run: () => Promise<T>): Promise<T> => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      return await run()
    } finally {
      inFlight--
    }
  }
  const arrived = Promise.withResolvers<undefined>()
  let arrival: Promise<void> | undefined
  let isFirstSettled = false
  let isEarly = false
  let scheduler = f.scheduler
  const arrivalId = shape === 'final write' ? 'coding' : 'review'
  const arrive = (): void => {
    afterMicrotasks(depth, () => {
      isEarly = !isFirstSettled
      f.board.submit(
        [submission(arrivalId, { roleId: shape === 'final write' ? 'engineering' : 'review' })],
        f.clock.now,
      )
      arrival = scheduler.wake()
      arrived.resolve(undefined)
    })
  }
  let writes = 0
  const journal = f.deps.journal
  f.deps.journal = tapped((snapshot) =>
    tracked(() => {
      if (shape === 'final write' && ++writes === 2) arrive()
      return journal(snapshot)
    }),
  )
  const authorize = f.deps.authorize
  f.deps.authorize = (task, worker) => tracked(() => authorize(task, worker))
  f.deps.start = tapped((task) => {
    if (task.id === 'first') arrive()
    return Promise.resolve('started')
  })
  if (shape === 'worker start, D75 port') {
    const deps = { ...f.deps }
    delete deps.borrowing
    scheduler = new TeamScheduler(f.board, f.slots, deps)
  }
  if (shape !== 'final write') f.board.submit([submission('first')], 0)
  const first = (async () => {
    await scheduler.wake()
    isFirstSettled = true
  })()
  await Promise.all([first, arrived.promise])
  await arrival
  const started = callsOf(f.deps.start).map(([task]) => task.id)
  return {
    isEarly,
    facts: {
      arrival: f.board.task(arrivalId).state,
      starts: started.filter((id) => id === arrivalId).length,
      isStartedOnce: new Set(started).size === started.length,
      maxInFlight,
      ready: f.board.snapshot().tasks.filter((task) => task.state === 'ready').length,
    },
  }
}

describe('M120 borrowing through the real scheduler and pool', () => {
  it('starts in the same synchronous turn as the final loan check', async () => {
    const f = fixture()
    await waitForBorrow(f)
    let hasWritten = false
    let hasChecked = false
    f.deps.journal = tapped((snapshot) => {
      if (snapshot.tasks.some((task) => task.id === 'coding' && task.state === 'running'))
        hasWritten = true
      return Promise.resolve()
    })
    const context = f.deps.context
    f.deps.context = () => {
      if (hasWritten && !hasChecked) {
        hasChecked = true
        queueMicrotask(() => {
          f.assignments.length = 0
        })
      }
      return context()
    }
    f.deps.start = tapped(() => {
      expect(hasChecked).toBe(true)
      expect(f.assignments[0]?.secondaryRoles).toContain('engineering')
      return Promise.resolve('started' as const)
    })
    await f.scheduler.wake()
    expect(callsOf(f.deps.start)).toHaveLength(1)
    expect(f.assignments).toEqual([])
  })

  it.each([
    'assignment',
    'main work',
    'native recovery',
    'candidate',
    'admission',
    'selection',
  ] as const)(
    'refuses a loan changed by %s immediately after the launch journal write',
    async (change) => {
      const f = fixture()
      await waitForBorrow(f)
      let hasChanged = false
      f.deps.journal = tapped((snapshot) => {
        if (
          !hasChanged &&
          snapshot.tasks.some((task) => task.id === 'coding' && task.state === 'running')
        ) {
          hasChanged = true
          revoke(f, change)
        }
        return Promise.resolve()
      })
      await f.scheduler.wake()
      expect(hasChanged).toBe(true)
      expect(borrowedStarts(f)).toBe(0)
      expect(f.board.task('coding')).toMatchObject({
        state: 'ready',
        currentAttempt: 0,
        attempts: [],
      })
      expect(f.board.task('coding').loan).toBeUndefined()
      expect(f.slots.snapshot().some((slot) => slot.request.taskId === 'coding')).toBe(false)
      expect(callsOf(f.deps.journal).at(-1)).toEqual([f.board.snapshot()])
    },
  )

  it('drains a readiness wake received while the final journal write is suspended', async () => {
    const f = fixture()
    f.signedOut.clear()
    let writes = 0
    const journal = suspendJournal(f, () => ++writes === 2)
    const first = f.scheduler.wake()
    await journal.writing
    f.board.submit([submission('coding')], f.clock.now)
    const second = f.scheduler.wake()
    journal.release()
    await Promise.all([first, second])
    expect(f.board.task('coding').state).toBe('running')
    expect(callsOf(f.deps.start)).toHaveLength(1)
    expect(callsOf(f.deps.journal).at(-1)).toEqual([f.board.snapshot()])
  })

  it('preserves two authorized lenders and launches both loans in one drain', async () => {
    const f = fixture()
    f.lists[1]?.pool.push(...preferencePoolList('review', ['reviewer-two']).pool)
    f.assignments.push({
      candidateId: 'reviewer-two',
      mainRole: 'review',
      secondaryRoles: ['engineering'],
    })
    f.board.submit([submission('a-coding'), submission('b-coding')], 0)
    await f.scheduler.wake()
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
    await f.scheduler.wake()
    expect(f.board.task('a-coding').attempts[0]?.entryId).toBe('reviewer')
    expect(f.board.task('b-coding').attempts[0]?.entryId).toBe('reviewer-two')
    expect(callsOf(f.deps.start)).toHaveLength(2)
  })

  it('does not erase a later board loan when an older borrowed attempt retires', async () => {
    const f = fixture()
    await borrowCoding(f)
    const loan = f.board.task('coding').loan
    if (loan === undefined) throw new Error('test:loan')
    f.board.finishAttempt('coding', 1, {
      state: 'retired',
      endedAt: f.clock.now,
      retirement: { kind: 'proved', method: 'linuxCgroup' },
    })
    expect(f.board.prepareNext('coding', 1, f.clock.now, 'stall')).toBe(true)
    const next = { ...loan, attempt: 2 }
    f.board.loan('coding', next)
    const recreated = new SchedulerBorrowing(f.board, f.port, new TaskPicker())
    recreated.retired(f.board.task('coding'), 1)
    expect(f.board.task('coding').loan).toEqual(next)
  })

  it.each([1, 7, 19, 41, 73, 101, 149, 211])(
    'preserves loan, recall and recoverability invariants across 80 random explicit-clock steps (seed %s)',
    async (seed) => {
      const f = fixture()
      const choose = randomChoices(seed)
      const operations = Array.from({ length: 10 }, () => 0)
      let serial = 0
      let authorizationChange: number | undefined
      let isLoanAuthorization = false
      let authorizations = 0
      let borrowedStarts = 0
      let journalChange: number | undefined
      let journalRevocations = 0
      let journalWakes = 0
      const invoked = new Set<string>()
      overrideSelection(f, (task, snapshot) =>
        task.id.startsWith('legacy') ? selectionSnapshot() : snapshot,
      )
      const arrive = (roleId: string) => {
        const id = `${choose(2) === 0 ? 'legacy' : 'preferred'}-${String(serial++)}`
        f.board.submit([submission(id, { roleId })], f.clock.now)
      }
      const changeAuthorization = (change: number) => {
        if (change === 0) f.signedOut.clear()
        else if (change === 1) arrive('review')
        else f.assignments.length = 0
      }
      f.deps.authorize = (task) => {
        if (authorizationChange !== undefined) {
          if (isLoanAuthorization) expect(task.loan?.candidateId).toBe('reviewer')
          changeAuthorization(authorizationChange)
          authorizationChange = undefined
          authorizations++
        }
        return Promise.resolve(true)
      }
      f.deps.journal = tapped((snapshot) => {
        const pending = snapshot.tasks.find(
          (task) =>
            task.state === 'running' &&
            task.loan?.attempt === task.currentAttempt &&
            !invoked.has(JSON.stringify([task.id, task.currentAttempt])),
        )
        if (pending !== undefined && journalChange !== undefined) {
          changeAuthorization(journalChange)
          journalChange = undefined
          journalRevocations++
        }
        return Promise.resolve()
      })
      f.deps.start = tapped((task, worker) => {
        invoked.add(JSON.stringify([task.id, task.currentAttempt]))
        if (worker.roleId !== 'engineering' || worker.id !== 'reviewer')
          return Promise.resolve('started')
        borrowedStarts++
        expect(task.loan).toMatchObject({ candidateId: worker.id, attempt: task.currentAttempt })
        expect(f.assignments[0]?.secondaryRoles).toContain(task.roleId)
        expect(f.lists[1]?.pool[0]?.agent?.model).toBe(worker.modelId)
        const tasks = f.board.snapshot().tasks
        expect(tasks.some((item) => item.roleId === 'review' && item.state === 'ready')).toBe(false)
        const isCoderBusy = tasks.some((item) =>
          item.attempts.some(
            (attempt) => attempt.entryId === 'coder' && attempt.state !== 'retired',
          ),
        )
        expect(f.signedOut.has('coder') || isCoderBusy).toBe(true)
        const endedAt = f.board
          .snapshot()
          .borrowCooldowns?.find((row) => row.candidateId === worker.id)?.endedAtMs
        if (endedAt !== undefined)
          expect(f.clock.now - endedAt).toBeGreaterThanOrEqual(TEAM_BORROW_COOLDOWN_MS)
        return Promise.resolve('started')
      })
      await waitForBorrow(f)
      isLoanAuthorization = true
      authorizationChange = choose(3)
      await f.scheduler.wake()
      isLoanAuthorization = false
      expect(borrowedStarts).toBe(0)
      await resetBorrowDemand(f)
      journalChange = choose(3)
      await f.scheduler.wake()
      expect(journalRevocations).toBe(1)
      expect(borrowedStarts).toBe(0)
      await resetBorrowDemand(f)
      await f.scheduler.wake()
      const actions: readonly (() => Promise<void>)[] = [
        () => {
          arrive('engineering')
          return Promise.resolve()
        },
        () => {
          arrive('review')
          return Promise.resolve()
        },
        async () => {
          const running = f.board.snapshot().tasks.filter((task) => task.state === 'running')
          const task = running[choose(running.length)]
          if (task === undefined) return
          retireTask(f, task)
          await f.scheduler.retired({ taskId: task.id, attempt: task.currentAttempt })
        },
        () => {
          if (f.signedOut.has('coder')) f.signedOut.clear()
          else f.signedOut.add('coder')
          return Promise.resolve()
        },
        () => {
          if (f.assignments.length > 0) f.assignments.length = 0
          else
            f.assignments.push({
              candidateId: 'reviewer',
              mainRole: 'review',
              secondaryRoles: ['engineering'],
            })
          return Promise.resolve()
        },
        () => {
          f.board.borrowEnded('reviewer', f.clock.now)
          return Promise.resolve()
        },
        () => {
          f.clock.now += (choose(5) + 1) * TEAM_BORROW_DEMAND_WAIT_MS
          return Promise.resolve()
        },
        () => {
          authorizationChange = choose(3)
          return Promise.resolve()
        },
        () => {
          journalChange = choose(3)
          return Promise.resolve()
        },
        async () => {
          // Equal consecutive snapshots identify the drain's final write;
          // tick and final write both occur even when every worker is busy.
          if (f.assignments.length === 0)
            f.assignments.push({
              candidateId: 'reviewer',
              mainRole: 'review',
              secondaryRoles: ['engineering'],
            })
          let previous = ''
          const journal = suspendJournal(f, (snapshot) => {
            const bytes = JSON.stringify(snapshot)
            const isFinal = bytes === previous
            previous = bytes
            return isFinal
          })
          const first = f.scheduler.wake()
          await journal.writing
          const id = `preferred-wake-${String(serial++)}`
          f.board.submit([submission(id)], f.clock.now)
          const second = f.scheduler.wake()
          journal.release()
          await Promise.all([first, second])
          journal.restore()
          journalWakes++
          expect(f.board.task(id).unmetSinceMs).toBeDefined()
        },
      ]
      for (let step = 0; step < 80; step++) {
        const operation = choose(actions.length)
        operations[operation] = (operations[operation] ?? 0) + 1
        const action = actions[operation]
        if (action === undefined) throw new Error('test:action')
        await action()
        await f.scheduler.wake()
        const tasks = f.board.snapshot().tasks
        for (const task of tasks) {
          if (task.loan === undefined || task.state !== 'running') continue
          const isMainWaiting = tasks.some(
            (item) => item.roleId === task.loan?.mainRole && item.state === 'ready',
          )
          if (!isMainWaiting && f.assignments.length > 0) continue
          expect(task.recallAskedAtMs, `seed ${String(seed)}, step ${String(step)}`).toBeDefined()
          expect(['recall', 'stop']).toContain(
            f.events.findLast((event) => event.taskId === task.id)?.decision.kind,
          )
        }
        // Every counted admission either started or was refunded, exactly once.
        const { admissions, refunds, starts } = ledger(f)
        expect(admissions, `seed ${String(seed)}, step ${String(step)}`).toBe(starts + refunds)
        expect(f.counted.size).toBe(starts)
        const recoverable = ['busy', 'notAdmitted', 'coolingDown', 'rateLimited', 'capped'] as const
        const reason = recoverable[choose(recoverable.length)]
        if (reason === undefined) throw new Error('test:skip')
        const preference = preferencePoolList('review', ['queued-reviewer'])
        preference.exhausted = 'queue'
        const snapshot = {
          ...selectionSnapshot({ nowMs: f.clock.now }),
          preference,
          availability: {
            probe: () => ({
              available: false as const,
              skip: {
                candidateId: 'queued-reviewer',
                reason,
                untilMs: f.clock.now + TEAM_BORROW_DEMAND_WAIT_MS,
              },
            }),
          },
        }
        const pool = { ...rolePool('review', []), policy: 'queue' as const }
        const selected = selectTeamEntry(pool, snapshot, TEAM_TASKS_PER_TURN_DEFAULT)
        if (selected.kind !== 'exhausted') throw new Error('test:exhaustion')
        const exhausted = answerExhausted(pool, selected.reasons, f.clock.now)
        expect(exhausted.decision).toBe('queue')
        expect(
          pickReviewer(
            [],
            [{ entryId: 'queued-reviewer', modelId: 'engine-queued-reviewer', hasHeadroom: true }],
            isSameTeamModel,
            { snapshot },
          ),
        ).toMatchObject({ kind: 'noneEligible', exhausted })
      }
      expect(operations.every((count) => count > 0)).toBe(true)
      expect(authorizations).toBeGreaterThan(0)
      expect(borrowedStarts).toBeGreaterThan(0)
      expect(journalRevocations).toBeGreaterThan(0)
      expect(journalWakes).toBeGreaterThan(0)
    },
  )

  it('keeps authorization and recall ownership on the board after assignment removal and scheduler recreation', async () => {
    const f = fixture()
    await borrowCoding(f)
    const loan = f.board.task('coding').loan
    expect(loan).toMatchObject({ candidateId: 'reviewer', mainRole: 'review', attempt: 1 })
    expect(loan?.authorization).toContain('engine-reviewer')
    f.assignments.length = 0
    const recreated = new SchedulerBorrowing(f.board, f.port, new TaskPicker())
    recreated.apply({ ...f.deps.context(), now: f.clock.now })
    await recreated.deliver()
    expect(f.events.at(-1)?.decision.kind).toBe('recall')
    expect(f.board.task('coding').recallAskedAtMs).toBe(f.clock.now)
    f.clock.now += TEAM_BORROW_RECALL_WAIT_MS
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision.kind).toBe('stop')
  })

  it.each(['candidate', 'entry', 'assignment'] as const)(
    'recalls an active loan when its authorized %s changes without new main work',
    async (change) => {
      const f = fixture()
      await borrowCoding(f)
      if (change === 'candidate') {
        const candidate = f.lists[1]?.pool[0]
        if (candidate?.agent) candidate.agent.model = 'replacement-engine'
      } else if (change === 'assignment') f.assignments.length = 0
      else {
        const context = f.deps.context
        f.deps.context = () => {
          const base = context()
          return { ...base, entries: base.entries.filter((item) => item.id !== 'reviewer') }
        }
      }
      await f.scheduler.wake()
      expect(f.events.at(-1)?.decision.kind).toBe('recall')
      expect(f.board.task('coding').recallAskedAtMs).toBe(f.clock.now)
      expect(callsOf(f.deps.start)).toHaveLength(1)
    },
  )

  it('preserves the first legacy main-role demand time through repeated projections', async () => {
    const f = fixture()
    await borrowCoding(f)
    overrideSelection(f, (task, snapshot) =>
      task.roleId === 'review' ? selectionSnapshot() : snapshot,
    )
    await requestReview(f)
    const demandedAt = f.clock.now
    f.clock.now = demandedAt + TEAM_BORROW_RECALL_WAIT_MS
    await f.scheduler.wake()
    expect(f.board.task('review').unmetSinceMs).toBe(demandedAt)
    expect(f.events.at(-1)?.decision.kind).toBe('stop')
  })

  it.each(['preferred', 'legacy'] as const)(
    'keeps the lender home when %s main-role work arrives during authorization',
    async (kind) => {
      const f = fixture()
      if (kind === 'legacy')
        overrideSelection(f, (task, snapshot) =>
          task.roleId === 'review' ? selectionSnapshot() : snapshot,
        )
      await waitForBorrow(f)
      f.deps.authorize = (task) => {
        if (task.id === 'coding')
          f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
        return Promise.resolve(true)
      }
      await f.scheduler.wake()
      expect(f.board.task('coding').attempts).toEqual([])
      expect(f.board.task('review').attempts[0]?.entryId).toBe('reviewer')
      expect(f.events).toEqual([])
    },
  )

  it('cancels a loan and resets demand when a native candidate recovers during authorization', async () => {
    const f = fixture()
    await waitForBorrow(f)
    f.deps.authorize = () => {
      f.signedOut.clear()
      return Promise.resolve(true)
    }
    await f.scheduler.wake()
    expectNoAttempt(f)
    expect(f.board.task('coding').unmetSinceMs).toBe(f.clock.now)
  })

  it('recalls a lender for legacy main-role demand', async () => {
    const f = fixture()
    await borrowCoding(f)
    overrideSelection(f, (task, snapshot) =>
      task.roleId === 'review' ? selectionSnapshot() : snapshot,
    )
    await requestReview(f)
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'recall',
      deadlineMs: f.clock.now + TEAM_BORROW_RECALL_WAIT_MS,
    })
    expect(f.board.task('coding').recallAskedAtMs).toBe(f.clock.now)
  })

  it.each(['candidate', 'assignment', 'missing candidate', 'missing entry'] as const)(
    'rechecks a replaced %s after authorization without another borrowing tick',
    async (change) => {
      const f = fixture()
      await waitForBorrow(f)
      f.deps.authorize = () => {
        if (change === 'assignment') {
          const assignment = f.assignments[0]
          if (assignment) assignment.secondaryRoles.length = 0
        } else if (change === 'missing entry') {
          const context = f.deps.context
          f.deps.context = () => {
            const base = context()
            return { ...base, entries: base.entries.filter((entry) => entry.id !== 'reviewer') }
          }
        } else {
          const role = f.lists[1]
          const candidate = role?.pool[0]
          if (role && candidate?.agent) {
            if (change === 'missing candidate') role.pool.length = 0
            else
              role.pool[0] = {
                ...candidate,
                agent: { ...candidate.agent, model: 'replacement-engine' },
              }
          }
        }
        return Promise.resolve(true)
      }
      await f.scheduler.wake()
      expectNoAttempt(f)
    },
  )

  it('evaluates borrowing once and delivers one recall after the three-entry drain completes', async () => {
    const f = fixture()
    await borrowCoding(f)
    f.signedOut.clear()
    f.board.submit([submission('review', { roleId: 'review' }), submission('next')], f.clock.now)
    callsOf(f.port.decisions).length = 0
    f.events.length = 0
    f.port.recall = tapped((event) => {
      expect(f.board.task('next').state).toBe('running')
      f.events.push(event)
      return Promise.resolve()
    })
    await f.scheduler.wake()
    expect(callsOf(f.port.decisions)).toHaveLength(1)
    expect(f.events).toHaveLength(1)
    expect(f.events[0]?.decision.kind).toBe('recall')
    await f.scheduler.wake()
    expect(f.events).toHaveLength(1)
  })

  it.each(['wake', 'retired'] as const)(
    'allows a recall consumer to re-enter %s without hanging or redelivery',
    async (method) => {
      const f = fixture()
      await borrowCoding(f)
      f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
      f.events.length = 0
      f.port.recall = tapped(async (event) => {
        f.events.push(event)
        expect(f.events).toHaveLength(1)
        if (method === 'retired') {
          retireCoding(f)
          await f.scheduler.retired({ taskId: 'coding', attempt: 1 })
        } else await f.scheduler.wake()
      })
      await f.scheduler.wake()
      expect(f.events).toHaveLength(1)
      if (method === 'retired') expect(f.board.task('review').state).toBe('running')
    },
  )

  it('uses the review snapshot engine when the first running task has no engine callback', async () => {
    const f = fixture()
    await borrowCoding(f)
    overrideSelection(f, (task, snapshot) =>
      task.roleId === 'review'
        ? {
            ...snapshot,
            engine: () => 'captured-engine',
            conditions: { authorEngines: ['captured-engine'] },
          }
        : snapshot,
    )
    await expectNoMainRecall(f)
  })

  it('keeps a legacy task out of borrowing and dispatches it beside preference tasks', async () => {
    const f = fixture()
    f.signedOut.clear()
    const context = f.deps.context
    f.deps.context = () => {
      const base = context()
      return {
        ...base,
        entries: [
          ...base.entries,
          schedulerEntry({ id: 'docs', roleId: 'docs', agentProfileId: 'docs' }),
        ],
        selection: (task) =>
          task.roleId === 'docs'
            ? selectionSnapshot()
            : (base.selection?.(task) ?? selectionSnapshot()),
      }
    }
    f.board.submit([submission('docs', { roleId: 'docs' }), submission('coding')], 0)
    await f.scheduler.wake()
    expect(f.board.task('docs').attempts[0]?.entryId).toBe('docs')
    expect(f.board.task('docs').unmetSinceMs).toBeUndefined()
    expect(f.board.task('coding').attempts[0]?.entryId).toBe('coder')
    expect(callsOf(f.port.decisions)).toContainEqual([
      [expect.objectContaining({ taskId: 'coding' })],
    ])
  })

  it('takes a borrowed agent identity from its running task rather than an unrelated first task', async () => {
    const f = fixture()
    f.board.submit([submission('unrelated')], 0)
    f.board.begin('unrelated', { ...boardAttempt(), entryId: 'coder', agentProfileId: 'coder' })
    await borrowCoding(f)
    overrideSelection(f, (task, snapshot) => {
      if (task.id === 'unrelated') return { ...snapshot, engine: () => 'unrelated-engine' }
      return task.id === 'coding'
        ? { ...snapshot, engine: () => 'captured-engine' }
        : { ...snapshot, conditions: { authorEngines: ['captured-engine'] } }
    })
    await expectNoMainRecall(f)
  })

  it('preserves D75 dispatch when the installed context has no selection callback', async () => {
    const f = fixture()
    f.deps.context = () =>
      pickContext({ entries: [schedulerEntry({ id: 'coder', agentProfileId: 'coder' })] })
    f.board.submit([submission('a-first'), submission('b-waiting')], 0)
    await f.scheduler.wake()
    expect(f.board.task('a-first').attempts[0]?.entryId).toBe('coder')
    expect(f.board.task('b-waiting').state).toBe('ready')
    expect(f.board.task('b-waiting').unmetSinceMs).toBeUndefined()
    expect(callsOf(f.port.decisions)).toContainEqual([[]])
    expect(f.events).toEqual([])
  })

  it('refuses a changed worker model after authorization instead of dispatching the earlier identity', async () => {
    const f = fixture()
    await waitForBorrow(f)
    f.deps.authorize = () => {
      const candidate = f.lists[1]?.pool[0]
      if (candidate?.agent) candidate.agent.model = 'changed-engine'
      return Promise.resolve(true)
    }
    await f.scheduler.wake()
    expect(callsOf(f.deps.start)).toHaveLength(0)
    expect(f.board.task('coding').attempts).toEqual([])
  })
  it('borrows from the real periodic sweep on an explicit clock', async () => {
    const f = fixture()
    f.board.submit([submission('swept')], 0)
    await f.scheduler.wake()
    f.scheduler.startSweep()
    try {
      expect(callsOf(f.deps.schedule).at(-1)?.[1]).toBe(TEAM_SCHED_TICK_MS)
      const runLastTick = (): void => {
        const last = f.scheduled.at(-1)
        if (last === undefined) throw new Error('test:tick')
        last.callback()
      }
      f.clock.now += TEAM_BORROW_DEMAND_WAIT_MS - 1
      runLastTick()
      await f.scheduler.wake()
      expect(callsOf(f.deps.start)).toHaveLength(0)
      f.clock.now += 1
      runLastTick()
      await f.scheduler.wake()
      expect(f.board.task('swept').attempts[0]?.entryId).toBe('reviewer')
    } finally {
      f.scheduler.stopSweep()
    }
  })
  it('rechecks live governor admission after authorization before creating an attempt', async () => {
    const f = fixture()
    await waitForBorrow(f)
    f.deps.authorize = () => {
      f.unavailable.add('reviewer')
      return Promise.resolve(true)
    }
    await f.scheduler.wake()
    expectNoAttempt(f)
  })
  it('borrows exactly at 60 seconds, journals the chain before launch, and gives one task to the lender', async () => {
    const f = fixture()
    f.board.submit([submission('a-oldest'), submission('b-next')], 0)
    f.deps.start = tapped((task) => {
      expect(task.handoff?.chain).toEqual([
        {
          kind: 'borrow',
          atMs: TEAM_BORROW_DEMAND_WAIT_MS,
          candidateId: 'reviewer',
          mainRole: 'review',
          borrowingRole: 'engineering',
        },
      ])
      expect(callsOf(f.deps.journal)).toContainEqual([
        expect.objectContaining({
          tasks: expect.arrayContaining([
            expect.objectContaining({ id: task.id, handoff: task.handoff }),
          ]),
        }),
      ])
      return Promise.resolve('started')
    })
    await f.scheduler.wake()
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS - 1
    await f.scheduler.wake()
    expect(callsOf(f.deps.start)).toHaveLength(0)
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
    await f.scheduler.wake()
    expect(callsOf(f.deps.start)).toHaveLength(1)
    expect(f.board.task('a-oldest').attempts[0]?.entryId).toBe('reviewer')
    expect(f.board.task('b-next').state).toBe('ready')
    expect(callsOf(f.port.decisions)).toContainEqual([
      [
        expect.objectContaining({ taskId: 'a-oldest', kind: 'borrow', candidateId: 'reviewer' }),
        expect.objectContaining({
          taskId: 'b-next',
          kind: 'none',
          skips: [{ candidateId: 'reviewer', reason: 'busy' }],
        }),
      ],
    ])
    expect(teamBoardSchema.parse(f.board.snapshot()).tasks[0]?.handoff).toEqual(
      f.board.task('a-oldest').handoff,
    )
  })

  it('resets the entire unmet-demand window when a main candidate frees between ticks', async () => {
    const f = fixture()
    f.board.submit([submission('work')], 0)
    await f.scheduler.wake()
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS / 2
    f.signedOut.clear()
    f.deps.authorize = () => Promise.resolve(false)
    await f.scheduler.wake()
    f.signedOut.add('coder')
    f.deps.authorize = () => Promise.resolve(true)
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
    await f.scheduler.wake()
    expect(callsOf(f.deps.start)).toHaveLength(0)
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_DEMAND_WAIT_MS / 2
    await f.scheduler.wake()
    expect(f.board.task('work').attempts[0]?.entryId).toBe('reviewer')
  })

  it.each(['time box', 'recorded median'])(
    'keeps the reviewer home for work due within the lookahead, using the %s',
    async (durationSource) => {
      const f = fixture()
      const engineering = f.lists[0]
      if (engineering && durationSource === 'time box') engineering.minutesPerTask = 5
      if (durationSource === 'recorded median')
        f.port.medianDurationMs = (role) =>
          role === 'engineering' ? 5 * TEAM_MINUTE_MS : undefined
      f.port.produces = (task) => (task.id === 'producing' ? { roleId: 'review' } : undefined)
      f.board.submit([submission('producing'), submission('waiting')], 0)
      f.board.begin('producing', {
        ...boardAttempt(),
        entryId: 'coder',
        agentProfileId: 'coder',
        startedAt: 0,
      })
      await f.scheduler.wake()
      f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
      await f.scheduler.wake()
      expect(callsOf(f.deps.start)).toHaveLength(0)
      expect(callsOf(f.port.decisions).at(-1)).toEqual([
        [
          expect.objectContaining({
            taskId: 'waiting',
            reason: 'noLender',
            skips: [
              { candidateId: 'reviewer', reason: 'mainWorkDue', untilMs: 5 * TEAM_MINUTE_MS },
            ],
          }),
        ],
      ])
    },
  )

  it('never recalls a borrowed coder for its own review, and its engine cannot review through another candidate', async () => {
    const f = fixture()
    await borrowCoding(f)
    const authored = f.board.task('coding').handoff
    if (authored === undefined) throw new Error('test:handoff')
    const context = f.deps.context
    const selected = tapped((_task: TeamBoardTask, _selection: TeamSelection) => undefined)
    f.deps.context = () => {
      const base = context()
      return {
        ...base,
        selected,
        selection: (task) => {
          const snapshot = base.selection?.(task)
          if (snapshot === undefined) throw new Error('test:selection')
          return task.id === 'own-review'
            ? {
                ...snapshot,
                authorship: {
                  startedOn: 'reviewer',
                  record: authored,
                  engines: new Map([['reviewer', 'engine-reviewer']]),
                },
              }
            : snapshot
        },
      }
    }
    f.board.submit([submission('own-review', { roleId: 'review' })], f.clock.now)
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({ kind: 'keep', reason: 'noMainWork' })
    expect(f.board.task('coding').recallAskedAtMs).toBeUndefined()
    const peers = preferencePoolList('review', ['same-engine', 'independent']).pool
    const same = peers[0]
    if (same?.agent) same.agent.model = ' engine-reviewer '
    f.lists[1]?.pool.push(...peers)
    await f.scheduler.wake()
    expect(f.board.task('own-review').attempts[0]?.entryId).toBe('independent')
    expect(selected.calls.at(-1)).toEqual([
      expect.objectContaining({ id: 'own-review' }),
      expect.objectContaining({
        skips: [
          { candidateId: 'reviewer', reason: 'author' },
          { candidateId: 'same-engine', reason: 'author' },
        ],
      }),
    ])
  })

  it('honours finish grace through the emitted H decision, then recalls overdue work', async () => {
    const f = fixture()
    const engineering = f.lists[0]
    if (engineering) engineering.minutesPerTask = 3
    await borrowCoding(f)
    f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'finish',
      expectedFinishMs: TEAM_BORROW_DEMAND_WAIT_MS + 3 * TEAM_MINUTE_MS,
    })
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS + 3 * TEAM_MINUTE_MS
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'recall',
      deadlineMs: f.clock.now + TEAM_BORROW_RECALL_WAIT_MS,
    })
  })

  it('emits journalled recall and bounded-stop decisions to H when main-role work arrives', async () => {
    const f = fixture()
    await borrowCoding(f)
    f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
    f.port.recall = tapped((event) => {
      f.events.push(event)
      if (event.decision.kind === 'recall')
        expect(f.board.task('coding').recallAskedAtMs).toBe(TEAM_BORROW_DEMAND_WAIT_MS)
      expect(callsOf(f.deps.journal).at(-1)).toEqual([f.board.snapshot()])
      return Promise.resolve()
    })
    await f.scheduler.wake()
    expect(f.events.at(-1)).toEqual({
      id: JSON.stringify(['coding', 1, 1]),
      taskId: 'coding',
      attempt: 1,
      atMs: TEAM_BORROW_DEMAND_WAIT_MS,
      decision: {
        kind: 'recall',
        candidateId: 'reviewer',
        taskId: 'coding',
        deadlineMs: TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS,
      },
    })
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS - 1
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'recall',
      deadlineMs: TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS,
    })
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision.kind).toBe('stop')
    expect(f.board.task('coding').state).toBe('running')
    expect(f.board.task('review').state).toBe('ready')
  })

  it('cancels recall when another main candidate frees and preserves the borrowed task', async () => {
    const f = fixture()
    await borrowCoding(f)
    await requestReview(f)
    f.lists[1]?.pool.push(...preferencePoolList('review', ['other']).pool)
    await f.scheduler.wake()
    expect(
      f.events.some(
        (event) => event.decision.kind === 'keep' && event.decision.reason === 'mainCandidateFree',
      ),
    ).toBe(true)
    expect(f.board.task('coding').recallAskedAtMs).toBeUndefined()
    expect(f.board.task('review').attempts[0]?.entryId).toBe('other')
  })

  it('gives each new recall/cancellation a stable distinct id even on the same clock', async () => {
    const f = fixture()
    await borrowCoding(f)
    await requestReview(f)
    f.deps.authorize = () => Promise.resolve(false)
    f.lists[1]?.pool.push(...preferencePoolList('review', ['other']).pool)
    await f.scheduler.wake()
    f.unavailable.add('other')
    await f.scheduler.wake()
    f.unavailable.clear()
    await f.scheduler.wake()
    expect(f.events.map((event) => event.decision.kind)).toEqual([
      'recall',
      'keep',
      'recall',
      'keep',
    ])
    expect(new Set(f.events.map((event) => event.id)).size).toBe(4)
    await f.scheduler.wake()
    expect(f.events).toHaveLength(4)
  })

  it('retirement returns the lender and enforces its cooldown without raising caps', async () => {
    const f = fixture()
    f.board.submit([submission('coding'), submission('waiting')], 0)
    await f.scheduler.wake()
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
    await f.scheduler.wake()
    retireCoding(f)
    await f.scheduler.retired({ taskId: 'coding', attempt: 1 })
    expect(f.board.snapshot().borrowCooldowns).toEqual([
      { candidateId: 'reviewer', endedAtMs: f.clock.now },
    ])
    expect(f.board.task('waiting').state).toBe('ready')
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_COOLDOWN_MS - 1
    await f.scheduler.wake()
    expect(f.board.task('waiting').state).toBe('ready')
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_COOLDOWN_MS
    await f.scheduler.wake()
    expect(f.board.task('waiting').attempts[0]?.entryId).toBe('reviewer')
  })

  it('exposes the live refusal for a lender and uses no secondary roles as the D75 path', async () => {
    const f = fixture()
    f.board.submit([submission('waiting')], 0)
    await f.scheduler.wake()
    f.unavailable.add('reviewer')
    f.clock.now = TEAM_BORROW_DEMAND_WAIT_MS
    await f.scheduler.wake()
    expect(callsOf(f.port.decisions).at(-1)).toEqual([
      [expect.objectContaining({ skips: [{ candidateId: 'reviewer', reason: 'notAdmitted' }] })],
    ])
    f.assignments[0]?.secondaryRoles.splice(0)
    const bytes = JSON.stringify(f.board.snapshot())
    f.port.recall = tapped(() => Promise.resolve(undefined))
    f.port.decisions = tapped(() => undefined)
    await f.scheduler.wake()
    expect(JSON.stringify(f.board.snapshot())).toBe(bytes)
    expect(callsOf(f.port.recall)).toHaveLength(0)
    expect(callsOf(f.port.decisions)).toHaveLength(0)
  })
})

describe('M120 round 5: one reservation from selection to spawn, one drain owner', () => {
  it.each([
    ['one task per borrowing-role turn', { tasksPerTurn: 1 }],
    [
      "the lender's lifetime cap of one task",
      { reviewerCaps: [{ measure: 'tasks', window: 'lifetime', amount: 1 }] },
    ],
  ] as const)(
    'launches a loan whose own admission fills %s (RVM120S4C 1, real TeamMeter)',
    async (_limit, options) => {
      const f = fixture(options)
      await borrowCoding(f)
      expect({
        ...ledger(f),
        state: f.board.task('coding').state,
        worker: f.board.task('coding').attempts[0]?.entryId,
      }).toEqual({ admissions: 1, refunds: 0, starts: 1, state: 'running', worker: 'reviewer' })
      expectReservationsSettled(f)
    },
  )

  it('refunds a revoked loan exactly, so its lender stays borrowable under a lifetime cap of one', async () => {
    const f = fixture({
      tasksPerTurn: 1,
      reviewerCaps: [{ measure: 'tasks', window: 'lifetime', amount: 1 }],
    })
    await waitForBorrow(f)
    const window = revokeDuring(
      f,
      'launch journal',
      () => {
        revoke(f, 'assignment')
      },
      0,
    )
    await f.scheduler.wake()
    expect(window.isReached()).toBe(true)
    expect(ledger(f)).toEqual({ admissions: 1, refunds: 1, starts: 0 })
    expect(f.counted.size).toBe(0)
    expect(f.board.task('coding')).toMatchObject({ state: 'ready', attempts: [] })
    f.assignments.push({
      candidateId: 'reviewer',
      mainRole: 'review',
      secondaryRoles: ['engineering'],
    })
    await f.scheduler.wake()
    expect(ledger(f)).toEqual({ admissions: 2, refunds: 1, starts: 1 })
    expect(f.board.task('coding').attempts[0]?.entryId).toBe('reviewer')
    expectReservationsSettled(f)
  })

  it('drains a readiness wake arriving 0 to 6 microtasks after the final journal write (RVM120S4C 2)', async () => {
    const outcomes: { depth: number; starts: number; state: string }[] = []
    let early = 0
    for (let depth = 0; depth <= 6; depth++) {
      const { isEarly, facts } = await wakeAround('final write', depth)
      if (isEarly) early++
      outcomes.push({ depth, starts: facts.starts, state: facts.arrival })
    }
    expect(outcomes).toEqual(
      Array.from({ length: 7 }, (_, depth) => ({ depth, starts: 1, state: 'running' })),
    )
    // The window between the drain's last latch check and its settling is covered.
    expect(early).toBeGreaterThanOrEqual(3)
  })

  it.each(awaitPoints)(
    'property: a revocation at the %s, at any microtask depth, prevents the borrowed spawn and refunds its reservation',
    async (point) => {
      for (const change of [undefined, ...revocations])
        for (const depth of [0, 1, 3]) {
          const f = fixture({ tasksPerTurn: 1 })
          await waitForBorrow(f)
          const window = revokeDuring(
            f,
            point,
            change === undefined
              ? undefined
              : () => {
                  revoke(f, change)
                },
            depth,
          )
          await f.scheduler.wake()
          const label = `${point}, ${change ?? 'no revocation'}, depth ${String(depth)}`
          expect(window.isReached(), label).toBe(true)
          expect(borrowedStarts(f), label).toBe(change === undefined ? 1 : 0)
          // Only an admission counted before the revocation is refunded, and exactly once.
          expect(ledger(f).refunds, label).toBe(
            change !== undefined && point === 'launch journal' ? 1 : 0,
          )
          expectReservationsSettled(f)
          expect(callsOf(f.deps.journal).at(-1), label).toEqual([f.board.snapshot()])
          // Later wakes keep the same accounting.
          await f.scheduler.wake()
          expectReservationsSettled(f)
        }
    },
  )

  it.each(['final write', 'worker start', 'worker start, D75 port'] as const)(
    'property: a wake at any microtask depth around drain completion (%s) is drained once by one owner',
    async (shape) => {
      let early = 0
      for (let depth = 0; depth <= 12; depth++) {
        const { isEarly, facts } = await wakeAround(shape, depth)
        if (isEarly) early++
        expect(facts, `${shape}, depth ${String(depth)}`).toEqual({
          arrival: 'running',
          starts: 1,
          isStartedOnce: true,
          maxInFlight: 1,
          ready: 0,
        })
      }
      expect(early).toBeGreaterThanOrEqual(3)
    },
  )

  it('joins a wake re-entering from the drain’s synchronous start to that owner, which drains it', async () => {
    const f = fixture()
    f.signedOut.clear()
    f.board.submit([submission('coding')], 0)
    let inFlight = 0
    let maxInFlight = 0
    const journal = f.deps.journal
    f.deps.journal = tapped(async (snapshot) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await journal(snapshot)
      } finally {
        inFlight--
      }
    })
    let reentered: Promise<void> | undefined
    let hasReentered = false
    let isStartedFirst = false
    const context = f.deps.context
    f.deps.context = () => {
      if (!hasReentered) {
        hasReentered = true
        reentered = (async () => {
          await f.scheduler.wake()
          isStartedFirst = callsOf(f.deps.start).length === 1
        })()
      }
      return context()
    }
    await f.scheduler.wake()
    await reentered
    expect({
      isStartedFirst,
      maxInFlight,
      ticks: callsOf(f.port.decisions).length,
    }).toEqual({ isStartedFirst: true, maxInFlight: 1, ticks: 1 })
    expect(f.board.task('coding').attempts[0]?.entryId).toBe('coder')
  })

  it('lets go of ownership when a pass fails, so the next wake drains', async () => {
    const f = fixture()
    f.signedOut.clear()
    f.board.submit([submission('coding')], 0)
    f.deps.authorize = () => Promise.reject(new Error('consent store unavailable'))
    let joiner: Promise<unknown> | undefined
    const journal = f.deps.journal
    f.deps.journal = tapped((snapshot) => {
      joiner ??= (async () => {
        try {
          await f.scheduler.wake()
          return undefined
        } catch (error) {
          return error
        }
      })()
      return journal(snapshot)
    })
    await expect(f.scheduler.wake()).rejects.toThrow('consent store unavailable')
    expect(await joiner).toMatchObject({ message: 'consent store unavailable' })
    f.deps.authorize = () => Promise.resolve(true)
    await f.scheduler.wake()
    expect(f.board.task('coding').state).toBe('running')
    expectReservationsSettled(f)
  })
})

/**
One flip per fact the loan admission predicate reads, on a Default lender
(agent key `default`), so each flip falsifies only its own fact. The record
must name every fact: a new fact without a flip fails the typecheck and the
coverage assertion below.
*/
const factFlips: Record<LoanFact, (f: ReturnType<typeof fixture>) => void> = {
  reservation: (f) => {
    f.board.recallAsked('coding', f.clock.now)
  },
  authorization: (f) => {
    f.assignments.length = 0
  },
  identity: (f) => {
    f.live.defaultAgent = keyAgent({ key: 'default', modelId: 'replacement-default-engine' })
  },
  author: (f) => {
    f.live.conditions.set('coding', { authorCandidates: ['reviewer'] })
  },
  conditions: (f) => {
    f.live.conditions.set('coding', { features: ['vision'] })
  },
  availability: (f) => {
    f.unavailable.add('reviewer')
  },
  limit: (f) => {
    f.live.marks.markRateLimited('default', f.clock.now + TEAM_BORROW_DEMAND_WAIT_MS)
  },
  agent: (f) => {
    f.live.unavailableAgents.add('default')
  },
  idle: (f) => {
    f.live.elsewhere.set('default', 1)
  },
  demand: (f) => {
    f.board.demand('coding', f.clock.now, true)
  },
  mainCandidate: (f) => {
    f.signedOut.clear()
  },
  mainWork: (f) => {
    f.board.submit([submission('review', { roleId: 'review' })], f.clock.now)
  },
  cooldown: (f) => {
    f.board.borrowEnded('reviewer', f.clock.now)
  },
}

function borrowDecisionsFor(f: ReturnType<typeof fixture>): number {
  let count = 0
  for (const [decisions] of callsOf(f.port.decisions)) {
    count += decisions.filter(
      (decision) => decision.taskId === 'coding' && decision.kind === 'borrow',
    ).length
  }
  return count
}

describe('M120 round 5, fix 1: one admission predicate for selection and the final gate', () => {
  it.each([
    [
      'installed agent availability',
      {},
      (f: ReturnType<typeof fixture>) => {
        f.live.unavailableAgents.add('reviewer')
      },
    ],
    [
      'idleness outside the task board',
      {},
      (f: ReturnType<typeof fixture>) => {
        f.live.elsewhere.set('reviewer', 1)
      },
    ],
    [
      'its resolved Default identity',
      { isDefaultLender: true },
      (f: ReturnType<typeof fixture>) => {
        f.live.defaultAgent = keyAgent({ key: 'default', modelId: 'replacement-default-engine' })
      },
    ],
  ] as const)(
    'refuses and refunds a loan whose lender loses %s during the launch journal (RVM120S5C)',
    async (_fact, options, flip) => {
      const f = fixture(options)
      await waitForBorrow(f)
      const window = revokeDuring(
        f,
        'launch journal',
        () => {
          flip(f)
        },
        0,
      )
      await f.scheduler.wake()
      expect(window.isReached()).toBe(true)
      expect({ ...ledger(f), state: f.board.task('coding').state }).toEqual({
        admissions: 1,
        refunds: 1,
        starts: 0,
        state: 'ready',
      })
      expectReservationsSettled(f)
    },
  )

  it('flips cover exactly the facts the predicate reads', () => {
    expect(new Set(Object.keys(factFlips))).toEqual(new Set(LOAN_FACTS))
  })

  it.each(LOAN_FACTS)(
    'property: flipping %s during the launch journal makes the gate refuse on it and refund once',
    async (fact) => {
      // Each flip falsifies exactly its own fact, so a refusal here is on
      // that fact: nothing else changed between selection and the gate.
      const f = fixture({ isDefaultLender: true })
      await waitForBorrow(f)
      const window = revokeDuring(
        f,
        'launch journal',
        () => {
          factFlips[fact](f)
        },
        0,
      )
      await f.scheduler.wake()
      expect(window.isReached()).toBe(true)
      expect(borrowedStarts(f)).toBe(0)
      expect(ledger(f).refunds).toBe(1)
      expect(f.board.task('coding').attempts.every((item) => item.entryId !== 'reviewer')).toBe(
        true,
      )
      expectReservationsSettled(f)
    },
  )

  it.each(LOAN_FACTS.filter((fact) => fact !== 'reservation'))(
    'property: with %s flipped before selection, selection admits no loan through the same predicate',
    async (fact) => {
      const f = fixture({ isDefaultLender: true })
      await waitForBorrow(f)
      factFlips[fact](f)
      await f.scheduler.wake()
      expect(borrowDecisionsFor(f)).toBe(0)
      expect(borrowedStarts(f)).toBe(0)
      expect(ledger(f).refunds).toBe(0)
      expectReservationsSettled(f)
    },
  )

  it('admits and launches the Default lender when no fact changes', async () => {
    const f = fixture({ isDefaultLender: true })
    await borrowCoding(f)
    expect(borrowDecisionsFor(f)).toBe(1)
    expect({ ...ledger(f), worker: f.board.task('coding').attempts[0]?.entryId }).toEqual({
      admissions: 1,
      refunds: 0,
      starts: 1,
      worker: 'reviewer',
    })
    expectReservationsSettled(f)
  })
})
