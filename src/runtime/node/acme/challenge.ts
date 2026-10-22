// ACME answers (M110e lane A3, D90.11, RFC 8557): the key authorization
// this node offers for a challenge, and the digest it publishes for dns-01.
// The order flow against a real directory needs the owner's domain and
// server, which are the legs that wait; these answers are ready for it.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'

export const acmeChallengeSchema = z.strictObject({
  token: z.string().check(z.minLength(1)),
  thumbprint: z.string().check(z.minLength(1)),
})
export type AcmeChallenge = z.infer<typeof acmeChallengeSchema>

/** `token.thumbprint` (RFC 8557 §8.1): what http-01 serves as-is. */
export function acmeKeyAuthorization(challenge: AcmeChallenge): string {
  const parsed = acmeChallengeSchema.parse(challenge)
  return `${parsed.token}.${parsed.thumbprint}`
}

/** The dns-01 TXT value: base64url SHA-256 over the key authorization. */
export function acmeDns01Digest(challenge: AcmeChallenge): string {
  return createHash('sha256').update(acmeKeyAuthorization(challenge), 'utf8').digest('base64url')
}
