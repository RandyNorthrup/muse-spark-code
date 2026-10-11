// OpenRouter as a first-class provider (M95 lane K, PLAN.md D74; research
// §1.8, read 2026-10-04). **Connect OpenRouter account** runs its OAuth
// PKCE flow (S256, the shared loopback callback with a random port and
// `state`; in a remote window the flow without a callback, whose code the
// user pastes into the password box). The key is stored like a pasted one,
// bound to `https://openrouter.ai`. The PKCE pair, the code exchange and
// the usage read are injected seams (lanes P and T, from the captures);
// this module owns the flow, the authorize URL, the spend-limit link and
// the usage validation.

import { createHash } from 'node:crypto'
import type { CredentialRecord } from './credentialRecords'
import type { OAuthLoopback } from './oauthLoopback'
import type { CodeExchanger, KeyUsageReader, KeyUsageSnapshot, PkceSource } from './providerPorts'

export const OPENROUTER_ORIGIN = 'https://openrouter.ai'
/** The documented OAuth authorize page (research §1.8, [OR2-oauth]). */
export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
/** The label the browser flow gives the created key. */
export const OPENROUTER_KEY_LABEL = 'Muse Spark Code (Unofficial)'

export interface OpenRouterAuthorizeRequest {
  readonly challenge: string
  readonly state: string
  /** Absent in a remote window: the page shows a code to paste instead. */
  readonly redirectUri?: string | undefined
}

/** The authorize URL, with or without the loopback callback. */
export function openRouterAuthorizeUrl(request: OpenRouterAuthorizeRequest): string {
  const params = new URLSearchParams()
  if (request.redirectUri !== undefined) {
    params.set('callback_url', request.redirectUri)
  }
  params.set('code_challenge', request.challenge)
  params.set('code_challenge_method', 'S256')
  params.set('key_label', OPENROUTER_KEY_LABEL)
  params.set('state', request.state)
  return `${OPENROUTER_AUTH_URL}?${params.toString()}`
}

/**
 * The key's own spend-limit page, deep-linked by the key's SHA-256
 * (research §1.8, [OR2-oauth]): a key's limit is set on OpenRouter's site,
 * never here. The hash names the page; only the key's owner can open it.
 */
export function openRouterSpendPage(key: string): string {
  const hash = createHash('sha256').update(key, 'utf8').digest('hex')
  return `https://openrouter.ai/keys/${hash}`
}

export interface OpenRouterConnectDeps {
  readonly pkce: PkceSource
  readonly exchange: CodeExchanger
  /** Opens the authorize page in the system browser. */
  readonly openBrowser: (url: string) => Promise<void>
  /** The shared one-shot loopback server. */
  readonly startServer: (state: string) => Promise<OAuthLoopback>
  /** The pasted-code box for a remote window (the password box). */
  readonly promptForPastedCode: () => Promise<string | undefined>
  /** True in a remote window: no loopback callback is attempted. */
  readonly isRemote: boolean
}

export interface OpenRouterConnection {
  /** The key, for the caller to store bound to `OPENROUTER_ORIGIN`. */
  readonly key: string
  readonly record: CredentialRecord
}

/**
 * Connects the OpenRouter account: browser approval, one code exchange.
 * The connected key and its record, or undefined when the user cancelled
 * (dismissed the pasted-code box). A wrong `state`, a refused or missing
 * code, and a failed exchange all reject, and the loopback is closed in
 * every path.
 */
export async function connectOpenRouterAccount(
  deps: OpenRouterConnectDeps,
): Promise<OpenRouterConnection | undefined> {
  const pair = deps.pkce.create()
  const state = deps.pkce.newState()
  let code: string | undefined
  // The exchange repeats the callback it authorized with; a remote window
  // authorized with none.
  let redirectUri = ''
  if (deps.isRemote) {
    await deps.openBrowser(openRouterAuthorizeUrl({ challenge: pair.challenge, state }))
    const pasted = await deps.promptForPastedCode()
    if (pasted === undefined || pasted.trim() === '') {
      return undefined
    }
    code = pasted.trim()
  } else {
    const server = await deps.startServer(state)
    try {
      redirectUri = server.redirectUri
      await deps.openBrowser(
        openRouterAuthorizeUrl({
          challenge: pair.challenge,
          state,
          redirectUri,
        }),
      )
      const callback = await server.waitForCode()
      code = callback.code
    } finally {
      server.close()
    }
  }
  const key = await deps.exchange.exchange({ code, verifier: pair.verifier, redirectUri })
  if (key.trim() === '') {
    throw new Error('OpenRouter returned an empty key')
  }
  const secret = key.trim()
  return { key: secret, record: { v: 1, auth: 'apiKey', origin: OPENROUTER_ORIGIN, secret } }
}

function isValidUsage(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * The key's usage and limit for Account & usage (D74). Throws on numbers
 * that are not finite and non-negative: invalid usage never reaches a
 * budget or a tally.
 */
export async function readOpenRouterKeyUsage(
  reader: KeyUsageReader,
  credential: string,
): Promise<KeyUsageSnapshot> {
  const snapshot = await reader.read(credential)
  const numbers = [
    snapshot.usedToday,
    snapshot.usedThisWeek,
    snapshot.usedThisMonth,
    ...(snapshot.limit === undefined ? [] : [snapshot.limit]),
    ...(snapshot.remaining === undefined ? [] : [snapshot.remaining]),
  ]
  if (numbers.some((usage) => !isValidUsage(usage))) {
    throw new Error('OpenRouter answered its key usage with invalid numbers')
  }
  return snapshot
}
