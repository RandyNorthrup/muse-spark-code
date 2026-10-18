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
import { failureCodeNames } from '../../networkFailure'
import { ChatGptSignInError, createChatGptHostId, isChatGptHostId } from './chatgptHostId'
export { ChatGptSignInError } from './chatgptHostId'
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
/**
 * The token endpoint's answers that mean the refresh token or code is
 * unusable: clear it and repeat OAuth with the saved issued client
 * (SIWC errors and recovery, "Refresh errors", read 2026-10-17).
 */
const unusableGrantSchema = z.object({
  error: z.enum([
    'invalid_grant',
    'invalid_refresh_token',
    'token_expired',
    'refresh_token_expired',
    'refresh_token_invalidated',
    'refresh_token_reused',
  ]),
})
/** "Invalid client: fix the client configuration": the saved registration is refused. */
const invalidClientSchema = z.object({ error: z.literal('invalid_client') })
const accountHashSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/u))

/**
 * One ChatGPT account's registration: the client OpenAI issued for it
 * (`oaiapp_…`, never `dynamic_agent_client`) and the hash of the verified
 * account it belongs to. Kept across sign-out and reused by later
 * sign-ins to that account; it holds no token.
 */
export const chatGptRegistrationSchema = z.object({
  v: z.literal(CREDENTIAL_RECORD_VERSION),
  clientId: nonempty.check(z.refine((value) => value !== DYNAMIC_CLIENT)),
  accountIdHash: z.optional(accountHashSchema),
})
export type ChatGptRegistration = z.infer<typeof chatGptRegistrationSchema>

/** Secret-store payload only. Never send this record across a UI bridge. */
export const chatGptRecordSchema = z.object({
  v: z.literal(CREDENTIAL_RECORD_VERSION),
  auth: z.literal('subscription'),
  origin: z.literal(ORIGIN),
  issuer: z.literal(ISSUER),
  clientId: nonempty,
  hostId: nonempty,
  /** Hash of the captured verified OIDC subject; never the raw account id. */
  accountIdHash: z.optional(accountHashSchema),
  accessToken: nonempty,
  refreshToken: nonempty,
  expiresAt: positive,
  scope: nonempty,
  nonce: nonempty,
  /** A replacement kept for recovery/revocation, never usable before verification. */
  pendingRefresh: z.optional(z.object({ idToken: z.optional(nonempty) })),
})
export type ChatGptRecord = z.infer<typeof chatGptRecordSchema>

function parse<T>(
  schema: z.ZodMiniType<T>,
  value: unknown,
  code: ChatGptSignInError['code'],
  reason?: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ChatGptSignInError(code, reason)
  return result.data
}

/** Where the runtime keeps its host id; hosts name the location they read. */
export const CHATGPT_HOST_ID_ENTRY = 'museSpark.provider.chatgpt.host-id'

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

/**
 * The host id for `stored`: a documented id is kept, a previous bare-random
 * id migrates in place to a fresh documented one (or the first one is
 * created when nothing is stored). Anything else is rejected, never
 * repaired. An issued client id stays valid across the migration: it is
 * bound to the user and workspace and spans hosts, so no re-authorization
 * is required.
 */
export function resolveChatGptHostId(stored: string | undefined): {
  readonly hostId: string
  readonly persist: boolean
} {
  if (stored !== undefined) {
    if (isChatGptHostId(stored)) return { hostId: stored, persist: false }
    if (!isPkceState(stored)) {
      throw new ChatGptSignInError('host-id-unreadable', CHATGPT_HOST_ID_ENTRY)
    }
  }
  return { hostId: createChatGptHostId(), persist: true }
}

/** OpenAI's own `error` code on the callback: an opaque token, never free text. */
const AUTHORIZE_ERROR_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * PKCE S256 and the persistent opaque host id. A first sign-in registers
 * with `dynamic_agent_client` and the app's name; a later one reauthorizes
 * with the saved issued `clientId` and omits the name (SIWC registration and
 * sign-in, read 2026-10-17). No ID-token or login hint is sent: this app
 * keeps neither the ID token nor the e-mail address.
 */
export function buildChatGptAuthorizeUrl(options: {
  readonly redirectUri: string
  readonly hostId: string
  readonly verifier: string
  readonly state: string
  readonly nonce: string
  /** The saved issued client for a returning account; absent registers anew. */
  readonly clientId?: string | undefined
}): string {
  const redirect = callbackUrl(options.redirectUri)
  if (
    redirect.search !== '' ||
    !isPkceVerifier(options.verifier) ||
    !isPkceState(options.state) ||
    !isPkceState(options.nonce) ||
    !isChatGptHostId(options.hostId) ||
    options.clientId === '' ||
    options.clientId === DYNAMIC_CLIENT
  ) {
    throw new ChatGptSignInError('invalid-callback')
  }
  const { verifier, state, nonce, hostId, clientId } = options
  const url = new URL(`${ISSUER}/api/accounts/authorize`)
  url.search = new URLSearchParams({
    client_id: clientId ?? DYNAMIC_CLIENT,
    response_type: 'code',
    redirect_uri: redirect.href,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: createChallenge(verifier),
    code_challenge_method: 'S256',
    ...(clientId === undefined && { agent_name_hint: 'Muse Spark Code (Unofficial)' }),
    ext_agent_host_id: hostId,
  }).toString()
  return url.href
}

