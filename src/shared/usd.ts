const DECIMAL_RADIX = 10n
const ZERO = 0n
const ONE = 1n
const NANO_USD_DECIMALS = 9
const NANOS_PER_USD = DECIMAL_RADIX ** BigInt(NANO_USD_DECIMALS)

/** Exact nano-USD fraction. Retain sub-nano charges until display, never
 * round each rental or duration before comparing complete candidate costs.
 */
export interface UsdNanos {
  numerator: bigint
  denominator: bigint
}

function decimal(value: number): UsdNanos {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('invalid-usd')
  // The boundary is a JSON number. Interpret its canonical decimal spelling,
  // including scientific notation, without floating-point multiplication.
  const [mantissa = '0', exponent = '0'] = String(value).split('e', 2)
  const [whole = '0', fraction = ''] = mantissa.split('.', 2)
  const scale = fraction.length - Number(exponent)
  const digits = BigInt(whole + fraction)
  return scale >= 0
    ? { numerator: digits, denominator: DECIMAL_RADIX ** BigInt(scale) }
    : { numerator: digits * DECIMAL_RADIX ** BigInt(-scale), denominator: ONE }
}

export function usdNanos(value: number): UsdNanos {
  const units = decimal(value)
  return { ...units, numerator: units.numerator * NANOS_PER_USD }
}

export function addUsdNanos(a: UsdNanos, b: UsdNanos): UsdNanos {
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  }
}

export function scaleUsdNanos(value: UsdNanos, factor: number): UsdNanos {
  const multiplier = decimal(factor)
  return {
    numerator: value.numerator * multiplier.numerator,
    denominator: value.denominator * multiplier.denominator,
  }
}

export function compareUsdNanos(a: UsdNanos, b: UsdNanos): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator
  if (difference === ZERO) return 0
  return difference < ZERO ? -1 : 1
}

/** Only the JSON/display projection rounds upward to the next nano-USD.
 * This number must never be used for cost arithmetic or selection.
 */
export function displayUsdNanos(value: UsdNanos): number {
  const ceiling = (value.numerator + value.denominator - ONE) / value.denominator
  const whole = ceiling / NANOS_PER_USD
  const fraction = (ceiling % NANOS_PER_USD).toString().padStart(NANO_USD_DECIMALS, '0')
  return Number(`${String(whole)}.${fraction}`)
}
