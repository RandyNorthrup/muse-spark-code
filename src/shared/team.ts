// M96c scheduler contracts, owned by the extension (PLAN.md D75). These are
// not native MSP/ACP frames. M96's agents/pools/ledger schemas have their own
// region; scheduler fields compose with them at admission. No host imports.
import * as z from 'zod/mini'
import {
  EXEC_CHILD_ENV_DROP,
  GIT_PATH_MAX_DEFAULT,
  HOOK_FORBIDDEN_ENV_NAMES,
  HOOK_MANAGED_ENV_MAX_NAMES,
  HOOK_MANAGED_ENV_NAME_MAX_CHARS,
  RUNNER_CONFIG_MAX,
  RUNNER_LABELS_MAX,
  RUNNER_MAX_JOBS,
  RUNNER_PORT_MAX,
  TEAM_BOARD_MAX,
  TEAM_MAX_REASSIGNMENTS,
  TEAM_REVIEW_ROUNDS_MAX,
  TEAM_SCHED_HISTORY_MAX,
  TEAM_SCHED_ID_MAX_CHARS,
  TEAM_SCHED_TEXT_MAX_CHARS,
  TEAM_WRITE_SET_MAX,
} from './constants'

// --- Team scheduler region (lane 0c). ---
const id = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(TEAM_SCHED_ID_MAX_CHARS),
    z.regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/),
  )
const text = z.string().check(z.minLength(1), z.maxLength(TEAM_SCHED_TEXT_MAX_CHARS))
const path = z.string().check(
  z.minLength(1),
  z.maxLength(GIT_PATH_MAX_DEFAULT),
  z.refine((value) => !value.includes('\0')),
)
const count = z.int().check(z.nonnegative())
const amount = z.number().check(z.nonnegative())
const attemptNumber = z.int().check(z.gte(1))
const paths = z.array(path).check(z.maxLength(TEAM_WRITE_SET_MAX))

export const teamTaskStateSchema = z.enum([
  'queued',
  'ready',
  'running',
  'blocked',
  'review',
  'merge',
  'merged',
  'done',
  'discarded',
  'failed',
  'cancelled',
  'redesign',
])
export type TeamTaskState = z.infer<typeof teamTaskStateSchema>
export const teamPrioritySchema = z.enum(['urgent', 'high', 'normal', 'low'])
export const teamSizeSchema = z.enum(['S', 'M', 'L', 'XL'])
export const teamStallReasonSchema = z.enum([
  'noProgress',
  'outOfSteps',
  'rateLimited',
  'usageLimited',
  'providerDown',
  'crashed',
])
export const teamIntegrationFlowSchema = z.enum(['full', 'reviewAutomatically', 'manual'])
export const teamOnStallSchema = z.enum(['reassign', 'ask', 'stop'])
export const teamSharedFileSchema = z.strictObject({
  pattern: path,
  kind: z.enum(['text', 'json-table', 'changelog']),
})

// Missing `on` is resolved from the dependency's workspace mode by the board,
// never guessed as `merged` for every task by the boundary parser.
export const teamDependencySchema = z.strictObject({
  task: id,
  on: z.optional(z.enum(['merged', 'done'])),
})
export const teamSchedulerFieldsSchema = z.strictObject({
  key: z.optional(id),
  depends_on: z.optional(z.array(teamDependencySchema).check(z.maxLength(TEAM_BOARD_MAX))),
  priority: z._default(teamPrioritySchema, 'normal'),
  size: z._default(teamSizeSchema, 'M'),
  writes: z.optional(paths),
  overlap: z._default(z.enum(['serialize', 'allow']), 'serialize'),
})
export type TeamSchedulerFields = z.infer<typeof teamSchedulerFieldsSchema>

export const teamAttemptRefSchema = z.strictObject({ taskId: id, attempt: attemptNumber })
export const teamWriteSetLeaseSchema = z.strictObject({
  workspaceId: id,
  holder: teamAttemptRefSchema,
  paths,
  exclusiveWriter: z.boolean(),
  inheritedFrom: z.optional(teamAttemptRefSchema),
})
export type TeamWriteSetLease = z.infer<typeof teamWriteSetLeaseSchema>

