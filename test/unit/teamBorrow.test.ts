// D212 borrow and recall (M120 lane 0): every rule on an explicit clock. The
// snapshot is the board as lane S and lane H will hand it over; the clock is
// the `nowMs` each tick passes.

import { describe, expect, it } from 'vitest'
import {
  decideBorrow,
  decideRecall,
  expectedFinishMs,
  nextMainWorkInMs,
  taskAuthorCandidates,
  type BorrowAgent,
  type BorrowProducingTask,
  type BorrowQueuedTask,
  type BorrowRoleFacts,
  type BorrowSnapshot,
} from '../../src/core/team/borrow'
import {
  TEAM_BORROW_COOLDOWN_MS,
  TEAM_BORROW_DEMAND_WAIT_MS,
  TEAM_BORROW_FINISH_GRACE_MS,
  TEAM_BORROW_LOOKAHEAD_MS,
  TEAM_BORROW_RECALL_WAIT_MS,
} from '../../src/shared/constants'
import { teamBorrowTimersSchema } from '../../src/shared/teamPreference'

const SECOND = 1000
const MINUTE = 60 * SECOND
const T0 = 1_000_000_000
const HOUR = 60 * MINUTE

function reviewer(id: string, extra: Partial<BorrowAgent> = {}): BorrowAgent {
  return {
    candidateId: id,
    engine: `${id}-engine`,
    mainRole: 'code-review',
    secondaryRoles: ['engineering'],
    underCaps: true,
    ...extra,
  }
}

function codingTask(extra: Partial<BorrowQueuedTask> = {}): BorrowQueuedTask {
  return {
    taskId: 'code-1',
    roleId: 'engineering',
    queuedAtMs: T0,
    unmetSinceMs: T0,
    mainCandidateFree: false,
    preference: ['coder-a', 'coder-b'],
    ...extra,
  }
}

function snapshot(
  nowMs: number,
  parts: Partial<Omit<BorrowSnapshot, 'nowMs' | 'roles'>> & {
    readonly roles?: Readonly<Record<string, BorrowRoleFacts>>
  } = {},
): BorrowSnapshot {
  return {
    nowMs,
    agents: parts.agents ?? [reviewer('rev-a')],
    queued: parts.queued ?? [codingTask()],
    producing: parts.producing ?? [],
    roles: new Map(Object.entries(parts.roles ?? {})),
  }
}

function producingCode(startedAtMs: number, extra: Partial<BorrowProducingTask> = {}) {
  return {
    taskId: 'code-running',
    roleId: 'engineering',
    startedAtMs,
    timeBoxMs: HOUR,
    produces: { roleId: 'code-review' },
    ...extra,
  } satisfies BorrowProducingTask
}

describe('the D212 timers (contract)', () => {
  it('defaults every timer and enforces the 60 s demand-wait floor', () => {
    expect(teamBorrowTimersSchema.parse({})).toStrictEqual({
      demandWaitMs: TEAM_BORROW_DEMAND_WAIT_MS,
      lookaheadMs: TEAM_BORROW_LOOKAHEAD_MS,
      finishGraceMs: TEAM_BORROW_FINISH_GRACE_MS,
      recallWaitMs: TEAM_BORROW_RECALL_WAIT_MS,
      cooldownMs: TEAM_BORROW_COOLDOWN_MS,
    })
    expect([
      TEAM_BORROW_DEMAND_WAIT_MS,
      TEAM_BORROW_LOOKAHEAD_MS,
      TEAM_BORROW_FINISH_GRACE_MS,
      TEAM_BORROW_RECALL_WAIT_MS,
      TEAM_BORROW_COOLDOWN_MS,
    ]).toStrictEqual([MINUTE, 10 * MINUTE, 5 * MINUTE, 2 * MINUTE, 3 * MINUTE])
    expect(teamBorrowTimersSchema.safeParse({ demandWaitMs: 59_999 }).success).toBe(false)
    expect(teamBorrowTimersSchema.parse({ demandWaitMs: 90_000 }).demandWaitMs).toBe(90_000)
  })
})

