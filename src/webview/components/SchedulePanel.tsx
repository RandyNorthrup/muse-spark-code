// Extension-owned Model API schedules in this conversation (PLAN.md M52).
// A due job remains a reminder until the user chooses Run and accepts the
// separate host-side price dialog. These controls never auto-submit a turn.

import type { ReactNode } from 'react'
import type { ScheduleView } from '../../shared/schedule'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime, plural } from '../../shared/l10n/text'
import { formatDuration } from '../../shared/usage'

export interface SchedulePanelProps {
  /** W supplies the separate schedule page/list; v1 remains until migration binds. */
  readonly surface?: ReactNode
  readonly jobs: readonly ScheduleView[]
  readonly nowMs: number
  readonly isPaidOn: boolean
  readonly isInert: boolean
  readonly onRun: (id: string, occurrenceMs: number) => void
  readonly onCancel: (id: string) => void
  readonly onEnable: () => void
}

function cadenceText(job: ScheduleView): string {
  return job.cadence.kind === 'cron'
    ? job.cadence.expression
    : fill(UI_TEXT.scheduleEvery, {
        duration: formatDuration(job.cadence.everyMs, 0),
      })
}

export function SchedulePanel({
  surface,
  jobs,
  nowMs,
  isPaidOn,
  isInert,
  onRun,
  onCancel,
  onEnable,
}: SchedulePanelProps) {
  if (surface !== undefined) {
    return <div inert={isInert}>{surface}</div>
  }
  if (jobs.length === 0) {
    return null
  }
  return (
    <section className="local-schedules" aria-label={UI_TEXT.schedulePanelLabel} inert={isInert}>
      <div className="local-schedules-head">
        <strong>{UI_TEXT.schedulePanelTitle}</strong>
        <span>{UI_TEXT.schedulePanelScope}</span>
      </div>
      <ul className="local-schedules-list">
        {jobs.map((job) => {
          const isDue = nowMs >= job.nextFireAtMs
          return (
            <li key={job.id} className="local-schedule">
              <div className="local-schedule-prompt" dir="auto">
                {job.prompt}
              </div>
              <div className="local-schedule-facts">
                <span>{cadenceText(job)}</span>
                <span>
                  {isDue
                    ? UI_TEXT.schedulePending
                    : fill(UI_TEXT.scheduleNextRun, {
                        date: formatDateTime(job.nextFireAtMs),
                      })}
                </span>
                <span>{plural(UI_TEXT.scheduleFired, job.fireCount)}</span>
                <code>{job.id}</code>
              </div>
              <div className="local-schedule-actions">
                {isDue ? (
                  <button
                    type="button"
                    className="tool-more chat-control"
                    aria-label={fill(
                      isPaidOn ? UI_TEXT.scheduleRunJob : UI_TEXT.scheduleEnableJob,
                      { id: job.id },
                    )}
                    onClick={() => {
                      if (isPaidOn) {
                        onRun(job.id, job.nextFireAtMs)
                      } else {
                        onEnable()
                      }
                    }}
                  >
                    {isPaidOn ? UI_TEXT.scheduleRun : UI_TEXT.scheduleEnablePaid}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="tool-more chat-control"
                  aria-label={fill(UI_TEXT.scheduleCancelJob, { id: job.id })}
                  onClick={() => {
                    onCancel(job.id)
                  }}
                >
                  {UI_TEXT.scheduleCancel}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
