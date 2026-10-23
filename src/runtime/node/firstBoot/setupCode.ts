// M110os OS3: the one-time setup code. The console shows it (and its QR),
// the browser setup asks for it, and nothing but the setup page is served
// before it. It is single use and expires on use, on setup completion, or
// on reboot (it lives in memory and as a hash in the owner-only store):
// there is no wall-clock lifetime of ours (PLAN.md D121, D208).
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Crockford's alphabet without I, L, O and U: nothing ambiguous to type. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_CHARS = 20
const CODE_GROUP = 5

/** Issue a code of 100 bits, grouped for typing: `XXXXX-XXXXX-XXXXX-XXXXX`. */
export function issueSetupCode(): string {
  const bytes = randomBytes(CODE_CHARS)
  let flat = ''
  for (const byte of bytes) {
    const char = CODE_ALPHABET[byte % CODE_ALPHABET.length]
    if (char === undefined) throw new Error('setup code alphabet exhausted')
    flat += char
  }
  const groups: string[] = []
  for (let at = 0; at < flat.length; at += CODE_GROUP) groups.push(flat.slice(at, at + CODE_GROUP))
  return groups.join('-')
}

/** Normalize a typed code: case and separators do not matter. */
export function normalizeSetupCode(candidate: string): string {
  return candidate.replaceAll(/[\s-]+/gu, '').toUpperCase()
}

/**
Whether a typed code matches the issued one. Lengths that differ cannot
match (the format is fixed); equal lengths compare in constant time.
*/
export function isSetupCode(candidate: string, issued: string): boolean {
  const left = normalizeSetupCode(candidate)
  const right = normalizeSetupCode(issued)
  return (
    left.length === CODE_CHARS &&
    right.length === CODE_CHARS &&
    timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  )
}
