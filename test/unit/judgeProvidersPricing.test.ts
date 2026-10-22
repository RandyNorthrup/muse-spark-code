// BYO provider price identity (M98 P2): the fingerprint names the exact
// card a consent grant was bound to, so a changed card asks again. Pure
// price-card math over real records; provider dispatch runs for real
// against local models outside unit tests.
import { describe, expect, it } from 'vitest'
import type { ModelPricing, PriceCard } from '../../src/core/providers/priceCard'
import { byoPriceFingerprint } from '../../src/core/judge/providers/run'

const CARD: PriceCard = { input: 2, output: 4, source: 'user' }
const PRICED: ModelPricing = { kind: 'priced', card: CARD }

describe('byoPriceFingerprint', () => {
  it('fingerprints a priced card and treats an invalid card as unpriced', () => {
    expect(byoPriceFingerprint(PRICED)).toBe(
      JSON.stringify({ kind: 'priced', source: 'user', input: 2, output: 4 }),
    )
    expect(byoPriceFingerprint({ kind: 'local' })).toBe('local')
    expect(byoPriceFingerprint({ kind: 'plan' })).toBe('plan')
    expect(byoPriceFingerprint({ kind: 'unpriced' })).toBe('unpriced')
    expect(
      byoPriceFingerprint({ kind: 'priced', card: { input: -1, output: 1, source: 'list' } }),
    ).toBe('unpriced')
  })

  it('changes the fingerprint when any priced field changes', () => {
    const changed = [
      { ...CARD, input: 3 },
      { ...CARD, output: 5 },
      { ...CARD, source: 'list' },
    ] as const
    for (const card of changed) {
      expect(byoPriceFingerprint({ kind: 'priced', card })).not.toBe(byoPriceFingerprint(PRICED))
    }
  })
})
