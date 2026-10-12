// The Model API key lives only in VS Code secret storage (OS keychain). The
// dependency is the three-method subset of `vscode.SecretStorage`, which the
// real object satisfies structurally, the ACP agent's OS credential store
// implements (PLAN.md D61), and tests replace with a Map.

import { MODEL_API_KEY_PATTERN, PROVIDER_SECRET_PREFIX, SECRET_KEYS } from '../../shared/constants'
import { wireWordForLog } from '../../core/logging'
import {
  unreadableKindFor,
  type CredentialRead,
  type CredentialUnreadableKind,
} from './credentialRead'

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
   * The stored key for operational use (backend key reads); undefined when
   * there is none or the store cannot be read (PLAN.md D25): on Linux
   * without a keyring VS Code's secret storage throws, and that must not
   * block the Muse Code backend, which needs no key.
   *
   * read-state: cert TBL-02. This collapse is by design for non-guard use
   * only: anything that guards money, consent or a credential reads
   * `readModelApiCredential` and switches on all three states instead.
   */
  public async getApiKey(): Promise<string | undefined> {
    let stored: string | undefined
    try {
      stored = await this.secrets.get(SECRET_KEYS.modelApiKey)
    } catch (error: unknown) {
      // read-state: cert TBL-02 (see the method note): this collapse is by
      // design for operational, non-guard use only.
      if (!this.hasReportedFailure) {
        this.hasReportedFailure = true
        // The log carries only the failure's kind, never the raw error: the
        // message can name a keyring path (P3-5).
        this.warn(
          `${this.storeName} could not be read, so no Model API key is available (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
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
   * A Model API credential of either kind (M95, PLAN.md D74): the Meta key
   * or any provider's secret. Backend selection and the sign-in gate read
   * this, never the key alone, and switch on all three states: found,
   * absent, or could-not-read with its kind. Could-not-read never reads as
   * absence on a path that guards billing (P2-1).
   */
  public async readModelApiCredential(): Promise<CredentialRead> {
    let unreadable: CredentialUnreadableKind | undefined
    try {
      const stored = await this.secrets.get(SECRET_KEYS.modelApiKey)
      if (stored !== undefined && stored !== '') {
        return { outcome: 'found' }
      }
    } catch (error: unknown) {
      // An unreadable key says nothing about presence. Anything that is not
      // an error keeps its kind.
      if (!(error instanceof Error)) throw error
      unreadable = unreadableKindFor(error)
      if (!this.hasReportedFailure) {
        this.hasReportedFailure = true
        this.warn(
          `${this.storeName} could not be read, so the Model API key's presence is unknown (${wireWordForLog(error.name)})`,
        )
      }
    }
    let ids:
      | readonly (
          | string
          | { readonly id: string; readonly auth: string; readonly models?: readonly string[] }
        )[]
      | undefined
    try {
      ids = await this.providerIds?.()
    } catch (error: unknown) {
      // A provider list that cannot be read cannot prove no provider holds
      // a credential either. Anything that is not an error keeps its kind.
      if (!(error instanceof Error)) throw error
      unreadable ??= unreadableKindFor(error)
      this.warn(
        `Provider credentials could not be listed, so their presence is unknown (${wireWordForLog(error.name)})`,
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
          unreadable ??= unreadableKindFor(error)
          if (!this.reportedProviders.has(id)) {
            this.reportedProviders.add(id)
            this.warn(
              `${this.storeName} could not be read for provider ${id}, so its credential is unknown (${wireWordForLog(error.name)})`,
            )
          }
        }
      }
    }
    if (isFound) {
      return { outcome: 'found' }
    }
    return unreadable === undefined
      ? { outcome: 'absent' }
      : { outcome: 'unreadable', kind: unreadable }
  }
}