describe('decideBorrow: the demand wait', () => {
  it('does not borrow at 59 s of unmet demand and borrows at 60 s', () => {
    expect(decideBorrow(snapshot(T0 + 59 * SECOND))).toStrictEqual([
      {
        kind: 'none',
        taskId: 'code-1',
        roleId: 'engineering',
        reason: 'demandYoung',
        untilMs: T0 + MINUTE,
        skips: [],
      },
    ])
    expect(decideBorrow(snapshot(T0 + MINUTE - 1))[0]?.kind).toBe('none')
    expect(decideBorrow(snapshot(T0 + MINUTE))).toStrictEqual([
      {
        kind: 'borrow',
        taskId: 'code-1',
        roleId: 'engineering',
        candidateId: 'rev-a',
        skips: [],
      },
    ])
  })

  it('a main candidate freeing inside the window cancels the borrow', () => {
    const freedAt = T0 + 40 * SECOND
    const late = snapshot(T0 + 80 * SECOND, { queued: [codingTask({ unmetSinceMs: freedAt })] })
    expect(decideBorrow(late)[0]).toMatchObject({
      kind: 'none',
      reason: 'mainFree',
      untilMs: freedAt + MINUTE,
    })
    expect(
      decideBorrow(
        snapshot(freedAt + MINUTE, { queued: [codingTask({ unmetSinceMs: freedAt })] }),
      )[0]?.kind,
    ).toBe('borrow')
    expect(
      decideBorrow(snapshot(T0 + HOUR, { queued: [codingTask({ mainCandidateFree: true })] }))[0],
    ).toMatchObject({ kind: 'none', reason: 'mainFree' })
  })

  it('uses the borrowing role’s own demand wait', () => {
    const roles = {
      engineering: { timers: teamBorrowTimersSchema.parse({ demandWaitMs: 2 * MINUTE }) },
    }
    expect(decideBorrow(snapshot(T0 + 119 * SECOND, { roles }))[0]?.kind).toBe('none')
    expect(decideBorrow(snapshot(T0 + 2 * MINUTE, { roles }))[0]?.kind).toBe('borrow')
  })

  it('thrash: demand flapping every 30 s never borrows', () => {
    const borrowed: string[] = []
    for (let now = T0; now <= T0 + 30 * MINUTE; now += SECOND) {
      // Every 30 s a main coder frees for a moment and is taken again.
      const unmetSinceMs = T0 + Math.floor((now - T0) / (30 * SECOND)) * 30 * SECOND
      const decision = decideBorrow(snapshot(now, { queued: [codingTask({ unmetSinceMs })] }))[0]
      if (decision?.kind === 'borrow') {
        borrowed.push(decision.candidateId)
      }
    }
    expect(borrowed).toStrictEqual([])
  })
})

