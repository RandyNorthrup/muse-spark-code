// The Model API key lives only in VS Code secret storage (OS keychain). The
// dependency is the three-method subset of `vscode.SecretStorage`, which the
// real object satisfies structurally, the ACP agent's OS credential store
// implements (PLAN.md D61), and tests replace with a Map.

import { MODEL_API_KEY_PATTERN, PROVIDER_SECRET_PREFIX, SECRET_KEYS } from '../../shared/constants'
import { wireWordForLog } from '../../core/logging'

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
  /** Provider ids whose unreadable entry was already recorded, once each. */
  private readonly reportedProviders = new Set<string>()

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
    private readonly providerIds?: () => PromiseLike<
      readonly (
        string | { readonly id: string; readonly auth: string; readonly models?: readonly string[] }
      )[]
    >,
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

  /**
   * Whether any configured provider holds a credential. A damaged record
   * counts: something is stored for that provider, and the panel asks for
   * the credential again rather than treating it as absent. An unreadable
   * entry is recorded (which provider, the kind) and the scan continues, so
   * one broken entry cannot hide a working provider later in the order; the
   * answer says what was found, the record says what could not be read.
   */
  public async hasProviderCredential(): Promise<boolean> {
    const ids = await this.providerIds?.()
    if (ids === undefined) {
      return false
    }
    let isFound = false
    for (const provider of ids) {
      if (
        typeof provider !== 'string' &&
        provider.auth === 'none' &&
        (provider.models?.length ?? 0) > 0
      ) {
        // Stopping is right: a local-model provider needs no credential, so
        // the answer is already true and no later entry can change it.
        return true
      }
      const id = typeof provider === 'string' ? provider : provider.id
      try {
        // Auth needs presence only; damaged records count too. Parsing and
        // credential dispatch remain in the lazy provider store.
        const stored = await this.secrets.get(`${PROVIDER_SECRET_PREFIX}${id}`)
        if (stored !== undefined && stored !== '') {
          isFound = true
        }
      } catch (error: unknown) {
        // An entry that cannot be read says nothing about presence, so the
        // scan continues past it; the failure is recorded once per provider
        // with its kind, never as absence. Anything that is not an error
        // keeps its kind.
        if (!(error instanceof Error)) throw error
        if (!this.reportedProviders.has(id)) {
          this.reportedProviders.add(id)
          this.warn(
            `${this.storeName} could not be read for provider ${id}, so its credential is unknown (${wireWordForLog(error.name)})`,
          )
        }
      }
    }
    return isFound
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
