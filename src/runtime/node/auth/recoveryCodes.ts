// Recovery codes (M110e lane A2, D90.11): single-use fallbacks for a lost
// second factor. The node keeps only hashes (M109 holds them as vault
// items once it lands); each code burns on use. The alphabet skips
// lookalikes, and the shape is four groups of four.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const RECOVERY_BYTES = 16
const RECOVERY_GROUPS = 4
const RECOVERY_GROUP_CHARS = 4
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export interface RecoveryCodeBook {
  /** The codes, shown once at enrollment and never stored. */
  readonly codes: readonly string[]
  /** What the node keeps: one SHA-256 hash per unburned code. */
  readonly hashes: readonly string[]
}

function formatRecoveryCode(raw: Uint8Array): string {
  const chars = [...raw].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length] ?? 'a')
  const groups: string[] = []
  for (let group = 0; group < RECOVERY_GROUPS; group += 1) {
    groups.push(
      chars.slice(group * RECOVERY_GROUP_CHARS, (group + 1) * RECOVERY_GROUP_CHARS).join(''),
    )
  }
  return groups.join('-')
}

function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase(), 'utf8').digest('base64')
}

export function createRecoveryCodes(count: number): RecoveryCodeBook {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('enrollment makes whole codes')
  const codes: string[] = []
  for (let made = 0; made < count; made += 1) {
    codes.push(formatRecoveryCode(randomBytes(RECOVERY_BYTES)))
  }
  return { codes, hashes: codes.map((code) => hashRecoveryCode(code)) }
}

/** Burn one code: the hash leaves the book, or the code is refused. */
export function redeemRecoveryCode(hashes: readonly string[], code: string): readonly string[] {
  const wanted = Buffer.from(hashRecoveryCode(code), 'base64')
  const kept = hashes.filter((hash) => {
    const candidate = Buffer.from(hash, 'base64')
    return candidate.length !== wanted.length || !timingSafeEqual(candidate, wanted)
  })
  if (kept.length === hashes.length) throw new Error('this recovery code is wrong or spent')
  return kept
}
