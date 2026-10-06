import { useRef } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { formatNumber, formatUsd, plural } from '../../shared/l10n/text'
import type { ScheduleRequest } from '../../shared/scheduleV2'
import type { GrantAudit, ScheduleView, ScheduleTargetChoice } from './ports'
import { TriggerSummary } from './TriggerSummary'
import {
  scheduleCreatorText,
  scheduleGrantRuleText,
  scheduleDateTime,
  scheduleTargetText,
} from './presentation'

export function ScheduleCard({
  schedule,
  audit,
  busy,
  unknown,
  targets,
  currentConversationId,
  onRetry,
  onAuditOpen,
  onEdit,
  onAction,
}: {
  readonly schedule: ScheduleView
  readonly audit: GrantAudit | undefined
  readonly busy: boolean
  readonly unknown: boolean
  readonly targets: readonly ScheduleTargetChoice[]
  readonly currentConversationId: string | undefined
  readonly onRetry: () => void
  readonly onAuditOpen: (isOpen: boolean) => void
  readonly onEdit: () => void
  readonly onAction: (
    method: Exclude<Extract<ScheduleRequest, { id: string }>['method'], 'schedules/update'>,
  ) => void
}) {
  const auditOpen = useRef(false)
  return (
    <article className="schedule-v2-card" aria-label={schedule.name}>
      <h2>{schedule.name}</h2>
      <p dir="auto">
        {schedule.action.kind === 'prompt' ? schedule.action.prompt : schedule.action.reportKind}
      </p>
      <dl>
        <dt>{UI_TEXT.scheduleV2.labels.trigger}</dt>
        <dd>
          <TriggerSummary trigger={schedule.trigger} zone={schedule.zone} />
        </dd>
        <dt>{UI_TEXT.scheduleV2.labels.target}</dt>
        <dd>{scheduleTargetText(schedule.target, targets, currentConversationId)}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.delivery}</dt>
        <dd>{UI_TEXT.scheduleV2.delivery[schedule.delivery]}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.mode}</dt>
        <dd>{UI_TEXT.permissionModes[schedule.mode]}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.creator}</dt>
        <dd>{scheduleCreatorText(schedule.creator)}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.depth}</dt>
        <dd>{formatNumber(schedule.depth)}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.timeZone}</dt>
        <dd>{schedule.zone}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.paidCap}</dt>
        <dd>{formatUsd(schedule.paidCapUsd, 2)}</dd>
        {schedule.end?.atMs === undefined ? null : (
          <>
            <dt>{UI_TEXT.scheduleV2.labels.end}</dt>
            <dd>{scheduleDateTime(schedule.end.atMs, schedule.zone)}</dd>
          </>
        )}
        {schedule.end?.afterRuns === undefined ? null : (
          <>
            <dt>{UI_TEXT.scheduleV2.editor.afterRuns}</dt>
            <dd>{formatNumber(schedule.end.afterRuns)}</dd>
          </>
        )}
        <dt>{UI_TEXT.scheduleV2.labels.parallel}</dt>
        <dd>{schedule.parallel ? UI_TEXT.toggleOn : UI_TEXT.toggleOff}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.pin}</dt>
        <dd>{schedule.pinned ? UI_TEXT.toggleOn : UI_TEXT.toggleOff}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.whenClosed}</dt>
        <dd>{UI_TEXT.scheduleV2.policies[schedule.whenClosed]}</dd>
        <dt>{UI_TEXT.scheduleV2.labels.catchUp}</dt>
        <dd>{UI_TEXT.scheduleV2.policies[schedule.catchUp]}</dd>
      </dl>
      {schedule.nextFireAtMs === undefined ? null : (
        <p>{scheduleDateTime(schedule.nextFireAtMs, schedule.zone)}</p>
      )}
      <p>{plural(UI_TEXT.scheduleFired, schedule.fireCount)}</p>
      {schedule.delivery === 'interrupt' ? (
        <p>{UI_TEXT.scheduleV2.messages.interruptWarning}</p>
      ) : null}
      {!unknown && schedule.paused ? (
        <p role="status">
          {UI_TEXT.scheduleV2.labels.paused}:{' '}
          {schedule.pauseReason === 'migrationConsentRequired'
            ? UI_TEXT.scheduleV2.messages.migrationConsent
            : schedule.pauseReason}
        </p>
      ) : null}
      {unknown ? (
        <p role="status">
          {UI_TEXT.scheduleV2.editor.stateUnknown}{' '}
          <button type="button" onClick={onRetry}>
            {UI_TEXT.scheduleV2.editor.retry}
          </button>
        </p>
      ) : (
        <details>
          <summary>{UI_TEXT.scheduleV2.labels.grant}</summary>
          <ul>
            {schedule.grant.rules.map((rule) => (
              <li key={rule.id}>
                <code>{rule.id}</code>: {scheduleGrantRuleText(rule)}
              </li>
            ))}
          </ul>
          {schedule.grant.destinationIds.map((id) => (
            <p key={id}>
              <code>{id}</code>
            </p>
          ))}
          <p>{formatUsd(schedule.grant.paidCapUsd, 2)}</p>
        </details>
      )}
      <details
        onToggle={(event) => {
          const isOpen = event.currentTarget.open
          onAuditOpen(isOpen)
          if (isOpen && audit === undefined && !auditOpen.current) onAction('schedules/grantAudit')
          auditOpen.current = isOpen
        }}
      >
        <summary>{UI_TEXT.scheduleV2.editor.audit}</summary>
        {audit === undefined ? (
          <p role="status">{UI_TEXT.loadingOutput}</p>
        ) : (
          <ul>
            {audit.map((entry, index) => (
              <li key={index}>
                {UI_TEXT.scheduleV2.editor.auditKinds[entry.kind]} ·{' '}
                {scheduleDateTime(entry.atMs, schedule.zone)} {entry.ruleId} {entry.runId}{' '}
                {entry.actionClass}
              </li>
            ))}
          </ul>
        )}
      </details>
      <div className="schedule-v2-actions">
        <button type="button" disabled={busy || unknown} onClick={onEdit}>
          {UI_TEXT.scheduleV2.editor.edit}
        </button>
        <button
          type="button"
          onClick={() => {
            onAction(!unknown && schedule.paused ? 'schedules/resume' : 'schedules/pause')
          }}
        >
          {!unknown && schedule.paused
            ? UI_TEXT.scheduleV2.labels.resume
            : UI_TEXT.scheduleV2.labels.pause}
        </button>
        <button
          type="button"
          onClick={() => {
            onAction('schedules/revokeGrant')
          }}
        >
          {UI_TEXT.scheduleV2.labels.revoke}
        </button>
        <button
          type="button"
          disabled={busy || unknown}
          onClick={() => {
            onAction('schedules/runNow')
          }}
        >
          {UI_TEXT.scheduleV2.labels.runNow}
        </button>
        <button
          type="button"
          disabled={busy || unknown}
          onClick={() => {
            onAction('schedules/remove')
          }}
        >
          {UI_TEXT.scheduleV2.labels.remove}
        </button>
      </div>
    </article>
  )
}
