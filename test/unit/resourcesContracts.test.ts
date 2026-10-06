import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import execV1 from '../../docs/schemas/exec-event-v1.schema.json'
import execV2 from '../../docs/schemas/exec-event-v2.schema.json'
import * as constants from '../../src/shared/constants'
import {
  deviceResourceSchema,
  readResourceSettings,
  resourceClassSchema,
  resourceEventSchema,
  resourceExecEventSchema,
  resourceKindSchema,
  resourceLevelSchema,
  resourceMemoryFloorBytes,
  resourceProcessIdentitySchema,
  resourceRecordSchema,
  resourceSampleSchema,
  resourceSettingsSchema,
  resourceStatusSchema,
  resourceTicketSchema,
  resourceTreeUsageSchema,
  type ResourceEvent,
  type ResourceClass,
  type ResourceExecEvent,
  type ResourceKind,
  type ResourceLevel,
  type ResourceRecord,
  type ResourceSample,
  type ResourceSettingsReader,
  type ResourceStatus,
} from '../../src/shared/resources'

const sample: ResourceSample = {
  atMs: 0,
  cpuPercent: null,
  memoryUsedPercent: null,
  memoryAvailableBytes: null,
  memoryTotalBytes: null,
  gpuPercent: null,
  diskBusyPercent: null,
  pressure: null,
}
const event: ResourceEvent = {
  type: 'levelChanged',
  atMs: 0,
  from: 'normal',
  to: 'throttle',
  reason: 'cpu',
}
const record: ResourceRecord = { type: 'resource', atMs: 0, minute: null, event, work: [] }
const defaults = resourceSettingsSchema.parse({})
const workspaceOnly: ResourceSettingsReader = () => ({
  workspaceValue: 99,
  workspaceFolderValue: 98,
})

