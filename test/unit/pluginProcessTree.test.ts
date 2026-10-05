// RVM91X P1 5: plugin children and everything they start end together. On
// Windows the host starts each child through M50's job launcher (a
// no-breakaway, kill-on-close job); these real-process cases run on Windows
// only (this host and the Win11 rig). The refusals run everywhere.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type PluginCall,
  type PluginRunDeps,
  posixProcessTree,
  runPluginHook,
} from '../../src/core/backends/modelapi/pluginHost'
import { pluginProcessTree } from '../../src/host/backend/pluginProcessTree'
import { fixtureJobLifecycle } from './helpers/mcpFixtures'

const jobState = fixtureJobLifecycle()
beforeAll(jobState.setup, 60_000)
afterAll(jobState.dispose)

function call(pluginPath: string, extra: Partial<PluginCall> = {}): PluginCall {
  return {
    system: 'amp',
    pluginPath,
    hook: 'tool.call',
    payload: { tool: 'bash', input: {}, toolUseID: 'toolu_1', thread: { id: 't' } },
    failClosed: false,
    timeoutMs: 30_000,
    ...extra,
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A plugin that starts a detached grandchild, records its id, then answers (or hangs). */
function treePlugin(isHanging: boolean): { readonly plugin: string; readonly marker: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91x-job-'))
  const marker = path.join(dir, 'pid')
  const plugin = path.join(dir, 'plugin.mjs')
  const answer = isHanging
    ? `await new Promise((resolve) => setTimeout(resolve, 60_000))`
    : `return { action: 'reject-and-continue', message: 'tree' }`
  writeFileSync(
    plugin,
    [
      `import { spawn } from 'node:child_process'`,
      `import { writeFileSync } from 'node:fs'`,
      `export default function (amp) {`,
      `  const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true })`,
      `  worker.unref()`,
      `  writeFileSync(${JSON.stringify(marker)}, String(worker.pid))`,
      `  amp.on('tool.call', async () => { ${answer} })`,
      `}`,
    ].join('\n'),
  )
  return { plugin, marker }
}

function windowsDeps(executable: string | undefined): PluginRunDeps {
  return {
    env: {
      PATH: path.dirname(process.execPath),
      SystemRoot: process.env['SystemRoot'] ?? '',
    },
    platform: 'win32',
    processTree: pluginProcessTree({
      platform: 'win32',
      jobExecutable: () => Promise.resolve(executable),
      log: () => undefined,
    }),
  }
}

describe('the platform’s tree', () => {
  it('is the process group off Windows', () => {
    const tree = pluginProcessTree({
      platform: 'linux',
      jobExecutable: () => Promise.resolve(undefined),
      log: () => undefined,
    })
    expect(tree).toBe(posixProcessTree)
  })

  it('refuses on Windows when the job launcher is unavailable, by the fail-closed rule', async () => {
    for (const isFailClosed of [false, true]) {
      const answer = await runPluginHook(
        call(String.raw`C:\plugins\demo.mjs`, { failClosed: isFailClosed }),
        {
          ...windowsDeps(undefined),
          env: { PATH: String.raw`C:\node` },
          fileExists: () => true,
          runVersion: () => Promise.resolve('v24.0.0'),
        },
      )
      expect(answer).toMatchObject({
        status: isFailClosed ? 'blocked' : 'failed',
        reason: expect.stringContaining('could not start') as unknown,
      })
    }
  })

  it('refuses a Windows runtime that is not an executable', async () => {
    const answer = await runPluginHook(call(String.raw`C:\plugins\demo.mjs`), {
      ...windowsDeps(String.raw`C:\storage\MuseSparkMcpJob-x.exe`),
      env: { PATH: String.raw`C:\node` },
      fileExists: (file) => file.endsWith('.com'),
      runVersion: () => Promise.resolve('v24.0.0'),
    })
    expect(answer).toMatchObject({ status: 'failed' })
  })
})

describe.runIf(process.platform === 'win32')('Windows: the kill-on-close job', () => {
  it('ends a detached grandchild with the answer', async () => {
    const { plugin, marker } = treePlugin(false)
    const answer = await runPluginHook(call(plugin), windowsDeps(jobState.path))
    expect(answer).toEqual({ status: 'blocked', reason: 'tree' })
    const pid = Number(readFileSync(marker, 'utf8'))
    await vi.waitFor(
      () => {
        expect(isRunning(pid)).toBe(false)
      },
      { timeout: 5000 },
    )
  }, 60_000)

  it('ends a detached grandchild when the plugin times out', async () => {
    const { plugin, marker } = treePlugin(true)
    const answer = await runPluginHook(
      call(plugin, { timeoutMs: 8000 }),
      windowsDeps(jobState.path),
    )
    expect(answer).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('timed out') as unknown,
    })
    const pid = Number(readFileSync(marker, 'utf8'))
    await vi.waitFor(
      () => {
        expect(isRunning(pid)).toBe(false)
      },
      { timeout: 5000 },
    )
  }, 60_000)
})
