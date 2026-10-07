import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { formatExactUsd as formatUsd } from '../../src/shared/l10n/exactUsd'
import {
  Usd,
  isPositiveUsd,
  legacyUsdSchema,
  nonnegativeUsdSchema,
  usdInputSchema,
  multiplyUsd,
  negateUsd,
  sumUsd,
  usdAmountSchema,
} from '../../src/shared/usd'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('shared exact USD', () => {
  it('normalizes legacy edges and rejects noncanonical or nonfinite money', () => {
    expect(legacyUsdSchema.parse(0.0005872)).toBe('0.0005872')
    for (const [input, expected] of [
      [1e-7, '0.0000001'],
      [1e21, '1000000000000000000000'],
      [0.10000000000000002, '0.10000000000000002'],
      [0, '0'],
    ] as const) {
      expect(legacyUsdSchema.parse(input)).toBe(expected)
    }
    expect(legacyUsdSchema.parse('9007199254740993.001')).toBe('9007199254740993.001')
    expect(usdInputSchema.parse('000.0000')).toBe('0')
    expect(usdInputSchema.parse('000.0100')).toBe('0.01')
    expect(nonnegativeUsdSchema.safeParse('-1').success).toBe(false)
    expect(Usd.from('1.2300e-4').toAmount()).toBe('0.000123')
    for (const invalid of ['00.1', '0.10', '1e-4', 'NaN'])
      expect(usdAmountSchema.safeParse(invalid).success).toBe(false)
    for (const invalid of [NaN, Infinity, '-0.01'])
      expect(legacyUsdSchema.safeParse(invalid).success).toBe(false)
    expect(() => Usd.from(Infinity)).toThrow('finite decimal')
    expect(() => Usd.from(1).times(0.5)).toThrow('safe integer')
    expect(() => Usd.from(1).divide(3)).toThrow('power of ten')
    expect(() => Usd.from(1).divideIntegerCeiling(0)).toThrow('positive')
  })

  it('preserves exact addition, subtraction, rational prices and comparisons over generated amounts', () => {
    for (const numerator of [0, 1, 25, 100, 2751, 5672, 90_001]) {
      for (const count of [0, 1, 2, 100, 2751]) {
        const price = Usd.from(numerator).divide(1_000_000_000)
        const amount = price.times(count)
        expect(amount.times(1_000_000_000).toString()).toBe(
          String(BigInt(numerator) * BigInt(count)),
        )
        expect(amount.add(price).subtract(price).compare(amount)).toBe(0)
        expect(sumUsd(amount.toAmount(), negateUsd(amount.toAmount()))).toBe('0')
        expect(multiplyUsd(price.toAmount(), count)).toBe(amount.toAmount())
        expect(isPositiveUsd(amount.toAmount())).toBe(numerator > 0 && count > 0)
        if (numerator > 0) expect(amount.floorDivide(price)).toBe(BigInt(count))
      }
    }
    expect(Usd.from(1).divideIntegerCeiling(3).toString()).toBe('0.333333334')
    expect(Usd.from(-1).divideIntegerCeiling(3).toString()).toBe('-0.333333333')
    expect(Usd.from('-1.1').floorDivide(Usd.from(1))).toBe(-2n)
    expect(() => Usd.from(1).floorDivide(Usd.from(0))).toThrow('positive')
  })

  it('ceilings sub-cent prices to at least two significant digits without under-reporting', () => {
    expect(formatUsd('0.00343875', 2)).toBe('$0.0035')
    expect(formatUsd('0.0002751', 2)).toBe('$0.00028')
    for (const amount of [
      '0',
      '0.000000001',
      '0.0002751',
      '0.00343875',
      '0.01',
      '1.001',
      '9007199254740993.001',
    ]) {
      const display = formatUsd(amount, 2).replaceAll(/[$,]/g, '')
      expect(Usd.from(display).compare(Usd.from(amount))).toBeGreaterThanOrEqual(0)
      if (isPositiveUsd(Usd.from(amount).toAmount()))
        expect(isPositiveUsd(Usd.from(display).toAmount())).toBe(true)
    }
    setUiText(EN, 'de')
    expect(formatUsd('0.0002751', 2)).toContain('0,00028')
    setUiText(EN, 'ar-u-nu-arab')
    expect(formatUsd('0.0002751', 2)).toContain('٠٫٠٠٠٢٨')
  })
})
