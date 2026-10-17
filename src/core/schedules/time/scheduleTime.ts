import {
  CRON_MAX_WEEKDAY,
  MILLISECONDS_PER_DAY,
  MINUTES_PER_HOUR,
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_PREVIEW_COUNT,
} from '../../../shared/constants'
import {
  scheduleEndSchema,
  scheduleTimeTriggerSchema,
  scheduleTriggerSchema,
  type ScheduleTimeTrigger,
  type ScheduleV2,
} from '../../../shared/scheduleV2'
import { isCronMatch, parseCron, type ParsedCron } from './cron'
import { checkInstant, civilDate, ZonedScheduleCalendar } from './zonedCalendar'

export type ScheduleTimePlan = Pick<ScheduleV2, 'trigger' | 'zone' | 'end' | 'fireCount'>
type WallTrigger = Exclude<ScheduleTimeTrigger, { kind: 'once' | 'interval' }>

function canCronFire(cron: ParsedCron): boolean {
  // Restricted DOM/DOW use OR, so the nonempty weekday field can always fire.
  if (!cron.day.isWildcard && !cron.weekday.isWildcard) return true
  // A leap year's month lengths cover every possible Gregorian date.
  const leapYear = new Date('2000-01-01T00:00:00Z').getUTCFullYear()
  return [...cron.month.values].some((month) => {
    const lastDay = civilDate(leapYear, month + 1, 0).getUTCDate()
    return [...cron.day.values].some((day) => day <= lastDay)
  })
}

function wallCron(trigger: WallTrigger): ParsedCron | undefined {
  if (trigger.kind !== 'cron') return undefined
  const cron = parseCron(trigger.expression)
  if (cron === undefined) throw new RangeError('scheduleTime.invalidCron')
  return cron
}

function clockMinutes(times: readonly { hour: number; minute: number }[]): number[] {
  return times.map((time) => time.hour * MINUTES_PER_HOUR + time.minute)
}

function minutesOnDate(trigger: WallTrigger, date: Date, cron?: ParsedCron): readonly number[] {
  const weekday = date.getUTCDay()
  switch (trigger.kind) {
    case 'daily': {
      return clockMinutes(trigger.times)
    }
    case 'weekdays': {
      return weekday > 0 && weekday < CRON_MAX_WEEKDAY - 1 ? clockMinutes(trigger.times) : []
    }
    case 'weekly': {
      return trigger.days.flatMap((day) => (day.weekday === weekday ? clockMinutes(day.times) : []))
    }
    case 'cron': {
      if (cron === undefined) return []
      return [...cron.hour.values].flatMap((hour) =>
        [...cron.minute.values].flatMap((minute) =>
          isCronMatch(cron, {
            minute,
            hour,
            day: date.getUTCDate(),
            month: date.getUTCMonth() + 1,
            weekday,
          })
            ? [hour * MINUTES_PER_HOUR + minute]
            : [],
        ),
      )
    }
  }
}

function* wallFires(
  trigger: WallTrigger,
  zone: string,
  afterMs: number,
  beforeMs?: number,
): Generator<number, undefined> {
  const calendar = new ZonedScheduleCalendar(zone)
  const cron = wallCron(trigger)
  if (cron !== undefined && !canCronFire(cron)) return undefined
  const local = new Date(calendar.stamp(afterMs))
  const date = civilDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate())
  // A skipped date's intended times may map into this date. Include its
  // predecessor so a query just before that boundary still sees the gap fire.
  date.setUTCDate(date.getUTCDate() - 1)
  if (trigger.kind === 'daily') {
    const anchor = Date.parse(`${trigger.anchorDate}T00:00:00Z`)
    const days = Math.max(0, Math.ceil((date.getTime() - anchor) / MILLISECONDS_PER_DAY))
    date.setTime(
      anchor + Math.ceil(days / trigger.everyDays) * trigger.everyDays * MILLISECONDS_PER_DAY,
    )
  }
  // End bounds use the stored zone too, with a date of padding for offsets
  // and skipped dates. No seven-day search horizon for new schedules.
  const endDate =
    beforeMs === undefined ? undefined : calendar.stamp(beforeMs) + MILLISECONDS_PER_DAY
  let cursor = afterMs
  while (Number.isFinite(date.getTime()) && (endDate === undefined || date.getTime() <= endDate)) {
    const times = [...new Set(minutesOnDate(trigger, date, cron))].toSorted((a, b) => a - b)
    for (const minute of times) {
      const wanted = date.getTime() + minute * SCHEDULE_MIN_INTERVAL_MS
      // On today's date only future civil times can give a new occurrence.
      // Every folded time resolves to its first occurrence, including when
      // the query is in the second pass through the hour.
      if (wanted + SCHEDULE_MIN_INTERVAL_MS <= local.getTime()) continue
      const fire = calendar.resolve(wanted)
      if (fire <= cursor || (beforeMs !== undefined && fire >= beforeMs)) continue
      yield fire
      cursor = fire
    }
    const days = trigger.kind === 'daily' ? trigger.everyDays : 1
    date.setUTCDate(date.getUTCDate() + days)
  }
  return undefined
}

