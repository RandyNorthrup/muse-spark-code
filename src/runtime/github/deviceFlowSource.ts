// D104 source (b) in the runtime: the device-flow sign-in as a
// GitHubTokenSource (M123 lane A). The token pair lives only in the
// credential store it is given: the OS keychain (`keyStore.ts`) today, the
// M109 vault's `oauth` item once its broker binds. It is never in settings,
// a file of ours, a log, MHP, an argument or an environment.
//
// - `silent` reads the stored token; an expiring one is refreshed first
//   (both tokens rotate), and a refresh GitHub refuses drops the pair. A
//   refresh that fails otherwise keeps it, and the access token serves while
//   it lasts.
// - `ask` also runs the device flow, one at a time, showing the code only
//   through `present` (the panel's card, the ACP notice or the CLI's text).
// - A 401 (`rejected`) drops the pair. Sign out drops it and opens the
//   app's page on GitHub, where the grant is revoked (a public client cannot
//   call the revocation endpoint: it needs the client secret).
// - Every token read or issued is registered with the redactor.
//
// Windows and processes share the store, and a keychain has no
// compare-and-swap, so Sign out is one logout barrier (PLAN.md M123, "one
// logout barrier"):
// - The sign-in generation, a random id beside the pair (no secret; none
//   stored is the first), is written by Sign out only, as a fresh value in
//   one write, and read in one read.
// - A Read (and the refresh after it) and a sign-in read the generation
//   once, when they begin. The pair they store names that generation and no
//   other; it is stored only while that generation is current, and read or
//   served only while it is.
// - A refusal (a 401, a refused or expired refresh) never writes the
//   generation: it notes the refused pair's id and deletes that pair. A
//   rotation replaces only the pair it began from, or the slot that pair's
//   own refusal emptied (a duplicate refresh that lost to this one).
// - In one source, every check-and-write runs in one queue; concurrent
//   callers share one refresh and one sign-in; and a count of its Sign outs
//   keeps anything begun before one from being served or joined. Each
//   caller's signal ends only its own wait; the shared run is aborted when
//   every caller has gone.

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
  GITHUB_DEVICE_FLOW_REFUSED_KEY,
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
  /** This pair's own random id (no secret): what a refusal notes. */
  id: z.string().check(z.minLength(1)),
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
    id: randomUUID(),
    generation,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
  }
}

/** A pair to serve, with this source's Sign-out count when its operation began. */
interface Issued {
  readonly pair: StoredTokens
  readonly signOuts: number
}

