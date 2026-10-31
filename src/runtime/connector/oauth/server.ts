// M124 remote (D240): the authorization server on the person's own PC. The
// protocol is `oidc-provider`'s (a certified OAuth 2.0 / OpenID Connect
// implementation by the author of `jose`): authorization code with PKCE
// S256 only, refresh tokens that rotate (a spent one revokes its grant),
// RFC 8707 resource binding to this connector's one MCP resource, RFC 7591
// registration when the person turned it on, Client ID Metadata Documents
// with the library's connect-time SSRF guard, RFC 7009 revocation, RFC 9207
// `iss`, RFC 8414 metadata and the JWKS. What is ours is only the glue
// the profile leaves to the server: the owner's consent page (an owner code
// printed in this process's terminal, never the network), Protected
// Resource Metadata (RFC 9728), the bearer check on the MCP endpoint, and
// the binding of every sign-in to the live connection grant, so revoking
// the grant ends every token at once.
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Provider, { errors, interactionPolicy, type Configuration } from 'oidc-provider'
import {
  CONNECTOR_REMOTE_LIMITS,
  CONNECTOR_REMOTE_OWNER_ACCOUNT,
  CONNECTOR_REMOTE_PATHS,
  HTTP_STATUS,
} from '../../../shared/constants'
import {
  CONNECTOR_SCOPES,
  type ConnectorGrant,
  type ConnectorScope,
} from '../../../shared/connector'
import { isAllowedRedirectUri, isLoopbackHost } from '../../../shared/connectorRemote'
import type { AuthorityPort } from '../../../core/connector/registry'
import { fill, UI_TEXT } from '../../../shared/l10n/text'
import { readBoundedBody } from '../../httpServer'
import { OAuthStateUnreadable, type ConnectorStore } from '../store'
import { connectorAdapter } from './adapter'
import { PAGE_HEADERS, renderConsentPage, renderMessagePage } from './consent'
import { ownerClients } from './clients'
import { OAuthRecords, isOAuthRecordsFull } from './records'

export interface VerifiedAccess {
  readonly clientId: string
  readonly scopes: readonly ConnectorScope[]
}

export interface ConnectorOAuthOptions {
  readonly store: ConnectorStore
  readonly connectionId: string
  /** This PC's public origin for the connector (how clients reach it), no trailing slash. */
  readonly issuer: string
  readonly authority: AuthorityPort
  readonly now: () => number
  /** Open registration (RFC 7591) for clients with no prior relationship; off unless the person asks. */
  readonly allowOpenRegistration: boolean
  readonly accessTokenTtlSeconds: number
  readonly signInTtlSeconds: number
  /** TLS ends before this process (the person's own tunnel or proxy): cookies are secure ones. */
  readonly isBehindTls: boolean
  /** Told the owner code at start and whenever it is replaced. */
  readonly onOwnerCode: (code: string) => void
}

const OWNER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const FORM_TYPE = 'application/x-www-form-urlencoded'

function digestOf(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest()
}

function newOwnerCode(): string {
  const bytes = randomBytes(CONNECTOR_REMOTE_LIMITS.ownerCodeChars)
  // 32 letters divide 256 evenly: no bias.
  return [...bytes].map((byte) => OWNER_CODE_ALPHABET[byte % OWNER_CODE_ALPHABET.length]).join('')
}

function normalizedCode(text: string): string {
  return text.replaceAll(/[\s-]/gu, '').toUpperCase()
}

/** The ES256 signing key as a private JWK, with the id and use the library reads. */
function newSigningJwk(): Record<string, unknown> {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), use: 'sig', alg: 'ES256' }
}

/** node:crypto's own refusal of a malformed key, as opposed to a real failure. */
function isInvalidJwkRefusal(error: unknown): boolean {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return (
    typeof code === 'string' && (code === 'ERR_CRYPTO_INVALID_JWK' || code.startsWith('ERR_OSSL_'))
  )
}

/** True when the stored JWK is a usable private P-256 key; node:crypto judges it. */
function isUsableSigningJwk(jwk: Record<string, unknown>): boolean {
  try {
    const key = createPrivateKey({ key: { ...jwk, kty: 'EC' }, format: 'jwk' })
    return key.asymmetricKeyType === 'ec' && typeof jwk['kid'] === 'string'
  } catch (error: unknown) {
    // Only node:crypto's own refusal of a malformed key means "not usable".
    if (isInvalidJwkRefusal(error)) return false
    throw error
  }
}

function scopesIn(text = ''): ConnectorScope[] {
  const known: readonly string[] = CONNECTOR_SCOPES
  return text.split(/\s+/u).filter((word): word is ConnectorScope => known.includes(word))
}

