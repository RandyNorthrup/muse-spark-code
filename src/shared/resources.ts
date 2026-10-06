// M107 lane 0: portable contracts, with private process identity kept out of egress.
import * as z from 'zod/mini'
import {
  RESOURCE_CPU_DEFAULT_PERCENT,
  RESOURCE_CPU_MIN_PERCENT,
  RESOURCE_DISK_MIN_FREE_GIB,
  RESOURCE_EXEC_EVENT_VERSION,
  RESOURCE_GIB_BYTES,
  RESOURCE_ID_MAX_LENGTH,
  RESOURCE_MEMORY_DEFAULT_FREE_GIB,
  RESOURCE_MEMORY_DEFAULT_PERCENT,
  RESOURCE_MEMORY_FLOOR_MAX_FRACTION,
  RESOURCE_MEMORY_MAX_FREE_GIB,
  RESOURCE_MEMORY_MAX_PERCENT,
  RESOURCE_MEMORY_MIN_FREE_GIB,
  RESOURCE_MEMORY_MIN_PERCENT,
  RESOURCE_OPTIONAL_MIN_PERCENT,
} from './constants'

export const resourceLevelSchema = z.enum(['normal', 'throttle', 'relocate', 'pause'])
export type ResourceLevel = z.infer<typeof resourceLevelSchema>
export const resourceKindSchema = z.enum([
  'toolShell',
  'backgroundTask',
  'check',
  'mcpServer',
  'worker',
  'subagent',
  'bestOfN',
  'schedule',
  'browserCheck',
  'hook',
  'museServe',
  'other',
])
export type ResourceKind = z.infer<typeof resourceKindSchema>
export const resourceClassSchema = z.enum(['foreground', 'background'])
export type ResourceClass = z.infer<typeof resourceClassSchema>
const percent = z.number().check(z.gte(0), z.lte(100))
const reading = z.nullable(percent)
const counter = z.number().check(z.gte(0), z.int())
const id = z.string().check(z.minLength(1), z.maxLength(RESOURCE_ID_MAX_LENGTH))
const cpuLimit = percent.check(z.gte(RESOURCE_CPU_MIN_PERCENT))
const memoryLimit = percent.check(
  z.gte(RESOURCE_MEMORY_MIN_PERCENT),
  z.lte(RESOURCE_MEMORY_MAX_PERCENT),
)
const memoryFloor = z
  .number()
  .check(z.gte(RESOURCE_MEMORY_MIN_FREE_GIB), z.lte(RESOURCE_MEMORY_MAX_FREE_GIB))
const optionalLimit = z.nullable(percent.check(z.gte(RESOURCE_OPTIONAL_MIN_PERCENT)))

export const resourceSettingsSchema = z.strictObject({
  enabled: z._default(z.boolean(), true),
  cpuMaxPercent: z._default(cpuLimit, RESOURCE_CPU_DEFAULT_PERCENT),
  memoryMaxPercent: z._default(memoryLimit, RESOURCE_MEMORY_DEFAULT_PERCENT),
  memoryMinFreeGiB: z._default(memoryFloor, RESOURCE_MEMORY_DEFAULT_FREE_GIB),
  gpuMaxPercent: z._default(optionalLimit, null),
  diskBusyMaxPercent: z._default(optionalLimit, null),
  // null selects the volume-scaled default floor; explicit values are machine-only.
  diskMinFreeGiB: z._default(z.nullable(z.number().check(z.gte(RESOURCE_DISK_MIN_FREE_GIB))), null),
  relocate: z._default(z.enum(['paired', 'ask', 'off']), 'paired'),
})
export type ResourceSettings = z.infer<typeof resourceSettingsSchema>

