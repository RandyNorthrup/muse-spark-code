// Exact media prices load with the optional media surface, never chat startup.
import { Usd } from '../usd'
import { uiLocale } from './text'

export function formatExactUsd(amount: number | string | Usd, fractionDigits = 2): string {
  const exact = amount instanceof Usd ? amount : Usd.from(amount)
  const decimal = exact.toString()
  const leadingZeros = /^0\.(0*)[1-9]/.exec(decimal)?.[1]?.length
  const precision = Math.max(
    fractionDigits,
    leadingZeros === undefined || leadingZeros < 2 ? 0 : leadingZeros + 2,
  )
  const rounded = exact.ceiling(precision).toString()
  const [whole = '0', fraction = ''] = rounded.split('.', 2)
  const formatter = new Intl.NumberFormat(uiLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
  // Intl accepts bigint exactly; substitute the exact fractional digits in its locale pattern.
  const digits = fraction
    .padEnd(precision, '0')
    .replaceAll(/\d/g, (digit) =>
      new Intl.NumberFormat(uiLocale(), { useGrouping: false }).format(Number(digit)),
    )
  return formatter
    .formatToParts(BigInt(whole))
    .map((part) => (part.type === 'fraction' ? digits : part.value))
    .join('')
}
