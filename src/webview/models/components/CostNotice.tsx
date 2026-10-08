import type { UsdAmount } from '../../../shared/usdSchema'
// Before a check that bills a token, its cost is stated and asked first
// (M95 step 8.4): the one-token request never goes without this Accept.
// The exact cost arrives with the lazy money chunk (STARTUP017); until
// then the notice waits rather than stating a guessed number.

import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { useFormatTestCost } from '../../money'

export interface CostNoticeProps {
  readonly costUsd: UsdAmount
  readonly onAccept: () => void
  readonly onDecline: () => void
}

export function CostNotice({ costUsd, onAccept, onDecline }: CostNoticeProps) {
  // The buttons stay interactive while the exact cost loads; only the
  // cost line waits, rather than stating a guessed number.
  const cost = useFormatTestCost(costUsd)
  return (
    <div className="models-cost-notice" role="group" aria-label={UI_TEXT.testConnection}>
      {cost === undefined ? null : <p>{fill(UI_TEXT.providerTestPaid, { cost })}</p>}
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
