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
  A Model API credential of either kind (M95, PLAN.md D74): the Meta key
  or any provider's secret. Backend selection and the sign-in gate read
  this, never the key alone, and switch on all three states. The scan
  itself loads with the credential bundle (dist/auth.js); behaviour is
  unchanged, including the provider scan's results.
  */
  public async readModelApiCredential(): Promise<CredentialRead> {
    const { readModelApiCredential } = await import('./authEntry')
    return await readModelApiCredential({
      owner: this,
      secrets: this.secrets,
      warn: this.warn,
      storeName: this.storeName,
      ...(this.providerIds !== undefined && { providerIds: this.providerIds }),
    })
  }
}
