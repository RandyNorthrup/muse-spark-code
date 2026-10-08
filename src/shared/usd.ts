// Exact decimal USD arithmetic for hosted-search admission and durable claims.
// Numbers enter once at the boundary; persisted amounts use decimal strings.
import {
  USD_DECIMAL_RADIX,
  USD_DECIMAL_ZERO,
  USD_DECIMAL_ONE,
  USD_LIABILITY_DECIMALS,
} from './usdConstants'

import { usdAmountSchema, type UsdAmount } from './usdSchema'
export {
  usdAmountSchema,
  nonnegativeUsdSchema,
  usdInputSchema,
  legacyUsdSchema,
  type UsdAmount,
} from './usdSchema'

const DECIMAL = /^(-?\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i
function radix(): bigint {
  return BigInt(USD_DECIMAL_RADIX)
}

/** Positive remainder rounds a liability upward; negative amounts round toward zero. */
function ceilingDivide(numerator: bigint, denominator: bigint): bigint {
  return (
    numerator / denominator +
    (numerator % denominator > USD_DECIMAL_ZERO ? USD_DECIMAL_ONE : USD_DECIMAL_ZERO)
  )
}

export class Usd {
  public static from(amount: number | string): Usd {
    const match = DECIMAL.exec(String(amount))
    if (match === null) throw new Error('USD amount must be a finite decimal')
    const whole = match[1] ?? '0'
    const fraction = match[2] ?? ''
    const places = fraction.length - Number(match[3] ?? 0)
    const coefficient = BigInt(`${whole}${fraction}`)
    return places < 0
      ? new Usd(coefficient * radix() ** BigInt(-places), 0)
      : new Usd(coefficient, places)
  }

  public static fromUnits(units: bigint, places: number): Usd {
    return new Usd(units, places)
  }

  readonly #coefficient: bigint
  readonly #places: number
  private constructor(coefficient: bigint, places: number) {
    this.#coefficient = coefficient
    this.#places = places
  }

  #aligned(places: number): bigint {
    return this.#coefficient * radix() ** BigInt(places - this.#places)
  }

  /** Refuse precision loss at fixed-unit boundaries. */
  public units(places: number): bigint {
    if (places >= this.#places) return this.#aligned(places)
    const divisor = radix() ** BigInt(this.#places - places)
    if (this.#coefficient % divisor !== USD_DECIMAL_ZERO)
      throw new Error('USD amount is not representable')
    return this.#coefficient / divisor
  }

  public add(amount: Usd): Usd {
    const places = Math.max(this.#places, amount.#places)
    return new Usd(this.#aligned(places) + amount.#aligned(places), places)
  }

  public subtract(amount: Usd): Usd {
    return this.add(new Usd(-amount.#coefficient, amount.#places))
  }

  public times(count: number): Usd {
    if (!Number.isSafeInteger(count)) throw new Error('USD multiplier must be a safe integer')
    return new Usd(this.#coefficient * BigInt(count), this.#places)
  }

  /** Prices are divided by powers of ten (per thousand/per million), exactly. */
  public divide(divisor: number): Usd {
    const places = Math.log10(divisor)
    if (!Number.isSafeInteger(places) || places < 0) {
      throw new Error('USD divisor must be a positive power of ten')
    }
    return new Usd(this.#coefficient, this.#places + places)
  }

  /** Non-terminating division rounds liabilities UP to nano-USD, by policy. */
  public divideIntegerCeiling(divisor: number): Usd {
    if (!Number.isSafeInteger(divisor) || divisor <= 0)
      throw new Error('USD divisor must be positive')
    const places = Math.max(this.#places, USD_LIABILITY_DECIMALS)
    const numerator = this.#aligned(places)
    const denominator = BigInt(divisor)
    return new Usd(ceilingDivide(numerator, denominator), places)
  }

  public compare(amount: Usd): number {
    const difference = this.subtract(amount).#coefficient
    if (difference === USD_DECIMAL_ZERO) return 0
    return difference < USD_DECIMAL_ZERO ? -1 : 1
  }

  /** Whole output tokens affordable at an exact per-token price. */
  public floorDivide(price: Usd): bigint {
    const places = Math.max(this.#places, price.#places)
    const numerator = this.#aligned(places)
    const denominator = price.#aligned(places)
    if (denominator <= USD_DECIMAL_ZERO) throw new Error('USD token price must be positive')
    const whole = numerator / denominator
    return numerator < USD_DECIMAL_ZERO && numerator % denominator !== USD_DECIMAL_ZERO
      ? whole - USD_DECIMAL_ONE
      : whole
  }

  /** Display policy: ceiling to the requested decimal precision, never under-report. */
  public ceiling(places: number): Usd {
    if (places >= this.#places) return this
    const divisor = radix() ** BigInt(this.#places - places)
    return new Usd(ceilingDivide(this.#coefficient, divisor), places)
  }

  public toString(): string {
    const isNegative = this.#coefficient < USD_DECIMAL_ZERO
    const digits = (isNegative ? -this.#coefficient : this.#coefficient)
      .toString()
      .padStart(this.#places + 1, '0')
    const whole = this.#places === 0 ? digits : digits.slice(0, -this.#places)
    const fraction = this.#places === 0 ? '' : digits.slice(-this.#places).replace(/0+$/, '')
    return `${isNegative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`
  }

  public toAmount(): UsdAmount {
    return usdAmountSchema.parse(this.toString())
  }
}

/** Legacy values normalize once; every arithmetic result remains an exact branded string. */
export function sumUsd(...amounts: readonly UsdAmount[]): UsdAmount {
  let sum = Usd.from(0)
  for (const amount of amounts) sum = sum.add(Usd.from(amount))
  return sum.toAmount()
}

export function multiplyUsd(amount: UsdAmount, count: number): UsdAmount {
  return Usd.from(amount).times(count).toAmount()
}

export function negateUsd(amount: UsdAmount): UsdAmount {
  return Usd.from(0).subtract(Usd.from(amount)).toAmount()
}

export function isPositiveUsd(amount: UsdAmount): boolean {
  return Usd.from(amount).compare(Usd.from(0)) > 0
}

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
