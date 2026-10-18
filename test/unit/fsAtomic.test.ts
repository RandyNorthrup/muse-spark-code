// Whole-file atomic writes over real files: a target that is gone reads
// as gone rather than broken, a taken name refuses without replacing, a
// held target is retried and then reported, and a failed write leaves no
// stage behind.

import { mkdtempSync, realpathSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createFileExclusively,
  deleteFileIfUnchanged,
  isNameTaken,
  isOwnedFile,
  renameReplacing,
  writeFileAtomically,
  writeFileIfUnchanged,
} from '../../src/host/fsAtomic'
import { lstatIdentity } from '../../src/core/fs/fileIdentity'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-fsatomic-')))
afterAll(async () => {
  await removeFolder(base)
})

const sleep = (ms: number) => delay(ms)
const missing = path.join(base, 'missing.txt')
const warnings: string[] = []

describe('isOwnedFile', () => {
  it('reads a missing file as not owned instead of failing', async () => {
    await expect(isOwnedFile(missing, await lstatIdentity(base))).resolves.toBe(false)
  })
})

describe('writeFileIfUnchanged', () => {
  it('leaves a gone target gone instead of recreating it', async () => {
    await expect(writeFileIfUnchanged(missing, 'fingerprint', 'content', { sleep })).resolves.toBe(
      'changed',
    )
    await expect(stat(missing)).rejects.toThrow()
  })

  it('replaces only the expected text', async () => {
    const target = path.join(base, 'conditional.txt')
    await writeFileAtomically(target, 'before', { sleep })
    await expect(writeFileIfUnchanged(target, 'other', 'after', { sleep })).resolves.toBe('changed')
    await expect(readFile(target, 'utf8')).resolves.toBe('before')
  })
})

describe('deleteFileIfUnchanged', () => {
  it('reads a gone target as already changed', async () => {
    await expect(
      deleteFileIfUnchanged(missing, 'fingerprint', {
        expectedCanonicalPath: missing,
        remove: (target) => rm(target),
      }),
    ).resolves.toBe('changed')
  })
})

describe('createFileExclusively', () => {
  it('refuses a taken name with the typed error instead of replacing', async () => {
    const target = path.join(base, 'exclusive.txt')
    const options = {
      mode: 0o600,
      warn: (message: string) => {
        warnings.push(message)
      },
    }
    await createFileExclusively(target, 'first', options)
    let failure: unknown
    try {
      await createFileExclusively(target, 'second', options)
    } catch (error: unknown) {
      failure = error
    }
    expect(isNameTaken(failure)).toBe(true)
    await expect(readFile(target, 'utf8')).resolves.toBe('first')
  })
})

describe('renameReplacing', () => {
  // POSIX permissions refuse the rename; Windows ACLs do not refuse the same way.
  it.runIf(process.platform !== 'win32')(
    'reports a persistently held target instead of retrying forever',
    async () => {
      const from = path.join(base, 'held-from.txt')
      await writeFile(from, 'held')
      const locked = path.join(base, 'locked-dir')
      await mkdir(locked)
      await chmod(locked, 0o555)
      let failure: unknown
      try {
        await renameReplacing(from, path.join(locked, 'held-to.txt'), { sleep })
      } catch (error: unknown) {
        failure = error
      } finally {
        await chmod(locked, 0o755)
      }
      const code =
        typeof failure === 'object' && failure !== null && 'code' in failure
          ? String(failure.code)
          : undefined
      expect(code).toBe('EACCES')
    },
  )
})

describe('writeFileAtomically', () => {
  it('removes its stage when the rename cannot land', async () => {
    const target = path.join(base, 'unstageable.txt')
    let failure: unknown
    try {
      await writeFileAtomically(target, 'content', {
        sleep,
        // A directory at the target refuses the rename, as a swapped folder would.
        staged: () => mkdir(target),
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    // The refusal stands, and no temporary file is left beside it.
    const info = await stat(target)
    expect(info.isDirectory()).toBe(true)
    const names = await readdir(base)
    expect(names.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
