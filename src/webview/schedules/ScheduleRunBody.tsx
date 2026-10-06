import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime, formatUsd } from '../../shared/l10n/text'
import { scheduleFireRecordSchema } from '../../shared/scheduleV2'
import { ScheduleBody } from '../components/ToolBodies'
import type { ToolEntry } from '../state/uiState'
import { scheduleTargetText } from './presentation'

// U/D serialize this internal settlement, never an inferred provider row.
const scheduleTranscriptSchema = z.strictObject({
  type: z.literal('scheduleFire'),
  fire: scheduleFireRecordSchema,
})

export function ScheduleRunBody({ entry }: { readonly entry: ToolEntry }) {
  let data: unknown
  try {
    data = JSON.parse(entry.output)
  } catch {
    return <ScheduleBody entry={entry} />
  }
  const parsed = scheduleTranscriptSchema.safeParse(data)
  if (!parsed.success) return <ScheduleBody entry={entry} />
  const { fire } = parsed.data
  return (
    <div className="schedule-v2-fire">
      <strong>
        {fire.outcome === 'ran'
          ? UI_TEXT.scheduleV2.editor.sent
          : UI_TEXT.scheduleV2.outcomes[fire.outcome]}
      </strong>
      <p>
        {formatDateTime(fire.occurrenceMs)} · {scheduleTargetText(fire.target)} ·{' '}
        {UI_TEXT.scheduleV2.delivery[fire.delivery]}
      </p>
      <code>{fire.scheduleId}</code> · <code>{fire.runId}</code>
      {fire.reason === undefined ? null : <p dir="auto">{fire.reason}</p>}
      <ul>
        {fire.refusedActions.map((action, index) => (
          <li key={index} dir="auto">
            {['physical', 'protectedPath', 'requiresAsking'].includes(action.actionClass)
              ? `${UI_TEXT.scheduleV2.outcomes.refused}: ${action.tool}`
              : fill(UI_TEXT.scheduleV2.messages.unattendedRefusal, { action: action.tool })}{' '}
            · {action.reason}
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
