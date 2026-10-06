import {
  ISO_DATE_LENGTH,
  MILLISECONDS_PER_DAY,
  SCHEDULE_LIFETIME_MS,
} from '../../../shared/constants'
import { scheduleZoneSchema, type ScheduleTimeTrigger } from '../../../shared/scheduleV2'
import { parseLoopPrompt, type LoopParseResult } from '../../backends/modelapi/schedules'
import { nextTimeFire } from './scheduleTime'
import { checkInstant, ZonedScheduleCalendar } from './zonedCalendar'

type LoopControl = { readonly verb: 'list' } | { readonly verb: 'cancel'; readonly id: string }
export type LoopTimeParseResult =
  | { readonly ok: false; readonly reason: Extract<LoopParseResult, { ok: false }>['reason'] }
  | { readonly ok: true; readonly command: LoopControl }
  | {
      readonly ok: true
      readonly command: {
        readonly verb: 'create'
        readonly prompt: string
        readonly trigger: ScheduleTimeTrigger
        readonly zone: string
        readonly end: { readonly atMs: number }
      }
    }

/** V/X bind this adapter when replacing M52. Keep its grammar and seven-day
 * default; `d` selects civil days, while `m`/`h` remain elapsed intervals. */
export function parseScheduleLoop(
  text: string,
  nowMs: number,
  zone: string,
): LoopTimeParseResult | undefined {
  const parsed = parseLoopPrompt(text)
  if (!parsed?.ok) return parsed
  if (parsed.command.verb !== 'create') return { ok: true, command: parsed.command }
  checkInstant(nowMs)
  scheduleZoneSchema.parse(zone)
  const { cadence, prompt } = parsed.command
  let trigger: ScheduleTimeTrigger
  if (cadence.kind === 'cron') {
    trigger = cadence
  } else if (/^\/loop\s+\d+d(?:\s|$)/i.test(text.trim())) {
    const date = new Date(new ZonedScheduleCalendar(zone).stamp(nowMs))
    trigger = {
      kind: 'daily',
      everyDays: cadence.everyMs / MILLISECONDS_PER_DAY,
      anchorDate: date.toISOString().slice(0, ISO_DATE_LENGTH),
      times: [{ hour: date.getUTCHours(), minute: date.getUTCMinutes() }],
    }
  } else {
    trigger = { kind: 'interval', everyMs: cadence.everyMs, anchorMs: nowMs }
  }
  const end = { atMs: nowMs + SCHEDULE_LIFETIME_MS }
  return nextTimeFire(trigger, zone, nowMs, end.atMs) === undefined
    ? { ok: false, reason: 'badCadence' }
    : { ok: true, command: { verb: 'create', prompt, trigger, zone, end } }
}
