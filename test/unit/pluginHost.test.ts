// M91 lane X: the plugin child lifecycle. Fake-tree tests prove start,
// timeout, crash, kill-on-dispose and refuse-when-absent; real node runs
// prove the shipped child entry actually loads plugins and enforces the
// answer rules (a plugin answer can only refuse, narrow or add context).
// The RVM91X regressions are named by their finding (RVM91X-n).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  type PluginCall,
  type PluginChildHandle,
  type PluginProcessTree,
  type PluginRunDeps,
  PluginSession,
  nodeChildHandle,
  resolvePluginRuntime,
  runPluginHook,
  sanitizePluginAnswer,
} from '../../src/core/backends/modelapi/pluginHost'
import { PLUGIN_CHILD_MAX_MEMORY_BYTES } from '../../src/shared/constants'
import { expectEnded } from './helpers/processes'

interface FakeChild {
  readonly handle: PluginChildHandle
  readonly writes: string[]
  stdout(text: string | Buffer): void
  close(): void
  crash(): void
}

function fakeChild(): FakeChild {
  const writes: string[] = []
  const closes: (() => void)[] = []
  const errors: (() => void)[] = []
  const stdouts: ((chunk: Buffer) => void)[] = []
  const handle: PluginChildHandle = {
    pid: 4242,
    write: (text) => {
      writes.push(text)
    },
    onStdout: (listener) => {
      stdouts.push(listener)
    },
    onClose: (listener) => {
      closes.push(listener)
    },
    onError: (listener) => {
      errors.push(listener)
    },
  }
  return {
    handle,
    writes,
    stdout: (text) => {
      for (const listener of stdouts) listener(Buffer.isBuffer(text) ? text : Buffer.from(text))
    },
    close: () => {
      for (const listener of closes) listener()
    },
    crash: () => {
      for (const listener of errors) listener()
    },
  }
}

interface FakeTree extends PluginProcessTree {
  readonly spawned: { command: string; env: NodeJS.ProcessEnv }[]
  readonly killed: PluginChildHandle[]
}

function fakeTree(child: FakeChild): FakeTree {
  const spawned: { command: string; env: NodeJS.ProcessEnv }[] = []
  const killed: PluginChildHandle[] = []
  return {
    spawned,
    killed,
    spawn: (command, _args, options) => {
      spawned.push({ command, env: options.env })
      return Promise.resolve(child.handle)
    },
    killTree: (handle) => {
      killed.push(handle)
    },
  }
}

const FAKE_ENV: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/u' }