/**
 * Validate the captured callback fields. A new registration's callback names
 * the issued client; a reauthorization with the saved `clientId` may omit it
 * and must never name another one (SIWC: "reject the result rather than
 * replacing the selected account's registration"). `scope` may be absent:
 * the token response's granted scopes decide.
 */
export function parseChatGptCallback(
  value: string,
  redirectUri: string,
  state: string,
  clientId?: string,
): {
  readonly code: string
  readonly clientId: string
  readonly scope?: string | undefined
} {
  const url = callbackUrl(value)
  if (url.origin !== callbackUrl(redirectUri).origin) {
    throw new ChatGptSignInError('invalid-callback')
  }
  if (url.searchParams.has('error')) {
    // OpenAI refused the authorize request. The attempt stops without
    // exchanging a code; the person's sentence carries OpenAI's own error
    // code, never "temporarily unavailable".
    if (!isPkceState(state) || url.searchParams.get('state') !== state) {
      throw new ChatGptSignInError('invalid-state')
    }
    const refusal = url.searchParams.get('error') ?? ''
    if (!AUTHORIZE_ERROR_PATTERN.test(refusal)) throw new ChatGptSignInError('invalid-callback')
    throw new ChatGptSignInError('authorize-refused', refusal)
  }
  const required = clientId === undefined ? ['code', 'client_id', 'state'] : ['code', 'state']
  for (const field of required) {
    if (url.searchParams.getAll(field).length !== 1) {
      throw new ChatGptSignInError('invalid-callback')
    }
  }
  for (const field of ['client_id', 'scope']) {
    if (url.searchParams.getAll(field).length > 1) throw new ChatGptSignInError('invalid-callback')
  }
  if (!isPkceState(state) || url.searchParams.get('state') !== state) {
    throw new ChatGptSignInError('invalid-state')
  }
  const callback = parse(
    z.object({ code: nonempty, clientId: nonempty, scope: z.optional(nonempty) }),
    {
      code: url.searchParams.get('code'),
      clientId: url.searchParams.get('client_id') ?? clientId,
      scope: url.searchParams.get('scope') ?? undefined,
    },
    'invalid-callback',
  )
  if (
    callback.clientId === DYNAMIC_CLIENT ||
    (clientId !== undefined && callback.clientId !== clientId)
  ) {
    throw new ChatGptSignInError('invalid-callback')
  }
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

/**
 * The stored account identity: the product's SHA-256 over the verified
 * issuer and subject. Raw identity claims never leave this derivation.
 */
export function chatGptAccountIdHash(issuer: string, subject: string): string {
  return createHash('sha256').update(`${issuer}\0${subject}`).digest('hex')
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
  return claims.sub === undefined ? undefined : chatGptAccountIdHash(claims.iss, claims.sub)
}

export interface ChatGptHostPort {
  /**
   * The host's stable documented id (`urn:uuid:` plus one UUIDv4),
   * persisted in host storage; never an account identifier.
   */
  readonly hostId: string
  readonly fetch: typeof fetch
  readonly now: () => number
  openBrowser(url: string): Promise<void>
  /** `clientId` is the saved issued client a reauthorization's callback may omit. */
  startCallback(
    state: string,
    timeoutMs: number,
    clientId: string | undefined,
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
  /** The account's registration, in the same store; it outlives the grant. */
  readRegistration(): Promise<unknown>
  writeRegistration(registration: ChatGptRegistration): Promise<void>
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
      // Anything untyped is named by its own codes (Node's network codes,
      // or the error's name), never as an unexplained outage.
      throw new ChatGptSignInError('request-failed', failureCodeNames(error))
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
            throw new ChatGptSignInError('request-failed', `HTTP ${String(response.status)}`)
          }
          const unusable = unusableGrantSchema.safeParse(failure)
          if (unusable.success) {
            throw new ChatGptSignInError('sign-in-required', unusable.data.error)
          }
          if (invalidClientSchema.safeParse(failure).success) {
            throw new ChatGptSignInError('client-refused')
          }
        }
        throw new ChatGptSignInError('request-failed', `HTTP ${String(response.status)}`)
      }
      return response
    } catch (error) {
      if (error instanceof ChatGptSignInError) throw error
      throw new ChatGptSignInError('request-failed', failureCodeNames(error))
    }
  }

  /** `code` names whose answer it was when the body is not JSON. */
  private async json(
    url: string,
    code: ChatGptSignInError['code'],
    form?: URLSearchParams,
  ): Promise<unknown> {
    const response = await this.request(url, form)
    try {
      const value: unknown = await response.json()
      return value
    } catch {
      throw new ChatGptSignInError(code)
    }
  }

  private async discovery(): Promise<z.infer<typeof discoverySchema>> {
    const discovery = parse(
      discoverySchema,
      await this.json(`${ISSUER}/.well-known/openid-configuration`, 'invalid-discovery'),
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

  /** The saved registration, or undefined when this account never registered here. */
  private async registration(): Promise<ChatGptRegistration | undefined> {
    const stored = await this.host.readRegistration()
    return stored === undefined
      ? undefined
      : parse(chatGptRegistrationSchema, stored, 'registration-unreadable')
  }

  /**
   * Sign in. A saved registration is reused: the browser reauthorizes the
   * same account with its issued client, and a different account is refused
   * before any credential is replaced. `isNewAccount` registers a new client
   * instead ("Use a different ChatGPT account"), which then becomes the
   * saved registration.
   */
  public async signIn(options: { readonly isNewAccount?: boolean } = {}): Promise<void> {
    await this.guard(() =>
      this.host.withRefreshLock(async () => {
        const saved = options.isNewAccount === true ? undefined : await this.registration()
        const discovery = await this.discovery()
        const pkce = createPkcePair()
        const nonce = pkceRandom(PKCE_STATE_BYTES)
        const callback = await this.host.startCallback(
          pkce.state,
          OAUTH_CODE_TTL_MS,
          saved?.clientId,
        )
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
              clientId: saved?.clientId,
            }),
          )
          let grant: ReturnType<typeof parseChatGptCallback>
          try {
            grant = parseChatGptCallback(
              await waiting,
              callback.redirectUri,
              pkce.state,
              saved?.clientId,
            )
          } catch (error) {
            // OpenAI no longer knows the saved client: the registration is
            // what it refused, and signing in the same way cannot fix it.
            if (
              saved !== undefined &&
              error instanceof ChatGptSignInError &&
              error.code === 'authorize-refused' &&
              error.reason === 'invalid_client'
            ) {
              throw new ChatGptSignInError('client-refused')
            }
            throw error
          }
          // A new registration's issued client is kept before the exchange,
          // so a failed exchange is repeated with it, never re-registered.
          if (saved === undefined) {
            await this.host.writeRegistration({
              v: CREDENTIAL_RECORD_VERSION,
              clientId: grant.clientId,
            })
          }
          const token = parse(
            tokenSchema,
            await this.json(
              discovery.token_endpoint,
              'invalid-token',
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
            jwks: await this.json(discovery.jwks_uri, 'invalid-id-token'),
            clientId: grant.clientId,
            nonce,
            now: this.host.now(),
          })
          if (
            accountIdHash !== undefined &&
            saved?.accountIdHash !== undefined &&
            accountIdHash !== saved.accountIdHash
          ) {
            // Never combine one account's registration with another
            // account's tokens: this grant is ended, not kept.
            try {
              await this.request(
                discovery.revocation_endpoint,
                new URLSearchParams({
                  client_id: grant.clientId,
                  token: token.refresh_token,
                  token_type_hint: 'refresh_token',
                }),
              )
            } catch {
              /* The mismatch below is what the person reads; nothing was stored. */
            }
            throw new ChatGptSignInError('account-mismatch')
          }
          const scope = token.scope ?? grant.scope
          if (scope === undefined) throw new ChatGptSignInError('missing-plan-scope')
          checkScope(scope)
          const account = accountIdHash ?? saved?.accountIdHash
          await this.host.writeRegistration({
            v: CREDENTIAL_RECORD_VERSION,
            clientId: grant.clientId,
            ...(account !== undefined && { accountIdHash: account }),
          })
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
      // This app's own caller asked for an impossible validity: a defect here, not ChatGPT.
      throw new RangeError('minimumValidityMs')
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
        if (stored === undefined) throw new ChatGptSignInError('not-signed-in')
        let record = parse(chatGptRecordSchema, stored, 'grant-unreadable')
        let discovery: z.infer<typeof discoverySchema> | undefined
        if (record.pendingRefresh === undefined) {
          checkScope(record.scope)
          if (record.expiresAt > this.host.now() + minimumValidityMs) return record.accessToken
          discovery = await this.discovery()
          const token = parse(
            tokenSchema,
            await this.json(
              discovery.token_endpoint,
              'invalid-token',
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
          jwks = await this.json(discovery.jwks_uri, 'invalid-id-token')
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

  /**
   * Sign out. Revocation and refresh use the same lock; deletion also runs
   * on refusal. The account's registration stays for its next sign-in:
   * "Signing out … does not create a new client" (SIWC accounts and sessions).
   */
  public async remove(): Promise<void> {
    await this.guard(() =>
      this.host.withRefreshLock(async () => {
        try {
          const stored = unpersistedRefresh.get(this.host) ?? (await this.host.readRecord())
          if (stored === undefined) return
          const record = parse(chatGptRecordSchema, stored, 'grant-unreadable')
          // A grant from before registrations were kept carries its issued client.
          await this.host.writeRegistration({
            v: CREDENTIAL_RECORD_VERSION,
            clientId: record.clientId,
            ...(record.accountIdHash !== undefined && { accountIdHash: record.accountIdHash }),
          })
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
