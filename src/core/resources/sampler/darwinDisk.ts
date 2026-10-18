import { RESOURCE_NS_PER_MS } from '../../../shared/constants'
import { finishDiskDelta, type DiskDeltaBaseline } from './diskDelta'
import { counterReading } from './readings'

/** Both totals present and in counter range, as milliseconds of busy time. */
function blockBusyMs(readNs: number | undefined, writeNs: number | undefined): number | null {
  if (readNs === undefined || writeNs === undefined) return null
  const busyNs = counterReading(readNs + writeNs)
  return busyNs === null ? null : busyNs / RESOURCE_NS_PER_MS
}

/**
 * Busiest storage driver, not a sum of disks: IOKit reports each
 * IOBlockStorageDriver's cumulative busy time (`Total Time (Read)` plus
 * `Total Time (Write)`, nanoseconds), differenced over wall time like the
 * Linux whole-device delta. Only driver blocks count; anything else carrying
 * those keys is ignored, and a missing key fails closed.
 */
export class DarwinDiskDelta {
  private previous: DiskDeltaBaseline | undefined

  reset(): void {
    this.previous = undefined
  }

  read(text: string | null | undefined, atMs: number): number | null {
    const before = this.previous
    this.previous = undefined
    if (text == null || !Number.isFinite(atMs) || atMs < 0) return null
    const blocks: { name: string; busyMs: number }[] = []
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
        const busyMs = blockBusyMs(readNs, writeNs)
        if (busyMs === null) return null
        blocks.push({ name, busyMs })
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
      const busyMs = blockBusyMs(readNs, writeNs)
      if (busyMs === null) return null
      blocks.push({ name, busyMs })
    }
    const counters = new Map<string, number>()
    for (const block of blocks) {
      if (counters.has(block.name)) return null
      counters.set(block.name, block.busyMs)
    }
    const finished = finishDiskDelta(before, atMs, counters)
    this.previous = finished.store
    return finished.busy
  }
}
