// M124 remote (D217): the strict contracts of the connector's HTTPS
// authorization server, served by the person's own PC. The protocol itself
// (OAuth 2.1 authorization code with PKCE, Protected Resource Metadata,
// Authorization Server Metadata, resource indicators, Dynamic Client
// Registration, Client ID Metadata Documents, revocation) is the
// `oidc-provider` library's; what lives here is only what this product
// stores and judges itself: its owner-only state file, and the redirect
// URI rule of the MCP authorization profile (2025-11-25 and 2026-07-28).
import * as z from 'zod/mini'
import { connectorScopeSchema } from './connector'
import { CONNECTOR_LIMITS } from './constants'

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', 'localhost'])

/**
A redirect URI as the MCP authorization profile allows it ("All redirect
URIs MUST be either `localhost` or use HTTPS"): HTTPS, or HTTP on a
loopback host; no credentials in it and no fragment.
*/
export function isAllowedRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  const hasExtras = url.username !== '' || url.password !== '' || url.hash !== ''
  return (
    !hasExtras &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
  )
}

/** True for `localhost` and the loopback addresses: a redirect URI the consent page warns about. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname)
}

export const redirectUriSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(CONNECTOR_LIMITS.textBytes), z.refine(isAllowedRedirectUri))

/**
The stored models. Clients, grants and the two token kinds survive a
restart; sessions, interactions and authorization codes live minutes and
are held in memory only.
*/
export const CONNECTOR_OAUTH_MODELS = ['Client', 'Grant', 'AccessToken', 'RefreshToken'] as const
export type ConnectorOAuthModel = (typeof CONNECTOR_OAUTH_MODELS)[number]

/**
One stored record. A token is keyed by the SHA-256 digest of its value:
the file never holds a bearer secret, only what a digest can prove.
*/
export const connectorOAuthRecordSchema = z.strictObject({
  model: z.enum(CONNECTOR_OAUTH_MODELS),
  key: z.string().check(z.minLength(1)),
  payload: z.record(z.string(), z.unknown()),
  /** Epoch milliseconds; absent for a record that lapses only with its grant. */
  expiresAt: z.optional(z.number().check(z.int(), z.gte(0))),
})
export type ConnectorOAuthRecord = z.infer<typeof connectorOAuthRecordSchema>

/** The running server's OAuth state for one connection, one owner-only file, one writer. */
export const connectorOAuthStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.string().check(z.minLength(1)),
  /** The ES256 signing key as a private JWK; the public half is served as JWKS. */
  signingJwk: z.record(z.string(), z.unknown()),
  /** The connection grant's generation every token here was issued under. */
  boundGeneration: z.number().check(z.int(), z.gte(0)),
  records: z.array(connectorOAuthRecordSchema),
})
export type ConnectorOAuthState = z.infer<typeof connectorOAuthStateSchema>

/** A client the owner registered with `mcp client add`. */
export const connectorOwnerClientSchema = z.strictObject({
  clientId: z.string().check(z.minLength(1), z.maxLength(CONNECTOR_LIMITS.idChars)),
  clientName: z.string().check(z.maxLength(CONNECTOR_LIMITS.textBytes)),
  redirectUris: z.array(redirectUriSchema).check(z.minLength(1)),
  /** The most this client may ever be given; the live grant narrows it further. */
  scopes: z.array(connectorScopeSchema),
  createdAt: z.iso.datetime({ offset: true }),
})
export type ConnectorOwnerClient = z.infer<typeof connectorOwnerClientSchema>

/**
The owner's own file, written only by the owner's commands and read afresh
by the running server: the clients they registered, and the client ids
whose sign-ins they ended (registered by them or not).
*/
export const connectorOwnerClientsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.string().check(z.minLength(1)),
  clients: z.array(connectorOwnerClientSchema),
  revoked: z.array(z.string().check(z.minLength(1))),
})
export type ConnectorOwnerClients = z.infer<typeof connectorOwnerClientsSchema>
