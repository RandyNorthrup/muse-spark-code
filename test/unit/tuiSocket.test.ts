import { lstat, chmod, mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { createServer, createConnection, type Socket, type Server } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, afterEach } from 'vitest'
import { connectTuiSocket, checkTuiSocket } from '../../src/runtime/tui/socket'
import {
  tuiActionSchema,
  tuiEventSchema,
  type TuiAction,
  type TuiEvent,
  type TuiWireBinding,
} from '../../src/runtime/tui/protocol'
import { TUI_LIMITS, UI_TEXT } from '../../src/shared/constants'
import { runLocalTui } from '../../src/runtime/tui/entry'
import { createTuiTerminal } from '../../src/runtime/tui/terminal'
import { EN } from '../../src/shared/l10n/en'
import { recordCalls } from './helpers/recordCalls'

const isWindows = process.platform === 'win32'
const directories: string[] = []
const servers: Server[] = []
const sockets: Socket[] = []
const accepted: Socket[] = []
const fixtureUid = process.getuid?.() ?? 1000
// The product's own wire binding: real schemas, no stand-in protocol.
const binding: TuiWireBinding = {
  decode: (frame) => tuiEventSchema.parse(frame),
  encode: (action) => tuiActionSchema.parse(action),
}

/** The peer side, not the product callback, observes these frames. */
function ignoreEvent(): void {
  return undefined
}

