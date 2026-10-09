import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamScheduler, type SchedulerDependencies } from '../../src/core/team/teamPool'
import { TeamLiveAvailability } from '../../src/core/team/selection'
import { SchedulerSlots } from '../../src/core/team/scheduler/slots'
import type {
  SchedulerBorrowPort,
  SchedulerRecallEvent,
} from '../../src/core/team/scheduler/borrowing'
import { teamPreferenceListSchema, type TeamPreferenceList } from '../../src/shared/teamPreference'
import { teamBoardSchema } from '../../src/shared/team'
import {
  TEAM_BORROW_DEMAND_WAIT_MS,
  TEAM_BORROW_RECALL_WAIT_MS,
  TEAM_BORROW_COOLDOWN_MS,
  TEAM_MINUTE_MS,
  TEAM_SCHED_TICK_MS,
} from '../../src/shared/constants'
import { selectionSnapshot } from './helpers/teamFakes'
import { attempt, entry, makeBoard, pickContext, submission } from './helpers/teamScheduler'

function list(role: string, ids: string[], minutesPerTask = 30): TeamPreferenceList {
  return teamPreferenceListSchema.parse({
    role,
    minutesPerTask,
    pool: ids.map((id) => ({
      id,
      concurrent: 1,
      caps: [],
      agent: { kind: 'engine', agentId: id, model: `engine-${id}`, pays: 'local' },
      conditions: { platforms: ['windows'], features: ['tools.write'] },
    })),
  })
}
function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const { board } = makeBoard()
  const lists = [list('engineering', ['coder']), list('review', ['reviewer'])]
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
    recall: vi.fn<SchedulerBorrowPort['recall']>((event) => {
      events.push(event)
      return Promise.resolve()
    }),
    decisions: vi.fn(),
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
    now: () => Date.now(),
    context: () =>
      pickContext({
        entries: lists.flatMap((role) =>
          role.pool.map((candidate) =>
            entry({
              id: candidate.id,
              roleId: role.role,
              agentProfileId: candidate.id,
              modelId: candidate.agent?.model ?? '',
            }),
          ),
        ),
        selection: (task) => {
          const running = board
            .snapshot()
            .tasks.flatMap((task) => task.attempts.filter((attempt) => attempt.state !== 'retired'))
          const preference = lists.find((role) => role.role === task.roleId)
          if (preference === undefined) throw new Error('test:role')
          return {
            ...selectionSnapshot({
              nowMs: Date.now(),
              taskId: task.id,
              runningByEntry: new Map(running.map((attempt) => [attempt.entryId, 1])),
              runningByAgent: new Map(running.map((attempt) => [attempt.agentProfileId, 1])),
              agentLimit: () => 1,
            }),
            preference,
            availability: new TeamLiveAvailability((candidate) => ({
              signedIn: !signedOut.has(candidate.id),
              healthy: true,
              nodeOnline: true,
              admitted: !unavailable.has(candidate.id),
            })),
          }
        },
      }),
    headroom: () => 'lane',
    exhausted: vi.fn(),
    lease: () => ({ release: vi.fn() }),
    authorize: () => Promise.resolve(true),
    journal: vi.fn(() => Promise.resolve()),
    start: vi.fn<SchedulerDependencies['start']>(() => Promise.resolve('started')),
    uncertain: () => Promise.resolve(),
    schedule: vi.fn<SchedulerDependencies['schedule']>((callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    }),
    failure: vi.fn(),
    halveAgentCap: vi.fn(),
  }
  return {
    board,
    deps,
    port,
    lists,
    signedOut,
    unavailable,
    assignments,
    slots,
    events,
    scheduler: new TeamScheduler(board, slots, deps),
  }
}
afterEach(() => vi.useRealTimers())

async function waitForBorrow(f: ReturnType<typeof fixture>): Promise<void> {
  f.board.submit([submission('coding')], 0)
  await f.scheduler.wake()
  vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS)
}

async function borrowCoding(f: ReturnType<typeof fixture>): Promise<void> {
  await waitForBorrow(f)
  await f.scheduler.wake()
}

