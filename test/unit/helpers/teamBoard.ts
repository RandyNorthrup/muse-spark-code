// Shared scaffolding for the suites that drive a real TaskBoard:
// an in-memory context, submissions, attempts and retirements.
// Shared so the suites cannot drift apart.
import { expect } from 'vitest'
import {
  TaskBoard,
  type BoardContext,
  type BoardSubmission,
} from '../../../src/core/team/scheduler/board'
import type { TeamAttempt, TeamBoardTask } from '../../../src/shared/team'
import { canonicalUsd } from '../../../src/shared/usdSchema'

export function testBoardContext(heads?: Map<string, string>): BoardContext {
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

export function testBoard(heads?: Map<string, string>): TaskBoard {
  return new TaskBoard('workspace', 'window', testBoardContext(heads))
}

export function submitTasks(board: TaskBoard, inputs: BoardSubmission[]): void {
  board.submit(inputs, 1)
}

export function taskSubmission(
  id: string,
  fields: Partial<BoardSubmission['fields']> = {},
  workspaceMode: BoardSubmission['workspaceMode'] = 'own-branch',
): BoardSubmission {
  // The schema's own defaults, so a partial reads like the board parses it.
  const { priority = 'normal', size = 'M', overlap = 'serialize', ...rest } = fields
  return {
    id,
    parentSessionId: 'session',
    roleId: 'role',
    workspaceMode,
    fields: { priority, size, overlap, ...rest },
  }
}

export function boardAttempt(number: number): TeamAttempt {
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
      costUsd: canonicalUsd(0),
      accuracy: 'reported',
    },
  }
}

export function retireAttempt(board: TaskBoard, id: string, number: number): void {
  expect(
    board.finishAttempt(id, number, {
      state: 'retired',
      endedAt: 2,
      retirement: { kind: 'userDecision' },
    }),
  ).toBe(true)
}
