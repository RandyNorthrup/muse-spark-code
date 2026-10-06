import { UI_TEXT } from '../../shared/constants'
import type { ScheduleResponse, ScheduleView, ScheduleTargetChoice } from './ports'
import { scheduleCreatorText, scheduleDateTime, scheduleTargetText } from './presentation'

export function ScheduleTimeline({
  entries,
  schedules,
  targets,
  currentConversationId,
}: {
  readonly entries: Extract<ScheduleResponse, { kind: 'timeline' }>['entries']
  readonly targets: readonly ScheduleTargetChoice[]
  readonly currentConversationId: string | undefined
  readonly schedules: readonly ScheduleView[]
}) {
  return (
    <section aria-label={UI_TEXT.scheduleV2.labels.timeline}>
      <h2>{UI_TEXT.scheduleV2.labels.timeline}</h2>
      <ol className="schedule-v2-timeline">
        {entries.map((entry, index) => {
          const schedule = schedules.find((item) => item.id === entry.scheduleId)
          return (
            <li key={`${entry.scheduleId}:${String(entry.atMs)}:${String(index)}`}>
              <strong>{schedule?.name ?? entry.scheduleId}</strong>
              <p>
                {scheduleDateTime(entry.atMs, schedule?.zone ?? 'UTC')} · {schedule?.zone ?? 'UTC'}
              </p>
              <p>{scheduleTargetText(entry.target, targets, currentConversationId)}</p>
              <p>{scheduleCreatorText(entry.creator)}</p>
              {entry.collisionIds.length === 0 ? null : (
                <p className="schedule-v2-collision">
                  {UI_TEXT.scheduleV2.messages.collision}{' '}
                  {entry.collisionIds
                    .map((id) => schedules.find((item) => item.id === id)?.name ?? id)
                    .join(', ')}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
