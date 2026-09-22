import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { createDictationSetup, spawnHelper } from '../../src/host/voice/dictationHost'

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
})

describe('createDictationSetup', () => {
  const logged: string[] = []
  const record = (message: string) => {
    logged.push(message)
  }
  const log: CoreLogger = { info: record, warn: record, error: record }

  it('is unavailable on Linux with the reason logged', () => {
    const setup = createDictationSetup(
      { platform: 'linux', systemRoot: undefined, helperDir: 'native' },
      log,
    )
    expect(setup.isAvailable).toBe(false)
    expect(logged.at(-1)).toMatch(/^Voice dictation unavailable: .*Linux/)
  })

  it('creates a driver bound to the platform helper on Windows', () => {
    const setup = createDictationSetup(
      { platform: 'win32', systemRoot: String.raw`C:\Windows`, helperDir: 'native' },
      log,
    )
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
})
