// RLGROKAUTH: Grok subscription sign-in core. Standard OIDC/OAuth against
// https://auth.x.ai, written from the published discovery document
// (fixture test/fixtures/grok/discovery.json, captured 2026-10-22; research
// docs/research/providers/xai-grok-oauth.md). xAI publishes no self-serve
// client registration, so this app's own client id (and, once xAI names
// one, its scope) comes from configuration; with none set every flow
// refuses before any request goes out. Never another application's client
// id or scope. Hosts supply the browser, the loopback callback, the
// device-code surface, the secret store and an inter-process lock.
import { createPublicKey, verify } from 'node:crypto'
import * as z from 'zod/mini'
import {
  CREDENTIAL_RECORD_VERSION,
  GROK_DEFAULT_SCOPES,
  GROK_DEVICE_DEFAULT_INTERVAL_S,
  GROK_DEVICE_GRANT_TYPE,
  GROK_DEVICE_SLOW_DOWN_STEP_S,
  MILLISECONDS_PER_SECOND,
  OAUTH_CODE_TTL_MS,
  PKCE_STATE_BYTES,
} from '../../../shared/constants'
import { failureCodeNames } from '../../networkFailure'
import { pkce } from '../../../host/backend/providersEntry'
import {
  checkMinimumValidity,
  isOidcAudience,
  decodeJwtPart,
  isSameOriginRequest,
  oidcAccountHash,
  oidcClaimsSchema,
  oidcJwksSchema,
  parseLoopbackCallbackUrl,
  splitJwt,
  subscriptionRequest,
} from './oidc'
const {
  createPkcePair,
  isPkceState,
  isPkceVerifier,
  pkceRandom,
  pkceChallenge: createChallenge,
} = pkce

const ISSUER = 'https://auth.x.ai'
const ORIGIN = 'https://api.x.ai'
/** The registrable domain's label count (`x.ai` in `auth.x.ai`). */
const DOMAIN_LABEL_COUNT = 2
const CALLBACK_PATH = '/auth/callback'
const DEVICE_CODE_GRANT = GROK_DEVICE_GRANT_TYPE

function invalidIdToken(): never {
  throw new GrokSignInError('invalid-id-token')
}

/** Technical failure codes, one per cause; hosts translate each into its own sentence. */
export class GrokSignInError extends Error {
  public constructor(
    public readonly code:
      | 'client-id-unset'
      | 'invalid-discovery'
      | 'invalid-callback'
      | 'callback-timeout'
      | 'authorize-refused'
      | 'invalid-state'
      | 'invalid-token'
      | 'invalid-id-token'
      | 'scope-refused'
      | 'origin-mismatch'
      | 'device-expired'
      | 'device-denied'
      | 'device-refused'
      | 'verification-refused'
      | 'not-signed-in'
      | 'still-signed-in'
      | 'sign-in-required'
      | 'expired'
      | 'grant-unreadable'
      | 'store-unavailable'
      | 'lock-unavailable'
      | 'lock-busy'
      | 'cancelled'
      | 'browser-unavailable'
      | 'local-failed'
      | 'providers-file-unreadable'
      | 'providers-file-unwritable'
      | 'already-added'
      | 'catalogue-refused'
      | 'catalogue-unreadable'
      | 'catalogue-empty'
      | 'added-models-unlisted'
      | 'model-not-added'
      | 'request-failed',
    /**
    A short technical word shown beside the sentence, never free provider
    text: the operating system's code (`lock-unavailable`, `local-failed`);
    xAI's own error code (`authorize-refused`, `device-refused`,
    `sign-in-required`); the HTTP status and code of a refused answer
    (`catalogue-refused`, `request-failed`); Node's network codes
    (`request-failed`); the model asked for (`model-not-added`); or this
    app's own word for why the providers file failed (`unparseable`,
    `invalid`, `io-error`).
    */
    public readonly reason?: string,
    /**
    The cause behind a translated failure, for debugging only; hosts show
    the code's sentence plus `reason`, never this chain.
    */
    options?: { readonly cause?: unknown },
  ) {
    super(`grok.${code}`, options)
    this.name = 'GrokSignInError'
  }
}