function fakeDeps(tree: PluginProcessTree, extra: Partial<PluginRunDeps> = {}): PluginRunDeps {
  return {
    env: FAKE_ENV,
    platform: 'linux',
    fileExists: () => true,
    runVersion: () => Promise.resolve('v24.0.0'),
    processTree: tree,
    ...extra,
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

// runPluginHook resolves its runtime before spawning: let it reach spawn.
async function spawned(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function runtimeDeps(version: () => Promise<string>): PluginRunDeps {
  return { env: FAKE_ENV, platform: 'linux', fileExists: () => true, runVersion: version }
}

describe('resolvePluginRuntime refuses with a reason when absent', () => {
  it('amp needs system node >= 22.18', async () => {
    await expect(
      resolvePluginRuntime(
        'amp',
        runtimeDeps(() => Promise.resolve('v20.19.0')),
      ),
    ).resolves.toMatchObject({ ok: false })
    await expect(
      resolvePluginRuntime(
        'amp',
        runtimeDeps(() => Promise.resolve('v24.0.0')),
      ),
    ).resolves.toMatchObject({ ok: true, command: '/usr/bin/node' })
    const missing = await resolvePluginRuntime(
      'amp',
      runtimeDeps(() => Promise.reject(new Error('ENOENT'))),
    )
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok) expect(missing.reason).toContain('node')
  })

  it('opencode needs the installed bun, bounded by prlimit on Linux (P2 12)', async () => {
    await expect(
      resolvePluginRuntime(
        'opencode',
        runtimeDeps(() => Promise.resolve('1.3.14')),
      ),
    ).resolves.toEqual({
      ok: true,
      command: '/usr/bin/prlimit',
      args: [`--data=${String(PLUGIN_CHILD_MAX_MEMORY_BYTES)}`, '--', '/usr/bin/bun', '-e'],
    })
    await expect(
      resolvePluginRuntime('opencode', {
        ...runtimeDeps(() => Promise.resolve('1.3.14')),
        platform: 'win32',
        env: { PATH: String.raw`C:\bun` },
      }),
    ).resolves.toMatchObject({ ok: true, args: ['-e'] })
    const unbounded = await resolvePluginRuntime('opencode', {
      ...runtimeDeps(() => Promise.resolve('1.3.14')),
      platform: 'darwin',
    })
    expect(unbounded).toMatchObject({ ok: false })
    if (!unbounded.ok) expect(unbounded.reason).toContain('cannot be bounded')
    const noPrlimit = await resolvePluginRuntime('opencode', {
      ...runtimeDeps(() => Promise.resolve('1.3.14')),
      fileExists: (file) => file.endsWith('bun'),
    })
    expect(noPrlimit).toMatchObject({ ok: false })
    const missing = await resolvePluginRuntime(
      'opencode',
      runtimeDeps(() => Promise.reject(new Error('ENOENT'))),
    )
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok) expect(missing.reason).toContain('bun')
  })

  it('finds the runtime by absolute PATH entries only (D24)', async () => {
    const absent = await resolvePluginRuntime('amp', {
      env: { PATH: 'relative/bin:' },
      platform: 'linux',
      fileExists: () => true,
      runVersion: () => Promise.resolve('v24.0.0'),
    })
    expect(absent).toMatchObject({ ok: false })
  })

  it('a missing runtime fails the hook with its reason, never blocks when open', async () => {
    const child = fakeChild()
    const tree = fakeTree(child)
    const answer = await runPluginHook(
      call({ system: 'opencode' }),
      fakeDeps(tree, { runVersion: () => Promise.reject(new Error('ENOENT')) }),
    )
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

describe('RVM91X-2 the probe and the child see only the allowlisted environment', () => {
  it('passes the caller’s environment, never the host’s, and drops credential names', async () => {
    const planted = { GITHUB_TOKEN: 'ghp-planted', NODE_OPTIONS: '--require=/evil.js' }
    vi.stubEnv('GITHUB_TOKEN', planted.GITHUB_TOKEN)
    vi.stubEnv('NODE_OPTIONS', planted.NODE_OPTIONS)
    try {
      const child = fakeChild()
      const tree = fakeTree(child)
      const probed: NodeJS.ProcessEnv[] = []
      const pending = runPluginHook(
        call(),
        fakeDeps(tree, {
          env: { ...FAKE_ENV, META_API_KEY: 'k', AWS_SECRET_ACCESS_KEY: 'k' },
          runVersion: (_command, env) => {
            probed.push(env)
            return Promise.resolve('v24.0.0')
          },
        }),
      )
      await spawned()
      child.stdout(answerFrame({ status: 'completed' }))
      await pending
      expect(probed).toEqual([FAKE_ENV])
      expect(tree.spawned.map((entry) => entry.env)).toEqual([FAKE_ENV])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('child lifecycle with a fake tree', () => {
  it('an answer passes through sanitized, and the tree is ended', async () => {
    const child = fakeChild()
    const tree = fakeTree(child)
    const pending = runPluginHook(call(), fakeDeps(tree))
    await spawned()
    expect(JSON.parse(child.writes[0] ?? '{}')).toMatchObject({ system: 'amp', hook: 'tool.call' })
    child.stdout(answerFrame({ status: 'blocked', reason: 'no' }))
    child.close()
    await expect(pending).resolves.toEqual({ status: 'blocked', reason: 'no' })
    expect(tree.killed).toEqual([child.handle])
  })

  it.each([false, true])(
    'a crash follows the fail-closed rule (closed=%s)',
    async (isFailClosed) => {
      const child = fakeChild()
      const pending = runPluginHook(call({ failClosed: isFailClosed }), fakeDeps(fakeTree(child)))
      await spawned()
      child.crash()
      const answer = await pending
      expect(answer.status).toBe(isFailClosed ? 'blocked' : 'failed')
      expect(answer.reason).toContain('crashed')
    },
  )

  it('an exit without an answer follows the fail-closed rule', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call({ failClosed: true }), fakeDeps(fakeTree(child)))
    await spawned()
    child.close()
    await expect(pending).resolves.toMatchObject({ status: 'blocked' })
  })

  it('a timeout ends the tree and follows the fail-closed rule', async () => {
    const child = fakeChild()
    const tree = fakeTree(child)
    const answer = await runPluginHook(call({ failClosed: false, timeoutMs: 20 }), fakeDeps(tree))
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('timed out')
    expect(tree.killed).toEqual([child.handle])
  })

  it('dispose ends an in-flight child’s tree and closes the session', async () => {
    const child = fakeChild()
    const tree = fakeTree(child)
    const session = new PluginSession(fakeDeps(tree))
    const pending = session.run(call())
    await spawned()
    session.dispose()
    expect(tree.killed).toEqual([child.handle])
    child.close()
    await expect(pending).resolves.toMatchObject({ status: 'failed' })
    await expect(session.run(call())).resolves.toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('closed') as unknown,
    })
  })
})

describe('RVM91X-3 every frame is schema-validated, and nothing throws', () => {
  it.each([
    ['a null answer', { ok: true, answer: null }],
    ['a numeric context', { ok: true, answer: { status: 'completed', context: 7 } }],
    ['an array updatedInput', { ok: true, answer: { status: 'completed', updatedInput: ['x'] } }],
    [
      'an unknown replacement target',
      { ok: true, answer: { status: 'completed', replacement: { target: 'prompt', value: 'x' } } },
    ],
    ['an unknown answer field', { ok: true, answer: { status: 'completed', grant: true } }],
    ['an unknown frame field', { ok: true, answer: { status: 'completed' }, extra: 1 }],
    ['an error without text', { ok: false }],
  ])('%s is a failure that follows the fail-closed rule', async (_name, frame) => {
    for (const isFailClosed of [false, true]) {
      const child = fakeChild()
      const pending = runPluginHook(call({ failClosed: isFailClosed }), fakeDeps(fakeTree(child)))
      await spawned()
      child.stdout(`${JSON.stringify(frame)}\n`)
      await expect(pending).resolves.toMatchObject({
        status: isFailClosed ? 'blocked' : 'failed',
        reason: expect.stringContaining('invalid') as unknown,
      })
    }
  })
})

describe('RVM91X-4 a stdin error settles the call', () => {
  it('an error after the request was written fails the hook', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call({ failClosed: true }), fakeDeps(fakeTree(child)))
    await spawned()
    expect(child.writes).toHaveLength(1)
    child.crash()
    await expect(pending).resolves.toMatchObject({ status: 'blocked' })
  })

  // POSIX only: a Windows child closing fd 0 does not close the pipe's handle,
  // so the write stalls instead of failing; the listener is the same code.
  it.runIf(process.platform !== 'win32')(
    'a real EPIPE from a child that closed its stdin reaches the handle, not the process',
    async () => {
      const children: ReturnType<typeof spawn>[] = []
      const tree: PluginProcessTree = {
        spawn: async () => {
          const child = spawn(
            process.execPath,
            // Node keeps fd 0 open past stdin.destroy(); closing it ends the pipe's read side.
            [
              '-e',
              'require("fs").closeSync(0); process.stderr.write("ready"); setTimeout(() => {}, 10000)',
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] },
          )
          children.push(child)
          await new Promise((resolve) => child.stderr.once('data', resolve))
          return nodeChildHandle(child)
        },
        killTree: () => {
          for (const child of children) child.kill('SIGKILL')
        },
      }
      // The write fails with EPIPE after it returns; without a stdin error
      // listener that error is uncaught and fails this whole file.
      const answer = await runPluginHook(
        call({ payload: { blob: 'x'.repeat(256 * 1024) }, timeoutMs: 5000 }),
        fakeDeps(tree),
      )
      expect(answer).toEqual({ status: 'failed', reason: 'amp: the plugin child crashed' })
    },
  )

  it.runIf(process.platform !== 'win32')(
    'a spawn error raised before the host listened still settles at once',
    async () => {
      // A tree that still has work after starting the child (a launcher's
      // handshake, say) hands it over after its ENOENT was already emitted.
      const tree: PluginProcessTree = {
        spawn: async (command, args, options) => {
          const handle = nodeChildHandle(
            spawn(command, [...args], { env: options.env, stdio: ['pipe', 'pipe', 'pipe'] }),
          )
          await new Promise((resolve) => setImmediate(resolve))
          return handle
        },
        killTree: () => undefined,
      }
      const answer = await runPluginHook(call({ timeoutMs: 5000 }), {
        env: { PATH: '/nonexistent-m91x' },
        platform: process.platform,
        fileExists: () => true,
        runVersion: () => Promise.resolve('v24.0.0'),
        processTree: tree,
      })
      expect(answer).toEqual({ status: 'failed', reason: 'amp: the plugin child crashed' })
    },
  )
})

describe('RVM91X-5 Windows children run only in a job', () => {
  it('without a process tree on Windows, the hook is refused by its fail-closed rule', async () => {
    for (const isFailClosed of [false, true]) {
      const answer = await runPluginHook(call({ failClosed: isFailClosed }), {
        env: FAKE_ENV,
        platform: 'win32',
        fileExists: () => true,
        runVersion: () => Promise.resolve('v24.0.0'),
      })
      expect(answer).toMatchObject({
        status: isFailClosed ? 'blocked' : 'failed',
        reason: expect.stringContaining('job object') as unknown,
      })
    }
  })
})

describe('RVM91X-6 a failed answer follows the fail-closed rule', () => {
  it.each([false, true])('closed=%s', async (isFailClosed) => {
    const child = fakeChild()
    const pending = runPluginHook(call({ failClosed: isFailClosed }), fakeDeps(fakeTree(child)))
    await spawned()
    child.stdout(answerFrame({ status: 'failed', reason: 'amp: handler threw' }))
    await expect(pending).resolves.toEqual({
      status: isFailClosed ? 'blocked' : 'failed',
      reason: 'amp: handler threw',
    })
  })
})

describe('RVM91X-8 a session closed during the runtime probe spawns nothing', () => {
  it('rechecks disposal after the await', async () => {
    const child = fakeChild()
    const tree = fakeTree(child)
    const version = Promise.withResolvers<string>()
    const session = new PluginSession(fakeDeps(tree, { runVersion: () => version.promise }))
    const pending = session.run(call())
    await spawned()
    session.dispose()
    version.resolve('v24.0.0')
    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('closed') as unknown,
    })
    expect(tree.spawned).toEqual([])
  })
})

describe('RVM91X-11 the answer completes on its response line', () => {
  it('does not wait for the child to close', async () => {
    const child = fakeChild()
    const tree = fakeTree(child)
    const pending = runPluginHook(call({ timeoutMs: 5000 }), fakeDeps(tree))
    await spawned()
    child.stdout(answerFrame({ status: 'blocked', reason: 'no' }))
    await expect(pending).resolves.toEqual({ status: 'blocked', reason: 'no' })
    expect(tree.killed).toEqual([child.handle])
  })
})

describe('RVM91X-14 the frame cap counts UTF-8 bytes', () => {
  it('refuses 20,000 emoji (80 KB in UTF-8, 40,000 UTF-16 units)', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call(), fakeDeps(fakeTree(child)))
    await spawned()
    child.stdout(answerFrame({ status: 'completed', context: '😀'.repeat(20_000) }))
    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('frame') as unknown,
    })
  })

  it('decodes a character split across chunks', async () => {
    const child = fakeChild()
    const pending = runPluginHook(call(), fakeDeps(fakeTree(child)))
    await spawned()
    const bytes = Buffer.from(answerFrame({ status: 'completed', context: '😀' }))
    const split = bytes.indexOf(Buffer.from('😀')) + 2
    child.stdout(bytes.subarray(0, split))
    child.stdout(bytes.subarray(split))
    await expect(pending).resolves.toEqual({ status: 'completed', context: '😀' })
  })
})

