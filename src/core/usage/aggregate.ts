import type { ResourceKind, ResourceRecord } from '../../shared/resources'
import {
  RESOURCE_HISTORY_MAX_EVENTS,
  RESOURCE_HISTORY_MAX_MINUTES,
  RESOURCE_HISTORY_RETENTION_MS,
} from '../../shared/constants'
import {
  resourceHistoryRecordSchema,
  resourceHistorySchema,
  type ResourceHistory,
} from '../../shared/resourceHistory'

/** Resource region for M102's aggregate: validate retained input before any projection. */
export function aggregateResources(records: readonly ResourceRecord[]): ResourceHistory {
  const minutes: ResourceRecord[] = []
  const events: ResourceHistory['events'] = []
  const counts = new Map<string, ResourceHistory['counts'][number]>()
  const work = new Map<ResourceKind, ResourceHistory['work'][number]>()
  const snapshots = new Map<number, ResourceRecord>()
  const parsed: ResourceRecord[] = []
  for (const input of records) {
    const record = resourceHistoryRecordSchema.parse(input)
    // A read-time flush and final accounting replace one cumulative minute segment.
    if (record.minute === null) parsed.push(record)
    else snapshots.set(record.atMs, record)
  }
  parsed.push(...snapshots.values())
  const ordered = parsed.toSorted((a, b) => a.atMs - b.atMs)
  for (const record of ordered) {
    if (record.minute !== null) minutes.push(record)
    if (record.event !== null) {
      const event = record.event
      events.push(event)
      const kind = 'kind' in event ? event.kind : null
      const key = `${event.type}:${kind ?? ''}`
      const row = counts.get(key) ?? { type: event.type, kind, count: 0 }
      row.count += 1
      counts.set(key, row)
    }
    for (const row of record.work) {
      const total = work.get(row.kind) ?? { kind: row.kind, cpuSeconds: 0, peakMemoryBytes: 0 }
      total.cpuSeconds += row.cpuSeconds
      total.peakMemoryBytes = Math.max(total.peakMemoryBytes, row.peakMemoryBytes)
      work.set(row.kind, total)
    }
  }
  const newestMinute = minutes.at(-1)?.atMs ?? 0
  return resourceHistorySchema.parse({
    minutes: minutes
      .filter((record) => record.atMs > newestMinute - RESOURCE_HISTORY_RETENTION_MS)
      .slice(-RESOURCE_HISTORY_MAX_MINUTES),
    events: events.toSorted((a, b) => a.atMs - b.atMs).slice(-RESOURCE_HISTORY_MAX_EVENTS),
    counts: Array.from(counts, ([, row]) => row),
    work: Array.from(work, ([, row]) => row),
  })
}
