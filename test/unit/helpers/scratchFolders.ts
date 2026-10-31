import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach } from 'vitest'

/** Registers the cleanup and answers a maker of scratch folders under `base`, made when needed. */
export function useScratchFolders(base: string, prefix: string): () => Promise<string> {
  const folders: string[] = []
  afterEach(async () => {
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
  })
  return async () => {
    await mkdir(base, { recursive: true })
    const folder = await mkdtemp(path.join(base, prefix))
    folders.push(folder)
    return folder
  }
}
