import * as z from 'zod/mini'
import { HTTP_STATUS, MCP_OAUTH_LIMITS, UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { vaultIssuerSchema } from '../../../shared/vault'

const strings = z.array(z.string().check(z.maxLength(VAULT_LIMITS.text)))
const endpoint = z.url().check(
  z.refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      !/[\\\s]/u.test(value)
    )
  }),
)
const protectedResource = z.looseObject({
  resource: endpoint,
  authorization_servers: z
    .array(vaultIssuerSchema)
    .check(z.minLength(1), z.maxLength(VAULT_LIMITS.names)),
})
const authorizationServer = z.looseObject({
  issuer: vaultIssuerSchema,
  authorization_endpoint: endpoint,
  token_endpoint: endpoint,
  response_types_supported: strings,
  code_challenge_methods_supported: strings,
  grant_types_supported: z.optional(strings),
  token_endpoint_auth_methods_supported: z.optional(strings),
  authorization_response_iss_parameter_supported: z.optional(z.boolean()),
})
export type McpOAuthDiscovery = z.infer<typeof authorizationServer>

export interface McpOAuthNetworkPort {
  readonly fetch: typeof fetch
  /** Host network posture: public destinations or an explicitly approved private origin only. */
  allowEndpoint(url: string): Promise<boolean>
}

export function oauthDenied(): never {
  throw new Error(UI_TEXT.vault.noAccess)
}

/** Body bounded before JSON/Zod; failures never expose endpoint bodies or exception text. */
export async function oauthJson(
  network: McpOAuthNetworkPort,
  url: string,
  init: RequestInit,
  canBeMissing = false,
): Promise<unknown> {
  let response: Response | undefined
  let bytes: Buffer | undefined
  const chunks: Uint8Array[] = []
  try {
    if (!endpoint.safeParse(url).success || !(await network.allowEndpoint(url))) oauthDenied()
    init.signal?.throwIfAborted()
    response = await network.fetch(url, { ...init, redirect: 'error' })
    if (canBeMissing && response.status === HTTP_STATUS.notFound) return undefined
    if (
      !response.ok ||
      response.redirected ||
      (response.url !== '' && response.url !== url) ||
      (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim() !== 'application/json'
    )
      oauthDenied()
    let size = 0
    if (response.body !== null) {
      for await (const rawChunk of response.body) {
        const chunk = z.instanceof(Uint8Array).parse(rawChunk)
        chunks.push(chunk)
        size += chunk.byteLength
        if (size > MCP_OAUTH_LIMITS.responseBytes) oauthDenied()
      }
    }
    bytes = Buffer.alloc(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return parsed
  } catch {
    return oauthDenied()
  } finally {
    try {
      try {
        await response?.body?.cancel()
      } catch {
        /* Already consumed/locked stream. */
      }
    } finally {
      bytes?.fill(0)
      for (const chunk of chunks) chunk.fill(0)
    }
  }
}

/** RFC 9728 and RFC 8414 path-aware discovery; OIDC fallback uses the issuer's path. */
export async function discoverMcpOAuth(
  network: McpOAuthNetworkPort,
  resource: string,
  issuer: string,
  signal: AbortSignal,
): Promise<McpOAuthDiscovery> {
  if (!endpoint.safeParse(resource).success || !vaultIssuerSchema.safeParse(issuer).success)
    oauthDenied()
  const target = new URL(resource)
  const resourceMetadata = new URL(
    `/.well-known/oauth-protected-resource${target.pathname === '/' ? '' : target.pathname}`,
    target.origin,
  ).href
  let resourceRaw = await oauthJson(network, resourceMetadata, { signal }, true)
  if (resourceRaw === undefined && target.pathname !== '/') {
    resourceRaw = await oauthJson(
      network,
      `${target.origin}/.well-known/oauth-protected-resource`,
      { signal },
    )
  }
  let metadata: z.infer<typeof protectedResource>
  try {
    metadata = protectedResource.parse(resourceRaw)
  } catch {
    oauthDenied()
  }
  if (metadata.resource !== resource || !metadata.authorization_servers.includes(issuer))
    oauthDenied()
  const authority = new URL(issuer)
  const suffix = authority.pathname === '/' ? '' : authority.pathname
  const discoveryUrl = new URL(`/.well-known/oauth-authorization-server${suffix}`, authority.origin)
    .href
  let raw = await oauthJson(network, discoveryUrl, { signal }, true)
  if (raw === undefined) {
    signal.throwIfAborted()
    raw = await oauthJson(
      network,
      `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`,
      { signal },
    )
  }
  let result: McpOAuthDiscovery
  try {
    result = authorizationServer.parse(raw)
  } catch {
    oauthDenied()
  }
  if (
    result.issuer !== issuer ||
    !result.response_types_supported.includes('code') ||
    !result.code_challenge_methods_supported.includes('S256') ||
    (result.grant_types_supported !== undefined &&
      !result.grant_types_supported.includes('authorization_code')) ||
    (result.token_endpoint_auth_methods_supported !== undefined &&
      !result.token_endpoint_auth_methods_supported.includes('none'))
  )
    oauthDenied()
  if (
    !(await network.allowEndpoint(result.authorization_endpoint)) ||
    !(await network.allowEndpoint(result.token_endpoint))
  )
    oauthDenied()
  return result
}
