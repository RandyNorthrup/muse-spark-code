import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { VAULT_LIMITS, VAULT_TOTP_DIGITS } from '../../../shared/constants'

// RFC 4226/6238 encoding constants, not user tunables.
const COUNTER_BYTES = 8
const OFFSET_MASK = 0x0f
const SIGN_MASK = 0x7f_ff_ff_ff
const DECIMAL_RADIX = 10
const BASE32_BITS = 5
const BYTE_BITS = 8
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const WEB_TOTP_PERIOD_SECONDS = 30
const MILLIS_PER_SECOND = 1000

export interface TotpOptions {
  readonly algorithm: 'sha1' | 'sha256' | 'sha512'
  readonly digits: (typeof VAULT_TOTP_DIGITS)[keyof typeof VAULT_TOTP_DIGITS]
  readonly periodSeconds: number
}

/** Raw seed bytes stay in the broker. The caller owns and erases the returned code. */
export function totpCode(
  seed: Uint8Array,
  nowMs: number,
  options: TotpOptions,
): Buffer<ArrayBuffer> {
  if (
    seed.byteLength === 0 ||
    seed.byteLength > VAULT_LIMITS.valueBytes ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(options.periodSeconds) ||
    options.periodSeconds <= 0 ||
    !['sha1', 'sha256', 'sha512'].includes(options.algorithm) ||
    ![VAULT_TOTP_DIGITS.standard, VAULT_TOTP_DIGITS.extended].includes(options.digits)
  )
    throw new Error('invalidTotp')
  const key = Buffer.alloc(seed.byteLength)
  key.set(seed)
  const counter = Buffer.alloc(COUNTER_BYTES)
  let digest: Buffer | undefined
  try {
    counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / MILLIS_PER_SECOND / options.periodSeconds)))
    digest = createHmac(options.algorithm, key).update(counter).digest()
    const offset = (digest.at(-1) ?? 0) & OFFSET_MASK
    const truncated = digest.readUInt32BE(offset) & SIGN_MASK
    const text = String(truncated % DECIMAL_RADIX ** options.digits).padStart(options.digits, '0')
    const code = Buffer.alloc(options.digits)
    code.write(text, 'ascii')
    return code
  } finally {
    key.fill(0)
    counter.fill(0)
    digest?.fill(0)
  }
}

/** Strict RFC 4648 base32: rejects noncanonical trailing bits and incorrect padding. */
export function decodeTotpSeed(text: string): Buffer<ArrayBuffer> {
  const normalized = text.toUpperCase()
  const body = normalized.replace(/=+$/u, '')
  if (!/^[A-Z2-7]+={0,6}$/u.test(normalized) || body.length > VAULT_LIMITS.text)
    throw new Error('invalidTotp')
  const output = Buffer.alloc(Math.floor((body.length * BASE32_BITS) / BYTE_BITS))
  let bits = 0
  let accumulator = 0
  let index = 0
  try {
    for (const letter of body) {
      accumulator = (accumulator << BASE32_BITS) | BASE32_ALPHABET.indexOf(letter)
      bits += BASE32_BITS
      if (!(bits >= BYTE_BITS)) {
        continue
      }

      bits -= BYTE_BITS
      output[index++] = accumulator >>> bits
      accumulator &= (1 << bits) - 1
    }
    const encodedLength = Math.ceil((output.byteLength * BYTE_BITS) / BASE32_BITS)
    const paddedLength = Math.ceil(body.length / BYTE_BITS) * BYTE_BITS
    const isBadPadding = normalized.length !== body.length && normalized.length !== paddedLength
    if (isBadPadding || accumulator !== 0 || output.length === 0 || encodedLength !== body.length)
      throw new Error('invalidTotp')
    return output
  } catch {
    output.fill(0)
    throw new Error('invalidTotp')
  }
}
