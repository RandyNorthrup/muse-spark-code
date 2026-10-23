// Pairing invitations (M110d lane X2, D90.9): a single-use code bound to
// the node's fingerprint, redeemed once. Expiry is the person's own
// setting: an invitation without one stays open until it is used, and one
// with a past instant is already dead. The clock is a parameter, so the
// node's skew never silently extends a window.
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'

const INVITATION_CODE_BYTES = 16

export const invitationSchema = z.strictObject({
  code: z.string().check(z.minLength(1)),
  fingerprint: z.string().check(z.minLength(1)),
  issuedAt: z.int().check(z.gte(0)),
  expiresAt: z.optional(z.int().check(z.gte(0))),
  redeemed: z.boolean(),
})
export type PairingInvitation = z.infer<typeof invitationSchema>

export function createInvitation(options: {
  readonly fingerprint: string
  readonly now: number
  readonly expiresAt?: number
}): PairingInvitation {
  if (options.fingerprint.length === 0) throw new Error('an invitation binds to a fingerprint')
  if (options.expiresAt !== undefined && options.expiresAt <= options.now)
    throw new Error('an invitation cannot already be expired')
  return invitationSchema.parse({
    code: randomBytes(INVITATION_CODE_BYTES).toString('base64url'),
    fingerprint: options.fingerprint,
    issuedAt: options.now,
    expiresAt: options.expiresAt,
    redeemed: false,
  })
}

/** Redeem once: the same code, fingerprint and a live window, or a refusal. */
export function redeemInvitation(
  invitation: PairingInvitation,
  attempt: { readonly code: string; readonly fingerprint: string; readonly now: number },
): PairingInvitation {
  const parsed = invitationSchema.parse(invitation)
  if (parsed.redeemed) throw new Error('this invitation was already used')
  if (parsed.expiresAt !== undefined && attempt.now >= parsed.expiresAt)
    throw new Error('this invitation has expired')
  if (attempt.code !== parsed.code) throw new Error('this invitation code is wrong')
  if (attempt.fingerprint !== parsed.fingerprint)
    throw new Error('this invitation names another node')
  return { ...parsed, redeemed: true }
}
