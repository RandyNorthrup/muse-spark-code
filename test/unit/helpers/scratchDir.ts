import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** A temporary directory, recorded so `removeScratchDirs` can delete it. */
export async function trackScratch(roots: string[], prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** Delete every directory `trackScratch` recorded, then forget the list. */
export async function removeScratchDirs(roots: string[]): Promise<void> {
  await Promise.all(
    roots.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
}
