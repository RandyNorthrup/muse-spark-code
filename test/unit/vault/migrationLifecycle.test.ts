import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VaultMigration } from '../../../src/core/vault/migrate/migrate'
import { modelApiMigrationCredential } from '../../../src/core/vault/migrate/modelApi'
import { type MigrationCredential } from '../../../src/core/vault/migrate/ports'
import { type VaultItem } from '../../../src/shared/vault'
import { eraseItem, itemDigest } from '../../../src/core/vault/migrate/material'
import { generatedKey, migrationFixture } from './migrationFixture'

describe('migration lifecycle across release/store owners', () => {
  it('the Meta codec refuses encoding a different origin or authentication scheme', () => {
    const f = migrationFixture()
    const item = f.credential.decode(generatedKey())
    if (item.material.kind === 'apiKey') item.material.origin = 'https://other.example'
    expect(() => f.credential.encode(item)).toThrow()
    if (item.material.kind === 'apiKey') {
      item.material.origin = 'https://api.meta.ai'
      item.material.auth = 'header'
    }
    expect(() => f.credential.encode(item)).toThrow()
    eraseItem(item)
  })
  it('shares an equal canonical Meta item across scoped source journals and refuses different source values', async () => {
    const first = migrationFixture()
    const second = migrationFixture()
    second.deps.vault = first.deps.vault
    second.deps.owner = first.deps.owner
    second.deps.journal = { ...second.deps.journal, sourceId: 'os-store-source' }
    const key = generatedKey()
    first.legacy.set(first.credential.key, key)
    second.legacy.set(second.credential.key, key)
    await first.service.migrate(first.credential.key)
    const protectedItem = await first.vault.read(first.credential.itemId)
    protectedItem.metadata.requirePresence = true
    await first.vault.write(protectedItem)
    eraseItem(protectedItem)
    await second.service.migrate(second.credential.key)
    expect(second.journal.get(second.credential.key)?.sourceId).toBe('os-store-source')
    const next = generatedKey()
    // Integration's serialized write coordinator calls every retained source adapter.
    await first.service.store(first.credential.key, next)
    await second.service.store(second.credential.key, next)
    expect([...first.legacy.get(first.credential.key)!]).toEqual([...next])
    expect([...second.legacy.get(second.credential.key)!]).toEqual([...next])
    second.deps.journal.read = () => Promise.resolve(first.journal.get(first.credential.key))
    await expect(second.service.resolve(second.credential.key)).rejects.toMatchObject({
      code: 'conflict',
    })
    const conflicting = migrationFixture()
    conflicting.deps.vault = first.deps.vault
    conflicting.deps.owner = first.deps.owner
    const different = generatedKey()
    conflicting.legacy.set(conflicting.credential.key, different)
    await expect(conflicting.service.migrate(conflicting.credential.key)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(conflicting.legacy.get(conflicting.credential.key)).toEqual(different)
  })
  it('preserves creation/last-use dates on rotation and ignores display/usage changes at retirement', async () => {
    const f = migrationFixture()
    let now = 1000
    const credential = modelApiMigrationCredential(() => now)
    const service = new VaultMigration(f.deps, [credential])
    f.legacy.set(credential.key, generatedKey())
    await service.migrate(credential.key)
    const used = await f.vault.read(credential.itemId)
    used.metadata.label = 'Reviewed label'
    used.metadata.dates.lastUsedAt = 1500
    await f.vault.write(used)
    eraseItem(used)
    now = 2000
    await service.store(credential.key, generatedKey())
    const rotated = await f.vault.read(credential.itemId)
    expect(rotated.metadata.dates).toMatchObject({
      createdAt: 1000,
      rotatedAt: 2000,
      lastUsedAt: 1500,
    })
    rotated.metadata.dates.lastUsedAt = 2500
    await f.vault.write(rotated)
    eraseItem(rotated)
    f.advanceRelease()
    f.advanceRelease()
    expect(await service.retire(credential.key)).toBe(true)
  })
  it('a new migration after Undo gets its own retention window', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    await f.service.undo(f.credential.key)
    f.advanceRelease()
    f.advanceRelease()
    await f.service.migrate(f.credential.key)
    expect(await f.service.retire(f.credential.key)).toBe(false)
    f.advanceRelease()
    f.advanceRelease()
    expect(await f.service.retire(f.credential.key)).toBe(true)
  })
  it.each(['apiKey', 'oauth', 'devicePair', 'internal'] as const)(
    'accepts an owner-supplied %s codec without guessing its installed serialization',
    async (kind) => {
      const f = migrationFixture()
      const materials = new Map<string, VaultItem['material']>()
      function material(value: Uint8Array): VaultItem['material'] {
        const bytes = Uint8Array.from(value)
        switch (kind) {
          case 'apiKey': {
            return { kind, value: bytes, auth: 'header', origin: 'https://provider.example' }
          }
          case 'oauth': {
            return {
              kind,
              accessToken: bytes,
              refreshToken: Uint8Array.from(randomBytes(32)),
              issuer: 'https://issuer.example/oauth',
              resource: 'https://provider.example/resource',
              expiresAt: 10_000,
            }
          }
          case 'devicePair':
          case 'internal': {
            return { kind, value: bytes }
          }
        }
      }
      // Test-only opaque serialization: real owners must supply their exact installed codecs.
      const codec: MigrationCredential = {
        key: `installed-${kind}`,
        itemId: f.credential.itemId,
        request: null,
        decode(value) {
          const item = f.credential.decode(generatedKey())
          eraseItem(item)
          item.metadata.kind = kind
          item.material = structuredClone(materials.get(Buffer.from(value).toString('hex'))!)
          return item
        },
        encode(item) {
          for (const [encoded, stored] of materials)
            if (itemDigest({ metadata: item.metadata, material: stored }) === itemDigest(item))
              return Buffer.from(encoded, 'hex')
          throw new Error('test codec: no mapping')
        },
      }
      const initial = randomBytes(32)
      const next = randomBytes(32)
      materials.set(initial.toString('hex'), material(initial))
      materials.set(next.toString('hex'), material(next))
      f.legacy.set(codec.key, initial)
      const service = new VaultMigration(f.deps, [codec])
      await service.migrate(codec.key)
      await service.store(codec.key, next)
      expect([...f.legacy.get(codec.key)!]).toEqual([...next])
      await service.undo(codec.key)
      expect([...f.legacy.get(codec.key)!]).toEqual([...next])
    },
  )
})
