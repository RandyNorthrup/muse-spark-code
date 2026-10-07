import { NANO_USD_DECIMALS, NANO_USD_UNITS } from './constants'

const ZERO = 0n
const ONE = 1n

/** Parse the decimal amount without binary multiplication. Liability rounds up; caps down. */
export function usdToNanoUsd(value: number, rounding: 'up' | 'down' = 'up'): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error('USD_AMOUNT_INVALID')
  const [mantissa = '', exponent = '0'] = value.toString().split('e', 2)
  const [whole = '', fraction = ''] = mantissa.split('.', 2)
  const digits = BigInt(whole + fraction)
  const shift = NANO_USD_DECIMALS + Number(exponent) - fraction.length
  if (shift >= 0) return digits * BigInt(`1${'0'.repeat(shift)}`)
  const divisor = BigInt(`1${'0'.repeat(-shift)}`)
  const rounded = digits / divisor
  return rounding === 'up' && digits % divisor !== ZERO ? rounded + ONE : rounded
}

/** Public USD fields are a display projection; admission and accumulation use bigint. */
export function nanoUsdToUsd(value: bigint): number {
  const numeric = Number(value)
  if (value < ZERO || !Number.isSafeInteger(numeric)) throw new Error('USD_AMOUNT_INVALID')
  return numeric / NANO_USD_UNITS
}
