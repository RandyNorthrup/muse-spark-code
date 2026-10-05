import { afterEach, describe, expect, it } from 'vitest'
import { createUsageFeatures } from '../../src/runtime/usage/usageServiceEntry'
import { createUsageService } from '../../src/core/usage/usageService'
import { usageText } from '../../src/core/usage/usageText'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { usageFixtureDeps, usageFixtureRecord } from './helpers/usageFixture'

afterEach(() => {
  setUiText(EN, 'en')
  setUsageText(USAGE_EN)
})
describe('usage text in every editor', () => {
  it('prints the page totals, model/provider breakdown, windows, caps and certainty in plain and Markdown', async () => {
    const service = createUsageFeatures({ ...usageFixtureDeps(), uiText: EN, uiLocale: 'en' })
    const state = await service.snapshot()
    const plain = service.text(state)
    expect(plain).toContain('Input tokens: 100')
    expect(plain).toContain('Computed: $0.01')
    expect(plain).toContain('Shared daily paid budget: $2.00 of $5.00')
    expect(plain).toContain('Stopped')
    expect(plain).toContain('Raised for today')
    expect(plain).toContain('Uncertain: $1.00')
    expect(plain).toContain('Projected today: $4.00')
    expect(plain).toContain('window: 62% used')
    expect(plain).toContain('openai does not report a limit here.')
    expect(service.text(state, 'markdown')).toContain('# Usage & cost')
    expect(service.text(state, 'markdown')).toContain('## Cost certainty')
  })
  it('does not turn unknown usage into zero or plan equivalents and liability into charges', async () => {
    const records = [
      usageFixtureRecord({ tokens: {}, cost: { certainty: 'unpriced' } }),
      usageFixtureRecord({
        id: 'plan',
        tokens: {},
        cost: { certainty: 'plan', apiEquivalentUsd: 4 },
      }),
      usageFixtureRecord({ id: 'uncertain', tokens: {}, cost: { certainty: 'uncertain', usd: 2 } }),
    ]
    const state = await createUsageService(usageFixtureDeps(records)).snapshot()
    const text = usageText(state)
    expect(text).toContain('Input tokens: Unknown')
    expect(text).toContain('Total cost: Unknown')
    expect(text).toContain('API-equivalent cost: $4.00')
    expect(text).toContain('Uncertain: $2.00')
    expect(text).toContain('Unknown cost is not zero.')
    expect(text).not.toContain('Total cost: $6.00')
  })
  it('escapes hostile model labels in Markdown and keeps real local model zero visible', async () => {
    const record = usageFixtureRecord({
      model: '[link](https://attacker.invalid)',
      provider: 'ollama',
      cost: { certainty: 'local', usd: 0 },
    })
    const state = await createUsageService(usageFixtureDeps([record])).snapshot({
      range: 'today',
      groupBy: 'model',
      metric: 'cost',
    })
    const text = usageText(state, 'markdown')
    expect(text).toContain('Total cost: $0.00')
    expect(text).toContain(String.raw`\[link\]\(https://attacker.invalid\)`)
    expect(text).not.toContain('[link](https://attacker.invalid)')
  })
  it('reads the caller table at run time and formats values in its installed locale', async () => {
    const service = createUsageFeatures({
      ...usageFixtureDeps(),
      table: {
        locale: 'de',
        table: {
          ...USAGE_EN,
          title: 'Nutzung und Kosten',
          inputTokens: 'Eingabetoken',
          totalCost: 'Gesamtkosten',
        },
      },
      uiText: EN,
      uiLocale: 'de',
    })
    const text = service.text(await service.snapshot())
    expect(text).toContain('Nutzung und Kosten')
    expect(text).toContain('Eingabetoken: 100')
    expect(text).toContain('Gesamtkosten: 0,01')
  })
})
