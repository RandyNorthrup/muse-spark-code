// M96d waiting-branch refresh: an own-branch task whose recorded
// integration base moved refreshes its branch before its next
// attempt. Unrecorded tasks keep M96c's behaviour exactly.
import { describe, expect, it } from 'vitest'
import {
  TaskBoard,
  type BoardContext,
  type BoardSubmission,
} from '../../src/core/team/scheduler/board'
import {
  boardAttempt as attempt,
  retireAttempt as retire,
  submitTasks as submit,
  taskSubmission as submission,
  testBoardContext,
} from './helpers/teamBoard'

function refreshContext(
  holder: { head: string },
  modes?: ReadonlyMap<string, BoardSubmission['workspaceMode']>,
  hasProvider = true,
): BoardContext {
  const context = testBoardContext()
  return {
    ...context,
    workspaceMode: (taskId) => modes?.get(taskId) ?? context.workspaceMode(taskId),
    ...(hasProvider && { integrationHead: () => holder.head }),
  }
}

function submitOne(board: TaskBoard): void {
  submit(board, [submission('task', {})])
}

/** The first attempt runs and readies its successor. */
function runFirstAttempt(board: TaskBoard): void {
  expect(board.begin('task', attempt(1))).toBe(true)
  retire(board, 'task', 1)
  expect(board.prepareNext('task', 1, 2, 'review')).toBe(true)
}

describe('M96d waiting-branch refresh', () => {
  it('gates the next begin until the moved integration is acknowledged', () => {
    const holder = { head: 'h1' }
    const board = new TaskBoard('workspace', 'window', refreshContext(holder))
    submitOne(board)
    expect(board.integrationRefreshDue('task')).toBeUndefined()
    expect(board.acknowledgeIntegrationRefresh('task', 'h1')).toBe(true)
    expect(board.integrationRefreshDue('task')).toBeUndefined()
    runFirstAttempt(board)
    holder.head = 'h2'
    expect(board.integrationRefreshDue('task')).toEqual({ base: 'h2' })
    expect(board.begin('task', attempt(2))).toBe(false)
    // A stale acknowledgement fails and records nothing.
    expect(board.acknowledgeIntegrationRefresh('task', 'h1')).toBe(false)
    expect(board.integrationRefreshDue('task')).toEqual({ base: 'h2' })
    expect(board.acknowledgeIntegrationRefresh('task', 'h2')).toBe(true)
    expect(board.task('task').integrationBase).toBe('h2')
    expect(board.begin('task', attempt(2))).toBe(true)
  })

  it('leaves unrecorded tasks alone and never touches a missing provider', () => {
    const board = new TaskBoard(
      'workspace',
      'window',
      refreshContext({ head: 'h1' }, undefined, false),
    )
    submitOne(board)
    expect(board.integrationRefreshDue('task')).toBeUndefined()
    // No provider, no base: the begin proceeds exactly as M96c ran it.
    runFirstAttempt(board)
    expect(board.begin('task', attempt(2))).toBe(true)
  })

  it('refuses to track other workspace modes', () => {
    const modes = new Map<string, BoardSubmission['workspaceMode']>([
      ['task', 'in-place'],
      ['reader', 'read-only'],
    ])
    const holder = { head: 'h1' }
    const context = refreshContext(holder, modes)
    const board = new TaskBoard('workspace', 'window', context)
    submit(board, [submission('task', {}), submission('reader', {})])
    expect(board.acknowledgeIntegrationRefresh('task', 'h1')).toBe(false)
    expect(board.acknowledgeIntegrationRefresh('reader', 'h1')).toBe(false)
    expect(board.integrationRefreshDue('task')).toBeUndefined()
    expect(board.integrationRefreshDue('reader')).toBeUndefined()
    expect(board.task('task').integrationBase).toBeUndefined()
    expect(board.begin('task', attempt(1))).toBe(true)
    expect(board.begin('reader', attempt(1))).toBe(true)
    // The provider is never touched for other modes, even when missing.
    delete context.integrationHead
    expect(board.integrationRefreshDue('task')).toBeUndefined()
    expect(board.integrationRefreshDue('reader')).toBeUndefined()
  })

  it('throws without a provider once a base is recorded', () => {
    const holder = { head: 'h1' }
    const context = refreshContext(holder)
    const board = new TaskBoard('workspace', 'window', context)
    submitOne(board)
    expect(board.acknowledgeIntegrationRefresh('task', 'h1')).toBe(true)
    delete context.integrationHead
    // A recorded base with no provider is a wiring bug, never a stall.
    expect(() => board.integrationRefreshDue('task')).toThrow(
      expect.objectContaining({ message: 'dependencies' }),
    )
    expect(() => board.begin('task', attempt(1))).toThrow(
      expect.objectContaining({ message: 'dependencies' }),
    )
  })
})
