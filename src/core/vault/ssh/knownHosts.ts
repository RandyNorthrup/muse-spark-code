import { createHmac, timingSafeEqual } from 'node:crypto'
import { VAULT_LIMITS } from '../../../shared/constants'
import { parsePublicKey } from './keys'
import { sshFailure } from './wire'

const HASHED_PARTS = { length: 4 }.length
function foldedCharacters(text: string): readonly string[] {
  return (text.match(/[\s\S]/gu) ?? []).map((char) => {
    const upper = char.toUpperCase()
    // Uppercase first joins long s and final sigma. Multi-letter expansions
    // remain one original code point, preserving wildcard width.
    return upper.length === 1 ? upper.toLowerCase() : char.toLowerCase()
  })
}
function isPatternMatch(pattern: string, host: string): boolean {
  if (pattern.startsWith('|1|')) {
    const fields = pattern.split('|'),
      salt = Buffer.from(fields[2] ?? '', 'base64'),
      expected = Buffer.from(fields[3] ?? '', 'base64')
    const digest = createHmac('sha1', salt).update(host).digest()
    return (
      fields.length === HASHED_PARTS &&
      expected.length === digest.length &&
      timingSafeEqual(expected, digest)
    )
  }
  // Match glob tokens directly: regex metacharacters are literal, and a
  // wildcard never creates a regex with attacker-controlled backtracking.
  const tokens = foldedCharacters(pattern)
  const chars = foldedCharacters(host)
  let token = 0
  let char = 0
  let star = -1
  let restart = 0
  while (char < chars.length) {
    if (tokens[token] === '?' || tokens[token] === chars[char]) {
      token += 1
      char += 1
    } else if (tokens[token] === '*') {
      star = token
      token += 1
      restart = char
    } else if (star === -1) {
      return false
    } else {
      token = star + 1
      restart += 1
      char = restart
    }
  }
  while (tokens[token] === '*') token += 1
  return token === tokens.length
}
function isEntryMatch(patterns: string, host: string): boolean {
  let hasMatch = false
  for (const pattern of patterns.split(',')) {
    if (pattern.startsWith('!')) {
      if (isPatternMatch(pattern.slice(1), host)) return false
    } else if (isPatternMatch(pattern, host)) hasMatch = true
  }
  return hasMatch
}
/** Text comes only from the user's selected known_hosts files, never a model/tool response. */
export function resolveKnownHost(text: string, blob: Buffer, expectedHost?: string): string {
  if (Buffer.byteLength(text) > VAULT_LIMITS.frameBytes) throw sshFailure()
  parsePublicKey(blob)
  const candidates = new Set<string>(),
    entries: { names: string; key: Buffer; revoked: boolean }[] = []
  for (const line of text.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u)
    if (!fields[0] || fields[0].startsWith('#')) continue
    const marker = fields[0].startsWith('@') ? fields.shift() : undefined
    if (marker && marker !== '@revoked') continue // CA/certificate verification is not guessed.
    const [names, algorithm, encoded] = fields
    if (!names || !algorithm || !encoded) continue
    const key = Buffer.from(encoded, 'base64')
    try {
      if (parsePublicKey(key).algorithm !== algorithm) continue
    } catch {
      continue
    }
    entries.push({ names, key, revoked: marker === '@revoked' })
    if (marker === undefined && key.equals(blob))
      for (const host of names.split(','))
        if (!/[!*?|]/u.test(host)) candidates.add(host.toLowerCase())
  }
  if (expectedHost) {
    if (expectedHost.length > VAULT_LIMITS.text || /[\s\0\\]/u.test(expectedHost))
      throw sshFailure()
    candidates.clear()
    candidates.add(expectedHost.toLowerCase())
  }
  const allowed = [...candidates].filter(
    (host) =>
      entries.every(
        (entry) => !(entry.revoked && entry.key.equals(blob) && isEntryMatch(entry.names, host)),
      ) &&
      entries.some(
        (entry) => !entry.revoked && entry.key.equals(blob) && isEntryMatch(entry.names, host),
      ),
  )
  // A reused host key/ambiguous alias is not proof of which name the client chose.
  if (allowed.length !== 1 || !allowed[0]) throw sshFailure()
  return allowed[0]
}

export interface SshKnownHostsPort {
  /** Re-read at each signature; resolve hashed/wildcard entries using a trusted launch destination. */
  read(): Promise<string>
}
