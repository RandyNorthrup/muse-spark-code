import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'
import { MCP_OAUTH_LIMITS, MILLISECONDS_PER_SECOND, VAULT_LIMITS } from '../../../shared/constants'
import {
  vaultItemSchema,
  vaultUseSchema,
  type VaultItem,
  type VaultUse,
} from '../../../shared/vault'
import { discoverMcpOAuth, oauthDenied, oauthJson, type McpOAuthNetworkPort } from './discovery'
import { isMcpSecretHeaderSafe } from '../../vault/mcpReferences'

const token = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.valueBytes), z.regex(/^[\u{21}-\u{7E}]+$/u))
const tokenReply = z.looseObject({
  access_token: token,
  token_type: z.string().check(z.refine((value) => value.toLowerCase() === 'bearer')),
  expires_in: z
    .number()
    .check(z.int(), z.positive(), z.maximum(MCP_OAUTH_LIMITS.maxExpiresSeconds)),
  refresh_token: z.optional(token),
  scope: z.optional(z.string().check(z.maxLength(VAULT_LIMITS.text))),
})
type OAuthItem = VaultItem & { material: Extract<VaultItem['material'], { kind: 'oauth' }> }

export interface McpOAuthBinding {
  readonly handle: string
  readonly resource: string
  readonly issuer: string
  readonly clientId: string
  readonly label: string
  readonly scopes: readonly string[]
}

export interface McpOAuthLoopbackPort {
  /** M95b opens only a loopback IP listener on an ephemeral port; closes on abort. */
  open(signal: AbortSignal): Promise<{
    redirectUri: string
    receive(): Promise<string>
    close(): void
  }>
  openBrowser(url: string): Promise<void>
}

/** Broker-local only. C commits encrypted state atomically, checking authorize at physical commit. */
export interface McpOAuthVaultPort {
  read(handle: string): Promise<VaultItem>
  /** Create rejects any existing name; rotation preserves item id, policy and bindings. */
  create(item: VaultItem, authorize: () => void): Promise<void>
  save(item: VaultItem, authorize: () => void): Promise<void>
  /** Quarantine an unusable rotation after uncertain/failing persistence; no stale refresh retry. */
  invalidate(handle: string, expectedItemId: string): Promise<void>
}

function wipe(item: VaultItem | undefined): void {
  if (item === undefined) return
  for (const field of Object.values(item.material)) if (field instanceof Uint8Array) field.fill(0)
}
function owned(text: string) {
  const bytes = Buffer.alloc(Buffer.byteLength(text))
  bytes.write(text)
  return bytes
}
function isSame(a: string, b: string): boolean {
  const left = owned(a)
  const right = owned(b)
  try {
    return left.length === right.length && timingSafeEqual(left, right)
  } finally {
    left.fill(0)
    right.fill(0)
  }
}
function bindingUse(binding: McpOAuthBinding): Extract<VaultUse, { kind: 'oauth' }> {
  const use = vaultUseSchema.parse({
    kind: 'oauth',
    origin: new URL(binding.resource).origin,
    issuer: binding.issuer,
    resource: binding.resource,
  })
  if (
    use.kind !== 'oauth' ||
    !use.origin.startsWith('https://') ||
    !/^secret:\/\/[a-z][a-z0-9-]{0,47}$/u.test(binding.handle) ||
    !token.safeParse(binding.clientId).success ||
    binding.scopes.some((scope) => !/^[\u{21}\u{23}-\u{5B}\u{5D}-\u{7E}]+$/u.test(scope))
  )
    oauthDenied()
  return use
}

export interface McpOAuthPermit {
  assertCurrent(): void
  finish(hasSucceeded: boolean): Promise<void>
}

