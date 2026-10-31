// RLWINFIX item 2: process-tree reading works on Windows 11. The real
// shell-job assembly is built through the product's own builder into a
// temporary folder, and the real WindowsResourceTreeReader reads through
// the real job helper program (C#): this process's identity comes back, and a
// pid that cannot exist reads null, never a throw.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import { buildShellJobHelper } from './helpers/shellJobBuild'
import { removeFolder } from './helpers/temporaryFolders'

describe.runIf(process.platform === 'win32')('Windows tree reading', () => {
  let storageDir = ''
  let assembly = ''
  const systemRoot = process.env['SystemRoot'] ?? ''

  beforeAll(async () => {
    const built = await buildShellJobHelper('muse-tree-win-', systemRoot)
    storageDir = built.storageDir
    assembly = built.assembly
  }, 120_000)
  afterAll(async () => {
    await removeFolder(storageDir)
  })

  it('reads this process identity through the helper', async () => {
    const reader = new WindowsResourceTreeReader({ assemblyPath: assembly, systemRoot })
    const identity = await reader.identity(process.pid)
    expect(identity?.pid).toBe(process.pid)
    expect(identity?.startTime).toMatch(/^\d+$/)
  })

  it('reads an impossible pid as null, never a throw', async () => {
    const reader = new WindowsResourceTreeReader({ assemblyPath: assembly, systemRoot })
    await expect(reader.identity(2 ** 30)).resolves.toBeNull()
  })
})
