import * as z from 'zod/mini'
import { resourceProcessIdentitySchema, resourceTreeUsageSchema } from '../../../shared/resources'

const DECIMAL = /^\d+$/

export const processSampleSchema = z.extend(resourceProcessIdentitySchema, {
  // Kernel/system processes may have pgid 0; a governed ticket always has pgid > 0.
  pgid: z.number().check(z.int(), z.gte(0)),
  cpuSeconds: resourceTreeUsageSchema.shape.cpuSeconds,
  residentBytes: resourceTreeUsageSchema.shape.residentBytes,
})
export type ProcessSample = z.infer<typeof processSampleSchema>

/** /proc stat's comm can contain spaces, newlines and closing parentheses. */
export function parseLinuxStat(
  text: string,
  ticksPerSecond: number,
  pageBytes: number,
): ProcessSample | null {
  if ([ticksPerSecond, pageBytes].some((value) => !(Number.isSafeInteger(value) && value > 0)))
    return null
  const pid = /^(\d+) \(/.exec(text)?.[1]
  const fields = text
    .slice(text.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)
  const pgid = fields[2]
  const user = fields[11]
  const system = fields[12]
  const startTime = fields[19]
  const rss = fields[21]
  if (
    [pid, pgid, user, system, startTime, rss].some(
      (field) => field === undefined || !DECIMAL.test(field),
    )
  )
    return null
  const parsed = processSampleSchema.safeParse({
    pid: Number(pid),
    pgid: Number(pgid),
    startTime,
    cpuSeconds: (Number(user) + Number(system)) / ticksPerSecond,
    residentBytes: Number(rss) * pageBytes,
  })
  return parsed.success ? parsed.data : null
}

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const BYTES_PER_KIB = 1024

/** Darwin ps time: [days-][hours:]minutes:seconds[.fraction]. */
export function parseCpuTime(text: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text)
  if (match === null) return null
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match
  const value =
    ((Number(days) * HOURS_PER_DAY + Number(hours)) * MINUTES_PER_HOUR + Number(minutes)) *
      SECONDS_PER_MINUTE +
    Number(seconds)
  return Number.isFinite(value) && Number(seconds) < SECONDS_PER_MINUTE ? value : null
}

/** Only numerical columns: no command, name, arguments, paths or environment. */
export function parseMacProcessTable(
  text: string,
): readonly Omit<ProcessSample, 'startTime'>[] | null {
  const rows: Omit<ProcessSample, 'startTime'>[] = []
  for (const line of text.trim().split(/\r?\n/)) {
    if (line === '') continue
    const match = /^\s*(\d+)\s+(\d+)\s+([\d:.-]+)\s+(\d+)\s*$/.exec(line)
    if (match === null) return null
    const [, pid, pgid, time = '', rss] = match
    const cpuSeconds = parseCpuTime(time)
    if (cpuSeconds === null) return null
    const parsed = processSampleSchema.safeParse({
      pid: Number(pid),
      pgid: Number(pgid),
      startTime: '0',
      cpuSeconds,
      residentBytes: Number(rss) * BYTES_PER_KIB,
    })
    if (!parsed.success) return null
    const { startTime: _startTime, ...row } = parsed.data
    rows.push(row)
  }
  return rows
}
