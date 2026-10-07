import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'

/** Each engine suite releases its real owners before removing their canonical temporary files. */
export function engineFixtures() {
  const owners = new Set<{ dispose(): Promise<void> }>()
  const folders = new Set<string>()
  afterEach(async () => {
    await Promise.all(Array.from(owners, (owner) => owner.dispose()))
    owners.clear()
    await Promise.all(Array.from(folders, (folder) => rm(folder, { recursive: true, force: true })))
    folders.clear()
  })
  return {
    folder: async (prefix: string) => {
      const folder = realpathSync.native(await mkdtemp(path.join(tmpdir(), prefix)))
      folders.add(folder)
      return folder
    },
    own: <T extends { dispose(): Promise<void> }>(owner: T): T => {
      owners.add(owner)
      return owner
    },
  }
}
