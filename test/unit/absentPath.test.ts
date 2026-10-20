import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAbsentBelowFolder } from '../../src/core/fs/absentPath'
import { usingTempDir } from './helpers/temporaryFolders'

// Real folders and files on the running platform: Windows reports a path
// through a file as ENOENT, so absence is proven by the nearest ancestor.
describe('isAbsentBelowFolder', () => {
  it('reads a missing entry under a folder, at any depth, as absent', async () => {
    await usingTempDir('muse-absent-', (directory) => {
      expect(isAbsentBelowFolder(path.join(directory, 'record.json'))).toBe(true)
      expect(isAbsentBelowFolder(path.join(directory, 'a', 'b', 'record.json'))).toBe(true)
    })
  })

  it('never reads a path that runs through a file as absent', async () => {
    await usingTempDir('muse-absent-', async (directory) => {
      await mkdir(path.join(directory, 'store'))
      await writeFile(path.join(directory, 'store', 'feature'), 'not a folder')
      expect(isAbsentBelowFolder(path.join(directory, 'store', 'feature', 'record.json'))).toBe(
        false,
      )
      expect(
        isAbsentBelowFolder(path.join(directory, 'store', 'feature', 'deeper', 'record.json')),
      ).toBe(false)
    })
  })
})
