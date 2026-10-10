// The Model API backend on the user's Muse Code subscription (C-M95-SUB,
// owner order 2026-10-10). Reads the subscription key the Muse Code CLI
// holds after sign-in (`providers.meta`'s `api_key`, else its
// `access_token`) from the CLI's own auth file at runtime, and only while
// the user opts in. The key is held in memory only: it is never displayed,
// logged, copied into settings, sent to telemetry, or written anywhere.
// Reads use temp-dir fixtures in tests; production never reads a fixture.
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as z from 'zod/mini'
import {
  MUSE_CREDENTIAL_FILE_MAX_BYTES,
  MUSE_CREDENTIAL_INLINE_SCHEMA,
  MUSE_CREDENTIAL_KEYCHAIN_STORAGE,
  MUSE_CREDENTIAL_POINTER_SCHEMA,
  MUSE_CREDENTIAL_PROVIDER,
  UI_TEXT,
} from '../../../shared/constants'
import { credentialFilePath } from '../musecode/launch'

/** Which account a Meta Model API call bills: a key, or the Muse Code plan. */
export type ModelApiBilling = 'payAsYouGo' | 'museCodePlan'

/** Why the subscription key is unavailable; each maps to a refusal with a fix. */
export type SubscriptionKeyStatus = 'ready' | 'missing' | 'unreadable' | 'unsigned' | 'keychain'

export interface SubscriptionKeyRead {
  readonly status: SubscriptionKeyStatus
  /** The key itself, present only when `status` is `ready`. */
  readonly key: string | undefined
}

export interface SubscriptionKeyFileState {
  readonly size: number
  readonly mtimeMs: number
}

export interface SubscriptionKeySourceDeps {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
  readonly readFile?: (path: string) => Promise<string>
  readonly stat?: (path: string) => Promise<SubscriptionKeyFileState>
}

// Only the credential strings are parsed; every other field is dropped, so
// no account name, label or token besides the key itself is ever retained.
const subscriptionFileSchema = z.object({
  schema_version: z.optional(z.number()),
  providers: z.optional(
    z.record(
      z.string(),
      z.object({
        storage: z.optional(z.string()),
        api_key: z.optional(z.unknown()),
        access_token: z.optional(z.unknown()),
      }),
    ),
  ),
})

function cleanKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim()
  return key === '' || /[\r\n]/u.test(key) ? undefined : key
}

function defaultReadFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

async function defaultStat(path: string): Promise<SubscriptionKeyFileState> {
  const info = await stat(path)
  return { size: info.size, mtimeMs: info.mtimeMs }
}

/**
 * The CLI's subscription key at rest. `api_key` (what `muse auth set`
 * stores) is preferred; a browser sign-in's `access_token` is used when it
 * is the only credential the file holds. A macOS Keychain pointer file
 * holds no key here, so it reads as `keychain`, never as a value.
 */
export function readSubscriptionKeyText(text: string): SubscriptionKeyRead {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { status: 'unreadable', key: undefined }
  }
  const parsed = subscriptionFileSchema.safeParse(raw)
  if (!parsed.success) return { status: 'unreadable', key: undefined }
  const file = parsed.data
  // Only the captured schema versions speak; anything else is the CLI's to
  // say, and re-signing into an unknown shape would not fix it.
  if (
    file.schema_version !== undefined &&
    file.schema_version !== MUSE_CREDENTIAL_INLINE_SCHEMA &&
    file.schema_version !== MUSE_CREDENTIAL_POINTER_SCHEMA
  ) {
    return { status: 'unreadable', key: undefined }
  }
  const meta = file.providers === undefined ? undefined : file.providers[MUSE_CREDENTIAL_PROVIDER]
  if (
    file.schema_version === MUSE_CREDENTIAL_POINTER_SCHEMA ||
    meta?.storage === MUSE_CREDENTIAL_KEYCHAIN_STORAGE
  ) {
    return { status: 'keychain', key: undefined }
  }
  const key = cleanKey(meta?.api_key) ?? cleanKey(meta?.access_token)
  return key === undefined ? { status: 'unsigned', key: undefined } : { status: 'ready', key }
}

/** The refusal for a status, naming the fix; it never carries key material. */
export function subscriptionKeyRefusal(status: Exclude<SubscriptionKeyStatus, 'ready'>): string {
  switch (status) {
    case 'missing':
    case 'unsigned': {
      return UI_TEXT.subscriptionKey.signInAgain
    }
    case 'unreadable': {
      return UI_TEXT.subscriptionKey.cannotRead
    }
    case 'keychain': {
      return UI_TEXT.subscriptionKey.keychainBacked
    }
  }
}