const nonempty = z.string().check(z.minLength(1))
const positive = z.number().check(z.gt(0))
const positiveInt = z.number().check(z.int(), z.positive())

const discoverySchema = z.object({
  issuer: z.literal(ISSUER),
  authorization_endpoint: z.literal(`${ISSUER}/oauth2/authorize`),
  device_authorization_endpoint: z.literal(`${ISSUER}/oauth2/device/code`),
  token_endpoint: z.literal(`${ISSUER}/oauth2/token`),
  revocation_endpoint: z.literal(`${ISSUER}/oauth2/revoke`),
  jwks_uri: z.url(),
  response_types_supported: z.array(z.string()).check(z.refine((kinds) => kinds.includes('code'))),
  id_token_signing_alg_values_supported: z
    .array(z.string())
    .check(z.refine((algs) => algs.includes('ES256'))),
  grant_types_supported: z
    .array(z.string())
    .check(
      z.refine(
        (grants) =>
          grants.includes('authorization_code') &&
          grants.includes('refresh_token') &&
          grants.includes(DEVICE_CODE_GRANT),
      ),
    ),
  code_challenge_methods_supported: z
    .array(z.string())
    .check(z.refine((methods) => methods.includes('S256'))),
})
type Discovery = z.infer<typeof discoverySchema>

const tokenSchema = z.object({
  access_token: nonempty,
  refresh_token: z.optional(nonempty),
  token_type: z.literal('Bearer'),
  expires_in: positive,
  id_token: z.optional(nonempty),
  scope: z.optional(nonempty),
})
type TokenAnswer = z.infer<typeof tokenSchema>

/** xAI's own error word on a token answer; only the code is ever read. */
const tokenErrorSchema = z.looseObject({ error: nonempty })
const deviceCodeSchema = z.looseObject({
  device_code: nonempty,
  user_code: nonempty,
  verification_uri: nonempty,
  verification_uri_complete: z.optional(nonempty),
  expires_in: positiveInt,
  interval: z.optional(positiveInt),
})
const accountHashSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/u))

/** Secret-store payload only. Never send this record across a UI bridge. */
export const grokRecordSchema = z.object({
  v: z.literal(CREDENTIAL_RECORD_VERSION),
  auth: z.literal('subscription'),
  origin: z.literal(ORIGIN),
  issuer: z.literal(ISSUER),
  clientId: nonempty,
  /** Hash of the verified OIDC subject; never the raw account id. */
  accountIdHash: z.optional(accountHashSchema),
  accessToken: nonempty,
  refreshToken: nonempty,
  expiresAt: positive,
  scope: nonempty,
  /** Browser grants carry their nonce; device grants have none to bind. */
  nonce: z.optional(nonempty),
  /** A replacement kept for recovery, never usable before verification. */
  pendingRefresh: z.optional(z.object({ idToken: z.optional(nonempty) })),
})
export type GrokRecord = z.infer<typeof grokRecordSchema>

function checked<T>(schema: z.ZodMiniType<T>, value: unknown, code: GrokSignInError['code']): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new GrokSignInError(code)
}

/** This app's own client id, or the refusal that says registration is pending. */
export function requireGrokClientId(configured: string | undefined): string {
  const clientId = configured?.trim() ?? ''
  if (clientId === '') throw new GrokSignInError('client-id-unset')
  return clientId
}

/**
The scopes one sign-in asks for: the configured ones, or pure OpenID while
xAI has named no app-specific scope. xAI's own reply is authoritative on
their syntax, so nothing further is checked here.
*/
export function resolveGrokScopes(configured: string | undefined): string {
  const scopes = configured?.trim() ?? ''
  return scopes === '' ? GROK_DEFAULT_SCOPES : scopes
}

function grantedScopes(granted: string, requested: string): void {
  const held = new Set(granted.split(/\s+/u).filter((scope) => scope !== ''))
  const hasMissing = requested
    .split(/\s+/u)
    .filter((scope) => scope !== '')
    .some((scope) => !held.has(scope))
  if (hasMissing) {
    throw new GrokSignInError('scope-refused')
  }
}

