// M91 lane X: the plugin child lifecycle. Fake-spawn tests prove start,
// timeout, crash, kill-on-dispose and refuse-when-absent; real node runs
// prove the shipped child entry actually loads plugins and enforces the
// answer rules (a plugin answer can only refuse, narrow or add context).
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type PluginChildHandle,
  type PluginCall,
  type PluginRunDeps,
  PluginSession,
  pluginChildEnv,
  resolvePluginRuntime,
  runPluginHook,
  sanitizePluginAnswer,
} from '../../src/core/backends/modelapi/pluginHost'

const silent = {
  on: (): void => {
    // The host never parses plugin stderr.
  },
}

function fakeChild(): {
  handle: PluginChildHandle
  writes: string[]
  kills: string[]
  stdout: (text: string) => void
  close: () => void
  crash: () => void
} {
  const writes: string[] = []
  const kills: string[] = []
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const stdoutListeners: ((chunk: Buffer) => void)[] = []
  const on = (event: 'close' | 'error', listener: (...args: never[]) => void): void => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener])
  }
  const handle: PluginChildHandle = {
    pid: 4242,
    stdin: {
      write: (chunk: string): void => {
        writes.push(chunk)
      },
      end: (): void => {
        // The fake never blocks on stdin.
      },
    },
    stdout: {
      on: (_event: 'data', listener: (chunk: Buffer) => void): void => {
        stdoutListeners.push(listener)
      },
    },
    stderr: silent,
    kill: (signal?: NodeJS.Signals): boolean => {
      kills.push(signal ?? 'SIGTERM')
      return true
    },
    on,
  }
  return {
    handle,
    writes,
    kills,
    stdout: (text: string): void => {
      for (const listener of stdoutListeners) listener(Buffer.from(text, 'utf8'))
    },
    close: (): void => {
      const closeListeners = listeners.get('close') ?? []
      for (const listener of closeListeners) listener()
    },
    crash: (): void => {
      const errorListeners = listeners.get('error') ?? []
      for (const listener of errorListeners) listener()
    },
  }
}

function fakeDeps(child: { handle: PluginChildHandle }) {
  return {
    platform: 'linux' as const,
    runVersion: (): Promise<string> => Promise.resolve('v24.0.0'),
    spawn: (): PluginChildHandle => child.handle,
  }
}

function call(extra: Partial<PluginCall> = {}): PluginCall {
  return {
    system: 'amp',
    pluginPath: '/plugins/demo.js',
    hook: 'tool.call',
    payload: { tool: 'bash', input: { command: 'ls' } },
    failClosed: false,
    timeoutMs: 1000,
    ...extra,
  }
}

function answerFrame(answer: unknown): string {
  return `${JSON.stringify({ ok: true, answer })}\n`
}

describe('resolvePluginRuntime refuses with a reason when absent', () => {
  it('amp needs system node >= 22.18', async () => {
    await expect(
      resolvePluginRuntime('amp', { runVersion: () => Promise.resolve('v20.19.0') }),
    ).resolves.toMatchObject({ ok: false })
    await expect(
      resolvePluginRuntime('amp', { runVersion: () => Promise.resolve('v24.0.0') }),
    ).resolves.toMatchObject({ ok: true, command: 'node' })
    const missing = await resolvePluginRuntime('amp', {
      runVersion: () => Promise.reject(new Error('ENOENT')),
    })
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok) expect(missing.reason).toContain('node')
  })

  it('opencode needs the installed bun', async () => {
    await expect(
      resolvePluginRuntime('opencode', { runVersion: () => Promise.resolve('1.3.14') }),
    ).resolves.toMatchObject({ ok: true, command: 'bun' })
    const missing = await resolvePluginRuntime('opencode', {
      runVersion: () => Promise.reject(new Error('ENOENT')),
    })
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok) expect(missing.reason).toContain('bun')
  })

  it('a missing runtime fails the hook with its reason, never blocks', async () => {
    const child = fakeChild()
    const answer = await runPluginHook(call({ system: 'opencode' }), {
      ...fakeDeps(child),
      runVersion: () => Promise.reject(new Error('ENOENT')),
    })
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('bun')
    expect(child.writes).toEqual([])
  })
})

