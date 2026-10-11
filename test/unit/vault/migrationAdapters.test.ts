import { describe, expect, it, vi } from 'vitest'
import { KEYRING_SERVICE } from '../../../src/shared/constants'
import { migrateSecretStorage } from '../../../src/host/vault/migrateSecretStorage'
import { migrateKeyStore } from '../../../src/runtime/vault/migrateKeyStore'
import { BrokerSecretStore } from '../../../src/host/vault/brokerClient'
import { CredentialStore, type SecretStore } from '../../../src/host/auth/credentialStore'
import { generatedKey, migrationFixture } from './migrationFixture'

describe('installed credential-store migration adapters', () => {
  it('the actual previous-release CredentialStore still reads rotations from SecretStorage', async () => {
    const f = migrationFixture()
    const entries = new Map([[f.credential.key, generatedKey().toString()]])
    const secrets: SecretStore = {
      get: vi.fn<SecretStore['get']>((key) => Promise.resolve(entries.get(key))),
      store: vi.fn<SecretStore['store']>((key, value) => {
        entries.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn<SecretStore['delete']>((key) => {
        entries.delete(key)
        return Promise.resolve()
      }),
    }
    const migration = migrateSecretStorage(secrets, f.deps, [f.credential])
    await migration.migrate(f.credential.key)
    const previous = new CredentialStore(secrets, vi.fn())
    const original = entries.get(f.credential.key)
    expect(await previous.getApiKey()).toBe(original)
    const reader = {
      read: vi.fn(async () => {
        const item = await f.vault.read(f.credential.itemId)
        const bytes = f.credential.encode(item)
        const result = Buffer.alloc(bytes.byteLength)
        result.set(bytes)
        bytes.fill(0)
        for (const field of Object.values(item.material))
          if (field instanceof Uint8Array) field.fill(0)
        return result
      }),
    }
    const current = new CredentialStore(new BrokerSecretStore(reader, migration), vi.fn())
    const rotated = generatedKey().toString()
    await current.setApiKey(rotated)
    expect(await current.getApiKey()).toBe(rotated)
    expect(await previous.getApiKey()).toBe(rotated)
    await migration.undo(f.credential.key)
    expect(await previous.getApiKey()).toBe(rotated)
    expect(await migration.resolve(f.credential.key)).toBeNull()
    expect(secrets.get).not.toHaveBeenCalledWith('auth.json')
  })
  it('OS store migration keeps the original service/account and no child process is involved', async () => {
    const f = migrationFixture()
    let password: string | undefined = generatedKey().toString()
    const openEntry = vi.fn(() => ({
      getPassword: () => Promise.resolve(password ?? null),
      setPassword: (value: string) => {
        password = value
        return Promise.resolve()
      },
      deletePassword: () => {
        password = undefined
        return Promise.resolve(true)
      },
    }))
    const migration = migrateKeyStore(openEntry, f.deps, [f.credential])
    await migration.migrate(f.credential.key)
    const rotated = generatedKey()
    await migration.store(f.credential.key, rotated)
    expect(password).toBe(rotated.toString())
    expect(openEntry).toHaveBeenCalledWith(KEYRING_SERVICE, f.credential.key)
    await migration.delete(f.credential.key)
    expect(password).toBeUndefined()
  })
  it('refuses invalid Meta shapes without copying or removing the old entry', async () => {
    const f = migrationFixture()
    const secrets = {
      get: () => Promise.resolve('not-a-key'),
      store: vi.fn<SecretStore['store']>(() => Promise.resolve()),
      delete: vi.fn<SecretStore['delete']>(() => Promise.resolve()),
    }
    const migration = migrateSecretStorage(secrets, f.deps, [f.credential])
    await expect(migration.migrate(f.credential.key)).rejects.toMatchObject({ code: 'invalid' })
    expect(await f.vault.list()).toEqual([])
    expect(secrets.delete).not.toHaveBeenCalled()
  })
})
