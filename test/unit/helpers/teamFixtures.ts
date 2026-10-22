import {
  TeamAgentMarks,
  type TEAM_DEFAULT_ENTRY,
  type TeamAgentProfile,
  type TeamCap,
  type TeamPoolEntry,
  type TeamRolePool,
  type TeamSelectionSnapshot,
} from '../../../src/core/team/teamPool'
import {
  TaskBoard,
  type BoardContext,
  type BoardSubmission,
} from '../../../src/core/team/scheduler/board'
import type { PickContext, SchedulerEntry } from '../../../src/core/team/scheduler/pick'
import type { SlotRequest } from '../../../src/core/team/scheduler/slots'
import type { TeamAttempt, TeamBoardTask } from '../../../src/shared/team'
import { TEAM_SIZE_MINUTES } from '../../../src/shared/constants'
import { Usd } from '../../../src/shared/usd'

// Plain input data for the team selection and scheduler suites: agents,
// entries, pools, snapshots, submissions and board contexts as object
// literals, with call recording through plain closures. No timers are
// faked and no module is stood in: every clock is an explicit number the
// test sets, and every port is the real production interface fed by the
// fixture. Production code never sees these; they only feed real code.

/** Records each call's arguments in `calls`; the test asserts on the array. */
export function tapped<A extends unknown[], R>(
  impl: (...args: A) => R,
): ((...args: A) => R) & {
  calls: A[]
} {
  const calls: A[] = []
  const fn = (...args: A): R => {
    calls.push(args)
    return impl(...args)
  }
  return Object.assign(fn, { calls })
}

/** The recorded calls of a `tapped` port, typed by the port's signature. */
export function callsOf<A extends unknown[]>(fn: (...args: A) => unknown): A[] {
  const calls = (fn as unknown as { calls?: A[] }).calls
  if (calls === undefined) throw new Error('test:untapped')
  return calls
}

export function keyAgent(
  overrides: Partial<TeamAgentProfile> & { readonly key: string },
): TeamAgentProfile {
  return {
    kind: 'engine',
    billing: 'key',
    modelId: 'muse-spark-1.3',
    label: overrides.key,
    ...overrides,
  }
}

export function poolEntry(
  id: string,
  agent: TeamAgentProfile | typeof TEAM_DEFAULT_ENTRY,
  caps: readonly TeamCap[] = [],
  concurrent = 4,
): TeamPoolEntry {
  return { id, agent, concurrent, caps }
}

export function rolePool(
  roleId: string,
  entries: readonly TeamPoolEntry[],
  overrides: Partial<TeamRolePool> = {},
): TeamRolePool {
  return { roleId, entries, policy: 'ask', continueOnNext: false, ...overrides }
}

export interface SnapshotOptions {
  readonly nowMs?: number
  readonly defaultAgent?: TeamAgentProfile
  readonly runningByEntry?: ReadonlyMap<string, number>
  readonly runningByAgent?: ReadonlyMap<string, number>
  readonly used?: (entryId: string, cap: TeamCap) => number
  readonly firstTokens?: number
  readonly firstInputTokens?: number
  readonly firstOutputTokens?: number
  readonly firstSpendUsd?: number
  readonly agentLimit?: (agentKey: string) => number
  readonly available?: (agent: TeamAgentProfile) => boolean
  readonly marks?: TeamAgentMarks
  readonly startedThisTurn?: number
  readonly taskId?: string
}

export function selectionSnapshot(options: SnapshotOptions = {}): TeamSelectionSnapshot {
  return {
    nowMs: options.nowMs ?? 1_000_000,
    defaultAgent:
      options.defaultAgent ?? keyAgent({ key: 'default', label: 'Default (muse-spark-1.3)' }),
    startedThisTurn: options.startedThisTurn ?? 0,
    runningByEntry: options.runningByEntry ?? new Map(),
    runningByAgent: options.runningByAgent ?? new Map(),
    usedByEntryCap: options.used ?? (() => 0),
    firstRequest: {
      tokens: options.firstTokens ?? 1000,
      inputTokens: options.firstInputTokens ?? options.firstTokens ?? 1000,
      outputTokens: options.firstOutputTokens ?? 0,
      spendUsd: Usd.from(options.firstSpendUsd ?? 0.01).toAmount(),
    },
    agentLimit: options.agentLimit ?? (() => 8),
    isAgentAvailable: options.available ?? (() => true),
    global: { running: 0, limit: 20 },
    process: { running: 0, limit: 4 },
    teamBudget: undefined,
    marks: options.marks ?? new TeamAgentMarks(),
    taskId: options.taskId ?? 'task-1',
  }
}

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

/** A real TaskBoard whose counting ports record through plain closures. */
export function makeBoard(
  archived = new Map<string, TeamBoardTask>(),
  counting: Partial<Pick<BoardContext, 'countAttempt' | 'refundAttempt'>> = {},
) {
  const countAttempt = tapped(counting.countAttempt ?? (() => true))
  const refundAttempt = tapped(
    counting.refundAttempt ??
      (() => {
        throw new Error('test:refundUncounted')
      }),
  )
  const archive = tapped((tasks: readonly TeamBoardTask[]) => {
    for (const task of tasks) archived.set(task.id, structuredClone(task))
  })
  const board = new TaskBoard('workspace', 'window', {
    workspaceFor: (id) => (id === 'foreign' ? 'other' : undefined),
    workspaceMode: (id) => (id === 'reader' ? 'read-only' : 'own-branch'),
    report: () => 'untrusted report',
    countAttempt,
    refundAttempt,
    archive,
    archivedTask: (id) => archived.get(id),
  })
  return { board, countAttempt, refundAttempt, archive, archived }
}

export function boardAttempt(number = 1, kind: TeamAttempt['kind'] = 'engine'): TeamAttempt {
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
      costUsd: Usd.from(0).toAmount(),
      accuracy: 'reported',
    },
  }
}

export function schedulerEntry(patch: Partial<SchedulerEntry> = {}): SchedulerEntry {
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
    entries: [schedulerEntry({})],
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

export function slotRequest(taskId: string, patch: Partial<SlotRequest> = {}): SlotRequest {
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
