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