/** One serialized owner per broker. Lock advances generation; revoke aborts only its handle. */
export class McpOAuthClient {
  private generation = 0
  private readonly active = new Map<AbortController, string>()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly unusable = new Set<string>()
  private readonly items = new Map<VaultItem, string>()
  private readonly headers = new Map<Headers, string>()
  private readonly buffers = new Map<Uint8Array, string>()
  constructor(
    private readonly ports: {
      network: McpOAuthNetworkPort
      vault: McpOAuthVaultPort
      loopback: McpOAuthLoopbackPort
      now(): number
      /** B binds policy/taint/presence, ticket redemption and active use lifetime. */
      authorize(
        handle: string,
        use: Extract<VaultUse, { kind: 'oauth' }>,
        signal: AbortSignal,
        intent: 'signIn' | 'use',
      ): Promise<McpOAuthPermit>
      /** T scrubs JSON/SSE/error bytes in the trusted transport before any consumer reads them. */
      scrub(response: Response, signal: AbortSignal): Promise<Response>
    },
  ) {}

  private async run<T>(
    handle: string,
    signal: AbortSignal,
    operation: (signal: AbortSignal, check: () => void) => Promise<T>,
  ): Promise<T> {
    const generation = this.generation
    const controller = new AbortController()
    const joined = AbortSignal.any([
      signal,
      controller.signal,
      AbortSignal.timeout(MCP_OAUTH_LIMITS.flowMs),
    ])
    this.active.set(controller, handle)
    const check = () => {
      joined.throwIfAborted()
      if (generation !== this.generation) oauthDenied()
    }
    const previous = this.tail
    const next = (async () => {
      try {
        await previous
      } catch {
        /* Each caller owns its failure. */
      }
      check()
      return await operation(joined, check)
    })()
    this.tail = next
    try {
      return await next
    } catch {
      oauthDenied()
    } finally {
      this.active.delete(controller)
      controller.abort()
    }
  }

  private async approved<T>(
    binding: McpOAuthBinding,
    use: Extract<VaultUse, { kind: 'oauth' }>,
    signal: AbortSignal,
    check: () => void,
    intent: 'signIn' | 'use',
    operation: (authorize: () => void) => Promise<T>,
  ): Promise<T> {
    const permit = await this.ports.authorize(binding.handle, use, signal, intent)
    let hasSucceeded = false
    const authorize = () => {
      check()
      permit.assertCurrent()
    }
    try {
      authorize()
      const result = await operation(authorize)
      authorize()
      hasSucceeded = true
      return result
    } finally {
      await permit.finish(hasSucceeded)
    }
  }

  private newItem(binding: McpOAuthBinding, reply: z.infer<typeof tokenReply>): OAuthItem {
    const now = this.ports.now()
    return {
      metadata: {
        id: randomUUID().replaceAll('-', ''),
        name: binding.handle.slice('secret://'.length),
        handle: binding.handle,
        label: binding.label,
        kind: 'oauth',
        bindings: [
          {
            kind: 'oauth',
            origin: new URL(binding.resource).origin,
            issuer: binding.issuer,
            resource: binding.resource,
          },
        ],
        requirePresence: false,
        hidden: false,
        firstParty: false,
        policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
        dates: { createdAt: now, rotatedAt: null, expiresAt: null, lastUsedAt: null },
        publicKey: null,
        fingerprint: null,
      },
      material: {
        kind: 'oauth',
        accessToken: owned(reply.access_token),
        refreshToken: reply.refresh_token === undefined ? null : owned(reply.refresh_token),
        issuer: binding.issuer,
        resource: binding.resource,
        expiresAt: now + reply.expires_in * MILLISECONDS_PER_SECOND,
      },
    }
  }

  invalidate(handle?: string): void {
    if (handle === undefined) this.generation++
    for (const [active, owner] of this.active)
      if (handle === undefined || owner === handle) active.abort()
    for (const [item, owner] of this.items) if (handle === undefined || owner === handle) wipe(item)
    for (const [headers, owner] of this.headers)
      if (handle === undefined || owner === handle) headers.delete('authorization')
    for (const [buffer, owner] of this.buffers)
      if (handle === undefined || owner === handle) buffer.fill(0)
  }

