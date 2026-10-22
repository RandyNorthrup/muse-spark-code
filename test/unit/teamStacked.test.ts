// M96d stacked dependencies: real boards, real attempts, real heads.
import { describe, expect, it } from 'vitest'
import {
  TaskBoard,
  type BoardContext,
  type BoardSubmission,
} from '../../src/core/team/scheduler/board'
import { inheritedPriorities } from '../../src/core/team/scheduler/pick'
import { landingOrderEdges, orderMergeQueue } from '../../src/core/team/mergeQueue'
import { teamDependencySchema, type TeamAttempt, type TeamBoardTask } from '../../src/shared/team'

function testContext(heads?: Map<string, string>): BoardContext {
  const archived = new Map<string, TeamBoardTask>()
  const context: BoardContext = {
    workspaceFor: () => 'workspace',
    workspaceMode: () => 'own-branch',
    report: (taskId) => `report-${taskId}`,
    countAttempt: () => true,
    archive: (tasks) => {
      for (const task of tasks) archived.set(task.id, task)
    },
    archivedTask: (id) => archived.get(id),
  }
  if (heads !== undefined) {
    context.head = (taskId) => heads.get(taskId) ?? `head-${taskId}`
  }
  return context
}

function submit(board: TaskBoard, inputs: BoardSubmission[]): void {
  board.submit(inputs, 1)
}

function submission(id: string, fields: BoardSubmission['fields']): BoardSubmission {
  return { id, parentSessionId: 'session', roleId: 'role', workspaceMode: 'own-branch', fields }
}

function attempt(number: number): TeamAttempt {
  return {
    number,
    entryId: 'entry',
    agentProfileId: 'profile',
    modelId: 'model',
    kind: 'engine',
    state: 'running',
    startedAt: 1,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      modelCalls: 0,
      costUsd: 0,
      accuracy: 'reported',
    },
  }
}

function retire(board: TaskBoard, id: string, number: number): void {
  expect(
    board.finishAttempt(id, number, {
      state: 'retired',
      endedAt: 2,
      retirement: { kind: 'userDecision' },
    }),
  ).toBe(true)
}

/** Run a task to a finished state through real transitions. */
function runTo(board: TaskBoard, id: string, state: 'review' | 'merged' | 'done'): void {
  expect(board.begin(id, attempt(1))).toBe(true)
  retire(board, id, 1)
  if (state === 'done') {
    expect(board.transition(id, 1, 'done', 3)).toBe(true)
    return
  }
  expect(board.transition(id, 1, 'review', 3)).toBe(true)
  if (state === 'review') return
  expect(board.transition(id, 1, 'merge', 4)).toBe(true)
  expect(board.transition(id, 1, 'merged', 5)).toBe(true)
}

function candidate(id: string, dependsOn: readonly string[]) {
  return {
    id,
    dependsOn,
    priority: 'normal' as const,
    conflictsWith: [],
    changedLines: 10,
    files: [],
    finishedAt: 1,
    onConflict: 'rework' as const,
  }
}

