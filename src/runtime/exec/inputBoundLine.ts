// The headless start line for a ticket's input bound (RLPROVSYNC). A leaf
// of its own so the headless preflight reads it without loading the
// runtime accounting entry, whose Model API client carries the frozen
// billing route (PLAN.md D216 keeps that route out of dist/headless.js).
import { SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT, UI_TEXT } from '../../shared/constants'
import { fill, formatPercent } from '../../shared/l10n/text'
import type { CountFailureDetail, ResponseInputBound } from './runLedger'

/**
The start line for a ticket's input bound, or undefined when it needs
none: the estimate names its margin, a failed count names the redacted
HTTP failure where one was captured, and a rejected over-length count
says so instead of sharing the failure's line.
*/
export function inputBoundInfoLine(ticket: {
  readonly inputBound?: ResponseInputBound | undefined
  readonly countFailure?: CountFailureDetail | undefined
}): string | undefined {
  if (ticket.inputBound === 'estimate')
    return fill(UI_TEXT.execEstimateBound, {
      margin: formatPercent(SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT),
    })
  if (ticket.inputBound === 'bytes-over-length') return UI_TEXT.execCountBytesOverLength
  if (ticket.inputBound !== 'bytes-after-failure') return undefined
  const failure = ticket.countFailure
  if (failure === undefined) return UI_TEXT.execCountBytesFallback
  // The status is a protocol identifier, not a quantity: plain digits, so
  // no locale's grouping or digits can corrupt a line the person pastes back.
  return fill(UI_TEXT.execCountBytesFailed, { status: String(failure.status), type: failure.kind })
}
