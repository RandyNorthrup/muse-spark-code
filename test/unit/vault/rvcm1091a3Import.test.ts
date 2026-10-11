// RVCM1091A3: generated home/outside fixtures; no real credential reads.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename, symlink, stat, link } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { prepareImportItems } from '../../../src/core/vault/migrate/prepareImport'
import { parseAmbientCredentials } from '../../../src/core/vault/migrate/ambientCredentials'
import { eraseVaultMaterial } from '../../../src/core/vault/crypto'
import { cleanupTempHomes, lockedVault, managementFixture, tempHome } from './managementFixture'

vi.mock('node:fs/promises', { spy: true })

afterEach(cleanupTempHomes)
afterEach(() => {
  vi.restoreAllMocks()
})

async function awsFixture() {
  const home = await tempHome()
  const outside = await tempHome()
  const folder = path.join(home, '.aws')
  await mkdir(folder)
  const body = `[generated-profile]\naws_access_key_id=${randomBytes(12).toString('hex')}\naws_secret_access_key=${randomBytes(16).toString('hex')}\n`
  await writeFile(path.join(folder, 'credentials'), body)
  // The leaf identity intentionally remains the same; only parent binding
  // can distinguish the redirected outside-home path.
  await link(path.join(folder, 'credentials'), path.join(outside, 'credentials'))
  const f = managementFixture(undefined, home)
  const code = await lockedVault(f)
  code.fill(0)
  await f.broker.unlock(null)
  return { f, home, outside, folder, file: path.join(folder, 'credentials') }
}

async function replaceWithLink(folder: string, outside: string): Promise<void> {
  await rename(folder, `${folder}-retained`)
  await symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('RVCM1091A3 import boundaries', () => {
  it('F2: a junction or symlink swapped after discovery imports nothing outside home', async () => {
    const { f, folder, outside, file } = await awsFixture()
    const { open: read } = await vi.importActual<typeof fs>('node:fs/promises')
    let isReplaced = false
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!isReplaced && args[0] === file) {
        isReplaced = true
        await replaceWithLink(folder, outside)
      }
      return await read(...args)
    })
    await expect(f.management.importFile(file, () => true)).rejects.toThrow()
    expect(isReplaced).toBe(true)
    expect(await f.repository.current().list()).toEqual([])
    const remaining = await stat(path.join(outside, 'credentials'))
    expect(remaining.isFile()).toBe(true)
  })

  it('F2: Delete refuses a redirected parent, including after source verification', async () => {
    const { f, folder, outside, file } = await awsFixture()
    const report = await f.management.importFile(file, () => true)
    const store = f.repository.current()
    const read = store.read.bind(store)
    let isReplaced = false
    vi.spyOn(store, 'read').mockImplementationOnce(async (id) => {
      const item = await read(id)
      await replaceWithLink(folder, outside)
      isReplaced = true
      return item
    })
    await expect(f.management.deleteImport(report.receipt, () => true)).rejects.toThrow()
    expect(isReplaced).toBe(true)
    const remaining = await stat(path.join(outside, 'credentials'))
    expect(remaining.isFile()).toBe(true)
  })

  it('F2: replacing an ancestor cannot redefine the already admitted home', async () => {
    const root = await tempHome()
    const parent = path.join(root, 'parent')
    const home = path.join(parent, 'home')
    const outside = await tempHome()
    await mkdir(home, { recursive: true })
    await mkdir(path.join(outside, 'home'))
    const file = path.join(home, '.netrc')
    const raw = 'machine example.test login generated-user password generated-password\n'
    await writeFile(file, raw)
    await writeFile(path.join(outside, 'home', '.netrc'), raw)
    const f = managementFixture(undefined, home)
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    // The first Keep retains the importer and its originally admitted home.
    const report = await f.management.importFile(file, () => true)
    await f.management.keepImport(report.receipt)
    await replaceWithLink(parent, outside)
    await expect(f.management.importFile(file, () => true)).rejects.toThrow()
    expect(await f.repository.current().list()).toHaveLength(1)
  })

  it('F9: AWS profile and field identity survive encrypted import and source Delete privately', async () => {
    const { f, file } = await awsFixture()
    const report = await f.management.importFile(file, () => true)
    expect(report.items).toHaveLength(2)
    await f.management.deleteImport(report.receipt, () => true)
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    const targets: string[] = []
    for (const metadata of report.items) {
      const stored = await f.repository.current().read(metadata.id)
      try {
        if ('importTarget' in stored.material && stored.material.importTarget !== undefined)
          targets.push(stored.material.importTarget)
      } finally {
        eraseVaultMaterial(stored.material)
      }
    }
    expect(targets.toSorted((left, right) => left.localeCompare(right))).toEqual([
      'generated-profile:aws_access_key_id',
      'generated-profile:aws_secret_access_key',
    ])
    expect(JSON.stringify(report)).not.toContain('generated-profile')
    expect(JSON.stringify(await f.management.snapshot())).not.toContain('generated-profile')
  })

  it.each([
    ['git', 'https://generated-user:generated-password@example.test\n'],
    ['netrc', 'machine example.test login generated-user password generated-password\n'],
    ['npm', '//example.test/:_authToken=generated-token\n'],
    ['docker', '{"auths":{"example.test":{"identitytoken":"generated-token"}}}'],
  ] as const)('F9: %s retains every private parser target without publishing it', (kind, raw) => {
    const bytes = Buffer.from(raw)
    const parsed = parseAmbientCredentials(kind, bytes)
    const prepared = prepareImportItems(kind, bytes, { now: 1, label: () => 'Generated import' })
    try {
      expect(
        prepared.map((item) =>
          'importTarget' in item.material ? item.material.importTarget : undefined,
        ),
      ).toEqual(parsed.map((item) => item.target))
      expect(prepared.every((item) => !('importTarget' in item.metadata))).toBe(true)
    } finally {
      bytes.fill(0)
      for (const item of [...parsed, ...prepared]) eraseVaultMaterial(item.material)
    }
  })
})
