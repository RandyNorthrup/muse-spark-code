import type { ScheduleHostPort } from '../../../shared/scheduleV2'
import type { ScheduleTimePlan } from './scheduleTime'
import { checkInstant } from './zonedCalendar'

export type ScheduleClockPort = Pick<ScheduleHostPort, 'now' | 'monotonicNow'>
export interface ScheduleClockState {
  readonly wallMs: number
  readonly monotonicMs: number
  /** Virtual epoch for interval occurrence ids; wall corrections never move it. */
  readonly elapsedMs: number
  readonly jumpMs: number
}

/** The host supplies the clock; no timers, OS reads or module-global state.
 * suspendedMs is measured suspend time omitted by that host's monotonic
 * clock. Never infer sleep from a wall jump: a clock correction is identical
 * in those two readings. With a suspend-inclusive clock, leave it at zero. */
export function readScheduleClock(
  clock: ScheduleClockPort,
  previous?: ScheduleClockState,
  suspendedMs = 0,
): ScheduleClockState {
  const wallMs = clock.now()
  const monotonicMs = clock.monotonicNow()
  checkInstant(wallMs)
  if (
    !Number.isFinite(monotonicMs) ||
    monotonicMs < 0 ||
    !Number.isFinite(suspendedMs) ||
    suspendedMs < 0
  ) {
    throw new RangeError('scheduleTime.invalidClock')
  }
  if (previous === undefined) return { wallMs, monotonicMs, elapsedMs: wallMs, jumpMs: 0 }
  if (monotonicMs < previous.monotonicMs) throw new RangeError('scheduleTime.clockReset')
  const elapsed = monotonicMs - previous.monotonicMs + suspendedMs
  const elapsedMs = previous.elapsedMs + elapsed
  if (!Number.isFinite(elapsedMs) || elapsedMs > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('scheduleTime.invalidClock')
  }
  return { wallMs, monotonicMs, elapsedMs, jumpMs: wallMs - previous.wallMs - elapsed }
}

/** Use the returned plan/now for next-fire and recovery calculations. End
 * dates remain absolute wall deadlines, even when interval ids use a virtual
 * epoch. Add wallOffsetMs to a logical occurrence only for its display/wake
 * time; the permanent claim keeps the original logical occurrence. */
export function scheduleTimeAtClock(
  plan: ScheduleTimePlan,
  clock: ScheduleClockState,
): {
  plan: ScheduleTimePlan
  nowMs: number
  wallOffsetMs: number
} {
  const isElapsed =
    plan.trigger.kind === 'interval' ||
    (plan.trigger.kind === 'afterEvent' && plan.trigger.time.kind === 'interval')
  if (!isElapsed) return { plan, nowMs: clock.wallMs, wallOffsetMs: 0 }
  const nowMs = Math.floor(clock.elapsedMs)
  checkInstant(nowMs)
  const wallOffsetMs = clock.wallMs - clock.elapsedMs
  const end = plan.end
  return {
    plan:
      end?.atMs === undefined
        ? plan
        : { ...plan, end: { ...end, atMs: Math.max(0, Math.ceil(end.atMs - wallOffsetMs)) } },
    nowMs,
    wallOffsetMs,
  }
}
