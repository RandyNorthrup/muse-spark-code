import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discoverAmbientFiles,
  ambientKind,
  pathForHome,
} from '../../../src/core/vault/migrate/ambient'
import {
  VaultFileImporter,
  type VaultFileImportPort,
} from '../../../src/core/vault/migrate/importFile'
import { type VaultItem } from '../../../src/shared/vault'
import { metadata } from '../helpers/vault/fixtures'
import { migrationFixture } from './migrationFixture'
import { eraseItem } from '../../../src/core/vault/migrate/material'
import { VAULT_LIMITS } from '../../../src/shared/constants'

const roots: string[] = []
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})
async function root(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), 'm109-m-'))
  roots.push(created)
  return created
}
function fixture() {
  const f = migrationFixture()
  const vault: VaultFileImportPort = {
    list: () => f.vault.list(),
    read: f.deps.vault.read,
    writeBatch: vi.fn<VaultFileImportPort['writeBatch']>(async (items, authorize) => {
      authorize()
      for (const item of items) await f.vault.write(item)
    }),
  }
  let input: Uint8Array | undefined
  let prepared: VaultItem | undefined
  const prepare = vi.fn((_kind: string, bytes: Uint8Array) => {
    input = bytes
    const value = Buffer.alloc(bytes.byteLength)
    value.set(bytes)
    prepared = { metadata: metadata(), material: { kind: 'secret', value } }
    return Promise.resolve([prepared])
  })
  return {
    ...f,
    writer: vault,
    importer: new VaultFileImporter(vault, f.deps.owner),
    prepare,
    source: () => input,
    prepared: () => prepared,
  }
}

async function cancelledPreparation(cancel: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture()
  const path = nodePath.join(await root(), '.npmrc')
  await writeFile(path, randomBytes(32))
  await expect(
    f.importer.import(
      { path, kind: 'npm' },
      async (kind, bytes) => {
        const items = await f.prepare(kind, bytes)
        cancel(f)
        return items
      },
      () => undefined,
    ),
  ).rejects.toThrow()
  expect(f.writer.writeBatch).not.toHaveBeenCalled()
  expect(f.source()?.every((byte) => byte === 0)).toBe(true)
  return { f, path }
}

