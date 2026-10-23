// Pure installed-record selection plus the real shell over a uniquely
// named native store. No file or Map implementation substitutes for it.
import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SECRET_KEYS, VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import {
  buildMigrationCredentials,
  listMigrationKeys,
} from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell } from '../../../src/host/vault/migrationShell'
import { keyringSecretStore } from '../../../src/runtime/keyStore'

const now = () => 1_700_000_000_000
/** Pattern-valid Model API values, generated per run: never issued, never sent. */
const modelApiKey = () => `LLM_${randomBytes(12).toString('hex')}`

describe('migration key list', () => {
  it('takes the model API key and every provider slot including chatgpt, without duplicates', () => {
    expect(listMigrationKeys(['openrouter', 'chatgpt', 'openrouter'])).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
      'museSpark.provider.chatgpt',
    ])
  })

  it('leaves the grok subscription slot with its own lane', () => {
    expect(listMigrationKeys(['openrouter', 'grok'])).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
    ])
    expect(buildMigrationCredentials(['grok'], now).map((entry) => entry.key)).toEqual([
      SECRET_KEYS.modelApiKey,
    ])
  })

  it('builds one codec per key with matching item ids', () => {
    const credentials = buildMigrationCredentials(['openrouter'], now)
    expect(credentials.map((entry) => entry.key)).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
    ])
    const [modelApi] = credentials
    expect(modelApi?.request).toMatchObject({
      v: VAULT_PROTOCOL_VERSION,
      kind: 'firstPartyRead',
      origin: 'https://api.meta.ai',
    })
    expect(modelApi?.decode(Buffer.from(modelApiKey(), 'utf8')).material.kind).toBe('apiKey')
  })

  it('lists pooled account slots after provider slots, skipping defaults', () => {
    expect(
      listMigrationKeys(['openrouter'], new Map([['openrouter', ['default', 'work']]])),
    ).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
      'museSpark.provider.openrouter.account.work',
    ])
  })

  it('builds account codecs for pooled slots', () => {
    const credentials = buildMigrationCredentials(
      ['openrouter'],
      now,
      new Map([['openrouter', ['work']]]),
    )
    expect(credentials.map((entry) => entry.key)).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
      'museSpark.provider.openrouter.account.work',
    ])
  })

  it('gives chatgpt the subscription codec, never the provider record codec', () => {
    const credentials = buildMigrationCredentials(['chatgpt'], now)
    expect(credentials.map((entry) => entry.key)).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.chatgpt',
    ])
    const [, chatgpt] = credentials
    expect(chatgpt?.request).toBeNull()
    // A bare 4-key provider record is not a subscription: refused, never adopted.
    expect(() =>
      chatgpt?.decode(
        Buffer.from(
          JSON.stringify({ v: 1, auth: 'apiKey', origin: 'https://x.test', secret: 's' }),
          'utf8',
        ),
      ),
    ).toThrow()
  })
})

describe.skipIf(process.platform !== 'win32')('migration shell', () => {
  it('reads and writes SecretStorage straight through while unbound', async () => {
    const identity = randomBytes(16).toString('hex')
    const store = keyringSecretStore(
      (_service, account) => new AsyncEntry(`Muse RLM109 ${identity}`, account),
      { lockScope: identity },
    )
    const key = modelApiKey()
    const shell = createMigrationShell(store)
    try {
      await shell.store.store(SECRET_KEYS.modelApiKey, key)
      expect((await shell.store.get(SECRET_KEYS.modelApiKey)) === key).toBe(true)
      await shell.store.delete(SECRET_KEYS.modelApiKey)
      expect((await shell.store.get(SECRET_KEYS.modelApiKey)) === undefined).toBe(true)
    } finally {
      await store.delete(SECRET_KEYS.modelApiKey)
    }
  })

  // Bound-mirror behaviour lives in credentialMigrationStore.test.ts, where
  // the shell binds the real migration controller over the real Windows broker:
  // a save made while the vault is locked is kept in SecretStorage and
  // mirrored on unlock. No hand-written mirror stands in for it here.
})
