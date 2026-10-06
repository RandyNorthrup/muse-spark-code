// Shared account operations for the panel, native bridges, ACP and headless.
// M95 owns providers.json's envelope/atomic I/O. Only its accounts field is
// written here; secrets and vendor responses have separate injected ports.
import {
  accountIdSchema,
  accountSchema,
  accountThresholdsSchema,
  type Account,
  type AccountThresholds,
} from '../../shared/accounts'
import { ACCOUNT_DEFAULT_ID, UI_TEXT } from '../../shared/constants'
import { accountPolicyFor } from './accountPolicy'
import {
  accountBindingSchema,
  boundCredential,
  AccountStoreError,
  type AccountBinding,
  type AccountCredential,
  type AccountCredentialVault,
} from './credentialRecord'
import { providersAccountsSchema } from './providersFile'

/** M95's configured identity and endpoint, independent of its file envelope. */
export interface AccountProvider {
  readonly id: string
  readonly policyProvider: string
  readonly product: string
  readonly auth: 'apiKey' | 'oauth' | 'subscription' | 'none'
  readonly origin: string
  readonly accounts?: readonly Account[] | undefined
}
export interface AccountsMetadataPort {
  read(provider: string): Promise<AccountProvider | undefined>
  /** Atomically replace only accounts, preserving the rest of providers.json. */
  writeAccounts(provider: string, accounts: readonly Account[]): Promise<void>
}

export class AccountStore {
  private writes: Promise<void> = Promise.resolve()

  public constructor(
    private readonly metadata: AccountsMetadataPort,
    private readonly credentials: AccountCredentialVault,
  ) {}

  private async provider(id: string): Promise<AccountProvider> {
    if (!accountIdSchema.safeParse(id).success) throw new AccountStoreError('invalidAccount')
    const provider = await this.metadata.read(id)
    if (provider?.id !== id) throw new AccountStoreError('unavailable')
    return provider
  }

  private pool(provider: AccountProvider): Account[] {
    // An explicit empty pool means removed. Only an absent field migrates.
    return providersAccountsSchema.parse(
      provider.accounts ?? [
        { id: ACCOUNT_DEFAULT_ID, label: UI_TEXT.accounts.defaultLabel, order: 0, thresholds: {} },
      ],
    )
  }

  /** Serialize mutations, including revocation, so concurrent adds cannot lose rows. */
  private async mutate<T>(use: () => Promise<T>): Promise<T> {
    const previous = this.writes
    const operation = (async () => {
      await previous
      return await use()
    })()
    this.writes = (async () => {
      try {
        await operation
      } catch {
        // The caller receives the error; a later mutation may still succeed.
      }
    })()
    return await operation
  }

  private binding(entry: AccountProvider, account: string): AccountBinding {
    if (this.pool(entry).every((row) => row.id !== account)) {
      throw new AccountStoreError('invalidAccount')
    }
    return accountBindingSchema.parse({ provider: entry.id, account, origin: entry.origin })
  }

  private assertCredentialsOffered(entry: AccountProvider): void {
    const policy = accountPolicyFor(entry.policyProvider, entry.product)
    if (
      entry.auth === 'none' ||
      policy?.pooling === 'notOffered' ||
      policy?.isCredentialHeld === false
    ) {
      throw new AccountStoreError('notOffered')
    }
    // Separate CLI config homes are lane M, capture-gated by Q-M108.
    if (entry.product === 'muse-code') throw new AccountStoreError('unavailable')
  }

  public async list(provider: string): Promise<Account[]> {
    return this.pool(await this.provider(provider)).toSorted((a, b) => a.order - b.order)
  }

  public async add(provider: string, value: Account): Promise<void> {
    await this.mutate(async () => {
      const entry = await this.provider(provider)
      this.assertCredentialsOffered(entry)
      const pool = providersAccountsSchema.parse([...this.pool(entry), value])
      await this.metadata.writeAccounts(provider, pool)
    })
  }

