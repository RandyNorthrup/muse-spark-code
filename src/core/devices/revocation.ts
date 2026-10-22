// Subtract-only revocation (M110d lane X2, D90.9): a revocation is an
// append to a hash-chained list, each entry MACed under the pair key, so a
// dropped or reordered entry breaks the chain. There is no removal, and a
// device takes an update only when it extends what it accepted.
// Merging two lists unions them.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'

const PAIR_KEY_BYTES = 32
const SHA256_HEX_CHARS = 64

export const revocationEntrySchema = z.strictObject({
  keyId: z.string().check(z.minLength(1)),
  version: z.int().check(z.gte(1)),
  mac: z.string().check(z.minLength(1)),
  chain: z.string().check(z.minLength(SHA256_HEX_CHARS), z.maxLength(SHA256_HEX_CHARS)),
})
export type RevocationEntry = z.infer<typeof revocationEntrySchema>

export const revocationListSchema = z.strictObject({
  entries: z.array(revocationEntrySchema),
})
export type RevocationList = z.infer<typeof revocationListSchema>

function entryMac(pairKey: Uint8Array, keyId: string, version: number): string {
  return createHmac('sha256', pairKey)
    .update(`${String(version)}:${keyId}`)
    .digest('base64')
}

function entryChain(previous: string, keyId: string, version: number, mac: string): string {
  return createHash('sha256')
    .update(`${previous}|${String(version)}:${keyId}:${mac}`)
    .digest('hex')
}

function checkedKey(pairKey: Uint8Array): Uint8Array {
  if (pairKey.length !== PAIR_KEY_BYTES) throw new Error('the pair key is 32 bytes')
  return pairKey
}

/** The empty list: its chain starts from the pair key's own digest. */
export function emptyRevocationList(pairKey: Uint8Array): RevocationList {
  checkedKey(pairKey)
  return { entries: [] }
}

function chainHead(pairKey: Uint8Array, entries: readonly RevocationEntry[]): string {
  if (entries.length === 0) return createHash('sha256').update(checkedKey(pairKey)).digest('hex')
  const last = entries.at(-1)
  if (last === undefined) throw new Error('revocation entries end without a head')
  return last.chain
}

function isEntryMacValid(key: Uint8Array, entry: RevocationEntry): boolean {
  const actual = Buffer.from(entry.mac, 'base64')
  const wanted = Buffer.from(entryMac(key, entry.keyId, entry.version), 'base64')
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

/** True only when every MAC holds and the chain links without a gap. */
export function isRevocationListValid(list: RevocationList, pairKey: Uint8Array): boolean {
  const parsed = revocationListSchema.parse(list)
  const key = checkedKey(pairKey)
  let previous = createHash('sha256').update(key).digest('hex')
  for (const [index, entry] of parsed.entries.entries()) {
    if (
      entry.version !== index + 1 ||
      !isEntryMacValid(key, entry) ||
      entry.chain !== entryChain(previous, entry.keyId, entry.version, entry.mac)
    )
      return false
    previous = entry.chain
  }
  return true
}

/** Append one revocation. Revoking twice keeps the first entry. */
export function revokeKey(
  list: RevocationList,
  pairKey: Uint8Array,
  keyId: string,
): RevocationList {
  if (!isRevocationListValid(list, pairKey)) throw new Error('revocation list fails verification')
  if (list.entries.some((entry) => entry.keyId === keyId)) return list
  const version = list.entries.length + 1
  const mac = entryMac(checkedKey(pairKey), keyId, version)
  const chain = entryChain(chainHead(pairKey, list.entries), keyId, version, mac)
  const entry = revocationEntrySchema.parse({ keyId, version, mac, chain })
  return { entries: [...list.entries, entry] }
}

/** Membership on a verified list; an unverified list throws, never answers. */
export function isKeyRevoked(list: RevocationList, pairKey: Uint8Array, keyId: string): boolean {
  if (!isRevocationListValid(list, pairKey)) throw new Error('revocation list fails verification')
  return revocationListSchema.parse(list).entries.some((entry) => entry.keyId === keyId)
}

/* True when the candidate extends what this device accepted: both verify,
 * and every accepted entry stands first, in order. A shorter or reordered
 * candidate is not an update and fails closed. */
export function isRevocationListExtension(
  accepted: RevocationList,
  candidate: RevocationList,
  pairKey: Uint8Array,
): boolean {
  return (
    isRevocationListValid(accepted, pairKey) &&
    isRevocationListValid(candidate, pairKey) &&
    candidate.entries.length >= accepted.entries.length &&
    accepted.entries.every((entry, index) => {
      const other = candidate.entries[index]
      return other?.keyId === entry.keyId && other.chain === entry.chain
    })
  )
}

/** Union by key id; either side's tampering refuses the whole merge. */
export function mergeRevocationLists(
  first: RevocationList,
  second: RevocationList,
  pairKey: Uint8Array,
): RevocationList {
  if (!isRevocationListValid(first, pairKey) || !isRevocationListValid(second, pairKey))
    throw new Error('revocation list fails verification')
  let merged = emptyRevocationList(pairKey)
  for (const entry of [...first.entries, ...second.entries])
    merged = revokeKey(merged, pairKey, entry.keyId)
  return merged
}
