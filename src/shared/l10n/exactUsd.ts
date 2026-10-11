// Exact US dollar display (CAPS017): the exact formatter and the media
// prices load with the surfaces that show money, never through l10n/text.ts,
// so a startup graph that installs the language carries no USD arithmetic.
import { Usd } from '../usd'
import { numberFormat } from './text'

/** An amount of US dollars as the language writes money: $1.46 / 1,46 $ / US$1.46. */
export function formatUsd(
  amount: number | string | Usd,
  fractionDigits = 2,
  digitsOrRounding?: number | 'halfExpand' | 'ceil',
): string {
  if (digitsOrRounding !== undefined) {
    return formatUsdIntl(
      typeof amount === 'string' || amount instanceof Usd ? Number(amount.toString()) : amount,
      fractionDigits,
      digitsOrRounding,
    )
  }
  const exact = amount instanceof Usd ? amount : Usd.from(amount)
  const leadingZeros = /^0\.(0*)[1-9]/.exec(exact.toString())?.[1]?.length
  const precision = Math.max(
    fractionDigits,
    leadingZeros === undefined || leadingZeros < 2 ? 0 : leadingZeros + 2,
  )
  return formatUsdAtPrecision(exact, precision)
}

/** An explicit maximum or rounding mode: Intl formats the number, small amounts in scientific. */
function formatUsdIntl(
  amount: number,
  fractionDigits: number,
  digitsOrRounding: number | 'halfExpand' | 'ceil',
): string {
  const maximumFractionDigits =
    typeof digitsOrRounding === 'number' ? digitsOrRounding : fractionDigits
  const roundingMode = typeof digitsOrRounding === 'number' ? 'halfExpand' : digitsOrRounding
  const notation =
    maximumFractionDigits > fractionDigits &&
    amount > 0 &&
    amount < Number(`1e-${String(maximumFractionDigits)}`)
      ? 'scientific'
      : 'standard'
  return numberFormat(
    `usd:${String(fractionDigits)}:${String(maximumFractionDigits)}:${notation}:${roundingMode}`,
    {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits,
      notation,
      roundingMode,
    },
  ).format(amount)
}

/**
 * A verified quote's chosen precision, without changing its exact amount:
 * in the installed language, or in `locale` when a report renders for its own.
 */
export function formatUsdAtPrecision(exact: Usd, precision: number, locale?: string): string {
  const rounded = exact.ceiling(precision).toString()
  const [whole = '0', fraction = ''] = rounded.split('.', 2)
  const currency: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }
  const plain: Intl.NumberFormatOptions = { useGrouping: false }
  const formatter =
    locale === undefined
      ? numberFormat(`usd:${String(precision)}`, currency)
      : new Intl.NumberFormat(locale, currency)
  const digitFormat =
    locale === undefined ? numberFormat('digit', plain) : new Intl.NumberFormat(locale, plain)
  // Intl accepts bigint exactly; substitute the exact fractional digits in its locale pattern.
  const digits = fraction
    .padEnd(precision, '0')
    .replaceAll(/\d/g, (digit) => digitFormat.format(Number(digit)))
  return formatter
    .formatToParts(BigInt(whole))
    .map((part) => (part.type === 'fraction' ? digits : part.value))
    .join('')
}
