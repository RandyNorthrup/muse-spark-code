// D104 source (b) in the runtime: the device-flow sign-in as a
// GitHubTokenSource (M123 lane A). The token pair lives only in the
// credential store it is given: the OS keychain (`keyStore.ts`) today, the
// M109 vault's `oauth` item once its broker binds. It is never in settings,
// a file of ours, a log, MHP, an argument or an environment.
//
// - `silent` reads the stored token; an expiring one is refreshed first
//   (both tokens rotate), and a refresh GitHub refuses drops the item. A
//   refresh that fails otherwise keeps it, and the access token serves while
//   it lasts.
// - `ask` also runs the device flow, one at a time, showing the code only
//   through `present` (the panel's card, the ACP notice or the CLI's text).
// - A 401 (`rejected`) and Sign out delete the item; Sign out then opens the
//   app's page on GitHub, where the grant is revoked (a public client cannot
//   call the revocation endpoint: it needs the client secret).
// - Every token read or issued is registered with the redactor.
//
// Windows and processes share the item, and a keychain has no
// compare-and-swap, so every write is conditional:
// - Sign out first writes a fresh random mark beside the item, then deletes
//   it. A sign-in or refresh reads the mark when it starts, and after
//   storing reads it again: a changed mark means a sign-out ran meanwhile,
//   and the write is taken back. (Sign out's write comes before its delete,
//   so a store that lands after the delete always sees the new mark.)
// - A refused refresh deletes only the pair it spent: a pair another
//   window rotated in meanwhile is kept and used.
// - In one source, concurrent callers share one refresh and one sign-in.
//   Each caller's signal ends only its own wait; the shared run is aborted
//   when every caller has gone.

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
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  GITHUB_AUTH_SCOPES,
  GITHUB_AUTHORIZED_APP_URL,
  GITHUB_DEVICE_FLOW_SECRET_KEY,
  GITHUB_DEVICE_FLOW_SIGN_OUT_KEY,
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

/** `work` until `signal` aborts; the abort rejects with its reason. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const done = new AbortController()
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      },
      { once: true, signal: done.signal },
    )
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    done.abort()
  }
}

/**
 * One run of `work` at a time, joined by every caller while it lasts. The
 * run owns its own signal: a caller's abort ends that caller's wait only,
 * and the run is aborted once no caller is left waiting for it.
 */
function shared<T>(work: (signal: AbortSignal) => Promise<T>): (signal: AbortSignal) => Promise<T> {
  let run:
    { readonly result: Promise<T>; readonly owner: AbortController; callers: number } | undefined
  const end = (owner: AbortController): void => {
    if (run?.owner === owner) run = undefined
  }
  return async (signal) => {
    signal.throwIfAborted()
    if (run === undefined) {
      const owner = new AbortController()
      // Every caller's race reads the result, so an abandoned run's failure is handled.
      const result = (async () => {
        try {
          return await work(owner.signal)
        } finally {
          end(owner)
        }
      })()
      run = { result, owner, callers: 0 }
    }
    const current = run
    current.callers += 1
    try {
      return await untilAborted(current.result, signal)
    } finally {
      current.callers -= 1
      if (current.callers === 0 && signal.aborted) {
        current.owner.abort(signal.reason)
        end(current.owner)
      }
    }
  }
}

export function deviceFlowSource(deps: DeviceFlowSourceDeps): DeviceFlowSource {
  const releases = new Map<string, () => void>()

  const remember = (stored: StoredTokens): StoredTokens => {
    for (const value of [stored.accessToken, stored.refreshToken]) {
      if (value !== null && !releases.has(value)) releases.set(value, registerSecretValue(value))
    }
    return stored
  }
  const read = async (): Promise<string | undefined> =>
    await deps.store.get(GITHUB_DEVICE_FLOW_SECRET_KEY)
  const signOutMark = async (): Promise<string | undefined> =>
    await deps.store.get(GITHUB_DEVICE_FLOW_SIGN_OUT_KEY)
  /** Delete the item if it still holds `text`; whether it did. */
  const didForget = async (text: string | undefined): Promise<boolean> => {
    if ((await read()) !== text) return false
    await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
    // The redactor keeps the values: a line already queued may still name one.
    return true
  }
  /** Store `tokens` unless Sign out ran since `mark` was read; undefined when it did. */
  const saveUnlessSignedOut = async (
    tokens: DeviceFlowTokens,
    mark: string | undefined,
  ): Promise<StoredTokens | undefined> => {
    const stored = remember(storedOf(tokens))
    const text = JSON.stringify(stored)
    await deps.store.store(GITHUB_DEVICE_FLOW_SECRET_KEY, text)
    if ((await signOutMark()) === mark) return stored
    await didForget(text)
    return
  }
  const credentialOf = (stored: StoredTokens): GitHubCredential => ({
    source: 'deviceFlow',
    bearer: stored.accessToken,
    fetch: deps.fetch,
    expiresAt: stored.expiresAt ?? undefined,
  })
  const isFresh = (stored: StoredTokens): boolean =>
    stored.expiresAt === null || deps.flow.now() + GITHUB_TOKEN_REFRESH_MARGIN_MS < stored.expiresAt

  /** The stored pair, refreshed when it is about to expire; undefined when none is usable. */
  const usable = shared(async (signal): Promise<StoredTokens | undefined> => {
    const mark = await signOutMark()
    const text = await read()
    const stored = parseStored(text)
    if (stored === undefined) return
    remember(stored)
    if (isFresh(stored)) return stored
    if (
      stored.refreshToken === null ||
      (stored.refreshExpiresAt !== null && deps.flow.now() >= stored.refreshExpiresAt)
    ) {
      await didForget(text)
      return
    }
    let tokens: DeviceFlowTokens
    try {
      tokens = await refreshDeviceFlowToken(deps.flow, stored.refreshToken, signal)
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (!(error instanceof DeviceFlowFailure) || error.reason !== 'refreshRefused') {
        // An outage or an unreadable reply: GitHub did not refuse the pair,
        // so it stays, and its access token serves while it lasts.
        if (stored.expiresAt !== null && deps.flow.now() < stored.expiresAt) return stored
        throw error
      }
      // Another window may have spent the refresh token first and stored
      // its new pair: only the refused pair is dropped.
      if (await didForget(text)) return
      const current = parseStored(await read())
      return current !== undefined && isFresh(current) ? remember(current) : undefined
    }
    return await saveUnlessSignedOut(tokens, mark)
  })

  const signIn = shared(async (signal): Promise<StoredTokens | undefined> => {
    const mark = await signOutMark()
    const tokens = await signInWithDeviceFlow(deps.flow, GITHUB_AUTH_SCOPES, deps.present, signal)
    return await saveUnlessSignedOut(tokens, mark)
  })

  return {
    kind: 'deviceFlow',
    async credential(mode, signal) {
      const stored = await usable(signal)
      if (stored !== undefined) return credentialOf(stored)
      if (mode === 'silent') return
      const signedIn = await signIn(signal)
      return signedIn === undefined ? undefined : credentialOf(signedIn)
    },
    async rejected(credential) {
      const text = await read()
      if (parseStored(text)?.accessToken === credential.bearer) await didForget(text)
    },
    async signOut() {
      // The mark goes first: see the note at the top.
      await deps.store.store(GITHUB_DEVICE_FLOW_SIGN_OUT_KEY, randomUUID())
      await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
      await deps.openExternal(GITHUB_AUTHORIZED_APP_URL)
    },
    async isSignedIn() {
      return parseStored(await read()) !== undefined
    },
  }
}
