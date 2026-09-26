// Muse Code's memory on the real file system (M49): a folder's entries by
// kind, a junction (Windows, no privilege needed) or symbolic link reported
// as neither file nor folder, the path as the operating system spells it,
// and the store end to end over them.

import { realpathSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectMemoryFolder } from '../../src/core/memory/memoryLocation'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { canonicalPath, isMissingPath } from '../../src/host/canonicalPath'
import { writeFileAtomically } from '../../src/host/fsAtomic'
import { createMemoryIo, listMemoryEntries, systemPath } from '../../src/host/backend/memoryIo'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '', workspace: '', data: '', outside: '', link: '' }

async function readIfPresent(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

const io = createMemoryIo(
  {
    readFile: readIfPresent,
    writeFile: (absolutePath, content) =>
      writeFileAtomically(absolutePath, content, { sleep: () => Promise.resolve() }),
    realPath: canonicalPath,
  },
  { warn: () => undefined },
)

beforeAll(async () => {
  paths.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-memory-')))
  paths.workspace = path.join(paths.root, 'ws')
  paths.data = path.join(paths.root, 'data', 'muse', 'memory')
  paths.outside = path.join(paths.root, 'outside')
  paths.link = path.join(paths.workspace, '.agents', 'memory', 'linked')
  await mkdir(path.join(paths.workspace, '.agents', 'memory', 'notes'), { recursive: true })
  await mkdir(paths.outside, { recursive: true })
  await writeFile(path.join(paths.workspace, '.agents', 'memory', 'a.md'), 'A')
  await writeFile(path.join(paths.outside, 'secret.md'), 'secret')
  await symlink(paths.outside, paths.link, 'junction')
})

afterAll(async () => {
  await rm(paths.link, { force: true })
  await removeFolder(paths.root)
})

describe('listMemoryEntries', () => {
  it('names files, folders and links as such, and nothing for a missing folder', async () => {
    const entries = await listMemoryEntries(path.join(paths.workspace, '.agents', 'memory'))
    expect(entries.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'a.md', kind: 'file' },
      { name: 'linked', kind: 'other' },
      { name: 'notes', kind: 'directory' },
    ])
    await expect(listMemoryEntries(path.join(paths.root, 'none'))).resolves.toEqual([])
    await expect(listMemoryEntries(`${paths.root}\0`)).rejects.toThrow(/null bytes/)
  })
})

describe('systemPath', () => {
  it('spells a folder as the operating system does', async () => {
    await expect(systemPath(paths.workspace)).resolves.toBe(paths.workspace)
    if (process.platform === 'win32') {
      await expect(systemPath(paths.workspace.toLowerCase())).resolves.toBe(paths.workspace)
    }
  })
})

