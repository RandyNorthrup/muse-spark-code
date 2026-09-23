import { chmod, lstat, mkdtemp, readdir, readFile, rename, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileAtomically } from '../../src/host/fsAtomic'
import { isSamePath } from '../../src/core/paths'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '' }

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'muse-atomic-'))
})

afterAll(() => removeFolder(paths.root))

const noWait = () => Promise.resolve()

/** A file-system error with its code, as Node raises one. */
function coded(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('writeFileAtomically (D27)', () => {
  it('creates the folder, replaces the file and leaves no temporary file', async () => {
    const target = path.join(paths.root, 'nested', 'a.txt')
    const sleep = vi.fn(() => Promise.resolve())
    await writeFileAtomically(target, 'one', { sleep })
    await writeFileAtomically(target, 'two', { sleep })
    await expect(readFile(target, 'utf8')).resolves.toBe('two')
    expect(await readdir(path.dirname(target))).toEqual(['a.txt'])
    expect(sleep).not.toHaveBeenCalled()
  })

  it('tries a busy rename again, the wait doubling, then gives up and cleans up', async () => {
    const target = path.join(paths.root, 'busy', 'b.txt')
    let refusals = 1
    const sleep = vi.fn(() => Promise.resolve())
    await writeFileAtomically(target, 'ok', {
      sleep,
      rename: async (from, to) => {
        if (refusals > 0) {
          refusals -= 1
          throw coded('EBUSY')
        }
        await rename(from, to)
      },
    })
    await expect(readFile(target, 'utf8')).resolves.toBe('ok')
    expect(sleep.mock.calls).toEqual([[25]])
    await expect(
      writeFileAtomically(target, 'never', {
        sleep,
        rename: () => Promise.reject(coded('ENOSPC')),
      }),
    ).rejects.toThrow('ENOSPC')
    // The old content stands and the temporary file is gone.
    await expect(readFile(target, 'utf8')).resolves.toBe('ok')
    expect(await readdir(path.dirname(target))).toEqual(['b.txt'])
  })

  it('replaces the file a link leads to, never the link', async () => {
    // A stand-in link: Windows makes a file symbolic link only with a privilege.
    const folder = path.join(paths.root, 'linked')
    const real = path.join(folder, 'real.txt')
    const link = path.join(folder, 'link.txt')
    await writeFileAtomically(real, 'old', { sleep: noWait })
    await writeFileAtomically(link, 'new', {
      sleep: noWait,
      realPath: (target) => Promise.resolve(target === link ? real : target),
    })
    await expect(readFile(real, 'utf8')).resolves.toBe('new')
    expect(await readdir(folder)).toEqual(['real.txt'])
  })

  it.runIf(process.platform !== 'win32')(
    'keeps a real symbolic link and the permission bits of the file it replaces',
    async () => {
      const folder = path.join(paths.root, 'posix')
      const script = path.join(folder, 'run.sh')
      const link = path.join(folder, 'run-link.sh')
      await writeFileAtomically(script, 'echo old\n', { sleep: noWait })
      await chmod(script, 0o755)
      await symlink(script, link)
      await writeFileAtomically(link, 'echo new\n', { sleep: noWait })
      await expect(readFile(script, 'utf8')).resolves.toBe('echo new\n')
      const linkInfo = await lstat(link)
      const scriptInfo = await stat(script)
      expect(linkInfo.isSymbolicLink()).toBe(true)
      expect(scriptInfo.mode & 0o777).toBe(0o755)
    },
  )

  it('refuses a read-only file at once, leaving it as it was', async () => {
    const folder = path.join(paths.root, 'locked')
    const target = path.join(folder, 'c.txt')
    const sleep = vi.fn(() => Promise.resolve())
    await writeFileAtomically(target, 'kept', { sleep })
    await chmod(target, 0o444)
    try {
      await expect(writeFileAtomically(target, 'lost', { sleep })).rejects.toMatchObject({
        code: expect.stringMatching(/^(EACCES|EPERM)$/),
      })
      // Not a busy target: nothing is tried again.
      expect(sleep).not.toHaveBeenCalled()
      await expect(readFile(target, 'utf8')).resolves.toBe('kept')
      expect(await readdir(folder)).toEqual(['c.txt'])
    } finally {
      await chmod(target, 0o644)
    }
  })
})

describe('isSamePath (D27)', () => {
  it('ignores case and separators on Windows only', () => {
    expect(isSamePath(String.raw`C:\Ws\A.ts`, 'c:/ws/a.ts', 'win32')).toBe(true)
    expect(isSamePath(String.raw`C:\ws\a.ts`, String.raw`C:\ws\b.ts`, 'win32')).toBe(false)
    expect(isSamePath('/ws/A.ts', '/ws/a.ts', 'linux')).toBe(false)
    expect(isSamePath('/ws/./a.ts', '/ws/a.ts', 'darwin')).toBe(true)
  })
})