  public async update(provider: string, value: Account): Promise<void> {
    await this.mutate(async () => {
      const account = accountSchema.parse(value)
      const pool = this.pool(await this.provider(provider))
      if (pool.every((row) => row.id !== account.id)) throw new AccountStoreError('invalidAccount')
      await this.metadata.writeAccounts(
        provider,
        pool.map((row) => (row.id === account.id ? account : row)),
      )
    })
  }

  public async order(provider: string, ids: readonly string[]): Promise<void> {
    await this.mutate(async () => {
      const pool = this.pool(await this.provider(provider))
      if (
        ids.length !== pool.length ||
        new Set(ids).size !== ids.length ||
        pool.some((row) => !ids.includes(row.id))
      ) {
        throw new AccountStoreError('invalidAccount')
      }
      const next = pool.map((row) => ({ ...row, order: ids.indexOf(row.id) }))
      await this.metadata.writeAccounts(provider, next)
    })
  }

  public async thresholds(
    provider: string,
    account: string,
    value: AccountThresholds,
  ): Promise<void> {
    await this.mutate(async () => {
      const pool = this.pool(await this.provider(provider))
      if (pool.every((row) => row.id !== account)) throw new AccountStoreError('invalidAccount')
      const thresholds = accountThresholdsSchema.parse(value)
      await this.metadata.writeAccounts(
        provider,
        pool.map((row) => (row.id === account ? { ...row, thresholds } : row)),
      )
    })
  }

  /** Password/stdin callers supply the secret; bridge requests never do. */
  public async setCredential(
    provider: string,
    account: string,
    record: AccountCredential,
  ): Promise<void> {
    await this.mutate(async () => {
      const entry = await this.provider(provider)
      this.assertCredentialsOffered(entry)
      const binding = this.binding(entry, account)
      await this.credentials.write(binding, boundCredential(record, binding))
    })
  }

  public async remove(provider: string, account: string): Promise<void> {
    await this.mutate(async () => {
      const binding = this.binding(await this.provider(provider), account)
      // Revocation/deletion must finish before a successful metadata removal.
      await this.credentials.remove(binding)
      await this.metadata.writeAccounts(
        provider,
        this.pool(await this.provider(provider)).filter((row) => row.id !== account),
      )
    })
  }

  /** M95 registry and model scans use the same account-bound credential lookup. */
  public async useCredential<T>(
    provider: string,
    account: string,
    requestUrl: string,
    use: (binding: AccountBinding, credential: AccountCredential | undefined) => Promise<T>,
  ): Promise<T> {
    const entry = await this.provider(provider)
    if (entry.auth !== 'none') this.assertCredentialsOffered(entry)
    const binding = this.binding(entry, account)
    if (new URL(requestUrl).origin !== binding.origin) throw new AccountStoreError('originMismatch')
    const stored = entry.auth === 'none' ? undefined : await this.credentials.read(binding)
    if (stored === undefined && entry.auth !== 'none') throw new AccountStoreError('unavailable')
    const credential = stored === undefined ? undefined : boundCredential(stored, binding)
    return await use(binding, credential)
  }
}

/** One factory call per account lookup; no client/header/cache crosses identities. */
export interface AccountClientPort<Client, Scan> {
  create(binding: AccountBinding, credential: AccountCredential | undefined): Promise<Client>
  scan(binding: AccountBinding, client: Client): Promise<Scan>
}
export function accountClientLookup<Client, Scan>(
  accounts: AccountStore,
  clients: AccountClientPort<Client, Scan>,
): {
  client(provider: string, account: string, requestUrl: string): Promise<Client>
  scan(provider: string, account: string, requestUrl: string): Promise<Scan>
} {
  return {
    async client(provider, account, requestUrl) {
      return await accounts.useCredential(
        provider,
        account,
        requestUrl,
        async (binding, credential) => await clients.create(binding, credential),
      )
    },
    async scan(provider, account, requestUrl) {
      return await accounts.useCredential(
        provider,
        account,
        requestUrl,
        async (binding, credential) =>
          await clients.scan(binding, await clients.create(binding, credential)),
      )
    },
  }
}