describe('M107 resource contracts', () => {
  it('starts on with D87 defaults and optional probes unset', () => {
    expect(defaults).toEqual({
      enabled: true,
      cpuMaxPercent: 85,
      memoryMaxPercent: 90,
      memoryMinFreeGiB: 2,
      gpuMaxPercent: null,
      diskBusyMaxPercent: null,
      diskMinFreeGiB: null,
      relocate: 'paired',
    })
    expect(constants).toMatchObject({
      RESOURCE_SAMPLE_MS: 5000,
      RESOURCE_TREE_SAMPLE_MS: 15_000,
      RESOURCE_CPU_WINDOW_MS: 30_000,
      RESOURCE_MEMORY_ENTER_SAMPLES: 2,
      RESOURCE_ESCALATE_MS: 60_000,
      RESOURCE_CRITICAL_CPU_PERCENT: 97,
      RESOURCE_CRITICAL_CPU_WINDOW_MS: 60_000,
      RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION: 0.5,
      RESOURCE_HYSTERESIS_POINTS: 10,
      RESOURCE_MEMORY_HYSTERESIS_GIB: 0.5,
      RESOURCE_EXIT_MS: 60_000,
      RESOURCE_MIN_DWELL_MS: 60_000,
      RESOURCE_FOREGROUND_WAIT_MS: 20_000,
      RESOURCE_OVERRIDE_MS: 900_000,
      RESOURCE_JOB_CPU_RATE_PERCENT: 50,
      RESOURCE_SAMPLER_MAX_CORE_PERCENT: 0.5,
      RESOURCE_HISTORY_MINUTE_MS: 60_000,
    })
  })
  it.each([
    ['cpuMaxPercent', 30, 100],
    ['memoryMaxPercent', 40, 98],
    ['memoryMinFreeGiB', 0.5, 64],
    ['gpuMaxPercent', 1, 100],
    ['diskBusyMaxPercent', 1, 100],
  ])('enforces both ends of %s and rejects nonfinite values', (key, min, max) => {
    expect(resourceSettingsSchema.safeParse({ [key]: min }).success).toBe(true)
    expect(resourceSettingsSchema.safeParse({ [key]: max }).success).toBe(true)
    for (const value of [min - 0.01, max + 0.01, NaN, Infinity, '85']) {
      expect(resourceSettingsSchema.safeParse({ [key]: value }).success).toBe(false)
    }
  })
  it('ignores workspace and folder overrides; preserves machine false and null', () => {
    expect(readResourceSettings(workspaceOnly)).toEqual(defaults)
    expect(
      readResourceSettings((key) =>
        key === 'resourceGovernor'
          ? { globalValue: false, defaultValue: true, workspaceValue: true }
          : undefined,
      ).enabled,
    ).toBe(false)
    expect(
      readResourceSettings((key) =>
        key === 'resourceGpuMaxPercent' ? { globalValue: null, defaultValue: 90 } : undefined,
      ).gpuMaxPercent,
    ).toBeNull()
    expect(() =>
      readResourceSettings((key) =>
        key === 'resourceCpuMaxPercent' ? { globalValue: 29, workspaceValue: 85 } : undefined,
      ),
    ).toThrow()
  })
  it('caps the floor at 15% of RAM, retaining the requested floor on large machines', () => {
    expect(resourceMemoryFloorBytes(defaults, 8 * constants.RESOURCE_GIB_BYTES)).toBeCloseTo(
      1.2 * constants.RESOURCE_GIB_BYTES,
    )
    expect(resourceMemoryFloorBytes(defaults, 32 * constants.RESOURCE_GIB_BYTES)).toBe(
      2 * constants.RESOURCE_GIB_BYTES,
    )
    for (const total of [0, -1, NaN, Infinity])
      expect(() => resourceMemoryFloorBytes(defaults, total)).toThrow()
  })
  it('preserves unknown readings separately from real zero and bounds memory', () => {
    expect(resourceSampleSchema.parse(sample)).toEqual(sample)
    expect(resourceSampleSchema.parse({ ...sample, cpuPercent: 0 }).cpuPercent).toBe(0)
    expect(
      resourceSampleSchema.safeParse({ ...sample, memoryAvailableBytes: 2, memoryTotalBytes: 1 })
        .success,
    ).toBe(false)
    expect(resourceSampleSchema.safeParse({ ...sample, cpuPercent: 101 }).success).toBe(false)
    expect(resourceSampleSchema.safeParse({ ...sample, cpuPercent: -1 }).success).toBe(false)
    expect(resourceSampleSchema.safeParse({ ...sample, atMs: -1 }).success).toBe(false)
    expect(resourceSampleSchema.safeParse({ ...sample, memoryTotalBytes: 0 }).success).toBe(false)
    expect(
      resourceSampleSchema.safeParse({
        ...sample,
        pressure: { cpuSomePercent: 0, memorySomePercent: null, memoryFullPercent: 100 },
      }).success,
    ).toBe(true)
  })
  it('requires real finite integer counters and bounded private identity', () => {
    for (const pid of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(resourceProcessIdentitySchema.safeParse({ pid, startTime: 'ticks' }).success).toBe(
        false,
      )
    for (const startTime of ['', 'x'.repeat(constants.RESOURCE_ID_MAX_LENGTH + 1)])
      expect(resourceProcessIdentitySchema.safeParse({ pid: 1, startTime }).success).toBe(false)
    expect(resourceTreeUsageSchema.safeParse({ cpuSeconds: -1, residentBytes: 0 }).success).toBe(
      false,
    )
    expect(resourceTreeUsageSchema.safeParse({ cpuSeconds: 0, residentBytes: -1 }).success).toBe(
      false,
    )
    expect(resourceTreeUsageSchema.safeParse({ cpuSeconds: 0.5, residentBytes: 0 }).success).toBe(
      true,
    )
  })
  it('defines all kinds, classes and levels without extra authority', () => {
    const kinds: readonly ResourceKind[] = resourceKindSchema.options
    const classes: readonly ResourceClass[] = resourceClassSchema.options
    const levels: readonly ResourceLevel[] = resourceLevelSchema.options
    expect(kinds).toEqual([
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
    expect(classes).toEqual(['foreground', 'background'])
    expect(levels).toEqual(['normal', 'throttle', 'relocate', 'pause'])
    expect(resourceKindSchema.safeParse('terminal').success).toBe(false)
    expect(
      resourceTicketSchema.safeParse({
        id: 'ticket',
        root: { pid: 1, startTime: 'ticks' },
        scope: { type: 'group', pgid: 1 },
        kind: 'check',
        class: 'foreground',
        sessionId: null,
      }).success,
    ).toBe(true)
  })
  it('keeps device headroom a strict bucket and only admits moveable kinds to events', () => {
    expect(deviceResourceSchema.parse({ level: 'normal', headroom: 'ample' })).toEqual({
      level: 'normal',
      headroom: 'ample',
    })
    for (const headroom of ['100%', 1, null])
      expect(deviceResourceSchema.safeParse({ level: 'normal', headroom }).success).toBe(false)
    expect(
      resourceEventSchema.safeParse({
        type: 'relocated',
        atMs: 0,
        kind: 'toolShell',
        level: 'relocate',
        reason: 'machineBusy',
      }).success,
    ).toBe(false)
    for (const extra of [
      { cpuPercent: 90 },
      { pid: 1 },
      { path: '/private' },
      { command: 'canary' },
      { environment: { CANARY: 'secret' } },
    ])
      expect(
        deviceResourceSchema.safeParse({ level: 'normal', headroom: 'some', ...extra }).success,
      ).toBe(false)
  })
  it('excludes process, command, path and environment canaries at every egress depth', () => {
    const status: ResourceStatus = {
      level: 'normal',
      sample,
      settings: defaults,
      queued: [],
      overrideUntilMs: null,
    }
    expect(resourceStatusSchema.safeParse(status).success).toBe(true)
    for (const extra of [
      { pid: 1 },
      { commandLine: 'CANARY' },
      { path: '/CANARY' },
      { processName: 'CANARY' },
      { environment: { CANARY: 'private' } },
    ]) {
      expect(resourceStatusSchema.safeParse({ ...status, ...extra }).success).toBe(false)
      expect(
        resourceStatusSchema.safeParse({ ...status, sample: { ...sample, ...extra } }).success,
      ).toBe(false)
      expect(resourceRecordSchema.safeParse({ ...record, ...extra }).success).toBe(false)
      expect(
        resourceRecordSchema.safeParse({ ...record, event: { ...event, ...extra } }).success,
      ).toBe(false)
      expect(
        resourceRecordSchema.safeParse({
          ...record,
          work: [{ kind: 'check', cpuSeconds: 1, peakMemoryBytes: 1, ...extra }],
        }).success,
      ).toBe(false)
    }
  })
  it('records a minute or an event, with no empty successful record', () => {
    const minute = {
      cpuPercent: 85,
      memoryUsedPercent: null,
      availableMemory: 'unknown',
      gpuPercent: null,
      diskBusyPercent: null,
      level: 'throttle',
      thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
    }
    expect(resourceRecordSchema.safeParse(record).success).toBe(true)
    expect(resourceRecordSchema.safeParse({ ...record, minute, event: null }).success).toBe(true)
    expect(resourceRecordSchema.safeParse({ ...record, event: null }).success).toBe(false)
    expect(resourceRecordSchema.safeParse({ ...record, minute }).success).toBe(false)
  })
  it('validates the versioned exec resource event, rejecting v1 and private fields', () => {
    const envelope: ResourceExecEvent = {
      v: 2,
      seq: 1,
      time: '2026-10-05T00:00:00Z',
      type: 'resource',
      event,
    }
    expect(resourceExecEventSchema.safeParse(envelope).success).toBe(true)
    for (const extra of [
      { v: 1 },
      { seq: 0 },
      { time: 'yesterday' },
      { pid: 1 },
      { event: { ...event, path: '/CANARY' } },
    ])
      expect(resourceExecEventSchema.safeParse({ ...envelope, ...extra }).success).toBe(false)
    expect(z.toJSONSchema(resourceExecEventSchema).properties).toMatchObject({
      v: { const: 2 },
      type: { const: 'resource' },
    })
  })
  it('freezes v1 and adds the strict resource variant to the complete v2 event schema', () => {
    const resourceJson = z.toJSONSchema(resourceExecEventSchema)
    delete resourceJson.$schema
    const expected = structuredClone(execV1)
    for (const variant of expected.anyOf) variant.properties.v.const = 2
    expect(execV2.anyOf.slice(0, -1)).toEqual(expected.anyOf)
    expect(execV2.anyOf.at(-1)).toEqual(resourceJson)
    expect(execV1.anyOf.every((variant) => variant.properties.v.const === 1)).toBe(true)
    expect(execV2.$defs).toEqual(execV1.$defs)
    const result = execV2.anyOf.find((variant) => variant.properties.type.const === 'result')
    expect(result?.properties).toMatchObject({ result: { properties: { v: { const: 1 } } } })
  })
})