function liveGrant(authority: AuthorityPort): ConnectorGrant | undefined {
  const { grant } = authority.current()
  return grant === undefined || grant.revoked ? undefined : grant
}

async function readForm(
  request: IncomingMessage,
  maxBytes: number,
): Promise<URLSearchParams | undefined> {
  const type = (request.headers['content-type'] ?? '').split(';', 1)[0]?.trim()
  if (type !== FORM_TYPE) return undefined
  const body = await readBoundedBody(request, maxBytes)
  return body === undefined ? undefined : new URLSearchParams(body)
}

function sendPage(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, PAGE_HEADERS)
  response.end(html)
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

export class ConnectorOAuth {
  /** Loads the connection's OAuth state, minting its signing key on first use. */
  public static async create(options: ConnectorOAuthOptions): Promise<ConnectorOAuth> {
    const stored = await options.store.oauthState(options.connectionId)
    const base = stored ?? {
      schemaVersion: 1 as const,
      connectionId: options.connectionId,
      signingJwk: newSigningJwk(),
      boundGeneration: 0,
      records: [],
    }
    // A stored key that cannot sign means the file is not what this server
    // saved: serve nothing rather than mint a new key over the owner's clients.
    if (!isUsableSigningJwk(base.signingJwk)) throw new OAuthStateUnreadable()
    const { records, ...rest } = base
    const held = new OAuthRecords(rest, records, {
      now: options.now,
      save: async (state) => {
        await options.store.saveOAuthState(state)
      },
      owner: async () => await ownerClients(options.store, options.connectionId),
      limits: {
        openClientsMax: CONNECTOR_REMOTE_LIMITS.openClientsMax,
        openClientTtlMs: CONNECTOR_REMOTE_LIMITS.openClientTtlMs,
        interactionsMax: CONNECTOR_REMOTE_LIMITS.interactionsMax,
      },
    })
    const server = new ConnectorOAuth(options, held, base.signingJwk)
    if (stored === undefined) await options.store.saveOAuthState({ ...rest, records })
    await server.reconcile()
    options.onOwnerCode(server.ownerCode)
    return server
  }

  private readonly provider: Provider
  private ownerCode = newOwnerCode()
  private ownerCodeFailures = 0

  private constructor(
    private readonly options: ConnectorOAuthOptions,
    private readonly records: OAuthRecords,
    signingJwk: Record<string, unknown>,
  ) {
    this.provider = new Provider(options.issuer, this.configuration(signingJwk))
    this.provider.proxy = options.isBehindTls
  }

  private get metadataUrl(): string {
    return `${this.options.issuer}${CONNECTOR_REMOTE_PATHS.protectedResource}${CONNECTOR_REMOTE_PATHS.mcp}`
  }

  private grantScopes(): ConnectorScope[] {
    return [...(liveGrant(this.options.authority)?.scopes ?? [])]
  }

  /** Ends every sign-in made under a grant that has since changed or been withdrawn. */
  private async reconcile(): Promise<void> {
    // The grant is read from the store again, as the registry does before every
    // call: a revoke from another terminal ends the sign-ins now, not whenever
    // a file watcher gets to it (macOS delivers those late).
    await this.options.authority.refresh()
    await this.records.rebind(liveGrant(this.options.authority)?.generation)
  }

  /** The scopes this client may be given: the live grant's, within what the client itself declares. */
  private availableScopes(declared: string | undefined): ConnectorScope[] {
    const grant = this.grantScopes()
    const ceiling = scopesIn(declared)
    return ceiling.length === 0 ? grant : grant.filter((scope) => ceiling.includes(scope))
  }

