// RLWINFIX item 2: process-tree reading works on Windows 11. The real
// shell-job assembly is built through the product's own builder into a
// temporary folder, and the real WindowsResourceTreeReader reads through
// the real PowerShell and C#: this process's identity comes back, and a
// pid that cannot exist reads null, never a throw.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { runProgram } from '../../src/host/processTree'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

describe.runIf(process.platform === 'win32')('Windows tree reading', () => {
  let storageDir = ''
  let assembly = ''
  const buildLog: string[] = []
  const systemRoot = process.env['SystemRoot'] ?? ''

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'muse-tree-win-'))
    const built = await shellJobAssembly({
      storageDir,
      systemRoot,
      log: (message) => {
        buildLog.push(message)
      },
      readJobSource,
      // The real execFile runner: the default governed compiler needs a
      // configured resource host, which a bare test process has none of.
      run: runProgram,
    })()
    if (built === undefined)
      throw new Error(`the shell-job helper did not build here: ${buildLog.join('; ')}`)
    assembly = built
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
