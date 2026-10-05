// Lane V's extension-owned panel slices. M95/M96 add their own regions.
// No native MSP/ACP shape is inferred here; adapters provide these projections.
import * as z from 'zod/mini'
import { RUNNER_CONFIG_MAX, TEAM_SCHED_HISTORY_MAX, TEAM_WRITE_SET_MAX } from './constants'
import {
  runnerSchema,
  runnersSchema,
  teamAttemptRefSchema,
  teamBoardSchema,
  teamBoardTaskSchema,
  teamPrioritySchema,
  teamTrafficMetricsSchema,
  teamWriteSetLeaseSchema,
} from './team'

// --- Traffic and runners region (M96c lane V). ---
const id = teamAttemptRefSchema.shape.taskId
const text = runnerSchema.shape.setupCommand
const count = z.int().check(z.nonnegative())
const list = <T extends z.ZodMiniType>(schema: T) =>
  z.array(schema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX))
const paths = z.array(runnerSchema.shape.workFolder).check(z.maxLength(TEAM_WRITE_SET_MAX))
const taskAction = z.enum([
  'raiseLimit',
  'runNext',
  'hold',
  'release',
  'priority',
  'reassign',
  'handOffAnyway',
  'continueAnyway',
  'restartTeamHost',
  'cancel',
])
const resourceAction = z.enum(['takeBack', 'restartServer', 'releaseAnyway'])
const recoveryAction = z.enum([
  'resume',
  'discard',
  'recover',
  'stop',
  'keep',
  'showTerminal',
  'takeOver',
  'newTask',
  'openWindow',
])
const mergeAction = z.enum([
  'retry',
  'remove',
  'landNow',
  'landWithoutChecks',
  'apply',
  'undoBatch',
  'openTerminal',
])
const conflictAction = z.enum(['serialize', 'letBothRun'])
export const trafficSliceSchema = z.strictObject({
  board: teamBoardSchema,
  ranks: list(
    z.strictObject({
      taskId: id,
      priority: z.number().check(z.nonnegative()),
      criticalPath: z.number().check(z.nonnegative()),
      fit: z.number().check(z.gte(0), z.lte(1)),
      score: z.number().check(z.nonnegative()),
    }),
  ),
  entries: list(z.strictObject({ id, generation: count, roleId: id, label: text })),
  taskActions: list(
    z.strictObject({
      taskId: id,
      attempt: count,
      generation: count,
      actions: list(taskAction),
      reason: z.optional(text),
    }),
  ),
  lanes: list(
    z.strictObject({
      id,
      label: text,
      scope: z.enum([
        'role',
        'entry',
        'agent',
        'workers',
        'processWorkers',
        'heavyCommands',
        'runner',
      ]),
      busy: count,
      capacity: count,
    }),
  ),
  hostBusy: z.boolean(),
  writeLeases: list(teamWriteSetLeaseSchema),
  resources: list(
    z.strictObject({
      id,
      generation: count,
      holder: text,
      waiters: list(id),
      actions: list(resourceAction),
    }),
  ),
  windows: list(
    z.strictObject({
      windowInstanceId: id,
      workspace: text,
      branches: list(text),
      paths,
      servers: list(text),
      fresh: z.boolean(),
      workers: count,
      processWorkers: count,
      heavyCommands: count,
    }),
  ),
  localWorkers: count,
  workerCap: count,
  recovery: list(
    z.strictObject({
      id,
      kind: z.enum(['interrupted', 'landing', 'orphan']),
      generation: count,
      taskId: z.optional(id),
      attempt: z.optional(count),
      ownerMayBeLive: z.boolean(),
      windowInstanceId: z.optional(id),
      lockPath: z.optional(text),
      paths,
      pid: z.optional(count),
      launchId: z.optional(id),
      match: z.optional(z.enum(['matched', 'uncertain'])),
      startedAt: z.optional(count),
      detail: text,
      actions: list(recoveryAction),
    }),
  ),
  conflicts: list(
    z.strictObject({
      id,
      generation: count,
      taskIds: list(id),
      paths,
      actions: list(conflictAction),
    }),
  ),
  mergeQueue: list(
    z.strictObject({
      taskId: id,
      position: count.check(z.gte(1)),
      generation: count,
      reason: text,
      state: z.enum(['waiting', 'checking', 'serial', 'returned', 'admitted']),
      checkLocation: z.optional(text),
      flaky: z.boolean(),
      landingBranch: z.optional(text),
      actions: list(mergeAction),
    }),
  ),
  mergePaused: z.boolean(),
  copies: list(
    z.strictObject({
      taskId: id,
      bytes: count,
      generation: count,
      state: z.enum(['merged', 'discarded', 'unmerged', 'quarantined']),
    }),
  ),
  // 0c records writing tasks; rework rates also need all submitted tasks.
  metrics: list(
    z
      .strictObject({ ...teamTrafficMetricsSchema.shape, taskCount: count })
      .check(z.refine((metrics) => metrics.busySlotMs <= metrics.availableSlotMs)),
  ),
  announcements: list(
    z.strictObject({ id, kind: z.enum(['landed', 'candidateReturned']), taskId: id }),
  ),
})
export type TrafficSlice = z.infer<typeof trafficSliceSchema>
export const runnersSliceSchema = z.strictObject({
  runners: runnersSchema,
  health: z
    .array(
      z.strictObject({
        id,
        state: z.enum(['online', 'offline', 'busy', 'testFailed']),
        fingerprint: z.optional(text),
        inputHang: z.boolean(),
        detail: z.optional(text),
      }),
    )
    .check(z.maxLength(RUNNER_CONFIG_MAX)),
  trusted: z.boolean(),
})
export type RunnersSlice = z.infer<typeof runnersSliceSchema>
const windowScope = { workspaceId: id, windowInstanceId: id }
export const trafficMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('traffic/load'), ...windowScope }),
  z.strictObject({
    type: z.literal('traffic/task'),
    ...windowScope,
    taskId: id,
    attempt: count,
    expected: z.strictObject({
      task: teamBoardTaskSchema,
      availability: trafficSliceSchema.shape.taskActions.def.element,
      destination: z.optional(trafficSliceSchema.shape.entries.def.element),
    }),
    action: taskAction,
    priority: z.optional(teamPrioritySchema),
    entryId: z.optional(id),
  }),
  z.strictObject({
    type: z.literal('traffic/queue'),
    ...windowScope,
    action: z.enum(['pause', 'resume', 'pauseMerge', 'resumeMerge']),
  }),
  z.strictObject({
    type: z.literal('traffic/window'),
    ...windowScope,
    otherWindowId: id,
    action: z.literal('openWindow'),
  }),
  z.strictObject({
    type: z.literal('traffic/resource'),
    ...windowScope,
    resourceId: id,
    expected: trafficSliceSchema.shape.resources.def.element,
    action: resourceAction,
  }),
  z.strictObject({
    type: z.literal('traffic/recovery'),
    ...windowScope,
    recoveryId: id,
    expected: trafficSliceSchema.shape.recovery.def.element,
    action: recoveryAction,
    includeEdits: z.optional(z.boolean()),
  }),
  z.strictObject({
    type: z.literal('traffic/conflict'),
    ...windowScope,
    conflictId: id,
    expected: trafficSliceSchema.shape.conflicts.def.element,
    action: conflictAction,
  }),
  z.strictObject({
    type: z.literal('traffic/merge'),
    ...windowScope,
    taskId: id,
    action: mergeAction,
    expected: trafficSliceSchema.shape.mergeQueue.def.element,
  }),
  z.strictObject({
    type: z.literal('traffic/cleanup'),
    ...windowScope,
    taskId: id,
    expected: trafficSliceSchema.shape.copies.def.element,
  }),
])
export type TrafficMessage = z.infer<typeof trafficMessageSchema>
export const runnersMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('runners/load') }),
  z.strictObject({ type: z.literal('runners/save'), runner: runnerSchema }),
  z.strictObject({ type: z.literal('runners/remove'), runnerId: id }),
  z.strictObject({ type: z.literal('runners/test'), runnerId: id }),
  z.strictObject({ type: z.literal('runners/testAll') }),
])
export type RunnersMessage = z.infer<typeof runnersMessageSchema>
export const trafficHostMessageSchema = z.strictObject({
  type: z.literal('traffic/state'),
  state: trafficSliceSchema,
})
export const runnersHostMessageSchema = z.strictObject({
  type: z.literal('runners/state'),
  state: runnersSliceSchema,
})
// --- End Traffic and runners region. ---
