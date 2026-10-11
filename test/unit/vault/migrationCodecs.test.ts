// C-M109-4: migration codecs for M95 credentialRecords and M108
// accountSecrets (PLAN.md D89.14, acceptance 17). Every drill runs on fakes:
// a Map-backed SecretStore stands in for SecretStorage, while both sides use
// the real installed code — the previous release's writers/readers
// (saveProviderCredential/readProviderCredential, secretStorageAccountVault,
// CredentialStore) and the migration adapter (migrateSecretStorage).
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryVault } from '../helpers/vault/core'
import { migrateSecretStorage } from '../../../src/host/vault/migrateSecretStorage'
import { CredentialStore, type SecretStore } from '../../../src/host/auth/credentialStore'
import {
  readProviderCredential,
  saveProviderCredential,
  type CredentialRecord,
} from '../../../src/host/providers/credentialRecords'
import { secretStorageAccountVault } from '../../../src/host/providers/accountSecrets'
import type { AccountCredential } from '../../../src/core/providers/accountCredentialRecord'
import { accountSecretMigrationCredential } from '../../../src/core/vault/migrate/accountSecrets'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'
import { modelApiMigrationCredential } from '../../../src/core/vault/migrate/modelApi'
import {
  type MigrationCredential,
  type MigrationDeps,
  type MigrationLease,
  type MigrationRecord,
} from '../../../src/core/vault/migrate/ports'
import { eraseItem } from '../../../src/core/vault/migrate/material'
import { vaultItemSchema, type VaultItem } from '../../../src/shared/vault'
import {
  ACCOUNT_DEFAULT_ID,
  MODEL_API_BASE_URL,
  SECRET_KEYS,
  VAULT_LEGACY_RETAIN_RELEASES,
} from '../../../src/shared/constants'

const META_ORIGIN = new URL(MODEL_API_BASE_URL).origin
const META_KEY = 'LLM_TestOnly00000000000000000000000000'

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function codecsFixture(credentials: readonly MigrationCredential[]) {
  const vault = new InMemoryVault()
  const entries = new Map<string, string>()
  const secrets: SecretStore = {
    get: (key) => Promise.resolve(entries.get(key)),
    store: (key, value) => {
      entries.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      entries.delete(key)
      return Promise.resolve()
    },
  }
  const journal = new Map<string, MigrationRecord>()
  let release = 10
  const onRetired = vi.fn()
  const deps: Omit<MigrationDeps, 'legacy'> = {
    vault: {
      list: () => vault.list(),
      read: (id) => vault.read(id),
      write: (item, authorize) => {
        authorize()
        return vault.write(item)
      },
      remove: (id, authorize) => {
        authorize()
        return vault.remove(id)
      },
    },
    journal: {
      sourceId: 'test-codec-source',
      read: (key) => Promise.resolve(structuredClone(journal.get(key) ?? null)),
      write: (row, authorize) => {
        authorize()
        journal.set(row.key, structuredClone(row))
        return Promise.resolve()
      },
    },
    owner: {
      run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T> {
        return work({ assertCurrent: () => undefined })
      },
    },
    minorRelease: () => release,
    onRetired,
  }
  return {
    vault,
    entries,
    secrets,
    journal,
    deps,
    onRetired,
    service: migrateSecretStorage(secrets, deps, credentials),
    advanceRelease: () => {
      release += 1
    },
  }
}

type CodecFixture = ReturnType<typeof codecsFixture> & { credential: MigrationCredential }

function providerFixture(provider = 'openai'): CodecFixture {
  const credential = providerCredentialMigrationCredential(provider, () => 1000)
  return { credential, ...codecsFixture([credential]) }
}

function accountFixture(provider = 'openai', account = 'work'): CodecFixture {
  const credential = accountSecretMigrationCredential(provider, account, () => 1000)
  return { credential, ...codecsFixture([credential]) }
}

/** Migrates the entry, then reads the vault item for assertions. Caller erases it. */
async function activeItem(f: CodecFixture): Promise<VaultItem> {
  expect(await f.service.migrate(f.credential.key)).toBe('active')
  return await f.vault.read(f.credential.itemId)
}

