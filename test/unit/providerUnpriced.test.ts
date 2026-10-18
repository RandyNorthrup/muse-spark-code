// The add/test/list no-price warning (D4): a configured model the priced
// catalogue names stays silent, but one present only under `unpriced` still
// warns — that entry is capability evidence, while configured resolution
// leaves the model unpriced and an exec run refuses it.
import { describe, expect, it } from 'vitest'
import { isModelUnpriced, type CatalogPresence } from '../../src/runtime/exec/providerExec'

const catalog: CatalogPresence = {
  providers: { testpreset: { models: { 'priced-model': {} } } },
  unpriced: { testpreset: { 'unpriced-model': {} } },
}
const entry = (
  overrides: {
    auth?: 'apiKey' | 'none'
    prices?: Record<string, { input: number; output: number }>
  } = {},
) => ({
  auth: overrides.auth ?? ('apiKey' as const),
  ...(overrides.prices !== undefined && { prices: overrides.prices }),
})

describe('unpriced catalogue warning', () => {
  it('warns for a model present only under unpriced', () => {
    expect(isModelUnpriced(catalog, 'testpreset', entry(), 'unpriced-model')).toBe(true)
  })

  it('stays silent for a priced record or a user-entered price', () => {
    expect(isModelUnpriced(catalog, 'testpreset', entry(), 'priced-model')).toBe(false)
    expect(
      isModelUnpriced(
        catalog,
        'testpreset',
        entry({ prices: { 'unpriced-model': { input: 1e-6, output: 2e-6 } } }),
        'unpriced-model',
      ),
    ).toBe(false)
  })

  it('stays silent for custom presets and keyless entries', () => {
    expect(isModelUnpriced(catalog, 'custom', entry(), 'unpriced-model')).toBe(false)
    expect(isModelUnpriced(catalog, 'testpreset', entry({ auth: 'none' }), 'unpriced-model')).toBe(
      false,
    )
  })
})
