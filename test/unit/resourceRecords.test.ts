import { describe, expect, it } from 'vitest'
import { aggregateResources } from '../../src/core/usage/aggregate'
import {
  RESOURCE_HISTORY_MAX_EVENTS,
  RESOURCE_HISTORY_MAX_MINUTES,
  RESOURCE_HISTORY_MINUTE_MS,
  RESOURCE_HISTORY_RETENTION_MS,
} from '../../src/shared/constants'
import { resourceRecordSchema, type ResourceRecord } from '../../src/shared/resources'
import {
  historyRecords,
  historyStatus,
  historyTree,
  recordHarness,
} from './helpers/resources/history'

describe('resource minute collection', () => {
  it('averages known readings, keeps the worst level/bucket and never fills a missing minute', async () => {
    const h = recordHarness()
    await h.writer.sample(historyStatus(0, { cpuPercent: 0 }))
    await h.writer.sample({
      ...historyStatus(5000, { cpuPercent: 100, memoryAvailableBytes: 0 }),
      level: 'pause',
    })
    await h.writer.sample(historyStatus(10_000, { cpuPercent: null, memoryUsedPercent: null }))
    expect(h.records).toEqual([])
    await h.writer.sample(historyStatus(180_000, { cpuPercent: null }))
    await h.writer.flush()
    expect(h.records.map((record) => record.atMs)).toEqual([0, 180_000])
    expect(h.records[0]?.minute).toMatchObject({
      cpuPercent: 50,
      memoryUsedPercent: 30,
      level: 'pause',
      availableMemory: 'belowFloor',
    })
    expect(h.records[1]?.minute?.cpuPercent).toBeNull()
    await h.writer.flush()
    expect(h.records).toHaveLength(2)
  })

  it('keeps genuine zero separate from unknown and suppresses optional readings while unset', async () => {
    const h = recordHarness()
    await h.writer.sample(
      historyStatus(0, {
        cpuPercent: null,
        memoryUsedPercent: null,
        memoryAvailableBytes: null,
        gpuPercent: 100,
        diskBusyPercent: 100,
      }),
    )
    await h.writer.flush()
    expect(h.records[0]?.minute).toMatchObject({
      cpuPercent: null,
      memoryUsedPercent: null,
      availableMemory: 'unknown',
      gpuPercent: null,
      diskBusyPercent: null,
    })
    const status = historyStatus(5000, {
      cpuPercent: 0,
      memoryUsedPercent: 0,
      gpuPercent: 0,
      diskBusyPercent: 0,
    })
    status.settings.gpuMaxPercent = 90
    status.settings.diskBusyMaxPercent = 80
    await h.writer.sample(status)
    await h.writer.flush()
    expect(h.records[1]?.minute).toMatchObject({
      cpuPercent: 0,
      memoryUsedPercent: 0,
      gpuPercent: 0,
      diskBusyPercent: 0,
    })
  })

  it('uses the capped memory floor and the reachable recovery margin', async () => {
    const h = recordHarness()
    for (const [index, available, expected] of [
      [0, 99, 'belowFloor'],
      [1, 250, 'low'],
      [2, 251, 'ample'],
    ] as const) {
      const status = historyStatus(index * 60_000, {
        memoryTotalBytes: 1000,
        memoryAvailableBytes: available,
      })
      await h.writer.sample(status)
      await h.writer.flush()
      expect(h.records[index]?.minute?.availableMemory).toBe(expected)
    }
  })

  it('splits threshold changes within a minute without relabelling earlier samples', async () => {
    const h = recordHarness()
    await h.writer.sample(historyStatus())
    const next = historyStatus(5000, { cpuPercent: 40 })
    next.settings.cpuMaxPercent = 50
    await h.writer.sample(next)
    await h.writer.flush()
    expect(
      h.records.map((record) => [
        record.atMs,
        record.minute?.cpuPercent,
        record.minute?.thresholds.cpuMaxPercent,
      ]),
    ).toEqual([
      [0, 20, 85],
      [5000, 40, 50],
    ])
  })

  it('uses CPU deltas, survives unknown/decreasing counters and peaks simultaneous memory by kind', async () => {
    const h = recordHarness()
    const one = historyTree()
    const two = historyTree(5678, { scope: { type: 'group', pgid: 5678 } })
    h.trees([
      { ticket: one, usage: { cpuSeconds: 10, residentBytes: 100 } },
      { ticket: two, usage: { cpuSeconds: 4, residentBytes: 200 } },
    ])
    await h.writer.sample(historyStatus())
    h.trees([
      { ticket: one, usage: null },
      { ticket: two, usage: { cpuSeconds: 3, residentBytes: 250 } },
    ])
    await h.writer.sample(historyStatus(5000))
    h.trees([
      { ticket: one, usage: { cpuSeconds: 12, residentBytes: 50 } },
      { ticket: two, usage: { cpuSeconds: 5, residentBytes: 25 } },
    ])
    await h.writer.sample(historyStatus(60_000))
    await h.writer.flush()
    expect(h.records[0]?.work).toEqual([{ kind: 'check', cpuSeconds: 14, peakMemoryBytes: 300 }])
    expect(h.records[1]?.work).toEqual([{ kind: 'check', cpuSeconds: 3, peakMemoryBytes: 75 }])
    expect(aggregateResources(h.records).work).toEqual([
      { kind: 'check', cpuSeconds: 17, peakMemoryBytes: 300 },
    ])
  })

  it('preserves the baseline on reclassification and starts fresh for a reused PID', async () => {
    const h = recordHarness()
    const ticket = historyTree()
    h.trees([{ ticket, usage: { cpuSeconds: 10, residentBytes: 100 } }])
    await h.writer.sample(historyStatus())
    h.trees([
      {
        ticket: { ...ticket, id: 'another-private-ticket', kind: 'backgroundTask' },
        usage: { cpuSeconds: 12, residentBytes: 50 },
      },
    ])
    await h.writer.sample(historyStatus(5000))
    h.trees([
      {
        ticket: { ...ticket, root: { ...ticket.root, startTime: 'new-private-birth' } },
        usage: { cpuSeconds: 3, residentBytes: 20 },
      },
    ])
    await h.writer.sample(historyStatus(10_000))
    await h.writer.flush()
    expect(h.records[0]?.work).toEqual([
      { kind: 'check', cpuSeconds: 13, peakMemoryBytes: 100 },
      { kind: 'backgroundTask', cpuSeconds: 2, peakMemoryBytes: 50 },
    ])
  })

  it('captures final work at the same machine timestamp without averaging the reading twice', async () => {
    const h = recordHarness()
    const ticket = historyTree()
    h.trees([{ ticket, usage: { cpuSeconds: 1, residentBytes: 10 } }])
    await h.writer.sample(historyStatus())
    h.trees([{ ticket, usage: { cpuSeconds: 2, residentBytes: 10 } }])
    await h.writer.sample(historyStatus(5000, { cpuPercent: 40 }))
    h.trees([{ ticket, usage: { cpuSeconds: 3, residentBytes: 10 } }])
    await h.writer.sample(historyStatus(5000, { cpuPercent: 40 }))
    await h.writer.flush()
    expect(h.records[0]?.work[0]?.cpuSeconds).toBe(3)
    expect(h.records[0]?.minute?.cpuPercent).toBe(30)
  })

  it('merges a read-time flush and same-timestamp final tree accounting into one known minute', async () => {
    const h = recordHarness()
    const ticket = historyTree()
    const status = historyStatus(5000, { cpuPercent: 80 })
    h.trees([{ ticket, usage: { cpuSeconds: 1, residentBytes: 10 } }])
    await h.writer.sample(status)
    await h.writer.flush()
    expect(aggregateResources(h.records).minutes).toHaveLength(1)
    h.trees([{ ticket, usage: { cpuSeconds: 2, residentBytes: 20 } }])
    await h.writer.sample(status)
    await h.writer.flush()
    const history = aggregateResources(h.records)
    expect(h.records[0]?.work[0]?.cpuSeconds).toBe(1)
    expect(history.minutes).toHaveLength(1)
    expect(history.minutes[0]).toMatchObject({
      atMs: 5000,
      minute: { cpuPercent: 80, memoryUsedPercent: 30 },
      work: [{ kind: 'check', cpuSeconds: 2, peakMemoryBytes: 20 }],
    })
    expect(history.work).toEqual([{ kind: 'check', cpuSeconds: 2, peakMemoryBytes: 20 }])
    expect(aggregateResources([...h.records, ...h.records])).toEqual(history)
    const appends = h.append.mock.calls.length
    await h.writer.flush()
    expect(h.append).toHaveBeenCalledTimes(appends)
    await h.writer.sample(historyStatus(10_000, { cpuPercent: 40 }))
    await h.writer.flush()
    expect(aggregateResources(h.records).minutes[0]?.minute?.cpuPercent).toBe(60)
    await h.writer.sample(historyStatus(60_000, { cpuPercent: 20 }))
    await h.writer.flush()
    expect(aggregateResources(h.records).minutes.map((row) => row.atMs)).toEqual([5000, 60_000])
  })

  it('rejects stale samples, invalid batches and duplicate trees without advancing accounting', async () => {
    const h = recordHarness()
    const ticket = historyTree()
    await h.writer.sample(historyStatus(5000))
    await expect(h.writer.sample(historyStatus(0))).rejects.toThrow('out of order')
    h.trees([
      { ticket, usage: { cpuSeconds: 3, residentBytes: 1 } },
      { ticket, usage: { cpuSeconds: 4, residentBytes: 1 } },
    ])
    await expect(h.writer.sample(historyStatus(10_000))).rejects.toThrow('duplicate tree')
    h.trees([{ ticket, usage: { cpuSeconds: 3, residentBytes: -1 } }])
    await expect(h.writer.sample(historyStatus(10_000))).rejects.toThrow()
    h.trees([{ ticket, usage: { cpuSeconds: 3, residentBytes: 1 } }])
    await h.writer.sample(historyStatus(10_000))
    await h.writer.flush()
    expect(h.records[0]?.work[0]?.cpuSeconds).toBe(3)
  })

  it('never journals process identity, commands, paths, names or environments at any depth', async () => {
    const h = recordHarness()
    const snapshot = {
      ticket: historyTree(),
      usage: { cpuSeconds: 1, residentBytes: 100 },
      commandLine: 'private-command-canary',
      processName: 'private-name-canary',
      environment: { SAMPLE: 'private-env-canary' },
    }
    h.trees([snapshot])
    await h.writer.sample(historyStatus())
    await h.writer.event({ type: 'paused', atMs: 5000, kind: 'check' })
    await h.writer.flush()
    const serialized = JSON.stringify(h.records)
    expect(serialized).not.toMatch(
      /private-|1234|pid|command|path|processName|environment|sessionId|ticket|startTime|scope/,
    )
    for (const record of h.records)
      expect(resourceRecordSchema.safeParse(record).success).toBe(true)
    const privateFields = { pid: 1234 }
    expect(() =>
      h.writer.event({ type: 'paused', atMs: 0, kind: 'check', ...privateFields }),
    ).toThrow()
  })

  it('retains a failed minute append and a failed event append for ordered retry', async () => {
    const h = recordHarness()
    await h.writer.sample(historyStatus())
    h.append.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(h.writer.flush()).rejects.toThrow('disk unavailable')
    expect(h.records).toHaveLength(0)
    await h.writer.event({ type: 'override', atMs: 5000, untilMs: 900_000 })
    expect(h.records.map((record) => record.event?.type ?? 'minute')).toEqual([
      'minute',
      'override',
    ])
    h.append.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(h.writer.event({ type: 'paused', atMs: 10_000, kind: 'check' })).rejects.toThrow()
    await h.writer.flush()
    expect(h.records.map((record) => record.event?.type ?? 'minute')).toEqual([
      'minute',
      'override',
      'paused',
    ])
  })

  it('serializes concurrent reads, snapshots caller status and reports a failed work source', async () => {
    const h = recordHarness()
    const first = historyStatus()
    const operation = h.writer.sample(first)
    if (first.sample !== null) first.sample.cpuPercent = 99
    await Promise.all([
      operation,
      h.writer.sample(historyStatus(5000, { cpuPercent: 40 })),
      h.writer.flush(),
    ])
    expect(h.records[0]?.minute?.cpuPercent).toBe(30)
    h.read.mockRejectedValueOnce(new Error('work unknown'))
    await expect(h.writer.sample(historyStatus(60_000))).rejects.toThrow('work unknown')
    await h.writer.flush()
    expect(h.records).toHaveLength(1)
  })

  it('flushes when disabled or no sample exists and does not read any work', async () => {
    const h = recordHarness()
    await h.writer.sample(historyStatus())
    await h.writer.sample({ ...historyStatus(5000), sample: null })
    await h.writer.sample({
      ...historyStatus(10_000),
      settings: { ...historyStatus().settings, enabled: false },
    })
    await h.writer.flush()
    expect(h.records).toHaveLength(1)
    expect(h.read).toHaveBeenCalledOnce()
    const privateFields = { path: 'private' }
    expect(() => h.writer.sample({ ...historyStatus(), ...privateFields })).toThrow()
  })
})

