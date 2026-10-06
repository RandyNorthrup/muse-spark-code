import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { fileIdentityKey, lstatIdentity } from '../../src/core/fs/fileIdentity'
import {
  compileCreatedVariant,
  nativeCreated,
  nativeScratch,
  useCreatedNative,
} from './helpers/createdNative'
import { RESOURCE_TEMP_MARKER } from '../../src/shared/constants'

useCreatedNative()

const state: {
  device?: (args: readonly string[]) => Promise<string>
  mount?: (args: readonly string[]) => Promise<string>
  race?: (args: readonly string[]) => Promise<string>
} = {}
beforeAll(async () => {
  if (process.platform === 'win32') return
  state.race = await compileCreatedVariant('test/unit/helpers/createdNativeRace.c')
  state.device = await compileCreatedVariant('test/unit/helpers/createdNativeDevice.c')
  if (process.platform === 'linux')
    state.mount = await compileCreatedVariant('test/unit/helpers/createdNativeMount.c')
})

async function nativeFixture() {
  const root = await mkdtemp(path.join(nativeScratch(), 'case-'))
  const directories = vi.fn(nativeCreated)
  const proof = {
    exited: () => Promise.resolve(true),
    archivedAndClean: () => Promise.resolve(true),
    freeBytes: () => Promise.resolve(100),
    directories,
    files: nativeCreated,
  }
  const registry = await CreatedRegistry.open(path.join(root, 'records.json'), () => 0, proof)
  const personal = path.join(root, 'personal')
  await mkdir(personal)
  await writeFile(path.join(personal, 'keep'), 'personal')
  return { root, personal, proof, directories, registry }
}

describe('native created-directory protocol', () => {
  it('creates through the base handle and removes a nested tree without following its symlinks', async () => {
    const h = await nativeFixture()
    const created = await h.registry.createTemp('tree')
    const personal = h.personal
    await mkdir(path.join(created.root, 'nested', 'deep'), { recursive: true })
    await writeFile(path.join(created.root, 'nested', 'deep', 'owned'), 'ours')
    await symlink(personal, path.join(created.root, 'link'), 'junction')
    await h.registry.finish('tree', false)
    expect(await h.registry.remove(created.root)).toBe(true)
    expect(await readdir(h.registry.base)).toEqual([])
    expect(await readFile(path.join(personal, 'keep'), 'utf8')).toBe('personal')
    expect(h.directories.mock.calls[1]?.[0][0]).toBe('remove')
  })
  it('refuses wrong base/root identity, an occupied quarantine and a copied or forged marker', async () => {
    const h = await nativeFixture()
    const created = await h.registry.createTemp('tree')
    const base = fileIdentityKey(await lstatIdentity(h.registry.base))!
    const identity = fileIdentityKey(await lstatIdentity(created.root))!
    const args = [
      'remove',
      h.registry.base,
      base,
      path.basename(created.root),
      created.id,
      createHash('sha256').update(h.directories.mock.calls[0]![0][5]!).digest('hex'),
      identity,
    ]
    await expect(nativeCreated([...args.slice(0, 2), '0:0', ...args.slice(3)])).rejects.toThrow()
    await expect(nativeCreated([...args.slice(0, 6), '0:0'])).rejects.toThrow()
    await expect(nativeCreated([...args.slice(0, 5), '0'.repeat(64), identity])).rejects.toThrow()
    await mkdir(path.join(h.registry.base, `.muse-trash-${created.id}`))
    await h.registry.finish('tree', false)
    expect(await h.registry.clean()).toMatchObject({ removed: 0, refused: [created.id] })
    expect(await readdir(created.root)).toContain(RESOURCE_TEMP_MARKER)
  })
  it('does not dispatch cleanup of a reloaded pending record without durable identity', async () => {
    const h = await nativeFixture()
    await h.registry.createTemp('tree')
    const file = path.join(h.root, 'records.json')
    const records: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!Array.isArray(records)) throw new Error('Invalid test registry')
    await writeFile(
      file,
      JSON.stringify(
        records.map((record: unknown) => {
          if (typeof record !== 'object' || record === null) throw new Error('Invalid test record')
          return { ...record, identity: null, state: 'pending' }
        }),
      ),
    )
    const restored = await CreatedRegistry.open(file, () => 0, h.proof, h.registry.base)
    expect(await restored.clean()).toMatchObject({ removed: 0, refused: [expect.any(String)] })
    expect(h.directories).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed helper replies and never falls back to pathname deletion', async () => {
    const h = await nativeFixture()
    const created = await h.registry.createTemp('tree')
    await h.registry.finish('tree', false)
    h.directories.mockResolvedValueOnce('{"removed":false}')
    expect(await h.registry.clean()).toMatchObject({ removed: 0, refused: [created.id] })
    expect(await readdir(created.root)).toContain(RESOURCE_TEMP_MARKER)
    h.directories.mockResolvedValueOnce('{"identity":"0:0"}')
    await expect(h.registry.createTemp('other')).rejects.toThrow()
  })
  it('refuses native device and Linux same-device mount boundaries without following Windows reparse points', async () => {
    const readers = process.platform === 'linux' ? [state.device!, state.mount!] : [state.device!]
    for (const reader of readers) {
      const h = await nativeFixture()
      const created = await h.registry.createTemp('tree')
      const mounted = path.join(created.root, 'mounted')
      if (process.platform === 'win32') {
        await symlink(h.personal, mounted, 'junction')
        await h.registry.finish('tree', false)
        expect(await h.registry.remove(created.root)).toBe(true)
      } else {
        await mkdir(mounted)
        await writeFile(path.join(mounted, 'keep'), 'mounted personal')
        h.directories.mockImplementation(reader)
        await h.registry.finish('tree', false)
        await expect(h.registry.remove(created.root)).rejects.toThrow()
        const trash = path.join(h.registry.base, `.muse-trash-${created.id}`)
        expect(await readFile(path.join(trash, 'mounted', 'keep'), 'utf8')).toBe('mounted personal')
      }
      expect(await readFile(path.join(h.personal, 'keep'), 'utf8')).toBe('personal')
    }
  })
})