describe('MemoryStore on the file system', () => {
  it('publishes a complete new note before adding its index line', async () => {
    const workspace = path.join(paths.root, 'published-ws')
    await mkdir(workspace, { recursive: true })
    const ready = Promise.withResolvers<{ stage: string; target: string }>()
    const release = Promise.withResolvers<undefined>()
    const warnings: string[] = []
    const stagedIo = createMemoryIo(
      {
        readFile: readIfPresent,
        writeFile: (absolutePath, content) =>
          writeFileAtomically(absolutePath, content, { sleep: () => Promise.resolve() }),
        realPath: canonicalPath,
      },
      {
        warn: (warning) => {
          warnings.push(warning)
        },
        publish: async (stage, target) => {
          ready.resolve({ stage, target })
          await release.promise
          await link(stage, target)
        },
      },
    )
    const store = new MemoryStore({
      io: stagedIo,
      platform: process.platform,
      dataRoot: () => paths.data,
      workspaceRoot: workspace,
      systemPath,
      warn: (warning) => {
        warnings.push(warning)
      },
    })
    const place = await store.locate('project', 'published.md')
    if (!place.ok) {
      throw new Error(place.reason)
    }
    const content = 'Complete before another process can see this note.'
    const pending = store.add(place.value, { content })
    try {
      const { stage, target } = await ready.promise
      expect(target).toBe(place.value.absolute)
      expect(await readIfPresent(target)).toBeUndefined()
      expect(stage).not.toBe(target)
      expect(await readFile(stage, 'utf8')).toBe(content)
      const index = await readIfPresent(path.join(path.dirname(target), 'MEMORY.md'))
      expect(index ?? '').not.toContain('published.md')
    } finally {
      release.resolve(undefined)
      try {
        await pending
      } catch {
        // Keep the publication assertion as the red drill's own failure.
      }
    }
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(await readFile(place.value.absolute, 'utf8')).toBe(content)
    expect(
      await readFile(path.join(path.dirname(place.value.absolute), 'MEMORY.md'), 'utf8'),
    ).toContain('published.md')
    const entries = await readdir(path.dirname(place.value.absolute))
    expect(entries.some((name) => name.startsWith('.published.md.'))).toBe(false)
    expect(warnings).toEqual([])
  })

  it('refuses a filesystem without hard links before publishing a note', async () => {
    const workspace = path.join(paths.root, 'no-link-ws')
    const target = path.join(workspace, '.agents', 'memory', 'no-link.md')
    const noLinks = createMemoryIo(
      {
        readFile: readIfPresent,
        writeFile: (absolutePath, content) =>
          writeFileAtomically(absolutePath, content, { sleep: () => Promise.resolve() }),
        realPath: canonicalPath,
      },
      {
        warn: () => undefined,
        publish: () =>
          Promise.reject(Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' })),
      },
    )
    await expect(noLinks.createFile(target, 'private note')).rejects.toMatchObject({
      code: 'ENOTSUP',
    })
    expect(await readIfPresent(target)).toBeUndefined()
    const entries = await readdir(path.dirname(target))
    expect(entries.some((name) => name.startsWith('.no-link.md.'))).toBe(false)
    const store = new MemoryStore({
      io: noLinks,
      platform: process.platform,
      dataRoot: () => paths.data,
      workspaceRoot: workspace,
      systemPath,
      warn: () => undefined,
    })
    const place = await store.locate('project', 'no-link.md')
    if (!place.ok) {
      throw new Error(place.reason)
    }
    await expect(store.add(place.value, { content: 'private note' })).resolves.toEqual({
      ok: false,
      reason: 'hard links unavailable',
    })
    expect(await readIfPresent(path.join(path.dirname(target), 'MEMORY.md'))).toBeUndefined()
  })

  it('writes notes and their index lines, and refuses a note behind a link', async () => {
    const store = new MemoryStore({
      io,
      platform: process.platform,
      dataRoot: () => paths.data,
      workspaceRoot: paths.workspace,
      systemPath,
      warn: () => undefined,
    })
    const project = await store.locate('project', 'notes/deploy.md')
    expect(project.ok).toBe(true)
    if (project.ok) {
      await store.add(project.value, { content: 'Fridays.', description: 'Deploy day' })
      await expect(io.createFile(project.value.absolute, 'overwrite')).rejects.toMatchObject({
        code: 'EEXIST',
      })
      await expect(readFile(project.value.absolute, 'utf8')).resolves.toBe(
        '---\ndescription: Deploy day\n---\n\nFridays.',
      )
    }
    await expect(
      readFile(path.join(paths.workspace, '.agents', 'memory', 'MEMORY.md'), 'utf8'),
    ).resolves.toBe('- [deploy](notes/deploy.md) | Deploy day\n')
    await expect(store.locate('project', 'linked/secret.md')).resolves.toEqual({
      ok: false,
      reason: 'memory path contains a symlink',
    })
    const personalProject = await store.root('personal_project')
    expect(personalProject).toEqual({
      ok: true,
      value: path.join(
        paths.data,
        'projects',
        projectMemoryFolder([], paths.workspace, process.platform),
      ),
    })
  })
})
