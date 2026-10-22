// The Model API backend on the user's Muse Code subscription (C-M95-SUB,
// owner order 2026-10-10). Reads the subscription key the Muse Code CLI
// holds after a browser or device-code sign-in (`providers.meta`'s
// `access_token`, the captured `accountLogin` shape) from the CLI's own
// auth file at runtime, and only while the user opts in. A `muse auth set`
// file holds a pay-as-you-go `api_key` alone and never counts: it refuses
// instead of billing the card as plan. Every read is fresh, so a CLI
// re-sign-in or rotation takes effect on the next request and no key is
// retained between reads; the key is never displayed, logged, copied into
// settings, sent to telemetry, or written anywhere. Reads use temp-dir
// fixtures in tests; production never reads a fixture.
import { readFile, stat } from 'node:fs/promises'
import {
  MUSE_CREDENTIAL_FILE_MAX_BYTES,
  MUSE_CREDENTIAL_INLINE_SCHEMA,
  MUSE_CREDENTIAL_KEYCHAIN_STORAGE,
  MUSE_CREDENTIAL_POINTER_SCHEMA,
  MUSE_CREDENTIAL_PROVIDER,
  UI_TEXT,
} from '../../../shared/constants'
import { credentialFilePath } from '../musecode/credentialPath'

/** Which account a Meta Model API call bills: a key, or the Muse Code plan. */
export type ModelApiBilling = 'payAsYouGo' | 'museCodePlan'

/** Why the subscription key is unavailable; each maps to a refusal with a fix. */
export type SubscriptionKeyStatus = 'ready' | 'missing' | 'unreadable' | 'unsigned' | 'keychain'

export type SubscriptionKeyRead =
  | { readonly status: 'ready'; readonly key: string }
  | { readonly status: Exclude<SubscriptionKeyStatus, 'ready'>; readonly key: undefined }

export interface SubscriptionKeySourceDeps {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
  readonly readFile?: (path: string) => Promise<string>
  readonly stat?: (path: string) => Promise<{ readonly size: number }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim()
  return key === '' || /[\r\n]/u.test(key) ? undefined : key
}

/**
The CLI's subscription key at rest. Only a browser or device-code
sign-in speaks for the subscription: its `access_token` (the captured
`accountLogin` shape, `DEVICE_LOGIN_FILE` in sign-in-detection.md). A
`muse auth set` file holds `api_key` alone (the captured `apiKey`
shape): a pay-as-you-go key, never the subscription, so it reads as
`unsigned` and the turn refuses instead of billing the card as plan.
A macOS Keychain pointer file holds no key here, so it reads as
`keychain`, never as a value. Only the subscription credential string
is picked; every other field is dropped, so no account name, label or
token besides the key itself is ever retained.
*/
export function readSubscriptionKeyText(text: string): SubscriptionKeyRead {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { status: 'unreadable', key: undefined }
  }
  if (!isRecord(raw)) return { status: 'unreadable', key: undefined }
  const version = raw['schema_version']
  // Only the captured schema versions speak; anything else is the CLI's to
  // say, and re-signing into an unknown shape would not fix it.
  if (
    version !== undefined &&
    version !== MUSE_CREDENTIAL_INLINE_SCHEMA &&
    version !== MUSE_CREDENTIAL_POINTER_SCHEMA
  ) {
    return { status: 'unreadable', key: undefined }
  }
  const providers = raw['providers']
  const meta = isRecord(providers) ? providers[MUSE_CREDENTIAL_PROVIDER] : undefined
  const lane = isRecord(meta) ? meta : undefined
  if (
    version === MUSE_CREDENTIAL_POINTER_SCHEMA ||
    lane?.['storage'] === MUSE_CREDENTIAL_KEYCHAIN_STORAGE
  ) {
    return { status: 'keychain', key: undefined }
  }
  const key = cleanKey(lane?.['access_token'])
  return key === undefined ? { status: 'unsigned', key: undefined } : { status: 'ready', key }
}

/** The refusal for a status, naming the fix; it never carries key material. */
export function subscriptionKeyRefusal(status: Exclude<SubscriptionKeyStatus, 'ready'>): string {
  if (status === 'keychain') return UI_TEXT.subscriptionKey.keychainBacked
  return status === 'unreadable'
    ? UI_TEXT.subscriptionKey.cannotRead
    : UI_TEXT.subscriptionKey.signInAgain
}

/** Thrown (never returned as undefined) when the opted-in key cannot be read. */
export class SubscriptionKeyError extends Error {
  public constructor(public readonly status: Exclude<SubscriptionKeyStatus, 'ready'>) {
    super(subscriptionKeyRefusal(status))
    this.name = 'SubscriptionKeyError'
  }
}

/**
No file, as opposed to one that is there and cannot be used. Shared
with the headless preflight, which reads through the run's own bounded
reader instead of the source.
*/
export function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

/** The subscription key, read fresh on every call: nothing is retained. */
export class SubscriptionKeySource {
  private readonly readFile: (path: string) => Promise<string>
  private readonly stat: (path: string) => Promise<{ readonly size: number }>

  public constructor(private readonly deps: SubscriptionKeySourceDeps) {
    this.readFile = deps.readFile ?? ((file: string) => readFile(file, 'utf8'))
    this.stat =
      deps.stat ??
      (async (file: string) => {
        const info = await stat(file)
        return { size: info.size }
      })
  }

  /**
  The CLI's auth file on this OS: `XDG_CONFIG_HOME` honoured on every
  platform (Windows included), else `~/.config` — the same path `muse
  serve` reads, shared here instead of reimplemented per OS.
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
    let size: number
    try {
      const info = await this.stat(file)
      size = info.size
    } catch (error: unknown) {
      // Only a file that is not there reads as missing; one that cannot
      // be statted (EACCES) names the access fix instead.
      return { status: isMissing(error) ? 'missing' : 'unreadable', key: undefined }
    }
    if (size > MUSE_CREDENTIAL_FILE_MAX_BYTES) {
      return { status: 'unreadable', key: undefined }
    }
    let text: string
    try {
      text = await this.readFile(file)
    } catch (error: unknown) {
      return { status: isMissing(error) ? 'missing' : 'unreadable', key: undefined }
    }
    return readSubscriptionKeyText(text)
  }

  /** True while the file currently yields a key. */
  public async isReady(): Promise<boolean> {
    const read = await this.read()
    return read.status === 'ready'
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
The effective Model API credential. With the opt-in on, the subscription
key wins and anything else refuses with the fix: falling back to a pasted
key would bill the user's card for calls they asked to put on their plan.
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
  return read.status === 'ready'
    ? { kind: 'key', key: read.key, billing: 'museCodePlan' }
    : { kind: 'refused', status: read.status }
}
