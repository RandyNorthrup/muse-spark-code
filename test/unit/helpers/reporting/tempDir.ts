import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** One developer-audit rotation file under a fixture data dir. */
export async function writeDeveloperAudit(
  dataDir: string,
  file: string,
  lines: readonly string[],
): Promise<void> {
  await mkdir(path.join(dataDir, 'developer'), { recursive: true })
  await writeFile(path.join(dataDir, 'developer', file), lines.join(''))
}

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
