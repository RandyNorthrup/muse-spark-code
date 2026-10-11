import { MILLISECONDS_PER_SECOND, SECONDS_PER_MINUTE, UI_TEXT } from '../../shared/constants'
import { formatUnit, uiLocale } from '../../shared/l10n/text'
import type { ScheduleDraft } from '../../shared/scheduleV2'
import { scheduleDateTime, scheduleWeekdayText } from './presentation'

function clocks(times: readonly { hour: number; minute: number }[]): string {
  const formatter = new Intl.DateTimeFormat(uiLocale(), { timeStyle: 'short', timeZone: 'UTC' })
  return times
    .map(({ hour, minute }) => {
      const clock = new Date(0)
      clock.setUTCHours(hour, minute)
      return formatter.format(clock)
    })
    .join(', ')
}

export function TriggerSummary({
  trigger,
  zone,
}: {
  readonly trigger: ScheduleDraft['trigger']
  readonly zone: string
}) {
  let detail
  switch (trigger.kind) {
    case 'once': {
      detail = scheduleDateTime(trigger.atMs, zone)
      break
    }
    case 'interval': {
      detail = formatUnit(trigger.everyMs / MILLISECONDS_PER_SECOND / SECONDS_PER_MINUTE, 'minute')
      break
    }
    case 'daily': {
      detail = (
        <>
          {formatUnit(trigger.everyDays, 'day')} · {clocks(trigger.times)} ·{' '}
          {new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
            Date.parse(`${trigger.anchorDate}T00:00:00Z`),
          )}
        </>
      )
      break
    }
    case 'weekdays': {
      detail = clocks(trigger.times)
      break
    }
    case 'weekly': {
      detail = (
        <ul>
          {trigger.days.map((day) => (
            <li key={day.weekday}>
              {scheduleWeekdayText(day.weekday)}: {clocks(day.times)}
            </li>
          ))}
        </ul>
      )
      break
    }
    case 'cron': {
      detail = <code>{trigger.expression}</code>
      break
    }
    case 'event': {
      detail = (
        <>
          {UI_TEXT.scheduleV2.events[trigger.event]} · <code>{trigger.source}</code>
          <ul>
            {trigger.conditions.map((condition, index) => (
              <li key={index}>
                <code>
                  {condition.field}={String(condition.equals)}
                </code>
              </li>
            ))}
          </ul>
        </>
      )
      break
    }
    case 'afterEvent': {
      detail = (
        <>
          <TriggerSummary trigger={trigger.event} zone={zone} />
          <TriggerSummary trigger={trigger.time} zone={zone} />
        </>
      )
      break
    }
  }
  return (
    <div>
      {UI_TEXT.scheduleV2.triggers[trigger.kind]} · {detail}
    </div>
  )
}
