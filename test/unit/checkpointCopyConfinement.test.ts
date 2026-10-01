import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captured,
  harness,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

/** The contents of every file below a folder, with the folder missing allowed. */
async function everythingBelow(folder: string): Promise<string[]> {
  const contents: string[] = []
  let names: string[]
  try {
    names = await readdir(folder, { recursive: true })
  } catch {
    return contents
  }
  for (const name of names) {
    try {
      contents.push(await readFile(path.join(folder, name), 'utf8'))
    } catch {
      // A folder, not a file.
    }
  }
  return contents
}

describe('a checkpoint copy of a tool target (M72)', () => {
  it(
    'is refused, and nothing is kept, when a parent folder is a link out of the workspace',
    async () => {
      const h = await harness()
      const outside = path.join(path.dirname(h.top), 'outside')
      await mkdir(outside)
      await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE SECRET\n')
      await symlink(
        outside,
        path.join(h.root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      await write(h.root, 'inside.txt', 'inside\n')
      await captured(h.store)
      await h.store.markTurn('pending:t1', true, true)
      await expect(
        h.store.beforeToolWrite(path.join(h.root, 'linked', 'secret.txt')),
      ).rejects.toThrow()
      expect(await everythingBelow(h.storage)).not.toContain('OUTSIDE SECRET\n')
      // An ordinary file in the workspace is still copied.
      await expect(
        h.store.beforeToolWrite(path.join(h.root, 'inside.txt')),
      ).resolves.toBeUndefined()
      expect(await everythingBelow(path.join(h.storage, 'staging'))).toContain('inside\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
