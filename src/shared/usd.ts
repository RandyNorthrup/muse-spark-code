// Exact decimal USD arithmetic for hosted-search admission and durable claims.
// Numbers enter once at the boundary; persisted amounts use decimal strings.
import * as z from 'zod/mini'
import {
  USD_DECIMAL_RADIX,
  USD_DECIMAL_ZERO,
  USD_DECIMAL_ONE,
  USD_LIABILITY_DECIMALS,
} from './usdConstants'

/** Canonical exact amounts on new money ports. Numbers are accepted only at legacy parse edges. */
export const usdAmountSchema = z
  .string()
  .check(z.regex(/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/))
  .brand<'Usd'>()
export type UsdAmount = z.infer<typeof usdAmountSchema>
export type LegacyUsd = number | string

const DECIMAL = /^(-?\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i
function radix(): bigint {
  return BigInt(USD_DECIMAL_RADIX)
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

  private constructor(
    private readonly coefficient: bigint,
    private readonly places: number,
  ) {}

  private aligned(places: number): bigint {
    return this.coefficient * radix() ** BigInt(places - this.places)
  }

  public add(amount: Usd): Usd {
    const places = Math.max(this.places, amount.places)
    return new Usd(this.aligned(places) + amount.aligned(places), places)
  }

  public subtract(amount: Usd): Usd {
    return this.add(new Usd(-amount.coefficient, amount.places))
  }

  public times(count: number): Usd {
    if (!Number.isSafeInteger(count)) throw new Error('USD multiplier must be a safe integer')
    return new Usd(this.coefficient * BigInt(count), this.places)
  }

  /** Prices are divided by powers of ten (per thousand/per million), exactly. */
  public divide(divisor: number): Usd {
    const places = Math.log10(divisor)
    if (!Number.isSafeInteger(places) || places < 0) {
      throw new Error('USD divisor must be a positive power of ten')
    }
    return new Usd(this.coefficient, this.places + places)
  }

  /** Non-terminating division rounds liabilities UP to nano-USD, by policy. */
  public divideIntegerCeiling(divisor: number): Usd {
    if (!Number.isSafeInteger(divisor) || divisor <= 0)
      throw new Error('USD divisor must be positive')
    const places = Math.max(this.places, USD_LIABILITY_DECIMALS)
    const numerator = this.aligned(places)
    const denominator = BigInt(divisor)
    return new Usd(
      numerator / denominator +
        (numerator % denominator > USD_DECIMAL_ZERO ? USD_DECIMAL_ONE : USD_DECIMAL_ZERO),
      places,
    )
  }

  public compare(amount: Usd): number {
    const difference = this.subtract(amount).coefficient
    if (difference === USD_DECIMAL_ZERO) return 0
    return difference < USD_DECIMAL_ZERO ? -1 : 1
  }

  /** Whole output tokens affordable at an exact per-token price. */
  public floorDivide(price: Usd): bigint {
    const places = Math.max(this.places, price.places)
    const numerator = this.aligned(places)
    const denominator = price.aligned(places)
    if (denominator <= USD_DECIMAL_ZERO) throw new Error('USD token price must be positive')
    const whole = numerator / denominator
    return numerator < USD_DECIMAL_ZERO && numerator % denominator !== USD_DECIMAL_ZERO
      ? whole - USD_DECIMAL_ONE
      : whole
  }

  /** Display policy: ceiling to the requested decimal precision, never under-report. */
  public ceiling(places: number): Usd {
    if (places >= this.places) return this
    const divisor = radix() ** BigInt(this.places - places)
    const quotient = this.coefficient / divisor
    const remainder = this.coefficient % divisor
    return new Usd(
      quotient + (remainder > USD_DECIMAL_ZERO ? USD_DECIMAL_ONE : USD_DECIMAL_ZERO),
      places,
    )
  }

  public toString(): string {
    const isNegative = this.coefficient < USD_DECIMAL_ZERO
    const digits = (isNegative ? -this.coefficient : this.coefficient)
      .toString()
      .padStart(this.places + 1, '0')
    const whole = this.places === 0 ? digits : digits.slice(0, -this.places)
    const fraction = this.places === 0 ? '' : digits.slice(-this.places).replace(/0+$/, '')
    return `${isNegative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`
  }

  public toAmount(): UsdAmount {
    return usdAmountSchema.parse(this.toString())
  }

  public toNumber(): number {
    const amount = Number(this.toString())
    if (!Number.isFinite(amount)) throw new Error('USD total is not finite')
    return amount
  }
}

/** Historical numeric records parse once; new serialized amounts stay canonical and exact. */
export const legacyUsdSchema = z.pipe(
  z.union([
    z.number().check(z.nonnegative()),
    usdAmountSchema.check(z.refine((amount) => !amount.startsWith('-'))),
  ]),
  z.transform((amount) => Usd.from(amount).toAmount()),
)

/** Legacy values normalize once; every arithmetic result remains an exact branded string. */
export function sumUsd(...amounts: readonly LegacyUsd[]): UsdAmount {
  let sum = Usd.from(0)
  for (const amount of amounts) sum = sum.add(Usd.from(amount))
  return sum.toAmount()
}

export function multiplyUsd(amount: LegacyUsd, count: number): UsdAmount {
  return Usd.from(amount).times(count).toAmount()
}

export function negateUsd(amount: LegacyUsd): UsdAmount {
  return Usd.from(0).subtract(Usd.from(amount)).toAmount()
}

export function isPositiveUsd(amount: LegacyUsd): boolean {
  return Usd.from(amount).compare(Usd.from(0)) > 0
}
