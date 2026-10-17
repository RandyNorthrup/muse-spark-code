import {
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SCHEDULE_MIN_INTERVAL_MS,
} from '../../../shared/constants'
import { scheduleZoneSchema } from '../../../shared/scheduleV2'

/** A civil date encoded as UTC, for arithmetic only, never a firing instant. */
export function civilDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

export function checkInstant(atMs: number): void {
  if (!Number.isSafeInteger(atMs) || atMs < 0 || !Number.isFinite(new Date(atMs).getTime())) {
    throw new RangeError('scheduleTime.invalidInstant')
  }
}

/** Intl owns the zone rules; UTC Dates here are just civil calendar containers. */
export class ZonedScheduleCalendar {
  private readonly formatter: Intl.DateTimeFormat
  constructor(zone: string) {
    this.formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: scheduleZoneSchema.parse(zone),
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
  }

  stamp(atMs: number): number {
    const parts = this.formatter.formatToParts(atMs)
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value)
    const date = civilDate(read('year'), read('month'), read('day'))
    date.setUTCHours(read('hour'), read('minute'), read('second'))
    return date.getTime()
  }

  /** First occurrence in a fold; first valid civil minute after a gap.
   * Samples span both sides even of a full skipped date (e.g. Pacific/Apia).
   * Offset seconds are retained for historical IANA rules. */
  resolve(wanted: number): number {
    const offsets = new Set(
      [-MILLISECONDS_PER_DAY * 2, 0, 2 * MILLISECONDS_PER_DAY].map((distance) => {
        const at = wanted + distance
        return this.stamp(at) - Math.floor(at / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND
      }),
    )
    const candidates = [...offsets].map((offset) => wanted - offset)
    const exact = candidates.filter((candidate) => this.stamp(candidate) === wanted)
    if (exact.length > 0) return Math.min(...exact)

    let low = Math.min(...candidates)
    let high = Math.max(...candidates)
    if (this.stamp(low) >= wanted || this.stamp(high) < wanted) {
      throw new RangeError('scheduleTime.unresolvedZone')
    }
    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.stamp(middle) < wanted) low = middle
      else high = middle
    }
    const minute = SCHEDULE_MIN_INTERVAL_MS
    return high + ((minute - (this.stamp(high) % minute)) % minute)
  }
}
