// M95 lane K (PLAN.md D74): a provider's secret counts as a Model API
// credential, beside the Meta key, and lives in its own SecretStorage record.

import { describe, expect, it } from 'vitest'
import { ProviderCredentialStore as CredentialStore } from '../../src/host/providers/credentialRecords'
import { providerSecretKey } from '../../src/host/providers/credentialRecords'
import { memorySecrets, unexpectedWarning } from './helpers/fakes'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'
import { providerCredentials } from '../../src/host/models/modelsPanelBundle'

const RECORD = {
  v: 1 as const,
  auth: 'apiKey' as const,
  origin: 'https://openrouter.ai',
  secret: 'sk-or-test-key',
}

function storeWithIds(ids: readonly string[]): CredentialStore {
  return new CredentialStore(memorySecrets(), unexpectedWarning, 'test store', () =>
    Promise.resolve(ids),
  )
}

describe('provider credentials in the credential store', () => {
  it('admits a configured local model without a secret', async () => {
    const store = providerCredentials(
      memorySecrets(),
      {
        trace: () => undefined,
        info: () => undefined,
        warn: unexpectedWarning,
        error: unexpectedWarning,
      },
      () =>
        Promise.resolve([
          {
            id: 'ollama',
            preset: 'ollama',
            address: 'http://127.0.0.1:11434',
            auth: 'none',
            models: ['qwen3:8b'],
          },
        ]),
    )
    expect(await store.hasModelApiCredential()).toBe(true)
  })
  it('round-trips a provider record under its own secret', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets, unexpectedWarning)
    expect(await store.getProviderCredential('openrouter')).toBeUndefined()
    await store.setProviderCredential('openrouter', RECORD)
    expect(await store.getProviderCredential('openrouter')).toEqual(RECORD)
    expect(secrets.values.has(providerSecretKey('openrouter'))).toBe(true)
    await store.clearProviderCredential('openrouter')
    expect(await store.getProviderCredential('openrouter')).toBeUndefined()
  })

  it('counts nothing when no provider list is wired yet', async () => {
    const store = new CredentialStore(memorySecrets(), unexpectedWarning)
    await store.setProviderCredential('openrouter', RECORD)
    expect(await store.hasProviderCredential()).toBe(false)
  })

  it('counts a stored provider record, but not an empty list', async () => {
    const empty = storeWithIds([])
    expect(await empty.hasProviderCredential()).toBe(false)
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets, unexpectedWarning, 'test store', () =>
      Promise.resolve(['openrouter', 'groq']),
    )
    expect(await store.hasProviderCredential()).toBe(false)
    await store.setProviderCredential('groq', { ...RECORD, origin: 'https://api.groq.com' })
    expect(await store.hasProviderCredential()).toBe(true)
  })

  it('counts a damaged record as a credential, not as absent', async () => {
    const secrets = memorySecrets()
    await secrets.store(providerSecretKey('openrouter'), 'damaged')
    const store = new CredentialStore(secrets, unexpectedWarning, 'test store', () =>
      Promise.resolve(['openrouter']),
    )
    expect(await store.hasProviderCredential()).toBe(true)
  })
})

describe('hasModelApiCredential', () => {
  it('is false with neither a key nor a provider secret', async () => {
    expect(await storeWithIds(['openrouter']).hasModelApiCredential()).toBe(false)
  })

  it('is true with only the Meta key', async () => {
    const store = storeWithIds([])
    await store.setApiKey(CURRENT_SHAPE_KEYS[0])
    expect(await store.hasModelApiCredential()).toBe(true)
  })

  it('is true with only a provider secret', async () => {
    const store = storeWithIds(['openrouter'])
    await store.setProviderCredential('openrouter', RECORD)
    expect(await store.hasModelApiCredential()).toBe(true)
  })

  it('is true with both', async () => {
    const store = storeWithIds(['openrouter'])
    await store.setApiKey(CURRENT_SHAPE_KEYS[0])
    await store.setProviderCredential('openrouter', RECORD)
    expect(await store.hasModelApiCredential()).toBe(true)
  })
})