/** The pair a rotation began from: the stored text and its id. */
interface RotatedFrom {
  readonly text: string
  readonly id: string
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
 * One run of `work` at a time, joined by every caller while it lasts and
 * while `era` reads what it read when the run began (a Sign out of the
 * source in between makes the next caller start a run of its own). The run
 * owns its own signal: a caller's abort ends that caller's wait only, and
 * the run is aborted once no caller is left waiting for it.
 */
function shared<T>(
  work: (signal: AbortSignal) => Promise<T>,
  era: () => number,
): (signal: AbortSignal) => Promise<T> {
  let run:
    | {
        readonly result: Promise<T>
        readonly owner: AbortController
        readonly era: number
        callers: number
      }
    | undefined
  const end = (owner: AbortController): void => {
    if (run?.owner === owner) run = undefined
  }
  return async (signal) => {
    signal.throwIfAborted()
    const now = era()
    if (run?.era !== now) {
      const owner = new AbortController()
      // Every caller's race reads the result, so an abandoned run's failure is handled.
      const result = (async () => {
        try {
          return await work(owner.signal)
        } finally {
          end(owner)
        }
      })()
      run = { result, owner, era: now, callers: 0 }
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
  /** This source's Sign outs whose generation write has returned or failed. */
  let signOuts = 0

  const remember = (stored: StoredTokens): StoredTokens => {
    for (const value of [stored.accessToken, stored.refreshToken]) {
      if (value !== null && !releases.has(value)) releases.set(value, registerSecretValue(value))
    }
    return stored
  }
  const read = async (): Promise<string | undefined> =>
    await deps.store.get(GITHUB_DEVICE_FLOW_SECRET_KEY)
  /** The logout barrier, in one read. */
  const generation = async (): Promise<Generation> => {
    const value = await deps.store.get(GITHUB_DEVICE_FLOW_GENERATION_KEY)
    return value === undefined || value === '' ? null : value
  }
  /** The pair in `text` if it was issued under `current`; the only way a stored pair is read. */
  const readable = (text: string | undefined, current: Generation): StoredTokens | undefined => {
    const stored = parseStored(text)
    return stored?.generation === current ? remember(stored) : undefined
  }
  /** Read: the pair, then the generation it must name (a Sign out between them disowns it). */
  const readNow = async () => {
    const text = await read()
    const now = await generation()
    return { text, now, pair: readable(text, now) }
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

  /** Refuse: while the slot still holds `text`, note its pair's id, then delete it. Never the generation. */
  const refuse = (text: string, refused: StoredTokens): Promise<boolean> =>
    serialized(async () => {
      if ((await read()) !== text) return false
      await deps.store.store(GITHUB_DEVICE_FLOW_REFUSED_KEY, refused.id)
      await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
      return true
    })
  /**
   * Publish `tokens` under `start`, the generation the operation read when
   * it began, and no other. Nothing is written once the generation has
   * moved. A rotation (`from`) replaces only the pair it began from, or the
   * slot that pair's own refusal emptied; over another pair it writes
   * nothing and uses that pair. Undefined when nothing may be served.
   */
  const publish = (
    tokens: DeviceFlowTokens,
    start: Generation,
    from?: RotatedFrom,
  ): Promise<StoredTokens | undefined> =>
    serialized(async () => {
      const slot = from === undefined ? undefined : await read()
      if ((await generation()) !== start) return
      if (from !== undefined && slot !== from.text) {
        if (slot !== undefined && slot !== '') return readable(slot, start)
        if ((await deps.store.get(GITHUB_DEVICE_FLOW_REFUSED_KEY)) !== from.id) return
      }
      const stored = remember(storedOf(tokens, start))
      const text = JSON.stringify(stored)
      await deps.store.store(GITHUB_DEVICE_FLOW_SECRET_KEY, text)
      const after = await read()
      if ((await generation()) !== start) {
        // A Sign out in another process landed between the check and the
        // write: the pair names an earlier generation, so nobody reads it.
        // Take it back while it is still this one.
        if ((await read()) === text) await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
        return
      }
      return after === text ? stored : readable(after, start)
    })

  const credentialOf = (stored: StoredTokens): GitHubCredential => ({
    source: 'deviceFlow',
    bearer: stored.accessToken,
    fetch: deps.fetch,
    expiresAt: stored.expiresAt ?? undefined,
  })
  const isFresh = (stored: StoredTokens): boolean =>
    stored.expiresAt === null || deps.flow.now() + GITHUB_TOKEN_REFRESH_MARGIN_MS < stored.expiresAt
  const era = (): number => signOuts

  /** The stored pair, refreshed when it is about to expire; undefined when none is usable. */
  const usable = shared(async (signal): Promise<Issued | undefined> => {
    const began = signOuts
    const issued = (pair: StoredTokens | undefined): Issued | undefined =>
      pair === undefined ? undefined : { pair, signOuts: began }
    const { text, now: start, pair: stored } = await readNow()
    if (stored === undefined || text === undefined) return
    if (isFresh(stored)) return issued(stored)
    if (
      stored.refreshToken === null ||
      (stored.refreshExpiresAt !== null && deps.flow.now() >= stored.refreshExpiresAt)
    ) {
      await refuse(text, stored)
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
        if (stored.expiresAt !== null && deps.flow.now() < stored.expiresAt) return issued(stored)
        throw error
      }
      if (await refuse(text, stored)) return
      // Another window spent the refresh token first and stored its new
      // pair: that pair, only while this Read's generation stands.
      const { pair: rotated } = await readNow()
      return rotated?.generation === start && isFresh(rotated) ? issued(rotated) : undefined
    }
    return issued(await publish(tokens, start, { text, id: stored.id }))
  }, era)

  const signIn = shared(async (signal): Promise<Issued | undefined> => {
    const began = signOuts
    const start = await generation()
    const tokens = await signInWithDeviceFlow(deps.flow, GITHUB_AUTH_SCOPES, deps.present, signal)
    const pair = await publish(tokens, start)
    return pair === undefined ? undefined : { pair, signOuts: began }
  }, era)

  return {
    kind: 'deviceFlow',
    async credential(mode, signal) {
      let stored: Issued | undefined
      try {
        stored = await usable(signal)
      } catch (error: unknown) {
        // A stored pair that could not be renewed (its access token gone and
        // GitHub's answer one we cannot read or do not know) never keeps the
        // user from signing in again: `ask` starts a new sign-in. A silent
        // read still fails, and Cancel still stops.
        if (mode !== 'ask' || signal.aborted) throw error
        stored = undefined
      }
      const issued = stored ?? (mode === 'ask' ? await signIn(signal) : undefined)
      // Serve: whichever path gave the pair (a shared run, a cached pair
      // during an outage), only while its generation is current, while no
      // Sign out of this source has come since its operation began, and
      // while this caller still waits. The final read races this caller's
      // signal; no await follows the check.
      if (issued === undefined) return
      signal.throwIfAborted()
      const now = await untilAborted(generation(), signal)
      signal.throwIfAborted()
      if (issued.pair.generation !== now || issued.signOuts !== signOuts) return
      return credentialOf(issued.pair)
    },
    async rejected(credential) {
      const text = await read()
      const stored = parseStored(text)
      if (text !== undefined && stored?.accessToken === credential.bearer) {
        await refuse(text, stored)
      }
    },
    async signOut() {
      // The logout barrier: a fresh generation in one write, then the
      // delete. Nothing but this writes the generation.
      await serialized(async () => {
        try {
          await deps.store.store(GITHUB_DEVICE_FLOW_GENERATION_KEY, randomUUID())
        } finally {
          signOuts += 1
        }
        await deps.store.delete(GITHUB_DEVICE_FLOW_SECRET_KEY)
      })
      await deps.openExternal(GITHUB_AUTHORIZED_APP_URL)
    },
    async isSignedIn() {
      const { pair } = await readNow()
      return pair !== undefined
    },
  }
}
