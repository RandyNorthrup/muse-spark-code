import { lstat } from 'node:fs/promises'
import type * as Fs from 'node:fs/promises'
import type * as Net from 'node:net'
import { runLocalTui } from '../../src/runtime/tui/entry'
import { createTuiTerminal } from '../../src/runtime/tui/terminal'
import { EN } from '../../src/shared/l10n/en'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import process from 'node:process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, createConnection, Socket, type Server } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectTuiSocket, checkTuiSocket } from '../../src/runtime/tui/socket'
import {
  tuiActionSchema,
  tuiEventSchema,
  type TuiWireBinding,
} from '../../src/runtime/tui/protocol'
import { TUI_LIMITS, UI_TEXT } from '../../src/shared/constants'

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof Net>()
  return { ...actual, createConnection: vi.fn(actual.createConnection) }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const directories: string[] = []
const servers: Server[] = []
const clients: Socket[] = []
const fixtureUid = process.getuid?.() ?? 1000
const filesystem = new Map<string, Awaited<ReturnType<typeof lstat>>>()
// A private fake protocol, explicitly not an MHP fixture.
const binding: TuiWireBinding = {
  decode: (frame) => tuiEventSchema.parse(frame),
  encode: (action) => tuiActionSchema.parse(action),
}
async function socketFixture() {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  const dir = await mkdtemp(path.join(process.cwd(), 'temp', 'm110t-'))
  directories.push(dir)
  await chmod(dir, 0o700)
  const socketPath = path.join(dir, 'node.sock')
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${path.basename(dir)}` : socketPath
  if (process.platform === 'win32') {
    // Windows transport is real; POSIX ownership/type checks use explicit seams.
    await writeFile(socketPath, '')
    const parent = await lstat(dir)
    const socket = await lstat(socketPath)
    parent.uid = fixtureUid
    parent.mode = 0o4_0700
    socket.uid = fixtureUid
    socket.mode = 0o14_0600
    socket.isSocket = () => true
    filesystem.set(dir, parent)
    filesystem.set(socketPath, socket)
    const realFs = await vi.importActual<typeof Fs>('node:fs/promises')
    vi.mocked(lstat).mockImplementation(
      async (file, options) => filesystem.get(String(file)) ?? (await realFs.lstat(file, options)),
    )
    const realNet = await vi.importActual<typeof Net>('node:net')
    vi.mocked(createConnection).mockImplementation(() =>
      realNet.createConnection({ path: endpoint }),
    )
  }
  let peer: Socket | undefined
  const server = createServer((socket) => {
    clients.push(socket)
    peer = socket
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
  if (process.platform !== 'win32') await chmod(socketPath, 0o600)
  const start = (receive = vi.fn(), wire = binding, signal = new AbortController().signal) =>
    connectTuiSocket({ socketPath, uid: fixtureUid, binding: wire, receive, signal })
  return {
    dir,
    socketPath,
    peer: () => peer,
    start,
    async open(receive = vi.fn(), wire = binding, signal = new AbortController().signal) {
      const previous = peer
      const connection = await start(receive, wire, signal)
      await vi.waitFor(() => {
        expect(peer).toBeDefined()
        expect(peer).not.toBe(previous)
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
  await vi.waitFor(() => {
    expect(reason).toMatchObject({ message: UI_TEXT.tuiInvalidFrame })
  })
  await observed
}
afterEach(async () => {
  vi.useRealTimers()
  vi.mocked(createConnection).mockClear()
  vi.mocked(lstat).mockReset()
  const realFs = await vi.importActual<typeof Fs>('node:fs/promises')
  vi.mocked(lstat).mockImplementation(realFs.lstat)
  filesystem.clear()
  for (const socket of clients.splice(0)) socket.destroy()
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  for (const dir of directories.splice(0)) await rm(dir, { force: true, recursive: true })
})

describe('M110 T owner-only local socket', () => {
  it('uses a native endpoint on every platform without widening POSIX socket admission', async () => {
    const f = await socketFixture()
    const address = servers.at(-1)?.address()
    expect(typeof address).toBe('string')
    if (process.platform === 'win32') {
      expect(address).toBe(`\\\\.\\pipe\\${path.basename(f.dir)}`)
      await expect(checkTuiSocket(f.socketPath, undefined)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    } else expect(address).toBe(f.socketPath)
    const connection = await f.open()
    connection.close()
    await expect(connection.closed).resolves.toBeUndefined()
  })
  it('streams fragmented/coalesced UTF-8 frames and sends a validated action on the local socket', async () => {
    const f = await socketFixture()
    const receive = vi.fn()
    const connection = await f.open(receive)
    const event = { type: 'chat', id: 'm', role: 'agent', text: '日本語', delta: true }
    const bytes = Buffer.from(
      `${JSON.stringify(event)}\n${JSON.stringify({ type: 'settled', id: 'p' })}\n`,
    )
    const split = bytes.indexOf(Buffer.from('日本語')) + 1
    f.peer()?.write(bytes.subarray(0, split))
    f.peer()?.write(bytes.subarray(split))
    await vi.waitFor(() => {
      expect(receive).toHaveBeenCalledTimes(2)
    })
    expect(receive).toHaveBeenCalledWith(event)
    const request = new Promise<string>((resolve) => {
      f.peer()?.once('data', (data: Buffer) => {
        resolve(data.toString())
      })
    })
    connection.send({ type: 'stop', scope: 'all' })
    expect(await request).toBe('{"type":"stop","scope":"all"}\n')
    connection.close()
    await expect(connection.closed).resolves.toBeUndefined()
  })
  it('refuses exposed directories, exposed sockets, wrong owner, links, regular files and network paths', async () => {
    const f = await socketFixture()
    const uid = fixtureUid
    const parent = await lstat(f.dir)
    const socket = await lstat(f.socketPath)
    vi.mocked(lstat).mockImplementation((file) =>
      Promise.resolve(String(file) === f.dir ? parent : socket),
    )
    await expect(checkTuiSocket(f.socketPath, uid)).resolves.toBeUndefined()
    parent.mode = 0o4_0755
    await expect(checkTuiSocket(f.socketPath, uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    parent.mode = 0o4_0700
    socket.mode = 0o14_0666
    await expect(checkTuiSocket(f.socketPath, uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    socket.mode = 0o14_0600
    await expect(checkTuiSocket(f.socketPath, uid + 1)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    vi.spyOn(socket, 'isSymbolicLink').mockReturnValueOnce(true)
    await expect(checkTuiSocket(f.socketPath, uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    vi.spyOn(socket, 'isSocket').mockReturnValueOnce(false)
    await expect(checkTuiSocket(f.socketPath, uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await expect(checkTuiSocket('127.0.0.1:8000', uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    await expect(checkTuiSocket(f.socketPath, undefined)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
  })
  it.each(['invalid-json', 'invalid-projection', 'invalid-utf8', 'over-cap'])(
    'closes without displaying %s bytes',
    async (kind) => {
      const f = await socketFixture()
      const receive = vi.fn()
      const connection = await f.open(receive)
      await vi.waitFor(() => {
        expect(f.peer()).toBeDefined()
      })
      await expectInvalidClose(connection.closed, () => {
        switch (kind) {
          case 'invalid-json': {
            f.peer()?.write('not json with account label\n')
            break
          }
          case 'invalid-projection': {
            f.peer()?.write('{"type":"unknown"}\n')
            break
          }
          case 'invalid-utf8': {
            const valid = Buffer.from(
              '{"type":"chat","id":"m","role":"agent","text":"A","delta":true}\n',
            )
            valid[valid.indexOf('A')] = 0xff
            f.peer()?.write(valid)
            break
          }
          case 'over-cap': {
            f.peer()?.write('x'.repeat(TUI_LIMITS.frameBytes + 1))
            break
          }
        }
      })
      expect(receive).not.toHaveBeenCalled()
    },
  )
  it('decoder is mandatory and encoder output is capped', async () => {
    const f = await socketFixture()
    const decode = vi.fn(() => {
      throw new Error('binding rejected')
    })
    const connection = await connectTuiSocket({
      socketPath: f.socketPath,
      uid: fixtureUid,
      binding: { ...binding, decode },
      receive: vi.fn(),
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => {
      expect(f.peer()).toBeDefined()
    })
    const failure = expect(connection.closed).rejects.toThrow(UI_TEXT.tuiInvalidFrame)
    f.peer()?.write('{}\n')
    await failure
    expect(decode).toHaveBeenCalledWith({})
    const other = await connectTuiSocket({
      socketPath: f.socketPath,
      uid: fixtureUid,
      binding: { ...binding, encode: () => 'x'.repeat(TUI_LIMITS.frameBytes + 1) },
      receive: vi.fn(),
      signal: new AbortController().signal,
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
      receive: vi.fn(),
      signal: abort.signal,
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
        receive: vi.fn(),
        signal: abort.signal,
      }),
    ).rejects.toThrow()
    const other = await f.open()
    const ended = expect(other.closed).rejects.toThrow(UI_TEXT.tuiDisconnected)
    f.peer()?.end()
    await ended
  })
  it('the lazy entry runs a complete local fake socket session with streaming output, explicit consent and Stop', async () => {
    const f = await socketFixture()
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() })
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
    await vi.waitFor(() => {
      expect(screen).toContain(UI_TEXT.tuiLineKeys)
    })
    const requests: unknown[] = []
    f.peer()?.on('data', (bytes: Buffer) => {
      for (const line of bytes.toString().trim().split('\n')) requests.push(JSON.parse(line))
    })
    f.peer()?.write(
      `${JSON.stringify({ type: 'chat', id: 'm', role: 'agent', text: 'local reply', delta: true })}\n${JSON.stringify({ type: 'ask', ask: { kind: 'paid', id: 'paid', digest: 'exact', expiresAt: 5000, title: 'Image', detail: 'Draw', price: '$0.04', dailyBudgetUsd: 1 } })}\n`,
    )
    await vi.waitFor(() => {
      expect(screen).toContain('3. Deny')
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
    await vi.waitFor(() => {
      expect(requests).toEqual([
        { type: 'answer', id: 'paid', digest: 'exact', expiresAt: 5000, choice: 'deny' },
        { type: 'stop', scope: 'all' },
      ])
    })
    input.end()
    expect(await run).toBe(0)
    expect(screen).toContain('Agent: local reply')
    expect(screen.replaceAll('\u{1B}[?2004h', '').replaceAll('\u{1B}[?2004l', '')).not.toContain(
      '\u{1B}',
    )
    input.destroy()
    output.destroy()
  })
  it('rejects an invalid projection even if a binding returns a typed value without validation', async () => {
    const f = await socketFixture()
    const receive = vi.fn()
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
      receive,
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => {
      expect(f.peer()).toBeDefined()
    })
    await expectInvalidClose(connection.closed, () => {
      f.peer()?.write('{}\n')
    })
    expect(receive).not.toHaveBeenCalled()
  })
  it('bounds a connect that never emits and cleans up its timeout', async () => {
    const f = await socketFixture()
    const pendingSocket = new Socket()
    clients.push(pendingSocket)
    vi.mocked(createConnection).mockImplementationOnce(() => pendingSocket)
    vi.useFakeTimers()
    let reason: unknown
    const observed = (async () => {
      try {
        await connectTuiSocket({
          socketPath: f.socketPath,
          uid: fixtureUid,
          binding,
          receive: vi.fn(),
          signal: new AbortController().signal,
        })
      } catch (error: unknown) {
        reason = error
      }
    })()
    await vi.waitFor(() => {
      expect(createConnection).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(TUI_LIMITS.connectMs)
    expect(reason).toMatchObject({ message: UI_TEXT.tuiDisconnected })
    await observed
    expect(pendingSocket.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('validates outbound messages before encoding and never writes an oversized draft', async () => {
    const f = await socketFixture()
    const encode = vi.fn(binding.encode)
    const connection = await f.open(vi.fn(), { ...binding, encode })
    expect(() => {
      connection.send({ type: 'message', text: 'x'.repeat(TUI_LIMITS.inputChars + 1) })
    }).toThrow()
    expect(encode).not.toHaveBeenCalled()
    connection.close()
    await connection.closed
  })
  it('socket and directory ownership are checked independently', async () => {
    const f = await socketFixture()
    const uid = fixtureUid
    const parent = await lstat(f.dir)
    const nodeSocket = await lstat(f.socketPath)
    nodeSocket.uid = uid + 1
    vi.mocked(lstat).mockResolvedValueOnce(parent).mockResolvedValueOnce(nodeSocket)
    await expect(checkTuiSocket(f.socketPath, uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
    nodeSocket.uid = uid
    parent.uid = uid + 1
    vi.mocked(lstat).mockResolvedValueOnce(parent).mockResolvedValueOnce(nodeSocket)
    await expect(checkTuiSocket(f.socketPath, uid)).rejects.toThrow(UI_TEXT.tuiUnsafeSocket)
  })
  it('a stalled socket cannot queue more outbound frames', async () => {
    const f = await socketFixture()
    const stalled = new Socket()
    vi.spyOn(stalled, 'writableLength', 'get').mockReturnValue(TUI_LIMITS.frameBytes + 1)
    clients.push(stalled)
    vi.mocked(createConnection).mockImplementationOnce(() => stalled)
    const opening = f.start()
    await vi.waitFor(() => {
      expect(createConnection).toHaveBeenCalled()
    })
    stalled.emit('connect')
    const connection = await opening
    expect(() => {
      connection.send({ type: 'stop', scope: 'all' })
    }).toThrow(UI_TEXT.tuiInvalidFrame)
    await expect(connection.closed).rejects.toThrow(UI_TEXT.tuiInvalidFrame)
  })
})
