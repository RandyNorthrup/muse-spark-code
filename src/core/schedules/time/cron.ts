// M52's five-field grammar and day-field semantics, shared with M115.
import {
  CRON_FIELD_COUNT,
  CRON_FIELD_SEGMENT_LIMIT,
  CRON_MAX_DAY,
  CRON_MAX_HOUR,
  CRON_MAX_MINUTE,
  CRON_MAX_MONTH,
  CRON_MAX_WEEKDAY,
  SCHEDULE_MIN_INTERVAL_MS,
} from '../../../shared/constants'

const MINUTE_MS = SCHEDULE_MIN_INTERVAL_MS

interface CronField {
  readonly values: ReadonlySet<number>
  readonly isWildcard: boolean
}

export interface ParsedCron {
  readonly minute: CronField
  readonly hour: CronField
  readonly day: CronField
  readonly month: CronField
  readonly weekday: CronField
}

function cronField(
  source: string,
  low: number,
  high: number,
  isWeekday = false,
): CronField | undefined {
  const values = new Set<number>()
  for (const segment of source.split(',')) {
    const [base, stepText, extra] = segment.split('/', CRON_FIELD_SEGMENT_LIMIT)
    if (
      base === undefined ||
      extra !== undefined ||
      (stepText !== undefined && !/^\d+$/.test(stepText))
    ) {
      return undefined
    }
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isSafeInteger(step) || step < 1) {
      return undefined
    }
    let start: number
    let end: number
    if (base === '*') {
      start = low
      end = high
    } else {
      const range = /^(\d+)(?:-(\d+))?$/.exec(base)
      if (range === null) {
        return undefined
      }
      start = Number(range[1])
      end = range[2] === undefined ? (stepText === undefined ? start : high) : Number(range[2])
    }
    if (start < low || end > high || start > end) {
      return undefined
    }
    for (let value = start; value <= end; value += step) {
      values.add(isWeekday && value === CRON_MAX_WEEKDAY ? 0 : value)
    }
  }
  return values.size === 0 ? undefined : { values, isWildcard: source.includes('*') }
}

export function parseCron(expression: string): ParsedCron | undefined {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== CRON_FIELD_COUNT) {
    return undefined
  }
  const minute = cronField(parts[0] ?? '', 0, CRON_MAX_MINUTE)
  const hour = cronField(parts[1] ?? '', 0, CRON_MAX_HOUR)
  const day = cronField(parts[2] ?? '', 1, CRON_MAX_DAY)
  const month = cronField(parts[3] ?? '', 1, CRON_MAX_MONTH)
  const weekday = cronField(parts[4] ?? '', 0, CRON_MAX_WEEKDAY, true)
  return minute === undefined ||
    hour === undefined ||
    day === undefined ||
    month === undefined ||
    weekday === undefined
    ? undefined
    : { minute, hour, day, month, weekday }
}

export function isCronMatch(
  cron: ParsedCron,
  date: { minute: number; hour: number; day: number; month: number; weekday: number },
): boolean {
  const isDay = cron.day.values.has(date.day)
  const isWeekday = cron.weekday.values.has(date.weekday)
  // Cron ORs these fields only when neither contains '*'. A step such as
  // '*/2' still has to match its own values when the fields are ANDed.
  const isDayMatch =
    cron.day.isWildcard || cron.weekday.isWildcard ? isDay && isWeekday : isDay || isWeekday
  return (
    cron.minute.values.has(date.minute) &&
    cron.hour.values.has(date.hour) &&
    cron.month.values.has(date.month) &&
    isDayMatch
  )
}

/** First matching local-time minute after `afterMs`, bounded by expiry. */
export function nextCronFire(
  expression: string,
  afterMs: number,
  expiresAtMs: number,
): number | undefined {
  const cron = parseCron(expression)
  if (cron === undefined) {
    return undefined
  }
  const start = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS
  for (let time = start; time < expiresAtMs; time += MINUTE_MS) {
    const date = new Date(time)
    if (
      isCronMatch(cron, {
        minute: date.getMinutes(),
        hour: date.getHours(),
        day: date.getDate(),
        month: date.getMonth() + 1,
        weekday: date.getDay(),
      })
    ) {
      return time
    }
  }
  return undefined
}
