import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import {
  Usd,
  compareUsdAmounts,
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

  it('orders canonical amounts at the boundary exactly as the arithmetic module does', () => {
    const amounts = [
      '-12.5',
      '-1',
      '-0.000000001',
      '0',
      '0.000000001',
      '0.0000000011',
      '0.1',
      '0.10000000000000002',
      '1',
      '1.001',
      '9007199254740993',
      '9007199254740993.001',
    ].map((amount) => usdAmountSchema.parse(amount))
    for (const left of amounts)
      for (const right of amounts)
        expect(compareUsdAmounts(left, right), `${left} vs ${right}`).toBe(
          Usd.from(left).compare(Usd.from(right)),
        )
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

import {
  addUsdNanos,
  compareUsdNanos,
  displayUsdNanos,
  scaleUsdNanos,
  usdNanos,
} from '../../src/shared/usd'

describe('exact nano-USD arithmetic', () => {
  it('keeps decimal rental ties exact across different rates and durations', () => {
    const fast = scaleUsdNanos(usdNanos(0.9), 1)
    const slow = scaleUsdNanos(usdNanos(0.3), 3)
    expect(compareUsdNanos(fast, slow)).toBe(0)
    expect(displayUsdNanos(fast)).toBe(0.9)
    expect(displayUsdNanos(slow)).toBe(0.9)
  })
  it('sums all hourly rates before exact duration multiplication', () => {
    const rates = addUsdNanos(usdNanos(0.1), usdNanos(0.2))
    expect(compareUsdNanos(rates, usdNanos(0.3))).toBe(0)
    expect(displayUsdNanos(scaleUsdNanos(rates, 3))).toBe(0.9)
    expect(displayUsdNanos(scaleUsdNanos(usdNanos(0.3), 0.1))).toBe(0.03)
  })
  it('compares sub-nano charges before ceiling at the display boundary', () => {
    const less = scaleUsdNanos(usdNanos(1e-9), 0.1)
    const more = scaleUsdNanos(usdNanos(1e-9), 0.2)
    expect(compareUsdNanos(less, more)).toBe(-1)
    expect(compareUsdNanos(more, less)).toBe(1)
    expect(displayUsdNanos(less)).toBe(1e-9)
    expect(displayUsdNanos(more)).toBe(1e-9)
    expect(displayUsdNanos(addUsdNanos(less, more))).toBe(1e-9)
    expect(displayUsdNanos(usdNanos(0))).toBe(0)
  })
  it('parses scientific notation and retains all canonical decimal digits', () => {
    expect(displayUsdNanos(usdNanos(1e21))).toBe(1e21)
    const tiny = usdNanos(1.23e-13)
    expect(compareUsdNanos(scaleUsdNanos(tiny, 1000), usdNanos(1.23e-10))).toBe(0)
    expect(displayUsdNanos(tiny)).toBe(1e-9)
    expect(displayUsdNanos(usdNanos(0.9000000000000001))).toBe(0.900000001)
  })
  it('rejects negative and nonfinite rates or durations before arithmetic', () => {
    for (const value of [-1, Infinity, -Infinity, NaN]) {
      expect(() => usdNanos(value)).toThrow('invalid-usd')
      expect(() => scaleUsdNanos(usdNanos(1), value)).toThrow('invalid-usd')
    }
  })
})
