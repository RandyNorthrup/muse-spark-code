// Boundary schemas stay small; exact arithmetic belongs to lazy paid consumers.
import * as z from 'zod/mini'

export const usdAmountSchema = z
  .string()
  .check(z.regex(/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/))
  .brand<'Usd'>()
export const nonnegativeUsdSchema = z
  .string()
  .check(z.regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/))
  .brand<'Usd'>()
export type UsdAmount = z.infer<typeof usdAmountSchema>

/** Expand finite legacy numbers and decimal input without binary arithmetic. */
function canonicalUsd(amount: number | string): UsdAmount {
  const [mantissa = '0', exponent = '0'] = String(amount).split(/e/i, 2)
  const [whole = '0', fraction = ''] = mantissa.split('.', 2)
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  const expanded =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : `${digits.padEnd(point, '0').slice(0, point)}.${digits.slice(point)}`
  const [integer = '0', decimals = ''] = expanded.split('.', 2)
  const normalizedWhole = integer.replace(/^0+(?=\d)/, '')
  const normalizedFraction = decimals.replace(/0+$/, '')
  return usdAmountSchema.parse(
    `${normalizedWhole}${normalizedFraction === '' ? '' : `.${normalizedFraction}`}`,
  )
}

export const usdInputSchema = z.pipe(
  z.string().check(z.regex(/^\d+(?:\.\d+)?$/)),
  z.transform((amount) => canonicalUsd(amount)),
)

/** Canonical strings are unchanged; historical numbers normalize once. */
export const legacyUsdSchema = z.pipe(
  z.union([z.number().check(z.nonnegative()), nonnegativeUsdSchema]),
  z.transform((amount) => canonicalUsd(amount)),
)
