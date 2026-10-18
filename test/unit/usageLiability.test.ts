import { Usd } from '../../src/shared/usd'
import { expect, it } from 'vitest'
import { usageText } from '../../src/core/usage/usageText'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { usageStateFor } from './helpers/usageFixtures'

it('a budget keeps unknown liability on its own line and sentence, outside spent', () => {
  setUsageText(USAGE_EN)
  const state = usageStateFor()
  state.budgets = [
    {
      id: 'daily',
      kind: 'paidDaily',
      capUsd: Usd.from(1).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      uncertainUsd: Usd.from('0.33').toAmount(),
      stopped: false,
    },
  ]
  const text = usageText(state, 'plain', 'limits')
  expect(text).toContain('$0.00 of $1.00')
  expect(text).toContain('$0.33')
  expect(text).toContain(USAGE_EN.uncertainNote)
  expect(text).not.toContain('$0.33 of $1.00')
})

it('a daily budget names its calls with unknown cost beside the settled total', () => {
  setUsageText(USAGE_EN)
  const state = usageStateFor()
  state.budgets = [
    {
      id: 'daily',
      kind: 'paidDaily',
      capUsd: Usd.from(1).toAmount(),
      spentUsd: Usd.from('0.25').toAmount(),
      unknownChargeCalls: 2,
      stopped: false,
    },
  ]
  const text = usageText(state, 'plain', 'limits')
  expect(text).toContain('$0.25 of $1.00')
  expect(text).toContain('Uncertain: 2 calls with unknown cost')
})
