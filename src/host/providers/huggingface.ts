// Hugging Face "Sign in with HF" as a first-class provider (M95b step 5;
// research §6.5, read 2026-10-04, re-verified 2026-10-22). OAuth PKCE
// (S256, the shared loopback callback with a random port and `state`)
// with the `inference-api` scope ("Make inference requests to Inference
// Providers on behalf of the user"). The access token is stored like a
// pasted one, bound to `https://huggingface.co`, and proven by the
// preset's own `whoami-v2` key test; inference rides the router with it
// as a Bearer token.
//
// The OAuth app does not exist yet: the owner registers it (a public
// app, no secret) at https://huggingface.co/settings/applications/new
// with redirect URI `http://127.0.0.1/callback` (any port is accepted
// at request time, RFC 8252 §7.3) and the issued client id lands in
// HF_OAUTH_CLIENT_ID below. Until then every connect refuses closed
// with the sentence that names that step. A remote window refuses too:
// HF documents no pasted-code authorize flow (its remote answer is the
// device flow, which lands with the registration).
import * as z from 'zod/mini'
import { unlessAborted } from '../../core/timeouts'
import { UI_TEXT } from '../../shared/constants'
import type { Logger } from '../logger'
import { exchangeCodeForStoredKey } from './codeExchange'
import type { CredentialRecord } from './credentialRecords'
import type { OAuthLoopback } from './oauthLoopback'
import type { CodeExchanger, PkceSource } from './providerPorts'

export const HF_ORIGIN = 'https://huggingface.co'
/** The documented OAuth authorize page (https://huggingface.co/docs/hub/oauth). */
export const HF_AUTH_URL = 'https://huggingface.co/oauth/authorize'
/** The documented token endpoint (code exchange and device polling alike). */
export const HF_TOKEN_URL = 'https://huggingface.co/oauth/token'
/** Least privilege: inference on the user's behalf, nothing else. */
export const HF_OAUTH_SCOPES = 'inference-api'
/** Where the owner registers the public OAuth app (Capture-the-app). */
export const HF_OAUTH_APP_URL = 'https://huggingface.co/settings/applications/new'

/**
The registered app's client id. Undefined until the owner registers the
app (see above): the product refuses every Hugging Face connect closed
until the issued id lands here.
*/
export const HF_OAUTH_CLIENT_ID: string | undefined = undefined

export interface HuggingFaceAuthorizeRequest {
  readonly clientId: string
  readonly challenge: string
  readonly state: string
  readonly redirectUri: string
}

/** The authorize URL for the loopback callback (standard OAuth2 + PKCE). */
export function huggingfaceAuthorizeUrl(request: HuggingFaceAuthorizeRequest): string {
  const params = new URLSearchParams()
  params.set('client_id', request.clientId)
  params.set('redirect_uri', request.redirectUri)
  params.set('response_type', 'code')
  params.set('scope', HF_OAUTH_SCOPES)
  params.set('state', request.state)
  params.set('code_challenge', request.challenge)
  params.set('code_challenge_method', 'S256')
  return `${HF_AUTH_URL}?${params.toString()}`
}

/** The documented token answer: a Bearer access token, expiry and refresh optional. */
export const huggingfaceTokenSchema = z.object({
  access_token: z.string().check(z.minLength(1)),
  token_type: z.string(),
  expires_in: z.optional(z.number()),
  refresh_token: z.optional(z.string()),
  scope: z.optional(z.string()),
})
export type HuggingfaceToken = z.infer<typeof huggingfaceTokenSchema>

export interface HuggingFaceConnectDeps {
  readonly clientId: string
  readonly log: Logger
  readonly pkce: PkceSource
  readonly exchange: CodeExchanger
  /** Opens the authorize page in the system browser. */
  readonly openBrowser: (url: string) => Promise<void>
  /** The shared one-shot loopback server. */
  readonly startServer: (state: string) => Promise<OAuthLoopback>
  /** True in a remote window: no loopback callback is attempted. */
  readonly isRemote: boolean
  readonly signal?: AbortSignal
  readonly onDiscardedKey?: () => void
}

export interface HuggingFaceConnection {
  /** The access token, for the caller to store bound to `HF_ORIGIN`. */
  readonly key: string
  readonly record: CredentialRecord
}

/**
Connects the Hugging Face account: browser approval, one code exchange.
The connected token and its record, refusing closed while the app is
unregistered or the window is remote. Unrelated callbacks are ignored;
a refusal with the right state, a missing code or failed exchange
rejects. The loopback closes in every path.
*/
/**
Refuses a Hugging Face connect closed: until the owner registers the
OAuth app, and in a remote window (HF documents no pasted-code
authorize flow; its remote answer is the device flow). Pure: the
product calls it before touching any seam, and the flow re-checks its
own inputs with it.
*/
export function huggingfaceConnectRefusal(
  clientId: string | undefined,
  isRemote: boolean,
): string | undefined {
  if (clientId === undefined || clientId === '') return UI_TEXT.huggingfaceOAuthNotRegistered
  return isRemote ? UI_TEXT.huggingfaceRemoteWindow : undefined
}

export async function connectHuggingFaceAccount(
  deps: HuggingFaceConnectDeps,
): Promise<HuggingFaceConnection> {
  const refusal = huggingfaceConnectRefusal(deps.clientId, deps.isRemote)
  if (refusal !== undefined) throw new Error(refusal)
  const signal = deps.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const pair = deps.pkce.create()
  const state = deps.pkce.newState()
  const server = await deps.startServer(state)
  const close = () => {
    server.close()
  }
  deps.signal?.addEventListener('abort', close, { once: true })
  let code: string
  try {
    deps.signal?.throwIfAborted()
    // Listen before opening the browser; a fast callback must not be lost.
    const waited = server.waitForCode()
    void waited.catch(() => {
      // The await below still rejects with this failure; the record keeps that it happened.
      deps.log.warn('Hugging Face loopback callback failed before it was awaited')
    })
    await unlessAborted(
      deps.openBrowser(
        huggingfaceAuthorizeUrl({
          clientId: deps.clientId,
          challenge: pair.challenge,
          state,
          redirectUri: server.redirectUri,
        }),
      ),
      signal,
    )
    const callback = await waited
    code = callback.code
  } finally {
    server.close()
    deps.signal?.removeEventListener('abort', close)
  }
  return await exchangeCodeForStoredKey({
    exchange: deps.exchange,
    code,
    verifier: pair.verifier,
    redirectUri: server.redirectUri,
    origin: HF_ORIGIN,
    connectFailed: UI_TEXT.huggingfaceConnectFailed,
    ...(deps.signal !== undefined && { signal: deps.signal }),
    ...(deps.onDiscardedKey !== undefined && { onDiscardedKey: deps.onDiscardedKey }),
  })
}
