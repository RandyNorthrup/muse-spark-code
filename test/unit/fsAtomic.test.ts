import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createFileExclusively,
  isNameTaken,
  writeFileAtomically,
  writeFileIfUnchanged,
} from '../../src/host/fsAtomic'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { isSamePath } from '../../src/core/paths'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '' }

beforeAll(async () => {
  paths.root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-atomic-')))
})

afterAll(() => removeFolder(paths.root))

const noWait = () => Promise.resolve()

/** A file-system error with its code, as Node raises one. */
function coded(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('writeFileAtomically (D27)', () => {
  it('rechecks its owner after a busy publication attempt without replacing the target', async () => {
    const folder = path.join(paths.root, 'owner-atomic-retry')
    await mkdir(folder)
    const target = path.join(folder, 'note.txt')
    await writeFile(target, 'before')
    let isCurrent = true
    let attempts = 0
    await expect(
      writeFileAtomically(target, 'after', {
        sleep: noWait,
        assertCanWrite: () => {
          if (!isCurrent) {
            throw new Error('workspace owner changed')
          }
        },
        rename: async (from, to) => {
          attempts += 1
          if (attempts === 1) {
            isCurrent = false
            throw coded('EBUSY')
          }
          await rename(from, to)
        },
      }),
    ).rejects.toThrow('workspace owner changed')
    expect(attempts).toBe(1)
    await expect(readFile(target, 'utf8')).resolves.toBe('before')
    expect(await readdir(folder)).toEqual(['note.txt'])
  })

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

// The one conditional write (M68; the Codex review of PR #54, third round).
describe('writeFileIfUnchanged', () => {
  it('replaces the file only while it holds the expected text', async () => {
    const target = path.join(paths.root, 'conditional', 'c.txt')
    await writeFileAtomically(target, 'as edited', { sleep: noWait })
    await expect(
      writeFileIfUnchanged(target, fingerprint('as edited'), 'formatted', { sleep: noWait }),
    ).resolves.toBe('written')
    await expect(readFile(target, 'utf8')).resolves.toBe('formatted')
    await expect(
      writeFileIfUnchanged(target, fingerprint('as edited'), 'again', { sleep: noWait }),
    ).resolves.toBe('changed')
    await expect(readFile(target, 'utf8')).resolves.toBe('formatted')
    // A file that is gone is not what was expected either.
    await expect(
      writeFileIfUnchanged(path.join(paths.root, 'conditional', 'gone.txt'), fingerprint(''), 'x', {
        sleep: noWait,
      }),
    ).resolves.toBe('changed')
    expect(await readdir(path.dirname(target))).toEqual(['c.txt'])
    // Nor is a file whose folder is gone, and the folder is not made again.
    const removed = path.join(paths.root, 'conditional', 'removed')
    await expect(
      writeFileIfUnchanged(path.join(removed, 'e.txt'), fingerprint(''), 'x', { sleep: noWait }),
    ).resolves.toBe('changed')
    await expect(stat(removed)).rejects.toThrow('ENOENT')
  })

  it('asks its last word right before the rename, and leaves the file when told no', async () => {
    const target = path.join(paths.root, 'conditional', 'f.txt')
    await writeFileAtomically(target, 'as edited', { sleep: noWait })
    await expect(
      writeFileIfUnchanged(target, fingerprint('as edited'), 'formatted', {
        sleep: noWait,
        isReplaceable: () => false,
      }),
    ).resolves.toBe('changed')
    await expect(readFile(target, 'utf8')).resolves.toBe('as edited')
  })

  it('compares immediately before each rename, so a change during the write stands', async () => {
    const target = path.join(paths.root, 'conditional', 'd.txt')
    await writeFileAtomically(target, 'as edited', { sleep: noWait })
    let refusals = 1
    const wrote = await writeFileIfUnchanged(target, fingerprint('as edited'), 'formatted', {
      sleep: noWait,
      rename: async (from, to) => {
        if (refusals > 0) {
          // The first attempt is refused, and meanwhile someone writes the file.
          refusals -= 1
          await writeFile(target, 'someone else')
          throw coded('EBUSY')
        }
        await rename(from, to)
      },
    })
    expect(wrote).toBe('changed')
    await expect(readFile(target, 'utf8')).resolves.toBe('someone else')
    const names = await readdir(path.dirname(target))
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(['c.txt', 'd.txt', 'f.txt'])
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

const quiet = () => undefined

/** What a promise rejected with; a promise that resolves fails the test. */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected a failure')
}

describe('createFileExclusively (M79)', () => {
  it('rechecks its owner after awaited staging before publishing a private new file', async () => {
    const folder = path.join(paths.root, 'owner-final-publication')
    const target = path.join(folder, 'note.md')
    let isCurrent = true
    await expect(
      createFileExclusively(target, 'private bytes', {
        mode: 0o666,
        warn: quiet,
        assertCanWrite: () => {
          if (!isCurrent) {
            throw new Error('workspace owner changed')
          }
        },
        staged: async () => {
          await Promise.resolve()
          isCurrent = false
        },
      }),
    ).rejects.toThrow('workspace owner changed')
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(folder)).toEqual([])
  })

  it('publishes a new file and names a taken name as such, leaving the old file and no stage', async () => {
    const target = path.join(paths.root, 'new', 'plan.md')
    await createFileExclusively(target, 'first', { mode: 0o666, warn: quiet })
    const taken = createFileExclusively(target, 'second', { mode: 0o666, warn: quiet })
    await expect(taken).rejects.toMatchObject({ code: 'EEXIST' })
    expect(isNameTaken(await failureOf(taken))).toBe(true)
    await expect(readFile(target, 'utf8')).resolves.toBe('first')
    expect(await readdir(path.dirname(target))).toEqual(['plan.md'])
  })

  it('says a file where the folder should be is not a folder, never that the name is taken', async () => {
    const blocker = path.join(paths.root, 'blocked')
    await createFileExclusively(blocker, 'a file', { mode: 0o666, warn: quiet })
    const failed = await failureOf(
      createFileExclusively(path.join(blocker, 'plan.md'), 'x', { mode: 0o666, warn: quiet }),
    )
    expect(String(failed)).toMatch(/is not a folder/)
    expect(isNameTaken(failed)).toBe(false)
  })

  it('refuses a folder that leads elsewhere than the checked one, writing nothing there', async () => {
    const real = path.join(paths.root, 'real-plans')
    const elsewhere = path.join(paths.root, 'elsewhere')
    await createFileExclusively(path.join(elsewhere, 'keep.md'), 'keep', {
      mode: 0o666,
      warn: quiet,
    })
    const link = path.join(paths.root, 'swapped')
    await symlink(elsewhere, link, 'junction')
    // The folder was checked as `real-plans`; it now is a junction to `elsewhere`.
    const stages = vi.fn((stage: string) => rm(stage, { force: true }))
    const refused = createFileExclusively(path.join(link, 'plan.md'), 'x', {
      mode: 0o666,
      expectedDirectory: real,
      warn: quiet,
      remove: stages,
    })
    await expect(refused).rejects.toThrow(/now leads elsewhere/)
    expect(await readdir(elsewhere)).toEqual(['keep.md'])
    // Refused before a stage was written there, not after.
    expect(stages).not.toHaveBeenCalled()
  })

  it('refuses a folder swapped for a junction once the stage is written, publishing nothing', async () => {
    const folder = path.join(paths.root, 'late-swap')
    const elsewhere = path.join(paths.root, 'late-elsewhere')
    await createFileExclusively(path.join(elsewhere, 'keep.md'), 'keep', {
      mode: 0o666,
      warn: quiet,
    })
    const refused = createFileExclusively(path.join(folder, 'plan.md'), 'x', {
      mode: 0o666,
      warn: quiet,
      staged: async () => {
        await rename(folder, `${folder}-moved`)
        await symlink(elsewhere, folder, 'junction')
      },
    })
    await expect(refused).rejects.toThrow(/now leads elsewhere/)
    expect(await readdir(elsewhere)).toEqual(['keep.md'])
  })

  it('refuses a swapped ancestor before mkdir can create an outside plans folder', async () => {
    const workspace = path.join(paths.root, 'pre-mkdir-workspace')
    const ancestor = path.join(workspace, '.agents')
    const elsewhere = path.join(paths.root, 'pre-mkdir-elsewhere')
    await mkdir(ancestor, { recursive: true })
    await mkdir(elsewhere)
    const checkedDirectory = path.join(ancestor, 'plans')
    await rename(ancestor, `${ancestor}-moved`)
    await symlink(elsewhere, ancestor, 'junction')
    await expect(
      createFileExclusively(path.join(checkedDirectory, 'plan.md'), 'plan bytes', {
        mode: 0o666,
        warn: quiet,
        expectedDirectory: checkedDirectory,
      }),
    ).rejects.toThrow(/now leads elsewhere/)
    expect(await readdir(elsewhere)).toEqual([])
    await expect(lstat(path.join(elsewhere, 'plans'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a replaced stage before publication and leaves the replacement untouched', async () => {
    const folder = path.join(paths.root, 'replaced-stage')
    const target = path.join(folder, 'plan.md')
    let stageName = ''
    await expect(
      createFileExclusively(target, 'approved bytes', {
        mode: 0o666,
        warn: quiet,
        staged: async () => {
          const [name] = await readdir(folder)
          if (name === undefined) {
            throw new Error('expected the owned stage')
          }
          stageName = name
          const stage = path.join(folder, name)
          await rename(stage, `${stage}-moved`)
          await writeFile(stage, 'replacement bytes')
        },
      }),
    ).rejects.toThrow()
    await expect(readFile(path.join(folder, stageName), 'utf8')).resolves.toBe('replacement bytes')
    await expect(readFile(path.join(folder, `${stageName}-moved`), 'utf8')).resolves.toBe(
      'approved bytes',
    )
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves both a moved owned stage and a same-name foreign file behind a swapped folder', async () => {
    const folder = path.join(paths.root, 'cleanup-owned-folder')
    const moved = `${folder}-moved`
    const elsewhere = path.join(paths.root, 'cleanup-foreign-folder')
    await mkdir(elsewhere)
    let stageName = ''
    await expect(
      createFileExclusively(path.join(folder, 'plan.md'), 'approved bytes', {
        mode: 0o666,
        warn: quiet,
        staged: async () => {
          const [name] = await readdir(folder)
          if (name === undefined) {
            throw new Error('expected the owned stage')
          }
          stageName = name
          await rename(folder, moved)
          await writeFile(path.join(elsewhere, name), 'foreign bytes')
          await symlink(elsewhere, folder, 'junction')
        },
      }),
    ).rejects.toThrow(/now leads elsewhere/)
    await expect(readFile(path.join(elsewhere, stageName), 'utf8')).resolves.toBe('foreign bytes')
    await expect(readFile(path.join(moved, stageName), 'utf8')).resolves.toBe('approved bytes')
    await expect(lstat(path.join(elsewhere, 'plan.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes a held stage again, and says whether the file was published when it cannot', async () => {
    const target = path.join(paths.root, 'held', 'plan.md')
    let refusals = 2
    const sleep = vi.fn(() => Promise.resolve())
    const warn = vi.fn()
    await createFileExclusively(target, 'ok', {
      mode: 0o666,
      warn,
      sleep,
      remove: async (stage) => {
        if (refusals > 0) {
          refusals -= 1
          throw coded('EBUSY')
        }
        await rm(stage, { force: true })
      },
    })
    expect(warn).not.toHaveBeenCalled()
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(await readdir(path.dirname(target))).toEqual(['plan.md'])
    const stuck = path.join(paths.root, 'stuck', 'plan.md')
    await createFileExclusively(stuck, 'ok', {
      mode: 0o666,
      warn,
      sleep,
      remove: () => Promise.reject(coded('EPERM')),
    })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[1]).toBe(true)
    await expect(readFile(stuck, 'utf8')).resolves.toBe('ok')
  })
})
