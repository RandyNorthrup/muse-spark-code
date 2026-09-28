import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import { applyFileStep, linkedFolders } from '../../src/host/checkpoints/checkpointFiles'
import { GIT_MODE_EXECUTABLE, GIT_MODE_FILE } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

// The file steps of a restore (M72) over real folders: a folder link (a
// junction on Windows, which Git for Windows walks into) is never followed,
// a file no longer as expected is never touched, and permissions are kept.
const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-checkpoint-files-')))

afterAll(async () => {
  await removeFolder(base)
})

/** A fresh workspace holding `c/x.txt` and a folder link `a` to `c`. */
async function linkedWorkspace() {
  const root = path.join(base, randomUUID())
  await mkdir(path.join(root, 'c'), { recursive: true })
  await writeFile(path.join(root, 'c', 'x.txt'), 'the user’s file\n')
  await symlink(path.join(root, 'c'), path.join(root, 'a'), 'junction')
  return {
    root,
    target: { workspaceRoot: root, platform: process.platform, log: new FakeLogOutputChannel() },
  }
}

const oidOf = (text: string) => gitBlobOid(Buffer.from(text))
const blob = (text: string, mode = GIT_MODE_FILE) => ({ mode, oid: oidOf(text) })

describe('linkedFolders (M72)', () => {
  it('names the outermost folder link on the way to each path, and no real folder', async () => {
    const { root } = await linkedWorkspace()
    await mkdir(path.join(root, 'c', 'deep'))
    expect(await linkedFolders(root, ['a/x.txt', 'a/deep/y.txt', 'c/x.txt', 'top.txt'])).toEqual([
      'a',
    ])
  })
})

describe('applyFileStep (M72)', () => {
  it('never deletes through a folder link', async () => {
    const { root, target } = await linkedWorkspace()
    const result = await applyFileStep(
      target,
      { path: 'a/x.txt', target: null, expect: { kind: 'blob', oid: oidOf('the user’s file\n') } },
      undefined,
      () => false,
    )
    expect(result).toBe('linked')
    expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('the user’s file\n')
  })

  it('never writes through a folder link', async () => {
    const { root, target } = await linkedWorkspace()
    const result = await applyFileStep(
      target,
      {
        path: 'a/x.txt',
        target: blob('overwritten\n'),
        expect: { kind: 'blob', oid: oidOf('the user’s file\n') },
      },
      Buffer.from('overwritten\n'),
      undefined,
    )
    expect(result).toBe('linked')
    expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('the user’s file\n')
  })

  it('leaves a file that is no longer as expected', async () => {
    const { root, target } = await linkedWorkspace()
    const file = 'c/x.txt'
    const changed = await applyFileStep(
      target,
      { path: file, target: blob('restored\n'), expect: { kind: 'blob', oid: oidOf('older\n') } },
      Buffer.from('restored\n'),
      undefined,
    )
    const present = await applyFileStep(
      target,
      { path: file, target: null, expect: { kind: 'absent' } },
      undefined,
      undefined,
    )
    const restat = await applyFileStep(
      target,
      { path: file, target: null, expect: { kind: 'stat', stat: { size: 1, mtimeMs: 1 } } },
      undefined,
      undefined,
    )
    expect([changed, present, restat]).toEqual(['changed', 'changed', 'changed'])
    expect(await readFile(path.join(root, file), 'utf8')).toBe('the user’s file\n')
  })

  it('writes and deletes a file still as expected, removing the folders it empties', async () => {
    const { root, target } = await linkedWorkspace()
    await mkdir(path.join(root, 'made', 'deeper'), { recursive: true })
    await writeFile(path.join(root, 'made', 'deeper', 'n.txt'), 'new\n')
    const deleted = await applyFileStep(
      target,
      { path: 'made/deeper/n.txt', target: null, expect: { kind: 'blob', oid: oidOf('new\n') } },
      undefined,
      () => false,
    )
    const written = await applyFileStep(
      target,
      {
        path: 'c/x.txt',
        target: blob('restored\n'),
        expect: { kind: 'blob', oid: oidOf('the user’s file\n') },
      },
      Buffer.from('restored\n'),
      undefined,
    )
    expect([deleted, written]).toEqual(['done', 'done'])
    await expect(stat(path.join(root, 'made'))).rejects.toThrow()
    expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('restored\n')
  })

  it.skipIf(process.platform === 'win32')(
    'keeps a file’s own permissions and sets only the execute bits',
    async () => {
      const { root, target } = await linkedWorkspace()
      const file = path.join(root, 'c', 'x.txt')
      await chmod(file, 0o600)
      await applyFileStep(
        target,
        {
          path: 'c/x.txt',
          target: blob('script\n', GIT_MODE_EXECUTABLE),
          expect: { kind: 'blob', oid: oidOf('the user’s file\n') },
        },
        Buffer.from('script\n'),
        undefined,
      )
      const script = await stat(file)
      expect(script.mode & 0o777).toBe(0o700)
      await applyFileStep(
        target,
        {
          path: 'c/x.txt',
          target: blob('plain\n'),
          expect: { kind: 'blob', oid: oidOf('script\n') },
        },
        Buffer.from('plain\n'),
        undefined,
      )
      const plain = await stat(file)
      expect(plain.mode & 0o777).toBe(0o600)
    },
  )
})