describe('M120 borrowing through the real scheduler and pool', () => {
  it('refuses a changed worker model after authorization instead of dispatching the earlier identity', async () => {
    const f = fixture()
    await waitForBorrow(f)
    f.deps.authorize = () => {
      const candidate = f.lists[1]?.pool[0]
      if (candidate?.agent) candidate.agent.model = 'changed-engine'
      return Promise.resolve(true)
    }
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    expect(f.board.task('coding').attempts).toEqual([])
  })
  it('borrows from the real periodic sweep on the same fake clock', async () => {
    const f = fixture()
    f.board.submit([submission('swept')], 0)
    await f.scheduler.wake()
    f.scheduler.startSweep()
    try {
      expect(f.deps.schedule).toHaveBeenCalledWith(expect.any(Function), TEAM_SCHED_TICK_MS)
      await vi.advanceTimersByTimeAsync(TEAM_BORROW_DEMAND_WAIT_MS - 1)
      expect(f.deps.start).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
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
    expect(f.deps.start).not.toHaveBeenCalled()
    expect(f.board.task('coding').attempts).toEqual([])
    expect(f.slots.snapshot()).toEqual([])
  })
  it('borrows exactly at 60 seconds, journals the chain before launch, and gives one task to the lender', async () => {
    const f = fixture()
    f.board.submit([submission('a-oldest'), submission('b-next')], 0)
    f.deps.start = vi.fn<SchedulerDependencies['start']>((task) => {
      expect(task.handoff?.chain).toEqual([
        {
          kind: 'borrow',
          atMs: TEAM_BORROW_DEMAND_WAIT_MS,
          candidateId: 'reviewer',
          mainRole: 'review',
          borrowingRole: 'engineering',
        },
      ])
      expect(f.deps.journal).toHaveBeenCalledWith(
        expect.objectContaining({
          tasks: expect.arrayContaining([
            expect.objectContaining({ id: task.id, handoff: task.handoff }),
          ]),
        }),
      )
      return Promise.resolve('started')
    })
    await f.scheduler.wake()
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS - 1)
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS)
    await f.scheduler.wake()
    expect(f.deps.start).toHaveBeenCalledOnce()
    expect(f.board.task('a-oldest').attempts[0]?.entryId).toBe('reviewer')
    expect(f.board.task('b-next').state).toBe('ready')
    expect(f.port.decisions).toHaveBeenCalledWith([
      expect.objectContaining({ taskId: 'a-oldest', kind: 'borrow', candidateId: 'reviewer' }),
      expect.objectContaining({
        taskId: 'b-next',
        kind: 'none',
        skips: [{ candidateId: 'reviewer', reason: 'busy' }],
      }),
    ])
    expect(teamBoardSchema.parse(f.board.snapshot()).tasks[0]?.handoff).toEqual(
      f.board.task('a-oldest').handoff,
    )
  })

  it('resets the entire unmet-demand window when a main candidate frees between ticks', async () => {
    const f = fixture()
    f.board.submit([submission('work')], 0)
    await f.scheduler.wake()
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS / 2)
    f.signedOut.clear()
    f.deps.authorize = () => Promise.resolve(false)
    await f.scheduler.wake()
    f.signedOut.add('coder')
    f.deps.authorize = () => Promise.resolve(true)
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS)
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_DEMAND_WAIT_MS / 2)
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
        ...attempt(),
        entryId: 'coder',
        agentProfileId: 'coder',
        startedAt: 0,
      })
      await f.scheduler.wake()
      vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS)
      await f.scheduler.wake()
      expect(f.deps.start).not.toHaveBeenCalled()
      expect(f.port.decisions).toHaveBeenLastCalledWith([
        expect.objectContaining({
          taskId: 'waiting',
          reason: 'noLender',
          skips: [{ candidateId: 'reviewer', reason: 'mainWorkDue', untilMs: 5 * TEAM_MINUTE_MS }],
        }),
      ])
    },
  )

  it('never recalls a borrowed coder for its own review, and its engine cannot review through another candidate', async () => {
    const f = fixture()
    await borrowCoding(f)
    const authored = f.board.task('coding').handoff
    if (authored === undefined) throw new Error('test:handoff')
    const context = f.deps.context
    const selected = vi.fn()
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
    f.board.submit([submission('own-review', { roleId: 'review' })], Date.now())
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({ kind: 'keep', reason: 'noMainWork' })
    expect(f.board.task('coding').recallAskedAtMs).toBeUndefined()
    const peers = list('review', ['same-engine', 'independent']).pool
    const same = peers[0]
    if (same?.agent) same.agent.model = ' engine-reviewer '
    f.lists[1]?.pool.push(...peers)
    await f.scheduler.wake()
    expect(f.board.task('own-review').attempts[0]?.entryId).toBe('independent')
    expect(selected).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'own-review' }),
      expect.objectContaining({
        skips: [
          { candidateId: 'reviewer', reason: 'author' },
          { candidateId: 'same-engine', reason: 'author' },
        ],
      }),
    )
  })

  it('honours finish grace through the emitted H decision, then recalls overdue work', async () => {
    const f = fixture()
    const engineering = f.lists[0]
    if (engineering) engineering.minutesPerTask = 3
    await borrowCoding(f)
    f.board.submit([submission('review', { roleId: 'review' })], Date.now())
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'finish',
      expectedFinishMs: TEAM_BORROW_DEMAND_WAIT_MS + 3 * TEAM_MINUTE_MS,
    })
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS + 3 * TEAM_MINUTE_MS)
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'recall',
      deadlineMs: Date.now() + TEAM_BORROW_RECALL_WAIT_MS,
    })
  })

  it('emits journalled recall and bounded-stop decisions to H when main-role work arrives', async () => {
    const f = fixture()
    await borrowCoding(f)
    f.board.submit([submission('review', { roleId: 'review' })], Date.now())
    f.port.recall = vi.fn<SchedulerBorrowPort['recall']>((event) => {
      f.events.push(event)
      if (event.decision.kind === 'recall')
        expect(f.board.task('coding').recallAskedAtMs).toBe(TEAM_BORROW_DEMAND_WAIT_MS)
      expect(f.deps.journal).toHaveBeenLastCalledWith(f.board.snapshot())
      return Promise.resolve()
    })
    await f.scheduler.wake()
    expect(f.events.at(-1)).toEqual({
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
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS - 1)
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision).toMatchObject({
      kind: 'recall',
      deadlineMs: TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS,
    })
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_RECALL_WAIT_MS)
    await f.scheduler.wake()
    expect(f.events.at(-1)?.decision.kind).toBe('stop')
    expect(f.board.task('coding').state).toBe('running')
    expect(f.board.task('review').state).toBe('ready')
  })

  it('cancels recall when another main candidate frees and preserves the borrowed task', async () => {
    const f = fixture()
    await borrowCoding(f)
    f.board.submit([submission('review', { roleId: 'review' })], Date.now())
    await f.scheduler.wake()
    f.lists[1]?.pool.push(...list('review', ['other']).pool)
    await f.scheduler.wake()
    expect(
      f.events.some(
        (event) => event.decision.kind === 'keep' && event.decision.reason === 'mainCandidateFree',
      ),
    ).toBe(true)
    expect(f.board.task('coding').recallAskedAtMs).toBeUndefined()
    expect(f.board.task('review').attempts[0]?.entryId).toBe('other')
  })

  it('retirement returns the lender and enforces its cooldown without raising caps', async () => {
    const f = fixture()
    f.board.submit([submission('coding'), submission('waiting')], 0)
    await f.scheduler.wake()
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS)
    await f.scheduler.wake()
    f.board.finishAttempt('coding', 1, {
      state: 'retired',
      endedAt: Date.now(),
      retirement: { kind: 'proved', method: 'linuxCgroup' },
    })
    f.board.transition('coding', 1, 'done', Date.now())
    await f.scheduler.retired({ taskId: 'coding', attempt: 1 })
    expect(f.board.snapshot().borrowCooldowns).toEqual([
      { candidateId: 'reviewer', endedAtMs: Date.now() },
    ])
    expect(f.board.task('waiting').state).toBe('ready')
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_COOLDOWN_MS - 1)
    await f.scheduler.wake()
    expect(f.board.task('waiting').state).toBe('ready')
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS + TEAM_BORROW_COOLDOWN_MS)
    await f.scheduler.wake()
    expect(f.board.task('waiting').attempts[0]?.entryId).toBe('reviewer')
  })

  it('exposes the live refusal for a lender and uses no secondary roles as the D75 path', async () => {
    const f = fixture()
    f.board.submit([submission('waiting')], 0)
    await f.scheduler.wake()
    f.unavailable.add('reviewer')
    vi.setSystemTime(TEAM_BORROW_DEMAND_WAIT_MS)
    await f.scheduler.wake()
    expect(f.port.decisions).toHaveBeenLastCalledWith([
      expect.objectContaining({ skips: [{ candidateId: 'reviewer', reason: 'notAdmitted' }] }),
    ])
    f.assignments[0]?.secondaryRoles.splice(0)
    const bytes = JSON.stringify(f.board.snapshot())
    f.port.recall = vi.fn()
    f.port.decisions = vi.fn()
    await f.scheduler.wake()
    expect(JSON.stringify(f.board.snapshot())).toBe(bytes)
    expect(f.port.recall).not.toHaveBeenCalled()
    expect(f.port.decisions).not.toHaveBeenCalled()
  })
})
