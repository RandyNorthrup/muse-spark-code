// The canonical path of a file that may not exist yet (D24), on the real
// file system: a junction (Windows, no privilege needed) or a symbolic link
// (elsewhere) inside a temporary folder, pointing outside it.

import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '', outside: '' }

beforeAll(async () => {
  paths.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-canon-')))
  paths.outside = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-canon-out-')))
  await mkdir(path.join(paths.root, 'src'))
  await symlink(paths.outside, path.join(paths.root, 'elsewhere'), 'junction')
})

afterAll(async () => {
  await rm(path.join(paths.root, 'elsewhere'), { force: true })
  await removeFolder(paths.root)
  await removeFolder(paths.outside)
})

describe('canonicalPath', () => {
  it('returns an existing path as the file system names it', async () => {
    await expect(canonicalPath(path.join(paths.root, 'src'))).resolves.toBe(
      path.join(paths.root, 'src'),
    )
  })

  it('appends the missing tail to the nearest existing ancestor', async () => {
    await expect(canonicalPath(path.join(paths.root, 'src', 'new', 'a.ts'))).resolves.toBe(
      path.join(paths.root, 'src', 'new', 'a.ts'),
    )
  })

  it('resolves a link on the way, even to a file that does not exist yet', async () => {
    await expect(canonicalPath(path.join(paths.root, 'elsewhere', 'new.txt'))).resolves.toBe(
      path.join(paths.outside, 'new.txt'),
    )
  })
})
