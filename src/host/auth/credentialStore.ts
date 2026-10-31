// The Model API key lives only in VS Code secret storage (OS keychain). The
// dependency is the three-method subset of `vscode.SecretStorage`, which the
// real object satisfies structurally, the ACP agent's OS credential store
// implements (PLAN.md D61), and tests replace with a Map.

import { MODEL_API_KEY_PATTERN, SECRET_KEYS } from '../../shared/constants'
import type { CredentialProviderId, CredentialRead } from './credentialRead'

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

/** A secret store whose reads one process owns: `forget` drops one remembered entry. */
export interface SingleFlightSecretStore extends SecretStore {
  /** Drop one entry's remembered value; the next use reads the store once more. */
  forget(key: string): void
}

/**
One owner of secret reads in a process (the reconciled keystore wrapper,
docs/certification/rlm109.md, source 07 declined verbatim): concurrent
reads of one entry share the one in-flight read (single flight), and a
settled value — a secret or a confirmed absence — is remembered, so the
OS store is read once per entry until something forgets it. Dozens of
reads per turn made rare Secret Service failures a certainty on Linux;
one read per entry makes them rare again. This process's own store and
delete update the remembered value (a failed write forgets instead: it
may or may not have landed). A failed read is shared by its current
waiters and never remembered: the next call reads the store again,
because the caller asked again — there is no retry inside a call, no
attempt count of ours, and the store's own error (with its retained
cause) reaches every waiter unchanged. `forget` is called when a
provider rejects the remembered key and when the editor reports a
secret changed, so the next use reads the store once more.
*/
export function createSingleFlightSecretStore(underlying: SecretStore): SingleFlightSecretStore {
  const remembered = new Map<string, string | undefined>()
  const inflight = new Map<
    string,
    { readonly epoch: number; readonly work: Promise<string | undefined> }
  >()
  // Bumped whenever an entry is forgotten or written through this owner,
  // so a read that started earlier cannot remember its older value over
  // the newer state when it settles.
  const epochs = new Map<string, number>()
  const epochOf = (key: string): number => epochs.get(key) ?? 0
  const bump = (key: string): void => {
    epochs.set(key, epochOf(key) + 1)
  }
  const forget = (key: string): void => {
    bump(key)
    remembered.delete(key)
  }
  const readOnce = (key: string): Promise<string | undefined> => {
    const epoch = epochOf(key)
    const work = (async (): Promise<string | undefined> => {
      try {
        const value = await underlying.get(key)
        if (epochOf(key) === epoch) remembered.set(key, value)
        return value
      } finally {
        if (inflight.get(key)?.epoch === epoch) inflight.delete(key)
      }
    })()
    inflight.set(key, { epoch, work })
    return work
  }
  return {
    get: async (key) => {
      if (remembered.has(key)) return remembered.get(key)
      const running = inflight.get(key)
      // A read started before a forget or a write reads the older state:
      // a caller arriving after it starts a fresh read instead of
      // joining the stale one.
      return await (running?.epoch === epochOf(key) ? running.work : readOnce(key))
    },
    store: async (key, value) => {
      bump(key)
      try {
        await underlying.store(key, value)
      } catch (error: unknown) {
        // The write may or may not have landed: forget, so the next read
        // looks at the store instead of trusting either outcome.
        bump(key)
        remembered.delete(key)
        throw error
      }
      // Bumped again as the write settles, so a read that started while
      // the write was in flight (and may have read the older value)
      // cannot remember its result over the value this write just wrote.
      bump(key)
      remembered.set(key, value)
    },
    delete: async (key) => {
      bump(key)
      try {
        await underlying.delete(key)
      } catch (error: unknown) {
        bump(key)
        remembered.delete(key)
        throw error
      }
      bump(key)
      remembered.set(key, undefined)
    },
    forget,
  }
}

