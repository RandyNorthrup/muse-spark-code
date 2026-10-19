// Workspace confinement failures (D119): a malformed URL and bad
// percent-encoding are not valid file URLs; a path the file system cannot
// resolve names its failure; a refusal keeps its kind past the confinement.
import { mkdtempSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  confineWorkspacePath,
  resolveWorkspacePath,
  type RealPathIo,
} from '../../src/core/workspacePath'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const io: RealPathIo = {
  realPath: (absolutePath: string) => realpath(absolutePath),
}

describe('workspace confinement failures', () => {
  it('refuses a malformed URL in fixed words', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-workspace-path-'))
    roots.push(root)
    expect(resolveWorkspacePath(root, 'file://%zz', process.platform)).toEqual({
      ok: false,
      reason: 'path file://%zz is not a valid file URL',
    })
  })

  it('refuses bad percent-encoding in fixed words', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-workspace-path-'))
    roots.push(root)
    expect(resolveWorkspacePath(root, 'file:///ws/%zz', process.platform)).toEqual({
      ok: false,
      reason: 'path file:///ws/%zz is not a valid file URL',
    })
  })

  it('names a path the file system cannot resolve', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-workspace-path-'))
    roots.push(root)
    const confined = await confineWorkspacePath(root, 'missing.txt', process.platform, io)
    expect(confined.ok).toBe(false)
    if (!confined.ok) {
      expect(confined.reason.startsWith('path missing.txt could not be resolved:')).toBe(true)
    }
  })

  it('lets a refusal keep its kind past the confinement', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-workspace-path-'))
    roots.push(root)
    const refusal = new Error('refused')
    const refusing: RealPathIo = {
      realPath: () => Promise.reject(refusal),
    }
    let failure: unknown
    try {
      await confineWorkspacePath(root, 'note.txt', process.platform, refusing)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBe(refusal)
  })
})
