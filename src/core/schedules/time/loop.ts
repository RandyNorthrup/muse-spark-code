import { SCHEDULE_LIFETIME_MS } from '../../../shared/constants'
import { scheduleZoneSchema, type ScheduleTimeTrigger } from '../../../shared/scheduleV2'
import { parseLoopPrompt, type LoopParseResult } from '../../backends/modelapi/schedules'
import { nextTimeFire } from './scheduleTime'
import { checkInstant } from './zonedCalendar'

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

/** V/X bind this adapter when replacing M52. Keep its grammar, seven-day
 * default and exact elapsed cadence for all m/h/d units, including precision. */
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
  const trigger: ScheduleTimeTrigger =
    cadence.kind === 'cron'
      ? cadence
      : { kind: 'interval', everyMs: cadence.everyMs, anchorMs: nowMs }
  const end = { atMs: nowMs + SCHEDULE_LIFETIME_MS }
  return nextTimeFire(trigger, zone, nowMs, end.atMs) === undefined
    ? { ok: false, reason: 'badCadence' }
    : { ok: true, command: { verb: 'create', prompt, trigger, zone, end } }
}
