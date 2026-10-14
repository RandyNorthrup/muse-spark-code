import { vi } from 'vitest'
import {
  type AccountProvider,
  type AccountsMetadataPort,
} from '../../../src/core/providers/accounts'
import { runtimeAccountStore } from '../../../src/runtime/providers/accountStore'

export function commandAccountsRig() {
  let provider: AccountProvider = {
    id: 'meta',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey',
    origin: 'https://api.meta.ai',
  }
  const values = new Map<string, string>()
  const metadata: AccountsMetadataPort = {
    read: (id) => Promise.resolve(id === provider.id ? provider : undefined),
    writeAccounts: (_id, accounts) => {
      provider = { ...provider, accounts }
      return Promise.resolve()
    },
  }
  const revoke = vi.fn(() => Promise.resolve())
  const runtime = runtimeAccountStore({
    metadata,
    openEntry: (_service, name) => ({
      getPassword: () => Promise.resolve(values.get(name)),
      setPassword: (value) => {
        values.set(name, value)
        return Promise.resolve()
      },
      deletePassword: () => Promise.resolve(values.delete(name)),
    }),
    revokeSignIn: revoke,
  })
  const print = vi.fn<(text: string) => void>()
  const printError = vi.fn<(text: string) => void>()
  return {
    ...runtime,
    values,
    metadata,
    print,
    printError,
    revoke,
    configure: (patch: Partial<AccountProvider>) => {
      provider = { ...provider, ...patch }
    },
    deps: { accounts: runtime.accounts, metadata, print, printError },
  }
}
