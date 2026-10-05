// The Model API key lives only in VS Code secret storage (OS keychain). The
// dependency is the three-method subset of `vscode.SecretStorage`, which the
// real object satisfies structurally, the ACP agent's OS credential store
// implements (PLAN.md D61), and tests replace with a Map.

import { MODEL_API_KEY_PATTERN, SECRET_KEYS } from '../../shared/constants'
import {
  type CredentialRecord,
  deleteProviderCredential,
  readProviderCredential,
  saveProviderCredential,
} from '../providers/credentialRecords'

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

export function isValidModelApiKey(candidate: string): boolean {
  return MODEL_API_KEY_PATTERN.test(candidate.trim())
}

export class CredentialStore {
  private hasReportedFailure = false

  public constructor(
    private readonly secrets: SecretStore,
    /** Where an unreadable secret store is reported, once. */
    private readonly warn: (message: string) => void,
    /** The store's name in that report: the ACP agent's is the OS store (D61). */
    private readonly storeName = "VS Code's secret storage",
    /**
     * The configured provider ids (lane P's providers file). Absent until
     * that lane merges: only the Meta key counts meanwhile.
     */
    private readonly providerIds?: () => PromiseLike<readonly string[]>,
  ) {}

  /**
   * The stored key; undefined when there is none or the store cannot be
   * read (PLAN.md D25): on Linux without a keyring VS Code's secret storage
   * throws, and that must not block the Muse Code backend, which needs no key.
   */
  public async getApiKey(): Promise<string | undefined> {
    let stored: string | undefined
    try {
      stored = await this.secrets.get(SECRET_KEYS.modelApiKey)
    } catch (error: unknown) {
      if (!this.hasReportedFailure) {
        this.hasReportedFailure = true
        this.warn(
          `${this.storeName} could not be read, so no Model API key is available: ${String(error)}`,
        )
      }
      return undefined
    }
    return stored === undefined || stored === '' ? undefined : stored
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

  /** A provider's stored credential record; undefined when none was entered. */
  public async getProviderCredential(id: string): Promise<CredentialRecord | undefined> {
    return await readProviderCredential(this.secrets, id)
  }

  /** Stores a provider's credential record, bound to its origin. */
  public async setProviderCredential(id: string, record: CredentialRecord): Promise<void> {
    await saveProviderCredential(this.secrets, id, record)
  }

  /** Deletes a provider's credential record (removal after its Undo). */
  public async clearProviderCredential(id: string): Promise<void> {
    await deleteProviderCredential(this.secrets, id)
  }

  /**
   * Whether any configured provider holds a credential. A damaged record
   * counts: something is stored for that provider, and the panel asks for
   * the credential again rather than treating it as absent.
   */
  public async hasProviderCredential(): Promise<boolean> {
    const ids = await this.providerIds?.()
    if (ids === undefined) {
      return false
    }
    for (const id of ids) {
      try {
        if ((await readProviderCredential(this.secrets, id)) !== undefined) {
          return true
        }
      } catch {
        return true
      }
    }
    return false
  }

  /**
   * A Model API credential of either kind (M95, PLAN.md D74): the Meta key
   * or any provider's secret. Backend selection and the sign-in gate read
   * this, never the key alone.
   */
  public async hasModelApiCredential(): Promise<boolean> {
    return (await this.getApiKey()) !== undefined || (await this.hasProviderCredential())
  }
}
