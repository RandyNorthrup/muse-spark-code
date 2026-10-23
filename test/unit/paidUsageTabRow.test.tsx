// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EMPTY_PAID_TALLY, paidStateSchema, type PaidState } from '../../src/shared/paidBoundary'
import { Usd } from '../../src/shared/usd'
import { PaidSection } from '../../src/webview/components/PaidUsageSection'

function state(tab: PaidState['tab'], tally: PaidState['tally'] = EMPTY_PAID_TALLY): PaidState {
  return paidStateSchema.parse({
    features: [],
    tally,
    isKeyStored: true,
    alwaysAllowed: [],
    ...(tab !== undefined && { tab }),
  })
}

function renderTabRow(tab: PaidState['tab'], tally: PaidState['tally'] = EMPTY_PAID_TALLY) {
  render(
    <PaidSection paid={state(tab, tally)} features={['tab']} onForgetPaidUse={() => undefined} />,
  )
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

  it('shows requests, tokens, cached tokens and the reported cost once Tab has run', () => {
    renderTabRow(
      { budgetUsd: Usd.from(1).toAmount(), todayUsd: Usd.from(0.12).toAmount() },
      {
        ...EMPTY_PAID_TALLY,
        tabRequests: 4,
        tabTokens: 900,
        tabCachedTokens: 300,
        tabCostUsd: Usd.from(0.02).toAmount(),
      },
    )
    expect(screen.getByText(/4 Tab requests/)).toBeDefined()
    expect(screen.getByText(/900 tokens \(300 cached\)/)).toBeDefined()
    expect(screen.getByText(/Reported token estimate: \$0\.02/)).toBeDefined()
    expect(screen.getByText(/Today: \$0\.12/)).toBeDefined()
    expect(screen.getByText(/This window: \$0\.02/)).toBeDefined()
  })

  it('says off with the budget before Tab has ever run', () => {
    renderTabRow({ budgetUsd: Usd.from(5).toAmount() })
    expect(screen.getByText(/\(off\)/)).toBeDefined()
    expect(screen.queryByText(/Tab requests/)).toBeNull()
    expect(screen.getByText('Daily budget: $5.00')).toBeDefined()
  })
})
