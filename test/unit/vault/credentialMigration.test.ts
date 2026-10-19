// The extension's key-store migration (D89.14 lane M) through its designed
// seams only: the real shell over a real persisted secret store, and the key
// list and codecs pure. Anything touching the vault lives in
// credentialMigrationStore.test.ts against a real VaultStore. Key values are
// generated at runtime (pattern-valid, never issued, never sent), so no
// secret-shaped literal sits in the tree.
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SECRET_KEYS, VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import {
  buildMigrationCredentials,
  listMigrationKeys,
} from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell } from '../../../src/host/vault/migrationShell'
import { closeSecrets, fileSecrets } from '../helpers/vault/migrationFixtures'

const now = () => 1_700_000_000_000
/** Pattern-valid Model API values, generated per run: never issued, never sent. */
const modelApiKey = () => `LLM_${randomBytes(12).toString('hex')}`
const dirs: string[] = []
afterEach(async () => {
  while (dirs.length > 0) await closeSecrets(dirs.pop()!)
})

describe('migration key list', () => {
  it('takes the model API key and every provider slot but chatgpt, without duplicates', () => {
    expect(listMigrationKeys(['openrouter', 'chatgpt', 'openrouter'])).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
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
})

describe('migration shell', () => {
  it('reads and writes SecretStorage straight through while unbound', async () => {
    const { store, dir } = await fileSecrets()
    dirs.push(dir)
    const key = modelApiKey()
    const shell = createMigrationShell(store)
    await shell.store.store(SECRET_KEYS.modelApiKey, key)
    expect(await shell.store.get(SECRET_KEYS.modelApiKey)).toBe(key)
    await shell.store.delete(SECRET_KEYS.modelApiKey)
    expect(await shell.store.get(SECRET_KEYS.modelApiKey)).toBe(undefined)
  })

  // Bound-mirror behaviour lives in credentialMigrationStore.test.ts, where
  // the shell binds the real migration controller over the real VaultStore:
  // a save made while the vault is locked is kept in SecretStorage and
  // mirrored on unlock. No hand-written mirror stands in for it here.
})
