import { beforeEach, describe, expect, it } from 'vitest'
import { tabBudgetReachedDetail } from '../../src/host/tab/tabSpendGate'
import { Usd } from '../../src/shared/usd'
import { formatUsd } from '../../src/core/usage/insights'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

// Lane LIMITSA, A4: hitting Tab's daily budget is never silent. The notice
// names the spend, the budget and how to raise it. Pure: the real message
// builder, values passed in as data.
describe('tabBudgetReachedDetail', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('names the spend, the budget and how to raise it', () => {
    const spent = Usd.from(1).toAmount()
    const budget = Usd.from(1).toAmount()
    const detail = tabBudgetReachedDetail(spent, budget)
    expect(detail).toContain(formatUsd(spent))
    expect(detail).toContain(formatUsd(budget))
    expect(detail).toContain('museSpark.tabDailyBudgetUsd')
    expect(detail).toContain('tomorrow')
  })
})