describe('decideBorrow: who may lend', () => {
  const late = T0 + 2 * MINUTE

  it('never lends an agent without the role as a secondary role', () => {
    const agents = [
      reviewer('rev-a', { secondaryRoles: [] }),
      reviewer('rev-b', { mainRole: 'engineering' }),
    ]
    expect(decideBorrow(snapshot(late, { agents }))[0]).toStrictEqual({
      kind: 'none',
      taskId: 'code-1',
      roleId: 'engineering',
      reason: 'noLender',
      skips: [],
    })
  })

  it('skips a busy agent, caps and conditions, each with its reason', () => {
    const agents = [
      reviewer('rev-busy', {
        running: {
          taskId: 'r',
          roleId: 'code-review',
          startedAtMs: T0,
          timeBoxMs: HOUR,
          borrowed: false,
        },
      }),
      reviewer('rev-capped', { underCaps: false }),
      reviewer('rev-mac', { conditions: { platforms: ['macos'] } }),
    ]
    const queued = [codingTask({ conditions: { platform: 'windows' } })]
    expect(decideBorrow(snapshot(late, { agents, queued }))[0]).toStrictEqual({
      kind: 'none',
      taskId: 'code-1',
      roleId: 'engineering',
      reason: 'noLender',
      skips: [
        { candidateId: 'rev-busy', reason: 'busy' },
        { candidateId: 'rev-capped', reason: 'capped' },
        { candidateId: 'rev-mac', reason: 'conditions' },
      ],
    })
    expect(
      decideBorrow(
        snapshot(late, {
          agents: [
            reviewer('rev-win', {
              conditions: { platforms: ['windows'], features: ['tools.write'] },
            }),
          ],
          queued: [codingTask({ conditions: { platform: 'windows', features: ['tools.write'] } })],
        }),
      )[0]?.kind,
    ).toBe('borrow')
  })

  it('review ≠ author: a borrowed coder and its engine never review the task it coded', () => {
    // rev-a (main role review) was borrowed to code code-1, which muse started.
    const authors = taskAuthorCandidates('muse', {
      taskId: 'code-1',
      roleId: 'engineering',
      chain: [
        {
          kind: 'borrow',
          atMs: T0,
          candidateId: 'rev-a',
          mainRole: 'code-review',
          borrowingRole: 'engineering',
        },
        {
          kind: 'move',
          atMs: T0 + MINUTE,
          trigger: 'returnToPreferred',
          fromCandidateId: 'rev-a',
          toCandidateId: 'claude',
          work: { commits: [], newFiles: [] },
        },
      ],
    })
    expect(authors).toStrictEqual(['muse', 'rev-a', 'claude'])
    const review = (conditions: BorrowQueuedTask['conditions']): BorrowQueuedTask => ({
      taskId: 'review-1',
      roleId: 'code-review',
      queuedAtMs: T0,
      unmetSinceMs: T0,
      mainCandidateFree: false,
      preference: [],
      ...(conditions !== undefined && { conditions }),
    })
    // Its own review is never main-role work for it: no due-soon, no recall.
    const byCandidate = review({ authorCandidates: authors })
    expect(nextMainWorkInMs(reviewer('rev-a'), snapshot(late, { queued: [byCandidate] }))).toBe(
      Infinity,
    )
    const lentAgain = reviewer('rev-a', {
      running: {
        taskId: 'code-2',
        roleId: 'engineering',
        startedAtMs: T0,
        timeBoxMs: HOUR,
        borrowed: true,
      },
    })
    expect(
      decideRecall(snapshot(late, { agents: [lentAgain], queued: [byCandidate] })),
    ).toMatchObject([{ kind: 'keep', reason: 'noMainWork' }])
    // A coder on the same engine never lends itself to that review.
    const sameEngine = {
      ...reviewer('rev-b'),
      mainRole: 'engineering',
      secondaryRoles: ['code-review'],
    }
    expect(
      decideBorrow(
        snapshot(late, {
          agents: [sameEngine],
          queued: [review({ authorCandidates: authors, authorEngines: ['rev-b-engine'] })],
        }),
      )[0],
    ).toMatchObject({ reason: 'noLender', skips: [{ candidateId: 'rev-b', reason: 'author' }] })
  })

  it('cooldown: no borrow within 3 min of coming back, then borrows at 3:00', () => {
    const back = T0 + MINUTE
    const agents = [reviewer('rev-a', { lastBorrowEndedAtMs: back })]
    expect(decideBorrow(snapshot(back + 3 * MINUTE - 1, { agents }))[0]).toMatchObject({
      reason: 'noLender',
      skips: [{ candidateId: 'rev-a', reason: 'borrowCooldown', untilMs: back + 3 * MINUTE }],
    })
    expect(decideBorrow(snapshot(back + 3 * MINUTE, { agents }))[0]?.kind).toBe('borrow')
  })

  it('lookahead: a queued main-role task keeps the agent home', () => {
    const queued = [
      codingTask(),
      {
        ...codingTask({ taskId: 'review-9', roleId: 'code-review', mainCandidateFree: true }),
        queuedAtMs: late,
      },
    ]
    expect(decideBorrow(snapshot(late, { queued }))[0]).toMatchObject({
      reason: 'noLender',
      skips: [{ candidateId: 'rev-a', reason: 'mainWorkDue', untilMs: late }],
    })
  })

  it('lookahead 0: queued main-role work still keeps the agent home', () => {
    // A zero lookahead covers only work that is not queued yet: the idle
    // reviewer has a queued review, so it is never lent to coding.
    const roles = {
      'code-review': { timers: teamBorrowTimersSchema.parse({ lookaheadMs: 0 }) },
    }
    const queued = [
      codingTask(),
      {
        ...codingTask({ taskId: 'review-9', roleId: 'code-review', mainCandidateFree: true }),
        queuedAtMs: late,
      },
    ]
    expect(decideBorrow(snapshot(late, { queued, roles }))[0]).toMatchObject({
      reason: 'noLender',
      skips: [{ candidateId: 'rev-a', reason: 'mainWorkDue', untilMs: late }],
    })
  })

  it('lookahead: a review due in 9:59 keeps the agent home, one due in 10:00 does not', () => {
    const now = T0 + 2 * MINUTE
    // A coding lane, time-boxed at 15 min with no median, that will need a review.
    const dueIn = (ms: number) => [
      producingCode(now + ms - 15 * MINUTE, { timeBoxMs: 15 * MINUTE }),
    ]
    expect(
      decideBorrow(snapshot(now, { producing: dueIn(9 * MINUTE + 59 * SECOND) }))[0],
    ).toMatchObject({
      reason: 'noLender',
      skips: [
        { candidateId: 'rev-a', reason: 'mainWorkDue', untilMs: now + 9 * MINUTE + 59 * SECOND },
      ],
    })
    expect(decideBorrow(snapshot(now, { producing: dueIn(10 * MINUTE) }))[0]?.kind).toBe('borrow')
  })

  it('due soon uses the role’s median, bounded by the time box', () => {
    const roles = { engineering: { medianDurationMs: 20 * MINUTE } }
    const running = producingCode(T0, { timeBoxMs: HOUR })
    expect(expectedFinishMs(running, new Map(Object.entries(roles)))).toBe(T0 + 20 * MINUTE)
    expect(
      expectedFinishMs({ ...running, timeBoxMs: 5 * MINUTE }, new Map(Object.entries(roles))),
    ).toBe(T0 + 5 * MINUTE)
    // Started at T0 with a 20-minute median: due at T0+20, so at T0+11 it is 9 min away.
    expect(decideBorrow(snapshot(T0 + 11 * MINUTE, { producing: [running], roles }))[0]?.kind).toBe(
      'none',
    )
    expect(decideBorrow(snapshot(T0 + 9 * MINUTE, { producing: [running], roles }))[0]?.kind).toBe(
      'borrow',
    )
    // An overdue lane is due now.
    expect(
      nextMainWorkInMs(reviewer('rev-a'), snapshot(T0 + HOUR, { producing: [running], roles })),
    ).toBe(0)
  })

  it('a review → fix lane counts for a coder whose main role is engineering', () => {
    const coder = { ...reviewer('coder-x'), mainRole: 'engineering', secondaryRoles: ['qa'] }
    const now = T0 + 2 * MINUTE
    const review = producingCode(now - 55 * MINUTE, {
      roleId: 'code-review',
      produces: { roleId: 'engineering' },
    })
    const qa = codingTask({ taskId: 'qa-1', roleId: 'qa' })
    expect(
      decideBorrow(snapshot(now, { agents: [coder], queued: [qa], producing: [review] }))[0],
    ).toMatchObject({
      skips: [{ candidateId: 'coder-x', reason: 'mainWorkDue' }],
    })
  })

  it('work the agent authored is not main-role work due for it', () => {
    const now = T0 + 2 * MINUTE
    const own = producingCode(now - 55 * MINUTE, {
      produces: { roleId: 'code-review', conditions: { authorEngines: ['rev-a-engine'] } },
    })
    expect(decideBorrow(snapshot(now, { producing: [own] }))[0]?.kind).toBe('borrow')
  })
})

