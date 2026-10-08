// Exact media prices load with the optional media surface, never chat startup.
import { Usd } from '../usd'
import { formatUsdAtPrecision } from './text'

export function formatExactUsd(amount: number | string | Usd, fractionDigits = 2): string {
  const exact = amount instanceof Usd ? amount : Usd.from(amount)
  const decimal = exact.toString()
  const leadingZeros = /^0\.(0*)[1-9]/.exec(decimal)?.[1]?.length
  const precision = Math.max(
    fractionDigits,
    leadingZeros === undefined || leadingZeros < 2 ? 0 : leadingZeros + 2,
  )
  return formatUsdAtPrecision(exact, precision)
}
