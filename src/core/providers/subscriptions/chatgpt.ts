// M95b S: shared sign-in core. Hosts supply the browser, callback, secret
// store and an inter-process lock; no editor API or other app's store is read.
import { createHash, createPublicKey, verify } from 'node:crypto'
import * as z from 'zod/mini'
import {
  CREDENTIAL_RECORD_VERSION,
  HTTP_STATUS,
  MILLISECONDS_PER_SECOND,
  OAUTH_CODE_TTL_MS,
  PKCE_STATE_BYTES,
} from '../../../shared/constants'
import { pkce } from '../../../host/backend/providersEntry'
const {
  createPkcePair,
  isPkceState,
  isPkceVerifier,
  pkceRandom,
  pkceChallenge: createChallenge,
} = pkce

const ISSUER = 'https://auth.openai.com'
const ORIGIN = 'https://api.openai.com'
const RESOURCE = `${ORIGIN}/v1`
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
const DYNAMIC_CLIENT = 'dynamic_agent_client'
const CALLBACK_PATH = '/auth/callback'
const JWT_SEGMENT_COUNT = 3
const nonempty = z.string().check(z.minLength(1))
const positive = z.number().check(z.gt(0))
const discoverySchema = z.object({
  issuer: z.literal(ISSUER),
  authorization_endpoint: z.literal(`${ISSUER}/api/accounts/authorize`),
  token_endpoint: z.literal(`${ISSUER}/api/accounts/oauth/token`),
  revocation_endpoint: z.literal(`${ISSUER}/api/accounts/oauth/revoke`),
  jwks_uri: z.url(),
})
const tokenSchema = z.object({
  access_token: nonempty,
  refresh_token: nonempty,
  token_type: z.literal('Bearer'),
  expires_in: positive,
  id_token: z.optional(nonempty),
  scope: z.optional(nonempty),
})
const invalidGrantSchema = z.object({ error: z.literal('invalid_grant') })

/** Secret-store payload only. Never send this record across a UI bridge. */
export const chatGptRecordSchema = z.object({
  v: z.literal(CREDENTIAL_RECORD_VERSION),
  auth: z.literal('subscription'),
  origin: z.literal(ORIGIN),
  issuer: z.literal(ISSUER),
  clientId: nonempty,
  hostId: nonempty,
  /** Hash of the captured verified OIDC subject; never the raw account id. */
  accountIdHash: z.optional(z.string().check(z.regex(/^[a-f0-9]{64}$/u))),
  accessToken: nonempty,
  refreshToken: nonempty,
  expiresAt: positive,
  scope: nonempty,
  nonce: nonempty,
  /** A replacement kept for recovery/revocation, never usable before verification. */
  pendingRefresh: z.optional(z.object({ idToken: z.optional(nonempty) })),
})
export type ChatGptRecord = z.infer<typeof chatGptRecordSchema>

/** Technical failure codes; hosts translate these without exposing wire text. */
export class ChatGptSignInError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-discovery'
      | 'invalid-callback'
      | 'invalid-state'
      | 'invalid-token'
      | 'invalid-id-token'
      | 'missing-plan-scope'
      | 'origin-mismatch'
      | 'sign-in-required'
      | 'expired'
      | 'store-unavailable'
      | 'request-failed',
  ) {
    super(`chatgpt.${code}`)
    this.name = 'ChatGptSignInError'
  }
}

function parse<T>(schema: z.ZodMiniType<T>, value: unknown, code: ChatGptSignInError['code']): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ChatGptSignInError(code)
  return result.data
}

function checkScope(scope: string): void {
  if (!scope.split(/\s+/u).includes(DIRECT_SCOPE)) {
    throw new ChatGptSignInError('missing-plan-scope')
  }
}

function callbackUrl(value: string): URL {
  const parsed = z.url().safeParse(value)
  if (!parsed.success) throw new ChatGptSignInError('invalid-callback')
  const url = new URL(parsed.data)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '' ||
    Number(url.port) <= 0 ||
    url.pathname !== CALLBACK_PATH ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  )
    throw new ChatGptSignInError('invalid-callback')
  return url
}

/** Dynamic registration, PKCE S256 and a persistent opaque installation id. */
export function buildChatGptAuthorizeUrl(options: {
  readonly redirectUri: string
  readonly hostId: string
  readonly verifier: string
  readonly state: string
  readonly nonce: string
}): string {
  const redirect = callbackUrl(options.redirectUri)
  if (
    redirect.search !== '' ||
    !isPkceVerifier(options.verifier) ||
    [options.state, options.nonce, options.hostId].some((value) => !isPkceState(value))
  ) {
    throw new ChatGptSignInError('invalid-callback')
  }
  const { verifier, state, nonce, hostId } = options
  const url = new URL(`${ISSUER}/api/accounts/authorize`)
  url.search = new URLSearchParams({
    client_id: DYNAMIC_CLIENT,
    response_type: 'code',
    redirect_uri: redirect.href,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: createChallenge(verifier),
    code_challenge_method: 'S256',
    agent_name_hint: 'Muse Spark Code (Unofficial)',
    ext_agent_host_id: hostId,
  }).toString()
  return url.href
}

