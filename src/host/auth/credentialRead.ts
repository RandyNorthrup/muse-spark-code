// The three-valued credential read (CATCHMONEY R3; PLAN.md D119): every
// read that guards money, consent or a credential answers found, absent, or
// could-not-read with a closed kind. Booleans that collapse the third state
// into "absent" are deleted; callers switch on the three states and fail
// closed on could-not-read (a billing hold is never released, a sign-in
// never lifts one, "can recover" is never true, no key is asked for as if
// none existed).
//
// This file is the ONE adapter between the credential store and its readers,
// so the KEYSTORE lane (fix/linux-keystore) merges by replacing it: that
// lane owns the OS store's own three outcomes (secret / confirmed absent /
// unreadable with its kind) and "one read per secret per process". Its type
// is `{ outcome: 'found', secret } | { outcome: 'absent' } |
// { outcome: 'unreadable', kind }` with `kind` one of crypto, locked,
// no-service, denied, timeout, other. This file maps the current
// `SecretStore` throws onto exactly those kinds, so readers already switch
// on the shape the keystore lane exports.

import { PROVIDER_SECRET_PREFIX, SECRET_KEYS, UI_TEXT } from '../../shared/constants'
import { fill, setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { wireWordForLog } from '../../core/logging'
import type { SecretStore } from './credentialStore'

/** Closed kinds of "the store could not be read", shared with the keystore lane. */
export const CREDENTIAL_UNREADABLE_KINDS = [
  'crypto',
  'locked',
  'no-service',
  'denied',
  'timeout',
  'other',
] as const

export type CredentialUnreadableKind = (typeof CREDENTIAL_UNREADABLE_KINDS)[number]

/** A credential read: the value's presence, its known absence, or a failure to read. */
export type CredentialRead =
  | { readonly outcome: 'found' }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'unreadable'; readonly kind: CredentialUnreadableKind }

/**
Maps a store throw onto the closed kind, from the error's code or name
only: messages can name profile paths or accounts and never leave the
process past a `wireWordForLog` kind. Anything unrecognised is `other`,
never absence.
*/
export function unreadableKindFor(error: unknown): CredentialUnreadableKind {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  if (code !== undefined) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(code)) return 'denied'
    if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) return 'timeout'
    if (['ENOSYS', 'ENODEV'].includes(code)) return 'no-service'
  }
  const name = error instanceof Error ? error.name : undefined
  if (name !== undefined) {
    if (/lock/i.test(name)) return 'locked'
    if (/crypt/i.test(name)) return 'crypto'
    if (/timeout/i.test(name)) return 'timeout'
    if (/denied|forbidden/i.test(name)) return 'denied'
    if (/noservice|unavailable/i.test(name)) return 'no-service'
  }
  return 'other'
}

/**
The exhaustive-switch check: a `switch (read.outcome)` whose arms cover
all three states narrows `read` to `never` in `default`, so adding a
fourth state or forgetting an arm does not compile.
*/
export function assertExhaustive(outcome: never, where: string): never {
  throw new Error(`Unhandled credential read outcome ${String(outcome)} at ${where}`)
}

/**
The kind word for people (P3-2): a closed translated phrase with the next
step carried by the sentence, never an errno or an internal name. Read at
call time, never at module load, so the installed language is the one
shown. Exhaustive too: a new kind that gains no sentence does not compile.
*/
export function reasonTextForKind(kind: CredentialUnreadableKind): string {
  switch (kind) {
    case 'crypto': {
      return UI_TEXT.credentialStoreReasonCrypto
    }
    case 'locked': {
      return UI_TEXT.credentialStoreReasonLocked
    }
    case 'no-service': {
      return UI_TEXT.credentialStoreReasonNoService
    }
    case 'denied': {
      return UI_TEXT.credentialStoreReasonDenied
    }
    case 'timeout': {
      return UI_TEXT.credentialStoreReasonTimeout
    }
    case 'other': {
      return UI_TEXT.credentialStoreReasonOther
    }
    default: {
      return assertExhaustive(kind, 'credentialRead.reasonTextForKind')
    }
  }
}

/**
A configured provider id: the provider's own id, or its full entry when the
scan must tell a local-model provider (no credential needed) from a remote
one. Structural so the store passes its own list straight through.
*/
export type CredentialProviderId =
  string | { readonly id: string; readonly auth: string; readonly models?: readonly string[] }