// Adapters supply inspected machine settings, never an effective workspace value.
export interface ResourceSettingOrigin {
  readonly defaultValue?: unknown
  readonly globalValue?: unknown
  readonly workspaceValue?: unknown
  readonly workspaceFolderValue?: unknown
}
export type ResourceSettingsReader = (key: string) => ResourceSettingOrigin | undefined
export function readResourceSettings(inspect: ResourceSettingsReader): ResourceSettings {
  const keys = {
    enabled: 'resourceGovernor',
    cpuMaxPercent: 'resourceCpuMaxPercent',
    memoryMaxPercent: 'resourceMemoryMaxPercent',
    memoryMinFreeGiB: 'resourceMemoryMinFreeGiB',
    gpuMaxPercent: 'resourceGpuMaxPercent',
    diskBusyMaxPercent: 'resourceDiskBusyMaxPercent',
    diskMinFreeGiB: 'resourceDiskMinFreeGiB',
    relocate: 'resourceRelocate',
  }
  const entries = Object.entries(keys).map(([field, key]) => {
    const origin = inspect(key)
    return [field, origin?.globalValue === undefined ? origin?.defaultValue : origin.globalValue]
  })
  return resourceSettingsSchema.parse(Object.fromEntries(entries))
}
export function resourceMemoryFloorBytes(settings: ResourceSettings, totalBytes: number): number {
  const total = counter.check(z.gt(0)).parse(totalBytes)
  return Math.min(
    settings.memoryMinFreeGiB * RESOURCE_GIB_BYTES,
    total * RESOURCE_MEMORY_FLOOR_MAX_FRACTION,
  )
}

// Local surfaces use logical volume roles, never workspace paths in egress.
export const resourceDiskRoleSchema = z.enum([
  'workspace',
  'worktrees',
  'temp',
  'data',
  'logs',
  'nodeState',
])
export type ResourceDiskRole = z.infer<typeof resourceDiskRoleSchema>
export const resourceDiskVolumeSchema = z
  .strictObject({
    role: resourceDiskRoleSchema,
    atMs: counter,
    freeBytes: z.nullable(counter),
    totalBytes: z.nullable(counter.check(z.gt(0))),
    etaMs: z.nullable(z.number().check(z.gte(0))),
  })
  .check(
    z.refine(
      (volume) =>
        volume.freeBytes === null ||
        volume.totalBytes === null ||
        volume.freeBytes <= volume.totalBytes,
    ),
  )
export type ResourceDiskVolume = z.infer<typeof resourceDiskVolumeSchema>

// Each failed or unavailable reading is null, including a first CPU delta.
export const resourceSampleSchema = z
  .strictObject({
    atMs: counter,
    cpuPercent: reading,
    memoryUsedPercent: reading,
    memoryAvailableBytes: z.nullable(counter),
    memoryTotalBytes: z.nullable(counter.check(z.gt(0))),
    gpuPercent: reading,
    diskBusyPercent: reading,
    diskVolumes: z.optional(z.array(resourceDiskVolumeSchema)),
    pressure: z.nullable(
      z.strictObject({
        cpuSomePercent: reading,
        memorySomePercent: reading,
        memoryFullPercent: reading,
      }),
    ),
  })
  .check(
    z.refine(
      (sample) =>
        sample.memoryAvailableBytes === null ||
        sample.memoryTotalBytes === null ||
        sample.memoryAvailableBytes <= sample.memoryTotalBytes,
    ),
  )
export type ResourceSample = z.infer<typeof resourceSampleSchema>
export interface ResourceSampler {
  sample(): Promise<ResourceSample>
}
export interface ResourceClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): () => void
}