function callbackUrl(value: string): URL {
  const url = parseLoopbackCallbackUrl(value, CALLBACK_PATH)
  if (url === undefined) throw new GrokSignInError('invalid-callback')
  return url
}

/** xAI's own `error` code, echoed only in this opaque-token shape. */
const AUTHORIZE_ERROR_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u

function errorReason(value: unknown): string {
  const parsed = tokenErrorSchema.safeParse(value)
  const code = parsed.success ? parsed.data.error : ''
  if (!AUTHORIZE_ERROR_PATTERN.test(code)) throw new GrokSignInError('invalid-token')
  return code
}

/**
PKCE S256 against this app's own configured client. The loopback redirect
carries a random port (RFC 8252); xAI must allow loopback redirects for
the issued client. No identity of ours is sent.
*/
export function buildGrokAuthorizeUrl(options: {
  readonly redirectUri: string
  readonly clientId: string
  readonly scopes: string
  readonly verifier: string
  readonly state: string
  readonly nonce: string
}): string {
  const redirect = callbackUrl(options.redirectUri)
  const clientId = requireGrokClientId(options.clientId)
  const scopes = resolveGrokScopes(options.scopes)
  if (
    redirect.search !== '' ||
    !isPkceVerifier(options.verifier) ||
    !isPkceState(options.state) ||
    !isPkceState(options.nonce)
  ) {
    throw new GrokSignInError('invalid-callback')
  }
  const url = new URL(`${ISSUER}/oauth2/authorize`)
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect.href,
    scope: scopes,
    state: options.state,
    nonce: options.nonce,
    code_challenge: createChallenge(options.verifier),
    code_challenge_method: 'S256',
  }).toString()
  return url.href
}

/** The loopback core every host shares: one parse, one failure class. */
export interface GrokCallbackBinding {
  parse(url: string, redirectUri: string): void
  fail(
    code: 'invalid-callback' | 'callback-timeout' | 'cancelled' | 'local-failed',
    reason?: string,
    cause?: unknown,
  ): GrokSignInError
  isFailure(error: unknown): error is GrokSignInError
}

/** The loopback core every host shares, bound to one attempt's state. */
export function grokCallbackBinding(state: string): GrokCallbackBinding {
  return {
    parse: (url, redirectUri) => {
      parseGrokCallback(url, redirectUri, state)
    },
    fail: (code, reason?, cause?) => new GrokSignInError(code, reason, { cause }),
    isFailure: (error): error is GrokSignInError => error instanceof GrokSignInError,
  }
}

/**
Validate the captured callback fields. Only `code` and `state` decide;
anything else xAI names (its scope echo, RFC 9207's issuer) is let
through unread. `scope` may be absent: the token response's granted
scopes decide.
*/
export function parseGrokCallback(
  value: string,
  redirectUri: string,
  state: string,
): {
  readonly code: string
  readonly scope?: string | undefined
} {
  const url = callbackUrl(value)
  if (url.origin !== callbackUrl(redirectUri).origin) {
    throw new GrokSignInError('invalid-callback')
  }
  if (url.searchParams.has('error')) {
    if (!isPkceState(state) || url.searchParams.get('state') !== state) {
      throw new GrokSignInError('invalid-state')
    }
    const refusal = url.searchParams.get('error') ?? ''
    if (!AUTHORIZE_ERROR_PATTERN.test(refusal)) throw new GrokSignInError('invalid-callback')
    throw new GrokSignInError('authorize-refused', refusal)
  }
  for (const field of ['code', 'state']) {
    if (url.searchParams.getAll(field).length !== 1) {
      throw new GrokSignInError('invalid-callback')
    }
  }
  if (url.searchParams.getAll('scope').length > 1) throw new GrokSignInError('invalid-callback')
  if (!isPkceState(state) || url.searchParams.get('state') !== state) {
    throw new GrokSignInError('invalid-state')
  }
  return checked(
    z.object({ code: nonempty, scope: z.optional(nonempty) }),
    {
      code: url.searchParams.get('code'),
      scope: url.searchParams.get('scope') ?? undefined,
    },
    'invalid-callback',
  )
}