/** Thrown (never returned as undefined) when the opted-in key cannot be read. */
export class SubscriptionKeyError extends Error {
  public constructor(public readonly status: Exclude<SubscriptionKeyStatus, 'ready'>) {
    super(subscriptionKeyRefusal(status))
    this.name = 'SubscriptionKeyError'
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * The subscription key with reload-on-change: the file is statted on every
 * read and re-parsed only when its size or modification time moved, so a
 * CLI re-sign-in or rotation takes effect on the next request. Concurrent
 * reads share one in-flight parse.
 */
export class SubscriptionKeySource {
  private readonly readFile: (path: string) => Promise<string>
  private readonly stat: (path: string) => Promise<SubscriptionKeyFileState>
  private cached:
    { state: SubscriptionKeyFileState; read: SubscriptionKeyRead; pending?: undefined } | undefined
  private pending: Promise<SubscriptionKeyRead> | undefined

  public constructor(private readonly deps: SubscriptionKeySourceDeps) {
    this.readFile = deps.readFile ?? defaultReadFile
    this.stat = deps.stat ?? defaultStat
  }

  /**
   * The CLI's auth file on this OS: `XDG_CONFIG_HOME` honoured on every
   * platform (Windows included), else `~/.config` — the same path `muse
   * serve` reads, shared here instead of reimplemented per OS.
   */
  public path(): string {
    return credentialFilePath({
      platform: this.deps.platform,
      homeDir: this.deps.homeDir,
      xdgConfigHome: this.deps.xdgConfigHome,
    })
  }

  public async read(): Promise<SubscriptionKeyRead> {
    const file = this.path()
    let state: SubscriptionKeyFileState
    try {
      state = await this.stat(file)
    } catch {
      this.cached = undefined
      return { status: 'missing', key: undefined }
    }
    if (this.cached?.state.size === state.size && this.cached.state.mtimeMs === state.mtimeMs) {
      return this.cached.read
    }
    if (state.size > MUSE_CREDENTIAL_FILE_MAX_BYTES) {
      const read: SubscriptionKeyRead = { status: 'unreadable', key: undefined }
      this.cached = { state, read }
      return read
    }
    this.pending ??= (async (): Promise<SubscriptionKeyRead> => {
      let read: SubscriptionKeyRead
      try {
        read = readSubscriptionKeyText(await this.readFile(file))
      } catch (error: unknown) {
        read = { status: isMissing(error) ? 'missing' : 'unreadable', key: undefined }
      }
      this.cached = { state, read }
      return read
    })()
    try {
      return await this.pending
    } finally {
      this.pending = undefined
    }
  }

  /** True while the file currently yields a key (a stat per call; no value kept). */
  public async isReady(): Promise<boolean> {
    const read = await this.read()
    return read.status === 'ready'
  }

  /**
   * Redacts the currently cached key from text, for logs and transcripts.
   * Anything never read is nothing to redact; callers handling errors
   * already carry none of the key.
   */
  public redact(text: string): string {
    const key = this.cached?.read.key
    return key === undefined || key === '' ? text : text.split(key).join('[redacted]')
  }

  public digestFor(key: string): string {
    return createHash('sha256').update(key).digest('hex')
  }
}

export type ResolvedModelApiCredential =
  | { readonly kind: 'key'; readonly key: string; readonly billing: ModelApiBilling }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'refused'
      readonly status: Exclude<SubscriptionKeyStatus, 'ready'>
    }

export interface ModelApiCredentialDeps {
  /** The pasted pay-as-you-go key, if any. */
  readonly readPastedKey: () => Promise<string | undefined>
  /** The one opt-in: the setting in VS Code, the flag in ACP/headless. */
  readonly isSubscriptionEnabled: () => boolean | Promise<boolean>
  readonly subscription: SubscriptionKeySource
}

/**
 * The effective Model API credential. With the opt-in on, the subscription
 * key wins and anything else refuses with the fix: falling back to a pasted
 * key would bill the user's card for calls they asked to put on their plan.
 */
export async function resolveModelApiCredential(
  deps: ModelApiCredentialDeps,
): Promise<ResolvedModelApiCredential> {
  if (!(await deps.isSubscriptionEnabled())) {
    const pasted = await deps.readPastedKey()
    return pasted === undefined
      ? { kind: 'none' }
      : { key: pasted, kind: 'key', billing: 'payAsYouGo' }
  }
  const read = await deps.subscription.read()
  return read.status !== 'ready' || read.key === undefined
    ? { kind: 'refused', status: read.status }
    : { kind: 'key', key: read.key, billing: 'museCodePlan' }
}
