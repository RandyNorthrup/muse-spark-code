import * as z from 'zod/mini'
import { resourceProcessIdentitySchema, resourceTreeUsageSchema } from '../../../shared/resources'
import { probeChildEnvironment, type ResourceTreeRun } from './run'

const DECIMAL = /^\d+$/

export const processSampleSchema = z.extend(resourceProcessIdentitySchema, {
  // Kernel/system processes may have pgid 0; a governed ticket always has pgid > 0.
  pgid: z.number().check(z.int(), z.gte(0)),
  parent: z.number().check(z.int(), z.gte(0)),
  exited: z.boolean(),
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
  const parent = fields[1]
  const state = fields[0]
  const user = fields[11]
  const system = fields[12]
  const startTime = fields[19]
  const rss = fields[21]
  if (
    state === undefined ||
    !/^[RSDZTtXxIKWP]$/.test(state) ||
    [pid, parent, pgid, user, system, startTime, rss].some(
      (field) => field === undefined || !DECIMAL.test(field),
    )
  )
    return null
  const parsed = processSampleSchema.safeParse({
    pid: Number(pid),
    pgid: Number(pgid),
    parent: Number(parent),
    exited: ['Z', 'X', 'x'].includes(state),
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

// The absolute system ps and its numeric columns (`trees/mac.ts`), for the
// whole table and for one process alike.
export const MAC_PS = '/bin/ps'
export const MAC_PROCESS_COLUMNS = 'pid=,ppid=,pgid=,state=,time=,rss='

/** `ps -o lstart=` in the C locale, as macOS and procps print it: `Thu Oct  8 21:01:05 2026`. */
const MAC_START_TIME = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/
/** The table's numeric columns, then the start time (which has spaces of its own). */
const MAC_PROCESS_WITH_START = /^(\s*\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\d+)\s+(\S.*\S)\s*$/

/**
 * One process's row and start time: the table's ps columns and parser, for
 * one PID, plus `lstart` so a reused PID is told apart (M105 RSS). Null for
 * anything but exactly one well-formed row.
 */
export async function readMacProcess(
  pid: number,
  run: ResourceTreeRun,
): Promise<{ readonly row: Omit<ProcessSample, 'startTime'>; readonly started: string } | null> {
  const text = await run(
    MAC_PS,
    ['-o', `${MAC_PROCESS_COLUMNS},lstart=`, '-p', String(pid)],
    probeChildEnvironment({ LC_ALL: 'C' }),
  )
  const lines = text.trim().split(/\r?\n/)
  const match = lines.length === 1 ? MAC_PROCESS_WITH_START.exec(lines[0] ?? '') : null
  const [, columns = '', started = ''] = match ?? []
  const rows = match === null ? null : parseMacProcessTable(columns)
  const row = rows?.length === 1 ? rows[0] : undefined
  return row === undefined || !MAC_START_TIME.test(started) ? null : { row, started }
}

/** Only numerical columns: no command, name, arguments, paths or environment. */
export function parseMacProcessTable(
  text: string,
): readonly Omit<ProcessSample, 'startTime'>[] | null {
  const rows: Omit<ProcessSample, 'startTime'>[] = []
  for (const line of text.trim().split(/\r?\n/)) {
    if (line === '') continue
    // macOS 26 prints `?` for a process whose state it cannot read mid-transition
    // (`?<`); that row is still a process, and helper identity proves membership.
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z?][A-Za-z?+<>-]*)\s+([\d:.-]+)\s+(\d+)\s*$/.exec(line)
    if (match === null) return null
    const [, pid, parent, pgid, state = '', time = '', rss] = match
    const cpuSeconds = parseCpuTime(time)
    if (cpuSeconds === null) return null
    const parsed = processSampleSchema.safeParse({
      pid: Number(pid),
      pgid: Number(pgid),
      parent: Number(parent),
      exited: state.startsWith('Z'),
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
