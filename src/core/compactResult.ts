import { UI_TEXT } from '../shared/constants'
import { fill, formatNumber, plural } from '../shared/l10n/text'
import type { CompactOutcome } from './agent/agentBackend'

/**
One sentence a person reads for a finished /compact in an editor
session. A command turn never ends without it: success names what was
folded, and every other outcome names why nothing changed. The panel
shows the same sentences for its own /compact run.
*/
export function compactResultText(outcome: CompactOutcome): string {
  if (outcome.status === 'cancelled') return UI_TEXT.compactionStoppedNotice
  if (outcome.status === 'noop')
    return fill(UI_TEXT.nothingToCompactReason, { reason: outcome.reason ?? 'noop' })
  if (
    outcome.turns !== undefined &&
    outcome.turns >= 1 &&
    outcome.beforeEntries !== undefined &&
    outcome.afterEntries !== undefined
  )
    return plural(UI_TEXT.compactionDoneDetail, outcome.turns, {
      before: formatNumber(outcome.beforeEntries),
      after: formatNumber(outcome.afterEntries),
    })
  return UI_TEXT.compactionDone
}
