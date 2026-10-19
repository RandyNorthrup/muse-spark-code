// readTextIfPresent over real files: a missing file reads as none, a file
// reads whole, and anything else (a directory) rejects instead of reading
// as none.

import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readTextIfPresent } from '../../src/host/fsAtomic'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-cli-features-')))
afterAll(async () => {
  await removeFolder(base)
})

describe('readTextIfPresent', () => {
  it('reads a missing file as none and a file as its text', async () => {
    expect(readTextIfPresent(path.join(base, 'missing.json'))).toBeUndefined()
    const file = path.join(base, 'settings.json')
    await writeFile(file, '{"a":1}')
    expect(readTextIfPresent(file)).toBe('{"a":1}')
  })

  it('rejects a directory instead of reading it as none', async () => {
    const directory = path.join(base, 'a-folder')
    await mkdir(directory)
    let failure: unknown
    try {
      readTextIfPresent(directory)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
  })
})
