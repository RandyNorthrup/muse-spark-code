import { beforeEach, describe, expect, it } from 'vitest'
import { subagentTaskPrice } from '../../src/shared/paid'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

// Lane LIMITSA, A5: the per-task request cap is gone. The consent price
// names the per-request rates with no request count; a child runs like its
// parent. Pure: the real price function, values passed in as data.
describe('subagentTaskPrice', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('names the model and its rates with no request cap', () => {
    const price = subagentTaskPrice('muse-spark-1.3')
    expect(price).toContain('muse-spark-1.3')
    expect(price).toContain('no request cap')
    expect(price).not.toContain('up to')
    expect(price).not.toContain('per task')
  })

  it('says tariff unknown for an unpriced model', () => {
    expect(subagentTaskPrice('muse-x')).toContain('No verified price')
  })
})
