import { counterReading } from './readings'

interface DiskSnapshot {
  atMs: number
  counters: Map<string, number>
}

/** Busiest whole device, not a sum of disks and their partitions. */
export class LinuxDiskDelta {
  private previous: DiskSnapshot | undefined

  reset(): void {
    this.previous = undefined
  }

  read(
    text: string | null | undefined,
    devices: readonly string[] | null,
    atMs: number,
  ): number | null {
    const before = this.previous
    this.previous = undefined
    if (text == null || devices === null || !Number.isFinite(atMs) || atMs < 0) return null
    const selected = new Set(devices.filter((name) => !/^(?:loop|ram|zram)\d+$/.test(name)))
    const counters = new Map<string, number>()
    for (const row of text.trim().split('\n')) {
      const fields = row.trim().split(/\s+/)
      const name = fields[2]
      if (name === undefined || !selected.has(name)) continue
      const major = fields[0]
      const minor = fields[1]
      const ioMs = fields[12]
      if (
        major === undefined ||
        minor === undefined ||
        ioMs === undefined ||
        !/^\d+$/.test(major) ||
        !/^\d+$/.test(minor) ||
        !/^\d+$/.test(ioMs)
      )
        return null
      const value = counterReading(Number(ioMs))
      if (value === null) return null
      const identity = `${major}:${minor}:${name}`
      if (counters.has(identity)) return null
      counters.set(identity, value)
    }
    if (counters.size === 0) return null
    this.previous = { atMs, counters }
    if (before === undefined || atMs <= before.atMs || before.counters.size !== counters.size)
      return null
    let busiest = 0
    for (const [identity, current] of counters) {
      const old = before.counters.get(identity)
      if (old === undefined || current < old) return null
      busiest = Math.max(busiest, ((current - old) / (atMs - before.atMs)) * 100)
    }
    return Math.min(100, busiest)
  }
}
