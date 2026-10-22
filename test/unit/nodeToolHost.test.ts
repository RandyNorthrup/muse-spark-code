import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { mkdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NodeProcessToolHost,
  type NodePty,
  type NodePtyFactory,
  type NodeToolHostOptions,
} from '../../src/runtime/node/toolHost'
import type { NodeTerminalHostEvent } from '../../src/shared/node'

class TestPty implements NodePty {
  private readonly queue: string[] = []
  private changed = Promise.withResolvers<undefined>()
  private hasEnded = false
  readonly input: string[] = []
  readonly sizes: number[][] = []
  readonly closed = Promise.withResolvers<undefined>()
  readonly exit = Promise.withResolvers<number | null>()
  readonly exited = this.exit.promise
  reads = 0
  readonly output = this.stream()
  async *stream(): AsyncGenerator<string> {
    for (;;) {
      const data = this.queue.shift()
      if (data !== undefined) {
        this.reads += 1
        yield data
        continue
      }
      if (this.hasEnded) return
      await this.changed.promise
      this.changed = Promise.withResolvers<undefined>()
    }
  }
  push(data: string) {
    this.queue.push(data)
    this.changed.resolve(undefined)
  }
  finish(code: number | null) {
    this.hasEnded = true
    this.exit.resolve(code)
    this.changed.resolve(undefined)
  }
  write(data: string): Promise<void> {
    this.input.push(data)
    return Promise.resolve()
  }
  resize(cols: number, rows: number): Promise<void> {
    this.sizes.push([cols, rows])
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.finish(null)
    this.closed.resolve(undefined)
    return Promise.resolve()
  }
}
const directories: string[] = []
async function setup(pty = new TestPty()) {
  const dir = await nodeTempRoot('m110-tools-')
  directories.push(dir)
  await mkdir(path.join(dir, 'workspace'))
  const open = vi.fn((_options: Parameters<NodePtyFactory['open']>[0]) => Promise.resolve(pty))
  const options: NodeToolHostOptions = {
    toolsUid: 1000,
    serviceUid: 1001,
    currentUid: () => 1000,
    workspaceRoot: dir,
    workspaces: new Map([['workspace', { path: 'workspace', trusted: true }]]),
    toolsHome: dir,
    shell: process.execPath,
    pty: { open },
  }
  return { dir, pty, options, open, host: new NodeProcessToolHost(options) }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N tools process and terminal lifecycle', () => {
  it('H11 refuses root, service UID and a mismatched actual tools UID', async () => {
    const { options } = await setup()
    expect(
      () => new NodeProcessToolHost({ ...options, toolsUid: 0, currentUid: () => 0 }),
    ).toThrow()
    expect(
      () => new NodeProcessToolHost({ ...options, toolsUid: 1001, currentUid: () => 1001 }),
    ).toThrow()
    expect(() => new NodeProcessToolHost({ ...options, currentUid: () => 1002 })).toThrow()
  })
  nodeNativeTest(
    'H11 runs a real argv child with empty arguments and an allow-list environment',
    async () => {
      const { host } = await setup()
      const before = process.env['M110_TEST_API_KEY']
      process.env['M110_TEST_API_KEY'] = 'synthetic-environment-canary'
      try {
        const result = await host.run(
          {
            id: 'run',
            workspaceId: 'workspace',
            cwd: null,
            argv: ['/bin/sh', '-c', 'printf "<%s>" "$1"; env', 'test', ''],
          },
          new AbortController().signal,
        )
        expect(result.user).toBe('muse-tools')
        expect(result.stdout).toContain('<>')
        expect(result.stdout).not.toContain('synthetic-environment-canary')
        expect(result.stdout).not.toContain('SSH_AUTH_SOCK')
        expect(result.stdout).not.toContain('GIT_CONFIG')
      } finally {
        if (before === undefined) delete process.env['M110_TEST_API_KEY']
        else process.env['M110_TEST_API_KEY'] = before
      }
    },
  )
  it('H10 refuses unknown, untrusted and symlink-escaping workspaces before spawn', async () => {
    const { host, options, dir, open } = await setup()
    await expect(
      host.openTerminal(
        'unknown',
        { cols: 80, rows: 24 },
        () => Promise.resolve(),
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    const untrusted = new NodeProcessToolHost({
      ...options,
      workspaces: new Map([['workspace', { path: 'workspace', trusted: false }]]),
    })
    await expect(
      untrusted.run(
        { id: 'run', workspaceId: 'workspace', cwd: null, argv: ['/bin/true'] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    const outside = await nodeTempRoot('m110-outside-')
    directories.push(outside)
    await symlink(
      outside,
      path.join(dir, 'workspace', 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      host.run(
        { id: 'run', workspaceId: 'workspace', cwd: 'escape', argv: ['/bin/true'] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    await mkdir(path.join(dir, 'sibling'))
    await symlink(
      path.join(dir, 'sibling'),
      path.join(dir, 'workspace', 'sibling'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      host.run(
        { id: 'sibling', workspaceId: 'workspace', cwd: 'sibling', argv: ['/bin/true'] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
  it('H13 delivers output in order, awaits each acknowledgement and ends exactly once after output', async () => {
    const { host, pty, open } = await setup()
    pty.push('first')
    pty.push('second')
    const received: NodeTerminalHostEvent[] = []
    const first = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const ended = Promise.withResolvers<undefined>()
    const terminal = await host.openTerminal(
      'workspace',
      { cols: 80, rows: 24 },
      async (event) => {
        received.push(event)
        if (received.length === 1) {
          first.resolve(undefined)
          await release.promise
        }
        if (event.type === 'terminalEnded') ended.resolve(undefined)
      },
      new AbortController().signal,
    )
    await first.promise
    expect(pty.reads).toBe(1)
    expect(received).toHaveLength(1)
    release.resolve(undefined)
    pty.finish(7)
    await ended.promise
    expect(received.map((event) => event.type)).toEqual([
      'terminalOutput',
      'terminalOutput',
      'terminalEnded',
    ])
    expect(received.at(-1)).toMatchObject({ exitCode: 7, reason: 'exit' })
    await pty.closed.promise
    await host.closeTerminal(terminal.id)
    expect(received.filter((event) => event.type === 'terminalEnded')).toHaveLength(1)
    expect(open.mock.calls[0]![0].env).toEqual({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: expect.any(String),
      LANG: 'C.UTF-8',
      TERM: 'xterm-256color',
    })
  })
  it('H13 disconnect after opening disposes the PTY and labels the final exit lost', async () => {
    const { host, pty } = await setup()
    const signal = new AbortController()
    const received: NodeTerminalHostEvent[] = []
    const ended = Promise.withResolvers<undefined>()
    await host.openTerminal(
      'workspace',
      { cols: 80, rows: 24 },
      (event) => {
        received.push(event)
        if (event.type === 'terminalEnded') ended.resolve(undefined)
        return Promise.resolve()
      },
      signal.signal,
    )
    signal.abort()
    await pty.closed.promise
    await ended.promise
    expect(received).toEqual([expect.objectContaining({ reason: 'lost' })])
  })
  it('H13 cancellation during PTY creation disposes a late PTY before returning', async () => {
    const { host, pty, open } = await setup()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<TestPty>()
    open.mockImplementation(() => {
      started.resolve(undefined)
      return release.promise
    })
    const signal = new AbortController()
    const onEvent = vi.fn(() => Promise.resolve())
    const opening = expect(
      host.openTerminal('workspace', { cols: 80, rows: 24 }, onEvent, signal.signal),
    ).rejects.toThrow()
    await started.promise
    signal.abort()
    release.resolve(pty)
    await opening
    await pty.closed.promise
    expect(onEvent).not.toHaveBeenCalled()
  })
  it('H09 oversized PTY output is never forwarded and disposes the terminal', async () => {
    const { host, pty } = await setup()
    const onEvent = vi.fn(() => Promise.resolve())
    const terminal = await host.openTerminal(
      'workspace',
      { cols: 80, rows: 24 },
      onEvent,
      new AbortController().signal,
    )
    pty.push('x'.repeat(1_048_577))
    await pty.closed.promise
    expect(onEvent).not.toHaveBeenCalled()
    await expect(host.closeTerminal(terminal.id)).rejects.toThrow()
  })
  nodeNativeTest('H09 real child output has a combined stdout and stderr cap', async () => {
    const { host } = await setup()
    await expect(
      host.run(
        {
          id: 'flood',
          workspaceId: 'workspace',
          cwd: null,
          argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(1048577))'],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })
  it('H13 consumer rejection terminates the PTY; write/resize/close keep their bounds', async () => {
    const { host, pty } = await setup()
    const terminal = await host.openTerminal(
      'workspace',
      { cols: 80, rows: 24 },
      () => Promise.reject(new Error('test consumer rejection')),
      new AbortController().signal,
    )
    await host.writeTerminal(terminal.id, 'hello')
    await host.resizeTerminal(terminal.id, { cols: 100, rows: 30 })
    expect(pty.input).toEqual(['hello'])
    expect(pty.sizes).toEqual([[100, 30]])
    await expect(host.writeTerminal(terminal.id, 'x'.repeat(16_385))).rejects.toThrow()
    await expect(host.resizeTerminal(terminal.id, { cols: 1001, rows: 30 })).rejects.toThrow()
    pty.push('output')
    await pty.closed.promise
    await expect(host.closeTerminal(terminal.id)).rejects.toThrow('test consumer rejection')
    await host.closeTerminal(terminal.id)
  })
  nodeNativeTest('H08 stop cancels a real running child and waits for disposal', async () => {
    const { host } = await setup()
    const running = expect(
      host.run(
        { id: 'run', workspaceId: 'workspace', cwd: null, argv: ['/bin/sh', '-c', 'sleep 30'] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    // Give filesystem resolution and actual spawn one event-loop turn.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await host.stopAll('locked')
    await running
    await expect(
      host.run(
        { id: 'run2', workspaceId: 'workspace', cwd: null, argv: ['/bin/true'] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })
})
