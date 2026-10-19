// M115's store and fire record as the reporting `schedules` source: the
// timeline of upcoming fires with collisions, each schedule's trigger,
// target, delivery, grant and creator, recent fires with outcomes, refused
// actions and cost. Reads only through the injected reader; only the
// schedules kind binds it.
import * as z from 'zod/mini'
import type { UiText } from '../../../shared/l10n/en'
import { REPORT_MAX_ROWS } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { ScheduleV2 } from '../../../shared/scheduleV2'
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

/**
Trigger and grant prose in the installed language, read here (after the
input bundle installs the caller's table) so the pure collector never
touches the text table — like dates, which arrive pre-rendered.
Technical details spliced after a label (a trigger's `source:event`, a
target or creator id, a cron expression) stay as they came.
*/
export function triggerText(schedule: ScheduleV2, reportText: UiText): string {
  const trigger = schedule.trigger
  const cells = reportText.reportScheduleCells
  switch (trigger.kind) {
    case 'once': {
      return reportText.reportLabels.once
    }
    case 'interval': {
      return fill(cells.triggerInterval, { everyMs: String(trigger.everyMs) })
    }
    case 'daily': {
      return fill(cells.triggerDaily, {
        everyDays: String(trigger.everyDays),
        times: String(trigger.times.length),
      })
    }
    case 'weekdays': {
      return fill(cells.triggerWeekdays, { times: String(trigger.times.length) })
    }
    case 'weekly': {
      return fill(cells.triggerWeekly, { days: String(trigger.days.length) })
    }
    case 'cron': {
      return trigger.expression
    }
    case 'event': {
      return `${reportText.scheduleV2.triggers.event}: ${trigger.source}:${trigger.event}`
    }
    case 'afterEvent': {
      return `${reportText.scheduleV2.triggers.afterEvent}: ${trigger.event.source}:${trigger.event.event}`
    }
  }
}

/**
Target prose in the installed language: the translated target word with
the technical id spliced after it (`Label: detail` over a session, worker,
role, team or node id), like dates arrive pre-rendered.
*/
export function targetText(schedule: ScheduleV2, reportText: UiText): string {
  const words = reportText.scheduleV2.targets
  const target = schedule.target
  switch (target.kind) {
    case 'conversation': {
      return `${words.conversation}: ${target.sessionId}`
    }
    case 'newConversation': {
      return `${words.newConversation}: ${target.backend}`
    }
    case 'worker': {
      return `${words.worker}: ${target.workerId}`
    }
    case 'role': {
      return `${words.role}: ${target.teamId}/${target.roleId}`
    }
    case 'team': {
      return `${words.team}: ${target.teamId}`
    }
    case 'node': {
      return `${words.node}: ${target.nodeId}`
    }
  }
}

/** Delivery prose in the installed language, read at use time. */
export function deliveryText(schedule: ScheduleV2, reportText: UiText): string {
  return reportText.scheduleV2.delivery[schedule.delivery]
}

/**
Agent-creator prose in the installed language: the translated creator
word with the technical agent id spliced after it. A user creator reads
as the `user` label, so this is `undefined` for one.
*/
export function creatorText(schedule: ScheduleV2, reportText: UiText): string | undefined {
  return schedule.creator.kind === 'user'
    ? undefined
    : `${reportText.scheduleV2.labels.creator}: ${schedule.creator.agentId}`
}

export function grantText(schedule: ScheduleV2, reportText: UiText): string {
  return fill(reportText.reportScheduleCells.scheduleGrant, {
    rules: String(schedule.grant.rules.length),
    destinations: String(schedule.grant.destinationIds.length),
    cap: schedule.grant.paidCapUsd,
  })
}

export function schedulesSource(reader: SchedulesReportReader | undefined, scrub: SourceScrub) {
  return localSource('schedules', async (context) => {
    if (context.options.kind !== 'schedules') throw new LocalSourceError('disabled')
    if (reader === undefined) throw new LocalSourceError('unbound')
    const reportText = context.reportText
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
            triggerText: triggerText(schedule, reportText),
            targetText: targetText(schedule, reportText),
            deliveryText: deliveryText(schedule, reportText),
            creatorText: creatorText(schedule, reportText),
            grantText: grantText(schedule, reportText),
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
            outcomeText: reportText.scheduleSettlement.outcomes[fire.outcome],
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
