import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

export function scratchDirectories(prefix: string): () => string {
  const folders: string[] = []
  afterAll(() => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true })
  })
  return () => {
    const folder = mkdtempSync(path.join(tmpdir(), prefix))
    folders.push(folder)
    return folder
  }
}