  private configuration(signingJwk: Record<string, unknown>): Configuration {
    const options = this.options
    const policy = interactionPolicy.base()
    // The person allows every sign-in, each time: no remembered session skips it.
    policy
      .get('login')
      ?.checks.add(
        new interactionPolicy.Check(
          'owner_each_time',
          'The owner allows each sign-in',
          (ctx) => ctx.oidc.result?.login === undefined,
        ),
        0,
      )
    return {
      adapter: connectorAdapter(this.records),
      jwks: { keys: [{ ...signingJwk, kty: 'EC' }] },
      cookies: {
        keys: [randomBytes(CONNECTOR_REMOTE_LIMITS.cookieKeyBytes).toString('base64url')],
      },
      clientDefaults: {
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        id_token_signed_response_alg: 'ES256',
      },
      // Public clients only: PKCE stands in for a secret.
      clientAuthMethods: ['none'],
      // The names a client may declare in its own metadata; resource scopes below narrow them.
      scopes: [...CONNECTOR_SCOPES],
      pkce: { required: () => true },
      routes: {
        authorization: CONNECTOR_REMOTE_PATHS.authorize,
        token: CONNECTOR_REMOTE_PATHS.token,
        registration: CONNECTOR_REMOTE_PATHS.register,
        revocation: CONNECTOR_REMOTE_PATHS.revoke,
        jwks: CONNECTOR_REMOTE_PATHS.jwks,
      },
      features: {
        devInteractions: { enabled: false },
        registration: {
          enabled: options.allowOpenRegistration,
          initialAccessToken: false,
          issueRegistrationAccessToken: false,
        },
        registrationManagement: { enabled: false },
        revocation: { enabled: true },
        userinfo: { enabled: false },
        rpInitiatedLogout: { enabled: false },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => this.resource,
          useGrantedResource: () => true,
          getResourceServerInfo: (_ctx, indicator, client) => {
            if (indicator !== this.resource) throw new errors.InvalidTarget()
            if (liveGrant(options.authority) === undefined) {
              throw new errors.AccessDenied('no active connection grant')
            }
            return {
              scope: this.availableScopes(client.metadata().scope).join(' '),
              audience: this.resource,
              accessTokenTTL: options.accessTokenTtlSeconds,
              accessTokenFormat: 'opaque',
            }
          },
        },
        clientIdMetadataDocument: {
          enabled: true,
          // The draft the profile cites; the library names its revision.
          ack: 'draft-02',
          allowFetch: (_ctx, clientId) => new URL(clientId).pathname !== '/',
          allowClient: (_ctx, client) => client.redirectUris?.every(isAllowedRedirectUri) ?? false,
        },
      },
      ttl: {
        AccessToken: options.accessTokenTtlSeconds,
        AuthorizationCode: CONNECTOR_REMOTE_LIMITS.codeTtlSeconds,
        RefreshToken: options.signInTtlSeconds,
        Grant: options.signInTtlSeconds,
        Interaction: CONNECTOR_REMOTE_LIMITS.interactionTtlSeconds,
        Session: CONNECTOR_REMOTE_LIMITS.sessionTtlSeconds,
      },
      // A sign-in outlives the owner's browser session on the consent page.
      expiresWithSession: () => false,
      issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
      rotateRefreshToken: true,
      // Every authorization asks the owner afresh: only the grant the owner has just
      // answered with is used, never one remembered from an earlier session.
      loadExistingGrant: async (ctx) => {
        const grantId = ctx.oidc.result?.consent?.grantId
        return grantId === undefined ? undefined : await ctx.oidc.provider.Grant.find(grantId)
      },
      findAccount: (_ctx, id) =>
        Promise.resolve({ accountId: id, claims: () => Promise.resolve({ sub: id }) }),
      interactions: {
        policy,
        url: (_ctx, interaction) => `${CONNECTOR_REMOTE_PATHS.interaction}/${interaction.uid}`,
      },
      // A browser-based client may call the token endpoint from its own page.
      clientBasedCORS: (_ctx, origin, client) =>
        client.redirectUris?.some((uri) => new URL(uri).origin === origin) ?? false,
      renderError: (ctx, out) => {
        ctx.status = out.error === 'server_error' ? HTTP_STATUS.internalServerError : ctx.status
        ctx.type = 'html'
        for (const [name, value] of Object.entries(PAGE_HEADERS)) ctx.set(name, value)
        ctx.body = renderMessagePage(
          UI_TEXT.acpConnectorRemote.errorTitle,
          fill(UI_TEXT.acpConnectorRemote.errorBody, { error: out.error }),
        )
        return Promise.resolve()
      },
    }
  }

  private rotateOwnerCode(): void {
    this.ownerCode = newOwnerCode()
    this.ownerCodeFailures = 0
    this.options.onOwnerCode(this.ownerCode)
  }

  private isOwnerCode(given: string): boolean {
    return timingSafeEqual(digestOf(normalizedCode(given)), digestOf(this.ownerCode))
  }

  /** The consent page (GET) and the person's answer (POST) for one pending sign-in. */
  private async interaction(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const text = UI_TEXT.acpConnectorRemote
    const uid = url.pathname.slice(`${CONNECTOR_REMOTE_PATHS.interaction}/`.length)
    const method = request.method ?? ''
    if (method !== 'GET' && method !== 'POST') {
      sendJson(response, HTTP_STATUS.methodNotAllowed, { error: 'invalid_request' })
      return
    }
    const expired = (): void => {
      sendPage(
        response,
        HTTP_STATUS.badRequest,
        renderMessagePage(text.errorTitle, text.consentExpired),
      )
    }
    let details
    try {
      details = await this.provider.interactionDetails(request, response)
    } catch (error: unknown) {
      if (!(error instanceof errors.SessionNotFound)) throw error
      expired()
      return
    }
    const params = details.params
    const clientId = typeof params['client_id'] === 'string' ? params['client_id'] : undefined
    const redirectUri =
      typeof params['redirect_uri'] === 'string' ? params['redirect_uri'] : undefined
    const client = clientId === undefined ? undefined : await this.provider.Client.find(clientId)
    if (client === undefined || redirectUri === undefined || details.uid !== uid) {
      expired()
      return
    }
    const redirect = new URL(redirectUri)
    const requested = scopesIn(typeof params['scope'] === 'string' ? params['scope'] : undefined)
    const available = this.availableScopes(client.metadata().scope)
    const scopes =
      requested.length === 0 ? available : requested.filter((s) => available.includes(s))
    const isBlocked =
      scopes.length === 0 ||
      !isAllowedRedirectUri(redirectUri) ||
      !client.redirectUris?.includes(redirectUri)
    const view = {
      uid,
      clientName: client.clientName ?? client.clientId,
      clientAddress: client.clientId.startsWith('https:') ? client.clientId : undefined,
      returnHost: redirect.host,
      isLoopbackReturn: isLoopbackHost(redirect.hostname),
      scopes,
      isBlocked,
      wrongCode: false,
    }
    if (method === 'GET') {
      sendPage(response, HTTP_STATUS.ok, renderConsentPage(view))
      return
    }
    const origin = request.headers.origin
    if (origin !== undefined && origin !== new URL(this.options.issuer).origin) {
      sendJson(response, HTTP_STATUS.forbidden, { error: 'access_denied' })
      return
    }
    const form = await readForm(request, CONNECTOR_REMOTE_LIMITS.formBodyBytes)
    if (form === undefined) {
      sendJson(response, HTTP_STATUS.badRequest, { error: 'invalid_request' })
      return
    }
    if (form.get('decision') !== 'allow') {
      await this.provider.interactionFinished(
        request,
        response,
        { error: 'access_denied', error_description: 'The owner denied the sign-in.' },
        { mergeWithLastSubmission: false },
      )
      return
    }
    if (isBlocked) {
      sendPage(response, HTTP_STATUS.forbidden, renderConsentPage(view))
      return
    }
    if (!this.isOwnerCode(form.get('code') ?? '')) {
      this.ownerCodeFailures += 1
      if (this.ownerCodeFailures >= CONNECTOR_REMOTE_LIMITS.ownerCodeFailuresMax)
        this.rotateOwnerCode()
      sendPage(response, HTTP_STATUS.forbidden, renderConsentPage({ ...view, wrongCode: true }))
      return
    }
    const grant = new this.provider.Grant({
      accountId: CONNECTOR_REMOTE_OWNER_ACCOUNT,
      clientId: client.clientId,
    })
    grant.addOIDCScope(scopes.join(' '))
    grant.addResourceScope(this.resource, scopes.join(' '))
    const grantId = await grant.save()
    this.rotateOwnerCode()
    await this.provider.interactionFinished(
      request,
      response,
      {
        login: { accountId: CONNECTOR_REMOTE_OWNER_ACCOUNT, remember: false },
        consent: { grantId },
      },
      { mergeWithLastSubmission: false },
    )
  }

  /**
  The library builds every endpoint URL from this request. The configured
  issuer is that base: a tunnel copies a client's `X-Forwarded-Host` (Koa
  prefers its first value once `proxy` is on) and an absolute-form request
  line is the whole URL, so neither may rename the token, key or revocation
  address.
  */
  private pinIssuer(request: IncomingMessage): boolean {
    const issuer = new URL(this.options.issuer)
    request.headers.host = issuer.host
    delete request.headers['x-forwarded-port']
    delete request.headers.forwarded
    if (this.options.isBehindTls) {
      request.headers['x-forwarded-proto'] = 'https'
      request.headers['x-forwarded-host'] = issuer.host
    } else {
      delete request.headers['x-forwarded-host']
      delete request.headers['x-forwarded-proto']
    }
    const target = request.url
    if (typeof target !== 'string' || !/^https?:\/\//iu.test(target)) return true
    if (!URL.canParse(target)) return false
    const absolute = new URL(target)
    request.url = `${absolute.pathname}${absolute.search}`
    return true
  }

  public get resource(): string {
    return `${this.options.issuer}${CONNECTOR_REMOTE_PATHS.mcp}`
  }

  /** The RFC 6750 / RFC 9728 challenge for a refused MCP request, with discovery and scope guidance. */
  public challenge(isInvalidToken: boolean): string {
    const scope = this.grantScopes().join(' ')
    const parts = [
      ...(isInvalidToken ? ['error="invalid_token"'] : []),
      `resource_metadata="${this.metadataUrl}"`,
      ...(scope === '' ? [] : [`scope="${scope}"`]),
    ]
    return `Bearer ${parts.join(', ')}`
  }

  /** Everything this server answers except the MCP endpoint itself. */
  public handles(pathname: string): boolean {
    const paths: readonly string[] = Object.values(CONNECTOR_REMOTE_PATHS).filter(
      (path) => path !== CONNECTOR_REMOTE_PATHS.mcp,
    )
    return (
      paths.includes(pathname) ||
      pathname.startsWith(`${CONNECTOR_REMOTE_PATHS.interaction}/`) ||
      pathname.startsWith(`${CONNECTOR_REMOTE_PATHS.authorize}/`) ||
      pathname === `${CONNECTOR_REMOTE_PATHS.protectedResource}${CONNECTOR_REMOTE_PATHS.mcp}`
    )
  }

  /** Serves one request that `handles` named. */
  public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    await this.reconcile()
    const url = new URL(request.url ?? '/', this.options.issuer)
    const method = request.method ?? ''
    if (
      url.pathname === CONNECTOR_REMOTE_PATHS.protectedResource ||
      url.pathname === `${CONNECTOR_REMOTE_PATHS.protectedResource}${CONNECTOR_REMOTE_PATHS.mcp}`
    ) {
      if (method !== 'GET') {
        sendJson(response, HTTP_STATUS.methodNotAllowed, { error: 'invalid_request' })
        return
      }
      sendJson(response, HTTP_STATUS.ok, {
        resource: this.resource,
        authorization_servers: [this.options.issuer],
        scopes_supported: this.grantScopes(),
        bearer_methods_supported: ['header'],
      })
      return
    }
    if (url.pathname.startsWith(`${CONNECTOR_REMOTE_PATHS.interaction}/`)) {
      await this.interaction(request, response, url)
      return
    }
    if (
      method === 'POST' &&
      url.pathname === CONNECTOR_REMOTE_PATHS.register &&
      this.records.openClientCount() >= CONNECTOR_REMOTE_LIMITS.openClientsMax
    ) {
      sendJson(response, HTTP_STATUS.serviceUnavailable, { error: 'temporarily_unavailable' })
      return
    }
    if (method === 'GET' && url.pathname === CONNECTOR_REMOTE_PATHS.authorize) {
      if (this.records.pendingInteractions() >= CONNECTOR_REMOTE_LIMITS.interactionsMax) {
        sendJson(response, HTTP_STATUS.serviceUnavailable, { error: 'temporarily_unavailable' })
        return
      }
      // A request that names no scope asks for what the grant allows it.
      if (!url.searchParams.has('scope') && this.grantScopes().length > 0) {
        url.searchParams.set('scope', this.grantScopes().join(' '))
        request.url = `${url.pathname}${url.search}`
      }
    }
    if (!this.pinIssuer(request)) {
      sendJson(response, HTTP_STATUS.badRequest, { error: 'invalid_request' })
      return
    }
    try {
      await this.provider.callback()(request, response)
    } catch (error: unknown) {
      if (!isOAuthRecordsFull(error)) throw error
      sendJson(response, HTTP_STATUS.serviceUnavailable, { error: 'temporarily_unavailable' })
    }
  }

  /**
  A bearer access token for this one resource, or undefined: unknown, spent,
  expired, issued for another resource, or issued under a grant that has
  since changed. Nothing is dispatched before this answers.
  */
  public async verifyAccessToken(token: string): Promise<VerifiedAccess | undefined> {
    await this.reconcile()
    if (liveGrant(this.options.authority) === undefined) return undefined
    const found = await this.provider.AccessToken.find(token)
    if (found === undefined) return undefined
    const audience = Array.isArray(found.aud) ? found.aud : [found.aud]
    if (!audience.includes(this.resource) || found.clientId === undefined) return undefined
    // The owner ended this client's sign-ins in another terminal: they end here, now.
    const owner = await ownerClients(this.options.store, this.options.connectionId)
    if (owner.revoked.includes(found.clientId)) {
      await this.records.revokeByGrantId(found.grantId)
      return undefined
    }
    return { clientId: found.clientId, scopes: scopesIn(found.scope) }
  }
}
