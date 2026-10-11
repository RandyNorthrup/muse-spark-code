import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import { InMemoryVault } from '../helpers/vault/core'
import { modelApiMigrationCredential } from '../../../src/core/vault/migrate/modelApi'
import { VaultMigration } from '../../../src/core/vault/migrate/migrate'
import {
  type MigrationDeps,
  type MigrationRecord,
  type MigrationLease,
} from '../../../src/core/vault/migrate/ports'

export function generatedKey(): Buffer {
  return Buffer.from(`LLM_${randomBytes(32).toString('hex')}`)
}

export function migrationFixture() {
  const vault = new InMemoryVault()
  const credential = modelApiMigrationCredential(() => 1000)
  const legacy = new Map<string, Uint8Array>()
  const journal = new Map<string, MigrationRecord>()
  const owned: Uint8Array[] = []
  let queue = Promise.resolve()
  let generation = 0
  let release = 10
  const deps: MigrationDeps = {
    vault: {
      list: () => vault.list(),
      read: vi.fn<MigrationDeps['vault']['read']>(async (id) => {
        const item = await vault.read(id)
        for (const field of Object.values(item.material))
          if (field instanceof Uint8Array) owned.push(field)
        return item
      }),
      write: vi.fn<MigrationDeps['vault']['write']>(async (item, authorize) => {
        authorize()
        await vault.write(item)
      }),
      remove: vi.fn<MigrationDeps['vault']['remove']>(async (id, authorize) => {
        authorize()
        await vault.remove(id)
      }),
    },
    legacy: {
      read: vi.fn<MigrationDeps['legacy']['read']>((key) => {
        const value = legacy.get(key)
        const copy = value ? Uint8Array.from(value) : null
        if (copy) owned.push(copy)
        return Promise.resolve(copy)
      }),
      write: vi.fn<MigrationDeps['legacy']['write']>((key, value, authorize) => {
        authorize()
        legacy.set(key, Uint8Array.from(value))
        return Promise.resolve()
      }),
      remove: vi.fn<MigrationDeps['legacy']['remove']>((key, authorize) => {
        authorize()
        legacy.delete(key)
        return Promise.resolve()
      }),
    },
    journal: {
      sourceId: 'test-legacy-source',
      read: (key) => Promise.resolve(structuredClone(journal.get(key) ?? null)),
      write: vi.fn<MigrationDeps['journal']['write']>((row, authorize) => {
        authorize()
        journal.set(row.key, structuredClone(row))
        return Promise.resolve()
      }),
    },
    owner: {
      async run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T> {
        const previous = queue
        let releaseOwner!: () => void
        queue = new Promise<void>((resolve) => {
          releaseOwner = () => {
            resolve()
          }
        })
        await previous
        const tag = generation
        try {
          return await work({
            assertCurrent() {
              if (tag !== generation) throw new Error('stale test lease')
            },
          })
        } finally {
          releaseOwner()
        }
      },
    },
    minorRelease: () => release,
    onRetired: vi.fn(),
  }
  return {
    credential,
    deps,
    vault,
    legacy,
    journal,
    owned,
    service: new VaultMigration(deps, [credential]),
    advanceRelease: () => {
      release += 1
    },
    invalidate: () => {
      generation += 1
    },
  }
}
