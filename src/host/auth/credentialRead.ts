// The three-valued credential read (CATCHMONEY R3; PLAN.md D108): every
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

import { UI_TEXT } from '../../shared/constants'

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
 * Maps a store throw onto the closed kind, from the error's code or name
 * only: messages can name profile paths or accounts and never leave the
 * process past a `wireWordForLog` kind. Anything unrecognised is `other`,
 * never absence.
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
 * The exhaustive-switch check: a `switch (read.outcome)` whose arms cover
 * all three states narrows `read` to `never` in `default`, so adding a
 * fourth state or forgetting an arm does not compile.
 */
export function assertExhaustive(outcome: never, where: string): never {
  throw new Error(`Unhandled credential read outcome ${String(outcome)} at ${where}`)
}

/**
 * The kind word for people (P3-2): a closed translated phrase with the next
 * step carried by the sentence, never an errno or an internal name. Read at
 * call time, never at module load, so the installed language is the one
 * shown. Exhaustive too: a new kind that gains no sentence does not compile.
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
