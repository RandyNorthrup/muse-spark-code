// What plugin children run in (RVM91X P1 5 and P2 12; M91b). On Windows the
// host starts each child through M50's job launcher: a no-breakaway job with
// kill-on-close and a memory limit. A failed preparation is tried once more
// after a short delay, then stays until Retry Plugin Hooks. The real-process
// cases run on Windows only (this host and the Win11 rig); the rest
// everywhere.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  containedTree,
  type PluginCall,
  type PluginRunDeps,
  posixProcessTree,
  runPluginHook,
} from '../../src/core/backends/modelapi/pluginHost'
import { pluginContainment } from '../../src/host/backend/pluginContainment'
import { PLUGIN_JOB_RETRY_BACKOFF_MS, UI_TEXT } from '../../src/shared/constants'
import { fixtureJobLifecycle } from './helpers/mcpFixtures'

const jobState = fixtureJobLifecycle()
beforeAll(jobState.setup, 60_000)
afterAll(jobState.dispose)

/** A launcher preparation that answers `executable`. */
function preparing(executable: string | undefined): () => Promise<string | undefined> {
  return () => Promise.resolve(executable)
}

/** The kind of the containment `source` gives now. */
async function kindOf(source: { readonly containment: () => Promise<{ readonly kind: string }> }) {
  const containment = await source.containment()
  return containment.kind
}

function call(pluginPath: string, extra: Partial<PluginCall> = {}): PluginCall {
  return {
    system: 'amp',
    pluginPath,
    hook: 'tool.call',
    payload: { tool: 'Bash', input: {}, toolUseID: 'toolu_1', thread: { id: 'T-1' } },
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

function plugin(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91x-job-'))
  const file = path.join(dir, 'plugin.mjs')
  writeFileSync(file, body)
  return file
}

/** A plugin that starts a detached grandchild, records its id, then answers (or hangs). */
function treePlugin(isHanging: boolean): { readonly plugin: string; readonly marker: string } {
  const marker = path.join(mkdtempSync(path.join(tmpdir(), 'm91x-pid-')), 'pid')
  const answer = isHanging
    ? `await new Promise((resolve) => setTimeout(resolve, 60_000))`
    : `return { action: 'reject-and-continue', message: 'tree' }`
  return {
    marker,
    plugin: plugin(
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
    ),
  }
}

describe('the platform’s containment', () => {
  it('is the process group off Windows', async () => {
    const source = pluginContainment({
      platform: 'linux',
      newJobExecutable: () => undefined,
      now: () => 0,
      log: () => undefined,
    })
    const containment = await source.containment()
    expect(containment).toEqual({ kind: 'processGroup' })
    expect(containedTree(containment)).toBe(posixProcessTree)
  })

  it('is M50’s launcher on Windows, which starts executables only', async () => {
    const source = pluginContainment({
      platform: 'win32',
      newJobExecutable: () => preparing(String.raw`C:\storage\MuseSparkMcpJob-x.exe`),
      now: () => 0,
      log: () => undefined,
    })
    const containment = await source.containment()
    expect(containment.kind).toBe('job')
    if (containment.kind !== 'job') return
    expect(() =>
      containment.launch(String.raw`C:\node\node.cmd`, [], { env: {}, cwd: String.raw`C:\w` }),
    ).toThrow('not an executable')
  })

  it('tries a failed preparation once more after the delay, then stays off until Retry', async () => {
    let clock = 0
    let builds = 0
    let isWorking = false
    const logged: string[] = []
    const source = pluginContainment({
      platform: 'win32',
      newJobExecutable: () => {
        builds += 1
        return preparing(isWorking ? String.raw`C:\s\job.exe` : undefined)
      },
      now: () => clock,
      log: (message) => {
        logged.push(message)
      },
    })
    const off = { kind: 'unavailable', notice: UI_TEXT.pluginHooksNoJob }
    expect(await source.containment()).toEqual(off)
    expect(builds).toBe(1)
    // Within the delay: no new attempt.
    clock += PLUGIN_JOB_RETRY_BACKOFF_MS - 1
    expect(await source.containment()).toEqual(off)
    expect(builds).toBe(1)
    // After it: one more attempt, from a fresh preparation.
    clock += 1
    expect(await source.containment()).toEqual(off)
    expect(builds).toBe(2)
    // Then it stays off, however long.
    clock += PLUGIN_JOB_RETRY_BACKOFF_MS * 10
    expect(await source.containment()).toEqual(off)
    expect(builds).toBe(2)
    expect(logged).toHaveLength(2)
    // Retry Plugin Hooks forgets the failure.
    isWorking = true
    source.reset()
    expect(await kindOf(source)).toBe('job')
    expect(builds).toBe(3)
  })

  it('a retry that succeeds turns plugin hooks back on', async () => {
    let clock = 0
    let attempt = 0
    const source = pluginContainment({
      platform: 'win32',
      newJobExecutable: () => {
        attempt += 1
        const isWorking = attempt > 1
        return preparing(isWorking ? String.raw`C:\s\job.exe` : undefined)
      },
      now: () => clock,
      log: () => undefined,
    })
    expect(await kindOf(source)).toBe('unavailable')
    clock += PLUGIN_JOB_RETRY_BACKOFF_MS
    expect(await kindOf(source)).toBe('job')
  })
})

/** One containment's tree for a whole call: spawn and kill on the same job. */
async function jobDeps(): Promise<PluginRunDeps> {
  const source = pluginContainment({
    platform: 'win32',
    newJobExecutable: () => preparing(jobState.path),
    now: () => 0,
    log: () => undefined,
  })
  const tree = containedTree(await source.containment())
  if (typeof tree === 'string') throw new Error(tree)
  return {
    env: { PATH: path.dirname(process.execPath), SystemRoot: process.env['SystemRoot'] ?? '' },
    platform: 'win32',
    processTree: tree,
  }
}

describe.runIf(process.platform === 'win32')('Windows: the kill-on-close job', () => {
  it('ends a detached grandchild with the answer', async () => {
    const { plugin: file, marker } = treePlugin(false)
    const answer = await runPluginHook(call(file), await jobDeps())
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
    const { plugin: file, marker } = treePlugin(true)
    const answer = await runPluginHook(call(file, { timeoutMs: 8000 }), await jobDeps())
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

  it('bounds the whole job’s memory (P2 12)', async () => {
    const allocating = (megabytes: number) =>
      plugin(
        [
          `export default function (amp) {`,
          `  amp.on('tool.call', async () => {`,
          `    const block = Buffer.alloc(${String(megabytes)} * 1024 * 1024, 1)`,
          `    return { action: 'reject-and-continue', message: 'held ' + block.length }`,
          `  })`,
          `}`,
        ].join('\n'),
      )
    const small = await runPluginHook(call(allocating(64)), await jobDeps())
    expect(small).toEqual({ status: 'blocked', reason: `held ${String(64 * 1024 * 1024)}` })
    const large = await runPluginHook(call(allocating(1300)), await jobDeps())
    expect(large.status).toBe('failed')
  }, 60_000)
})
