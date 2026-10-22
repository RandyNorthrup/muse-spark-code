// The estimator's ownership generation answers "who pays", not "which
// bytes" (M117 round 7, edge 3): it changes exactly when the identity
// behind a credential an estimator producer uses changes — a key replaced
// or removed, an account signed out or switched. A refreshed token for the
// same account is the same owner: no change.
//
// Identity is compared, never raw bytes, and no secret bytes are retained:
// byte-backed identities compare by SHA-256 digest, held in memory only and
// never logged, shown or passed to a child process. A JSON record carries
// its own stable identity: an `accountIdHash` (ChatGPT's non-reversible
// account identifier, stable across refreshes) wins; an `apiKey` record's
// key is its identity, so a replaced key is a new owner.
import { createHash } from 'node:crypto'
import { PROVIDER_SECRET_PREFIX, SECRET_KEYS } from '../../shared/constants'

/** Secret keys behind which an estimator producer's credential may sit. */
export function isProviderCredentialKey(key: string): boolean {
  return key === SECRET_KEYS.modelApiKey || key.startsWith(PROVIDER_SECRET_PREFIX)
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
The stable identity behind one stored credential value, for equality
only. Never logged or shown: digests are one-way, and the account hash
is already non-reversible.
*/
export function providerCredentialIdentity(stored: string | undefined): string {
  if (stored === undefined || stored === '') return 'absent'
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    // A raw key (Meta's original entry): the bytes are the identity, so a
    // replaced key is a new owner while a re-saved one is not.
    return `value:${digest(stored)}`
  }
  if (typeof parsed !== 'object' || parsed === null) return `value:${digest(stored)}`
  const record = parsed as Record<string, unknown>
  // A refreshed token for the same account keeps this hash: no change.
  if (typeof record['accountIdHash'] === 'string' && record['accountIdHash'] !== '')
    return `account:${record['accountIdHash']}`
  // An apiKey record's key is its identity: replacing the key changes the
  // owner; anything else in the record does not.
  if (record['auth'] === 'apiKey' && typeof record['secret'] === 'string')
    return `key:${digest(record['secret'])}`
  // oauth/subscription records without an account hash, and anything
  // unrecognised: any byte change is a new identity (fail-safe direction).
  return `value:${digest(stored)}`
}

export interface ProviderCredentialReader {
  // `Thenable` because VS Code's SecretStorage get returns one; `await`
  // accepts either.
  get(key: string): PromiseLike<string | undefined>
}

/**
Tracks one generation counter's inputs. `noteSecretChanged` handles one
SecretStorage change for `key`: keys no estimator producer reads are
ignored, a first-seen key bumps fail-safe (its prior identity is
unknown), and otherwise only an identity change bumps. Events serialize,
so two rapid saves compare in order. Seeding snapshots baselines without
bumping.
*/
export function createProviderGenerationTracker(deps: {
  readonly secrets: ProviderCredentialReader
  readonly onGenerationChanged: () => void
}): {
  readonly seed: (keys: readonly string[]) => Promise<void>
  readonly noteSecretChanged: (key: string) => Promise<void>
} {
  const identities = new Map<string, string>()
  let pending = Promise.resolve()
  const readIdentity = async (key: string): Promise<string> => {
    try {
      return providerCredentialIdentity(await deps.secrets.get(key))
    } catch {
      // An unreadable credential cannot prove it is unchanged: fail safe.
      return `unreadable:${String(Date.now())}`
    }
  }
  return {
    seed: (keys) => {
      const previous = pending
      pending = (async () => {
        await previous
        for (const key of keys) identities.set(key, await readIdentity(key))
      })()
      return pending
    },
    noteSecretChanged: (key) => {
      if (!isProviderCredentialKey(key)) return Promise.resolve()
      const previous = pending
      pending = (async () => {
        await previous
        const identity = await readIdentity(key)
        const known = identities.get(key)
        identities.set(key, identity)
        // A first-seen key has no baseline to compare: bump fail-safe.
        if (known === undefined || known !== identity) deps.onGenerationChanged()
      })()
      return pending
    },
  }
}