describe('resource aggregation', () => {
  it('evicts minute detail older than seven recorded days without losing exact work totals', () => {
    const record = historyRecords().find((row) => row.minute !== null)
    if (record === undefined) throw new Error('fixture missing')
    const latest = RESOURCE_HISTORY_RETENTION_MS + RESOURCE_HISTORY_MINUTE_MS
    const records = [latest, 0, RESOURCE_HISTORY_MINUTE_MS, RESOURCE_HISTORY_MINUTE_MS + 1].map(
      (atMs): ResourceRecord => ({
        ...record,
        atMs,
        work: [{ kind: 'check', cpuSeconds: 1, peakMemoryBytes: 10 }],
      }),
    )
    const history = aggregateResources(records)
    expect(history.minutes.map((row) => row.atMs)).toEqual([RESOURCE_HISTORY_MINUTE_MS + 1, latest])
    expect(history.work).toEqual([{ kind: 'check', cpuSeconds: 4, peakMemoryBytes: 10 }])
  })

  it('evicts oldest minute segments and events at their caps while retaining exact totals', () => {
    const minute = historyRecords().find((row) => row.minute !== null)
    if (minute === undefined) throw new Error('fixture missing')
    const minutes = Array.from(
      { length: RESOURCE_HISTORY_MAX_MINUTES + 2 },
      (_, atMs): ResourceRecord => ({
        ...minute,
        atMs,
        work: [{ kind: 'check', cpuSeconds: 1, peakMemoryBytes: atMs }],
      }),
    )
    const events: ResourceRecord[] = Array.from(
      { length: RESOURCE_HISTORY_MAX_EVENTS + 2 },
      (_, atMs) => ({
        type: 'resource',
        atMs,
        minute: null,
        work: [],
        event: { type: 'paused', atMs, kind: 'check' },
      }),
    )
    const history = aggregateResources([...events.toReversed(), ...minutes.toReversed()])
    expect(history.minutes).toHaveLength(RESOURCE_HISTORY_MAX_MINUTES)
    expect(history.events).toHaveLength(RESOURCE_HISTORY_MAX_EVENTS)
    expect(history.minutes[0]?.atMs).toBe(2)
    expect(history.minutes.at(-1)?.atMs).toBe(RESOURCE_HISTORY_MAX_MINUTES + 1)
    expect(history.events[0]?.atMs).toBe(2)
    expect(history.events.at(-1)?.atMs).toBe(RESOURCE_HISTORY_MAX_EVENTS + 1)
    expect(history.counts).toEqual([
      { type: 'paused', kind: 'check', count: RESOURCE_HISTORY_MAX_EVENTS + 2 },
    ])
    expect(history.work).toEqual([
      {
        kind: 'check',
        cpuSeconds: RESOURCE_HISTORY_MAX_MINUTES + 2,
        peakMemoryBytes: RESOURCE_HISTORY_MAX_MINUTES + 1,
      },
    ])
  })

  it('sorts records and sums deltas/events by kind, keeping peak rather than summing memory', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const records = historyRecords(seed)
      const before = JSON.stringify(records)
      const history = aggregateResources(records)
      const minutes = records
        .filter((record) => record.minute !== null)
        .toSorted((a, b) => a.atMs - b.atMs)
      expect(history.minutes).toEqual(minutes)
      expect(history.events).toHaveLength(4)
      expect(history.counts).toEqual([
        { type: 'deferred', kind: seed % 2 === 0 ? 'check' : 'worker', count: 4 },
      ])
      expect(history.work).toEqual([
        {
          kind: 'check',
          cpuSeconds: minutes.reduce((sum, record) => sum + (record.work[0]?.cpuSeconds ?? 0), 0),
          peakMemoryBytes: Math.max(
            ...minutes.map((record) => record.work[0]?.peakMemoryBytes ?? 0),
          ),
        },
      ])
      expect(JSON.stringify(records)).toBe(before)
    }
  })

  it('preserves every event variant and distinguishes kind-specific totals', () => {
    const h = aggregateResources([
      {
        type: 'resource',
        atMs: 0,
        minute: null,
        event: { type: 'levelChanged', atMs: 0, from: 'normal', to: 'throttle', reason: 'cpu' },
        work: [],
      },
      {
        type: 'resource',
        atMs: 1,
        minute: null,
        event: {
          type: 'relocated',
          atMs: 1,
          kind: 'worker',
          level: 'relocate',
          reason: 'machineBusy',
        },
        work: [],
      },
      {
        type: 'resource',
        atMs: 2,
        minute: null,
        event: { type: 'paused', atMs: 2, kind: 'worker' },
        work: [],
      },
      {
        type: 'resource',
        atMs: 3,
        minute: null,
        event: { type: 'override', atMs: 3, untilMs: 900_000 },
        work: [],
      },
    ])
    expect(h.events.map((event) => event.type)).toEqual([
      'levelChanged',
      'relocated',
      'paused',
      'override',
    ])
    expect(h.counts.map((row) => row.kind)).toEqual([null, 'worker', 'worker', null])
  })

  it('refuses private/invalid retained input instead of silently dropping it', () => {
    const records = historyRecords()
    const record = records[0]
    expect(record).toBeDefined()
    if (record === undefined) throw new Error('fixture missing')
    const privateFields = { pid: 1234 }
    expect(() => aggregateResources([{ ...record, ...privateFields }])).toThrow()
    expect(() =>
      aggregateResources([
        { ...record, work: [{ kind: 'check', cpuSeconds: Infinity, peakMemoryBytes: 0 }] },
      ]),
    ).toThrow()
    expect(aggregateResources([])).toEqual({ minutes: [], events: [], counts: [], work: [] })
  })
})
