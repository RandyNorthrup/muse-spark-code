// Passwords (M110e lane A2, D90.11): scrypt with recorded parameters
// (N=32768, r=8, p=1, 32-byte keys, 16-byte salts), stored as
// `scrypt$N$r$p$salt$hash`. Verification compares in constant time and
// says only that the password is wrong, never how.
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto'

const SCRYPT_N = 32_768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_BYTES = 32
const SCRYPT_SALT_BYTES = 16
const SCRYPT_MAXMEM_BYTES = 67_108_864
const SCRYPT_PARTS = 6

export function hashNodePassword(password: string): string {
  if (password.length === 0) throw new Error('a password is not empty')
  const salt = randomBytes(SCRYPT_SALT_BYTES).toString('base64')
  const hash = scryptSync(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM_BYTES,
  }).toString('base64')
  return `scrypt$${String(SCRYPT_N)}$${String(SCRYPT_R)}$${String(SCRYPT_P)}$${salt}$${hash}`
}

/** True only for the password this hash was made from. */
export function isNodePasswordValid(password: string, stored: string): boolean {
  const parts = stored.split('$', SCRYPT_PARTS)
  if (parts.length !== SCRYPT_PARTS || parts[0] !== 'scrypt') return false
  const [, nText, rText, pText, salt, hashText] = parts
  if (salt === undefined || hashText === undefined) return false
  const options = {
    N: Number(nText),
    r: Number(rText),
    p: Number(pText),
    maxmem: SCRYPT_MAXMEM_BYTES,
  }
  if (
    !Number.isSafeInteger(options.N) ||
    !Number.isSafeInteger(options.r) ||
    !Number.isSafeInteger(options.p)
  )
    return false
  const expected = Buffer.from(hashText, 'base64')
  const actual = scryptSync(password, salt, expected.length, options)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