/**
What the three-valued credential read needs of a store. The owner keys the
window's once-per-store notice in `hasStoredKey` below and the once-only
`getApiKey` warning beside it; every bundle that loads this file agrees on
one store's state because the bundle is loaded once per process. A
store-read failure warns once per owner with its kind (TBL-02), and a
guarded scan warns once per owner and read kind, both re-armed by a
healthy read, so one persistent failure cannot flood the log.
*/
export interface CredentialReadPort {
  readonly owner: object
  readonly secrets: SecretStore
  readonly warn: (message: string) => void
  readonly storeName: string
  readonly providerIds?: () => PromiseLike<readonly CredentialProviderId[]>
  /**
  C-M95-SUB: an additional credential outside secret storage (the
  opted-in CLI subscription key). Consulted for backend availability
  only; the key itself is never stored here.
  */
  readonly hasSubscriptionCredential?: () => PromiseLike<boolean>
}

/** Stores whose unreadable notice the window already showed, once each. */
const selectionWarningsShown = new WeakSet<object>()

/** Stores whose unreadable key warning `getApiKey` already logged, once each. */
const apiKeyWarningsShown = new WeakSet<object>()

/**
Guarded-scan warnings already logged per owner, by read kind (`key`,
`list`, or `provider:<id>`): one persistent keyring failure warns once
per kind instead of on every backend selection, refresh, hold release
and sign-in scan. A scan with no failures clears the entry, so a
recurrence after a repair warns again.
*/
const scanWarningsShown = new WeakMap<object, Set<string>>()

/**
Marks a guarded-scan warning shown for this owner and kind: true on the
first failure, false on repeats (silent until a healthy scan re-arms).
Call sites keep their own `port.warn` with the redacted kind beside the
check, so the failure still reaches the record through the warn call.
*/
function isScanWarnDue(port: CredentialReadPort, kind: string): boolean {
  let shown = scanWarningsShown.get(port.owner)
  if (shown?.has(kind) === true) return false
  if (shown === undefined) {
    shown = new Set()
    scanWarningsShown.set(port.owner, shown)
  }
  shown.add(kind)
  return true
}

/**
The stored key for operational use (backend key reads); undefined when
there is none or the store cannot be read (PLAN.md D25): on Linux
without a keyring VS Code's secret storage throws, and that must not
block the Muse Code backend, which needs no key.

read-state: cert TBL-02. This collapse is by design for non-guard use
only: anything that guards money, consent or a credential reads
`readModelApiCredential` and switches on all three states instead.
*/
export async function getApiKey(port: CredentialReadPort): Promise<string | undefined> {
  let stored: string | undefined
  try {
    stored = await port.secrets.get(SECRET_KEYS.modelApiKey)
  } catch (error: unknown) {
    // read-state: cert TBL-02 (see the function note): this collapse is by
    // design for operational, non-guard use only. The failure reaches its
    // once-per-owner warning below, with its kind: the log carries only
    // the kind, never the raw error, whose message can name a keyring
    // path (P3-5).
    return unreadableKey(port, error)
  }
  apiKeyWarningsShown.delete(port.owner)
  return stored === undefined || stored === '' ? undefined : stored
}

