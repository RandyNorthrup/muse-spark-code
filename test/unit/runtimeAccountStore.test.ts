import { afterEach, describe, expect, it, vi } from 'vitest'
import { promptForMetaAccountKey } from '../../src/host/auth/metaAccountKey'
import { runtimeAccountStore } from '../../src/runtime/providers/accountStore'
import type { AccountProvider } from '../../src/core/providers/accounts'
import type {
  AccountBinding,
  AccountCredential,
  AccountCredentialVault,
} from '../../src/core/providers/accountCredentialRecord'
import type { KeyringEntryFactory } from '../../src/runtime/keyStore'
import { KEYRING_SERVICE } from '../../src/shared/constants'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'

const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function harness(vault?: AccountCredentialVault) {
  const values = new Map<string, string>()
  const names: [string, string][] = []
  const openEntry: KeyringEntryFactory = (service, account) => {
    names.push([service, account])
    return {
      getPassword: () => Promise.resolve(values.get(account) ?? null),
      setPassword: (secret) => {
        values.set(account, secret)
        return Promise.resolve()
      },
      deletePassword: () => Promise.resolve(values.delete(account)),
    }
  }
  let provider: AccountProvider = {
    id: 'meta',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey',
    origin: 'https://api.meta.ai',
  }
  const runtime = runtimeAccountStore({
    metadata: {
      read: (id) => Promise.resolve(id === 'meta' ? provider : undefined),
      writeAccounts: (_id, accounts) => {
        provider = { ...provider, accounts }
        return Promise.resolve()
      },
    },
    openEntry,
    revokeSignIn: vi.fn(() => Promise.resolve()),
    vault,
  })
  disposals.push(runtime.dispose)
  return { ...runtime, values, names }
}

describe('M108 Meta password flow and runtime OS binding', () => {
  it('uses the existing password flow for a second key without replacing default', async () => {
    const h = harness()
    h.values.set('museSpark.modelApiKey', CURRENT_SHAPE_KEYS[0])
    await h.accounts.add('meta', { id: 'work', label: 'Work', order: 1, thresholds: {} })
    const prompt = vi.fn(() => Promise.resolve(`\n ${CURRENT_SHAPE_KEYS[1]} \n`))
    expect(await promptForMetaAccountKey(h.accounts, 'work', prompt)).toBe('stored')
    expect(prompt).toHaveBeenCalledOnce()
    expect(h.values.get('museSpark.modelApiKey')).toBe(CURRENT_SHAPE_KEYS[0])
    expect(h.values.get('museSpark.provider.meta.account.work')).toContain(CURRENT_SHAPE_KEYS[1])
    expect(h.names).toContainEqual([KEYRING_SERVICE, 'museSpark.provider.meta.account.work'])
    const use = vi.fn((_binding: AccountBinding, credential: AccountCredential | undefined) =>
      Promise.resolve(credential?.secret),
    )
    expect(
      await h.accounts.useCredential('meta', 'work', 'https://api.meta.ai/v1/models', use),
    ).toBe(CURRENT_SHAPE_KEYS[1])
    await h.accounts.remove('meta', 'work')
    expect(h.values.has('museSpark.provider.meta.account.work')).toBe(false)
    expect(h.values.get('museSpark.modelApiKey')).toBe(CURRENT_SHAPE_KEYS[0])
  })

  it('handles cancellation, invalid input and an unknown account without storing a key', async () => {
    const h = harness()
    const set = vi.spyOn(h.accounts, 'setCredential')
    expect(
      await promptForMetaAccountKey(h.accounts, 'default', () => Promise.resolve(undefined)),
    ).toBe('cancelled')
    await expect(
      promptForMetaAccountKey(h.accounts, 'default', () => Promise.resolve('invalid')),
    ).rejects.toThrow('invalidCredential')
    expect(set).not.toHaveBeenCalled()
    await expect(
      promptForMetaAccountKey(h.accounts, 'absent', () => Promise.resolve(CURRENT_SHAPE_KEYS[0])),
    ).rejects.toThrow('invalidAccount')
    expect(h.values.size).toBe(0)
    expect(h.names).toEqual([])
  })

  it('routes storage through the injected vault instead of opening the OS adapter', async () => {
    const write = vi.fn(() => Promise.resolve())
    const h = harness({
      read: () => Promise.resolve(undefined),
      readForRemoval: () => Promise.resolve(undefined),
      write,
      remove: () => Promise.resolve(),
    })
    await promptForMetaAccountKey(h.accounts, 'default', () =>
      Promise.resolve(CURRENT_SHAPE_KEYS[0]),
    )
    expect(write).toHaveBeenCalledWith(
      { provider: 'meta', account: 'default', origin: 'https://api.meta.ai' },
      expect.objectContaining({ account: 'default', secret: CURRENT_SHAPE_KEYS[0] }),
    )
    expect(h.names).toEqual([])
    expect(h.values.size).toBe(0)
  })
})
