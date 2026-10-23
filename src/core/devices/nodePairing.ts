// Pairing on a node (M110a P, PLAN.md D90.9): D80.1's public invitation as
// the node shows it — a QR on the web UI or the TUI, or its text —
// carrying the full fingerprint, with both sides confirming before any
// listener opens. This is the text's format, the fingerprint comparison,
// and unpair against the pair store. The short authentication string's
// commitment protocol, the identity keys and the invitation lifecycle
// are X2's (M110d); the QR rendering and the surfaces are A0's. The
// invitation payload below stays opaque for X2 to fill.

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'
import type { PairStore } from './roles'

const INVITATION_PREFIX = 'muse-pair'
const INVITATION_VERSION = 1
const INVITATION_PART_COUNT = 4
const FINGERPRINT_GROUP_CHARS = 4

const fingerprintSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/))
const payloadSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/), z.minLength(1))

/** A parsed invitation: the full fingerprint plus X2's opaque payload. */
export const invitationSchema = z.strictObject({
  version: z.literal(INVITATION_VERSION),
  fingerprint: fingerprintSchema,
  payload: payloadSchema,
})
export type Invitation = z.infer<typeof invitationSchema>

/** Format one invitation as the text the QR carries. */
export function formatInvitation(invitation: Invitation): string {
  return `${INVITATION_PREFIX}:${String(invitation.version)}:${invitation.fingerprint}:${invitation.payload}`
}

/**
Parse invitation text back: anything not exactly the current versioned
form is refused, never repaired. Remote bytes, so no throw: the verdict
says what it was.
*/
export function parseInvitation(text: string): Invitation | undefined {
  const parts = text.split(':')
  if (parts.length !== INVITATION_PART_COUNT || parts[0] !== INVITATION_PREFIX) return undefined
  const parsed = invitationSchema.safeParse({
    version: Number(parts[1]),
    fingerprint: parts[2],
    payload: parts[3],
  })
  return parsed.success ? parsed.data : undefined
}

/**
The canonical fingerprint form both sides show, so the person compares
the same text: lowercase hex in groups of four.
*/
export function formatFingerprint(fingerprint: string): string {
  const clean = fingerprint.trim().toLowerCase()
  const groups: string[] = []
  for (let index = 0; index < clean.length; index += FINGERPRINT_GROUP_CHARS) {
    groups.push(clean.slice(index, index + FINGERPRINT_GROUP_CHARS))
  }
  return groups.join(' ')
}

/**
Whether the fingerprint the person saw matches the channel's: grouping,
whitespace and case are ignored, anything not a full fingerprint is not
a match, and the comparison itself is constant time.
*/
function normalizeFingerprint(value: string): string {
  return value.replaceAll(/[\s:]/g, '').toLowerCase()
}

export function isFingerprintMatch(shown: string, channel: string): boolean {
  const first = normalizeFingerprint(shown)
  const second = normalizeFingerprint(channel)
  return (
    /^[0-9a-f]{64}$/.test(first) &&
    /^[0-9a-f]{64}$/.test(second) &&
    timingSafeEqual(Buffer.from(first, 'utf8'), Buffer.from(second, 'utf8'))
  )
}

/**
Unpair one pair from the store: durable on return. An empty pair id is a
caller bug; anything else answers whether the pair was there.
*/
export function unpair(store: PairStore, pairId: string): 'unpaired' | 'unknown-pair' {
  if (pairId.length === 0) throw new Error('unpair needs a pair id')
  return store.delete(pairId) ? 'unpaired' : 'unknown-pair'
}
