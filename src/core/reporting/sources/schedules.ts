// M115's store and fire record as the reporting `schedules` source: the
// timeline of upcoming fires with collisions, each schedule's trigger,
// target, delivery, grant and creator, recent fires with outcomes, refused
// actions and cost. Reads only through the injected reader; only the
// schedules kind binds it.
import * as z from 'zod/mini'
import { REPORT_MAX_ROWS } from '../../../shared/constants'
import { scheduleFireRecordSchema, scheduleV2Schema } from '../../../shared/scheduleV2'
import { schedulesSections } from '../collect/schedules'
import {
  codeUnitCompare,
  isoDateMs,
  localSource,
  LocalSourceError,
  scrubSourceValue,
  type SourceScrub,
} from './local'
import type { SourceReadContext } from './types'

/** Store rows and fire records; an empty store is no schedules, not a miss. */
export interface SchedulesReportReader {
  read(context: SourceReadContext): Promise<{
    schedules: readonly unknown[]
    fires: readonly unknown[]
    observedAt: string
    partial?: string
  }>
}

export function schedulesSource(reader: SchedulesReportReader | undefined, scrub: SourceScrub) {
  return localSource('schedules', async (context) => {
    if (context.options.kind !== 'schedules') throw new LocalSourceError('disabled')
    if (reader === undefined) throw new LocalSourceError('unbound')
    const read = await reader.read(context)
    let view: Parameters<typeof schedulesSections>[0]
    try {
      const schedules = z
        .array(scheduleV2Schema)
        .check(z.maxLength(REPORT_MAX_ROWS))
        .parse(scrubSourceValue(read.schedules, scrub))
      const fires = z
        .array(scheduleFireRecordSchema)
        .check(z.maxLength(REPORT_MAX_ROWS))
        .parse(scrubSourceValue(read.fires, scrub))
      const names = new Map(schedules.map((schedule) => [schedule.id, schedule.name]))
      view = {
        schedules: [...schedules]
          .toSorted((left, right) => codeUnitCompare(left.id, right.id))
          .map((schedule) => ({
            schedule,
            nextFireIso:
              schedule.nextFireAtMs === undefined ? undefined : isoDateMs(schedule.nextFireAtMs),
          })),
        fires: [...fires]
          .toSorted(
            (left, right) =>
              left.occurrenceMs - right.occurrenceMs ||
              codeUnitCompare(left.scheduleId, right.scheduleId) ||
              codeUnitCompare(left.runId, right.runId),
          )
          .map((fire) => ({
            fire,
            scheduleName: names.get(fire.scheduleId) ?? fire.scheduleId,
            occurrenceIso: isoDateMs(fire.occurrenceMs),
          })),
      }
    } catch {
      throw new LocalSourceError('invalid')
    }
    return {
      data: schedulesSections(view, context.options),
      observedAt: read.observedAt,
      ...(read.partial !== undefined && { partial: scrub(read.partial) }),
    }
  })
}