// Only the local registry/actuator uses these. No ticket is in a status or record.
export const resourceProcessIdentitySchema = z.strictObject({
  pid: counter.check(z.gt(0)),
  startTime: id,
})
export type ResourceProcessIdentity = z.infer<typeof resourceProcessIdentitySchema>
export const resourceTicketSchema = z.strictObject({
  id,
  root: resourceProcessIdentitySchema,
  scope: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('job'), name: id }),
    z.strictObject({ type: z.literal('cgroup'), path: z.string().check(z.minLength(1)) }),
    z.strictObject({ type: z.literal('group'), pgid: counter.check(z.gt(0)) }),
  ]),
  kind: resourceKindSchema,
  class: resourceClassSchema,
  sessionId: z.nullable(id),
})
export type ResourceTicket = z.infer<typeof resourceTicketSchema>
export const resourceTreeUsageSchema = z.strictObject({
  cpuSeconds: z.number().check(z.gte(0)),
  residentBytes: counter,
})
export type ResourceTreeUsage = z.infer<typeof resourceTreeUsageSchema>
export interface ResourceTreeReader {
  members(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[]>
  contains(ticket: ResourceTicket, process: ResourceProcessIdentity): Promise<boolean>
  usage(ticket: ResourceTicket): Promise<ResourceTreeUsage | null>
}

const reason = z.enum([
  'cpu',
  'memoryUsed',
  'memoryFree',
  'gpu',
  'disk',
  'recovery',
  'critical',
  'override',
  'disabled',
])
export const resourceEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('levelChanged'),
    atMs: counter,
    from: resourceLevelSchema,
    to: resourceLevelSchema,
    reason,
  }),
  z.strictObject({
    type: z.literal('deferred'),
    atMs: counter,
    kind: resourceKindSchema,
    class: resourceClassSchema,
  }),
  z.strictObject({
    type: z.literal('relocated'),
    atMs: counter,
    kind: z.enum(['worker', 'check']),
    level: resourceLevelSchema,
    reason: z.literal('machineBusy'),
  }),
  z.strictObject({ type: z.literal('paused'), atMs: counter, kind: resourceKindSchema }),
  z.strictObject({ type: z.literal('override'), atMs: counter, untilMs: counter }),
])
export type ResourceEvent = z.infer<typeof resourceEventSchema>
export const resourceStatusSchema = z.strictObject({
  level: resourceLevelSchema,
  sample: z.nullable(resourceSampleSchema),
  settings: resourceSettingsSchema,
  queued: z.array(
    z.strictObject({ kind: resourceKindSchema, class: resourceClassSchema, count: counter }),
  ),
  overrideUntilMs: z.nullable(counter),
})
export type ResourceStatus = z.infer<typeof resourceStatusSchema>

// M100's offer status adds this field, never any raw local machine readings.
export const deviceResourceSchema = z.strictObject({
  level: resourceLevelSchema,
  headroom: z.enum(['ample', 'some', 'none']),
  diskFree: z.optional(
    z.strictObject({ freeBytes: z.nullable(counter), floorBytes: z.nullable(counter) }),
  ),
})
export type DeviceResource = z.infer<typeof deviceResourceSchema>
export interface ResourceLinkedDevice {
  resource(): Promise<DeviceResource>
  hasOffer(repository: string, kind: 'worker' | 'check'): boolean
  admit(repository: string, kind: 'worker' | 'check'): Promise<boolean>
}

// M102 composes this variant into its journal. No free text or process identity.
const minuteSchema = z.strictObject({
  cpuPercent: reading,
  memoryUsedPercent: reading,
  availableMemory: z.enum(['belowFloor', 'low', 'ample', 'unknown']),
  gpuPercent: reading,
  diskBusyPercent: reading,
  level: resourceLevelSchema,
  thresholds: z.strictObject({
    cpuMaxPercent: cpuLimit,
    memoryMaxPercent: memoryLimit,
    memoryMinFreeGiB: memoryFloor,
  }),
})
export const resourceRecordSchema = z
  .strictObject({
    type: z.literal('resource'),
    atMs: counter,
    minute: z.nullable(minuteSchema),
    event: z.nullable(resourceEventSchema),
    work: z.array(
      z.strictObject({
        kind: resourceKindSchema,
        cpuSeconds: z.number().check(z.gte(0)),
        peakMemoryBytes: counter,
      }),
    ),
  })
  .check(z.refine((record) => (record.minute === null) !== (record.event === null)))
export type ResourceRecord = z.infer<typeof resourceRecordSchema>

// H composes this with the existing events when it adopts event envelope v2.
// The nested M80 result remains v1; lane 0 does not change the live exec writer.
export const resourceExecEventSchema = z.strictObject({
  v: z.literal(RESOURCE_EXEC_EVENT_VERSION),
  seq: counter.check(z.gt(0)),
  time: z.iso.datetime(),
  type: z.literal('resource'),
  event: resourceEventSchema,
})
export type ResourceExecEvent = z.infer<typeof resourceExecEventSchema>
