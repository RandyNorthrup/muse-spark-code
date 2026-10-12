// OpenRouter as a first-class provider (M95 lane K, PLAN.md D74; research
// §1.8, read 2026-10-04). **Connect OpenRouter account** runs its OAuth
// PKCE flow (S256, the shared loopback callback with a random port and
// `state`; in a remote window the flow without a callback, whose code the
// user pastes into the password box). The key is stored like a pasted one,
// bound to `https://openrouter.ai`. The PKCE pair, the code exchange and
// the usage read are injected seams (lanes P and T, from the captures);
// this module owns the flow, the authorize URL, the spend-limit link and
// the usage validation.

import { createHash, randomUUID } from 'node:crypto'
import type * as z from 'zod/mini'
import { legacyUsdSchema } from '../../shared/usd'
import type { providerKeyUsageSchema, ModelsPanelState } from '../../shared/modelsPanel'
import type { ProviderEntry } from './providerPorts'
import { fill } from '../../shared/l10n/text'
import { unlessAborted } from '../../core/timeouts'
import { UI_TEXT } from '../../shared/constants'
import { isOriginBound, type CredentialRecord } from './credentialRecords'
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
  readonly signal?: AbortSignal
  readonly onDiscardedKey?: () => void
}

export interface OpenRouterConnection {
  /** The key, for the caller to store bound to `OPENROUTER_ORIGIN`. */
  readonly key: string
  readonly record: CredentialRecord
}

/**
 * Connects the OpenRouter account: browser approval, one code exchange.
 * The connected key and its record, or undefined when the user cancelled
 * (dismissed the pasted-code box). Unrelated callbacks are ignored; a refusal
 * with the right state, a missing code or failed exchange rejects. The loopback closes in
 * every path.
 */
