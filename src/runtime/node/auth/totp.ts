// One-time codes (M110e lane A2, D90.11): TOTP per RFC 6238, over the
// authenticator secret the sign-in enrolled. Digits, step and window ride
// with the caller's own settings: the core takes them as parameters and
// keeps no default of ours. The clock is a parameter too, so skew is the
// caller's verdict, never a silent stretch.
import { createHmac } from 'node:crypto'

const BASE32_BITS = 5
const BYTE_BITS = 8
const BYTE_MASK = 0xff
const BASE32_LETTER_A = 0x41
const BASE32_LETTER_Z = 0x5a
const BASE32_DIGIT_2 = 0x32
const BASE32_DIGIT_7 = 0x37
const BASE32_DIGIT_OFFSET = 26
const TOTP_HMAC_BYTES = 20
const TOTP_DYNAMIC_MASK = 0x0f
const TOTP_CODE_MASK = 0x7f_ff_ff_ff
const DECIMAL = 10

function base32Value(character: string): number | undefined {
  const code = character.codePointAt(0)
  if (code === undefined) return undefined
  if (code >= BASE32_LETTER_A && code <= BASE32_LETTER_Z) return code - BASE32_LETTER_A
  return code >= BASE32_DIGIT_2 && code <= BASE32_DIGIT_7
    ? code - BASE32_DIGIT_2 + BASE32_DIGIT_OFFSET
    : undefined
}

/** RFC 4648 base32, upper case without padding, or undefined when malformed. */
export function decodeTotpSecret(secret: string): Uint8Array | undefined {
  const text = secret.replaceAll('=', '').toUpperCase()
  if (text.length === 0) return undefined
  let bits = 0
  let width = 0
  const out: number[] = []
  for (const character of text) {
    const value = base32Value(character)
    if (value === undefined) return undefined
    bits = (bits << BASE32_BITS) | value
    width += BASE32_BITS
    while (width >= BYTE_BITS) {
      width -= BYTE_BITS
      out.push((bits >>> width) & BYTE_MASK)
    }
  }
  return Uint8Array.from(out)
}

function hotp(secret: Uint8Array, counter: bigint, digits: number): string {
  const message = Buffer.alloc(BYTE_BITS)
  message.writeBigUInt64BE(counter)
  const mac = createHmac('sha1', secret).update(message).digest()
  if (mac.length !== TOTP_HMAC_BYTES) throw new Error('TOTP signs with SHA-1')
  const offset = (mac.at(-1) ?? 0) & TOTP_DYNAMIC_MASK
  const code = mac.readUInt32BE(offset) & TOTP_CODE_MASK
  return String(code % DECIMAL ** digits).padStart(digits, '0')
}

export interface TotpSettings {
  readonly digits: number
  readonly stepSeconds: number
  readonly windowSteps: number
}

/** True when the code matches this step or one the window beside it allows. */
export function isTotpCodeValid(
  secret: string,
  code: string,
  nowSeconds: number,
  settings: TotpSettings,
): boolean {
  if (
    !Number.isSafeInteger(settings.digits) ||
    settings.digits < 1 ||
    !Number.isSafeInteger(settings.stepSeconds) ||
    settings.stepSeconds < 1 ||
    !Number.isSafeInteger(settings.windowSteps) ||
    settings.windowSteps < 0
  )
    throw new Error('TOTP settings are whole positive numbers')
  const key = decodeTotpSecret(secret)
  if (key === undefined || !/^\d+$/.test(code) || code.length !== settings.digits) return false
  const step = Math.floor(nowSeconds / settings.stepSeconds)
  for (let delta = -settings.windowSteps; delta <= settings.windowSteps; delta += 1) {
    if (step + delta < 0) continue
    if (hotp(key, BigInt(step + delta), settings.digits) === code) return true
  }
  return false
}
