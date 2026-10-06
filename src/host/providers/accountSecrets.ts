// SecretStorage adapter until M109's vault is composed. No VS Code import:
// native bridges use their secret port; the runtime uses the same OS names.
import * as z from 'zod/mini'
import {
  accountBindingSchema,
  accountSecretKey,
  boundCredential,
  AccountStoreError,
  type AccountBinding,
  type AccountCredential,
  type AccountCredentialVault,
} from '../../core/providers/credentialRecord'
import { registerSecretValue } from '../../core/redact'
import { ACCOUNT_DEFAULT_ID, MODEL_API_BASE_URL } from '../../shared/constants'
import { isValidModelApiKey, type SecretStore } from '../auth/credentialStore'

const legacyRecordSchema = z.strictObject({
  v: z.literal(1),
  auth: z.enum(['apiKey', 'oauth', 'subscription']),
  origin: z.url(),
  secret: z.string().check(z.minLength(1)),
})

/** The interim vault is real SecretStorage/OS-store I/O, never a fake. */
export function secretStorageAccountVault(secrets: SecretStore): AccountCredentialVault {
  return {
    async read(binding) {
      accountBindingSchema.parse(binding)
      const stored = await secrets.get(accountSecretKey(binding.provider, binding.account))
      if (stored === undefined || stored === '') return
      if (binding.provider === 'meta' && binding.account === ACCOUNT_DEFAULT_ID) {
        // Meta's original entry is a raw key; its origin has always been fixed.
        if (binding.origin !== new URL(MODEL_API_BASE_URL).origin) {
          throw new AccountStoreError('originMismatch')
        }
        if (!isValidModelApiKey(stored)) throw new AccountStoreError('invalidCredential')
        return { ...binding, v: 1, auth: 'apiKey', secret: stored }
      }
      let value: unknown
      try {
        value = JSON.parse(stored)
      } catch {
        throw new AccountStoreError('invalidCredential')
      }
      // Only the legacy default name may omit account identity. Other names
      // must carry it, so copying one account's record cannot authenticate another.
      const legacy = legacyRecordSchema.safeParse(value)
      return boundCredential(
        binding.account === ACCOUNT_DEFAULT_ID && legacy.success
          ? { ...legacy.data, provider: binding.provider, account: binding.account }
          : value,
        binding,
      )
    },
    async write(binding, value) {
      accountBindingSchema.parse(binding)
      const record = boundCredential(value, binding)
      const isMetaDefault = binding.provider === 'meta' && binding.account === ACCOUNT_DEFAULT_ID
      if (
        isMetaDefault &&
        (record.auth !== 'apiKey' || record.origin !== new URL(MODEL_API_BASE_URL).origin)
      ) {
        throw new AccountStoreError('invalidCredential')
      }
      await secrets.store(
        accountSecretKey(binding.provider, binding.account),
        isMetaDefault ? record.secret : JSON.stringify(record),
      )
    },
    async remove(binding) {
      accountBindingSchema.parse(binding)
      await secrets.delete(accountSecretKey(binding.provider, binding.account))
    },
  }
}

export interface AccountSecretsDeps {
  readonly vault: AccountCredentialVault
  /** M95b revokes with its captured provider flow; errors prevent successful removal. */
  readonly revokeSignIn: (binding: AccountBinding, record: AccountCredential) => Promise<void>
  /** Inject the calling bundle's redactor, so lazy bundles share its registry. */
  readonly registerSecret?: ((secret: string) => () => void) | undefined
}

/** Every read/write validates identity, and registers all keys, not just Meta. */
export class AccountSecrets implements AccountCredentialVault {
  private readonly registrations = new Map<string, () => void>()
  private isDisposed = false

  public constructor(private readonly deps: AccountSecretsDeps) {}

  private register(secret: string): void {
    if (!this.registrations.has(secret)) {
      this.registrations.set(secret, (this.deps.registerSecret ?? registerSecretValue)(secret))
    }
  }

  private check(binding: AccountBinding): void {
    if (this.isDisposed) throw new AccountStoreError('unavailable')
    if (!accountBindingSchema.safeParse(binding).success) {
      throw new AccountStoreError('invalidAccount')
    }
    if (binding.provider === 'meta' && binding.origin !== new URL(MODEL_API_BASE_URL).origin) {
      throw new AccountStoreError('originMismatch')
    }
  }

  public async read(binding: AccountBinding): Promise<AccountCredential | undefined> {
    this.check(binding)
    let value: AccountCredential | undefined
    try {
      value = await this.deps.vault.read(binding)
    } catch (error) {
      throw error instanceof AccountStoreError ? error : new AccountStoreError('unavailable')
    }
    // A vault must never bypass account/origin checking, including M109's port.
    this.check(binding)
    if (value === undefined) return undefined
    const record = boundCredential(value, binding)
    this.register(record.secret)
    return record
  }

  public async write(binding: AccountBinding, value: AccountCredential): Promise<void> {
    this.check(binding)
    const record = boundCredential(value, binding)
    if (binding.provider === 'meta' && !isValidModelApiKey(record.secret)) {
      throw new AccountStoreError('invalidCredential')
    }
    // Even a failed storage call may echo the attempted value in an error.
    this.register(record.secret)
    try {
      await this.deps.vault.write(binding, record)
    } catch {
      throw new AccountStoreError('unavailable')
    }
  }

  public async remove(binding: AccountBinding): Promise<void> {
    const record = await this.read(binding)
    try {
      if (record !== undefined && record.auth !== 'apiKey') {
        await this.deps.revokeSignIn(binding, record)
      }
      this.check(binding)
      await this.deps.vault.remove(binding)
    } catch {
      throw new AccountStoreError('unavailable')
    }
  }

  public dispose(): void {
    this.isDisposed = true
    for (const release of this.registrations.values()) release()
    this.registrations.clear()
  }
}