// Separate proof from the user's decision; child/group exit is no proof that
// every descendant ended. No cross-window endpoint or hint is evidence here.
export const teamRetirementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('proved'), method: z.enum(['windowsJob', 'linuxCgroup']) }),
  z.strictObject({ kind: z.literal('userDecision') }),
])
export const teamUsageSchema = z.strictObject({
  inputTokens: count,
  cachedInputTokens: count,
  outputTokens: count,
  reasoningTokens: count,
  modelCalls: count,
  costUsd: amount,
  accuracy: z.enum(['reported', 'estimated']),
})
export const teamAttemptSchema = z
  .strictObject({
    number: attemptNumber,
    entryId: id,
    agentProfileId: id,
    modelId: id,
    kind: z.enum(['engine', 'museCode', 'external']),
    state: z.enum(['running', 'retiring', 'retired', 'uncertain', 'interrupted']),
    startedAt: count,
    endedAt: z.optional(count),
    retirement: z.optional(teamRetirementSchema),
    stallReason: z.optional(teamStallReasonSchema),
    usage: teamUsageSchema,
  })
  .check(
    z.refine(
      (value) =>
        (value.state !== 'retired' ||
          (value.retirement !== undefined && value.endedAt !== undefined)) &&
        (value.retirement === undefined || value.state === 'retired') &&
        (value.endedAt === undefined || value.endedAt >= value.startedAt),
    ),
  )
export type TeamAttempt = z.infer<typeof teamAttemptSchema>

export const teamBoardTaskSchema = z
  .strictObject({
    ...teamSchedulerFieldsSchema.shape,
    id,
    workspaceId: id,
    parentSessionId: id,
    roleId: id,
    state: teamTaskStateSchema,
    held: z.boolean(),
    createdAt: count,
    readyAt: z.optional(count),
    blockedReason: z.optional(text),
    branch: z.optional(path),
    currentAttempt: count,
    attempts: z.array(teamAttemptSchema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
    reassignments: count.check(z.lte(TEAM_MAX_REASSIGNMENTS)),
    reviewRounds: count.check(z.lte(TEAM_REVIEW_ROUNDS_MAX)),
  })
  .check(
    z.refine(
      (task) =>
        (task.state !== 'blocked' || task.blockedReason !== undefined) &&
        task.attempts.every((attempt, index) => attempt.number === index + 1) &&
        task.currentAttempt === task.attempts.length,
    ),
  )
export type TeamBoardTask = z.infer<typeof teamBoardTaskSchema>

const terminalStates: ReadonlySet<string> = new Set([
  'merged',
  'done',
  'discarded',
  'failed',
  'cancelled',
  'redesign',
])
// Bound open tasks separately from retained terminal rows.
export const teamBoardSchema = z
  .strictObject({
    workspaceId: id,
    windowInstanceId: id,
    paused: z.boolean(),
    tasks: z.array(teamBoardTaskSchema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
  })
  .check(
    z.refine(
      (board) =>
        new Set(board.tasks.map((task) => task.id)).size === board.tasks.length &&
        board.tasks.every((task) => task.workspaceId === board.workspaceId) &&
        board.tasks.filter((task) => !terminalStates.has(task.state)).length <= TEAM_BOARD_MAX,
    ),
  )
export type TeamBoard = z.infer<typeof teamBoardSchema>

// The scheduler checks attempt identity before mutation. Even a stale usage
// event is charged to its original attempt. Events contain data, not prompts.
const eventBase = { workspaceId: id, taskId: id, attempt: attemptNumber, at: count }
export const teamSchedulerEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...eventBase, kind: z.enum(['ready', 'started', 'diverging', 'landed']) }),
  z.strictObject({
    ...eventBase,
    kind: z.literal('reassigned'),
    fromEntryId: id,
    toEntryId: id,
    reason: teamStallReasonSchema,
  }),
  z.strictObject({ ...eventBase, kind: z.enum(['blocked', 'candidateReturned']), reason: text }),
  z.strictObject({ ...eventBase, kind: z.literal('predictedConflict'), otherTaskId: id, paths }),
  z.strictObject({ ...eventBase, kind: z.literal('usage'), usage: teamUsageSchema }),
])
export type TeamSchedulerEvent = z.infer<typeof teamSchedulerEventSchema>

