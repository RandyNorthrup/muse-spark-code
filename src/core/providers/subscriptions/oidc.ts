// Shared OIDC/OAuth mechanics for the subscription sign-ins (ChatGPT and
// Grok): loopback validation, JWT shapes, the provider-neutral claim
// checks and the token POST. Provider-specific failures stay with the
// callers: every helper either returns a value, answers a plain boolean,
// or raises the caller's own failure through the `invalid` callback it is
// given. Nonce binding stays with the callers: each flow binds its own.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { MILLISECONDS_PER_SECOND, OAUTH_CODE_TTL_MS } from '../../../shared/constants'

const nonempty = z.string().check(z.minLength(1))
const positive = z.number().check(z.gt(0))

/** A loopback OAuth callback URL, or undefined where it is not one. */
export function parseLoopbackCallbackUrl(value: string, callbackPath: string): URL | undefined {
  const parsed = z.url().safeParse(value)
  if (!parsed.success) return undefined
  const url = new URL(parsed.data)
  return url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '' ||
    Number(url.port) <= 0 ||
    url.pathname !== callbackPath ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
    ? undefined
    : url
}

const JWT_PART_COUNT = 3

/** A JWT's three parts, or undefined where the shape or signature charset fails. */
export function splitJwt(
  token: string,
): { readonly header: string; readonly claims: string; readonly signature: string } | undefined {
  const [header, claims, signature, extra] = token.split('.', JWT_PART_COUNT + 1)
  return header === undefined ||
    claims === undefined ||
    signature === undefined ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/u.test(signature)
    ? undefined
    : { header, claims, signature }
}

/**
One JWT part's JSON. Anything but well-formed JSON raises the caller's
own invalid-token failure; anything else is not the part and propagates.
*/
export function decodeJwtPart(value: string, invalid: () => never): unknown {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) invalid()
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    invalid()
  }
}

/** The identity claims every subscription issuer sends; the issuer is the caller's. */
export interface OidcClaims {
  /** Owner captures acdc0f60 / 577bc807 (0 + 1 attempts) include OIDC sub. */
  readonly sub?: string | undefined
  readonly iss: string
  readonly aud: string | readonly string[]
  readonly azp?: string | undefined
  readonly exp: number
  readonly nonce?: string | undefined
}

export function oidcClaimsSchema(issuer: string): z.ZodMiniType<OidcClaims> {
  return z.object({
    sub: z.optional(nonempty),
    iss: z.literal(issuer),
    aud: z.union([nonempty, z.array(nonempty).check(z.minLength(1))]),
    azp: z.optional(nonempty),
    exp: positive,
    nonce: z.optional(nonempty),
  })
}

/** The discovery key set's shape; each verifier selects its own key strictly. */
export interface OidcJsonWebKey {
  readonly kty: string
  readonly kid: string
  readonly crv?: string | undefined
  readonly x?: string | undefined
  readonly y?: string | undefined
  readonly n?: string | undefined
  readonly e?: string | undefined
  readonly alg?: string | undefined
  readonly use?: string | undefined
}

export interface OidcJwks {
  readonly keys: readonly OidcJsonWebKey[]
}

export function oidcJwksSchema(): z.ZodMiniType<OidcJwks> {
  return z.object({
    keys: z.array(
      z.object({
        kty: nonempty,
        kid: nonempty,
        crv: z.optional(nonempty),
        x: z.optional(nonempty),
        y: z.optional(nonempty),
        n: z.optional(nonempty),
        e: z.optional(nonempty),
        alg: z.optional(nonempty),
        use: z.optional(nonempty),
      }),
    ),
  })
}

/**
Whether the claims are live and addressed to this client: expiry,
audience and the authorizing party. Nonce binding is the caller's own
check beside this one.
*/
export function isOidcAudience(claims: OidcClaims, clientId: string, now: number): boolean {
  const audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
  return (
    Number.isFinite(now) &&
    claims.exp * MILLISECONDS_PER_SECOND > now &&
    audience.includes(clientId) &&
    (audience.length <= 1 || claims.azp === clientId) &&
    (claims.azp === undefined || claims.azp === clientId)
  )
}

/** The stored account identity: SHA-256 over the verified issuer and subject. */
export function oidcAccountHash(issuer: string, subject: string): string {
  return createHash('sha256').update(`${issuer}\0${subject}`).digest('hex')
}

/** Reject an impossible token validity: a defect in this app's own caller, never the provider. */
export function checkMinimumValidity(minimumValidityMs: number): void {
  if (!Number.isFinite(minimumValidityMs) || minimumValidityMs < 0) {
    throw new RangeError('minimumValidityMs')
  }
}

/** Whether the request URL names the model origin with no embedded identity. */
export function isSameOriginRequest(requestUrl: string, origin: string): boolean {
  const request = z.url().safeParse(requestUrl)
  if (!request.success) return false
  const url = new URL(request.data)
  return url.origin === origin && url.username === '' && url.password === ''
}

/**
One OAuth GET or form POST. Sending is shared; failures stay with the
caller, which names them with its own error class.
*/
export async function subscriptionRequest(
  send: typeof fetch,
  url: string,
  form?: URLSearchParams,
): Promise<Response> {
  return await send(url, {
    method: form === undefined ? 'GET' : 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(OAUTH_CODE_TTL_MS),
    ...(form !== undefined && {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    }),
  })
}