/** Validate the captured callback fields, including the dynamically issued client. */
export function parseChatGptCallback(
  value: string,
  redirectUri: string,
  state: string,
): {
  readonly code: string
  readonly clientId: string
  readonly scope: string
} {
  const url = callbackUrl(value)
  if (url.origin !== callbackUrl(redirectUri).origin || url.searchParams.has('error')) {
    throw new ChatGptSignInError('invalid-callback')
  }
  for (const field of ['code', 'client_id', 'scope', 'state']) {
    if (url.searchParams.getAll(field).length !== 1) {
      throw new ChatGptSignInError('invalid-callback')
    }
  }
  if (!isPkceState(state) || url.searchParams.get('state') !== state) {
    throw new ChatGptSignInError('invalid-state')
  }
  const callback = parse(
    z.object({ code: nonempty, clientId: nonempty, scope: nonempty }),
    {
      code: url.searchParams.get('code'),
      clientId: url.searchParams.get('client_id'),
      scope: url.searchParams.get('scope'),
    },
    'invalid-callback',
  )
  if (callback.clientId === DYNAMIC_CLIENT) throw new ChatGptSignInError('invalid-callback')
  return callback
}

const jwtHeaderSchema = z.object({ alg: z.literal('RS256'), kid: nonempty })
const claimsSchema = z.object({
  // Owner captures acdc0f60 / 577bc807 (0 + 1 attempts) include OIDC sub.
  sub: z.optional(nonempty),
  iss: z.literal(ISSUER),
  aud: z.union([nonempty, z.array(nonempty).check(z.minLength(1))]),
  azp: z.optional(nonempty),
  exp: positive,
  nonce: z.optional(nonempty),
})
const jwksSchema = z.object({
  keys: z.array(
    z.object({
      kty: nonempty,
      kid: nonempty,
      n: z.optional(nonempty),
      e: z.optional(nonempty),
      alg: z.optional(nonempty),
      use: z.optional(nonempty),
    }),
  ),
})

function jwtPart(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new ChatGptSignInError('invalid-id-token')
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    return decoded
  } catch {
    throw new ChatGptSignInError('invalid-id-token')
  }
}