/** What the person is shown: the code to type, where, and until when. */
export interface GrokDevicePrompt {
  readonly userCode: string
  readonly verificationUri: string
  /** Epoch ms. */
  readonly expiresAt: number
}

/**
A user code as shown to the person: printable ASCII only, so a reply can
put neither terminal escapes nor markup on screen. xAI's code alphabet is
not published; anything outside this set is refused rather than shown,
and the first live sign-in settles the exact shape.
*/
const USER_CODE_PATTERN = /^[!-~]{1,128}$/u

function verificationAddress(candidate: string): URL {
  const parsed = z.url().safeParse(candidate)
  if (!parsed.success) throw new GrokSignInError('verification-refused')
  const url = new URL(parsed.data)
  // The person types the user code at this address, so only xAI's own
  // domain may receive it: the issuer's host or one of its subdomains.
  // The exact host is pinned from the first live sign-in (owner present);
  // a foreign or lookalike host refuses rather than being shown.
  const issuerHost = new URL(ISSUER).hostname
  const domain = issuerHost.split('.').slice(-DOMAIN_LABEL_COUNT).join('.')
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) ||
    url.username !== '' ||
    url.password !== ''
  )
    throw new GrokSignInError('verification-refused')
  return url
}

export interface GrokDeviceCode {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  /** Epoch ms. */
  readonly expiresAt: number
  /** Seconds between polls. */
  readonly intervalS: number
}

/** Parse one device-code reply; a malformed or unshowable reply is refused. */
export function parseGrokDeviceCode(value: unknown, now: number): GrokDeviceCode {
  const reply = checked(deviceCodeSchema, value, 'invalid-token')
  if (!USER_CODE_PATTERN.test(reply.user_code)) throw new GrokSignInError('invalid-token')
  // RFC 8628's complete address carries the code, so no typing is needed;
  // where xAI sends none, the plain address plus the code is shown.
  let address: URL | undefined
  if (reply.verification_uri_complete !== undefined) {
    try {
      address = verificationAddress(reply.verification_uri_complete)
    } catch (error) {
      // Only an unshowable complete address falls back to the plain one;
      // anything else is not this address's answer to give.
      if (!(error instanceof GrokSignInError) || error.code !== 'verification-refused') throw error
    }
  }
  address ??= verificationAddress(reply.verification_uri)
  return {
    deviceCode: reply.device_code,
    userCode: reply.user_code,
    verificationUri: address.href,
    expiresAt: now + reply.expires_in * MILLISECONDS_PER_SECOND,
    intervalS: reply.interval ?? GROK_DEVICE_DEFAULT_INTERVAL_S,
  }
}

const jwtHeaderSchema = z.object({ alg: z.literal('ES256'), kid: nonempty })

/**
The stored account identity: the product's SHA-256 over the verified
issuer and subject. Raw identity claims never leave this derivation.
*/
export function grokAccountIdHash(issuer: string, subject: string): string {
  return oidcAccountHash(issuer, subject)
}