export const teamRescheduleSchema = z.strictObject({
  task_ids: z.array(id).check(z.minLength(1), z.maxLength(TEAM_BOARD_MAX)),
  priority: z.optional(teamPrioritySchema),
  hold: z.optional(z.boolean()),
  depends_on: z.optional(z.array(teamDependencySchema).check(z.maxLength(TEAM_BOARD_MAX))),
})
export const teamMergeOptionsSchema = z.strictObject({
  task_id: id,
  on_conflict: z._default(z.enum(['rework', 'markers']), 'rework'),
})

export const teamTrafficMetricsSchema = z
  .strictObject({
    period: z.enum(['today', 'week', 'allTime']),
    roleId: z.optional(id),
    entryId: z.optional(id),
    agentProfileId: z.optional(id),
    busySlotMs: amount,
    availableSlotMs: amount,
    queueDepth: z
      .array(z.strictObject({ at: count, ready: count, blocked: count }))
      .check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
    waitMedianMs: z.nullable(amount),
    waitP90Ms: z.nullable(amount),
    writingTasks: count,
    predictedConflicts: count,
    landings: count,
    mergeConflicts: count,
    reworkRounds: count,
    reassignments: count,
    candidatesReturned: count,
    mergedChanges: count,
    reportedCostUsd: amount,
    estimatedCostUsd: amount,
    reportedTokens: count,
    estimatedTokens: count,
    timeToMergeMedianMs: z.nullable(amount),
  })
  .check(z.refine((metrics) => metrics.busySlotMs <= metrics.availableSlotMs))
export type TeamTrafficMetrics = z.infer<typeof teamTrafficMetricsSchema>

const forbiddenEnvironmentNames: ReadonlySet<string> = new Set([
  ...HOOK_FORBIDDEN_ENV_NAMES,
  ...EXEC_CHILD_ENV_DROP,
])
const environmentName = z.string().check(
  z.maxLength(HOOK_MANAGED_ENV_NAME_MAX_CHARS),
  z.regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  z.refine(
    (name) =>
      !name.toUpperCase().endsWith('_API_KEY') &&
      !forbiddenEnvironmentNames.has(name.toUpperCase()),
  ),
)
export const runnerSchema = z.strictObject({
  id,
  // SSH alias or user@host, never an option, whitespace or a shell fragment.
  destination: z
    .string()
    .check(
      z.maxLength(TEAM_SCHED_ID_MAX_CHARS),
      z.regex(/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
    ),
  port: z.optional(z.int().check(z.gte(1), z.lte(RUNNER_PORT_MAX))),
  os: z.enum(['linux', 'darwin', 'win32']),
  workFolder: path,
  maxJobs: z.int().check(z.gte(1), z.lte(RUNNER_MAX_JOBS)),
  labels: z.array(id).check(z.maxLength(RUNNER_LABELS_MAX)),
  commandClasses: z
    .array(z.enum(['tests', 'builds', 'typeChecks', 'declared']))
    .check(z.minLength(1), z.maxLength(RUNNER_LABELS_MAX)),
  setupCommand: text,
  cacheKey: id,
  environmentNames: z._default(
    z.array(environmentName).check(z.maxLength(HOOK_MANAGED_ENV_MAX_NAMES)),
    [],
  ),
})
export type Runner = z.infer<typeof runnerSchema>
export const runnersSchema = z.array(runnerSchema).check(
  z.maxLength(RUNNER_CONFIG_MAX),
  z.refine((runners) => new Set(runners.map((runner) => runner.id)).size === runners.length),
)
// --- End Team scheduler region. ---