// Real runtime runs below prove the shipped child entry loads plugins.
// They need the user's node >= 22.18 (the lane's own runtime rule), and a
// process tree: on Windows that is the job launcher, proved in
// pluginProcessTree.test.ts.
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

const NODE_ENV: NodeJS.ProcessEnv = { PATH: path.dirname(process.execPath) }

function realDeps(warnings: string[] = []): PluginRunDeps {
  return {
    env: NODE_ENV,
    platform: process.platform,
    warn: (message) => {
      warnings.push(message)
    },
  }
}

/**
 * OpenCode's runtime is the user's bun. The child source is runtime-agnostic
 * (lane X), so where bun is absent (Kubuntu, CI) the same source runs under
 * this node as an ES module: the test proves the child, not the machine.
 */
const opencodeTree: PluginProcessTree = {
  // The runtime after prlimit's `--`, run as this node: the child, not the machine.
  spawn: (_command, args, options) => {
    const runtime = args.slice(args.indexOf('--') + 2)
    return Promise.resolve(
      nodeChildHandle(
        spawn(process.execPath, ['--input-type=module', ...runtime], {
          env: options.env,
          cwd: options.cwd,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      ),
    )
  },
  killTree: (child) => {
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  },
}

function opencodeDeps(warnings: string[] = []): PluginRunDeps {
  return {
    ...realDeps(warnings),
    platform: 'linux',
    fileExists: () => true,
    runVersion: (command) => Promise.resolve(command.endsWith('bun') ? '1.3.14' : process.version),
    processTree: opencodeTree,
  }
}

function ampPlugin(body: string): string {
  return writePlugin(`export default function (amp) {\n${body}\n}\n`)
}

describe.runIf(HAS_NODE && process.platform !== 'win32')('real node child', () => {
  const thread = { tool: 'bash', input: {}, toolUseID: 'toolu_1', thread: { id: 't' } }

  it('RVM91X-1 an amp default export registers its guard, and its reject blocks', async () => {
    const plugin = ampPlugin(
      `amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'nope' }))`,
    )
    const answer = await runPluginHook(call({ pluginPath: plugin, payload: thread }), realDeps())
    expect(answer).toEqual({ status: 'blocked', reason: 'nope' })
  })

  it('RVM91X-1 an amp module without a default export function fails the hook', async () => {
    const plugin = writePlugin(`export const notAPlugin = 1\n`)
    const answer = await runPluginHook(call({ pluginPath: plugin, payload: thread }), realDeps())
    expect(answer).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('default export') as unknown,
    })
  })

  it('an amp modify narrows the input', async () => {
    const plugin = ampPlugin(
      `amp.on('tool.call', async (event) => ({ action: 'modify', input: { ...event.input, command: 'ls safe' } }))`,
    )
    const answer = await runPluginHook(
      call({
        pluginPath: plugin,
        payload: { ...thread, input: { command: 'rm -rf /' } },
      }),
      realDeps(),
    )
    expect(answer).toEqual({ status: 'completed', updatedInput: { command: 'ls safe' } })
  })

  it('RVM91X-7 an earlier amp veto survives a later handler’s failure, either order', async () => {
    const vetoFirst = ampPlugin(
      [
        `amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'deny' }))`,
        `amp.on('tool.call', async () => { throw new Error('later boom') })`,
      ].join('\n'),
    )
    await expect(
      runPluginHook(call({ pluginPath: vetoFirst, payload: thread }), realDeps()),
    ).resolves.toEqual({ status: 'blocked', reason: 'deny' })
    const failFirst = ampPlugin(
      [
        `amp.on('tool.call', async () => ({ action: 'bogus' }))`,
        `amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'deny' }))`,
      ].join('\n'),
    )
    await expect(
      runPluginHook(call({ pluginPath: failFirst, payload: thread }), realDeps()),
    ).resolves.toEqual({ status: 'blocked', reason: 'deny' })
  })

  it('RVM91X-13 an unsupported amp event is refused by name, and the guard still runs', async () => {
    const warnings: string[] = []
    const plugin = ampPlugin(
      [
        `amp.on('changes.prompt', async () => ({}))`,
        `amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'deny' }))`,
      ].join('\n'),
    )
    const answer = await runPluginHook(
      call({ pluginPath: plugin, payload: thread }),
      realDeps(warnings),
    )
    expect(answer).toEqual({ status: 'blocked', reason: 'deny' })
    expect(warnings).toEqual([
      "amp: the plugin's changes.prompt is refused: there is no Ship or Push workflow here",
    ])
  })

  it('RVM91X-11 a plugin holding its process open still answers at once', async () => {
    const plugin = ampPlugin(
      [
        `setInterval(() => undefined, 1000)`,
        `amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'held' }))`,
      ].join('\n'),
    )
    const started = Date.now()
    const answer = await runPluginHook(
      call({ pluginPath: plugin, payload: thread, failClosed: true, timeoutMs: 20_000 }),
      realDeps(),
    )
    expect(answer).toEqual({ status: 'blocked', reason: 'held' })
    expect(Date.now() - started).toBeLessThan(15_000)
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
      opencodeDeps(),
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
      opencodeDeps(),
    )
    expect(granted).toEqual({ status: 'completed' })
  })

  it('RVM91X-13 an unsupported opencode hook is refused by name, unknown ones counted', async () => {
    const warnings: string[] = []
    const plugin = writePlugin(
      `export default () => ({ 'shell.env': async () => {}, 'made.up': async () => {}, 'tool.execute.before': async () => { throw new Error('deny it'); } });`,
    )
    const answer = await runPluginHook(
      call({
        system: 'opencode',
        pluginPath: plugin,
        hook: 'tool.execute.before',
        payload: { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'ls' } },
      }),
      opencodeDeps(warnings),
    )
    expect(answer).toEqual({ status: 'blocked', reason: 'deny it' })
    expect(warnings).toEqual([
      "opencode: the plugin's shell.env is refused: environment edits are a secret risk",
      'opencode: 1 unknown plugin hook(s) refused',
    ])
  })

  it('a hanging plugin times out and is killed', async () => {
    const plugin = ampPlugin(
      `amp.on('tool.call', async () => { await new Promise((resolve) => setTimeout(resolve, 60000)); })`,
    )
    const answer = await runPluginHook(call({ pluginPath: plugin, timeoutMs: 300 }), realDeps())
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('timed out')
  })

  it('a crashing import fails open, or blocks when fail-closed', async () => {
    const plugin = writePlugin(`throw new Error('boom');`)
    const open = await runPluginHook(call({ pluginPath: plugin, failClosed: false }), realDeps())
    expect(open).toEqual({ status: 'failed', reason: expect.stringContaining('boom') as unknown })
    const closed = await runPluginHook(call({ pluginPath: plugin, failClosed: true }), realDeps())
    expect(closed.status).toBe('blocked')
  })

  it('a call to an unoffered shim API fails that hook', async () => {
    const plugin = ampPlugin(
      `amp.on('tool.call', async (event, ctx) => { await ctx.ai.ask('x'); })`,
    )
    const answer = await runPluginHook(call({ pluginPath: plugin }), realDeps())
    expect(answer.status).toBe('failed')
    expect(answer.reason).toContain('not offered')
  })

  it('RVM91X-5 a grandchild in the plugin’s process group ends with the answer', async () => {
    const marker = path.join(mkdtempSync(path.join(tmpdir(), 'm91x-tree-')), 'pid')
    const plugin = writePlugin(
      [
        `import { spawn } from 'node:child_process'`,
        `import { writeFileSync } from 'node:fs'`,
        `export default function (amp) {`,
        `  const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })`,
        `  writeFileSync(${JSON.stringify(marker)}, String(worker.pid))`,
        `  amp.on('tool.call', async () => ({ action: 'reject-and-continue', message: 'tree' }))`,
        `}`,
      ].join('\n'),
    )
    const answer = await runPluginHook(call({ pluginPath: plugin, payload: thread }), realDeps())
    expect(answer).toEqual({ status: 'blocked', reason: 'tree' })
    expect(existsSync(marker)).toBe(true)
    await expectEnded(Number(readFileSync(marker, 'utf8')))
  })
})
