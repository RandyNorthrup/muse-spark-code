import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Per-file temporary directories with one cleanup call for afterEach. */
export function tempDirTracker() {
  const roots: string[] = []
  return {
    dir: async (prefix: string): Promise<string> => {
      const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
      roots.push(root)
      return root
    },
    cleanup: async (): Promise<void> => {
      for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
    },
  }
}