describe('sanitizePluginAnswer: answers cannot widen', () => {
  it('drops an allow grant to a plain completed', () => {
    expect(sanitizePluginAnswer({ status: 'completed', approvalDecision: 'allow' })).toEqual({
      status: 'completed',
    })
    expect(sanitizePluginAnswer({ status: 'completed', permissionDecision: 'allow' })).toEqual({
      status: 'completed',
    })
  })

  it('keeps deny and ask, and drops tool narrowing', () => {
    expect(sanitizePluginAnswer({ status: 'completed', permissionDecision: 'ask' })).toEqual({
      status: 'completed',
      permissionDecision: 'ask',
    })
    expect(
      sanitizePluginAnswer({
        status: 'blocked',
        reason: 'no',
        approvalDecision: 'deny',
        allowedToolNames: ['bash'],
      }),
    ).toEqual({ status: 'blocked', reason: 'no', approvalDecision: 'deny' })
  })

  it('refuses an unknown status', () => {
    expect(sanitizePluginAnswer({ status: 'grant-everything' } as never)).toEqual({
      status: 'failed',
      reason: 'plugin returned an invalid answer',
    })
  })
})

describe('pluginChildEnv keeps secrets out of the child', () => {
  it('drops provider keys and forbidden names', () => {
    const env = pluginChildEnv({
      PATH: '/bin',
      META_API_KEY: 'secret',
      AWS_SECRET_ACCESS_KEY: 'secret',
      HOME: '/home/u',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/u' })
  })
})

// runPluginHook resolves its runtime before spawning: let it reach spawn.
async function spawned(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('child lifecycle with a fake spawn', () => {
  it('an answer passes through sanitized', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call(), fakeDeps(child))
    await spawned()
    expect(JSON.parse(child.writes[0] ?? '{}')).toMatchObject({ system: 'amp', hook: 'tool.call' })
    child.stdout(answerFrame({ status: 'blocked', reason: 'no' }))
    child.close()
    await expect(pending).resolves.toEqual({ status: 'blocked', reason: 'no' })
    expect(child.kills).not.toEqual([])
  })

  it.each([false, true])(
    'a crash follows the fail-closed rule (closed=%s)',
    async (isFailClosed) => {
      const child = fakeChild()
      const pending = runPluginHook(call({ failClosed: isFailClosed }), fakeDeps(child))
      await spawned()
      child.crash()
      const answer = await pending
      expect(answer.status).toBe(isFailClosed ? 'blocked' : 'failed')
      expect(answer.reason).toContain('crashed')
    },
  )

  it('an exit without an answer follows the fail-closed rule', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call({ failClosed: true }), fakeDeps(child))
    await spawned()
    child.close()
    await expect(pending).resolves.toMatchObject({ status: 'blocked' })
  })

  it('a timeout kills the child and follows the fail-closed rule', async () => {
    const child = fakeChild()
    const answer = await runPluginHook(call({ failClosed: false, timeoutMs: 20 }), fakeDeps(child))
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('timed out')
    expect(child.kills).not.toEqual([])
  })

  it('an over-long answer fails the hook', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call(), fakeDeps(child))
    await spawned()
    child.stdout(answerFrame({ status: 'completed', context: 'x'.repeat(70_000) }))
    const answer = await pending
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('frame')
  })

  it('dispose kills an in-flight child and closes the session', async () => {
    const child = fakeChild()
    const session = new PluginSession()
    const pending = session.run(call(), fakeDeps(child))
    await spawned()
    session.dispose('linux')
    expect(child.kills).not.toEqual([])
    child.close()
    await expect(pending).resolves.toMatchObject({ status: 'failed' })
    await expect(session.run(call(), fakeDeps(child))).resolves.toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('closed'),
    })
  })
})

// Real runtime runs below prove the shipped child entry loads plugins.
// They need the user's node >= 22.18 (the lane's own runtime rule).
const VERSION_PATTERN = /^v(\d+)\.(\d+)\./
const VERSION_MATCH = VERSION_PATTERN.exec(process.version)
const HAS_NODE =
  VERSION_MATCH !== null &&
  (Number(VERSION_MATCH[1]) > 22 ||
    (Number(VERSION_MATCH[1]) === 22 && Number(VERSION_MATCH[2]) >= 18))

