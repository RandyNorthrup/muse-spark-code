// D104 source (b) in the runtime: the device-flow sign-in as a
// GitHubTokenSource (M123 lane A). The token pair lives only in the
// credential store it is given: the OS keychain (`keyStore.ts`) today, the
// M109 vault's `oauth` item once its broker binds. It is never in settings,
// a file of ours, a log, MHP, an argument or an environment.
//
// - `silent` reads the stored token; an expiring one is refreshed first
//   (both tokens rotate), and a refresh GitHub refuses drops the item.
// - `ask` also runs the device flow, one at a time, showing the code only
//   through `present` (the panel's card, the ACP notice or the CLI's text).
// - A 401 (`rejected`) and Sign out delete the item; Sign out then opens the
//   app's page on GitHub, where the grant is revoked (a public client cannot
//   call the revocation endpoint: it needs the client secret).
// - Every token read or issued is registered with the redactor.

import type { SecretStore } from '../../host/auth/credentialStore'
import { registerSecretValue } from '../../core/redact'
import {
  DeviceFlowFailure,
  refreshDeviceFlowToken,
  signInWithDeviceFlow,
  type DeviceCodePrompt,
  type DeviceFlowDeps,
  type DeviceFlowTokens,
} from '../../core/git/deviceFlow'
import type { GitHubCredential, GitHubTokenSource } from '../../core/git/tokenSource'
import * as z from 'zod/mini'
import {
  GITHUB_AUTH_SCOPES,
  GITHUB_AUTHORIZED_APP_URL,
  GITHUB_DEVICE_FLOW_SECRET_KEY,
  GITHUB_STORED_TOKEN_VERSION,
  GITHUB_TOKEN_REFRESH_MARGIN_MS,
} from '../../shared/constants'

export interface DeviceFlowSourceDeps {
  readonly store: SecretStore
  readonly flow: DeviceFlowDeps
  /** Shows the code and GitHub's address; the user opens it. */
  readonly present: (prompt: DeviceCodePrompt) => Promise<void>
  /** GitHub's authorized-app page, after Sign out. */
  readonly openExternal: (url: string) => Promise<void>
  /** The network the credential's calls go out on. */
  readonly fetch: typeof fetch
}

const time = z.nullable(z.number().check(z.int(), z.positive()))
const storedSchema = z.strictObject({
  v: z.literal(GITHUB_STORED_TOKEN_VERSION),
  accessToken: z.string().check(z.minLength(1)),
  refreshToken: z.nullable(z.string().check(z.minLength(1))),
  expiresAt: time,
  refreshExpiresAt: time,
})
type StoredTokens = z.infer<typeof storedSchema>

function parseStored(text: string | undefined): StoredTokens | undefined {
  if (text === undefined || text === '') return
  try {
    const parsed = storedSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function storedOf(tokens: DeviceFlowTokens): StoredTokens {
  return {
    v: GITHUB_STORED_TOKEN_VERSION,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
  }
}

export interface DeviceFlowSource extends GitHubTokenSource {
  /** Whether a token is stored (for `auth github status`); never the token. */
  isSignedIn(): Promise<boolean>
}

export function deviceFlowSource(deps: DeviceFlowSourceDeps): DeviceFlowSource {
  const releases = new Map<string, () => void>()
  let signingIn: Promise<StoredTokens> | undefined

  const remember = (stored: StoredTokens): StoredTokens => {
    for (const value of [stored.accessToken, stored.refreshToken]) {
      if (value !== null && !releases.has(value)) releases.set(value, registerSecretValue(value))
    }
    return stored
  }
  const forget = async (): Promise<void> => {
    await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
    // The redactor keeps the values: a line already queued may still name one.
  }
  const save = async (tokens: DeviceFlowTokens): Promise<StoredTokens> => {
    const stored = remember(storedOf(tokens))
    await deps.store.store(GITHUB_DEVICE_FLOW_SECRET_KEY, JSON.stringify(stored))
    return stored
  }
  const credentialOf = (stored: StoredTokens): GitHubCredential => ({
    source: 'deviceFlow',
    bearer: stored.accessToken,
    fetch: deps.fetch,
    expiresAt: stored.expiresAt ?? undefined,
  })

  /** The stored pair, refreshed when it is about to expire; undefined when none is usable. */
  const usable = async (signal: AbortSignal): Promise<StoredTokens | undefined> => {
    const stored = parseStored(await deps.store.get(GITHUB_DEVICE_FLOW_SECRET_KEY))
    if (stored === undefined) return
    remember(stored)
    const now = deps.flow.now()
    if (stored.expiresAt === null || now + GITHUB_TOKEN_REFRESH_MARGIN_MS < stored.expiresAt) {
      return stored
    }
    if (
      stored.refreshToken === null ||
      (stored.refreshExpiresAt !== null && now >= stored.refreshExpiresAt)
    ) {
      await forget()
      return
    }
    try {
      return await save(await refreshDeviceFlowToken(deps.flow, stored.refreshToken, signal))
    } catch (error: unknown) {
      signal.throwIfAborted()
      // A lost network keeps the pair for the next try; anything else means
      // GitHub did not take it, so the user signs in again.
      if (error instanceof DeviceFlowFailure && error.reason === 'network') throw error
      await forget()
      return
    }
  }

  return {
    kind: 'deviceFlow',
    async credential(mode, signal) {
      const stored = await usable(signal)
      if (stored !== undefined) return credentialOf(stored)
      if (mode === 'silent') return
      signingIn ??= (async () => {
        try {
          return await save(
            await signInWithDeviceFlow(deps.flow, GITHUB_AUTH_SCOPES, deps.present, signal),
          )
        } finally {
          signingIn = undefined
        }
      })()
      return credentialOf(await signingIn)
    },
    async rejected(credential) {
      const stored = parseStored(await deps.store.get(GITHUB_DEVICE_FLOW_SECRET_KEY))
      if (stored?.accessToken === credential.bearer) await forget()
    },
    async signOut() {
      await forget()
      await deps.openExternal(GITHUB_AUTHORIZED_APP_URL)
    },
    async isSignedIn() {
      return parseStored(await deps.store.get(GITHUB_DEVICE_FLOW_SECRET_KEY)) !== undefined
    },
  }
}