describe('decideBorrow: order', () => {
  const now = T0 + 2 * MINUTE

  it('idlest main role first, then secondary order, then the preference list', () => {
    const soon = producingCode(now - 45 * MINUTE, { produces: { roleId: 'code-review' } })
    const agents = [
      reviewer('rev-near'),
      { ...reviewer('docs-far'), mainRole: 'docs', secondaryRoles: ['research', 'engineering'] },
      { ...reviewer('qa-far'), mainRole: 'qa', secondaryRoles: ['engineering'] },
    ]
    // rev-near has a review due in 15 min; both others have none: secondary order picks qa-far.
    expect(decideBorrow(snapshot(now, { agents, producing: [soon] }))[0]).toMatchObject({
      kind: 'borrow',
      candidateId: 'qa-far',
    })
    const tied = [
      { ...reviewer('qa-1'), mainRole: 'qa' },
      { ...reviewer('qa-2'), mainRole: 'qa' },
    ]
    expect(
      decideBorrow(
        snapshot(now, { agents: tied, queued: [codingTask({ preference: ['qa-2', 'qa-1'] })] }),
      )[0],
    ).toMatchObject({ candidateId: 'qa-2' })
    // Idlest beats the others even when it is later in every list.
    const idle = [
      reviewer('rev-near'),
      { ...reviewer('zz-idle'), mainRole: 'design', secondaryRoles: ['docs', 'engineering'] },
    ]
    expect(
      decideBorrow(
        snapshot(now, {
          agents: idle,
          queued: [codingTask({ preference: ['rev-near'] })],
          producing: [producingCode(now - 30 * MINUTE)],
        }),
      )[0],
    ).toMatchObject({ candidateId: 'zz-idle' })
  })

  it('one task per borrow: two waiting tasks take two agents, oldest task first', () => {
    const agents = [reviewer('rev-a'), reviewer('rev-b')]
    const queued = [codingTask({ taskId: 'code-2', queuedAtMs: T0 + 1 }), codingTask()]
    expect(
      decideBorrow(snapshot(now, { agents, queued })).map(
        (item) => item.kind === 'borrow' && [item.taskId, item.candidateId],
      ),
    ).toStrictEqual([
      ['code-1', 'rev-a'],
      ['code-2', 'rev-b'],
    ])
    const one = decideBorrow(snapshot(now, { agents: [reviewer('rev-a')], queued }))
    expect(one[1]).toMatchObject({
      kind: 'none',
      skips: [{ candidateId: 'rev-a', reason: 'busy' }],
    })
  })

  it('D103 unchanged with no secondary role: never borrows, never recalls', () => {
    const agents = [
      { ...reviewer('muse'), mainRole: 'engineering', secondaryRoles: [] },
      { ...reviewer('codex'), secondaryRoles: [] },
    ]
    for (let at = T0; at <= T0 + HOUR; at += 7 * MINUTE) {
      expect(decideBorrow(snapshot(at, { agents })).every((item) => item.kind === 'none')).toBe(
        true,
      )
      expect(decideRecall(snapshot(at, { agents }))).toStrictEqual([])
    }
    expect(decideBorrow(snapshot(T0, { agents, queued: [] }))).toStrictEqual([])
  })
})

