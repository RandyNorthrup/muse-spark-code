// Temp roots for real-file tests: one root per call, all removed when the
// file finishes. Every test here drives the real file system, so every test
// needs its own directory without copying the bookkeeping.
import { mkdtemp, rm } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

export function fileRoots(): { fresh(prefix: string): Promise<string> } {
  const roots: string[] = []
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true })
  })
  return {
    fresh: async (prefix: string): Promise<string> => {
      const root = await mkdtemp(path.join(tmpdir(), prefix))
      roots.push(root)
      return root
    },
  }
}

/** The one `.jsonl` file under a root, found by shape rather than by path. */
export function findOnlyJsonlFile(root: string): string {
  const found: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name)
      if (statSync(file).isDirectory()) visit(file)
      else if (name.endsWith('.jsonl')) found.push(file)
    }
  }
  visit(root)
  if (found.length !== 1)
    throw new Error(`expected one journal file, found ${String(found.length)}`)
  return found[0]!
}
