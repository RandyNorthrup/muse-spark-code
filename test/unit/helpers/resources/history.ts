import { vi } from 'vitest'
import { ResourceRecords } from '../../../../src/core/usage/resourceRecords'
import {
  resourceSettingsSchema,
  type ResourceRecord,
  type ResourceStatus,
  type ResourceTicket,
  type ResourceTreeUsage,
} from '../../../../src/shared/resources'

export function historyStatus(
  atMs = 0,
  values: Partial<NonNullable<ResourceStatus['sample']>> = {},
): ResourceStatus {
  return {
    level: 'normal',
    settings: resourceSettingsSchema.parse({}),
    sample: {
      atMs,
      cpuPercent: 20,
      memoryUsedPercent: 30,
      memoryAvailableBytes: 4 * 1_073_741_824,
      memoryTotalBytes: 16 * 1_073_741_824,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
      ...values,
    },
    queued: [],
    overrideUntilMs: null,
  }
}

export function historyTree(pid = 1234, values: Partial<ResourceTicket> = {}): ResourceTicket {
  return {
    id: 'private-ticket-canary',
    root: { pid, startTime: 'private-start-canary' },
    scope: { type: 'cgroup', path: '/private/path-canary' },
    sessionId: 'private-session-canary',
    kind: 'check',
    class: 'background',
    ...values,
  }
}

export function recordHarness() {
  const records: ResourceRecord[] = []
  let rows: readonly { ticket: ResourceTicket; usage: ResourceTreeUsage | null }[] = []
  const append = vi.fn((record: ResourceRecord) => {
    records.push(structuredClone(record))
    return Promise.resolve()
  })
  const read = vi.fn(() => Promise.resolve(rows))
  const writer = new ResourceRecords({ append }, { read })
  return {
    records,
    writer,
    append,
    read,
    trees: (next: typeof rows) => {
      rows = next
    },
  }
}

export function historyRecords(seed = 1): ResourceRecord[] {
  return Array.from({ length: 8 }, (_, index): ResourceRecord => {
    const atMs = index * 60_000
    if (index % 2 === 1)
      return {
        type: 'resource',
        atMs,
        minute: null,
        event: {
          type: 'deferred',
          atMs,
          kind: seed % 2 === 0 ? 'check' : 'worker',
          class: 'background',
        },
        work: [],
      }
    return {
      type: 'resource',
      atMs,
      event: null,
      minute: {
        cpuPercent: index === 2 ? null : (seed * 13 + index) % 101,
        memoryUsedPercent: (seed * 17 + index) % 101,
        gpuPercent: null,
        diskBusyPercent: index === 4 ? 0 : null,
        availableMemory: index === 0 ? 'unknown' : 'low',
        level: index === 0 ? 'normal' : 'pause',
        thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
      },
      work: [{ kind: 'check', cpuSeconds: seed + index, peakMemoryBytes: (index + 1) * 1000 }],
    }
  }).toReversed()
}
