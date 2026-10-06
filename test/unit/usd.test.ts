import { describe, expect, it } from 'vitest'
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