export async function connectOpenRouterAccount(
  deps: OpenRouterConnectDeps,
): Promise<OpenRouterConnection | undefined> {
  const signal = deps.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const pair = deps.pkce.create()
  const state = deps.pkce.newState()
  let code: string | undefined
  // The exchange repeats the callback it authorized with; a remote window
  // authorized with none.
  let redirectUri = ''
  if (deps.isRemote) {
    await unlessAborted(
      deps.openBrowser(openRouterAuthorizeUrl({ challenge: pair.challenge, state })),
      signal,
    )
    deps.signal?.throwIfAborted()
    const pending = deps.promptForPastedCode()
    const pasted =
      deps.signal === undefined ? await pending : await unlessAborted(pending, deps.signal)
    deps.signal?.throwIfAborted()
    if (pasted === undefined || pasted.trim() === '') {
      return undefined
    }
    code = pasted.trim()
  } else {
    const server = await deps.startServer(state)
    const close = () => {
      server.close()
    }
    deps.signal?.addEventListener('abort', close, { once: true })
    try {
      deps.signal?.throwIfAborted()
      // Listen before opening the browser; a fast callback must not be lost.
      const waited = server.waitForCode()
      void waited.catch(() => {
        /* The awaited promise below reports this failure. */
      })
      redirectUri = server.redirectUri
      await unlessAborted(
        deps.openBrowser(
          openRouterAuthorizeUrl({
            challenge: pair.challenge,
            state,
            redirectUri,
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
  }
  deps.signal?.throwIfAborted()
  const key = await deps.exchange.exchange({
    code,
    verifier: pair.verifier,
    redirectUri,
    ...(deps.signal !== undefined && { signal: deps.signal }),
  })
  if (deps.signal?.aborted && key.trim() !== '') deps.onDiscardedKey?.()
  deps.signal?.throwIfAborted()
  if (key.trim() === '') {
    throw new Error(UI_TEXT.providerConnectFailed)
  }
  const secret = key.trim()
  return { key: secret, record: { v: 1, auth: 'apiKey', origin: OPENROUTER_ORIGIN, secret } }
}

function isValidUsage(value: number | string): boolean {
  return legacyUsdSchema.safeParse(value).success
}

/**
 * The key's usage and limit for Account & usage (D74). Throws on numbers
 * that are not finite and non-negative: invalid usage never reaches a
 * budget or a tally.
 */
export async function readOpenRouterKeyUsage(
  reader: KeyUsageReader,
  credential: string,
  signal?: AbortSignal,
): Promise<KeyUsageSnapshot> {
  const snapshot = await reader.read(credential, signal)
  const numbers = [
    ...(snapshot.usedTotal === undefined ? [] : [snapshot.usedTotal]),
    snapshot.usedToday,
    snapshot.usedThisWeek,
    snapshot.usedThisMonth,
    ...(snapshot.limit === undefined ? [] : [snapshot.limit]),
    ...(snapshot.remaining === undefined ? [] : [snapshot.remaining]),
  ]
  if (numbers.some((usage) => !isValidUsage(usage))) {
    throw new Error(UI_TEXT.providerUsageFailed)
  }
  return snapshot
}

/** Current-key observation mapping lives in providers.js, outside the tight panel budget. */
async function readOpenRouterPanelUsage(
  entry: ProviderEntry,
  deps: {
    readonly storedCredential: (entry: ProviderEntry) => Promise<string | undefined>
    readonly openRouterUsage: (
      key: string,
      signal?: AbortSignal,
      entry?: ProviderEntry,
    ) => Promise<KeyUsageSnapshot | undefined>
  },
  signal?: AbortSignal,
): Promise<z.input<typeof providerKeyUsageSchema>> {
  signal?.throwIfAborted()
  const key = await deps.storedCredential(entry)
  if (key === undefined) throw new Error(UI_TEXT.providerUsageFailed)
  const snapshot = await deps.openRouterUsage(key, signal, entry)
  if (snapshot === undefined || (await deps.storedCredential(entry)) !== key)
    throw new Error(UI_TEXT.providerUsageFailed)
  signal?.throwIfAborted()
  return {
    totalUsd: snapshot.usedTotal,
    unlimited: snapshot.unlimited,
    dayUsd: snapshot.usedToday,
    weekUsd: snapshot.usedThisWeek,
    monthUsd: snapshot.usedThisMonth,
    limitUsd: snapshot.limit,
    remainingUsd: snapshot.remaining,
  }
}

/** Native password input withdraws with the connection instead of retaining a late code. */
export async function promptOpenRouterCode(
  showInputBox: (
    options: {
      readonly title: string
      readonly prompt: string
      readonly password: boolean
      readonly ignoreFocusOut: boolean
    },
    token?: {
      readonly isCancellationRequested: boolean
      readonly onCancellationRequested: (
        listener: (event: unknown) => unknown,
        thisArg?: unknown,
        disposables?: { dispose(): void }[],
      ) => { dispose(): void }
    },
  ) => PromiseLike<string | undefined>,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const options = {
    title: fill(UI_TEXT.providerConnect, { provider: 'OpenRouter' }),
    prompt: UI_TEXT.providerPasteCode,
    password: true,
    ignoreFocusOut: true,
  }
  if (signal === undefined) return await showInputBox(options)
  return await showInputBox(options, {
    get isCancellationRequested() {
      return signal.aborted
    },
    onCancellationRequested: (listener, thisArg, disposables) => {
      const notify = () => {
        listener.call(thisArg, undefined)
      }
      signal.addEventListener('abort', notify, { once: true })
      const disposable = {
        dispose: () => {
          signal.removeEventListener('abort', notify)
        },
      }
      disposables?.push(disposable)
      return disposable
    },
  })
}

/** Cache values only while their credential remains current; actions never read the network. */
export function createOpenRouterPanelUsage(
  deps: Parameters<typeof readOpenRouterPanelUsage>[1],
  parse: (value: z.input<typeof providerKeyUsageSchema>) => z.infer<typeof providerKeyUsageSchema>,
) {
  const cache = new Map<string, { key: string; usage: z.infer<typeof providerKeyUsageSchema> }>()
  return async (
    rows: ModelsPanelState['providers'],
    entries: readonly ProviderEntry[],
    shouldRead: boolean,
    signal: AbortSignal,
  ): Promise<void> => {
    for (const row of rows) {
      if (row.presetId !== 'openrouter') continue
      try {
        const entry = entries.find((item) => item.id === row.id)
        if (entry === undefined || row.key.state !== 'stored')
          throw new Error(UI_TEXT.providerUsageFailed)
        const key = await deps.storedCredential(entry)
        if (key === undefined) throw new Error(UI_TEXT.providerUsageFailed)
        const previous = cache.get(row.id)
        if (shouldRead) {
          const usage = parse(await readOpenRouterPanelUsage(entry, deps, signal))
          cache.set(row.id, { key, usage })
          row.keyUsage = usage
        } else if (previous?.key === key) row.keyUsage = previous.usage
        else throw new Error(UI_TEXT.providerUsageFailed)
      } catch {
        cache.delete(row.id)
        row.keyUsage = undefined
        row.keyUsageError = UI_TEXT.providerUsageFailed
      }
    }
  }
}

/** The captured API requires a management key to revoke; Connect has only an inference key. */
export function openRouterDiscardedKeyNotice(): string {
  return fill(UI_TEXT.providerCreatedKeyDiscarded, {
    label: OPENROUTER_KEY_LABEL,
    url: 'https://openrouter.ai/settings/keys',
  })
}

/** One request/observation per pending read, fresh before the recorder sees it. */
export function createOpenRouterUsageReader(deps: {
  readonly reader: KeyUsageReader | undefined
  readonly current: (id: string) => Promise<CredentialRecord | undefined>
  readonly onKeyUsage?: (
    snapshot: KeyUsageSnapshot & {
      readonly providerId: string
      readonly credentialId: string
      readonly observationId: string
    },
  ) => void
}) {
  const usageReads = new Map<string, { credential: string; promise: Promise<KeyUsageSnapshot> }>()
  return async (credential: string, signal?: AbortSignal, entry?: ProviderEntry) => {
    const reader = deps.reader
    if (reader === undefined) throw new Error(UI_TEXT.providerUsageFailed)
    const id = entry?.id ?? ''
    const pending = usageReads.get(id)
    if (pending?.credential === credential) return await pending.promise
    const promise = (async () => {
      const snapshot = await readOpenRouterKeyUsage(reader, credential, signal)
      if (entry !== undefined) {
        const current = await deps.current(entry.id)
        if (current?.secret !== credential || !isOriginBound(current, entry.address))
          throw new Error(UI_TEXT.providerUsageFailed)
        signal?.throwIfAborted()
        deps.onKeyUsage?.({
          ...snapshot,
          providerId: entry.id,
          credentialId: createHash('sha256').update(credential).digest('hex'),
          observationId: randomUUID(),
        })
      }
      return snapshot
    })()
    usageReads.set(id, { credential, promise })
    try {
      return await promise
    } finally {
      if (usageReads.get(id)?.promise === promise) usageReads.delete(id)
    }
  }
}

/** Clears displayed amounts before a fallible configuration read. */
export function clearOpenRouterPanelUsage(rows: ModelsPanelState['providers']): void {
  for (const row of rows) {
    if (row.presetId !== 'openrouter') continue
    row.keyUsage = undefined
    row.keyUsageError = UI_TEXT.providerUsageFailed
  }
}

/** Retires host-only draft keys without losing the created-key removal notice. */
export function createOpenRouterDraftDiscard(
  credentials: Map<string, { secret: string; origin: string; connected?: boolean }>,
  notify: () => void,
) {
  return (id?: string): void => {
    for (const [key, record] of credentials) {
      if (id !== undefined && key !== id) continue
      if (record.connected) notify()
      credentials.delete(key)
    }
  }
}
