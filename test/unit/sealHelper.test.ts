// The sealed helper over real files: a helper that cannot be read and
// one that changes under its self-test are both refused, never used.

import { mkdtempSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ResourceHelperChangedError,
  sealHelper,
  wasHelperChanged,
} from '../../src/host/backend/helperIntegrity'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-seal-helper-')))
afterAll(async () => {
  await removeFolder(base)
})

describe('sealHelper', () => {
  it('refuses a helper that cannot be read', async () => {
    const missing = path.join(base, 'missing.exe')
    let failure: unknown
    try {
      await sealHelper(missing, () => Promise.resolve())
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ResourceHelperChangedError)
    expect(wasHelperChanged(missing)).toBe(true)
  })

  it('refuses a helper that changes under its self-test', async () => {
    const file = path.join(base, 'shifty.exe')
    await writeFile(file, 'first')
    let failure: unknown
    try {
      await sealHelper(file, async () => {
        await writeFile(file, 'second')
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ResourceHelperChangedError)
  })
})