/**
Forget each entry the editor's secret storage reports changed. VS Code's
`SecretStorage` carries an `onDidChange` event with the changed key; the
three-method `SecretStore` subset does not, so the editor subscribes on
the real object and reports here. The next use of a changed entry reads
the store once more.
*/
export function watchSecretChanges(
  source: {
    onDidChange(listener: (event: { readonly key: string }) => void): { dispose(): unknown }
  },
  store: Pick<SingleFlightSecretStore, 'forget'>,
): { dispose(): unknown } {
  return source.onDidChange((event) => {
    store.forget(event.key)
  })
}

export function isValidModelApiKey(candidate: string): boolean {
  return MODEL_API_KEY_PATTERN.test(candidate.trim())
}

/**
Whether the credential store itself cannot be used. Name-based, not
`instanceof`: lazy bundles carry their own copy of the store error, so an
error thrown by one copy is not an instance of another's class.
*/
export function isCredentialStoreDown(error: unknown): boolean {
  return error instanceof Error && error.name === 'StoreUnavailableError'
}

export class CredentialStore {
  public constructor(
    private readonly secrets: SecretStore,
    /** Where an unreadable secret store is reported, once. */
    private readonly warn: (message: string) => void,
    /** The store's name in that report: the ACP agent's is the OS store (D61). */
    private readonly storeName = "VS Code's secret storage",
    /**
    The configured provider ids (lane P's providers file). Absent until
    that lane merges: only the Meta key counts meanwhile.
    */
    private readonly providerIds?: () => PromiseLike<readonly CredentialProviderId[]>,
    /**
    C-M95-SUB: an additional credential outside secret storage (the
    opted-in CLI subscription key). Consulted for backend availability
    only; the key itself is never stored here.
    */
    private readonly hasSubscriptionCredential?: () => PromiseLike<boolean>,
  ) {}

  /**
  The stored key for operational use (backend key reads); undefined when
  there is none or the store cannot be read (PLAN.md D25). The read
  itself loads with the credential bundle (dist/auth.js); behaviour is
  unchanged, including the once-only notice and its re-arm.
  */
  public async getApiKey(): Promise<string | undefined> {
    const { getApiKey } = await import('./authEntry')
    return await getApiKey({
      owner: this,
      secrets: this.secrets,
      warn: this.warn,
      storeName: this.storeName,
    })
  }

  /** Stores a validated key; throws on an invalid shape so a typo never lands. */
  public async setApiKey(candidate: string): Promise<void> {
    const key = candidate.trim()
    if (!isValidModelApiKey(key)) {
      throw new Error('Refusing to store a value that is not a Meta Model API key')
    }
    await this.secrets.store(SECRET_KEYS.modelApiKey, key)
  }

  public async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEYS.modelApiKey)
  }

  /**
  A Model API credential of any kind (M95, PLAN.md D74): the Meta key,
  any provider's secret, or the opted-in CLI subscription (C-M95-SUB).
  Backend selection and the sign-in gate read this, never the key alone,
  and switch on all three states. The scan itself loads with the
  credential bundle (dist/auth.js); behaviour is unchanged, including the
  provider scan's results.
  */
  public async readModelApiCredential(): Promise<CredentialRead> {
    const { readModelApiCredential } = await import('./authEntry')
    return await readModelApiCredential({
      owner: this,
      secrets: this.secrets,
      warn: this.warn,
      storeName: this.storeName,
      ...(this.providerIds !== undefined && { providerIds: this.providerIds }),
      ...(this.hasSubscriptionCredential !== undefined && {
        hasSubscriptionCredential: this.hasSubscriptionCredential,
      }),
    })
  }

  /**
  A Model API credential of any kind (M95, PLAN.md D74): the Meta key,
  any provider's secret, or the opted-in CLI subscription (C-M95-SUB).
  Backend selection and the sign-in gate read this, never the key alone.
  An unreadable store reads as no credential here; the read warns once.
  */
  public async hasModelApiCredential(): Promise<boolean> {
    const read = await this.readModelApiCredential()
    return read.outcome === 'found'
  }
}
