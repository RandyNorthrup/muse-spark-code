// Exact nano-USD arithmetic. Legacy numbers are converted at the boundary,
// before calculation; liabilities round up and caps explicitly round down.
import { UI_TEXT, uiLocale } from './l10n/text'

import {
  USD_DECIMAL_ZERO as ZERO,
  USD_DECIMAL_ONE as ONE,
  USD_DECIMAL_RADIX as DECIMAL_RADIX,
  USD_MAX_DECIMAL_LENGTH as MAX_DECIMAL_LENGTH,
  USD_NANO_DECIMALS as NANO_USD_DECIMALS,
  USD_NANO_SCALE as NANO_USD_SCALE,
  USD_SMALL_DISPLAY_DECIMALS as SMALL_DISPLAY_DECIMALS,
  USD_MAX_AMOUNT as MAX_USD,
} from './constants'

/** Integer count of nano-USD; never a binary dollar amount. */
export type Usd = bigint
type Rounding = 'ceil' | 'floor'

function unavailable(): never {
  throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
}

function divide(value: bigint, divisor: bigint, rounding: Rounding): bigint {
  if (divisor <= ZERO) unavailable()
  const quotient = value / divisor
  const remainder = value % divisor
  return (
    quotient +
    (rounding === 'ceil' && remainder > ZERO ? ONE : ZERO) -
    (rounding === 'floor' && remainder < ZERO ? ONE : ZERO)
  )
}

/** Decimal/scientific notation; finer liabilities round UP to one nano-USD. */
export function parseUsd(value: number | string, rounding: Rounding = 'ceil'): Usd {
  if (String(value).length > MAX_DECIMAL_LENGTH) unavailable()
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (match === null) unavailable()
  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_LENGTH) unavailable()
  const coefficient = BigInt(`${match[1] ?? ''}${fraction}`)
  // Length/exponent bounds above keep both coefficient and powers bounded.
  if (coefficient === ZERO) return ZERO
  const shift = NANO_USD_DECIMALS + exponent - fraction.length
  const result =
    shift >= 0
      ? coefficient * DECIMAL_RADIX ** BigInt(shift)
      : divide(coefficient, DECIMAL_RADIX ** BigInt(-shift), rounding)
  if (result > MAX_USD) unavailable()
  return result
}

export function sumUsd(values: readonly Usd[]): Usd {
  return values.reduce((sum, value) => sum + value, ZERO)
}

export function subtractUsd(left: Usd, right: Usd): Usd {
  return left - right
}

/** A rational multiplier; a fractional nano-USD charge rounds up. */
export function multiplyUsd(
  value: Usd,
  numerator: bigint,
  denominator = ONE,
  rounding: Rounding = 'ceil',
): Usd {
  return divide(value * numerator, denominator, rounding)
}

export function compareUsd(left: Usd, right: Usd): -1 | 0 | 1 {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Canonical decimal for persistence or an existing numeric output boundary. */
export function usdDecimal(value: Usd): string {
  const absolute = value < ZERO ? -value : value
  const fraction = (absolute % NANO_USD_SCALE)
    .toString()
    .padStart(NANO_USD_DECIMALS, '0')
    .replace(/0+$/, '')
  return `${value < ZERO ? '-' : ''}${String(absolute / NANO_USD_SCALE)}${fraction === '' ? '' : `.${fraction}`}`
}

/** Compatibility output only: never use this result for further arithmetic. */
export function usdNumber(value: Usd): number {
  if (value < ZERO || value > MAX_USD) unavailable()
  return Number(usdDecimal(value))
}

/** Localized ceiling display, keeping at least two significant sub-cent digits. */
export function formatUsd(value: Usd, fractionDigits?: number): string {
  if (value < ZERO) unavailable()
  let digits = fractionDigits ?? (value >= NANO_USD_SCALE ? 2 : SMALL_DISPLAY_DECIMALS)
  while (
    fractionDigits === undefined &&
    value > ZERO &&
    value < DECIMAL_RADIX ** BigInt(NANO_USD_DECIMALS - digits + 1) &&
    digits < NANO_USD_DECIMALS
  )
    digits++
  if (!Number.isSafeInteger(digits) || digits < 0 || digits > NANO_USD_DECIMALS) unavailable()
  const quantum = DECIMAL_RADIX ** BigInt(NANO_USD_DECIMALS - digits)
  const rounded = divide(value, quantum, 'ceil') * quantum
  const fraction = (rounded % NANO_USD_SCALE) / quantum
  const formatter = new Intl.NumberFormat(uiLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  const localizedFraction = new Intl.NumberFormat(uiLocale(), {
    useGrouping: false,
    minimumIntegerDigits: digits || 1,
  }).format(fraction)
  return formatter
    .formatToParts(rounded / NANO_USD_SCALE)
    .map((part) => (part.type === 'fraction' ? localizedFraction : part.value))
    .join('')
}
