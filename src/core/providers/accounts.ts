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
  accountSecretKey,
  boundCredential,
  AccountStoreError,
  type AccountBinding,
  type AccountCredential,
  type AccountCredentialVault,
} from './accountCredentialRecord'
import { accountPoolSchema as providersAccountsSchema } from '../../shared/accounts'

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
  // All instances in the process share the mutation queue and removal fence,
  // even when their metadata/vault adapters are separate objects.
  private static writes: Promise<void> = Promise.resolve()
  private static readonly generations = new Map<string, number>()
  private static readonly removing = new Set<string>()
  private static readonly additions = new Map<string, symbol>()

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
    const previous = AccountStore.writes
    const operation = (async () => {
      await previous
      return await use()
    })()
    AccountStore.writes = (async () => {
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

  /** The returned token owns this addition until its successful removal. */
  public async add(provider: string, value: Account): Promise<symbol> {
    return await this.mutate(async () => {
      const entry = await this.provider(provider)
      this.assertCredentialsOffered(entry)
      const pool = providersAccountsSchema.parse([...this.pool(entry), value])
      await this.metadata.writeAccounts(provider, pool)
      const addition = Symbol()
      AccountStore.additions.set(accountSecretKey(provider, value.id), addition)
      return addition
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

  /** Rollback deletes only the addition that still owns the supplied token. */
  public async remove(provider: string, account: string, addition?: symbol): Promise<void> {
    await this.mutate(async () => {
      const key = accountSecretKey(provider, account)
      // Compare and deletion share the queue, including through other store instances.
      if (addition !== undefined && AccountStore.additions.get(key) !== addition) return
      const binding = this.binding(await this.provider(provider), account)
      AccountStore.generations.set(key, (AccountStore.generations.get(key) ?? 0) + 1)
      AccountStore.removing.add(key)
      try {
        // Revocation/deletion must finish before a successful metadata removal.
        await this.credentials.remove(binding)
        await this.metadata.writeAccounts(
          provider,
          this.pool(await this.provider(provider)).filter((row) => row.id !== account),
        )
        AccountStore.additions.delete(key)
      } finally {
        AccountStore.removing.delete(key)
      }
    })
  }

  /** Reuse the existing account only after the user confirms its new exact origin. */
  public async rebindOrigin(
    provider: string,
    account: string,
    isConfirmed: (previous: AccountBinding, next: AccountBinding) => Promise<boolean>,
  ): Promise<void> {
    await this.mutate(async () => {
      const entry = await this.provider(provider)
      this.assertCredentialsOffered(entry)
      const binding = this.binding(entry, account)
      const stored = await this.credentials.readForRemoval(binding)
      if (stored === undefined) throw new AccountStoreError('invalidCredential')
      const previous = { ...binding, origin: stored.origin }
      const record = boundCredential(stored, previous)
      if (previous.origin === binding.origin) return
      if (!(await isConfirmed(previous, binding))) throw new AccountStoreError('originMismatch')
      const current = await this.provider(provider)
      if (this.binding(current, account).origin !== binding.origin || current.auth !== entry.auth) {
        throw new AccountStoreError('originMismatch')
      }
      const key = accountSecretKey(provider, account)
      AccountStore.generations.set(key, (AccountStore.generations.get(key) ?? 0) + 1)
      await this.credentials.write(binding, { ...record, origin: binding.origin })
    })
  }

  /** M95 registry and model scans use the same account-bound credential lookup. */
  public async useCredential<T>(
    provider: string,
    account: string,
    requestUrl: string,
    use: (binding: AccountBinding, credential: AccountCredential | undefined) => Promise<T>,
  ): Promise<T> {
    if (
      !accountIdSchema.safeParse(provider).success ||
      !accountIdSchema.safeParse(account).success
    ) {
      throw new AccountStoreError('invalidAccount')
    }
    const key = accountSecretKey(provider, account)
    const generation = AccountStore.generations.get(key) ?? 0
    const entry = await this.provider(provider)
    if (entry.auth !== 'none') this.assertCredentialsOffered(entry)
    const binding = this.binding(entry, account)
    if (new URL(requestUrl).origin !== binding.origin) throw new AccountStoreError('originMismatch')
    const stored = entry.auth === 'none' ? undefined : await this.credentials.read(binding)
    if (stored === undefined && entry.auth !== 'none') throw new AccountStoreError('unavailable')
    const credential = stored === undefined ? undefined : boundCredential(stored, binding)
    const current = await this.provider(provider)
    if (generation !== (AccountStore.generations.get(key) ?? 0) || AccountStore.removing.has(key)) {
      throw new AccountStoreError('invalidAccount')
    }
    if (current.auth !== 'none') this.assertCredentialsOffered(current)
    const currentBinding = this.binding(current, account)
    if (currentBinding.origin !== binding.origin || current.auth !== entry.auth) {
      throw new AccountStoreError('originMismatch')
    }
    // No await between the final fence and dispatch: removal linearizes here.
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