describe('M96d stacked dependencies', () => {
  it("parses on: stacked and resolves it like the board's own edges", () => {
    expect(teamDependencySchema.parse({ task: 'a', on: 'stacked' })).toEqual({
      task: 'a',
      on: 'stacked',
    })
    const board = new TaskBoard('workspace', 'window', testContext())
    submit(board, [
      submission('dep', {}),
      submission('stacked', { depends_on: [{ task: 'dep', on: 'stacked' }] }),
    ])
    expect(board.task('stacked').depends_on).toEqual([{ task: 'dep', on: 'stacked' }])
    // Cycles and unknown tasks refuse uniformly, whatever the edge kind.
    const cyclic = new TaskBoard('workspace', 'window', testContext())
    expect(() =>
      cyclic.submit(
        [
          submission('a', { depends_on: [{ task: 'b', on: 'stacked' }] }),
          submission('b', { depends_on: [{ task: 'a', on: 'stacked' }] }),
        ],
        1,
      ),
    ).toThrow(expect.objectContaining({ message: 'cycle' }))
    expect(() =>
      cyclic.submit([submission('c', { depends_on: [{ task: 'missing', on: 'stacked' }] })], 1),
    ).toThrow(expect.objectContaining({ message: 'unknownTask' }))
  })

  it('waits for the finished head, then starts from it', () => {
    const heads = new Map([['dep', 'head-1']])
    const board = new TaskBoard('workspace', 'window', testContext(heads))
    submit(board, [
      submission('dep', {}),
      submission('stacked', { depends_on: [{ task: 'dep', on: 'stacked' }] }),
    ])
    // Queued, ready and running are unfinished: the dependent waits.
    expect(board.task('stacked').state).toBe('queued')
    expect(board.task('dep').state).toBe('ready')
    expect(board.begin('dep', attempt(1))).toBe(true)
    expect(board.task('stacked').state).toBe('queued')
    retire(board, 'dep', 1)
    expect(board.transition('dep', 1, 'review', 3)).toBe(true)
    // The finished head readies the dependent.
    expect(board.task('stacked').state).toBe('ready')
    expect(board.dependencyInput('stacked').stackedBases).toEqual([{ task: 'dep', base: 'head-1' }])
    // The first begin waits for the launcher to base the worktree.
    expect(board.stackRefreshDue('stacked')).toEqual([{ task: 'dep', base: 'head-1' }])
    expect(board.begin('stacked', attempt(1))).toBe(false)
    expect(board.acknowledgeStackRefresh('stacked', [{ task: 'dep', base: 'head-1' }])).toBe(true)
    expect(board.begin('stacked', attempt(1))).toBe(true)
    expect(board.task('stacked').stackBases).toEqual([{ task: 'dep', base: 'head-1' }])
  })

  it('treats merged and done as finished heads, unsuccessful ends as blocks', () => {
    for (const state of ['merged', 'done'] as const) {
      const board = new TaskBoard('workspace', 'window', testContext())
      submit(board, [
        submission('dep', {}),
        submission('stacked', { depends_on: [{ task: 'dep', on: 'stacked' }] }),
      ])
      runTo(board, 'dep', state)
      expect(board.task('stacked').state).toBe('ready')
    }
    for (const state of ['discarded', 'failed', 'cancelled', 'redesign'] as const) {
      const board = new TaskBoard('workspace', 'window', testContext())
      submit(board, [
        submission('dep', {}),
        submission('stacked', { depends_on: [{ task: 'dep', on: 'stacked' }] }),
      ])
      expect(board.begin('dep', attempt(1))).toBe(true)
      retire(board, 'dep', 1)
      if (state === 'redesign') {
        expect(board.transition('dep', 1, 'review', 3)).toBe(true)
        expect(board.transition('dep', 1, 'redesign', 4)).toBe(true)
      } else if (state === 'discarded') {
        expect(board.transition('dep', 1, 'review', 3)).toBe(true)
        expect(board.transition('dep', 1, 'discarded', 4)).toBe(true)
      } else {
        expect(board.transition('dep', 1, state, 3)).toBe(true)
      }
      expect(board.task('stacked').state).toBe('blocked')
    }
  })

  it('refreshes the dependent at its next boundary when rework moves the head', () => {
    const heads = new Map([['dep', 'head-1']])
    const board = new TaskBoard('workspace', 'window', testContext(heads))
    submit(board, [
      submission('dep', {}),
      submission('stacked', { depends_on: [{ task: 'dep', on: 'stacked' }] }),
    ])
    expect(board.begin('dep', attempt(1))).toBe(true)
    retire(board, 'dep', 1)
    expect(board.transition('dep', 1, 'review', 3)).toBe(true)
    expect(board.acknowledgeStackRefresh('stacked', [{ task: 'dep', base: 'head-1' }])).toBe(true)
    expect(board.begin('stacked', attempt(1))).toBe(true)
    retire(board, 'stacked', 1)
    expect(board.transition('stacked', 1, 'review', 4)).toBe(true)
    // The dependency reworks and finishes on a new head.
    expect(board.transition('dep', 1, 'ready', 5)).toBe(true)
    expect(board.begin('dep', attempt(2))).toBe(true)
    retire(board, 'dep', 2)
    heads.set('dep', 'head-2')
    expect(board.transition('dep', 2, 'review', 6)).toBe(true)
    // The dependent's next boundary waits for the refresh.
    expect(board.transition('stacked', 1, 'ready', 7)).toBe(true)
    expect(board.stackRefreshDue('stacked')).toEqual([{ task: 'dep', base: 'head-2' }])
    expect(board.begin('stacked', attempt(2))).toBe(false)
    // A stale acknowledgement fails and records nothing.
    expect(board.acknowledgeStackRefresh('stacked', [{ task: 'dep', base: 'head-1' }])).toBe(false)
    expect(board.task('stacked').stackBases).toEqual([{ task: 'dep', base: 'head-1' }])
    expect(board.acknowledgeStackRefresh('stacked', [{ task: 'dep', base: 'head-2' }])).toBe(true)
    expect(board.begin('stacked', attempt(2))).toBe(true)
    expect(board.task('stacked').stackBases).toEqual([{ task: 'dep', base: 'head-2' }])
  })

  it('fails loud without a head provider, and leaves unstacked tasks alone', () => {
    const board = new TaskBoard('workspace', 'window', testContext())
    submit(board, [
      submission('dep', {}),
      submission('stacked', { depends_on: [{ task: 'dep', on: 'stacked' }] }),
      submission('plain', {}),
    ])
    expect(board.begin('dep', attempt(1))).toBe(true)
    retire(board, 'dep', 1)
    expect(board.transition('dep', 1, 'review', 3)).toBe(true)
    expect(board.task('stacked').state).toBe('ready')
    expect(() => board.stackRefreshDue('stacked')).toThrow(
      expect.objectContaining({ message: 'dependencies' }),
    )
    expect(() => board.begin('stacked', attempt(1))).toThrow(
      expect.objectContaining({ message: 'dependencies' }),
    )
    expect(() => board.dependencyInput('stacked')).toThrow(
      expect.objectContaining({ message: 'dependencies' }),
    )
    // Tasks without stacked edges never touch the provider.
    expect(board.stackRefreshDue('plain')).toEqual([])
    expect(board.acknowledgeStackRefresh('plain', [])).toBe(true)
    expect(board.begin('plain', attempt(1))).toBe(true)
  })

  it('orders stacked landings after their dependency and inherits priority', () => {
    expect(
      landingOrderEdges({
        depends_on: [
          { task: 'a', on: 'merged' },
          { task: 'b', on: 'stacked' },
          { task: 'c', on: 'done' },
          { task: 'd' },
        ],
      }),
    ).toEqual(['a', 'b'])
    expect(landingOrderEdges({})).toEqual([])
    const ordered = orderMergeQueue(
      [candidate('stacked', ['dep']), candidate('dep', []), candidate('other', [])],
      new Set(),
    )
    expect(ordered.ordered.map((entry) => entry.id)).toEqual(['dep', 'other', 'stacked'])

    const board = new TaskBoard('workspace', 'window', testContext())
    submit(board, [
      submission('holder', { priority: 'low' }),
      submission('waiter', {
        priority: 'urgent',
        depends_on: [{ task: 'holder', on: 'stacked' }],
      }),
    ])
    const levels = inheritedPriorities(board.snapshot().tasks, [], 100)
    expect(levels.get('holder')).toBe('urgent')
    expect(levels.get('waiter')).toBe('urgent')
  })
})
