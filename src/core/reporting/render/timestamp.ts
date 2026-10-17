import {
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../../shared/constants'

/** ISO only: explicit arithmetic follows the report offset, never the machine's timezone. */
export function reportTimestamp(value: string, asOf: string): string {
  const offset = asOf.endsWith('Z') ? 'Z' : asOf.slice(-'+00:00'.length)
  const [hours, minutes] = offset.slice(1).split(':', 2)
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset.startsWith('-') ? -1 : 1) * (Number(hours) * MINUTES_PER_HOUR + Number(minutes))
  return new Date(Date.parse(value) + offsetMinutes * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND)
    .toISOString()
    .replace(/Z$/, () => offset)
}
