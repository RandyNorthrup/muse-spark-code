import type { Account } from '../../../../src/shared/accounts'
import type { AccountsMetadataPort } from '../../../../src/core/providers/accounts'

export function poolMetadata(rows: Account[], origin: string): AccountsMetadataPort {
  return {
    read: (provider) =>
      Promise.resolve({
        id: provider,
        policyProvider: 'anthropic',
        product: 'api',
        auth: 'apiKey',
        origin,
        accounts: rows,
      }),
    writeAccounts: (_provider, accounts) => {
      rows.splice(0, rows.length, ...accounts)
      return Promise.resolve()
    },
  }
}
