import { afterEach, describe, expect, it } from 'vitest'
import { createUsageFeatures } from '../../src/runtime/usage/usageServiceEntry'
import { createUsageService } from '../../src/core/usage/usageService'
import { usageText } from '../../src/core/usage/usageText'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { usageFixtureDeps, usageFixtureRecord, usageNow } from './helpers/usageFixture'
import { USAGE_STALE_MS } from '../../src/shared/constants'

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
  it('prints only the latest provider/source/window limits with stale and awaiting status while retaining chart history', async () => {
    const deps = usageFixtureDeps()
    const [base] = await deps.readLiveLimits()
    const current = {
      ...base!,
      windows: [{ id: 'window', usedPercent: 70, resetsAt: usageNow + 9_000_000, windowMins: 300 }],
      account: { usedUsd: 7, limitUsd: 10, remainingUsd: 3, period: 'month' },
    }
    const older = {
      ...current,
      id: 'old',
      observedAt: usageNow - 1000,
      windows: [
        { ...current.windows[0]!, usedPercent: 10 },
        { id: 'expired-window', usedPercent: 90, resetsAt: usageNow },
      ],
      account: { ...current.account, usedUsd: 1 },
    }
    const stale = {
      ...current,
      id: 'stale',
      observedAt: usageNow - USAGE_STALE_MS,
      windows: [{ id: 'stale-window', usedPercent: 80 }],
    }
    const headers = {
      ...current,
      id: 'headers',
      source: 'headers' as const,
      windows: [{ id: 'window', label: 'header-window', usedPercent: 50 }],
    }
    const otherProvider = { ...current, id: 'other', provider: 'other-provider' }
    const journal = await deps.journal.read()
    const service = createUsageService({
      ...deps,
      journal: {
        ...deps.journal,
        read: () => Promise.resolve({ ...journal, limits: [current, older, stale] }),
      },
      readLiveLimits: () => Promise.resolve([headers, otherProvider, current]),
    })
    const state = await service.snapshot({ range: '30d', groupBy: 'provider', metric: 'cost' })
    const before = JSON.stringify(state.limits)
    expect(state.limits).toHaveLength(5)
    for (const format of ['plain', 'markdown'] as const) {
      const text = usageText(state, format)
      expect(text.match(/window: 70% used/g)).toHaveLength(2)
      expect(text).not.toContain('window: 10% used')
      expect(text).not.toContain('Under pace')
      expect(text).not.toContain('Provider account budget: $1.00')
      expect(text).toContain('header-window: 50% used')
      expect(text).toContain('stale-window: 80% used · Stale')
      expect(text).toContain('expired-window: 90% used · Awaiting fresh usage')
    }
    expect(JSON.stringify(state.limits)).toBe(before)
  })
  it('formats the combined charge once after exact accumulation across certainty lanes', async () => {
    const records = [
      usageFixtureRecord({ cost: { certainty: 'reported', usd: 0.001 } }),
      usageFixtureRecord({ cost: { certainty: 'computed', usd: 0.002 } }),
      usageFixtureRecord({ cost: { certainty: 'estimated', usd: 0.022 } }),
    ]
    const state = await createUsageService(usageFixtureDeps(records)).snapshot()
    expect(usageText(state)).toContain('Total cost: $0.03')
    expect(usageText(state, 'markdown')).toContain('Total cost: $0.03')
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