/** SHA-256 equality without leaving the copied bytes behind. */
function expectSameBytes(actual: Uint8Array, expected: Uint8Array | string): void {
  try {
    expect(sha256(actual)).toBe(sha256(expected))
  } finally {
    actual.fill(0)
  }
}

/** Damaged entries are refused without copying or deleting the source. */
async function expectRefused(make: () => CodecFixture, pairs: [string, string][]): Promise<void> {
  for (const [name, stored] of pairs) {
    const f = make()
    await f.secrets.store(f.credential.key, stored)
    await expect(f.service.migrate(f.credential.key), name).rejects.toMatchObject({
      code: 'invalid',
    })
    expect(await f.vault.list(), name).toEqual([])
    expect(f.entries.get(f.credential.key), name).toBe(stored)
  }
}

/** The retention window passes with no early retirement, then one delete. */
async function retireAfterWindow(f: CodecFixture): Promise<void> {
  for (let kept = 0; kept < VAULT_LEGACY_RETAIN_RELEASES; kept += 1) {
    expect(await f.service.retire(f.credential.key)).toBe(false)
    f.advanceRelease()
  }
  expect(await f.service.retire(f.credential.key)).toBe(true)
}

describe('C-M109-4 provider credential codecs', () => {
  it('migrates an apiKey record with equal SHA-256 and keeps the downgrade mirror', async () => {
    const f = providerFixture()
    const record: CredentialRecord = {
      v: 1,
      auth: 'apiKey',
      origin: 'https://api.openai.com',
      secret: 'synthetic-openai-key-first',
    }
    await saveProviderCredential(f.secrets, 'openai', record)
    const item = await activeItem(f)
    try {
      expect(vaultItemSchema.parse(item)).toBeDefined()
      expect(item.metadata).toMatchObject({
        name: 'provider-openai',
        kind: 'apiKey',
        firstParty: true,
        hidden: true,
        policy: { mode: 'never' },
        bindings: [{ kind: 'origin', origin: 'https://api.openai.com' }],
      })
      if (item.material.kind !== 'apiKey') throw new Error('expected an apiKey item')
      expect(item.material.origin).toBe('https://api.openai.com')
      // Migrated provider apiKey items pin their auth: never bearer/header.
      expect(item.material.auth).toBe('apiKey')
      expectSameBytes(f.credential.encode(item), Buffer.from(JSON.stringify(record), 'utf8'))
      // The previous release's reader still finds its key in the mirror.
      expect(await readProviderCredential(f.secrets, 'openai')).toEqual(record)
      expect(f.entries.has(f.credential.key)).toBe(true)
      expect(f.journal.get(f.credential.key)?.phase).toBe('active')
    } finally {
      eraseItem(item)
    }
  })

  it('downgrade drill: rotations mirror, undo restores, retire deletes with a value-free notice', async () => {
    const f = providerFixture()
    await saveProviderCredential(f.secrets, 'openai', {
      v: 1,
      auth: 'apiKey',
      origin: 'https://api.openai.com',
      secret: 'synthetic-openai-key-first',
    })
    await f.service.migrate(f.credential.key)
    const rotated: CredentialRecord = {
      v: 1,
      auth: 'apiKey',
      origin: 'https://api.openai.com',
      secret: 'synthetic-openai-key-second',
    }
    await f.service.store(f.credential.key, Buffer.from(JSON.stringify(rotated), 'utf8'))
    expect(await readProviderCredential(f.secrets, 'openai')).toEqual(rotated)
    await f.service.undo(f.credential.key)
    expect(f.journal.get(f.credential.key)?.phase).toBe('undone')
    expect(await readProviderCredential(f.secrets, 'openai')).toEqual(rotated)
    await f.service.migrate(f.credential.key)
    await retireAfterWindow(f)
    expect(f.entries.has(f.credential.key)).toBe(false)
    expect(f.onRetired).toHaveBeenCalledTimes(1)
    expect(f.onRetired).toHaveBeenCalledWith(f.credential.key)
    expect(JSON.stringify(f.onRetired.mock.calls)).not.toContain('synthetic-openai-key-second')
  })

  it('migrates an oauth record as an opaque secret item with a byte-equal round trip', async () => {
    const f = providerFixture('custom')
    const record: CredentialRecord = {
      v: 1,
      auth: 'oauth',
      origin: 'https://sso.example.com',
      secret: 'synthetic-oauth-blob',
    }
    await saveProviderCredential(f.secrets, 'custom', record)
    const item = await activeItem(f)
    try {
      expect(item.metadata.kind).toBe('secret')
      expect(item.metadata.bindings).toEqual([
        { kind: 'origin', origin: 'https://sso.example.com' },
      ])
      expectSameBytes(f.credential.encode(item), Buffer.from(JSON.stringify(record), 'utf8'))
      expect(await readProviderCredential(f.secrets, 'custom')).toEqual(record)
    } finally {
      eraseItem(item)
    }
  })

  it('refuses damaged entries without copying or deleting the source', async () => {
    const cases: [string, string][] = [
      ['not JSON', 'not-a-key'],
      [
        'wrong version',
        JSON.stringify({ v: 2, auth: 'apiKey', origin: 'https://api.openai.com', secret: 'x' }),
      ],
      [
        'empty secret',
        JSON.stringify({ v: 1, auth: 'apiKey', origin: 'https://api.openai.com', secret: '' }),
      ],
      ['bad origin', JSON.stringify({ v: 1, auth: 'apiKey', origin: 'not a url', secret: 'x' })],
      [
        'unknown auth',
        JSON.stringify({ v: 1, auth: 'bearer', origin: 'https://api.openai.com', secret: 'x' }),
      ],
      // M95b's subscription record is a different installed shape with its own
      // owner lane; the credential codec must not claim it.
      [
        'subscription record',
        JSON.stringify({
          v: 1,
          auth: 'subscription',
          origin: 'https://api.openai.com',
          issuer: 'https://auth.example.com',
          clientId: 'client',
          hostId: 'host',
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: 10_000,
          scope: 'openid',
          nonce: 'nonce',
        }),
      ],
    ]
    await expectRefused(providerFixture, cases)
    const f = providerFixture()
    await f.secrets.store(f.credential.key, 'not JSON at all')
    await expect(
      f.service.store(f.credential.key, Buffer.from('also not JSON', 'utf8')),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('refuses a codec output that exposes the item or binds a different origin', () => {
    const f = providerFixture()
    const item = f.credential.decode(
      Buffer.from(
        JSON.stringify({
          v: 1,
          auth: 'apiKey',
          origin: 'https://api.openai.com',
          secret: 'synthetic-provider-key',
        }),
        'utf8',
      ),
    )
    try {
      expect(() =>
        f.credential.encode({ ...item, metadata: { ...item.metadata, id: '0'.repeat(32) } }),
      ).toThrow()
      if (item.material.kind === 'apiKey') {
        const bearer = { ...item, material: { ...item.material, auth: 'bearer' as const } }
        expect(() => f.credential.encode(bearer)).toThrow()
        const rebound = {
          ...item,
          material: { ...item.material, origin: 'https://evil.example.com' },
        }
        expect(() => f.credential.encode(rebound)).toThrow()
      }
    } finally {
      eraseItem(item)
    }
  })
})

describe('C-M109-4 account secret codecs', () => {
  it('migrates an account apiKey with equal SHA-256; the previous vault reads rotations', async () => {
    const f = accountFixture()
    const binding = { provider: 'openai', account: 'work', origin: 'https://api.openai.com' }
    const previous = secretStorageAccountVault(f.secrets)
    const first: AccountCredential = {
      ...binding,
      v: 1,
      auth: 'apiKey',
      secret: 'synthetic-account-key-first',
    }
    await previous.write(binding, first)
    const stored = f.entries.get(f.credential.key)
    expect(stored).toBeDefined()
    const item = await activeItem(f)
    try {
      expect(vaultItemSchema.parse(item)).toBeDefined()
      expect(item.metadata).toMatchObject({
        name: 'account-openai-work',
        kind: 'apiKey',
        firstParty: true,
        hidden: true,
        policy: { mode: 'never' },
      })
      expectSameBytes(f.credential.encode(item), stored!)
    } finally {
      eraseItem(item)
    }
    await f.service.store(
      f.credential.key,
      Buffer.from(
        JSON.stringify({
          provider: 'openai',
          account: 'work',
          origin: 'https://api.openai.com',
          v: 1,
          auth: 'apiKey',
          secret: 'synthetic-account-key-second',
        }),
        'utf8',
      ),
    )
    expect(await previous.read(binding)).toMatchObject({ secret: 'synthetic-account-key-second' })
    await f.service.undo(f.credential.key)
    expect(await previous.read(binding)).toMatchObject({ secret: 'synthetic-account-key-second' })
    expect(f.journal.get(f.credential.key)?.phase).toBe('undone')
  })

  it('migrates the legacy default shape with equal SHA-256 and byte-exact undo', async () => {
    // A non-meta default account shares the provider slot: the account
    // factory returns the provider codec, so one key names one item and the
    // short record round-trips byte-exact instead of gaining identity fields.
    const f = accountFixture('openai', ACCOUNT_DEFAULT_ID)
    expect(f.credential.key).toBe('museSpark.provider.openai')
    const binding = {
      provider: 'openai',
      account: ACCOUNT_DEFAULT_ID,
      origin: 'https://api.openai.com',
    }
    const installed = JSON.stringify({
      v: 1,
      auth: 'apiKey',
      origin: 'https://api.openai.com',
      secret: 'synthetic-legacy-default-key',
    })
    await f.secrets.store(f.credential.key, installed)
    const item = await activeItem(f)
    try {
      expect(item.metadata.kind).toBe('apiKey')
      expect(item.metadata.name).toBe('provider-openai')
      expectSameBytes(f.credential.encode(item), installed)
    } finally {
      eraseItem(item)
    }
    const previous = secretStorageAccountVault(f.secrets)
    expect(await previous.read(binding)).toMatchObject({
      provider: 'openai',
      account: ACCOUNT_DEFAULT_ID,
      secret: 'synthetic-legacy-default-key',
    })
    // Undo writes the installed bytes back, not a longer canonical document.
    await f.service.undo(f.credential.key)
    expect(f.entries.get(f.credential.key)).toBe(installed)
    expect(await readProviderCredential(f.secrets, 'openai')).toMatchObject({
      secret: 'synthetic-legacy-default-key',
    })
  })

  it('names one item for a shared provider slot from either factory', () => {
    // RVCM1094 finding 3: the provider codec and the non-meta default-account
    // codec owned one SecretStorage key and built different items, so
    // registering both threw `conflict` before any copy. Both factories now
    // name the same item, and the wiring registers each key once.
    const fromAccount = accountSecretMigrationCredential('openai', ACCOUNT_DEFAULT_ID, () => 1000)
    const fromProvider = providerCredentialMigrationCredential('openai', () => 1000)
    expect(fromAccount.key).toBe(fromProvider.key)
    expect(fromAccount.itemId).toBe(fromProvider.itemId)
    const stored = Buffer.from(
      JSON.stringify({
        v: 1,
        auth: 'apiKey',
        origin: 'https://api.openai.com',
        secret: 'synthetic-shared-key',
      }),
      'utf8',
    )
    const left = fromAccount.decode(stored)
    const right = fromProvider.decode(Buffer.from(stored))
    try {
      expect(left.metadata.name).toBe('provider-openai')
      expect(right.metadata.name).toBe(left.metadata.name)
    } finally {
      eraseItem(left)
      eraseItem(right)
    }
  })

  it('migrates a longest account name inside the vault handle', async () => {
    // RVCM1094 finding 1: `account-<provider>-<account>` can pass 48
    // characters, and the vault handle then refused a valid account. Long
    // names hash deterministically; short names stay readable.
    const provider = 'p'.repeat(32)
    const account = 'a'.repeat(32)
    const f = accountFixture(provider, account)
    const binding = { provider, account, origin: 'https://api.openai.com' }
    const previous = secretStorageAccountVault(f.secrets)
    await previous.write(binding, {
      ...binding,
      v: 1,
      auth: 'apiKey',
      secret: 'synthetic-long-key',
    })
    const stored = f.entries.get(f.credential.key)
    expect(stored).toBeDefined()
    const item = await activeItem(f)
    try {
      expect(item.metadata.name.length).toBeLessThanOrEqual(48)
      expect(item.metadata.name).toMatch(/^[a-z][a-z0-9-]{0,47}$/)
      expect(item.metadata.handle).toBe(`secret://${item.metadata.name}`)
      const again = f.credential.decode(Buffer.from(stored!, 'utf8'))
      try {
        expect(again.metadata.name).toBe(item.metadata.name)
      } finally {
        eraseItem(again)
      }
      expectSameBytes(f.credential.encode(item), stored!)
    } finally {
      eraseItem(item)
    }
  })

  it('migrates an overlaid full account record at the provider slot verbatim', async () => {
    // RVCM1094 finding 3 (class): a full default-account record overlaid at
    // the bare provider slot must migrate exactly, not strand and not lose
    // its identity into a rebuilt short document. Both previous readers still
    // parse the mirror.
    const f = providerFixture()
    const installed = JSON.stringify({
      provider: 'openai',
      account: ACCOUNT_DEFAULT_ID,
      origin: 'https://api.openai.com',
      v: 1,
      auth: 'apiKey',
      secret: 'synthetic-overlaid-key',
    })
    await f.secrets.store(f.credential.key, installed)
    const item = await activeItem(f)
    try {
      expect(item.metadata.kind).toBe('secret')
      expect(item.metadata.name).toBe('provider-openai')
      expectSameBytes(f.credential.encode(item), installed)
    } finally {
      eraseItem(item)
    }
    expect(await readProviderCredential(f.secrets, 'openai')).toMatchObject({
      secret: 'synthetic-overlaid-key',
    })
    const previous = secretStorageAccountVault(f.secrets)
    expect(
      await previous.read({
        provider: 'openai',
        account: ACCOUNT_DEFAULT_ID,
        origin: 'https://api.openai.com',
      }),
    ).toMatchObject({ secret: 'synthetic-overlaid-key' })
  })

  it('refuses records with unknown fields without copying or deleting', async () => {
    // Class of findings 2 and 3: anything the installed writers cannot have
    // written is refused rather than migrated with fields silently dropped.
    await expectRefused(providerFixture, [
      [
        'short record with an extra field',
        JSON.stringify({
          v: 1,
          auth: 'apiKey',
          origin: 'https://api.openai.com',
          secret: 'x',
          nickname: 'work',
        }),
      ],
      [
        'full record with an extra field',
        JSON.stringify({
          provider: 'openai',
          account: ACCOUNT_DEFAULT_ID,
          origin: 'https://api.openai.com',
          v: 1,
          auth: 'apiKey',
          secret: 'x',
          nickname: 'work',
        }),
      ],
    ])
  })

  it('refuses the ChatGPT subscription shape here; its codec belongs to its owner lane', async () => {
    // The M95b ChatGPT record lives at `museSpark.provider.chatgpt` with its
    // own shape (`chatGptRecordSchema`) and owner lane: this factory refuses
    // the key eagerly so it can never collide with that codec, and the
    // provider codec refuses the bytes wherever they land.
    for (const factory of [
      () => providerCredentialMigrationCredential('chatgpt', () => 1000),
      () => accountSecretMigrationCredential('chatgpt', ACCOUNT_DEFAULT_ID, () => 1000),
    ]) {
      try {
        factory()
        expect.unreachable('the ChatGPT slot must be refused here')
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid' })
      }
    }
    await expectRefused(providerFixture, [
      [
        'ChatGPT subscription record',
        JSON.stringify({
          v: 1,
          auth: 'subscription',
          origin: 'https://api.openai.com',
          issuer: 'https://auth.openai.com',
          clientId: 'synthetic-client',
          hostId: 'synthetic-host',
          accessToken: 'synthetic-access',
          refreshToken: 'synthetic-refresh',
          expiresAt: 10_000,
          scope: 'openid profile email offline_access',
          nonce: 'synthetic-nonce',
        }),
      ],
    ])
  })

  it('migrates an oauth account opaquely and refuses a cross-account copy', async () => {
    const f = accountFixture()
    await f.secrets.store(
      f.credential.key,
      JSON.stringify({
        provider: 'openai',
        account: 'work',
        origin: 'https://api.openai.com',
        v: 1,
        auth: 'oauth',
        secret: 'synthetic-oauth-blob',
      }),
    )
    const item = await activeItem(f)
    try {
      expect(item.metadata.kind).toBe('secret')
      const copied = f.credential.encode(item)
      try {
        expect(JSON.parse(Buffer.from(copied).toString('utf8'))).toMatchObject({
          auth: 'oauth',
          secret: 'synthetic-oauth-blob',
        })
      } finally {
        copied.fill(0)
      }
    } finally {
      eraseItem(item)
    }
    const other = accountFixture('openai', 'personal')
    other.entries.set(
      other.credential.key,
      JSON.stringify({
        provider: 'openai',
        account: 'work',
        origin: 'https://api.openai.com',
        v: 1,
        auth: 'apiKey',
        secret: 'synthetic-other-account-key',
      }),
    )
    await expect(other.service.migrate(other.credential.key)).rejects.toMatchObject({
      code: 'invalid',
    })
    expect(await other.vault.list()).toEqual([])
  })

  it("Meta's default account reuses the modelApi entry and the previous key reader", async () => {
    const codec = accountSecretMigrationCredential('meta', ACCOUNT_DEFAULT_ID, () => 1000)
    const modelApi = modelApiMigrationCredential(() => 1000)
    expect(codec.key).toBe(SECRET_KEYS.modelApiKey)
    expect(codec.key).toBe(modelApi.key)
    expect(codec.itemId).toBe(modelApi.itemId)
    const f = codecsFixture([codec])
    await f.secrets.store(SECRET_KEYS.modelApiKey, META_KEY)
    expect(await f.service.migrate(SECRET_KEYS.modelApiKey)).toBe('active')
    const item = await f.vault.read(codec.itemId)
    try {
      expect(item.metadata.bindings).toEqual([{ kind: 'origin', origin: META_ORIGIN }])
    } finally {
      eraseItem(item)
    }
    const previous = new CredentialStore(f.secrets, () => {
      throw new Error('no warnings on the downgrade path')
    })
    expect(await previous.getApiKey()).toBe(META_KEY)
    const rotated = 'LLM_TestOnly11111111111111111111111111'
    await f.service.store(SECRET_KEYS.modelApiKey, Buffer.from(rotated, 'utf8'))
    expect(await previous.getApiKey()).toBe(rotated)
  })

  it('refuses damaged account entries without copying or deleting', async () => {
    const cases: [string, string][] = [
      ['not JSON', 'plain-key-without-shape'],
      [
        'missing identity',
        JSON.stringify({ v: 1, auth: 'apiKey', origin: 'https://api.openai.com', secret: 'x' }),
      ],
      [
        'empty secret',
        JSON.stringify({
          provider: 'openai',
          account: 'work',
          origin: 'https://api.openai.com',
          v: 1,
          auth: 'apiKey',
          secret: '',
        }),
      ],
      [
        'bad origin',
        JSON.stringify({
          provider: 'openai',
          account: 'work',
          origin: 'https://api.openai.com/other',
          v: 1,
          auth: 'apiKey',
          secret: 'x',
        }),
      ],
    ]
    await expectRefused(() => accountFixture(), cases)
  })
})

describe('C-M109-4 changelog structure', () => {
  it('keeps the migration note after the RVCM1091A2 repairs', async () => {
    // RVCM1094 finding 4: the migration bullet once sat between the A2
    // heading and two of its fixes, so they read as codec behaviour.
    const changelog = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')
    const migration = changelog.indexOf('Migration codecs for provider credentials')
    const lock = changelog.indexOf('A Lock during setup confirmation')
    const cancelled = changelog.indexOf('A headless run cancelled')
    expect(migration).toBeGreaterThan(-1)
    expect(lock).toBeGreaterThan(-1)
    expect(cancelled).toBeGreaterThan(-1)
    expect(migration).toBeGreaterThan(lock)
    expect(migration).toBeGreaterThan(cancelled)
  })
})
