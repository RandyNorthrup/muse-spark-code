import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { snapshot } from '../../scripts/check-visual.mjs'

it('fails a missing recorded revision and removes its incomplete source reconstruction', async () => {
  const parent = path.join(process.cwd(), 'temp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, 'm114-source-test-'))
  const scratch = path.join(root, 'temp')
  await mkdir(scratch)
  try {
    // Disk-backed private temp may be outside the checkout's Git discovery.
    execFileSync('git', ['init', '--quiet', root])
    await expect(snapshot(root, '0'.repeat(40))).rejects.toThrow('not a tree object')
    expect(await readdir(scratch)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
