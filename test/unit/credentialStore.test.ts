import { describe, expect, it } from 'vitest'
import { CredentialStore, isValidModelApiKey } from '../../src/host/auth/credentialStore'
import { SECRET_KEYS } from '../../src/shared/constants'
import { memorySecrets, unexpectedWarning } from './helpers/fakes'
import { CURRENT_SHAPE_KEYS, OLDER_SHAPE_KEYS } from './helpers/modelApiKeys'

describe('isValidModelApiKey', () => {
  it.each([
    ...CURRENT_SHAPE_KEYS,
    ...OLDER_SHAPE_KEYS,
    ` ${CURRENT_SHAPE_KEYS[0]} `,
    ` ${OLDER_SHAPE_KEYS[1]} `,
  ])('accepts %j', (key) => {
    expect(isValidModelApiKey(key)).toBe(true)
  })

  it.each([
    '',
    'sk-abc',
    'LLM|abc|secret',
    'LLM|123|',
    'LLM|123|has space',
    'LLM_',
    'LLM_TooShort0000',
    'LLM_TestOnly 0000000000000000',
    'LLM_TestOnly$0000000000000000',
    'LLM-TestOnly0000000000000000',
    'llm_TestOnly0000000000000000',
  ])('rejects %j', (key) => {
    expect(isValidModelApiKey(key)).toBe(false)
  })
})

describe('CredentialStore', () => {
  it('stores a trimmed valid key under the museSpark secret key', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets, unexpectedWarning)
    await store.setApiKey('  LLM|42|secret  ')
    expect(secrets.values.get('museSpark.modelApiKey')).toBe('LLM|42|secret')
    await expect(store.getApiKey()).resolves.toBe('LLM|42|secret')
  })

  it('stores a key in Meta’s current shape', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets, unexpectedWarning)
    await store.setApiKey(`\n${CURRENT_SHAPE_KEYS[0]}\n`)
    await expect(store.getApiKey()).resolves.toBe(CURRENT_SHAPE_KEYS[0])
  })

  it('refuses to store something that is not a key', async () => {
    const secrets = memorySecrets()
    await expect(
      new CredentialStore(secrets, unexpectedWarning).setApiKey('hunter2'),
    ).rejects.toThrow('not a Meta Model API key')
    expect(secrets.values.size).toBe(0)
  })

  it('reads an absent or empty key as undefined and clears it', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(secrets, unexpectedWarning)
    await expect(store.getApiKey()).resolves.toBeUndefined()
    secrets.values.set('museSpark.modelApiKey', '')
    await expect(store.getApiKey()).resolves.toBeUndefined()
    await store.setApiKey('LLM|1|x')
    await store.clearApiKey()
    await expect(store.getApiKey()).resolves.toBeUndefined()
  })

  it('reads an unreadable secret store as no key and says so once (D25)', async () => {
    const warnings: string[] = []
    const store = new CredentialStore(
      {
        get: () => Promise.reject(new Error('no keyring')),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      (message) => {
        warnings.push(message)
      },
    )
    await expect(store.getApiKey()).resolves.toBeUndefined()
    await expect(store.getApiKey()).resolves.toBeUndefined()
    expect(warnings).toHaveLength(1)
    // The log carries only the failure's kind, never the raw error: the
    // message can name a keyring path (P3-5).
    expect(warnings[0]).toContain('(Error)')
    expect(warnings[0]).not.toContain('no keyring')
    expect(warnings[0]).toMatch(/^VS Code's secret storage could not be read/)
    // The ACP agent names its own store (PLAN.md D61).
    const agentWarnings: string[] = []
    const agentStore = new CredentialStore(
      {
        get: () => Promise.reject(new Error('locked')),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      (message) => {
        agentWarnings.push(message)
      },
      "the operating system's credential store",
    )
    await agentStore.getApiKey()
    expect(agentWarnings[0]).toMatch(/^the operating system's credential store could not be read/)
  })

  it('reads an unreadable provider entry as unknown, never as absent (P2-1)', async () => {
    const warnings: string[] = []
    const message = 'locked: /home/someone/.local/share/keyrings/login.keyring'
    const store = new CredentialStore(
      {
        get: (key: string) =>
          key === SECRET_KEYS.modelApiKey
            ? Promise.resolve(undefined)
            : Promise.reject(new Error(message)),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      (line) => {
        warnings.push(line)
      },
      "VS Code's secret storage",
      () => Promise.resolve(['meta']),
    )
    // The boolean is gone: could-not-read is its own state, so no guard can
    // mistake it for "no credential".
    await expect(store.readModelApiCredential()).resolves.toEqual({
      outcome: 'unreadable',
      kind: 'other',
    })
    await expect(store.readModelApiCredential()).resolves.toEqual({
      outcome: 'unreadable',
      kind: 'other',
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('(Error)')
    expect(warnings[0]).not.toContain('keyring')
  })

  it('reads an unreadable Meta key as unknown with its kind', async () => {
    const store = new CredentialStore(
      {
        get: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      () => undefined,
      "VS Code's secret storage",
      () => Promise.resolve([]),
    )
    await expect(store.readModelApiCredential()).resolves.toEqual({
      outcome: 'unreadable',
      kind: 'denied',
    })
  })

  it('reads no key and no provider secrets as absent', async () => {
    const store = new CredentialStore(
      memorySecrets(),
      unexpectedWarning,
      "VS Code's secret storage",
      () => Promise.resolve([]),
    )
    await expect(store.readModelApiCredential()).resolves.toEqual({ outcome: 'absent' })
  })

  it('reads a stored Meta key as found without listing providers', async () => {
    const secrets = memorySecrets()
    const store = new CredentialStore(
      secrets,
      unexpectedWarning,
      "VS Code's secret storage",
      () => {
        throw new Error('must not list providers once the key is found')
      },
    )
    await store.setApiKey('LLM|1|x')
    await expect(store.readModelApiCredential()).resolves.toEqual({ outcome: 'found' })
  })

  it.each([
    ['broken', 'openrouter'],
    ['openrouter', 'broken'],
  ])('finds a working provider past an unreadable entry: %j', async (...ids: string[]) => {
    const warnings: string[] = []
    const store = new CredentialStore(
      {
        get: (key: string) =>
          key === 'museSpark.provider.broken'
            ? Promise.reject(new Error('locked'))
            : Promise.resolve(key === 'museSpark.provider.openrouter' ? '{"v":1}' : undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      (line) => {
        warnings.push(line)
      },
      "VS Code's secret storage",
      () => Promise.resolve(ids),
    )
    await expect(store.readModelApiCredential()).resolves.toEqual({ outcome: 'found' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('broken')
    expect(warnings[0]).toContain('(Error)')
    expect(warnings[0]).not.toContain('locked')
  })

  it('lets a non-error provider read failure keep its kind', async () => {
    const foreign: unknown = 'a string failure'
    const store = new CredentialStore(
      {
        get: () => {
          throw foreign
        },
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      unexpectedWarning,
      "VS Code's secret storage",
      () => Promise.resolve(['meta']),
    )
    await expect(store.readModelApiCredential()).rejects.toBe('a string failure')
  })
})