/** Return only a hash after verification; raw identity claims stay in this function. */
export function verifyChatGptIdToken(options: {
  readonly token: string
  readonly jwks: unknown
  readonly clientId: string
  readonly nonce: string
  readonly now: number
  /** OIDC permits a refresh ID token to omit the original nonce. */
  readonly isRefresh?: boolean
}): string | undefined {
  const [headerPart, claimsPart, signature, extra] = options.token.split('.', JWT_SEGMENT_COUNT + 1)
  if (
    headerPart === undefined ||
    claimsPart === undefined ||
    signature === undefined ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/u.test(signature)
  ) {
    throw new ChatGptSignInError('invalid-id-token')
  }
  const header = parse(jwtHeaderSchema, jwtPart(headerPart), 'invalid-id-token')
  const claims = parse(claimsSchema, jwtPart(claimsPart), 'invalid-id-token')
  const jwks = parse(jwksSchema, options.jwks, 'invalid-id-token')
  const audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
  if (
    !Number.isFinite(options.now) ||
    claims.exp * MILLISECONDS_PER_SECOND <= options.now ||
    !audience.includes(options.clientId) ||
    (audience.length > 1 && claims.azp !== options.clientId) ||
    (claims.azp !== undefined && claims.azp !== options.clientId) ||
    (claims.nonce === undefined ? options.isRefresh !== true : claims.nonce !== options.nonce)
  ) {
    throw new ChatGptSignInError('invalid-id-token')
  }
  const keys = jwks.keys.filter((key) => key.kid === header.kid)
  const key = keys[0]
  if (
    keys.length !== 1 ||
    key?.kty !== 'RSA' ||
    key.n === undefined ||
    key.e === undefined ||
    (key.alg !== undefined && key.alg !== 'RS256') ||
    (key.use !== undefined && key.use !== 'sig')
  ) {
    throw new ChatGptSignInError('invalid-id-token')
  }
  try {
    const publicKey = createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' })
    if (
      !verify(
        'RSA-SHA256',
        Buffer.from(`${headerPart}.${claimsPart}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      )
    )
      throw new ChatGptSignInError('invalid-id-token')
  } catch {
    throw new ChatGptSignInError('invalid-id-token')
  }
  return claims.sub === undefined
    ? undefined
    : createHash('sha256').update(`${claims.iss}\0${claims.sub}`).digest('hex')
}

export interface ChatGptHostPort {
  /** Persist an opaque random id in host storage; never an account identifier. */
  readonly hostId: string
  readonly fetch: typeof fetch
  readonly now: () => number
  openBrowser(url: string): Promise<void>
  startCallback(
    state: string,
    timeoutMs: number,
  ): Promise<{
    readonly redirectUri: string
    waitForCallback(): Promise<string>
    close(): void
  }>
  /** SecretStorage / OS keystore only; read again while holding the lock. */
  readRecord(): Promise<unknown>
  /** Atomically replace the whole record; a rejected write preserves its prior value. */
  writeRecord(record: ChatGptRecord): Promise<void>
  deleteRecord(): Promise<void>
  /** An inter-process lock shared by every window/process using this grant. */
  withRefreshLock<T>(work: () => Promise<T>): Promise<T>
}

// Failed writes retain the issued grant only for recovery/removal by this host.
// A shared host port also shares this recovery slot across its core instances.
const unpersistedRefresh = new WeakMap<ChatGptHostPort, ChatGptRecord>()

/** No background calls, logging, child process or UI bridge. */
export class ChatGptSignIn {
  public constructor(private readonly host: ChatGptHostPort) {}

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof ChatGptSignInError) throw error
      throw new ChatGptSignInError('request-failed')
    }
  }

  private async request(url: string, form?: URLSearchParams): Promise<Response> {
    try {
      const response = await this.host.fetch(url, {
        method: form === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(OAUTH_CODE_TTL_MS),
        ...(form !== undefined && {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
        }),
      })
      if (!response.ok) {
        if (
          url === `${ISSUER}/api/accounts/oauth/token` &&
          (response.status === HTTP_STATUS.badRequest ||
            response.status === HTTP_STATUS.unauthorized)
        ) {
          let failure: unknown
          try {
            failure = await response.json()
          } catch {
            throw new ChatGptSignInError('request-failed')
          }
          if (invalidGrantSchema.safeParse(failure).success) {
            throw new ChatGptSignInError('sign-in-required')
          }
        }
        throw new ChatGptSignInError('request-failed')
      }
      return response
    } catch (error) {
      if (error instanceof ChatGptSignInError) throw error
      throw new ChatGptSignInError('request-failed')
    }
  }

  private async json(url: string, form?: URLSearchParams): Promise<unknown> {
    const response = await this.request(url, form)
    try {
      const value: unknown = await response.json()
      return value
    } catch {
      throw new ChatGptSignInError('invalid-token')
    }
  }

  private async discovery(): Promise<z.infer<typeof discoverySchema>> {
    const discovery = parse(
      discoverySchema,
      await this.json(`${ISSUER}/.well-known/openid-configuration`),
      'invalid-discovery',
    )
    const jwks = new URL(discovery.jwks_uri)
    if (
      jwks.origin !== ISSUER ||
      jwks.username !== '' ||
      jwks.password !== '' ||
      jwks.search !== '' ||
      jwks.hash !== ''
    )
      throw new ChatGptSignInError('invalid-discovery')
    return discovery
  }

  public async signIn(): Promise<void> {
    await this.guard(() =>
      this.host.withRefreshLock(async () => {
        const discovery = await this.discovery()
        const pkce = createPkcePair()
        const nonce = pkceRandom(PKCE_STATE_BYTES)
        const callback = await this.host.startCallback(pkce.state, OAUTH_CODE_TTL_MS)
        try {
          const waiting = callback.waitForCallback()
          // Attach a handler before opening the browser; a callback may reject immediately.
          void waiting.catch(() => null)
          await this.host.openBrowser(
            buildChatGptAuthorizeUrl({
              redirectUri: callback.redirectUri,
              hostId: this.host.hostId,
              verifier: pkce.verifier,
              state: pkce.state,
              nonce,
            }),
          )
          const grant = parseChatGptCallback(await waiting, callback.redirectUri, pkce.state)
          const token = parse(
            tokenSchema,
            await this.json(
              discovery.token_endpoint,
              new URLSearchParams({
                grant_type: 'authorization_code',
                code: grant.code,
                client_id: grant.clientId,
                redirect_uri: callback.redirectUri,
                code_verifier: pkce.verifier,
                resource: RESOURCE,
              }),
            ),
            'invalid-token',
          )
          if (token.id_token === undefined) throw new ChatGptSignInError('invalid-id-token')
          const receivedAt = this.host.now()
          const accountIdHash = verifyChatGptIdToken({
            token: token.id_token,
            jwks: await this.json(discovery.jwks_uri),
            clientId: grant.clientId,
            nonce,
            now: this.host.now(),
          })
          const scope = token.scope ?? grant.scope
          checkScope(scope)
          await this.host.writeRecord(
            parse(
              chatGptRecordSchema,
              {
                v: CREDENTIAL_RECORD_VERSION,
                auth: 'subscription',
                origin: ORIGIN,
                issuer: ISSUER,
                clientId: grant.clientId,
                hostId: this.host.hostId,
                ...(accountIdHash !== undefined && { accountIdHash }),
                accessToken: token.access_token,
                refreshToken: token.refresh_token,
                expiresAt: receivedAt + token.expires_in * MILLISECONDS_PER_SECOND,
                scope,
                nonce,
              },
              'invalid-token',
            ),
          )
          unpersistedRefresh.delete(this.host)
        } finally {
          callback.close()
        }
      }),
    )
  }

  /** Origin binding is checked before any refresh, even for a still-valid token. */
  public async accessToken(requestUrl: string, minimumValidityMs: number): Promise<string> {
    if (!Number.isFinite(minimumValidityMs) || minimumValidityMs < 0) {
      throw new ChatGptSignInError('invalid-token')
    }
    const request = z.url().safeParse(requestUrl)
    if (
      !request.success ||
      new URL(request.data).origin !== ORIGIN ||
      new URL(request.data).username !== '' ||
      new URL(request.data).password !== ''
    ) {
      throw new ChatGptSignInError('origin-mismatch')
    }
    return await this.guard(() =>
      this.host.withRefreshLock(async () => {
        const stored = unpersistedRefresh.get(this.host) ?? (await this.host.readRecord())
        if (stored === undefined) throw new ChatGptSignInError('sign-in-required')
        let record = parse(chatGptRecordSchema, stored, 'invalid-token')
        let discovery: z.infer<typeof discoverySchema> | undefined
        if (record.pendingRefresh === undefined) {
          checkScope(record.scope)
          if (record.expiresAt > this.host.now() + minimumValidityMs) return record.accessToken
          discovery = await this.discovery()
          const token = parse(
            tokenSchema,
            await this.json(
              discovery.token_endpoint,
              new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: record.clientId,
                refresh_token: record.refreshToken,
                resource: RESOURCE,
              }),
            ),
            'invalid-token',
          )
          record = {
            ...record,
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: this.host.now() + token.expires_in * MILLISECONDS_PER_SECOND,
            scope: token.scope ?? record.scope,
            pendingRefresh: { ...(token.id_token !== undefined && { idToken: token.id_token }) },
          }
          // Keep the replacement before any storage, key fetch or validation can fail.
          unpersistedRefresh.set(this.host, record)
        }
        await this.host.writeRecord(record)
        unpersistedRefresh.delete(this.host)
        checkScope(record.scope)
        const idToken = record.pendingRefresh?.idToken
        let jwks: unknown
        if (idToken !== undefined) {
          discovery ??= await this.discovery()
          jwks = await this.json(discovery.jwks_uri)
        }
        if (record.expiresAt <= this.host.now() + minimumValidityMs) {
          throw new ChatGptSignInError('expired')
        }
        if (idToken !== undefined) {
          const accountIdHash = verifyChatGptIdToken({
            token: idToken,
            jwks,
            clientId: record.clientId,
            nonce: record.nonce,
            now: this.host.now(),
            isRefresh: true,
          })
          if (accountIdHash !== undefined) {
            if (record.accountIdHash !== undefined && record.accountIdHash !== accountIdHash)
              throw new ChatGptSignInError('invalid-id-token')
            record = { ...record, accountIdHash }
          }
        }
        const refreshed = parse(chatGptRecordSchema, record, 'invalid-token')
        delete refreshed.pendingRefresh
        await this.host.writeRecord(refreshed)
        if (refreshed.expiresAt <= this.host.now() + minimumValidityMs) {
          throw new ChatGptSignInError('expired')
        }
        return refreshed.accessToken
      }),
    )
  }

  /** Revocation and refresh use the same lock; deletion also runs on refusal. */
  public async remove(): Promise<void> {
    await this.guard(() =>
      this.host.withRefreshLock(async () => {
        try {
          const stored = unpersistedRefresh.get(this.host) ?? (await this.host.readRecord())
          if (stored === undefined) return
          const record = parse(chatGptRecordSchema, stored, 'invalid-token')
          const discovery = await this.discovery()
          await this.request(
            discovery.revocation_endpoint,
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
      }),
    )
  }
}