async function waitForSocket(description: string, check: () => void): Promise<void> {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() > deadline)
        throw new Error(
          `${description}: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        )
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

async function socketFixture() {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  const dir = await mkdtemp(path.join(process.cwd(), 'temp', 'm110t-'))
  directories.push(dir)
  await chmod(dir, 0o700)
  const socketPath = path.join(dir, 'node.sock')
  const endpoint = isWindows ? `\\\\.\\pipe\\${path.basename(dir)}` : socketPath
  if (isWindows) await writeFile(socketPath, '')
  const server = createServer((socket) => {
    accepted.push(socket)
    sockets.push(socket)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
  if (!isWindows) await chmod(socketPath, 0o600)
  const reported = recordCalls<[unknown]>()
  const start = (
    receive: (event: TuiEvent) => void = ignoreEvent,
    wire: TuiWireBinding = binding,
    signal: AbortSignal = new AbortController().signal,
    report: (error: unknown) => void = reported.fn,
  ) => connectTuiSocket({ socketPath, uid: fixtureUid, binding: wire, receive, signal, report })
  return {
    dir,
    socketPath,
    endpoint,
    peer: () => accepted.at(-1),
    start,
    reported,
    async open(
      receive: (event: TuiEvent) => void = ignoreEvent,
      wire: TuiWireBinding = binding,
      signal: AbortSignal = new AbortController().signal,
      report: (error: unknown) => void = reported.fn,
    ) {
      const before = accepted.length
      const connection = await start(receive, wire, signal, report)
      await waitForSocket('peer accepted', () => {
        expect(accepted.length).toBeGreaterThan(before)
      })
      return connection
    },
  }
}

async function expectInvalidClose(pending: Promise<void>, send: () => void): Promise<void> {
  let reason: unknown
  const observed = (async () => {
    try {
      await pending
    } catch (error: unknown) {
      reason = error
    }
  })()
  send()
  await waitForSocket('invalid frame closes', () => {
    expect(reason).toMatchObject({ message: UI_TEXT.tuiInvalidFrame })
  })
  await observed
}

afterEach(async () => {
  accepted.length = 0
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  for (const dir of directories.splice(0)) await rm(dir, { force: true, recursive: true })
})

describe('M110 T local socket refusals', () => {
  it('refuses network paths, relative paths, missing files and unknown owners', async () => {
    const f = await socketFixture()
    await expect(checkTuiSocket('127.0.0.1:8000', fixtureUid)).rejects.toThrow(
      UI_TEXT.tuiUnsafeSocket,
    )
    await expect(checkTuiSocket('relative/path.sock', fixtureUid)).rejects.toThrow(
      UI_TEXT.tuiUnsafeSocket,
    )
    await expect(checkTuiSocket(path.join(f.dir, 'absent.sock'), fixtureUid)).rejects.toThrow()
    await expect(checkTuiSocket(f.socketPath, undefined)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await expect(checkTuiSocket(f.socketPath, fixtureUid + 1)).rejects.toThrow(
      UI_TEXT.tuiUnsafeSocket,
    )
  })
})

describe.runIf(!isWindows)('M110 T owner-only local socket admission', () => {
  it('uses a native endpoint without widening POSIX socket admission', async () => {
    const f = await socketFixture()
    expect(servers.at(-1)?.address()).toBe(f.socketPath)
    await expect(checkTuiSocket(f.socketPath, undefined)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    const connection = await f.open()
    connection.close()
    await expect(connection.closed).resolves.toBeUndefined()
  })
  it('streams fragmented/coalesced UTF-8 frames and sends a validated action on the local socket', async () => {
    const f = await socketFixture()
    const received = recordCalls<[TuiEvent]>()
    const connection = await f.open(received.fn)
    const event = { type: 'chat', id: 'm', role: 'agent', text: '日本語', delta: true }
    const bytes = Buffer.from(
      `${JSON.stringify(event)}\n${JSON.stringify({ type: 'settled', id: 'p' })}\n`,
    )
    const split = bytes.indexOf(Buffer.from('日本語')) + 1
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    peerSocket?.write(bytes.subarray(0, split))
    peerSocket?.write(bytes.subarray(split))
    await waitForSocket('fragmented frames arrive', () => {
      expect(received.calls).toHaveLength(2)
    })
    expect(received.calls).toContainEqual([event])
    const request = new Promise<string>((resolve) => {
      peerSocket?.once('data', (data: Buffer) => {
        resolve(data.toString())
      })
    })
    connection.send({ type: 'stop', scope: 'all' })
    expect(await request).toBe('{"type":"stop","scope":"all"}\n')
    connection.close()
    await expect(connection.closed).resolves.toBeUndefined()
  })
  it('refuses exposed directories, exposed sockets, wrong owner, links and regular files', async () => {
    const f = await socketFixture()
    await expect(checkTuiSocket(f.socketPath, fixtureUid)).resolves.toBeUndefined()
    await chmod(f.dir, 0o755)
    await expect(checkTuiSocket(f.socketPath, fixtureUid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await chmod(f.dir, 0o700)
    await chmod(f.socketPath, 0o666)
    await expect(checkTuiSocket(f.socketPath, fixtureUid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await chmod(f.socketPath, 0o600)
    await expect(checkTuiSocket(f.socketPath, fixtureUid + 1)).rejects.toThrow(
      UI_TEXT.tuiUnsafeSocket,
    )
    const link = `${f.socketPath}.link`
    await symlink(f.socketPath, link)
    await expect(checkTuiSocket(link, fixtureUid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await rm(link)
    const regular = path.join(f.dir, 'regular')
    await writeFile(regular, 'x')
    await chmod(regular, 0o600)
    await expect(checkTuiSocket(regular, fixtureUid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await expect(checkTuiSocket(f.socketPath, fixtureUid)).resolves.toBeUndefined()
  })
  it.each(['invalid-json', 'invalid-projection', 'invalid-utf8', 'over-cap'])(
    'closes without displaying %s bytes',
    async (kind) => {
      const f = await socketFixture()
      const received = recordCalls<[TuiEvent]>()
      const connection = await f.open(received.fn)
      const peerSocket = f.peer()
      expect(peerSocket).toBeDefined()
      await expectInvalidClose(connection.closed, () => {
        switch (kind) {
          case 'invalid-json': {
            peerSocket?.write('not json with account label\n')
            break
          }
          case 'invalid-projection': {
            peerSocket?.write('{"type":"unknown"}\n')
            break
          }
          case 'invalid-utf8': {
            const valid = Buffer.from(
              '{"type":"chat","id":"m","role":"agent","text":"A","delta":true}\n',
            )
            valid[valid.indexOf('A')] = 0xff
            peerSocket?.write(valid)
            break
          }
          case 'over-cap': {
            peerSocket?.write('x'.repeat(TUI_LIMITS.frameBytes + 1))
            break
          }
        }
      })
      expect(received.calls).toEqual([])
      expect(f.reported.calls).toEqual([])
    },
  )
  it('decoder is mandatory and encoder output is capped', async () => {
    const f = await socketFixture()
    const seen: unknown[] = []
    const connection = await connectTuiSocket({
      socketPath: f.socketPath,
      uid: fixtureUid,
      binding: {
        ...binding,
        decode: (frame: unknown) => {
          seen.push(frame)
          throw new Error('binding rejected')
        },
      },
      receive: ignoreEvent,
      signal: new AbortController().signal,
      report: f.reported.fn,
    })
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    const failure = expect(connection.closed).rejects.toThrow(UI_TEXT.tuiInvalidFrame)
    peerSocket?.write('{}\n')
    await failure
    expect(seen).toEqual([{}])
    expect(f.reported.calls).toHaveLength(1)
    const other = await connectTuiSocket({
      socketPath: f.socketPath,
      uid: fixtureUid,
      binding: { ...binding, encode: () => 'x'.repeat(TUI_LIMITS.frameBytes + 1) },
      receive: ignoreEvent,
      signal: new AbortController().signal,
      report: f.reported.fn,
    })
    expect(() => {
      other.send({ type: 'stop', scope: 'all' })
    }).toThrow(UI_TEXT.tuiInvalidFrame)
    await expect(other.closed).rejects.toThrow(UI_TEXT.tuiInvalidFrame)
  })
  it('abort, peer closure and send after closure cannot become empty successes', async () => {
    const f = await socketFixture()
    const abort = new AbortController()
    const connection = await connectTuiSocket({
      socketPath: f.socketPath,
      uid: fixtureUid,
      binding,
      receive: ignoreEvent,
      signal: abort.signal,
      report: f.reported.fn,
    })
    const failure = expect(connection.closed).rejects.toThrow(UI_TEXT.tuiDisconnected)
    abort.abort()
    await failure
    expect(() => {
      connection.send({ type: 'stop', scope: 'all' })
    }).toThrow(UI_TEXT.tuiDisconnected)
    await expect(
      connectTuiSocket({
        socketPath: f.socketPath,
        uid: fixtureUid,
        binding,
        receive: ignoreEvent,
        signal: abort.signal,
        report: f.reported.fn,
      }),
    ).rejects.toThrow()
    const other = await f.open()
    const ended = expect(other.closed).rejects.toThrow(UI_TEXT.tuiDisconnected)
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    peerSocket?.end()
    await ended
    expect(f.reported.calls).toEqual([])
  })
  it('the lazy entry runs a complete local socket session with streaming output, explicit consent and Stop', async () => {
    const f = await socketFixture()
    const rawModes: unknown[] = []
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: (isRaw: boolean) => {
        rawModes.push(isRaw)
      },
    })
    const output = Object.assign(new PassThrough(), { isTTY: true })
    const signals = new EventEmitter()
    let screen = ''
    output.on('data', (bytes: Buffer) => {
      screen += bytes.toString()
    })
    const run = runLocalTui({
      argv: ['--screen-reader'],
      env: { NO_COLOR: '' },
      socketPath: f.socketPath,
      uid: fixtureUid,
      signal: new AbortController().signal,
      binding,
      ink: undefined,
      terminal: createTuiTerminal(input, output, signals),
      table: EN,
      locale: 'en',
      now: () => 1000,
    })
    await waitForSocket('line keys shown', () => {
      expect(screen).toContain(UI_TEXT.tuiLineKeys)
    })
    const requests: unknown[] = []
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    peerSocket?.on('data', (bytes: Buffer) => {
      for (const line of bytes.toString().trim().split('\n')) requests.push(JSON.parse(line))
    })
    peerSocket?.write(
      `${JSON.stringify({ type: 'chat', id: 'm', role: 'agent', text: 'local reply', delta: true })}\n${JSON.stringify({ type: 'ask', ask: { kind: 'paid', id: 'paid', digest: 'exact', expiresAt: 5000, title: 'Image', detail: 'Draw', price: '$0.04', dailyBudgetUsd: 1 } })}\n`,
    )
    await waitForSocket('paid ask shown', () => {
      expect(screen).toContain(`3. ${UI_TEXT.paidDeny}`)
    })
    input.write('\n')
    expect(requests).toEqual([])
    await new Promise((resolve) => {
      setTimeout(resolve, TUI_LIMITS.decisionQuietMs + 1)
    })
    input.write('\t')
    await new Promise((resolve) => {
      setTimeout(resolve, TUI_LIMITS.decisionQuietMs + 1)
    })
    input.write('3')
    input.write('\u{1B}')
    await waitForSocket('answer and stop sent', () => {
      expect(requests).toEqual([
        { type: 'answer', id: 'paid', digest: 'exact', expiresAt: 5000, choice: 'deny' },
        { type: 'stop', scope: 'all' },
      ])
    })
    input.end()
    expect(await run).toBe(0)
    expect(screen).not.toContain(UI_TEXT.tuiUnexpectedFailure)
    expect(screen).toContain('Agent: local reply')
    expect(screen.replaceAll('\u{1B}[?2004h', '').replaceAll('\u{1B}[?2004l', '')).not.toContain(
      '\u{1B}',
    )
    expect(rawModes.length).toBeGreaterThan(0)
    input.destroy()
    output.destroy()
  })
  it('rejects an invalid projection even if a binding returns a typed value without validation', async () => {
    const f = await socketFixture()
    const received = recordCalls<[TuiEvent]>()
    const connection = await connectTuiSocket({
      socketPath: f.socketPath,
      uid: fixtureUid,
      binding: {
        ...binding,
        decode: () => ({
          type: 'status',
          node: 'node',
          attended: true,
          cpuPercent: -1,
          memoryBytes: 0,
          sealed: true,
        }),
      },
      receive: received.fn,
      signal: new AbortController().signal,
      report: f.reported.fn,
    })
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    await expectInvalidClose(connection.closed, () => {
      peerSocket?.write('{}\n')
    })
    expect(received.calls).toEqual([])
    expect(f.reported.calls).toEqual([])
  })
  it('the lazy entry reports a binding failure once, without its raw text', async () => {
    const f = await socketFixture()
    const input = Object.assign(new PassThrough(), { isTTY: true })
    const output = Object.assign(new PassThrough(), { isTTY: true })
    const signals = new EventEmitter()
    let screen = ''
    output.on('data', (bytes: Buffer) => {
      screen += bytes.toString()
    })
    const run = runLocalTui({
      argv: ['--screen-reader'],
      env: {},
      socketPath: f.socketPath,
      uid: fixtureUid,
      signal: new AbortController().signal,
      binding: {
        ...binding,
        decode: () => {
          throw new Error('test binding failure with account label')
        },
      },
      ink: undefined,
      terminal: createTuiTerminal(input, output, signals),
      table: EN,
      locale: 'en',
      now: () => 1000,
    })
    await waitForSocket('line keys shown', () => {
      expect(screen).toContain(UI_TEXT.tuiLineKeys)
    })
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    peerSocket?.write('{}\n')
    expect(await run).toBe(1)
    expect(screen).toContain(UI_TEXT.tuiUnexpectedFailure)
    expect(screen).not.toContain('test binding failure')
    input.destroy()
    output.destroy()
  })
  it('validates outbound messages before encoding and never writes an oversized draft', async () => {
    const f = await socketFixture()
    const encoded: unknown[] = []
    const connection = await f.open(ignoreEvent, {
      ...binding,
      encode: (action: TuiAction) => {
        encoded.push(action)
        return binding.encode(action)
      },
    })
    expect(() => {
      connection.send({ type: 'message', text: 'x'.repeat(TUI_LIMITS.inputChars + 1) })
    }).toThrow()
    expect(encoded).toEqual([])
    connection.close()
    await connection.closed
  })
  it('a stalled peer applies real backpressure to outbound frames', async () => {
    const f = await socketFixture()
    const connection = await f.open()
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    // The peer never reads: the kernel buffers are finite, so the product's
    // own writable-length guard must eventually refuse a further frame.
    let didRefuse = false
    for (let round = 0; !didRefuse && round < 3000; round++) {
      try {
        connection.send({ type: 'message', text: 'x'.repeat(8000) })
      } catch (error) {
        expect((error as Error).message).toBe(UI_TEXT.tuiInvalidFrame)
        didRefuse = true
      }
    }
    expect(didRefuse).toBe(true)
    await expect(connection.closed).rejects.toThrow(UI_TEXT.tuiInvalidFrame)
  })
})

describe.runIf(isWindows)('M110 T named pipe transport', () => {
  it('exchanges framed events over a real named pipe', async () => {
    const f = await socketFixture()
    expect(servers.at(-1)?.address()).toBe(f.endpoint)
    const received: TuiEvent[] = []
    let buffer = ''
    const client = createConnection({ path: f.endpoint })
    sockets.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve)
      client.once('error', reject)
    })
    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        received.push(tuiEventSchema.parse(binding.decode(JSON.parse(buffer.slice(0, newline)))))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    })
    const event = { type: 'chat', id: 'm', role: 'agent', text: 'over the pipe', delta: true }
    const peerSocket = f.peer()
    expect(peerSocket).toBeDefined()
    peerSocket?.write(`${JSON.stringify(event)}\n`)
    await waitForSocket('pipe event arrives', () => {
      expect(received).toEqual([event])
    })
    const seen = new Promise<string>((resolve) => {
      peerSocket?.once('data', (data: Buffer) => {
        resolve(data.toString())
      })
    })
    const action = tuiActionSchema.parse({ type: 'stop', scope: 'all' })
    client.write(`${JSON.stringify(binding.encode(action))}\n`)
    expect(await seen).toBe('{"type":"stop","scope":"all"}\n')
    client.destroy()
  })
  it('windows admission stays refused until T-LAUNCH binds owner and mode semantics', async () => {
    const f = await socketFixture()
    const stats = await lstat(f.dir)
    await expect(checkTuiSocket(f.socketPath, stats.uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
  })
})