function writePlugin(source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91x-plugin-'))
  const file = path.join(dir, 'plugin.mjs')
  writeFileSync(file, source)
  return file
}

const realDeps = { platform: process.platform }

/**
 * OpenCode's runtime is the user's bun. The child source is runtime-agnostic
 * (lane X), so where bun is absent (Kubuntu, CI) the same source runs under
 * this node as an ES module: the test proves the child, not the machine.
 */
const opencodeDeps: PluginRunDeps = {
  platform: process.platform,
  runVersion: (command) => Promise.resolve(command === 'bun' ? '1.3.14' : process.version),
  spawn: (command, args, options) => {
    const isBun = command === 'bun'
    const child = spawn(
      isBun ? process.execPath : command,
      isBun ? ['--input-type=module', ...args] : [...args],
      { env: options.env, detached: options.detached, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return child as unknown as PluginChildHandle
  },
}

describe.runIf(HAS_NODE)('real node child', () => {
  it('an amp reject blocks with the message', async () => {
    const plugin = writePlugin(
      `globalThis.amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'nope' }));`,
    )
    const answer = await runPluginHook(
      call({ pluginPath: plugin, payload: { tool: 'bash', input: {}, thread: { id: 't' } } }),
      realDeps,
    )
    expect(answer).toEqual({ status: 'blocked', reason: 'nope' })
  })

  it('an amp modify narrows the input', async () => {
    const plugin = writePlugin(
      `globalThis.amp.on('tool.call', async (event) => ({ action: 'modify', input: { ...event.input, command: 'ls safe' } }));`,
    )
    const answer = await runPluginHook(
      call({
        pluginPath: plugin,
        payload: { tool: 'bash', input: { command: 'rm -rf /' }, thread: { id: 't' } },
      }),
      realDeps,
    )
    expect(answer).toEqual({
      status: 'completed',
      updatedInput: { command: 'ls safe' },
    })
  })

  it('an opencode throw blocks, and allow never grants', async () => {
    const denying = writePlugin(
      `export default () => ({ 'tool.execute.before': async () => { throw new Error('deny it'); } });`,
    )
    const blocked = await runPluginHook(
      call({
        system: 'opencode',
        pluginPath: denying,
        hook: 'tool.execute.before',
        payload: { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'ls' } },
      }),
      opencodeDeps,
    )
    expect(blocked).toEqual({ status: 'blocked', reason: 'deny it' })

    const granting = writePlugin(
      `export default () => ({ 'permission.ask': async (input, output) => { output.status = 'allow'; } });`,
    )
    const granted = await runPluginHook(
      call({
        system: 'opencode',
        pluginPath: granting,
        hook: 'permission.ask',
        payload: { status: 'ask' },
      }),
      opencodeDeps,
    )
    expect(granted).toEqual({ status: 'completed' })
  })

  it('a hanging plugin times out and is killed', async () => {
    const plugin = writePlugin(
      `globalThis.amp.on('tool.call', async () => { await new Promise((resolve) => setTimeout(resolve, 60000)); });`,
    )
    const answer = await runPluginHook(call({ pluginPath: plugin, timeoutMs: 300 }), realDeps)
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('timed out')
  })

  it('a crashing import fails open, or blocks when fail-closed', async () => {
    const plugin = writePlugin(`throw new Error('boom');`)
    const open = await runPluginHook(call({ pluginPath: plugin, failClosed: false }), realDeps)
    expect(open).toEqual({ status: 'failed', reason: expect.stringContaining('boom') })
    const closed = await runPluginHook(call({ pluginPath: plugin, failClosed: true }), realDeps)
    expect(closed.status).toBe('blocked')
  })

  it('a call to an unoffered shim API fails that hook', async () => {
    const plugin = writePlugin(
      `globalThis.amp.on('tool.call', async (event, ctx) => { await ctx.ai.ask('x'); });`,
    )
    const answer = await runPluginHook(call({ pluginPath: plugin }), realDeps)
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('not offered')
  })
})
