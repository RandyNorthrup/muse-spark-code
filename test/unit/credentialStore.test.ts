import { describe, expect, it } from 'vitest'
import { CredentialStore, isValidModelApiKey } from '../../src/host/auth/credentialStore'
import { memorySecrets } from './helpers/fakes'

describe('isValidModelApiKey', () => {
  it.each(['LLM|1234567890|abcDEF_123', ' LLM|1|x '])('accepts %j', (key) => {
    expect(isValidModelApiKey(key)).toBe(true)
  })

  it.each(['', 'sk-abc', 'LLM|abc|secret', 'LLM|123|', 'LLM|123|has space'])(
    'rejects %j',
    (key) => {
      expect(isValidModelApiKey(key)).toBe(false)
    },
  )
})

describe('CredentialStore', () => {
  it('stores a trimmed valid key under the museSpark secret key', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets)
    await store.setApiKey('  LLM|42|secret  ')
    expect(secrets.values.get('museSpark.modelApiKey')).toBe('LLM|42|secret')
    await expect(store.getApiKey()).resolves.toBe('LLM|42|secret')
  })

  it('refuses to store something that is not a key', async () => {
    const secrets = memorySecrets()
    await expect(new CredentialStore(secrets).setApiKey('hunter2')).rejects.toThrow(
      'not a Meta Model API key',
    )
    expect(secrets.values.size).toBe(0)
  })

  it('reads an absent or empty key as undefined and clears it', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets)
    await expect(store.getApiKey()).resolves.toBeUndefined()
    secrets.values.set('museSpark.modelApiKey', '')
    await expect(store.getApiKey()).resolves.toBeUndefined()
    await store.setApiKey('LLM|1|x')
    await store.clearApiKey()
    await expect(store.getApiKey()).resolves.toBeUndefined()
  })
})
