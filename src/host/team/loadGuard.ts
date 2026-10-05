import { cpus, freemem } from 'node:os'

interface CpuTimes {
  readonly user: number
  readonly nice: number
  readonly sys: number
  readonly idle: number
  readonly irq: number
}

export interface TeamLoadSample {
  readonly at: number
  readonly cpuUsage: number | undefined
  readonly freeMemory: number
  readonly isHostBusy: boolean
}

/** The lazy team host owns this sampler. It never stops running work. */
export function createLoadGuard(options: {
  readonly sampleMs: number
  readonly cpuHigh: number
  readonly windowMs: number
  readonly freeMemoryMin: number
  readonly now: () => number
  readonly readCpuTimes?: () => readonly CpuTimes[]
  readonly readFreeMemory?: () => number
  readonly changed: (sample: TeamLoadSample) => void
}) {
  const cpuTimes = options.readCpuTimes ?? (() => cpus().map((cpu) => cpu.times))
  const freeMemory = options.readFreeMemory ?? freemem
  let previous: readonly CpuTimes[] | undefined
  let previousAt: number | undefined
  let highSince: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let latest: TeamLoadSample | undefined
  const total = (cpu: CpuTimes) => cpu.user + cpu.nice + cpu.sys + cpu.idle + cpu.irq
  const sample = (): TeamLoadSample => {
    const at = options.now()
    const current = cpuTimes()
    let cpuUsage: number | undefined
    if (previous?.length === current.length && current.length > 0) {
      let elapsed = 0
      let idle = 0
      let isValid = true
      for (const [index, cpu] of current.entries()) {
        const earlier = previous[index]
        if (earlier === undefined || total(cpu) < total(earlier) || cpu.idle < earlier.idle) {
          isValid = false
          break
        }
        elapsed += total(cpu) - total(earlier)
        idle += cpu.idle - earlier.idle
      }
      if (isValid && elapsed > 0) cpuUsage = Math.max(0, Math.min(1, 1 - idle / elapsed))
    }
    if (previousAt !== undefined && at < previousAt) highSince = undefined
    if (cpuUsage !== undefined && cpuUsage > options.cpuHigh) {
      highSince ??= previousAt ?? at
    } else {
      highSince = undefined
    }
    const available = freeMemory()
    latest = {
      at,
      cpuUsage,
      freeMemory: available,
      isHostBusy:
        available < options.freeMemoryMin ||
        (highSince !== undefined && at - highSince >= options.windowMs),
    }
    previous = current
    previousAt = at
    options.changed(latest)
    return latest
  }
  return {
    sample,
    isHostBusy: () => latest?.isHostBusy === true,
    start() {
      if (timer !== undefined) return
      sample()
      timer = setInterval(sample, options.sampleMs)
      timer.unref()
    },
    dispose() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
  }
}
