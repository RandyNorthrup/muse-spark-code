// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EMPTY_PAID_TALLY, paidStateSchema, type PaidState } from '../../src/shared/paidBoundary'
import { Usd } from '../../src/shared/usd'
import { PaidSection } from '../../src/webview/components/PaidUsageSection'

function state(tab: PaidState['tab']): PaidState {
  return paidStateSchema.parse({
    features: [],
    tally: EMPTY_PAID_TALLY,
    isKeyStored: true,
    alwaysAllowed: [],
    ...(tab !== undefined && { tab }),
  })
}

function renderTabRow(tab: PaidState['tab']) {
  render(<PaidSection paid={state(tab)} features={['tab']} onForgetPaidUse={() => undefined} />)
}

describe('Account & usage Tab budget line (NOLIMITS5)', () => {
  it('says the budget is not known yet before Tab state arrives, never $1.00', () => {
    renderTabRow(undefined)
    expect(screen.getByText('Daily budget: not known yet')).toBeDefined()
    expect(screen.queryByText('Daily budget: $1.00')).toBeNull()
  })

  it('says no daily budget when the person set none', () => {
    renderTabRow({ budgetUsd: Usd.from(0).toAmount() })
    expect(screen.getByText('No daily budget')).toBeDefined()
  })

  it('names the budget the person set', () => {
    renderTabRow({ budgetUsd: Usd.from(5).toAmount() })
    expect(screen.getByText('Daily budget: $5.00')).toBeDefined()
  })
})