/**
The collapsed answer when the store cannot be read (TBL-02): no key. The
first failure per owner warns with its kind; later ones stay silent
until a healthy read re-arms the warning, so one persistent failure
cannot flood the log. Operational use only, never a guard.
*/
function unreadableKey(port: CredentialReadPort, error: unknown): string | undefined {
  if (!apiKeyWarningsShown.has(port.owner)) {
    apiKeyWarningsShown.add(port.owner)
    port.warn(
      `${port.storeName} could not be read, so no Model API key is available (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
    )
  }
  return undefined
}

/**
The opted-in CLI subscription's presence as a value: `found`, or the
failure as `cause` for the guarded scan to map onto the closed kind.
The failure keeps its identity into the scan's own warn-once record.
*/
async function readSubscriptionPresence(
  hasSubscriptionCredential: () => PromiseLike<boolean>,
): Promise<{ readonly found: boolean } | { readonly cause: unknown }> {
  try {
    return { found: await hasSubscriptionCredential() }
  } catch (error: unknown) {
    return { cause: error }
  }
}

/**
A Model API credential of either kind (M95, PLAN.md D74): the Meta key
or any provider's secret. Backend selection and the sign-in gate read
this, never the key alone, and switch on all three states: found,
absent, or could-not-read with its kind. Could-not-read never reads as
absence on a path that guards billing (P2-1).
*/
export async function readModelApiCredential(port: CredentialReadPort): Promise<CredentialRead> {
  let unreadable: CredentialUnreadableKind | undefined
  let isFailed = false
  try {
    const stored = await port.secrets.get(SECRET_KEYS.modelApiKey)
    if (stored !== undefined && stored !== '') {
      scanWarningsShown.delete(port.owner)
      return { outcome: 'found' }
    }
  } catch (error: unknown) {
    // An unreadable key says nothing about presence. Every throw maps
    // onto the closed kind (a non-Error keeps its code, else `other`):
    // this read answers in the three states and never throws a foreign
    // value at a guard that has no handler for it. Every failure warns
    // once per kind with its kind, never the raw error.
    isFailed = true
    unreadable = unreadableKindFor(error)
    if (isScanWarnDue(port, 'key'))
      port.warn(
        `${port.storeName} could not be read, so the Model API key's presence is unknown (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
      )
  }
  let ids: readonly CredentialProviderId[] | undefined
  try {
    ids = await port.providerIds?.()
  } catch (error: unknown) {
    // A provider list that cannot be read cannot prove no provider holds
    // a credential either. Every throw maps onto the closed kind.
    isFailed = true
    unreadable ??= unreadableKindFor(error)
    if (isScanWarnDue(port, 'list'))
      port.warn(
        `Provider credentials could not be listed, so their presence is unknown (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
      )
  }
  let isFound = false
  if (ids !== undefined) {
    for (const provider of ids) {
      if (
        typeof provider !== 'string' &&
        provider.auth === 'none' &&
        (provider.models?.length ?? 0) > 0
      ) {
        // A local-model provider needs no credential, so the answer is
        // already found; the scan still continues past it so an unreadable
        // later entry is recorded rather than silently skipped.
        isFound = true
        continue
      }
      const id = typeof provider === 'string' ? provider : provider.id
      try {
        // Auth needs presence only; damaged records count too. Parsing and
        // credential dispatch remain in the lazy provider store.
        const stored = await port.secrets.get(`${PROVIDER_SECRET_PREFIX}${id}`)
        if (stored !== undefined && stored !== '') {
          isFound = true
        }
      } catch (error: unknown) {
        // An entry that cannot be read says nothing about presence, so the
        // scan continues past it; every failure warns once per kind with
        // its kind, never as absence. Every throw maps onto the closed kind.
        isFailed = true
        unreadable ??= unreadableKindFor(error)
        if (isScanWarnDue(port, `provider:${id}`))
          port.warn(
            `${port.storeName} could not be read for provider ${id}, so its credential is unknown (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
          )
      }
    }
  }
  if (!isFound && port.hasSubscriptionCredential !== undefined) {
    // C-M95-SUB: the opted-in CLI subscription counts for availability;
    // the key itself never enters the store.
    const probe = await readSubscriptionPresence(port.hasSubscriptionCredential)
    if ('cause' in probe) {
      // An unreadable subscription says nothing about presence, so the
      // read answers unknown rather than absent (fail closed).
      isFailed = true
      unreadable ??= unreadableKindFor(probe.cause)
      if (isScanWarnDue(port, 'subscription'))
        port.warn(
          `Subscription credential could not be read, so its presence is unknown (${wireWordForLog(probe.cause instanceof Error ? probe.cause.name : typeof probe.cause)})`,
        )
    } else if (probe.found) isFound = true
  }
  if (!isFailed) scanWarningsShown.delete(port.owner)
  if (isFound) {
    return { outcome: 'found' }
  }
  return unreadable === undefined
    ? { outcome: 'absent' }
    : { outcome: 'unreadable', kind: unreadable }
}

/**
The host choice's projection of a credential read (M95, D74): found counts
as present; absent as missing; could-not-read counts as present too (fail
closed) and the person is told once: host choice never proceeds as if no
key existed. A healthy read re-arms the warning: a recurrence after a
repair is shown again.
*/
export async function hasStoredKey(port: {
  readonly owner: object
  readonly store: { readModelApiCredential(): Promise<CredentialRead> }
  readonly warn: (message: string) => void
  readonly showWarning: (message: string) => void
  readonly table: UiText
  readonly locale: string
}): Promise<boolean> {
  setUiText(port.table, port.locale)
  const read = await port.store.readModelApiCredential()
  switch (read.outcome) {
    case 'found': {
      // A healthy read re-arms the warning: a recurrence after
      // a repair is shown again.
      selectionWarningsShown.delete(port.owner)
      return true
    }
    case 'absent': {
      selectionWarningsShown.delete(port.owner)
      return false
    }
    case 'unreadable': {
      port.warn(`Stored credential presence is unknown (${read.kind}); assuming a key may exist`)
      if (!selectionWarningsShown.has(port.owner)) {
        selectionWarningsShown.add(port.owner)
        port.showWarning(
          fill(UI_TEXT.credentialStoreUnreadable, {
            reason: reasonTextForKind(read.kind),
          }),
        )
      }
      return true
    }
    default: {
      return assertExhaustive(read, 'extension.ensureSelectedHost')
    }
  }
}
