// RLWINFIX item 5: a stale MCP job executable a live process has loaded
// retires when that process ends instead of warning on every start. Real
// code throughout: the real sweep over the real filesystem, with the hold
// made by a real process running the stale copy, and the exit hook driven
// by the real compiled launcher starting a real payload.
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { realpathSync } from 'node:fs'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { jobFileName, removeStaleJobs, retireStaleJobs } from '../../src/host/backend/jobBuild'
import { MCP_JOB_BUILD, sealedMcpJobExecutable } from '../../src/host/backend/mcpJobExecutable'
import { spawnMcpJob } from '../../src/host/backend/mcpJobLaunch'
import { runProgram } from '../../src/host/processTree'
import { noWorkspaceChildEnvironment } from '../../src/core/execGuard'
import { readJobSource } from './helpers/jobSource'

function systemRoot(): string {
  const root = process.env['SystemRoot']
  if (root === undefined) throw new Error('Windows has no SystemRoot')
  return root
}

async function settled(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await once(child, 'exit')
}

async function gone(file: string): Promise<void> {
  for (let waited = 0; waited < 100; waited += 1) {
    try {
      await stat(file)
    } catch {
      return
    }
    await delay(50)
  }
  throw new Error('the retired file is still there')
}

describe.runIf(process.platform === 'win32')('MCP job executable retirement', () => {
  it('a loaded build waits silently and retires once freed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-mcp-retire-'))
    try {
      const currentName = jobFileName(MCP_JOB_BUILD, 'csharp-source-v2')
      const staleName = jobFileName(MCP_JOB_BUILD, 'csharp-source-v1')
      const current = path.join(dir, currentName)
      const stale = path.join(dir, staleName)
      await writeFile(current, '')
      await copyFile(path.join(systemRoot(), 'System32', 'cmd.exe'), stale)
      const logs: string[] = []
      const log = (message: string): void => {
        logs.push(message)
      }
      const holder = spawn(stale, ['/c', 'ping', '-n', '20', '127.0.0.1'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      await once(holder, 'spawn')
      try {
        await removeStaleJobs(MCP_JOB_BUILD, current, log, () =>
          Promise.resolve('csharp-source-v2'),
        )
        // Held, so pending — and silent, where the old code warned.
        expect(logs).toEqual([])
        await expect(stat(stale)).resolves.toBeDefined()
      } finally {
        await settled(holder)
      }
      await retireStaleJobs(log)
      await expect(stat(stale)).rejects.toThrow()
      await expect(stat(current)).resolves.toBeDefined()
      expect(logs).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an unheld stale build goes at once, and the current one stands', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-mcp-sweep-'))
    try {
      const currentName = jobFileName(MCP_JOB_BUILD, 'csharp-source-v2')
      const staleName = jobFileName(MCP_JOB_BUILD, 'csharp-source-v1')
      const current = path.join(dir, currentName)
      const stale = path.join(dir, staleName)
      const other = path.join(dir, 'other.txt')
      await writeFile(current, '')
      await writeFile(stale, '')
      await writeFile(other, '')
      const logs: string[] = []
      await removeStaleJobs(
        MCP_JOB_BUILD,
        current,
        (message) => {
          logs.push(message)
        },
        () => Promise.resolve('csharp-source-v2'),
      )
      await expect(stat(stale)).rejects.toThrow()
      await expect(stat(current)).resolves.toBeDefined()
      await expect(stat(other)).resolves.toBeDefined()
      expect(logs).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a build that is current again is never removed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-mcp-downgrade-'))
    try {
      const staleName = jobFileName(MCP_JOB_BUILD, 'csharp-source-v1')
      const stale = path.join(dir, staleName)
      await copyFile(path.join(systemRoot(), 'System32', 'cmd.exe'), stale)
      let source = 'csharp-source-v2'
      const logs: string[] = []
      const log = (message: string): void => {
        logs.push(message)
      }
      const holder = spawn(stale, ['/c', 'ping', '-n', '20', '127.0.0.1'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      await once(holder, 'spawn')
      try {
        await removeStaleJobs(
          MCP_JOB_BUILD,
          path.join(dir, jobFileName(MCP_JOB_BUILD, source)),
          log,
          () => Promise.resolve(source),
        )
        expect(logs).toEqual([])
      } finally {
        await settled(holder)
      }
      // The helper reverted: the pending file is the live build again.
      source = 'csharp-source-v1'
      await retireStaleJobs(log)
      await expect(stat(stale)).resolves.toBeDefined()
      expect(logs).toEqual([])
      // Forgotten, not queued: upgrading again does not remove it either.
      source = 'csharp-source-v2'
      await retireStaleJobs(log)
      await expect(stat(stale)).resolves.toBeDefined()
      expect(logs).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a job child exit retires the freed build', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-mcp-hook-'))
    try {
      const root = systemRoot()
      const logs: string[] = []
      const log = (message: string): void => {
        logs.push(message)
      }
      const readSource = readJobSource
      const helper = await sealedMcpJobExecutable({
        storageDir: dir,
        systemRoot: root,
        readJobSource: readSource,
        // The real execFile runner: the default governed compiler needs a
        // configured resource host, which a bare test process has none of.
        run: runProgram,
        log,
      })()
      if (helper === undefined)
        throw new Error(`the real launcher did not build: ${logs.join('; ')}`)
      const staleName = jobFileName(MCP_JOB_BUILD, 'mcp-job-retire-test-stale')
      if (staleName === path.basename(helper.path)) throw new Error('the stale test name is live')
      const stale = path.join(path.dirname(helper.path), staleName)
      await copyFile(path.join(root, 'System32', 'cmd.exe'), stale)
      const holder = spawn(stale, ['/c', 'ping', '-n', '20', '127.0.0.1'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      await once(holder, 'spawn')
      try {
        await removeStaleJobs(MCP_JOB_BUILD, helper.path, log, () => readSource('mcpLauncher'))
        expect(logs).toEqual([])
        await expect(stat(stale)).resolves.toBeDefined()
      } finally {
        await settled(holder)
      }
      await expect(stat(stale)).resolves.toBeDefined()
      const child = spawnMcpJob({
        executablePath: helper.path,
        file: path.join(root, 'System32', 'cmd.exe'),
        args: ['/c', 'exit', '0'],
        isVerbatim: false,
        cwd: dir,
        env: noWorkspaceChildEnvironment('win32', { SystemRoot: root }, realpathSync),
        log,
      })
      await once(child, 'exit')
      // Nothing but the exit hook retires it from here.
      await gone(stale)
      await expect(stat(helper.path)).resolves.toBeDefined()
      expect(logs).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
