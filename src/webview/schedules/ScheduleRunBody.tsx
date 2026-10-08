import { UI_TEXT } from '../../shared/constants'
import { formatDateTime, formatUsd } from '../../shared/l10n/text'
import { deferred } from '../components/DeferredSurface'
import type { ScheduleTargetChoice } from './ports'
import type { ToolEntry } from '../state/uiState'
import { parseScheduleSettlement, scheduleTargetText } from './presentation'

const ScheduleBody = deferred(async () => {
  const module = await import('../components/ToolBodies')
  return { default: module.ScheduleBody }
})

export function ScheduleRunBody({
  entry,
  targets = [],
  currentConversationId,
}: {
  readonly entry: ToolEntry
  readonly targets?: readonly ScheduleTargetChoice[]
  readonly currentConversationId?: string
}) {
  const parsed = parseScheduleSettlement(entry.output)
  if (!parsed.ok) return <ScheduleBody entry={entry} />
  const { fire } = parsed
  return (
    <div className="schedule-v2-fire">
      <strong>
        {fire.outcome === 'ran'
          ? UI_TEXT.scheduleV2.editor.sent
          : UI_TEXT.scheduleV2.outcomes[fire.outcome]}
      </strong>
      <p>
        {formatDateTime(fire.occurrenceMs)} ·{' '}
        {scheduleTargetText(fire.target, targets, currentConversationId)} ·{' '}
        {UI_TEXT.scheduleV2.delivery[fire.delivery]}
      </p>
      <code>{fire.scheduleId}</code> · <code>{fire.runId}</code>
      {fire.reason === undefined ? null : <p dir="auto">{fire.reason}</p>}
      <ul>
        {fire.refusedActions.map((action, index) => (
          <li key={index} dir="auto">
            {UI_TEXT.scheduleV2.outcomes.refused}: {action.tool} · {action.reason}
          </li>
        ))}
      </ul>
      <p>
        {UI_TEXT.scheduleV2.editor.cost}: {formatUsd(fire.cost.usd, 2)} (
        {UI_TEXT.scheduleV2.editor.certainty[fire.cost.certainty]});{' '}
        {UI_TEXT.scheduleV2.editor.liability}: {formatUsd(fire.cost.retainedLiabilityUsd, 2)}
      </p>
    </div>
  )
}
