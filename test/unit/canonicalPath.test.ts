// The canonical path of a file that may not exist yet (D24), on the real
// file system: a junction (Windows, no privilege needed) or a symbolic link
// (elsewhere) inside a temporary folder, pointing outside it.

import { spawnSync } from 'node:child_process'
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
  await rm(path.join(paths.root, 'dangling'), { force: true })
  await removeFolder(paths.root)
  await removeFolder(paths.outside)
})

describe('canonicalPath', () => {
  it('returns an existing path as the file system names it', async () => {
    await expect(canonicalPath(path.join(paths.root, 'src'))).resolves.toBe(
      path.join(paths.root, 'src'),
    )
  })

  it('expands a Windows short alias before appending an existing or missing tail', async () => {
    const short =
      process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${paths.root}") do @echo %~sI`], {
            encoding: 'utf8',
            windowsVerbatimArguments: true,
          })
        : undefined
    if (short !== undefined) expect(short.status).toBe(0)
    const root = short?.stdout.trim() ?? paths.root
    await expect(canonicalPath(path.join(root, 'src'))).resolves.toBe(path.join(paths.root, 'src'))
    await expect(canonicalPath(path.join(root, 'src', 'new', 'a.ts'))).resolves.toBe(
      path.join(paths.root, 'src', 'new', 'a.ts'),
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

describe('canonicalPath and broken links (M83)', () => {
  it('follows a broken link to where it leads only when asked', async () => {
    await symlink(
      path.join(paths.outside, 'missing'),
      path.join(paths.root, 'dangling'),
      'junction',
    )
    const inside = path.join(paths.root, 'dangling', 'AGENTS.md')
    await expect(canonicalPath(inside)).resolves.toBe(inside)
    await expect(canonicalPath(inside, { followsBrokenLinks: true })).resolves.toBe(
      path.join(paths.outside, 'missing', 'AGENTS.md'),
    )
  })
})
