import { vi } from 'vitest'
import { TaskBoard, type BoardSubmission } from '../../../src/core/team/scheduler/board'
import { type PickContext, type SchedulerEntry } from '../../../src/core/team/scheduler/pick'
import { type SlotRequest } from '../../../src/core/team/scheduler/slots'
import { type TeamAttempt, type TeamBoardTask } from '../../../src/shared/team'
import { TEAM_SIZE_MINUTES } from '../../../src/shared/constants'

export function submission(id: string, patch: Partial<BoardSubmission> = {}): BoardSubmission {
  return {
    id,
    roleId: 'engineering',
    parentSessionId: 'session',
    workspaceMode: 'own-branch',
    fields: { priority: 'normal', size: 'M', overlap: 'serialize' },
    ...patch,
  }
}
export function makeBoard() {
  const countAttempt = vi.fn(() => true)
  const board = new TaskBoard('workspace', 'window', {
    workspaceFor: (id) => (id === 'foreign' ? 'other' : undefined),
    workspaceMode: (id) => (id === 'reader' ? 'read-only' : 'own-branch'),
    report: () => 'untrusted report',
    countAttempt,
  })
  return { board, countAttempt }
}
export function attempt(number = 1, kind: TeamAttempt['kind'] = 'engine'): TeamAttempt {
  return {
    number,
    entryId: 'entry',
    agentProfileId: 'agent',
    modelId: 'model',
    kind,
    state: 'running',
    startedAt: number,
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
export function retireBoardAttempt(board: TaskBoard, id: string) {
  const number = board.task(id).currentAttempt
  return board.finishAttempt(id, number, {
    state: 'retired',
    endedAt: number + 1,
    retirement: { kind: 'proved', method: 'linuxCgroup' },
  })
}
export function readyTask(id: string, patch: Partial<TeamBoardTask> = {}): TeamBoardTask {
  return {
    id,
    workspaceId: 'workspace',
    parentSessionId: 'session',
    roleId: 'engineering',
    priority: 'normal',
    size: 'M',
    overlap: 'serialize',
    state: 'ready',
    held: false,
    createdAt: 0,
    readyAt: 0,
    currentAttempt: 0,
    attempts: [],
    reassignments: 0,
    reviewRounds: 0,
    ...patch,
  }
}
export function entry(patch: Partial<SchedulerEntry> = {}): SchedulerEntry {
  return {
    id: 'entry',
    roleId: 'engineering',
    agentProfileId: 'agent',
    modelId: 'model',
    kind: 'engine',
    poolFit: 1,
    remainingDayTokens: 100,
    eligible: () => true,
    ...patch,
  }
}
export function pickContext(patch: Partial<PickContext> = {}): PickContext {
  return {
    now: 0,
    entries: [entry()],
    canStart: () => true,
    estimatedTokens: () => 100,
    minutes: (task) => TEAM_SIZE_MINUTES[task.size],
    landingOverlap: () => false,
    waits: [],
    youngerStarted: () => false,
    conversationWeight: () => 1,
    ...patch,
  }
}
export function slot(taskId: string, patch: Partial<SlotRequest> = {}): SlotRequest {
  return {
    taskId,
    attempt: 1,
    workspaceId: 'workspace',
    roleId: 'engineering',
    entryId: 'entry',
    agentProfileId: 'agent',
    kind: 'engine',
    ...patch,
  }
}
