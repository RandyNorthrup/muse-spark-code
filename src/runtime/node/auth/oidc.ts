// Sign-in with the person's identity provider (M110e lane A2, D90.11):
// OIDC with PKCE (RFC 7636 + OpenID Connect Core). This core builds the
// PKCE pair and the authorization URL and checks the state echo; the token
// exchange and userinfo need the person's provider, which is the leg that
// waits on their choice.
import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'

const PKCE_VERIFIER_BYTES = 32
const PKCE_VERIFIER_MIN = 43
const PKCE_VERIFIER_MAX = 128

export const pkcePairSchema = z.strictObject({
  verifier: z.string().check(z.minLength(PKCE_VERIFIER_MIN), z.maxLength(PKCE_VERIFIER_MAX)),
  challenge: z.string().check(z.minLength(1)),
})
export type PkcePair = z.infer<typeof pkcePairSchema>

function base64Url(raw: Uint8Array): string {
  return Buffer.from(raw).toString('base64url')
}

/** A fresh verifier and its S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(PKCE_VERIFIER_BYTES))
  return pkcePairSchema.parse({
    verifier,
    challenge: base64Url(createHash('sha256').update(verifier, 'utf8').digest()),
  })
}

/** The S256 challenge for a known verifier (RFC 7636's own check). */
export function pkceChallengeOf(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'utf8').digest())
}

export const oidcAuthorizationSchema = z.strictObject({
  issuer: z.string().check(z.minLength(1)),
  clientId: z.string().check(z.minLength(1)),
  redirectUri: z.string().check(z.minLength(1)),
  state: z.string().check(z.minLength(1)),
  nonce: z.optional(z.string()),
})
export type OidcAuthorization = z.infer<typeof oidcAuthorizationSchema>

/** The authorization URL; the provider answers at the redirect URI. */
export function buildOidcAuthorizationUrl(
  authorization: OidcAuthorization,
  challenge: string,
): string {
  if (challenge.length === 0) throw new Error('an OIDC sign-in carries its PKCE challenge')
  const parsed = oidcAuthorizationSchema.parse(authorization)
  const url = new URL('/authorize', parsed.issuer)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', parsed.clientId)
  url.searchParams.set('redirect_uri', parsed.redirectUri)
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', parsed.state)
  if (parsed.nonce !== undefined) url.searchParams.set('nonce', parsed.nonce)
  return url.href
}

/** True only when the provider echoes the state this sign-in sent. */
export function isOidcStateValid(sent: string, echoed: string | undefined): boolean {
  return sent.length > 0 && echoed === sent
}
