import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import {
  applyFileStep,
  type FileStep,
  resolvedPath,
} from '../../src/host/checkpoints/checkpointFiles'
import {
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_REMOVE_RETRIES,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

// The file steps of a restore or Redo (M72, M86) over real folders: a folder
// link (a junction on Windows) is never followed, a file no longer as
// expected is never touched, an existing file's mode is kept and a
// recreated one gets the mode it had, a held file's deletion is retried.
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
/** What a step expects of a file: these bytes. */
const holding = (text: string) => ({ kind: 'blob' as const, oid: oidOf(text) })
const ABSENT = { kind: 'absent' as const }

function step(
  relative: string,
  target: FileStep['target'],
  expect: FileStep['expect'],
  folders: readonly string[] = [],
): FileStep {
  return { path: relative, target, expect, removeFolders: folders }
}

describe('applyFileStep (M72, M86)', () => {
  it('never deletes through a folder link', async () => {
    const { root, target } = await linkedWorkspace()
    const result = await applyFileStep(
      target,
      step('a/x.txt', null, holding('the user’s file\n')),
      undefined,
    )
    expect(result).toBe('linked')
    expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('the user’s file\n')
  })

  it('never writes through a folder link', async () => {
    const { root, target } = await linkedWorkspace()
    const result = await applyFileStep(
      target,
      step('a/x.txt', blob('overwritten\n'), holding('the user’s file\n')),
      Buffer.from('overwritten\n'),
    )
    expect(result).toBe('linked')
    expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('the user’s file\n')
  })

  it('resolves a path through no link to its spelling on disk, and none through a link', async () => {
    const { target } = await linkedWorkspace()
    expect(await resolvedPath(target, 'c/x.txt')).toBe('c/x.txt')
    expect(await resolvedPath(target, 'c/new.txt')).toBe('c/new.txt')
    expect(await resolvedPath(target, 'a/x.txt')).toBeUndefined()
  })

  it('leaves a file that is no longer as expected', async () => {
    const { root, target } = await linkedWorkspace()
    const file = 'c/x.txt'
    const changed = await applyFileStep(
      target,
      step(file, blob('restored\n'), holding('older\n')),
      Buffer.from('restored\n'),
    )
    const present = await applyFileStep(target, step(file, null, ABSENT), undefined)
    expect([changed, present]).toEqual(['changed', 'changed'])
    expect(await readFile(path.join(root, file), 'utf8')).toBe('the user’s file\n')
  })

  it('writes and deletes a file still as expected, removing the folders it names when empty', async () => {
    const { root, target } = await linkedWorkspace()
    await mkdir(path.join(root, 'made', 'deeper'), { recursive: true })
    await mkdir(path.join(root, 'kept'))
    await writeFile(path.join(root, 'made', 'deeper', 'n.txt'), 'new\n')
    await writeFile(path.join(root, 'kept', 'n.txt'), 'new\n')
    const deleted = await applyFileStep(
      target,
      step('made/deeper/n.txt', null, holding('new\n'), ['made/deeper', 'made']),
      undefined,
    )
    // A folder the step does not name stays, empty or not.
    const deletedKept = await applyFileStep(
      target,
      step('kept/n.txt', null, holding('new\n')),
      undefined,
    )
    const written = await applyFileStep(
      target,
      step('c/x.txt', blob('restored\n'), holding('the user’s file\n')),
      Buffer.from('restored\n'),
    )
    expect([deleted, deletedKept, written]).toEqual(['done', 'done', 'done'])
    await expect(stat(path.join(root, 'made'))).rejects.toThrow()
    const kept = await stat(path.join(root, 'kept'))
    expect(kept.isDirectory()).toBe(true)
    expect(await readFile(path.join(root, 'c', 'x.txt'), 'utf8')).toBe('restored\n')
  })

  it('stops removing folders at the first one that is not empty', async () => {
    const { root, target } = await linkedWorkspace()
    await mkdir(path.join(root, 'made', 'deeper'), { recursive: true })
    await writeFile(path.join(root, 'made', 'deeper', 'n.txt'), 'new\n')
    await writeFile(path.join(root, 'made', 'the-user’s.txt'), 'theirs\n')
    const deleted = await applyFileStep(
      target,
      step('made/deeper/n.txt', null, holding('new\n'), ['made/deeper', 'made']),
      undefined,
    )
    expect(deleted).toBe('done')
    await expect(stat(path.join(root, 'made', 'deeper'))).rejects.toThrow()
    expect(await readFile(path.join(root, 'made', 'the-user’s.txt'), 'utf8')).toBe('theirs\n')
  })

  it.skipIf(process.platform === 'win32')(
    'L: keeps an existing file’s own mode whatever the target’s, and gives a recreated file the mode it had',
    async () => {
      const { root, target } = await linkedWorkspace()
      const file = path.join(root, 'c', 'x.txt')
      await chmod(file, 0o600)
      expect(
        await applyFileStep(
          target,
          step('c/x.txt', blob('script\n', GIT_MODE_EXECUTABLE), holding('the user’s file\n')),
          Buffer.from('script\n'),
        ),
      ).toBe('done')
      const own = await stat(file)
      expect(own.mode & 0o777).toBe(0o600)
      await rm(file)
      expect(
        await applyFileStep(
          target,
          step('c/x.txt', blob('script\n', GIT_MODE_EXECUTABLE), ABSENT),
          Buffer.from('script\n'),
        ),
      ).toBe('done')
      const recreated = await stat(file)
      expect(recreated.mode & 0o100).not.toBe(0)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'L: restores a file whose execute bit changed since, its bytes as expected',
    async () => {
      const { root, target } = await linkedWorkspace()
      const file = path.join(root, 'c', 'x.txt')
      await chmod(file, 0o755)
      const result = await applyFileStep(
        target,
        step('c/x.txt', blob('restored\n'), holding('the user’s file\n')),
        Buffer.from('restored\n'),
      )
      expect(result).toBe('done')
      expect(await readFile(file, 'utf8')).toBe('restored\n')
      const changed = await stat(file)
      expect(changed.mode & 0o777).toBe(0o755)
    },
  )

  it('refuses a file now over the size limit as too large to compare, and leaves it', async () => {
    const { root, target } = await linkedWorkspace()
    const big = path.join(root, 'c', 'big.bin')
    await writeFile(big, Buffer.alloc(CHECKPOINT_FILE_MAX_BYTES + 1))
    const result = await applyFileStep(
      target,
      step('c/big.bin', null, holding('small\n')),
      undefined,
    )
    expect(result).toBe('tooLarge')
    const held = await stat(big)
    expect(held.size).toBe(CHECKPOINT_FILE_MAX_BYTES + 1)
  })

  it('Y: retries a deletion while another program holds the file, and deletes it', async () => {
    const { root } = await linkedWorkspace()
    await writeFile(path.join(root, 'held.txt'), 'held\n')
    let attempts = 0
    const target = {
      workspaceRoot: root,
      platform: process.platform,
      log: new FakeLogOutputChannel(),
      sleep: () => Promise.resolve(),
      remove: async (absolute: string) => {
        attempts += 1
        if (attempts < 3) {
          throw Object.assign(new Error('injected busy file'), {
            code: attempts === 1 ? 'EBUSY' : 'EPERM',
          })
        }
        await rm(absolute)
      },
    }
    expect(await applyFileStep(target, step('held.txt', null, holding('held\n')), undefined)).toBe(
      'done',
    )
    expect(attempts).toBe(3)
    expect(existsSync(path.join(root, 'held.txt'))).toBe(false)
  })

  it('Y: gives up a held deletion after its retries, and stops when the file changed meanwhile', async () => {
    const { root } = await linkedWorkspace()
    const file = path.join(root, 'held.txt')
    await writeFile(file, 'held\n')
    let attempts = 0
    const busy = (code: string) => ({
      workspaceRoot: root,
      platform: process.platform,
      log: new FakeLogOutputChannel(),
      sleep: () => Promise.resolve(),
      remove: () => {
        attempts += 1
        return Promise.reject(Object.assign(new Error('injected held file'), { code }))
      },
    })
    expect(
      await applyFileStep(busy('EBUSY'), step('held.txt', null, holding('held\n')), undefined),
    ).toBe('failed')
    expect(attempts).toBe(CHECKPOINT_REMOVE_RETRIES + 1)
    attempts = 0
    const changing = {
      ...busy('EBUSY'),
      sleep: async () => {
        await writeFile(file, 'changed while held\n')
      },
    }
    expect(
      await applyFileStep(changing, step('held.txt', null, holding('held\n')), undefined),
    ).toBe('changed')
    expect(attempts).toBe(1)
    expect(await readFile(file, 'utf8')).toBe('changed while held\n')
  })
})

/** Whether the temporary folder's volume tells `a` from `A`. */
function isCaseSensitiveVolume(): boolean {
  const probe = path.join(base, `case-${randomUUID()}`)
  writeFileSync(probe, 'probe')
  return !existsSync(probe.toUpperCase())
}

/** A workspace holding `Foo/x.txt` with the user's text. */
async function workspaceWithFoo(): Promise<string> {
  const root = path.join(base, randomUUID())
  await mkdir(path.join(root, 'Foo'), { recursive: true })
  await writeFile(path.join(root, 'Foo', 'x.txt'), 'the user’s file\n')
  return root
}

describe('a restore on a volume that tells letter case apart (M72)', () => {
  it.skipIf(!isCaseSensitiveVolume())(
    'never writes through a link that differs from its target only in letter case',
    async () => {
      const root = await workspaceWithFoo()
      await symlink(path.join(root, 'Foo'), path.join(root, 'foo'), 'dir')
      // macOS offers case-sensitive volumes too: the restore must not fold case blindly.
      const target = {
        workspaceRoot: root,
        platform: 'darwin' as const,
        log: new FakeLogOutputChannel(),
      }
      const result = await applyFileStep(
        target,
        step('foo/x.txt', blob('overwritten\n'), holding('the user’s file\n')),
        Buffer.from('overwritten\n'),
      )
      expect(result).toBe('linked')
      expect(await readFile(path.join(root, 'Foo', 'x.txt'), 'utf8')).toBe('the user’s file\n')
    },
  )

  it.skipIf(isCaseSensitiveVolume())(
    'still writes a file named in another letter case on a volume that folds it',
    async () => {
      const root = await workspaceWithFoo()
      const target = {
        workspaceRoot: root,
        platform: process.platform,
        log: new FakeLogOutputChannel(),
      }
      const result = await applyFileStep(
        target,
        step('foo/X.TXT', blob('restored\n'), holding('the user’s file\n')),
        Buffer.from('restored\n'),
      )
      expect(result).toBe('done')
      expect(await readFile(path.join(root, 'Foo', 'x.txt'), 'utf8')).toBe('restored\n')
      expect(await resolvedPath(target, 'foo/X.TXT')).toBe('Foo/x.txt')
    },
  )
})