describe('D89.5 ambient discovery and explicit import', () => {
  it('never overwrites an existing item name or id on import', async () => {
    const f = fixture()
    const home = await root()
    const path = nodePath.join(home, '.npmrc')
    const original = randomBytes(32)
    await writeFile(path, original)
    const first = await f.importer.import({ path, kind: 'npm' }, f.prepare, () => undefined)
    const second = nodePath.join(home, '.netrc')
    await writeFile(second, randomBytes(32))
    await expect(
      f.importer.import({ path: second, kind: 'netrc' }, f.prepare, () => undefined),
    ).rejects.toThrow()
    const item = await f.vault.read(first.items[0]!.id)
    if (item.material.kind === 'secret') expect([...item.material.value]).toEqual([...original])
    eraseItem(item)
  })
  it('Dispose blocks a late import, and Keep cancels a pending Delete', async () => {
    const { path } = await cancelledPreparation((f) => {
      f.importer.dispose()
    })
    const other = fixture()
    const result = await other.importer.import(
      { path, kind: 'npm' },
      other.prepare,
      () => undefined,
    )
    const read = other.writer.read
    other.writer.read = vi.fn<VaultFileImportPort['read']>(async (id) => {
      const item = await read(id)
      other.importer.keep(result.receipt)
      return item
    })
    await expect(other.importer.deleteSource(result.receipt, () => undefined)).rejects.toThrow()
    expect(await readFile(path)).toHaveLength(32)
  })
  it('bounds the source before reading or preparing an empty or oversized file', async () => {
    const f = fixture()
    const path = nodePath.join(await root(), '.npmrc')
    for (const size of [0, VAULT_LIMITS.valueBytes + 1]) {
      await writeFile(path, Buffer.alloc(size))
      await expect(
        f.importer.import({ path, kind: 'npm' }, f.prepare, () => undefined),
      ).rejects.toThrow()
      expect(f.prepare).not.toHaveBeenCalled()
    }
  })
  it('lists only known plaintext names without parsing content; excludes public keys, links and other application stores', async () => {
    const home = await root()
    await mkdir(nodePath.join(home, '.ssh'))
    await mkdir(nodePath.join(home, '.aws'))
    for (const name of [
      '.ssh/id_ed25519',
      '.ssh/id_ed25519.pub',
      '.ssh/known_hosts',
      '.npmrc',
      '.aws/credentials',
      'auth.json',
    ])
      await writeFile(nodePath.join(home, name), randomBytes(32))
    await symlink(
      process.platform === 'win32' ? home : nodePath.join(home, 'auth.json'),
      nodePath.join(home, '.netrc'),
      process.platform === 'win32' ? 'junction' : 'file',
    )
    const found = await discoverAmbientFiles(home)
    expect(found).toEqual([
      { kind: 'npm', path: nodePath.join(home, '.npmrc') },
      { kind: 'aws', path: nodePath.join(home, '.aws/credentials') },
      { kind: 'ssh', path: nodePath.join(home, '.ssh/id_ed25519') },
    ])
    expect(ambientKind(String.raw`.ssh\id_ed25519`)).toBe('ssh')
    expect(ambientKind(String.raw`.aws\credentials`)).toBe('aws')
    expect(ambientKind(String.raw`.ssh\id_rsa.pub`)).toBeNull()
    expect(ambientKind('.ssh/../auth.json')).toBeNull()
    expect(pathForHome(String.raw`C:\Users\test`, '.aws/credentials')).toBe(
      String.raw`C:\Users\test\.aws\credentials`,
    )
    expect(() => pathForHome('relative', '.netrc')).toThrow()
  })
  it('does not traverse linked credential folders', async () => {
    const home = await root()
    const other = await root()
    await writeFile(nodePath.join(other, 'credentials'), randomBytes(32))
    await symlink(other, nodePath.join(home, '.aws'), 'junction')
    expect(await discoverAmbientFiles(home)).toEqual([])
  })
  it('requires Import before reading, verifies its copy, then Keep preserves the file and wipes owned bytes', async () => {
    const f = fixture()
    const path = nodePath.join(await root(), '.npmrc')
    const value = randomBytes(32)
    await writeFile(path, value)
    expect(f.prepare).not.toHaveBeenCalled()
    const authorize = vi.fn()
    const result = await f.importer.import({ path, kind: 'npm' }, f.prepare, authorize)
    expect(authorize).toHaveBeenCalled()
    expect(result.items).toEqual([metadata()])
    expect(JSON.stringify(result)).not.toContain(value.toString('hex'))
    expect(f.source()?.every((byte) => byte === 0)).toBe(true)
    expect(
      Object.values(f.prepared()!.material)
        .filter((field) => field instanceof Uint8Array)
        .every((field) => field.every((byte) => byte === 0)),
    ).toBe(true)
    expect(f.owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    f.importer.keep(result.receipt)
    expect(await readFile(path)).toEqual(value)
    await expect(f.importer.deleteSource(result.receipt, authorize)).rejects.toThrow()
  })
  it('Delete is a separate user action, tied to the verified source and still-present vault item', async () => {
    const f = fixture()
    const path = nodePath.join(await root(), '.netrc')
    await writeFile(path, randomBytes(32))
    const result = await f.importer.import({ path, kind: 'netrc' }, f.prepare, () => undefined)
    await expect(
      f.importer.deleteSource(result.receipt, () => {
        throw new Error('denied by test user')
      }),
    ).rejects.toThrow()
    expect(await readFile(path)).toHaveLength(32)
    await f.importer.deleteSource(result.receipt, () => undefined)
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(f.importer.deleteSource(result.receipt, () => undefined)).rejects.toThrow()
  })
  it('never deletes a changed/replaced source or a source whose vault copy was removed', async () => {
    for (const change of ['content', 'identity', 'vault']) {
      const f = fixture()
      const path = nodePath.join(await root(), '.npmrc')
      const value = randomBytes(32)
      await writeFile(path, value)
      const result = await f.importer.import({ path, kind: 'npm' }, f.prepare, () => undefined)
      if (change === 'content') await writeFile(path, randomBytes(32))
      else if (change === 'identity') {
        await writeFile(`${path}.new`, value)
        await rename(`${path}.new`, path)
      } else await f.vault.remove(metadata().id)
      await expect(f.importer.deleteSource(result.receipt, () => undefined)).rejects.toThrow()
      expect(await readFile(path)).toHaveLength(32)
    }
  })
  it('refuses a source changed while the vault copy is rechecked for Delete', async () => {
    const f = fixture()
    const path = nodePath.join(await root(), '.npmrc')
    await writeFile(path, randomBytes(32))
    const result = await f.importer.import({ path, kind: 'npm' }, f.prepare, () => undefined)
    const read = f.writer.read
    f.writer.read = vi.fn<VaultFileImportPort['read']>(async (id) => {
      const item = await read(id)
      await writeFile(path, randomBytes(100))
      return item
    })
    await expect(f.importer.deleteSource(result.receipt, () => undefined)).rejects.toThrow()
    expect(await readFile(path)).toHaveLength(100)
  })
  it('never grants Delete after a corrupted copy; rejects symlinks, duplicate items and denied Imports', async () => {
    const f = fixture()
    const home = await root()
    const path = nodePath.join(home, '.npmrc')
    await writeFile(path, randomBytes(32))
    f.writer.writeBatch = vi.fn<VaultFileImportPort['writeBatch']>(async (items, authorize) => {
      authorize()
      const item = structuredClone(items[0]!)
      if (item.material.kind === 'secret') item.material.value[0] = item.material.value[0]! ^ 1
      await f.vault.write(item)
      eraseItem(item)
    })
    await expect(
      f.importer.import({ path, kind: 'npm' }, f.prepare, () => undefined),
    ).rejects.toThrow()
    expect(await readFile(path)).toHaveLength(32)
    expect(f.source()?.every((byte) => byte === 0)).toBe(true)
    expect(f.owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    await symlink(
      process.platform === 'win32' ? home : path,
      nodePath.join(home, '.netrc'),
      process.platform === 'win32' ? 'junction' : 'file',
    )
    await expect(
      f.importer.import(
        { path: nodePath.join(home, '.netrc'), kind: 'netrc' },
        f.prepare,
        () => undefined,
      ),
    ).rejects.toThrow()
    const other = fixture()
    await expect(
      other.importer.import({ path, kind: 'npm' }, other.prepare, () => {
        throw new Error('deny')
      }),
    ).rejects.toThrow()
    expect(other.prepare).not.toHaveBeenCalled()
    await expect(
      other.importer.import(
        { path, kind: 'npm' },
        async (kind, bytes) => {
          const items = await other.prepare(kind, bytes)
          return [...items, ...items]
        },
        () => undefined,
      ),
    ).rejects.toThrow()
    expect(other.writer.writeBatch).not.toHaveBeenCalled()
  })
  it('revocation during prepare stops the physical write and disposal invalidates delete receipts', async () => {
    const { f, path } = await cancelledPreparation((current) => {
      current.invalidate()
    })
    const result = await f.importer.import({ path, kind: 'npm' }, f.prepare, () => undefined)
    f.importer.dispose()
    await expect(f.importer.deleteSource(result.receipt, () => undefined)).rejects.toThrow()
  })
})
