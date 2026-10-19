// The browser check's folders (src/host/browser/browserProcess.ts): each
// check gets a private folder with its owner's pid; a dead owner's folder
// is swept by a later check, a live (or unknown) owner's is kept; an
// unreadable executable reads as absent.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostBrowserRunDeps, type HostBrowserDeps } from '../../src/host/browser/browserProcess'
import { BROWSER_CHECK_DIR, BROWSER_CHECK_OWNER_FILE } from '../../src/shared/browserCheckConstants'

function deps(warnings: string[]): HostBrowserDeps {
  return {
    platform: process.platform,
    env: process.env,
    warn: (fact) => {
      warnings.push(fact)
    },
  }
}

describe('browserProcess folders', () => {
  it('creates a private folder carrying its own pid', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'browser-check-'))
    try {
      const run = hostBrowserRunDeps(deps([]))
      const folder = await run.createFolder(storage)
      expect(folder.root.startsWith(path.join(storage, BROWSER_CHECK_DIR))).toBe(true)
      expect(existsSync(folder.profile)).toBe(true)
      expect(existsSync(folder.temp)).toBe(true)
      expect(existsSync(folder.home)).toBe(true)
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('sweeps a dead owner folder and keeps a live one', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'browser-check-'))
    try {
      const parent = path.join(storage, BROWSER_CHECK_DIR)
      await mkdir(parent, { recursive: true })
      const dead = path.join(parent, 'stale-dead')
      await mkdir(dead, { recursive: true })
      await writeFile(path.join(dead, BROWSER_CHECK_OWNER_FILE), '4194303\n')
      const live = path.join(parent, 'stale-live')
      await mkdir(live, { recursive: true })
      await writeFile(path.join(live, BROWSER_CHECK_OWNER_FILE), `${String(process.pid)}\n`)
      const run = hostBrowserRunDeps(deps([]))
      await run.createFolder(storage)
      expect(existsSync(dead)).toBe(false)
      expect(existsSync(live)).toBe(true)
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('keeps a folder whose owner cannot be read', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'browser-check-'))
    try {
      const parent = path.join(storage, BROWSER_CHECK_DIR)
      await mkdir(parent, { recursive: true })
      const unreadable = path.join(parent, 'stale-unreadable')
      await mkdir(unreadable, { recursive: true })
      await mkdir(path.join(unreadable, BROWSER_CHECK_OWNER_FILE))
      const run = hostBrowserRunDeps(deps([]))
      await run.createFolder(storage)
      expect(existsSync(unreadable)).toBe(true)
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('reads an unreadable executable as absent', async () => {
    const run = hostBrowserRunDeps(deps([]))
    await expect(
      run.statExecutable(path.join(tmpdir(), 'no-such-browser-executable')),
    ).resolves.toBeUndefined()
  })

  it('removes a check folder', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'browser-check-'))
    try {
      const warnings: string[] = []
      const run = hostBrowserRunDeps(deps(warnings))
      const folder = await run.createFolder(storage)
      await run.removeFolder(folder)
      expect(existsSync(folder.root)).toBe(false)
      expect(warnings).toEqual([])
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('throws when the storage folder cannot be made', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'browser-check-'))
    try {
      await writeFile(path.join(storage, 'blocked'), 'a file, not a folder\n')
      const run = hostBrowserRunDeps(deps([]))
      await expect(run.createFolder(path.join(storage, 'blocked'))).rejects.toThrow()
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })
})
