// The Model API key lives only in VS Code secret storage (OS keychain). The
// dependency is the three-method subset of `vscode.SecretStorage`, which the
// real object satisfies structurally, the ACP agent's OS credential store
// implements (PLAN.md D61), and tests replace with a Map.

import { MODEL_API_KEY_PATTERN, SECRET_KEYS } from '../../shared/constants'

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
          `VS Code's secret storage could not be read, so no Model API key is available: ${String(error)}`,
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
}
