import * as z from 'zod/mini'

const counter = z.number().check(z.gte(0), z.int())
const percent = z.number().check(z.gte(0), z.lte(100))
const cpuTimes = z.strictObject({
  user: counter,
  nice: counter,
  sys: counter,
  idle: counter,
  irq: counter,
})
const cpuSnapshot = z.array(cpuTimes).check(z.minLength(1))
type CpuSnapshot = z.infer<typeof cpuSnapshot>

/** A failed read, reset or changed CPU set establishes a new baseline, never idle. */
export class CpuDelta {
  private previous: CpuSnapshot | undefined

  read(input: unknown): number | null {
    const parsed = cpuSnapshot.safeParse(input)
    const before = this.previous
    this.previous = parsed.success ? parsed.data : undefined
    if (!parsed.success || before?.length !== parsed.data.length) return null
    let total = 0
    let idle = 0
    for (const [index, current] of parsed.data.entries()) {
      const old = before[index]
      if (old === undefined) return null
      for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) {
        const delta = current[key] - old[key]
        if (delta < 0) return null
        total += delta
        if (key === 'idle') idle += delta
      }
    }
    return Number.isSafeInteger(total) && total > 0 ? ((total - idle) / total) * 100 : null
  }
}

export function counterReading(input: number | null): number | null {
  const parsed = counter.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function percentReading(input: unknown): number | null {
  const parsed = percent.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** PSI's avg10 is a percentage of stalled wall time, separate from CPU utilization. */
export function pressureReading(
  text: string | null | undefined,
  lane: 'some' | 'full',
): number | null {
  const row = text?.split('\n').find((line) => line.startsWith(`${lane} `))
  const fields = row?.trim().split(/\s+/)
  const averages = fields?.slice(1).map((field) => field.split('='))
  if (averages === undefined) return null
  const values = new Map(averages.map(([key, value]) => [key, value]))
  for (const key of ['avg10', 'avg60', 'avg300']) {
    const value = values.get(key)
    if (
      value === undefined ||
      !/^\d+(?:\.\d+)?$/.test(value) ||
      percentReading(Number(value)) === null
    )
      return null
  }
  const total = values.get('total')
  return total !== undefined && /^\d+$/.test(total) && counterReading(Number(total)) !== null
    ? Number(values.get('avg10'))
    : null
}
