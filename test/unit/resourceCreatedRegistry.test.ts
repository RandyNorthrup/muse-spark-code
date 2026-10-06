import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { TreeTempRoots } from '../../src/host/resources/tempRoots'
import { RESOURCE_TEMP_KEEP_MS } from '../../src/shared/constants'

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
  const registry = await CreatedRegistry.open(file, () => now, proof)
  return {
    root,
    file,
    registry,
    proof,
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
      const parent = path.join(h.root, 'critical-temp')
      const guard = { assertWrite: vi.fn(() => Promise.reject(new Error('critical volume'))) }
      const roots = new TreeTempRoots(parent, h.registry, guard)
      await expect(roots.create('tree')).rejects.toThrow('critical volume')
      expect(guard.assertWrite).toHaveBeenCalledWith(parent)
      await expect(readFile(parent)).rejects.toMatchObject({ code: 'ENOENT' })
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
      const restored = await CreatedRegistry.open(h.file, h.now, h.proof)
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
        const created = path.join(h.root, kind)
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
      const created = path.join(h.root, 'created')
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
      await expect(h.registry.remove(created)).rejects.toThrow('identity changed')
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
      const clone = path.join(h.root, 'code-sign-clone')
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
      const parent = path.join(h.root, 'parent')
      const renamed = path.join(h.root, 'renamed')
      const child = path.join(parent, 'child')
      await mkdir(child, { recursive: true })
      const alias = path.join(h.root, 'alias')
      await symlink(parent, alias, 'junction')
      await expect(
        h.registry.recordCreated(path.join(alias, 'child'), 'tree', 'temp'),
      ).rejects.toThrow('registered')
      await h.registry.recordCreated(child, 'tree', 'temp')
      h.exit()
      await h.registry.finish('tree', false)
      await rename(parent, renamed)
      await symlink(renamed, parent, 'junction')
      await expect(h.registry.remove(child)).rejects.toThrow('identity changed')
    } finally {
      await h.cleanup()
    }
  })
  it('rolls back an unpersisted creation claim and rejects registry ancestors', async () => {
    const h = await fixture()
    try {
      await expect(h.registry.recordCreated(h.root, 'tree', 'temp')).rejects.toThrow('Invalid')
      const created = path.join(h.root, 'created')
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
      const owned = path.join(h.root, 'owned')
      await mkdir(owned)
      await h.registry.recordCreated(owned, 'owner', 'temp')
      await expect(h.registry.recordCreated(owned, 'owner', 'temp')).rejects.toThrow('registered')
      const alias = path.join(h.root, 'alias')
      await symlink(owned, alias, 'junction')
      await expect(h.registry.recordCreated(alias, 'owner', 'temp')).rejects.toThrow('registered')
      await writeFile(
        h.file,
        JSON.stringify([
          {
            id: 'bad',
            owner: 'tree',
            path: 'relative',
            identity: '1:2',
            kind: 'temp',
            endedAtMs: null,
            failed: false,
          },
        ]),
      )
      await expect(CreatedRegistry.open(h.file, h.now, h.proof)).rejects.toThrow('Invalid')
      const record = {
        id: 'duplicate',
        owner: 'tree',
        path: owned,
        identity: '1:2',
        kind: 'temp',
        endedAtMs: null,
        failed: false,
      }
      await writeFile(
        h.file,
        JSON.stringify([record, { ...record, path: path.join(h.root, 'second') }]),
      )
      await expect(CreatedRegistry.open(h.file, h.now, h.proof)).rejects.toThrow('Invalid')
      await writeFile(h.file, JSON.stringify([record, { ...record, id: 'other-id' }]))
      await expect(CreatedRegistry.open(h.file, h.now, h.proof)).rejects.toThrow('Invalid')
      await writeFile(h.file, JSON.stringify([{ ...record, owner: 100 }]))
      await expect(CreatedRegistry.open(h.file, h.now, h.proof)).rejects.toThrow()
      await writeFile(h.file, 'not json')
      await expect(CreatedRegistry.open(h.file, h.now, h.proof)).rejects.toThrow()
    } finally {
      await h.cleanup()
    }
  })
})
