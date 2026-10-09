import type { ReactNode } from 'react'
import type { UsdAmount } from '../../../shared/usdSchema'
// Before a check that bills a token, its cost is stated and asked first
// (M95 step 8.4): the one-token request never goes without this Accept.
// The exact cost arrives with the lazy money chunk (STARTUP017). Accept
// waits for it: consent is given to a stated price, never to a blank one.
// A failed load is said with Retry (the panel's notice), and Accept stays
// unavailable.

import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { useMoneyLoad } from '../../money'

export interface CostDisclosure {
  /** Accept may be offered: the exact cost is on show. */
  readonly isDisclosed: boolean
  /** The cost line: loading, or the exact cost; nothing once the load failed. */
  readonly line: ReactNode
}

/** The paid check's cost line; nothing loads while there is no cost to state. */
export function useTestCostDisclosure(costUsd: UsdAmount | undefined): CostDisclosure {
  const money = useMoneyLoad(undefined, costUsd !== undefined)
  if (costUsd !== undefined && money.status === 'ready') {
    return {
      isDisclosed: true,
      line: (
        <p>{fill(UI_TEXT.providerTestPaid, { cost: money.display.formatTestCost(costUsd) })}</p>
      ),
    }
  }
  return {
    isDisclosed: false,
    line:
      money.status === 'failed' ? null : (
        <p className="models-hint" role="status">
          {UI_TEXT.loadingOutput}
        </p>
      ),
  }
}

export interface CostNoticeProps {
  readonly costUsd: UsdAmount
  readonly onAccept: () => void
  readonly onDecline: () => void
}

export function CostNotice({ costUsd, onAccept, onDecline }: CostNoticeProps) {
  const { isDisclosed, line } = useTestCostDisclosure(costUsd)
  return (
    <div className="models-cost-notice" role="group" aria-label={UI_TEXT.testConnection}>
      {line}
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button-primary"
          disabled={!isDisclosed}
          onClick={onAccept}
        >
          {UI_TEXT.suggestionAccept}
        </button>
        <button type="button" className="models-button" onClick={onDecline}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    </div>
  )
}