async function racePublication(marker: string) {
  const h = await nativeFixture()
  await h.registry.createTemp('tree')
  const file = path.join(h.root, 'records.json')
  const previous = await readFile(file, 'utf8')
  await writeFile(path.join(h.root, marker), '')
  h.proof.files = state.race!
  return { ...h, file, previous }
}

// These interleavings exercise POSIX syscalls; the Windows helper uses FILE_CREATE and held handles.
describe.runIf(process.platform !== 'win32')('POSIX native creation and publication races', () => {
  it.each(['quarantine', 'root', 'nested'])(
    'retains an empty native %s replacement',
    async (site) => {
      const h = await nativeFixture()
      const created = await h.registry.createTemp('tree')
      if (site === 'nested') await mkdir(path.join(created.root, 'nested'), { mode: 0o700 })
      await writeFile(
        path.join(h.registry.base, `.race-${site === 'quarantine' ? 'rename' : site}`),
        '',
      )
      h.directories.mockImplementation(state.race!)
      await h.registry.finish('tree', false)
      await expect(h.registry.remove(created.root)).rejects.toThrow()
      const trash = path.join(h.registry.base, `.muse-trash-${created.id}`)
      if (site === 'nested') {
        expect(await readdir(path.join(trash, 'nested'))).toEqual([])
        expect(await readdir(path.join(trash, 'saved-nested'))).toEqual([])
      } else {
        expect(await readdir(trash)).toEqual([])
        if (site === 'quarantine')
          expect(await readdir(created.root)).toContain(RESOURCE_TEMP_MARKER)
        else expect(await readdir(path.join(h.registry.base, 'saved-root'))).toEqual([])
      }
    },
  )
  it('rejects a pre-existing empty directory swapped into native mkdir before open', async () => {
    for (const op of ['create', 'mkdir']) {
      const h = await nativeFixture()
      const personal = path.join(h.registry.base, 'personal')
      await mkdir(personal, { mode: 0o700 })
      await writeFile(path.join(h.registry.base, '.race-create'), '')
      // Separate the pre-existing inode from the filesystem clock tick of the new mkdir.
      await new Promise((resolve) => setTimeout(resolve, 20))
      const args = [
        op,
        h.registry.base,
        fileIdentityKey(await lstatIdentity(h.registry.base))!,
        'muse-tree-a',
        'a',
        '0'.repeat(32),
        '',
      ]
      await expect(state.race!(args)).rejects.toThrow()
      expect(await readdir(path.join(h.registry.base, 'muse-tree-a'))).toEqual([])
      expect(await readdir(path.join(h.registry.base, 'saved-root'))).toEqual([])
    }
  })
  it('rolls back a manifest exchange when the displaced file is not the verified previous manifest', async () => {
    const h = await racePublication('.race-publish')
    await expect(h.registry.finish('tree', false)).rejects.toThrow()
    expect(await readFile(h.file, 'utf8')).toBe('personal manifest')
    expect(await readFile(path.join(h.root, 'saved-manifest'), 'utf8')).toBe(h.previous)
  })
  it('refuses a linked stage replacement before exchange without changing the current manifest', async () => {
    const h = await racePublication('.race-stage')
    await expect(h.registry.finish('tree', false)).rejects.toThrow()
    expect(await readFile(h.file, 'utf8')).toBe(h.previous)
    const names = await readdir(h.root)
    const candidates = names.filter(
      (name) => name.startsWith('records.json.') && name.endsWith('.publish'),
    )
    expect(
      await Promise.all(candidates.map((name) => readFile(path.join(h.root, name), 'utf8'))),
    ).toContain('personal manifest')
  })
})
