import type { ResourceRecord } from '../../../../src/shared/resources'

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
