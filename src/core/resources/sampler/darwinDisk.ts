import { RESOURCE_NS_PER_MS } from '../../../shared/constants'
import { counterReading } from './readings'

interface DiskSnapshot {
  atMs: number
  counters: Map<string, number>
}

/** Both totals present and in counter range, or missing data. */
function blockBusyNs(readNs: number | undefined, writeNs: number | undefined): number | null {
  return readNs === undefined || writeNs === undefined ? null : counterReading(readNs + writeNs)
}

/**
 * Busiest storage driver, not a sum of disks: IOKit reports each
 * IOBlockStorageDriver's cumulative busy time (`Total Time (Read)` plus
 * `Total Time (Write)`, nanoseconds), differenced over wall time like the
 * Linux whole-device delta. Only driver blocks count; anything else carrying
 * those keys is ignored, and a missing key fails closed.
 */
export class DarwinDiskDelta {
  private previous: DiskSnapshot | undefined

  reset(): void {
    this.previous = undefined
  }

  read(text: string | null | undefined, atMs: number): number | null {
    const before = this.previous
    this.previous = undefined
    if (text == null || !Number.isFinite(atMs) || atMs < 0) return null
    const counters = new Map<string, number>()
    let name: string | undefined
    let isDriver = false
    let readNs: number | undefined
    let writeNs: number | undefined
    for (const line of text.split('\n')) {
      const header = /^\s*(?:\|\s)*\+-o (\S+)\s+<class (\S+),/.exec(line)
      if (header === null) {
        // Both totals share the Statistics line: each match stands on its own.
        for (const match of line.matchAll(/"Total Time \((Read|Write)\)"=(\d+)/g)) {
          const lane = match[1]
          const raw = match[2]
          if (raw === undefined || (lane !== 'Read' && lane !== 'Write')) return null
          const value = counterReading(Number(raw))
          if (value === null) return null
          if (lane === 'Read') readNs = value
          else writeNs = value
        }
        continue
      }
      if (isDriver && name !== undefined) {
        const busy = blockBusyNs(readNs, writeNs)
        if (busy === null || counters.has(name)) return null
        counters.set(name, busy)
      }
      const next = header[1]
      const kind = header[2]
      if (next === undefined || kind === undefined) return null
      name = next
      isDriver = kind === 'IOBlockStorageDriver'
      readNs = undefined
      writeNs = undefined
    }
    if (isDriver && name !== undefined) {
      const busy = blockBusyNs(readNs, writeNs)
      if (busy === null || counters.has(name)) return null
      counters.set(name, busy)
    }
    if (counters.size === 0) return null
    this.previous = { atMs, counters }
    if (before === undefined || atMs <= before.atMs || before.counters.size !== counters.size)
      return null
    let busiest = 0
    for (const [identity, current] of counters) {
      const old = before.counters.get(identity)
      if (old === undefined || current < old) return null
      busiest = Math.max(
        busiest,
        ((current - old) / RESOURCE_NS_PER_MS / (atMs - before.atMs)) * 100,
      )
    }
    return Math.min(100, busiest)
  }
}
