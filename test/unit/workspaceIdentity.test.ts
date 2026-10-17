// The physical identity of a workspace folder (M70; the ACP agent's hosts use
// it too): real directories, links and junctions on this machine's file
// system, replaced and retargeted under a captured identity.

import { mkdtempSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { captureWorkspaceIdentity } from '../../src/host/workspaceIdentity'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-identity-')))
const LINK = process.platform === 'win32' ? 'junction' : 'dir'

afterAll(async () => {
  await removeFolder(base)
})

async function folder(name: string): Promise<string> {
  const made = path.join(base, name)
  await mkdir(made)
  return made
}

describe('captureWorkspaceIdentity', () => {
  it('names a directory by its canonical path and its device and inode, and stays current while it is that directory', async () => {
    const root = await folder('plain')
    const identity = await captureWorkspaceIdentity(root)
    expect(identity?.canonical).toBe(root)
    expect(identity?.key).toMatch(/^\d+:\d+$/)
    expect(identity?.isCurrent()).toBe(true)
  })

  it('is no longer current when another directory replaces it at the same path', async () => {
    const root = await folder('replaced')
    const identity = await captureWorkspaceIdentity(root)
    await rename(root, `${root}-retired`)
    await mkdir(root)
    expect(identity?.isCurrent()).toBe(false)
  })

  it('is no longer current when a link to it is retargeted, though the path still resolves', async () => {
    const first = await folder('first')
    const second = await folder('second')
    const alias = path.join(base, 'alias')
    symlinkSync(first, alias, LINK)
    const identity = await captureWorkspaceIdentity(alias)
    expect(identity?.canonical).toBe(first)
    expect(identity?.isCurrent()).toBe(true)
    unlinkSync(alias)
    symlinkSync(second, alias, LINK)
    expect(identity?.isCurrent()).toBe(false)
  })

  it('is no longer current when the directory is gone', async () => {
    const root = await folder('gone')
    const identity = await captureWorkspaceIdentity(root)
    await rename(root, `${root}-moved`)
    expect(identity?.isCurrent()).toBe(false)
  })

  it('gives no identity to a file, and rejects a path it cannot read at all', async () => {
    const file = path.join(base, 'a-file.txt')
    await writeFile(file, 'not a folder')
    await expect(captureWorkspaceIdentity(file)).resolves.toBeUndefined()
    await expect(captureWorkspaceIdentity(path.join(base, 'missing'))).rejects.toThrow()
  })
})