/** Strictly after the cursor, and strictly before the optional end instant. */
export function nextTimeFire(
  input: ScheduleTimeTrigger,
  zone: string,
  afterMs: number,
  beforeMs?: number,
): number | undefined {
  checkInstant(afterMs)
  if (beforeMs !== undefined) {
    checkInstant(beforeMs)
    if (beforeMs <= afterMs) return undefined
  }
  const trigger = scheduleTimeTriggerSchema.parse(input)
  if (trigger.kind === 'once') {
    const fire = trigger.atMs
    checkInstant(fire)
    return fire > afterMs && (beforeMs === undefined || fire < beforeMs) ? fire : undefined
  }
  if (trigger.kind === 'interval') {
    const steps = Math.max(0, Math.floor((afterMs - trigger.anchorMs) / trigger.everyMs) + 1)
    const fire = trigger.anchorMs + steps * trigger.everyMs
    return Number.isFinite(new Date(fire).getTime()) && (beforeMs === undefined || fire < beforeMs)
      ? fire
      : undefined
  }
  return wallFires(trigger, zone, afterMs, beforeMs).next().value
}

/** E supplies the matched event's validated observation instant, never fields.
 * One event composes to one fire. An interval is a delay from that event;
 * other kinds select their first occurrence strictly after the event. */
export function nextScheduleTime(
  plan: ScheduleTimePlan,
  afterMs: number,
  eventAtMs?: number,
): number | undefined {
  checkInstant(afterMs)
  if (!Number.isSafeInteger(plan.fireCount) || plan.fireCount < 0) {
    throw new RangeError('scheduleTime.invalidCount')
  }
  const end = plan.end === undefined ? undefined : scheduleEndSchema.parse(plan.end)
  if (end?.afterRuns !== undefined && plan.fireCount >= end.afterRuns) return undefined
  const trigger = scheduleTriggerSchema.parse(plan.trigger)
  if (trigger.kind !== 'event' && trigger.kind !== 'afterEvent') {
    return nextTimeFire(trigger, plan.zone, afterMs, end?.atMs)
  }
  if (eventAtMs === undefined) return undefined
  checkInstant(eventAtMs)
  const time = trigger.kind === 'afterEvent' ? trigger.time : undefined
  let fire: number | undefined = eventAtMs
  if (time?.kind === 'interval') fire += time.everyMs
  else if (time !== undefined) fire = nextTimeFire(time, plan.zone, eventAtMs, end?.atMs)
  return fire !== undefined &&
    Number.isFinite(new Date(fire).getTime()) &&
    fire > afterMs &&
    (end?.atMs === undefined || fire < end.atMs)
    ? fire
    : undefined
}

/** Preview is the same computation as admission, including both end bounds. */
export function previewScheduleTimes(
  plan: ScheduleTimePlan,
  afterMs: number,
  eventAtMs?: number,
): readonly number[] {
  const fires: number[] = []
  let cursor = afterMs
  while (fires.length < SCHEDULE_PREVIEW_COUNT) {
    const fire = nextScheduleTime(
      { ...plan, fireCount: plan.fireCount + fires.length },
      cursor,
      eventAtMs,
    )
    if (fire === undefined) break
    fires.push(fire)
    cursor = fire
  }
  return fires
}

/** Latest wall occurrences first in (afterMs, throughMs]. Recovery can stop
 * counting without losing the latest occurrence or scanning an outage. The
 * caller validates the plan/end/run count through nextScheduleTime. */
export function* previousTimeOccurrences(
  trigger: WallTrigger,
  zone: string,
  afterMs: number,
  throughMs: number,
): Generator<number, undefined> {
  checkInstant(afterMs)
  checkInstant(throughMs)
  if (throughMs <= afterMs) return undefined
  const cron = wallCron(trigger)
  if (cron !== undefined && !canCronFire(cron)) return undefined
  const calendar = new ZonedScheduleCalendar(zone)
  const local = new Date(calendar.stamp(throughMs))
  const date = civilDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate())
  const days = trigger.kind === 'daily' ? trigger.everyDays : 1
  if (trigger.kind === 'daily') {
    const anchor = Date.parse(`${trigger.anchorDate}T00:00:00Z`)
    if (date.getTime() < anchor) return undefined
    date.setTime(
      anchor +
        Math.floor((date.getTime() - anchor) / (days * MILLISECONDS_PER_DAY)) *
          days *
          MILLISECONDS_PER_DAY,
    )
  }
  // In the second pass through a fold, a later civil minute's FIRST occurrence
  // can precede throughMs. Use both neighboring offsets as the civil ceiling.
  // This also skips tomorrow's minutes cheaply when recovering dense cron.
  const padding = 2 * MILLISECONDS_PER_DAY
  const ceiling = Math.max(
    local.getTime(),
    calendar.stamp(throughMs - padding) + padding,
    calendar.stamp(throughMs + padding) - padding,
  )
  // A skipped predecessor date can resolve into the cursor's local date.
  const lowerDate = calendar.stamp(afterMs) - MILLISECONDS_PER_DAY
  let cursor = throughMs + 1
  while (Number.isFinite(date.getTime()) && date.getTime() >= lowerDate) {
    const times = [...new Set(minutesOnDate(trigger, date, cron))].toSorted((a, b) => b - a)
    for (const minute of times) {
      const wanted = date.getTime() + minute * SCHEDULE_MIN_INTERVAL_MS
      if (wanted > ceiling) continue
      const fire = calendar.resolve(wanted)
      if (fire > throughMs || fire >= cursor || fire <= afterMs) continue
      yield fire
      cursor = fire
    }
    if (trigger.kind === 'daily' && date.getTime() <= Date.parse(`${trigger.anchorDate}T00:00:00Z`))
      break
    date.setUTCDate(date.getUTCDate() - days)
  }
  return undefined
}
