import { describe, expect, it, vi } from 'vitest'
import { BoardRefusal, TaskBoard } from '../../src/core/team/scheduler/board'
import { TEAM_BOARD_MAX, TEAM_SCHED_HISTORY_MAX } from '../../src/shared/constants'
import { teamBoardSchema, type TeamBoardTask } from '../../src/shared/team'
import {
  attempt,
  makeBoard,
  readyTask,
  retireBoardAttempt,
  submission,
} from './helpers/teamScheduler'

describe('window task board', () => {
  it('keeps quarantined older attempts chargeable and records their late retirement after archival', () => {
    const { board, archived } = makeBoard()
    board.submit([submission('reader')], 0)
    board.begin('reader', attempt())
    board.finishAttempt('reader', 1, { state: 'uncertain' })
    board.prepareNext('reader', 1, 2, 'stall', true)
    board.begin('reader', attempt(2), true)
    retireBoardAttempt(board, 'reader')
    board.transition('reader', 2, 'done', 3)
    board.submit([submission('next')], 4)
    const charge = vi.fn()
    expect(
      board.applyEvent(
        {
          workspaceId: 'workspace',
          taskId: 'reader',
          attempt: 1,
          at: 4,
          kind: 'usage',
          usage: attempt().usage,
        },
        charge,
      ),
    ).toBe(true)
    expect(charge).toHaveBeenCalledOnce()
    expect(
      board.finishAttempt('reader', 1, {
        state: 'retired',
        endedAt: 5,
        retirement: { kind: 'proved', method: 'linuxCgroup' },
      }),
    ).toBe(true)
    expect(archived.get('reader')?.attempts[0]?.state).toBe('retired')
    expect(board.task('reader').state).toBe('done')
  })

  it('admits new work over long archived dependency chains without a stack or history limit', () => {
    const archived = new Map<string, TeamBoardTask>()
    const length = TEAM_SCHED_HISTORY_MAX * TEAM_BOARD_MAX
    for (let index = 0; index < length; index++) {
      const id = `old-${String(index)}`
      archived.set(
        id,
        readyTask(id, {
          state: 'cancelled',
          depends_on:
            index + 1 === length ? [] : [{ task: `old-${String(index + 1)}`, on: 'done' }],
        }),
      )
    }
    const { board } = makeBoard(archived)
    expect(() =>
      board.submit(
        [
          submission('child', {
            fields: { ...submission('child').fields, depends_on: [{ task: 'old-0' }] },
          }),
        ],
        0,
      ),
    ).not.toThrow()
    expect(board.task('child').state).toBe('blocked')
    expect(board.snapshot().tasks).toHaveLength(1)
  })

  it('refuses cycles through archived task dependencies without changing the board', () => {
    const { board } = makeBoard()
    board.submit(
      [
        submission('a', { fields: { ...submission('a').fields, depends_on: [{ task: 'b' }] } }),
        submission('b'),
      ],
      0,
    )
    board.transition('a', 0, 'cancelled', 1)
    board.submit([submission('c')], 2)
    const before = board.snapshot()
    expect(() => {
      board.reschedule({ task_ids: ['b'], depends_on: [{ task: 'a' }] }, 3)
    }).toThrow('cycle')
    expect(board.snapshot()).toEqual(before)
  })

  it('continues delegation after terminal history fills the old board envelope, including reload', () => {
    const { board } = makeBoard()
    for (let index = 0; index < TEAM_SCHED_HISTORY_MAX; index++) {
      const id = `old-${String(index)}`
      board.submit([submission(id)], index)
      expect(board.transition(id, 0, 'cancelled', index)).toBe(true)
    }
    expect(() => board.submit([submission('next')], TEAM_SCHED_HISTORY_MAX)).not.toThrow()
    const { board: restored } = makeBoard()
    restored.restore(board.snapshot())
    restored.resume()
    expect(() =>
      restored.submit([submission('after-reload')], TEAM_SCHED_HISTORY_MAX),
    ).not.toThrow()
    expect(restored.snapshot().tasks.filter((task) => task.state === 'ready')).toHaveLength(2)
  })

  it('keeps archived dependencies, reports, duplicate refusals and late usage across reload', () => {
    const { board, archived } = makeBoard()
    board.submit([submission('reader', { workspaceMode: 'read-only' })], 0)
    board.begin('reader', attempt())
    retireBoardAttempt(board, 'reader')
    board.transition('reader', 1, 'done', 2)
    board.submit(
      [
        submission('child', {
          fields: { ...submission('child').fields, depends_on: [{ task: 'reader' }] },
        }),
      ],
      3,
    )
    expect(board.snapshot().tasks.map((task) => task.id)).toEqual(['child'])
    const { board: restored } = makeBoard(archived)
    restored.restore(board.snapshot())
    restored.resume()
    expect(restored.dependencyInput('child')).toEqual({
      integrationTasks: [],
      reports: [{ taskId: 'reader', kind: 'data', text: 'untrusted report' }],
    })
    expect(restored.task('reader').state).toBe('done')
    expect(() => restored.submit([submission('reader')], 4)).toThrow('duplicate')
    expect(() =>
      restored.submit(
        [submission('other', { fields: { ...submission('other').fields, key: 'reader' } })],
        4,
      ),
    ).toThrow('duplicateKey')
    const charge = vi.fn()
    const event = { workspaceId: 'workspace', taskId: 'reader', attempt: 1, at: 4 }
    expect(restored.applyEvent({ ...event, kind: 'usage', usage: attempt().usage }, charge)).toBe(
      true,
    )
    expect(charge).toHaveBeenCalledOnce()
    expect(restored.applyEvent({ ...event, kind: 'started' }, charge)).toBe(false)
    expect(
      restored.applyEvent(
        { ...event, taskId: 'unknown', kind: 'usage', usage: attempt().usage },
        charge,
      ),
    ).toBe(false)
    expect(charge).toHaveBeenCalledOnce()
    expect(restored.finishAttempt('reader', 1, { state: 'uncertain' })).toBe(false)
  })

  it('archives legacy full terminal snapshots and preserves failed-dependency blocking', () => {
    const { board, archived } = makeBoard()
    const legacy = board.snapshot()
    legacy.tasks = Array.from({ length: TEAM_SCHED_HISTORY_MAX }, (_, index) =>
      readyTask(`old-${String(index)}`, { state: 'cancelled' }),
    )
    board.restore(legacy)
    expect(board.snapshot().tasks).toHaveLength(0)
    expect(archived.size).toBe(TEAM_SCHED_HISTORY_MAX)
    board.resume()
    board.submit(
      [
        submission('child', {
          fields: { ...submission('child').fields, depends_on: [{ task: 'old-0' }] },
        }),
      ],
      1,
    )
    expect(board.task('child')).toMatchObject({ state: 'blocked', currentAttempt: 0 })
    expect(board.task('child').blockedReason).toContain('old-0')
  })

  it('keeps board admission atomic if archival fails and rejects invalid archived records', () => {
    const { board, archive, archived } = makeBoard()
    board.submit([submission('old')], 0)
    board.transition('old', 0, 'cancelled', 1)
    const before = board.snapshot()
    archive.mockImplementationOnce(() => {
      throw new Error('journal failure')
    })
    expect(() => board.submit([submission('next')], 2)).toThrow('journal failure')
    expect(board.snapshot()).toEqual(before)
    archived.set('foreign', readyTask('foreign', { workspaceId: 'other', state: 'done' }))
    expect(() => board.task('foreign')).toThrow('state')
    archived.set('active', readyTask('active'))
    expect(() => board.task('active')).toThrow('state')
    archived.set('wrong-id', readyTask('different', { state: 'done' }))
    expect(() => board.task('wrong-id')).toThrow('state')
    archived.set(
      'unretired',
      readyTask('unretired', { state: 'done', currentAttempt: 1, attempts: [attempt()] }),
    )
    expect(() => board.task('unretired')).toThrow('state')
  })

  it('refuses unknown and foreign relinks before consulting local task metadata', () => {
    const board = new TaskBoard('workspace', 'window', {
      workspaceFor: (id) => (id === 'foreign' ? 'other' : undefined),
      workspaceMode: () => {
        throw new Error('not local')
      },
      report: () => '',
      countAttempt: () => true,
      archive: vi.fn(),
      archivedTask: () => undefined,
    })
    board.submit([submission('a')], 0)
    const before = board.snapshot()
    for (const [task, code] of [
      ['missing', 'unknownTask'],
      ['foreign', 'crossWorkspace'],
    ] as const) {
      expect(() => {
        board.reschedule({ task_ids: ['a'], depends_on: [{ task }] }, 1)
      }).toThrow(expect.objectContaining({ code, edge: ['a', task] }))
      expect(board.snapshot()).toEqual(before)
    }
  })
  it('opens bounded stall attempts only after retirement or quarantined handoff and records old retirement separately', () => {
    const { board } = makeBoard()
    board.submit([submission('a')], 0)
    board.begin('a', attempt())
    expect(board.prepareNext('a', 1, 2, 'stall')).toBe(false)
    retireBoardAttempt(board, 'a')
    expect(board.prepareNext('a', 1, 2, 'stall')).toBe(true)
    expect(board.task('a').reassignments).toBe(1)
    board.begin('a', attempt(2))
    board.finishAttempt('a', 2, { state: 'uncertain' })
    expect(board.prepareNext('a', 2, 3, 'stall')).toBe(false)
    expect(board.prepareNext('a', 2, 3, 'stall', true)).toBe(true)
    expect(board.begin('a', attempt(3))).toBe(false)
    expect(board.begin('a', attempt(3), true)).toBe(true)
    const before = board.task('a').state
    expect(
      board.finishAttempt('a', 2, {
        state: 'retired',
        endedAt: 4,
        retirement: { kind: 'proved', method: 'linuxCgroup' },
      }),
    ).toBe(true)
    expect(board.task('a').state).toBe(before)
    retireBoardAttempt(board, 'a')
    expect(board.prepareNext('a', 3, 4, 'stall')).toBe(false)
    expect(board.prepareNext('a', 3, 4, 'review')).toBe(true)
  })
  it('refuses cycles, unknown and foreign edges atomically and names the edge', () => {
    const { board } = makeBoard()
    for (const [dependency, code] of [
      ['missing', 'unknownTask'],
      ['foreign', 'crossWorkspace'],
    ]) {
      try {
        board.submit(
          [
            submission('a', {
              fields: { ...submission('a').fields, depends_on: [{ task: dependency! }] },
            }),
          ],
          0,
        )
      } catch (error) {
        expect(error).toBeInstanceOf(BoardRefusal)
        expect(error).toMatchObject({ code, edge: ['a', dependency] })
      }
      expect(board.snapshot().tasks).toHaveLength(0)
    }
    expect(() =>
      board.submit(
        [
          submission('a', {
            fields: { ...submission('a').fields, key: 'first', depends_on: [{ task: 'second' }] },
          }),
          submission('b', {
            fields: { ...submission('b').fields, key: 'second', depends_on: [{ task: 'first' }] },
          }),
        ],
        0,
      ),
    ).toThrow('cycle')
    expect(board.snapshot().tasks).toHaveLength(0)
  })

  it('resolves local keys and defaults by dependency mode, delivering data and integration inputs', () => {
    const { board } = makeBoard()
    board.submit(
      [
        submission('reader', {
          workspaceMode: 'read-only',
          fields: { ...submission('reader').fields, key: 'research' },
        }),
        submission('writer'),
        submission('child', {
          fields: {
            ...submission('child').fields,
            depends_on: [{ task: 'research' }, { task: 'writer' }],
          },
        }),
      ],
      0,
    )
    expect(board.task('child').depends_on).toEqual([
      { task: 'reader', on: 'done' },
      { task: 'writer', on: 'merged' },
    ])
    expect(board.task('child').state).toBe('queued')
    for (const id of ['reader', 'writer']) {
      expect(board.begin(id, attempt())).toBe(true)
      retireBoardAttempt(board, id)
    }
    board.transition('reader', 1, 'done', 2)
    board.transition('writer', 1, 'review', 2)
    board.transition('writer', 1, 'merge', 2)
    expect(board.task('child').state).toBe('queued')
    board.transition('writer', 1, 'merged', 3)
    expect(board.dependencyInput('child')).toEqual({
      integrationTasks: ['writer'],
      reports: [{ taskId: 'reader', kind: 'data', text: 'untrusted report' }],
    })
  })

  it('blocks a failed dependency without cancelling dependents', () => {
    const { board } = makeBoard()
    board.submit(
      [
        submission('a'),
        submission('b', { fields: { ...submission('b').fields, depends_on: [{ task: 'a' }] } }),
      ],
      0,
    )
    board.begin('a', attempt())
    retireBoardAttempt(board, 'a')
    board.transition('a', 1, 'failed', 2)
    expect(board.task('b')).toMatchObject({ state: 'blocked', currentAttempt: 0 })
    expect(board.task('b').blockedReason).toContain('a')
  })

  it('caps open tasks, refuses duplicate ids/keys, and validates boundary input', () => {
    const { board } = makeBoard()
    expect(() => board.submit([submission('a'), submission('a')], 0)).toThrow('duplicate')
    const fields = { ...submission('a').fields, key: 'same' }
    expect(() =>
      board.submit([submission('a', { fields }), submission('b', { fields })], 0),
    ).toThrow('duplicateKey')
    board.submit(
      Array.from({ length: TEAM_BOARD_MAX }, (_, index) => submission(`task-${String(index)}`)),
      0,
    )
    expect(() => board.submit([submission('overflow')], 0)).toThrow('boardFull')
    expect(() => board.applyEvent({ kind: 'usage' }, vi.fn())).toThrow()
  })

  it('counts each attempt and refuses stale state/report events while charging stale usage', () => {
    const { board, countAttempt } = makeBoard()
    board.submit([submission('a')], 0)
    board.begin('a', attempt())
    retireBoardAttempt(board, 'a')
    board.transition('a', 1, 'review', 2)
    board.transition('a', 1, 'ready', 2)
    board.begin('a', attempt(2))
    retireBoardAttempt(board, 'a')
    const before = board.snapshot()
    expect(board.transition('a', 1, 'review', 3)).toBe(false)
    expect(
      board.applyEvent(
        { workspaceId: 'workspace', taskId: 'a', attempt: 1, at: 3, kind: 'started' },
        vi.fn(),
      ),
    ).toBe(false)
    const charge = vi.fn()
    expect(
      board.applyEvent(
        {
          workspaceId: 'workspace',
          taskId: 'a',
          attempt: 1,
          at: 3,
          kind: 'usage',
          usage: { ...attempt().usage, inputTokens: 10 },
        },
        charge,
      ),
    ).toBe(true)
    expect(charge).toHaveBeenCalledOnce()
    expect(board.snapshot()).toEqual(before)
    expect(countAttempt).toHaveBeenCalledTimes(2)
    countAttempt.mockReturnValue(false)
    retireBoardAttempt(board, 'a')
    board.transition('a', 2, 'review', 3)
    board.transition('a', 2, 'ready', 3)
    expect(board.begin('a', attempt(3))).toBe(false)
  })

  it('requires retirement before completion and does not preempt a running attempt', () => {
    const { board } = makeBoard()
    board.submit([submission('a')], 0)
    board.begin('a', attempt())
    expect(board.transition('a', 1, 'review', 2)).toBe(false)
    board.submit(
      [submission('urgent', { fields: { ...submission('urgent').fields, priority: 'urgent' } })],
      2,
    )
    expect(board.task('a').state).toBe('running')
    expect(() => {
      board.reschedule({ task_ids: ['a'], hold: true }, 2)
    }).toThrow('state')
  })

  it('pauses reloads, interrupts active attempts, and resumes queued work only explicitly', () => {
    const { board } = makeBoard()
    board.submit([submission('running'), submission('waiting')], 0)
    board.begin('running', attempt())
    const snapshot = board.snapshot()
    board.restore(snapshot)
    expect(board.paused).toBe(true)
    expect(
      board.applyEvent(
        { workspaceId: 'workspace', taskId: 'running', attempt: 1, at: 3, kind: 'started' },
        vi.fn(),
      ),
    ).toBe(false)
    expect(board.task('running')).toMatchObject({
      state: 'blocked',
      attempts: [{ state: 'interrupted' }],
    })
    expect(board.begin('waiting', attempt())).toBe(false)
    board.resume()
    expect(board.begin('waiting', attempt())).toBe(true)
    expect(teamBoardSchema.safeParse(board.snapshot()).success).toBe(true)
  })

  it('reschedules without starting work, refuses relink cycles atomically, and honors holds', () => {
    const { board, countAttempt } = makeBoard()
    board.submit([submission('a'), submission('b')], 0)
    board.reschedule(
      { task_ids: ['a'], priority: 'urgent', hold: true, depends_on: [{ task: 'b', on: 'done' }] },
      1,
    )
    expect(countAttempt).not.toHaveBeenCalled()
    const before = board.snapshot()
    expect(() => {
      board.reschedule({ task_ids: ['b'], depends_on: [{ task: 'a' }] }, 1)
    }).toThrow('cycle')
    expect(board.snapshot()).toEqual(before)
    board.reschedule({ task_ids: ['b'], hold: true }, 1)
    expect(board.begin('b', attempt())).toBe(false)
  })
})
