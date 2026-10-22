// Per-person scope (M110h lane M, D90.16): sandboxes, sign-in homes and
// vault namespaces that cannot cross. One person's sign-in, key or vault
// item is never used for another: the scoping check throws on any
// mismatch, and namespaces derive from the person id so two people never
// share one. The vault's own namespaces (M109) are the leg that waits.
import { createHmac } from 'node:crypto'
import * as z from 'zod/mini'

const PERSON_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export const personIdSchema = z.string().check(z.regex(PERSON_ID))
export type PersonId = z.infer<typeof personIdSchema>

/** The vault namespace id for this person: derived, never stored. */
export function derivePersonNamespace(person: string, nodeSecret: Uint8Array): string {
  if (nodeSecret.length === 0) throw new Error('namespaces derive from the node secret')
  const id = personIdSchema.parse(person)
  return createHmac('sha256', nodeSecret).update(`person-namespace:${id}`).digest('hex')
}

/** This person's sign-in home, under the node's homes root. */
export function personHomePath(person: string): string {
  const id = personIdSchema.parse(person)
  return `home/${id}`
}

/** This person's sandbox label, safe for the engine to carry. */
export function personSandboxLabel(person: string): string {
  const id = personIdSchema.parse(person)
  return `muse-person-${id}`
}

/* One person's credential never serves another: a mismatch throws. */
export function scopeCredentialUse(person: string, credentialOwner: string): void {
  const id = personIdSchema.parse(person)
  const owner = personIdSchema.parse(credentialOwner)
  if (id !== owner) throw new Error('this credential belongs to another person')
}
