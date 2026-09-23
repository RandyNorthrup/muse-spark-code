import { mkdtemp, readdir, readFile, rename } from 'node:fs/promises'
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
})

describe('isSamePath (D27)', () => {
  it('ignores case and separators on Windows only', () => {
    expect(isSamePath(String.raw`C:\Ws\A.ts`, 'c:/ws/a.ts', 'win32')).toBe(true)
    expect(isSamePath(String.raw`C:\ws\a.ts`, String.raw`C:\ws\b.ts`, 'win32')).toBe(false)
    expect(isSamePath('/ws/A.ts', '/ws/a.ts', 'linux')).toBe(false)
    expect(isSamePath('/ws/./a.ts', '/ws/a.ts', 'darwin')).toBe(true)
  })
})