/**
Verify one ES256 identity token against the discovery JWKS. A browser
grant binds its nonce, on the first answer and on every refresh (which
may omit it but never change it); a device grant carries none to check.
Returns only a hash after verification; raw identity claims stay in
this function.
*/
export function verifyGrokIdToken(options: {
  readonly token: string
  readonly jwks: unknown
  readonly clientId: string
  readonly expectedNonce: string | undefined
  /** OIDC permits a refresh ID token to omit the original nonce, never to change it. */
  readonly isRefresh?: boolean
  readonly now: number
}): string | undefined {
  const parts = splitJwt(options.token)
  if (parts === undefined) {
    throw new GrokSignInError('invalid-id-token')
  }
  const header = checked(
    jwtHeaderSchema,
    decodeJwtPart(parts.header, invalidIdToken),
    'invalid-id-token',
  )
  const claims = checked(
    oidcClaimsSchema(ISSUER),
    decodeJwtPart(parts.claims, invalidIdToken),
    'invalid-id-token',
  )
  const jwks = checked(oidcJwksSchema(), options.jwks, 'invalid-id-token')
  if (!isOidcAudience(claims, options.clientId, options.now)) {
    throw new GrokSignInError('invalid-id-token')
  }
  if (
    options.expectedNonce !== undefined &&
    (claims.nonce === undefined
      ? options.isRefresh !== true
      : claims.nonce !== options.expectedNonce)
  ) {
    throw new GrokSignInError('invalid-id-token')
  }
  const keys = jwks.keys.filter((key) => key.kid === header.kid)
  const key = keys[0]
  if (
    keys.length !== 1 ||
    key?.kty !== 'EC' ||
    key.crv !== 'P-256' ||
    key.x === undefined ||
    key.y === undefined ||
    (key.alg !== undefined && key.alg !== 'ES256') ||
    (key.use !== undefined && key.use !== 'sig')
  ) {
    throw new GrokSignInError('invalid-id-token')
  }
  try {
    const publicKey = createPublicKey({
      key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
      format: 'jwk',
    })
    if (
      !verify(
        'SHA256',
        Buffer.from(`${parts.header}.${parts.claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(parts.signature, 'base64url'),
      )
    )
      throw new GrokSignInError('invalid-id-token')
  } catch (error) {
    throw new GrokSignInError('invalid-id-token', undefined, { cause: error })
  }
  return claims.sub === undefined ? undefined : grokAccountIdHash(claims.iss, claims.sub)
}

export interface GrokHostPort {
  /** This app's own xAI client id from configuration; unset refuses before any request. */
  readonly clientId: string | undefined
  /** The scopes to ask for; blank asks the OpenID base set. */
  readonly scopes: string | undefined
  readonly fetch: typeof fetch
  readonly now: () => number
  /** The caller's abort; the device wait ends with it, the browser wait with its timeout. */
  readonly signal?: AbortSignal
  openBrowser(url: string): Promise<void>
  startCallback(
    state: string,
    timeoutMs: number,
  ): Promise<{
    readonly redirectUri: string
    waitForCallback(): Promise<string>
    close(): void
  }>
  /** Show one device code; absent on hosts without that surface. */
  presentDeviceCode?(prompt: GrokDevicePrompt): Promise<void>
  /** Wait out one poll interval; absent on hosts without that surface. */
  sleep?(ms: number): Promise<void>
  /** SecretStorage / OS keystore only; read again while holding the lock. */
  readRecord(): Promise<unknown>
  /** Atomically replace the whole record; a rejected write preserves its prior value. */
  writeRecord(record: GrokRecord): Promise<void>
  deleteRecord(): Promise<void>
  /** An inter-process lock shared by every window/process using this grant. */
  withRefreshLock<T>(work: () => Promise<T>): Promise<T>
}

// Failed writes retain the issued grant only for recovery by this host.
const unpersistedRefresh = new WeakMap<GrokHostPort, GrokRecord>()

/** One refresh answer folded over the stored grant; the identity token stays pending. */
function withRefreshedTokens(record: GrokRecord, token: TokenAnswer, now: number): GrokRecord {
  return {
    ...record,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? record.refreshToken,
    expiresAt: now + token.expires_in * MILLISECONDS_PER_SECOND,
    scope: token.scope ?? record.scope,
    pendingRefresh: { ...(token.id_token !== undefined && { idToken: token.id_token }) },
  }
}

/** No background calls, logging, child process or UI bridge. */
export class GrokSignIn {
  private static wrap(error: unknown): GrokSignInError {
    if (error instanceof GrokSignInError) return error
    // Anything untyped is named by its own codes (Node's network codes, or
    // the error's name), never as an unexplained outage.
    return new GrokSignInError('request-failed', failureCodeNames(error))
  }

  public constructor(private readonly host: GrokHostPort) {}

  private throwIfCancelled(): void {
    if (this.host.signal?.aborted === true) throw new GrokSignInError('cancelled')
  }

  private async request(url: string, form?: URLSearchParams): Promise<Response> {
    try {
      return await subscriptionRequest(this.host.fetch, url, form)
    } catch (error) {
      throw GrokSignIn.wrap(error)
    }
  }

  /**
  One OAuth answer's JSON body with its status. Shape decides, never the
  status: a device poll's pending answer is a refusal-shaped 400, and only
  an unreadable body falls back to the status.
  */
  private async answer(
    url: string,
    unreadable: GrokSignInError['code'],
    form?: URLSearchParams,
  ): Promise<{ readonly status: number; readonly json: unknown }> {
    const response = await this.request(url, form)
    try {
      const json: unknown = await response.json()
      return { status: response.status, json }
    } catch (error) {
      // Only a body that is not JSON reads by its status; anything else is
      // not the body and reaches the caller.
      if (!(error instanceof SyntaxError)) throw error
      if (!response.ok)
        throw new GrokSignInError('request-failed', `HTTP ${String(response.status)}`)
      throw new GrokSignInError(unreadable)
    }
  }

  private async discovery(): Promise<Discovery> {
    const { json } = await this.answer(
      `${ISSUER}/.well-known/openid-configuration`,
      'invalid-discovery',
    )
    const found = checked(discoverySchema, json, 'invalid-discovery')
    const jwks = new URL(found.jwks_uri)
    if (
      jwks.origin !== ISSUER ||
      jwks.username !== '' ||
      jwks.password !== '' ||
      jwks.search !== '' ||
      jwks.hash !== ''
    )
      throw new GrokSignInError('invalid-discovery')
    return found
  }

  private async jwks(uri: string): Promise<unknown> {
    const keys = await this.answer(uri, 'invalid-id-token')
    return keys.json
  }

  /**
  Store one token answer as the grant: the identity token is required
  (OIDC answers `openid` with one), the granted scopes must cover the
  requested ones, and a missing refresh token refuses — background
  refresh could never run without it.
  */
  private async keepGrant(options: {
    readonly answer: TokenAnswer
    readonly clientId: string
    readonly scopes: string
    readonly receivedAt: number
    readonly accountIdHash: string | undefined
    readonly nonce: string | undefined
  }): Promise<void> {
    if (options.answer.refresh_token === undefined) throw new GrokSignInError('invalid-token')
    const scope = options.answer.scope ?? options.scopes
    grantedScopes(scope, options.scopes)
    await this.host.writeRecord(
      checked(
        grokRecordSchema,
        {
          v: CREDENTIAL_RECORD_VERSION,
          auth: 'subscription',
          origin: ORIGIN,
          issuer: ISSUER,
          clientId: options.clientId,
          ...(options.accountIdHash !== undefined && { accountIdHash: options.accountIdHash }),
          accessToken: options.answer.access_token,
          refreshToken: options.answer.refresh_token,
          expiresAt: options.receivedAt + options.answer.expires_in * MILLISECONDS_PER_SECOND,
          scope,
          ...(options.nonce !== undefined && { nonce: options.nonce }),
        },
        'invalid-token',
      ),
    )
    unpersistedRefresh.delete(this.host)
  }

  /** Verify one fresh token answer's identity and keep the grant it carries. */
  private async finishGrant(
    token: TokenAnswer,
    jwksUri: string,
    clientId: string,
    scopes: string,
    nonce: string | undefined,
  ): Promise<void> {
    if (token.id_token === undefined) throw new GrokSignInError('invalid-id-token')
    const receivedAt = this.host.now()
    const accountIdHash = verifyGrokIdToken({
      token: token.id_token,
      jwks: await this.jwks(jwksUri),
      clientId,
      expectedNonce: nonce,
      now: this.host.now(),
    })
    await this.keepGrant({ answer: token, clientId, scopes, receivedAt, accountIdHash, nonce })
  }

  /** Sign in through the browser. Replaces whatever grant is stored; surfaces refuse that first. */
  public async signIn(): Promise<void> {
    try {
      await this.host.withRefreshLock(async () => {
        const clientId = requireGrokClientId(this.host.clientId)
        const scopes = resolveGrokScopes(this.host.scopes)
        const found = await this.discovery()
        const flow = createPkcePair()
        const nonce = pkceRandom(PKCE_STATE_BYTES)
        const callback = await this.host.startCallback(flow.state, OAUTH_CODE_TTL_MS)
        try {
          // The browser opens first and the waiter is awaited at once: no
          // floating promise, so no interim rejection handler. The timeout
          // runs from the listener's opening, and an outcome that settles
          // during the launch still reaches the waiter that attaches late.
          await this.host.openBrowser(
            buildGrokAuthorizeUrl({
              redirectUri: callback.redirectUri,
              clientId,
              scopes,
              verifier: flow.verifier,
              state: flow.state,
              nonce,
            }),
          )
          const grant = parseGrokCallback(
            await callback.waitForCallback(),
            callback.redirectUri,
            flow.state,
          )
          const reply = await this.answer(
            found.token_endpoint,
            'invalid-token',
            new URLSearchParams({
              grant_type: 'authorization_code',
              code: grant.code,
              client_id: clientId,
              redirect_uri: callback.redirectUri,
              code_verifier: flow.verifier,
            }),
          )
          if (tokenErrorSchema.safeParse(reply.json).success) {
            throw new GrokSignInError('invalid-token')
          }
          const token = checked(tokenSchema, reply.json, 'invalid-token')
          await this.finishGrant(token, found.jwks_uri, clientId, scopes, nonce)
        } finally {
          callback.close()
        }
      })
    } catch (error) {
      throw GrokSignIn.wrap(error)
    }
  }

  /**
  Sign in with the device flow for SSH and remote hosts: the code and
  address go to the host's surface, and the token endpoint is polled no
  faster than xAI's interval until approval, denial, expiry or abort. No
  deadline of this app's own: the wait ends at xAI's `expires_in`.
  */
  public async signInWithDevice(): Promise<void> {
    const present = this.host.presentDeviceCode?.bind(this.host)
    const sleep = this.host.sleep?.bind(this.host)
    if (present === undefined || sleep === undefined) {
      throw new GrokSignInError('local-failed', 'device-unsupported')
    }
    try {
      await this.host.withRefreshLock(async () => {
        const clientId = requireGrokClientId(this.host.clientId)
        const scopes = resolveGrokScopes(this.host.scopes)
        const found = await this.discovery()
        const asked = await this.answer(
          found.device_authorization_endpoint,
          'invalid-token',
          new URLSearchParams({ client_id: clientId, scope: scopes }),
        )
        if (tokenErrorSchema.safeParse(asked.json).success) {
          throw new GrokSignInError('device-refused', errorReason(asked.json))
        }
        const code = parseGrokDeviceCode(asked.json, this.host.now())
        this.throwIfCancelled()
        await present({
          userCode: code.userCode,
          verificationUri: code.verificationUri,
          expiresAt: code.expiresAt,
        })
        let intervalS = code.intervalS
        let token: TokenAnswer | undefined
        for (;;) {
          this.throwIfCancelled()
          if (this.host.now() + intervalS * MILLISECONDS_PER_SECOND >= code.expiresAt)
            throw new GrokSignInError('device-expired')
          try {
            await sleep(intervalS * MILLISECONDS_PER_SECOND)
          } catch (error) {
            this.throwIfCancelled()
            throw error
          }
          // A sleeping laptop or a late timer can wake past the deadline.
          this.throwIfCancelled()
          if (this.host.now() >= code.expiresAt) throw new GrokSignInError('device-expired')
          const poll = await this.answer(
            found.token_endpoint,
            'invalid-token',
            new URLSearchParams({
              grant_type: DEVICE_CODE_GRANT,
              device_code: code.deviceCode,
              client_id: clientId,
            }),
          )
          const failure = tokenErrorSchema.safeParse(poll.json)
          if (!failure.success) {
            token = checked(tokenSchema, poll.json, 'invalid-token')
            break
          }
          const reason = failure.data.error
          if (reason === 'authorization_pending') continue
          if (reason === 'slow_down') {
            const longer = z.looseObject({ interval: z.optional(positiveInt) }).safeParse(poll.json)
            const named = longer.success ? (longer.data.interval ?? 0) : 0
            intervalS = Math.max(intervalS + GROK_DEVICE_SLOW_DOWN_STEP_S, named)
            continue
          }
          if (reason === 'access_denied') throw new GrokSignInError('device-denied')
          if (reason === 'expired_token') throw new GrokSignInError('device-expired')
          throw new GrokSignInError('device-refused', errorReason(poll.json))
        }
        await this.finishGrant(token, found.jwks_uri, clientId, scopes, undefined)
      })
    } catch (error) {
      throw GrokSignIn.wrap(error)
    }
  }

  /** Origin binding is checked before any refresh, even for a still-valid token. */
  public async accessToken(requestUrl: string, minimumValidityMs: number): Promise<string> {
    checkMinimumValidity(minimumValidityMs)
    if (!isSameOriginRequest(requestUrl, ORIGIN)) {
      throw new GrokSignInError('origin-mismatch')
    }
    try {
      return await this.host.withRefreshLock(async () => {
        const stored = unpersistedRefresh.get(this.host) ?? (await this.host.readRecord())
        if (stored === undefined) throw new GrokSignInError('not-signed-in')
        let record = checked(grokRecordSchema, stored, 'grant-unreadable')
        const scopes = resolveGrokScopes(this.host.scopes)
        let found: Discovery | undefined
        if (record.pendingRefresh === undefined) {
          grantedScopes(record.scope, scopes)
          if (record.expiresAt > this.host.now() + minimumValidityMs) return record.accessToken
          found = await this.discovery()
          const reply = await this.answer(
            found.token_endpoint,
            'invalid-token',
            new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: record.clientId,
              refresh_token: record.refreshToken,
            }),
          )
          const failure = tokenErrorSchema.safeParse(reply.json)
          if (failure.success) {
            if (failure.data.error === 'invalid_grant') {
              throw new GrokSignInError('sign-in-required', failure.data.error)
            }
            throw new GrokSignInError(
              'request-failed',
              `HTTP ${String(reply.status)} ${errorReason(reply.json)}`,
            )
          }
          const token = checked(tokenSchema, reply.json, 'invalid-token')
          record = withRefreshedTokens(record, token, this.host.now())
          // Hold the replacement in memory before storage or validation can fail.
          unpersistedRefresh.set(this.host, record)
        }
        await this.host.writeRecord(record)
        unpersistedRefresh.delete(this.host)
        grantedScopes(record.scope, scopes)
        const idToken = record.pendingRefresh?.idToken
        let jwks: unknown
        if (idToken !== undefined) {
          found ??= await this.discovery()
          jwks = await this.jwks(found.jwks_uri)
        }
        if (record.expiresAt <= this.host.now() + minimumValidityMs) {
          throw new GrokSignInError('expired')
        }
        if (idToken !== undefined) {
          const accountIdHash = verifyGrokIdToken({
            token: idToken,
            jwks,
            clientId: record.clientId,
            expectedNonce: record.nonce,
            isRefresh: true,
            now: this.host.now(),
          })
          if (accountIdHash !== undefined) {
            if (record.accountIdHash !== undefined && record.accountIdHash !== accountIdHash)
              throw new GrokSignInError('invalid-id-token')
            record = { ...record, accountIdHash }
          }
        }
        const refreshed = checked(grokRecordSchema, record, 'invalid-token')
        delete refreshed.pendingRefresh
        await this.host.writeRecord(refreshed)
        if (refreshed.expiresAt <= this.host.now() + minimumValidityMs) {
          throw new GrokSignInError('expired')
        }
        return refreshed.accessToken
      })
    } catch (error) {
      throw GrokSignIn.wrap(error)
    }
  }

  /**
  Sign out. Revocation and refresh use the same lock; deletion also runs
  on refusal.
  */
  public async remove(): Promise<void> {
    try {
      await this.host.withRefreshLock(async () => {
        try {
          const stored = unpersistedRefresh.get(this.host) ?? (await this.host.readRecord())
          if (stored === undefined) return
          const record = checked(grokRecordSchema, stored, 'grant-unreadable')
          const found = await this.discovery()
          await this.answer(
            found.revocation_endpoint,
            'request-failed',
            new URLSearchParams({
              client_id: record.clientId,
              token: record.refreshToken,
              token_type_hint: 'refresh_token',
            }),
          )
        } finally {
          await this.host.deleteRecord()
          unpersistedRefresh.delete(this.host)
        }
      })
    } catch (error) {
      throw GrokSignIn.wrap(error)
    }
  }
}
