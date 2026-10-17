import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'

import {
  tabDayKey,
  tabSettleUsd,
  isWithinTabBudget,
  tabWorstCaseUsd,
} from '../../src/core/tab/tabSpend'

const STANDARD = 'muse-spark-1.3'
const CONTRIBUTOR = 'muse-spark-1.3-contributor'

describe('tabWorstCaseUsd', () => {
  it('reserves input bytes plus the output cap at list price', () => {
    // 2 input bytes at $1.25 and 128 output tokens at $4.25 per million.
    expect(
      Number(tabWorstCaseUsd({ model: STANDARD, inputText: 'ab', maxOutputTokens: 128 })),
    ).toBeCloseTo(0.0005465, 10)
    // The contributor tier's own rates: 2 at $0.10, 128 at $0.20.
    expect(
      Number(tabWorstCaseUsd({ model: CONTRIBUTOR, inputText: 'ab', maxOutputTokens: 128 })),
    ).toBeCloseTo(0.0000258, 10)
  })

  it('counts UTF-8 bytes, not characters', () => {
    // 'é' is one character but two bytes: 2 at $1.25, 16 at $4.25.
    expect(
      Number(tabWorstCaseUsd({ model: STANDARD, inputText: 'é', maxOutputTokens: 16 })),
    ).toBeCloseTo(0.0000705, 10)
  })

  it('errs high against the settlement for the same usage', () => {
    const worst = tabWorstCaseUsd({
      model: STANDARD,
      inputText: 'x'.repeat(100),
      maxOutputTokens: 128,
    })
    const settled = tabSettleUsd({ inputTokens: 100, outputTokens: 20, cachedTokens: 90 }, STANDARD)
    expect(Number(worst)).toBeGreaterThan(Number(settled))
  })
})

describe('tabSettleUsd', () => {
  it('prices reported usage with cached tokens at the cached rate', () => {
    // 60 fresh at $1.25, 40 cached at $0.15, 10 output at $4.25.
    expect(
      Number(tabSettleUsd({ inputTokens: 100, outputTokens: 10, cachedTokens: 40 }, STANDARD)),
    ).toBeCloseTo(0.0001235, 10)
  })
})

describe('isWithinTabBudget', () => {
  it('fits exactly at the budget and refuses past it', () => {
    expect(
      isWithinTabBudget({
        spentTodayUsd: Usd.from(0.5).toAmount(),
        worstCaseUsd: Usd.from(0.5).toAmount(),
        budgetUsd: Usd.from(1).toAmount(),
      }),
    ).toBe(true)
    expect(
      isWithinTabBudget({
        spentTodayUsd: Usd.from(0.5).toAmount(),
        worstCaseUsd: Usd.from(0.500001).toAmount(),
        budgetUsd: Usd.from(1).toAmount(),
      }),
    ).toBe(false)
  })
})

// Nominally America/New_York: the DST cases run only where the process
// honours the pin (its January and July offsets prove it), so the suite
// stays green on rigs whose platform ignores TZ.
process.env['TZ'] = 'America/New_York'
const IS_EASTERN_PINNED =
  new Date('2026-01-15T12:00:00Z').getTimezoneOffset() === 300 &&
  new Date('2026-07-15T12:00:00Z').getTimezoneOffset() === 240

describe('tabDayKey', () => {
  it('renders the local calendar day zero-padded', () => {
    const at = new Date(2026, 4, 5, 12, 0).getTime()
    const date = new Date(at)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    expect(tabDayKey(at)).toBe(`${String(date.getFullYear())}-${month}-${day}`)
    expect(tabDayKey(at)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('rolls over at local midnight', () => {
    const midnight = new Date(2026, 4, 5).getTime()
    expect(tabDayKey(midnight - 1)).not.toBe(tabDayKey(midnight))
    expect(tabDayKey(midnight)).not.toBe(tabDayKey(midnight + 24 * 60 * 60 * 1000))
  })

  it.skipIf(!IS_EASTERN_PINNED)('uses the local day, not the UTC day', () => {
    // 23:30 in New York is already the next UTC day, both in winter and summer.
    expect(tabDayKey(Date.parse('2026-01-15T23:30:00-05:00'))).toBe('2026-01-15')
    expect(tabDayKey(Date.parse('2026-07-15T23:30:00-04:00'))).toBe('2026-07-15')
  })

  it.skipIf(!IS_EASTERN_PINNED)('holds one day across both DST transitions', () => {
    // Spring forward 2026-03-08: the 02:00 hour never happens locally.
    expect(tabDayKey(new Date(2026, 2, 8, 0, 30).getTime())).toBe('2026-03-08')
    expect(tabDayKey(new Date(2026, 2, 8, 3, 30).getTime())).toBe('2026-03-08')
    // Fall back 2026-11-01: the 01:00 hour happens twice, still one day.
    expect(tabDayKey(new Date(2026, 10, 1, 1, 30).getTime())).toBe('2026-11-01')
    expect(tabDayKey(new Date(2026, 10, 1, 3, 30).getTime())).toBe('2026-11-01')
    // And the midnight into the transition day still rolls.
    const midnight = new Date(2026, 2, 8).getTime()
    expect(tabDayKey(midnight - 1)).toBe('2026-03-07')
    expect(tabDayKey(midnight)).toBe('2026-03-08')
  })
})