  async signIn(input: McpOAuthBinding, signal: AbortSignal): Promise<void> {
    const binding = structuredClone(input)
    const use = bindingUse(binding)
    await this.run(binding.handle, signal, async (joined, check) => {
      await this.approved(binding, use, joined, check, 'signIn', async (authorize) => {
        check()
        authorize()
        const metadata = await discoverMcpOAuth(
          this.ports.network,
          binding.resource,
          binding.issuer,
          joined,
        )
        check()
        authorize()
        const verifierBytes = randomBytes(MCP_OAUTH_LIMITS.randomBytes)
        const stateBytes = randomBytes(MCP_OAUTH_LIMITS.randomBytes)
        this.buffers.set(verifierBytes, binding.handle)
        this.buffers.set(stateBytes, binding.handle)
        let listener: Awaited<ReturnType<McpOAuthLoopbackPort['open']>> | undefined
        let item: OAuthItem | undefined
        try {
          listener = await this.ports.loopback.open(joined)
          check()
          authorize()
          const redirect = new URL(listener.redirectUri)
          if (
            redirect.protocol !== 'http:' ||
            !['127.0.0.1', '[::1]'].includes(redirect.hostname) ||
            redirect.port === '' ||
            redirect.username !== '' ||
            redirect.password !== '' ||
            redirect.search !== '' ||
            redirect.hash !== ''
          )
            oauthDenied()
          const verifier = verifierBytes.toString('base64url')
          const state = stateBytes.toString('base64url')
          const url = new URL(metadata.authorization_endpoint)
          const parameters = {
            response_type: 'code',
            client_id: binding.clientId,
            redirect_uri: listener.redirectUri,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            state,
            resource: binding.resource,
            scope: binding.scopes.join(' '),
          }
          for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
          await this.ports.loopback.openBrowser(url.href)
          check()
          authorize()
          const callback = new URL(await listener.receive())
          check()
          authorize()
          const states = callback.searchParams.getAll('state')
          const codes = callback.searchParams.getAll('code')
          const issuers = callback.searchParams.getAll('iss')
          if (
            callback.origin !== redirect.origin ||
            callback.pathname !== redirect.pathname ||
            callback.hash !== '' ||
            callback.username !== '' ||
            callback.password !== '' ||
            states.length !== 1 ||
            !isSame(states[0] ?? '', state) ||
            codes.length !== 1 ||
            !token.safeParse(codes[0]).success ||
            callback.searchParams.has('error') ||
            issuers.length > 1 ||
            (metadata.authorization_response_iss_parameter_supported === true &&
              issuers.length !== 1) ||
            (issuers.length === 1 && issuers[0] !== binding.issuer)
          )
            oauthDenied()
          // The callback is consumed; close the listener before any item can commit.
          const redirectUri = listener.redirectUri
          listener.close()
          listener = undefined
          const reply = tokenReply.parse(
            await oauthJson(this.ports.network, metadata.token_endpoint, {
              method: 'POST',
              signal: joined,
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: codes[0] ?? '',
                client_id: binding.clientId,
                redirect_uri: redirectUri,
                code_verifier: verifier,
                resource: binding.resource,
              }).toString(),
            }),
          )
          item = this.newItem(binding, reply)
          this.items.set(item, binding.handle)
          check()
          authorize()
          await this.ports.vault.create(item, () => {
            check()
            authorize()
          })
          check()
          authorize()
          this.unusable.delete(binding.handle)
        } finally {
          try {
            listener?.close()
          } finally {
            verifierBytes.fill(0)
            stateBytes.fill(0)
            this.buffers.delete(verifierBytes)
            this.buffers.delete(stateBytes)
            wipe(item)
            if (item !== undefined) this.items.delete(item)
          }
        }
      })
    })
  }

  /** Only the exact MCP resource receives Authorization. No token getter or upstream forwarding API. */
  async fetch(input: McpOAuthBinding, url: string, init: RequestInit): Promise<Response> {
    const binding = structuredClone(input)
    const use = bindingUse(binding)
    if (url !== binding.resource || init.redirect !== 'error' || this.unusable.has(binding.handle))
      oauthDenied()
    const headers = new Headers(init.headers)
    if (headers.has('authorization')) oauthDenied()
    for (const name of headers.keys()) if (!isMcpSecretHeaderSafe(name)) oauthDenied()
    const request = { ...init, headers }
    return await this.run(
      binding.handle,
      init.signal ?? new AbortController().signal,
      async (joined, check) => {
        if (this.unusable.has(binding.handle)) oauthDenied()
        return await this.approved(binding, use, joined, check, 'use', async (authorize) => {
          check()
          authorize()
          let item: VaultItem | undefined
          let parsed: VaultItem | undefined
          try {
            item = await this.ports.vault.read(binding.handle)
            this.items.set(item, binding.handle)
            check()
            authorize()
            parsed = vaultItemSchema.parse(item)
            this.items.set(parsed, binding.handle)
            if (
              parsed.metadata.handle !== binding.handle ||
              parsed.material.kind !== 'oauth' ||
              parsed.material.resource !== binding.resource ||
              parsed.material.issuer !== binding.issuer ||
              parsed.metadata.bindings.every(
                (target) =>
                  target.kind !== 'oauth' ||
                  target.origin !== use.origin ||
                  target.issuer !== binding.issuer ||
                  target.resource !== binding.resource,
              )
            )
              oauthDenied()
            const material = parsed.material
            if (material.expiresAt <= this.ports.now() + MCP_OAUTH_LIMITS.refreshSlackMs) {
              if (material.refreshToken === null) oauthDenied()
              const metadata = await discoverMcpOAuth(
                this.ports.network,
                binding.resource,
                binding.issuer,
                joined,
              )
              check()
              authorize()
              const dispatch = { hasStarted: false }
              try {
                const previous = new TextDecoder('utf-8', { fatal: true }).decode(
                  material.refreshToken,
                )
                const reply = tokenReply.parse(
                  await oauthJson(
                    this.ports.network,
                    metadata.token_endpoint,
                    {
                      method: 'POST',
                      signal: joined,
                      headers: { 'content-type': 'application/x-www-form-urlencoded' },
                      body: new URLSearchParams({
                        grant_type: 'refresh_token',
                        refresh_token: previous,
                        client_id: binding.clientId,
                        resource: binding.resource,
                      }).toString(),
                    },
                    false,
                    () => {
                      check()
                      authorize()
                      dispatch.hasStarted = true
                      this.unusable.add(binding.handle)
                    },
                  ),
                )
                if (reply.refresh_token === undefined || isSame(reply.refresh_token, previous))
                  oauthDenied()
                material.accessToken.fill(0)
                material.refreshToken.fill(0)
                material.accessToken = owned(reply.access_token)
                material.refreshToken = owned(reply.refresh_token)
                material.expiresAt = this.ports.now() + reply.expires_in * MILLISECONDS_PER_SECOND
                parsed.metadata.dates.rotatedAt = this.ports.now()
                check()
                authorize()
                await this.ports.vault.save(parsed, () => {
                  check()
                  authorize()
                })
                check()
                authorize()
                this.unusable.delete(binding.handle)
              } catch {
                if (dispatch.hasStarted)
                  await this.ports.vault.invalidate(binding.handle, parsed.metadata.id)
                oauthDenied()
              }
            }
            check()
            authorize()
            if (!(await this.ports.network.allowEndpoint(url))) oauthDenied()
            check()
            authorize()
            const access = new TextDecoder('utf-8', { fatal: true }).decode(material.accessToken)
            if (!token.safeParse(access).success) oauthDenied()
            headers.set('authorization', `Bearer ${access}`)
            this.headers.set(headers, binding.handle)
            try {
              const response = await this.ports.network.fetch(url, {
                ...request,
                headers,
                signal: joined,
                redirect: 'error',
              })
              check()
              authorize()
              if (response.redirected || (response.url !== '' && response.url !== url)) {
                await response.body?.cancel()
                oauthDenied()
              }
              const scrubbed = await this.ports.scrub(response, joined)
              check()
              authorize()
              return scrubbed
            } finally {
              headers.delete('authorization')
              this.headers.delete(headers)
            }
          } finally {
            wipe(parsed)
            wipe(item)
            if (parsed !== undefined) this.items.delete(parsed)
            if (item !== undefined) this.items.delete(item)
          }
        })
      },
    )
  }
}
