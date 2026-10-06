import * as fs from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { TreeTempRoots } from '../../src/host/resources/tempRoots'
import { fileIdentityKey, lstatIdentity } from '../../src/core/fs/fileIdentity'
import { RESOURCE_TEMP_KEEP_MS, RESOURCE_TEMP_MARKER } from '../../src/shared/constants'

vi.mock('node:fs/promises', { spy: true })

async function fixture() {
  const base = path.join(process.cwd(), 'temp')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, 'm107-dk-test-'))
  let now = 0
  let hasExited = false
  let isArchivedAndClean = false
  let available = 100
  const proof = {
    createdByTree: vi.fn(() => Promise.resolve(true)),
    exited: vi.fn(() => Promise.resolve(hasExited)),
    archivedAndClean: vi.fn(() => Promise.resolve(isArchivedAndClean)),
    freeBytes: vi.fn(() => Promise.resolve(available)),
  }
  const file = path.join(root, 'records', 'created.json')
  const registry = await CreatedRegistry.open(file, () => now, proof, path.join(root, 'trees'))
  return {
    root,
    nativeFs: await vi.importActual<typeof FsPromises>('node:fs/promises'),
    file,
    registry,
    proof,
    retiredTemp: async () => {
      const temp = await new TreeTempRoots(registry.base, registry).create('tree')
      hasExited = true
      await registry.finish('tree', false)
      return temp
    },
    now: () => now,
    exit: () => {
      hasExited = true
    },
    archive: () => {
      isArchivedAndClean = true
    },
    advance: (ms: number) => {
      now += ms
    },
    free: (bytes: number) => {
      available = bytes
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describe('D87.14 creation registry and tree temp roots', () => {
  it('refuses unregistered cleanup, including a folder that looks like ours', async () => {
    const h = await fixture()
    try {
      const outsider = path.join(h.root, 'muse-tree-personal')
      await mkdir(outsider)
      await writeFile(path.join(outsider, 'keep'), 'personal file')
      await expect(h.registry.remove(outsider)).rejects.toThrow('Unregistered path')
      expect(await h.registry.release('never-recorded')).toBe(false)
      expect(await readFile(path.join(outsider, 'keep'), 'utf8')).toBe('personal file')
    } finally {
      await h.cleanup()
    }
  })
  it('refuses temp-root creation before writing on a critical volume', async () => {
    const h = await fixture()
    try {
      const parent = h.registry.base
      const guard = { assertWrite: vi.fn(() => Promise.reject(new Error('critical volume'))) }
      const roots = new TreeTempRoots(parent, h.registry, guard)
      await expect(roots.create('tree')).rejects.toThrow('critical volume')
      expect(guard.assertWrite).toHaveBeenCalledWith(parent)
      expect(await readdir(parent)).toEqual([])
    } finally {
      await h.cleanup()
    }
  })
  it('injects all temp variables, browser profile/cache and deletes only after whole-tree proof', async () => {
    const h = await fixture()
    try {
      const temps = new TreeTempRoots(path.join(h.root, 'trees'), h.registry)
      const temp = await temps.create('registered-tree')
      expect(temp.environment).toEqual({ TMPDIR: temp.root, TEMP: temp.root, TMP: temp.root })
      expect(path.dirname(temp.profile)).toBe(temp.root)
      expect(path.dirname(temp.cache)).toBe(temp.root)
      await writeFile(path.join(temp.cache, 'browser-leftover'), 'cache')
      await expect(temp.finish(false)).rejects.toThrow('not retired')
      expect(await h.registry.clean()).toMatchObject({ removed: 0 })
      h.exit()
      await temp.finish(false)
      await expect(readFile(path.join(temp.cache, 'browser-leftover'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await h.cleanup()
    }
  })
  it('allows the pressure cleaner and tree-exit cleanup to retire the same registered root', async () => {
    const h = await fixture()
    try {
      const temp = await new TreeTempRoots(path.join(h.root, 'trees'), h.registry).create('tree')
      h.exit()
      await Promise.all([temp.finish(false), h.registry.clean()])
      await expect(readFile(temp.root)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(h.registry.remove(temp.root)).rejects.toThrow('Unregistered')
    } finally {
      await h.cleanup()
    }
  })
  it('retains failures for 24 hours across registry reloads, then cleans and reports reclaimed bytes', async () => {
    const h = await fixture()
    try {
      const temp = await new TreeTempRoots(path.join(h.root, 'trees'), h.registry).create(
        'failed-tree',
      )
      h.exit()
      await temp.finish(true)
      const restored = await CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)
      h.advance(RESOURCE_TEMP_KEEP_MS - 1)
      expect(await restored.clean()).toMatchObject({ removed: 0 })
      h.advance(1)
      h.proof.freeBytes.mockResolvedValueOnce(100).mockResolvedValueOnce(140)
      expect(await restored.clean()).toEqual({ removed: 1, freedBytes: 40 })
      await expect(readFile(temp.root)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await h.cleanup()
    }
  })
  it('keeps live or dirty worktrees and dependency copies until archived/merged and clean', async () => {
    const h = await fixture()
    try {
      for (const kind of ['worktree', 'dependencies'] as const) {
        const created = path.join(h.registry.base, `muse-tree-${kind === 'worktree' ? '1' : '2'}`)
        await mkdir(created)
        await h.registry.recordCreated(created, 'owner', kind)
      }
      expect(await h.registry.clean()).toMatchObject({ removed: 0 })
      h.exit()
      await h.registry.finish('owner', false)
      expect(await h.registry.clean()).toMatchObject({ removed: 0 })
      h.archive()
      expect(await h.registry.clean()).toMatchObject({ removed: 2 })
    } finally {
      await h.cleanup()
    }
  })
  it('refuses changed identity and never follows a symlink substituted for a registered root', async () => {
    const h = await fixture()
    try {
      const created = path.join(h.registry.base, 'muse-tree-c')
      const original = path.join(h.root, 'original')
      const outsider = path.join(h.root, 'outsider')
      await mkdir(created)
      await mkdir(outsider)
      await writeFile(path.join(outsider, 'keep'), 'personal')
      await h.registry.recordCreated(created, 'owner', 'osClone')
      h.exit()
      await h.registry.finish('owner', false)
      await rename(created, original)
      await mkdir(created)
      await expect(h.registry.remove(created)).rejects.toThrow('identity changed')
      await rm(created, { recursive: true })
      await symlink(outsider, created, 'junction')
      expect(await h.registry.remove(created)).toBe(false)
      expect(await readFile(path.join(outsider, 'keep'), 'utf8')).toBe('personal')
    } finally {
      await h.cleanup()
    }
  })
  it('removes nested symlinks without touching their targets, and retries a missing registered root', async () => {
    const h = await fixture()
    try {
      const temp = await new TreeTempRoots(path.join(h.root, 'trees'), h.registry).create('tree')
      const outsider = path.join(h.root, 'outsider')
      await mkdir(outsider)
      await writeFile(path.join(outsider, 'keep'), 'personal')
      await symlink(outsider, path.join(temp.root, 'link'), 'junction')
      h.exit()
      await temp.finish(false)
      expect(await readFile(path.join(outsider, 'keep'), 'utf8')).toBe('personal')
      const second = await new TreeTempRoots(path.join(h.root, 'trees'), h.registry).create(
        'other-tree',
      )
      await h.registry.finish('other-tree', false)
      await rm(second.root, { recursive: true })
      expect(await h.registry.remove(second.root)).toBe(true)
    } finally {
      await h.cleanup()
    }
  })
  it('refuses OS clones whose creating registered tree was not proved', async () => {
    const h = await fixture()
    try {
      const clone = path.join(h.registry.base, 'muse-tree-a')
      await mkdir(clone)
      h.proof.createdByTree.mockResolvedValue(false)
      await expect(h.registry.recordCreated(clone, 'tree', 'osClone')).rejects.toThrow(
        'creator unproved',
      )
      h.exit()
      await h.registry.finish('tree', false)
      await expect(h.registry.remove(clone)).rejects.toThrow('Unregistered')
    } finally {
      await h.cleanup()
    }
  })
  it('refuses canonical aliases at registration and cleanup even when native identity matches', async () => {
    const h = await fixture()
    try {
      const parent = h.registry.base
      const renamed = path.join(h.root, 'renamed')
      const child = path.join(parent, 'muse-tree-f')
      await mkdir(child, { recursive: true })
      const alias = path.join(h.registry.base, 'muse-tree-e')
      await symlink(parent, alias, 'junction')
      await expect(
        h.registry.recordCreated(path.join(alias, 'muse-tree-f'), 'tree', 'temp'),
      ).rejects.toThrow()
      await h.registry.recordCreated(child, 'tree', 'temp')
      h.exit()
      await h.registry.finish('tree', false)
      await rename(parent, renamed)
      await symlink(renamed, parent, 'junction')
      await expect(h.registry.remove(child)).rejects.toThrow()
    } finally {
      await h.cleanup()
    }
  })
  it('rolls back an unpersisted creation claim and rejects registry ancestors', async () => {
    const h = await fixture()
    try {
      await expect(h.registry.recordCreated(h.root, 'tree', 'temp')).rejects.toThrow('Invalid')
      const created = path.join(h.registry.base, 'muse-tree-c')
      await mkdir(created)
      await mkdir(h.file, { recursive: true })
      await expect(h.registry.recordCreated(created, 'tree', 'temp')).rejects.toThrow()
      await expect(h.registry.remove(created)).rejects.toThrow('Unregistered')
    } finally {
      await h.cleanup()
    }
  })
  it('rejects invalid, duplicate, aliased and symlink creation claims and malformed persisted records', async () => {
    const h = await fixture()
    try {
      await expect(CreatedRegistry.open('relative', h.now, h.proof)).rejects.toThrow('absolute')
      await expect(h.registry.recordCreated('relative', 'owner', 'temp')).rejects.toThrow('Invalid')
      await expect(
        h.registry.recordCreated(path.parse(h.root).root, 'owner', 'temp'),
      ).rejects.toThrow('Invalid')
      await expect(h.registry.recordCreated(h.file, 'owner', 'temp')).rejects.toThrow('Invalid')
      await expect(h.registry.recordCreated(path.dirname(h.file), 'owner', 'temp')).rejects.toThrow(
        'Invalid',
      )
      const owned = path.join(h.registry.base, 'muse-tree-d')
      await mkdir(owned)
      await h.registry.recordCreated(owned, 'owner', 'temp')
      await expect(h.registry.recordCreated(owned, 'owner', 'temp')).rejects.toThrow()
      const alias = path.join(h.registry.base, 'muse-tree-e')
      await symlink(owned, alias, 'junction')
      await expect(h.registry.recordCreated(alias, 'owner', 'temp')).rejects.toThrow()
      await writeFile(
        h.file,
        JSON.stringify([
          {
            id: 'bad',
            owner: 'tree',
            path: 'relative',
            identity: '1:2',
            tokenHash: '0'.repeat(64),
            state: 'created',
            kind: 'temp',
            endedAtMs: null,
            failed: false,
          },
        ]),
      )
      await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
        'Invalid',
      )
      const record = {
        id: 'd',
        owner: 'tree',
        path: owned,
        identity: '1:2',
        tokenHash: '0'.repeat(64),
        state: 'created',
        kind: 'temp',
        endedAtMs: null,
        failed: false,
      }
      await writeFile(
        h.file,
        JSON.stringify([record, { ...record, path: path.join(h.root, 'second') }]),
      )
      await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
        'Invalid',
      )
      await writeFile(h.file, JSON.stringify([record, { ...record, id: 'e' }]))
      await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
        'Invalid',
      )
      await writeFile(h.file, JSON.stringify([{ ...record, owner: 100 }]))
      await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow()
      await writeFile(h.file, 'not json')
      await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow()
    } finally {
      await h.cleanup()
    }
  })
  it('refuses the forged public manifest, outside paths and ancestor records without deleting anything', async () => {
    const h = await fixture()
    try {
      const personal = path.join(h.root, 'personal')
      await mkdir(personal)
      await writeFile(path.join(personal, 'keep'), 'personal')
      const record = {
        id: 'a',
        owner: 'forged',
        path: personal,
        identity: fileIdentityKey(await lstatIdentity(personal)),
        kind: 'temp',
        endedAtMs: 0,
        failed: false,
        tokenHash: '0'.repeat(64),
        state: 'created',
      }
      await mkdir(path.dirname(h.file), { recursive: true })
      await writeFile(h.file, JSON.stringify([record]), { mode: 0o666 })
      if (process.platform !== 'win32') {
        await chmod(h.file, 0o666)
        await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
          'permissions',
        )
        await chmod(h.file, 0o600)
      }
      for (const target of [
        personal,
        h.root,
        h.registry.base,
        path.join(h.registry.base, 'nested', 'muse-tree-a'),
        path.join(h.registry.base, 'other'),
      ]) {
        await writeFile(h.file, JSON.stringify([{ ...record, path: target }]))
        await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
          'Invalid created path',
        )
      }
      expect(await readFile(path.join(personal, 'keep'), 'utf8')).toBe('personal')
      expect(await h.registry.clean()).toMatchObject({ removed: 0 })
    } finally {
      await h.cleanup()
    }
  })
  it('refuses public or linked bases and never repairs existing permissions', async () => {
    const h = await fixture()
    try {
      if (process.getuid !== undefined) {
        const uid = process.getuid()
        const owner = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1)
        await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
          'ownership',
        )
        owner.mockRestore()
      }
      if (process.platform !== 'win32') {
        await chmod(h.registry.base, 0o777)
        await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow(
          'permissions',
        )
        const sample = await fs.stat(h.registry.base)
        expect(sample.mode & 0o777).toBe(0o777)
        await chmod(h.registry.base, 0o700)
      }
      const actual = path.join(h.root, 'actual')
      await rename(h.registry.base, actual)
      await symlink(actual, h.registry.base, 'junction')
      await expect(CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)).rejects.toThrow()
    } finally {
      await h.cleanup()
    }
  })
  it('requires a matching marker and fresh exit proof after reload even with an ended timestamp', async () => {
    const h = await fixture()
    try {
      const temp = await new TreeTempRoots(h.registry.base, h.registry).create('tree')
      h.exit()
      await temp.finish(true)
      h.advance(RESOURCE_TEMP_KEEP_MS)
      h.proof.exited.mockResolvedValue(false)
      const restored = await CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)
      expect(await restored.clean()).toMatchObject({ removed: 0 })
      h.proof.exited.mockResolvedValue(true)
      await writeFile(
        path.join(temp.root, RESOURCE_TEMP_MARKER),
        JSON.stringify({ id: 'a', token: '0'.repeat(32) }),
      )
      expect(await restored.clean()).toMatchObject({ removed: 0, refused: [expect.any(String)] })
      expect(await readdir(h.registry.base)).toContain(path.basename(temp.root))
    } finally {
      await h.cleanup()
    }
  })
  it('quarantines and rechecks a concurrent root swap without deleting the personal directory', async () => {
    const h = await fixture()
    try {
      const temp = await new TreeTempRoots(h.registry.base, h.registry).create('tree')
      const personal = path.join(h.root, 'personal')
      const moved = path.join(h.registry.base, 'saved')
      await mkdir(personal)
      await writeFile(path.join(personal, 'keep'), 'personal')
      h.exit()
      await h.registry.finish('tree', false)
      const swap = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
        if (
          String(source)
            .replaceAll('\\', '/')
            .endsWith(`/${path.basename(temp.root)}`)
        ) {
          await h.nativeFs.rename(source, moved)
          await h.nativeFs.rename(personal, source)
        }
        await h.nativeFs.rename(source, destination)
      })
      await expect(h.registry.remove(temp.root)).rejects.toThrow(
        'identity changed during quarantine',
      )
      swap.mockRestore()
      expect(await readFile(path.join(temp.root, 'keep'), 'utf8')).toBe('personal')
      expect(await readdir(moved)).toContain(RESOURCE_TEMP_MARKER)
    } finally {
      vi.restoreAllMocks()
      await h.cleanup()
    }
  })
  it('pins the base and protects a personal directory when an ancestor is swapped after realpath', async () => {
    const h = await fixture()
    try {
      const moved = path.join(h.root, 'saved-base')
      const personal = path.join(h.root, 'personal-base')
      await mkdir(personal)
      const temp = await new TreeTempRoots(h.registry.base, h.registry).create('tree')
      const replacement = path.join(personal, path.basename(temp.root))
      await mkdir(replacement)
      await writeFile(path.join(replacement, 'keep'), 'personal')
      h.exit()
      await h.registry.finish('tree', false)
      let calls = 0
      const swap = vi.spyOn(fs, 'realpath').mockImplementation(async (file, options) => {
        const canonical = await h.nativeFs.realpath(file, options)
        if (String(file) === h.registry.base && ++calls === 2) {
          await h.nativeFs.rename(h.registry.base, moved)
          await h.nativeFs.rename(personal, h.registry.base)
        }
        return canonical
      })
      await expect(h.registry.remove(temp.root)).rejects.toThrow()
      swap.mockRestore()
      expect(await readFile(path.join(temp.root, 'keep'), 'utf8')).toBe('personal')
      const saved = await readdir(moved)
      expect(saved).toHaveLength(1)
      if (process.platform === 'linux') expect(saved).toContain(path.basename(temp.root))
      expect(await readdir(path.join(moved, saved[0] ?? 'missing'))).toContain(RESOURCE_TEMP_MARKER)
    } finally {
      vi.restoreAllMocks()
      await h.cleanup()
    }
  })
  it('persists intent before mkdir and recovers a marked pending creation after a failed final save', async () => {
    const h = await fixture()
    try {
      await mkdir(h.file, { recursive: true })
      const roots = new TreeTempRoots(h.registry.base, h.registry)
      for (const owner of ['first', 'second']) await expect(roots.create(owner)).rejects.toThrow()
      expect(await readdir(h.registry.base)).toEqual([])
      await rm(h.file, { recursive: true })
      let saves = 0
      const fail = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (String(to) === h.file && ++saves === 2)
          throw Object.assign(new Error('full'), { code: 'ENOSPC' })
        await h.nativeFs.rename(from, to)
      })
      await expect(roots.create('pending')).rejects.toThrow('full')
      fail.mockRestore()
      expect(await readdir(h.registry.base)).toHaveLength(1)
      h.exit()
      const restored = await CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)
      expect(await restored.clean()).toMatchObject({ removed: 1 })
      expect(await readdir(h.registry.base)).toEqual([])
    } finally {
      vi.restoreAllMocks()
      await h.cleanup()
    }
  })
  it('flags a swapped first root and continues cleanup of a genuine second root', async () => {
    const h = await fixture()
    try {
      const roots = new TreeTempRoots(h.registry.base, h.registry)
      const first = await roots.create('first')
      const second = await roots.create('second')
      h.exit()
      await h.registry.finish('first', false)
      await h.registry.finish('second', false)
      await rename(first.root, path.join(h.registry.base, 'saved'))
      await mkdir(first.root)
      await writeFile(path.join(first.root, 'keep'), 'personal')
      expect(await h.registry.clean()).toMatchObject({ removed: 1, refused: [expect.any(String)] })
      expect(await readFile(path.join(first.root, 'keep'), 'utf8')).toBe('personal')
      await expect(readFile(second.root)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await h.registry.clean()).toMatchObject({ removed: 0, refused: [expect.any(String)] })
    } finally {
      await h.cleanup()
    }
  })
  it('keeps a genuine root when an open manifest becomes public or its quarantine is occupied', async () => {
    const h = await fixture()
    try {
      const temp = await h.retiredTemp()
      if (process.platform !== 'win32') {
        await chmod(h.file, 0o666)
        await expect(h.registry.remove(temp.root)).rejects.toThrow('permissions')
        expect(await readdir(h.registry.base)).toContain(path.basename(temp.root))
        await chmod(h.file, 0o600)
      }
      const entries = z
        .array(z.record(z.string(), z.unknown()))
        .parse(JSON.parse(await readFile(h.file, 'utf8')))
      const id = entries[0]?.['id']
      if (typeof id !== 'string') throw new Error('Missing creation id')
      const trash = path.join(h.registry.base, `.muse-trash-${id}`)
      await mkdir(trash)
      await expect(h.registry.remove(temp.root)).rejects.toThrow('quarantine already exists')
      expect(await readdir(trash)).toEqual([])
      expect(await readdir(temp.root)).toContain(RESOURCE_TEMP_MARKER)
    } finally {
      await h.cleanup()
    }
  })
  it('refuses quarantine when native root identity is unavailable even for a marked pending intent', async () => {
    const h = await fixture()
    try {
      const temp = await h.retiredTemp()
      const entries = z
        .array(z.record(z.string(), z.unknown()))
        .parse(JSON.parse(await readFile(h.file, 'utf8')))
      await writeFile(
        h.file,
        JSON.stringify(entries.map((entry) => ({ ...entry, state: 'pending', identity: null }))),
      )
      const restored = await CreatedRegistry.open(h.file, h.now, h.proof, h.registry.base)
      const invalid = vi.spyOn(fs, 'lstat').mockImplementation(async (file, options) => {
        if (typeof file === 'string' && /(?:muse-tree-|\.muse-trash-)/u.test(file)) {
          const sample = await h.nativeFs.lstat(file, { bigint: true })
          sample.ino = 0n
          return sample
        }
        return await h.nativeFs.lstat(file, options)
      })
      await expect(restored.remove(temp.root)).rejects.toThrow('identity changed')
      invalid.mockRestore()
      expect(await readdir(temp.root)).toContain(RESOURCE_TEMP_MARKER)
    } finally {
      vi.restoreAllMocks()
      await h.cleanup()
    }
  })
})
