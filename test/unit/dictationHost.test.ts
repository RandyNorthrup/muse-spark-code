import { EventEmitter } from 'node:events'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import {
  createDictationSetup,
  type HelperProcess,
  spawnHelper,
} from '../../src/host/voice/dictationHost'

// The three pieces of `vscode` the setup reads (M26): where the extension
// host runs (its kind and the window's remote) and the editor's name. The
// shared mock has no `env`; this file supplies its own.
const window = vi.hoisted(() => {
  const state: { remoteName: string | undefined; extensionKind: number } = {
    remoteName: undefined,
    extensionKind: 1,
  }
  return state
})
vi.mock('vscode', () => ({
  ExtensionKind: { UI: 1, Workspace: 2 },
  env: {
    get remoteName() {
      return window.remoteName
    },
    appName: 'Visual Studio Code',
  },
  extensions: { getExtension: () => ({ extensionKind: window.extensionKind }) },
}))

// A stand-in helper in Node itself: echoes each stdin line as a protocol
// "text" line, writes to stderr on "warn", exits on "quit".
const ECHO_HELPER = String.raw`
  process.stdin.setEncoding("utf8");
  let tail = "";
  process.stdin.on("data", (chunk) => {
    tail += chunk;
    const lines = tail.split("\n"); tail = lines.pop();
    for (const line of lines) {
      if (line === "quit") { process.exit(3); }
      if (line === "warn") { process.stderr.write("careful\n"); continue; }
      process.stdout.write(JSON.stringify({ type: "text", text: line }) + "\n");
    }
  });`

/**
 * A helper process whose stdin pipe is broken, as it is once the helper has
 * died but before Node reports the exit: every write fails with EPIPE, which
 * a real `Writable` emits as an 'error' event. (A live child that merely
 * closes its end does not fail the write on Windows, so a real process
 * cannot stand in portably.)
 */
class BrokenPipeProcess extends EventEmitter implements HelperProcess {
  public readonly written: string[] = []
  public killCount = 0
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()
  public readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, callback) => {
      this.written.push(chunk.toString('utf8'))
      callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    },
  })

  public kill(): boolean {
    this.killCount += 1
    return true
  }
}

function collect(source: {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
}) {
  const chunks: string[] = []
  source.on('data', (chunk) => {
    chunks.push(String(chunk))
  })
  return chunks
}

describe('spawnHelper', () => {
  it('pipes commands in, output and stderr out, and reports the exit once', async () => {
    const child = spawnHelper({ command: process.execPath, args: ['-e', ECHO_HELPER] })
    const out = collect(child.stdout)
    const err = collect(child.stderr)
    const exited = new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    child.send('hello')
    child.send('warn')
    child.send('quit')
    expect(await exited).toBe('exit code 3')
    expect(out.join('')).toBe('{"type":"text","text":"hello"}\n')
    expect(err.join('')).toBe('careful\n')
  })

  it('reports a command that cannot start', async () => {
    const child = spawnHelper({
      command: path.join('definitely', 'missing', 'muse-dictate-helper'),
      args: [],
    })
    const exited = new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    expect(await exited).toMatch(/^could not start: /)
  })

  it('kill ends the helper with a signal', async () => {
    const child = spawnHelper({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    const exited = new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    child.kill()
    expect(await exited).toMatch(/^(signal SIGTERM|exit code 1)$/)
  })

  it('gives the helper its environment on top of the host’s (M26)', async () => {
    const child = spawnHelper({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write(`${process.env.MUSE_DICTATION_PROBE}|${process.env.PATH ? "path" : ""}`)',
      ],
      environment: { MUSE_DICTATION_PROBE: 'set' },
    })
    const out = collect(child.stdout)
    await new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    expect(out.join('')).toBe('set|path')
  })

  it('survives a write into a broken pipe, ends the helper and writes nothing more (M26)', async () => {
    const helper = new BrokenPipeProcess()
    const child = spawnHelper({ command: 'helper', args: [] }, () => helper)
    const exited = new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    // Without the stream's 'error' listener the failed write is an uncaught
    // exception, which fails this run.
    child.send('start')
    await vi.waitFor(() => {
      expect(helper.killCount).toBe(1)
    })
    child.send('stop')
    helper.emit('exit', null, 'SIGTERM')
    expect(await exited).toBe('signal SIGTERM (stdin: write EPIPE)')
    child.send('late')
    expect(helper.written).toEqual(['start\n'])
  })
})

describe('createDictationSetup', () => {
  const logged: string[] = []
  const record = (message: string) => {
    logged.push(message)
  }
  const log: CoreLogger = { trace: record, info: record, warn: record, error: record }
  const windows = {
    platform: 'win32',
    systemRoot: String.raw`C:\Windows`,
    helperDir: 'native',
  } as const

  beforeEach(() => {
    window.remoteName = undefined
    window.extensionKind = 1
  })

  it('is unavailable on Linux with the reason logged', () => {
    const setup = createDictationSetup(
      { platform: 'linux', systemRoot: undefined, helperDir: 'native' },
      log,
    )
    expect(setup.isAvailable).toBe(false)
    expect(logged.at(-1)).toMatch(/^Voice dictation unavailable: .*Linux/)
  })

  it('creates a driver bound to the platform helper on Windows', () => {
    const setup = createDictationSetup(windows, log)
    expect(setup.isAvailable).toBe(true)
    if (!setup.isAvailable) {
      return
    }
    const driver = setup.create({
      onStatus: () => undefined,
      onText: () => undefined,
      onError: () => undefined,
    })
    // Nothing is spawned until the first start.
    driver.dispose()
  })

  it('is unavailable when the extension runs on the remote side of a remote window (M26)', () => {
    window.remoteName = 'ssh-remote'
    window.extensionKind = 2
    const setup = createDictationSetup(windows, log)
    expect(setup).toMatchObject({ isAvailable: false })
    expect(logged.at(-1)).toMatch(/^Voice dictation unavailable: .*remote window/)
  })

  it('stays available in the local extension host of a remote window (M26)', () => {
    window.remoteName = 'ssh-remote'
    window.extensionKind = 1
    expect(createDictationSetup(windows, log).isAvailable).toBe(true)
  })
})
