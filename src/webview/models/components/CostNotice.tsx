import { Usd, type UsdAmount } from '../../../shared/usd'
// Before a check that bills a token, its cost is stated and asked first
// (M95 step 8.4): the one-token request never goes without this Accept.
// Amounts under a cent render with six digits, so a fraction of a cent
// still reads as one.

import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { formatUsd } from '../../../shared/l10n/exactUsd'

const SMALL_COST_USD = 0.01
const SMALL_COST_DIGITS = 6
const COST_DIGITS = 4

/** The test cost as the language writes money: about $0.000002. */
export function formatTestCost(costUsd: UsdAmount): string {
  return formatUsd(
    costUsd,
    Usd.from(costUsd).compare(Usd.from(SMALL_COST_USD)) < 0 ? SMALL_COST_DIGITS : COST_DIGITS,
  )
}

export interface CostNoticeProps {
  readonly costUsd: UsdAmount
  readonly onAccept: () => void
  readonly onDecline: () => void
}

export function CostNotice({ costUsd, onAccept, onDecline }: CostNoticeProps) {
  return (
    <div className="models-cost-notice" role="group" aria-label={UI_TEXT.testConnection}>
      <p>{fill(UI_TEXT.providerTestPaid, { cost: formatTestCost(costUsd) })}</p>
      <div className="models-row-actions">
        <button type="button" className="models-button-primary" onClick={onAccept}>
          {UI_TEXT.suggestionAccept}
        </button>
        <button type="button" className="models-button" onClick={onDecline}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    </div>
  )
}
