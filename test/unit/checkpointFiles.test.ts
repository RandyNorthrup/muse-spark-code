import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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
/** What a step expects of a file a capture held: these bytes, this mode. */
const holding = (text: string, mode = GIT_MODE_FILE) => ({
  kind: 'blob' as const,
  ...blob(text, mode),
})

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
      { path: 'a/x.txt', target: null, expect: holding('the user’s file\n') },
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
        expect: holding('the user’s file\n'),
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
      { path: file, target: blob('restored\n'), expect: holding('older\n') },
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
      { path: 'made/deeper/n.txt', target: null, expect: holding('new\n') },
      undefined,
      () => false,
    )
    const written = await applyFileStep(
      target,
      {
        path: 'c/x.txt',
        target: blob('restored\n'),
        expect: holding('the user’s file\n'),
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
          expect: holding('the user’s file\n'),
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
          // The restore above made it executable: the capture then would say so.
          expect: holding('script\n', GIT_MODE_EXECUTABLE),
        },
        Buffer.from('plain\n'),
        undefined,
      )
      const plain = await stat(file)
      expect(plain.mode & 0o777).toBe(0o600)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'leaves a file whose execute bit changed since the capture, its bytes the same',
    async () => {
      const { root, target } = await linkedWorkspace()
      const file = path.join(root, 'c', 'x.txt')
      const step = (mode: string) =>
        applyFileStep(
          target,
          {
            path: 'c/x.txt',
            target: blob('restored\n'),
            expect: holding('the user’s file\n', mode),
          },
          Buffer.from('restored\n'),
          undefined,
        )
      // Captured plain, then made executable; captured executable, then made plain.
      await chmod(file, 0o755)
      const madeExecutable = await step(GIT_MODE_FILE)
      const deleted = await applyFileStep(
        target,
        { path: 'c/x.txt', target: null, expect: holding('the user’s file\n') },
        undefined,
        undefined,
      )
      const executable = await stat(file)
      await chmod(file, 0o644)
      const madePlain = await step(GIT_MODE_EXECUTABLE)
      const plain = await stat(file)
      expect([madeExecutable, deleted, madePlain]).toEqual(['changed', 'changed', 'changed'])
      expect([executable.mode & 0o777, plain.mode & 0o777]).toEqual([0o755, 0o644])
      expect(await readFile(file, 'utf8')).toBe('the user’s file\n')
    },
  )

  it.runIf(process.platform === 'win32')(
    'still restores an unchanged file on Windows, which keeps no execute bit',
    async () => {
      const { root, target } = await linkedWorkspace()
      // A restore there sets no execute bit either, so only the bytes tell.
      const result = await applyFileStep(
        target,
        {
          path: 'c/x.txt',
          target: blob('restored\n'),
          expect: holding('the user’s file\n', GIT_MODE_EXECUTABLE),
        },
        Buffer.from('restored\n'),
        undefined,
      )
      expect(result).toBe('done')
      expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('restored\n')
    },
  )
})

/** Whether the temporary folder's volume tells `a` from `A`. */
function isCaseSensitiveVolume(): boolean {
  const probe = path.join(base, `case-${randomUUID()}`)
  writeFileSync(probe, 'probe')
  return !existsSync(probe.toUpperCase())
}

describe('a restore on a volume that tells letter case apart (M72)', () => {
  it.skipIf(!isCaseSensitiveVolume())(
    'never writes through a link that differs from its target only in letter case',
    async () => {
      const root = path.join(base, randomUUID())
      await mkdir(path.join(root, 'Foo'), { recursive: true })
      await writeFile(path.join(root, 'Foo', 'x.txt'), 'the user’s file\n')
      await symlink(path.join(root, 'Foo'), path.join(root, 'foo'), 'dir')
      // macOS offers case-sensitive volumes too: the restore must not fold case blindly.
      const target = {
        workspaceRoot: root,
        platform: 'darwin' as const,
        log: new FakeLogOutputChannel(),
      }
      const result = await applyFileStep(
        target,
        {
          path: 'foo/x.txt',
          target: blob('overwritten\n'),
          expect: holding('the user’s file\n'),
        },
        Buffer.from('overwritten\n'),
        undefined,
      )
      expect(result).toBe('linked')
      expect(await readFile(path.join(root, 'Foo', 'x.txt'), 'utf8')).toBe('the user’s file\n')
    },
  )

  it.skipIf(isCaseSensitiveVolume())(
    'still writes a file named in another letter case on a volume that folds it',
    async () => {
      const root = path.join(base, randomUUID())
      await mkdir(path.join(root, 'Foo'), { recursive: true })
      await writeFile(path.join(root, 'Foo', 'x.txt'), 'the user’s file\n')
      const target = {
        workspaceRoot: root,
        platform: process.platform,
        log: new FakeLogOutputChannel(),
      }
      const result = await applyFileStep(
        target,
        {
          path: 'foo/X.TXT',
          target: blob('restored\n'),
          expect: holding('the user’s file\n'),
        },
        Buffer.from('restored\n'),
        undefined,
      )
      expect(result).toBe('done')
      expect(await readFile(path.join(root, 'Foo', 'x.txt'), 'utf8')).toBe('restored\n')
    },
  )
})
