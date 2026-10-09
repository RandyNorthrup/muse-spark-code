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
// compare-and-swap, so the item belongs to a sign-in generation (PLAN.md
// M123, "The sign-in generation"):
// - A random generation is kept beside the item (no secret); none stored is
//   the first generation. Every stored pair names the generation it was
//   issued under, and a pair is read (or served) only while that is still
//   the current one.
// - Sign out, and any refusal that drops the pair (a 401, a refused or
//   expired refresh), writes a new generation and only then deletes the
//   item: nothing issued before it is readable after it, even if a late
//   write lands afterwards.
// - A sign-in or refresh takes the generation when it starts and stores its
//   pair only if that is still current, then reads both back: a sign-out
//   that slipped in between takes the pair back, and a pair another window
//   stored over it is used instead.
// - In one source, every check-and-write runs in one queue; concurrent
//   callers share one refresh and one sign-in. Each caller's signal ends
//   only its own wait; the shared run is aborted when every caller has gone.

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
  GITHUB_DEVICE_FLOW_GENERATION_KEY,
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
/** A sign-in generation: null is the first, before any Sign out. */
type Generation = string | null
const storedSchema = z.strictObject({
  v: z.literal(GITHUB_STORED_TOKEN_VERSION),
  generation: z.nullable(z.string().check(z.minLength(1))),
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

function storedOf(tokens: DeviceFlowTokens, generation: Generation): StoredTokens {
  return {
    v: GITHUB_STORED_TOKEN_VERSION,
    generation,
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
  const generation = async (): Promise<Generation> => {
    const value = await deps.store.get(GITHUB_DEVICE_FLOW_GENERATION_KEY)
    return value === undefined || value === '' ? null : value
  }
  /** The pair in `text` if it was issued under `current`; the only way a stored pair is read. */
  const readable = (text: string | undefined, current: Generation): StoredTokens | undefined => {
    const stored = parseStored(text)
    return stored?.generation === current ? remember(stored) : undefined
  }
  /** The stored pair, read before the generation so a Sign out in between disowns it. */
  const current = async (): Promise<StoredTokens | undefined> => {
    const text = await read()
    return readable(text, await generation())
  }

  // This source's check-and-write transitions, one at a time.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = queue
    const result = (async () => {
      await turn
      return await work()
    })()
    queue = Promise.allSettled([result])
    return result
  }

  /** Retire: a new generation first, then the delete (Sign out, a refusal). */
  const retire = async (): Promise<void> => {
    await deps.store.store(GITHUB_DEVICE_FLOW_GENERATION_KEY, randomUUID())
    await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
    // The redactor keeps the values: a line already queued may still name one.
  }
  /** Refuse: retire the item if it still holds `text`; whether it did. */
  const refuse = (text: string | undefined): Promise<boolean> =>
    serialized(async () => {
      if ((await read()) !== text) return false
      await retire()
      return true
    })
  /**
   * Publish: store `tokens` if `issuedUnder` is still current, then read
   * both back. Undefined when a Sign out or refusal came first; another
   * window's pair when it stored over this one.
   */
  const publish = (
    tokens: DeviceFlowTokens,
    issuedUnder: Generation,
  ): Promise<StoredTokens | undefined> =>
    serialized(async () => {
      if ((await generation()) !== issuedUnder) return
      const stored = remember(storedOf(tokens, issuedUnder))
      const text = JSON.stringify(stored)
      await deps.store.store(GITHUB_DEVICE_FLOW_SECRET_KEY, text)
      const after = await read()
      const now = await generation()
      if (now !== issuedUnder) {
        // Another process retired the generation between the check and the
        // write: the pair is unreadable already; take it back too.
        if (after === text) await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
        return
      }
      return after === text ? stored : readable(after, now)
    })

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
    const text = await read()
    const stored = readable(text, await generation())
    if (stored === undefined) return
    if (isFresh(stored)) return stored
    if (
      stored.refreshToken === null ||
      (stored.refreshExpiresAt !== null && deps.flow.now() >= stored.refreshExpiresAt)
    ) {
      await refuse(text)
      return
    }
    let tokens: DeviceFlowTokens
    try {
      tokens = await refreshDeviceFlowToken(deps.flow, stored.refreshToken, signal)
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (!(error instanceof DeviceFlowFailure) || error.reason !== 'refreshRefused') {
        // An outage or an unreadable reply: GitHub did not refuse the pair,
        // so it stays, and its access token serves while it lasts (and
        // while its generation does: see `credential`).
        if (stored.expiresAt !== null && deps.flow.now() < stored.expiresAt) return stored
        throw error
      }
      // Another window may have spent the refresh token first and stored
      // its new pair: only the refused pair is dropped.
      if (await refuse(text)) return
      const rotated = await current()
      return rotated !== undefined && isFresh(rotated) ? rotated : undefined
    }
    return await publish(tokens, stored.generation)
  })

  const signIn = shared(async (signal): Promise<StoredTokens | undefined> => {
    const issuedUnder = await generation()
    const tokens = await signInWithDeviceFlow(deps.flow, GITHUB_AUTH_SCOPES, deps.present, signal)
    return await publish(tokens, issuedUnder)
  })

  return {
    kind: 'deviceFlow',
    async credential(mode, signal) {
      const stored = (await usable(signal)) ?? (mode === 'ask' ? await signIn(signal) : undefined)
      // Serve: whichever path gave the pair (a shared run, a cached pair
      // during an outage), only while its generation is still current.
      if (stored === undefined) return
      if (stored.generation !== (await generation())) return
      return credentialOf(stored)
    },
    async rejected(credential) {
      const text = await read()
      if (parseStored(text)?.accessToken === credential.bearer) await refuse(text)
    },
    async signOut() {
      await serialized(retire)
      await deps.openExternal(GITHUB_AUTHORIZED_APP_URL)
    },
    async isSignedIn() {
      return (await current()) !== undefined
    },
  }
}
