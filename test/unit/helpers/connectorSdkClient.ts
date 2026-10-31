// The official MCP SDK client (@modelcontextprotocol/sdk, the TypeScript SDK
// MCP publishes) signing in to the connector the way a person's agent does:
// it finds the authorization server from the 401, registers or uses the
// client id it was given, runs the authorization code flow with PKCE and the
// resource indicator, and calls the MCP endpoint with the bearer token. Only
// its storage is ours (memory), as every client's storage is its own.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { browse, type Answer, type BrowserResult, type RunningRemote } from './connectorRemote'

export const CLIENT_REDIRECT = 'http://127.0.0.1:8765/callback'

export class SdkSession implements OAuthClientProvider {
  private verifier = ''
  public authorizationUrl: URL | undefined
  public tokenSet: OAuthTokens | undefined
  public registration: OAuthClientInformationMixed | undefined

  public constructor(preregistered?: OAuthClientInformationMixed) {
    this.registration = preregistered
  }

  public get redirectUrl(): string {
    return CLIENT_REDIRECT
  }

  public get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'SDK test client',
      redirect_uris: [CLIENT_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  public clientInformation(): OAuthClientInformationMixed | undefined {
    return this.registration
  }

  public saveClientInformation(information: OAuthClientInformationMixed): void {
    this.registration = information
  }

  public tokens(): OAuthTokens | undefined {
    return this.tokenSet
  }

  public saveTokens(tokens: OAuthTokens): void {
    this.tokenSet = tokens
  }

  public redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url
  }

  public saveCodeVerifier(verifier: string): void {
    this.verifier = verifier
  }

  public codeVerifier(): string {
    return this.verifier
  }
}

export interface Connected {
  readonly client: Client
  readonly session: SdkSession
  /** The consent page the person saw while signing in. */
  readonly page: string
}

function newTransport(url: string, session: SdkSession): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(url), { authProvider: session })
}

/** Connects with what the session holds; undefined when the server asks for a sign-in. */
export async function tryConnect(url: string, session: SdkSession): Promise<Client | undefined> {
  const client = new Client({ name: 'sdk-suite', version: '0.0.0' })
  try {
    // The SDK's own transport: its `sessionId` getter is `string | undefined`
    // where its `Transport` interface declares `sessionId?: string`, which
    // exactOptionalPropertyTypes will not assign (PLAN.md §8, RLF-M124RO).
    await client.connect(newTransport(url, session) as Transport)
    return client
  } catch (error: unknown) {
    if (!(error instanceof UnauthorizedError)) throw error
    return undefined
  }
}

/**
The whole sign-in: 401, discovery, registration, the person's browser, token,
connect. Answers what the browser was left at when it was not sent back to the
client (a refusal, a wrong code).
*/
export async function signIn(
  remote: RunningRemote,
  session: SdkSession,
  answer?: Answer,
): Promise<Connected | BrowserResult> {
  const decision: Answer = answer ?? { decision: 'allow', code: remote.ownerCode() }
  const first = await tryConnect(remote.mcpUrl, session)
  if (first !== undefined) return { client: first, session, page: '' }
  if (session.authorizationUrl === undefined) throw new Error('the client asked for no sign-in')
  const browsed = await browse(session.authorizationUrl, decision, (url) =>
    url.href.startsWith(CLIENT_REDIRECT),
  )
  const code = browsed.landed.searchParams.get('code')
  if (code === null || !browsed.landed.href.startsWith(CLIENT_REDIRECT)) return browsed
  await newTransport(remote.mcpUrl, session).finishAuth(code)
  const client = await tryConnect(remote.mcpUrl, session)
  if (client === undefined) throw new Error('signed in, but the endpoint still asks for a sign-in')
  return { client, session, page: browsed.page }
}

export function isConnected(result: Connected | BrowserResult): result is Connected {
  return 'client' in result
}