describe('decideRecall', () => {
  const borrowedAt = T0
  const reviewWork = (extra: Partial<BorrowQueuedTask> = {}): BorrowQueuedTask => ({
    taskId: 'review-1',
    roleId: 'code-review',
    queuedAtMs: T0 + 30 * MINUTE,
    unmetSinceMs: T0 + 30 * MINUTE,
    mainCandidateFree: false,
    preference: ['rev-a'],
    ...extra,
  })
  const lent = (extra: Partial<NonNullable<BorrowAgent['running']>> = {}) =>
    reviewer('rev-a', {
      running: {
        taskId: 'code-1',
        roleId: 'engineering',
        startedAtMs: borrowedAt,
        timeBoxMs: HOUR,
        borrowed: true,
        ...extra,
      },
    })
  const freshDemand = (now: number): BorrowQueuedTask[] => [
    reviewWork({ queuedAtMs: now, unmetSinceMs: now }),
  ]

  it('keeps the borrow with no main-role work', () => {
    expect(
      decideRecall(snapshot(T0 + 30 * MINUTE, { agents: [lent()], queued: [] })),
    ).toStrictEqual([
      { kind: 'keep', candidateId: 'rev-a', taskId: 'code-1', reason: 'noMainWork' },
    ])
  })

  it('priority return: main-role work recalls at the next safe point, bounded by the recall wait', () => {
    const now = T0 + 30 * MINUTE
    expect(decideRecall(snapshot(now, { agents: [lent()], queued: [reviewWork()] }))).toStrictEqual(
      [{ kind: 'recall', candidateId: 'rev-a', taskId: 'code-1', deadlineMs: now + 2 * MINUTE }],
    )
  })

  it('finish grace: a task due in 4:59 finishes, one due in 5:00 is recalled', () => {
    const roles = { engineering: { medianDurationMs: 40 * MINUTE } }
    const finish = T0 + 40 * MINUTE
    // The main-role demand just arrived, so the 5-minute grace window opens
    // at now: a finish inside it keeps `finish`, one on its edge recalls.
    const inside = finish - 5 * MINUTE + 1
    expect(
      decideRecall(snapshot(inside, { agents: [lent()], queued: freshDemand(inside), roles })),
    ).toStrictEqual([
      { kind: 'finish', candidateId: 'rev-a', taskId: 'code-1', expectedFinishMs: finish },
    ])
    const edge = finish - 5 * MINUTE
    expect(
      decideRecall(snapshot(edge, { agents: [lent()], queued: freshDemand(edge), roles }))[0]?.kind,
    ).toBe('recall')
  })

  it('finish grace expires: unmet work at minute 9 recalls by minute 14', () => {
    // Coding starts at minute 0 (median 10 min, box 60 min); an unmet review
    // arrives at minute 9. The 5-minute grace opens at minute 9, not at the
    // expected finish: the task finishes at minute 9 but is recalled from
    // minute 14 on, at the next safe point bounded by the recall wait.
    const roles = { engineering: { medianDurationMs: 10 * MINUTE } }
    const demand = T0 + 9 * MINUTE
    const queued = [reviewWork({ queuedAtMs: demand, unmetSinceMs: demand })]
    expect(decideRecall(snapshot(demand, { agents: [lent()], queued, roles }))).toStrictEqual([
      {
        kind: 'finish',
        candidateId: 'rev-a',
        taskId: 'code-1',
        expectedFinishMs: T0 + 10 * MINUTE,
      },
    ])
    for (const at of [14 * MINUTE, 15 * MINUTE, 30 * MINUTE, 59 * MINUTE]) {
      expect(decideRecall(snapshot(T0 + at, { agents: [lent()], queued, roles }))).toStrictEqual([
        {
          kind: 'recall',
          candidateId: 'rev-a',
          taskId: 'code-1',
          deadlineMs: T0 + at + 2 * MINUTE,
        },
      ])
    }
  })

  it('finish grace stays anchored to demand: older demand recalls a later finish', () => {
    // Demand began at minute 9 but the borrowed task is expected to finish
    // at minute 15. The 5-minute grace ends at minute 14, so at minute 11
    // the task is recalled even though its finish is still in the future.
    // A grace restarted on every tick would return `finish` instead.
    const roles = { engineering: { medianDurationMs: 15 * MINUTE } }
    const demand = T0 + 9 * MINUTE
    const now = T0 + 11 * MINUTE
    const queued = [reviewWork({ queuedAtMs: demand, unmetSinceMs: demand })]
    expect(decideRecall(snapshot(now, { agents: [lent()], queued, roles }))).toStrictEqual([
      {
        kind: 'recall',
        candidateId: 'rev-a',
        taskId: 'code-1',
        deadlineMs: now + 2 * MINUTE,
      },
    ])
  })

  it('finish grace: zero grace recalls at once and an overdue task gets no grace', () => {
    const demand = T0 + 9 * MINUTE
    const queued = [reviewWork({ queuedAtMs: demand, unmetSinceMs: demand })]
    // Zero grace: the window already ends when the demand appears.
    const noGrace = {
      'code-review': { timers: teamBorrowTimersSchema.parse({ finishGraceMs: 0 }) },
    }
    expect(
      decideRecall(snapshot(demand, { agents: [lent()], queued, roles: noGrace })),
    ).toStrictEqual([
      {
        kind: 'recall',
        candidateId: 'rev-a',
        taskId: 'code-1',
        deadlineMs: demand + 2 * MINUTE,
      },
    ])
    // Past its expected finish (5-minute box, now at minute 9) with fresh
    // demand: no grace, even though the window just opened.
    const overdue = reviewer('rev-a', {
      running: {
        taskId: 'code-1',
        roleId: 'engineering',
        startedAtMs: T0,
        timeBoxMs: 5 * MINUTE,
        borrowed: true,
      },
    })
    expect(decideRecall(snapshot(demand, { agents: [overdue], queued }))).toStrictEqual([
      {
        kind: 'recall',
        candidateId: 'rev-a',
        taskId: 'code-1',
        deadlineMs: demand + 2 * MINUTE,
      },
    ])
  })

  it('recall pairing: the flexible reviewer covers windows so both are recalled', () => {
    // a-flex runs Windows and macOS, b-mac macOS only; both borrowed tasks
    // finish together. The older review needs macOS, the next needs
    // Windows: pairing b-mac with macOS and a-flex with Windows recalls both.
    const now = T0 + 31 * MINUTE
    const borrowed = (
      id: string,
      conditions: { platforms: ('windows' | 'macos')[] },
    ): BorrowAgent =>
      reviewer(id, {
        conditions,
        running: {
          taskId: `code-${id}`,
          roleId: 'engineering',
          startedAtMs: T0,
          timeBoxMs: HOUR,
          borrowed: true,
        },
      })
    const macTask: BorrowQueuedTask = {
      taskId: 'review-old',
      roleId: 'code-review',
      queuedAtMs: T0 + 30 * MINUTE,
      unmetSinceMs: T0 + 30 * MINUTE,
      mainCandidateFree: false,
      preference: [],
      conditions: { platform: 'macos' },
    }
    const winTask: BorrowQueuedTask = {
      ...macTask,
      taskId: 'review-new',
      queuedAtMs: T0 + 30 * MINUTE + 1,
      conditions: { platform: 'windows' },
    }
    const agents = [
      borrowed('a-flex', { platforms: ['windows', 'macos'] }),
      borrowed('b-mac', { platforms: ['macos'] }),
    ]
    expect(
      decideRecall(snapshot(now, { agents, queued: [macTask, winTask] })).map((item) => [
        item.candidateId,
        item.kind,
      ]),
    ).toStrictEqual([
      ['a-flex', 'recall'],
      ['b-mac', 'recall'],
    ])
  })

  it('recall wait: still waiting at 1:59, stop and capture at 2:00', () => {
    const asked = T0 + 30 * MINUTE
    const agents = [lent({ recallAskedAtMs: asked })]
    expect(
      decideRecall(snapshot(asked + 2 * MINUTE - 1, { agents, queued: [reviewWork()] })),
    ).toStrictEqual([
      { kind: 'recall', candidateId: 'rev-a', taskId: 'code-1', deadlineMs: asked + 2 * MINUTE },
    ])
    expect(
      decideRecall(snapshot(asked + 2 * MINUTE, { agents, queued: [reviewWork()] })),
    ).toStrictEqual([{ kind: 'stop', candidateId: 'rev-a', taskId: 'code-1' }])
  })

  it('a main candidate freeing first keeps the borrow, even after a recall was asked', () => {
    const now = T0 + 31 * MINUTE
    const queued = [reviewWork({ mainCandidateFree: true })]
    expect(
      decideRecall(snapshot(now, { agents: [lent({ recallAskedAtMs: now - MINUTE })], queued })),
    ).toStrictEqual([
      { kind: 'keep', candidateId: 'rev-a', taskId: 'code-1', reason: 'mainCandidateFree' },
    ])
  })

  it('work the agent authored or cannot meet never recalls it', () => {
    const now = T0 + 31 * MINUTE
    const own = reviewWork({ conditions: { authorCandidates: ['rev-a'] } })
    const windows = reviewWork({ taskId: 'review-2', conditions: { platform: 'windows' } })
    expect(
      decideRecall(snapshot(now, { agents: [lent()], queued: [own, windows] }))[0],
    ).toMatchObject({
      kind: 'keep',
      reason: 'noMainWork',
    })
  })

  it('one main task recalls one agent: the one already asked, then the earliest to finish', () => {
    const now = T0 + 31 * MINUTE
    const early = reviewer('rev-b', {
      running: {
        taskId: 'code-2',
        roleId: 'engineering',
        startedAtMs: T0 - 10 * MINUTE,
        timeBoxMs: HOUR,
        borrowed: true,
      },
    })
    expect(
      decideRecall(snapshot(now, { agents: [lent(), early], queued: [reviewWork()] })).map(
        (item) => [item.candidateId, item.kind],
      ),
    ).toStrictEqual([
      ['rev-b', 'recall'],
      ['rev-a', 'keep'],
    ])
    expect(
      decideRecall(
        snapshot(now, {
          agents: [lent({ recallAskedAtMs: now - SECOND }), early],
          queued: [reviewWork()],
        }),
      ).map((item) => [item.candidateId, item.kind]),
    ).toStrictEqual([
      ['rev-a', 'recall'],
      ['rev-b', 'keep'],
    ])
  })

  it('an agent running its main role is never recalled', () => {
    const home = reviewer('rev-a', {
      running: {
        taskId: 'review-0',
        roleId: 'code-review',
        startedAtMs: T0,
        timeBoxMs: HOUR,
        borrowed: false,
      },
    })
    expect(
      decideRecall(snapshot(T0 + MINUTE, { agents: [home], queued: [reviewWork()] })),
    ).toStrictEqual([])
  })
})
