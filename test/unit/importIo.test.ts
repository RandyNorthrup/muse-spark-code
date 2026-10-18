// The import file access over real files: a missing path reads as
// absent, a file created between the check and the publish reads as
// existing, and a root that disappears refuses with its fixed code and
// the failure that proved it changed.

import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assertImportTarget, fileImportWriter, isPathPresent } from '../../src/host/importIo'
import { AGENT_IMPORT_ROOT_CHANGED_CODE } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-import-io-')))
afterAll(async () => {
  await removeFolder(base)
})

describe('isPathPresent', () => {
  it('tells a missing path from a file and from a broken link', async () => {
    const missing = path.join(base, 'missing.txt')
    await expect(isPathPresent(missing)).resolves.toBe(false)
    const file = path.join(base, 'present.txt')
    await writeFile(file, 'words')
    await expect(isPathPresent(file)).resolves.toBe(true)
    const dangling = path.join(base, 'dangling.txt')
    symlinkSync(missing, dangling)
    await expect(isPathPresent(dangling)).resolves.toBe(true)
  })
})

describe('createFile', () => {
  it('creates once, then reads an existing file as existing', async () => {
    const target = path.join(base, 'note.txt')
    await expect(fileImportWriter.createFile(target, 'first')).resolves.toBe('created')
    await expect(fileImportWriter.createFile(target, 'second')).resolves.toBe('exists')
  })

  it('reads a file that lands between the check and the publish as existing', async () => {
    const target = path.join(base, 'raced.txt')
    await expect(
      fileImportWriter.createFile(target, 'content', undefined, async () => {
        await writeFile(target, 'meanwhile')
      }),
    ).resolves.toBe('exists')
  })
})

describe('assertImportTarget', () => {
  it('refuses a root that disappeared, keeping the failure as its cause', async () => {
    const root = path.join(base, 'project')
    await mkdir(root)
    const project = {
      path: root,
      identity: await fileImportWriter.identifyRoot(root),
    }
    await rm(root, { recursive: true, force: true })
    let failure: unknown
    try {
      await assertImportTarget(path.join(root, 'note.txt'), project)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure instanceof Error && 'code' in failure ? failure.code : undefined).toBe(
      AGENT_IMPORT_ROOT_CHANGED_CODE,
    )
    const cause = failure instanceof Error ? failure.cause : undefined
    expect(
      typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined,
    ).toBe('ENOENT')
  })
})
