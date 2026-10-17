// Scratch folders a suite removes after each test, shared so the
// per-file cleanup blocks do not duplicate.
import { rm } from 'node:fs/promises'
import { afterEach, vi } from 'vitest'

export function trackTempRoots(): { readonly roots: string[] } {
  const roots: string[] = []
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })
  return { roots }
}
