import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { confineToRoot } from '../../src/core/fs/confine'
import { removeScratchDirs, trackScratch } from './helpers/scratchDir'

const scratchRoots: string[] = []

function scratch(): Promise<string> {
  return trackScratch(scratchRoots, 'muse-confine-')
}

function directoryLinkKind(): 'junction' | 'dir' {
  return process.platform === 'win32' ? 'junction' : 'dir'
}

afterEach(async () => {
  await removeScratchDirs(scratchRoots)
})

describe('confineToRoot', () => {
  it('keeps a file inside the root and refuses one that climbs out', async () => {
    const root = await scratch()
    await writeFile(path.join(root, 'note.txt'), 'hello')
    const inside = await confineToRoot(root, 'note.txt')
    expect(inside).toBeDefined()
    if (inside === undefined) return
    expect(await readFile(inside, 'utf8')).toBe('hello')
    expect(await confineToRoot(root, '../note.txt')).toBeUndefined()
    const created = await confineToRoot(root, 'brand-new.txt')
    expect(created).toBe(path.join(await realpath(root), 'brand-new.txt'))
  })

  it('refuses a link that leaves, including a file that does not exist yet', async () => {
    const parent = await scratch()
    const root = path.join(parent, 'ws')
    const outside = path.join(parent, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(path.join(outside, 'secret.txt'), 'top-secret')
    const linked = path.join(root, 'linked')
    await symlink(outside, linked, directoryLinkKind())

    expect(await confineToRoot(root, 'linked/secret.txt')).toBeUndefined()
    expect(await confineToRoot(root, path.join(linked, 'secret.txt'))).toBeUndefined()
    expect(await confineToRoot(root, path.join(linked, 'planted.txt'))).toBeUndefined()
  })

  it('follows a link that stays inside the root', async () => {
    const root = await scratch()
    await mkdir(path.join(root, 'src'))
    await writeFile(path.join(root, 'src', 'a.ts'), 'export {}')
    await symlink(path.join(root, 'src'), path.join(root, 'alias'), directoryLinkKind())
    const resolved = await confineToRoot(root, 'alias/a.ts')
    expect(resolved).toBeDefined()
    if (resolved === undefined) return
    expect(await readFile(resolved, 'utf8')).toBe('export {}')
    const created = await confineToRoot(root, 'alias/new.ts')
    expect(created).toBe(path.join(await realpath(path.join(root, 'src')), 'new.ts'))
  })

  it('follows a symlink spelling of the workspace itself', async () => {
    const parent = await scratch()
    const root = path.join(parent, 'ws')
    await mkdir(root)
    await writeFile(path.join(root, 'a.ts'), 'export {}')
    const via = path.join(parent, 'via')
    await symlink(parent, via, directoryLinkKind())
    const resolved = await confineToRoot(root, path.join(via, 'ws', 'a.ts'))
    expect(resolved).toBeDefined()
    if (resolved === undefined) return
    expect(await readFile(resolved, 'utf8')).toBe('export {}')
  })

  // Hosted Windows' TEMP goes through a short name (RUNNER~1), and so does this
  // spelling there: it was refused as outside its own root.
  it('keeps an absolute path the way the temporary folder spells it', async () => {
    const root = await scratch()
    const real = await realpath(root)
    const spelled = path.join(tmpdir(), path.basename(root))
    expect(await confineToRoot(root, spelled)).toBe(real)
    expect(await confineToRoot(root, path.join(spelled, 'new.txt'))).toBe(
      path.join(real, 'new.txt'),
    )
  })

  it('refuses a link whose target is not there', async () => {
    if (process.platform === 'win32') return
    const root = await scratch()
    await symlink(path.join(root, 'missing-target'), path.join(root, 'dangling'))
    expect(await confineToRoot(root, 'dangling')).toBeUndefined()
    expect(await confineToRoot(root, 'dangling/file.txt')).toBeUndefined()
  })
})
