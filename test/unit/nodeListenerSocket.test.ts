import { afterEach, describe, expect, it, vi } from 'vitest'
import { upgradeNodeTerminal } from '../../src/runtime/node/listenerSocket'
import { guardNodeRequest } from '../../src/runtime/node/listenerGuard'
import { NODE_WS_AUTH_MS, NODE_TERMINAL_INPUT_BYTES } from '../../src/shared/constants'
import {
  ListenerSocket,
  listenerFixture,
  listenerRequest,
  maskedFrame,
  flushListener,
} from './helpers/node/listener'
import { nodeBearer, nodeEvent } from './helpers/node/records'

afterEach(() => {
  vi.useRealTimers()
})
function stream() {
  const fixture = listenerFixture()
  const socket = new ListenerSocket()
  const lifetime = new AbortController()
  const request = listenerRequest(true)
  const open = (head: Buffer = Buffer.alloc(0)) => {
    guardNodeRequest(request, fixture.options.config, true)
    upgradeNodeTerminal(request, socket, head, fixture.options, lifetime.signal)
  }
  return { ...fixture, socket, handshake: request, lifetime, open }
}
const auth = { type: 'auth', bearer: nodeBearer, terminalId: 'terminal-1' }

describe('M110-N WebSocket first-frame boundary', () => {
  it('H07 closes at the actual five-second first-frame deadline without dispatch', async () => {
    vi.useFakeTimers()
    const test = stream()
    test.open()
    await vi.advanceTimersByTimeAsync(NODE_WS_AUTH_MS - 1)
    expect(test.socket.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(test.socket.destroyed).toBe(true)
    expect(test.verifier.verifyBearer).not.toHaveBeenCalled()
    expect(test.request).not.toHaveBeenCalled()
  })
  it('H07 an unfinished verifier cannot outrun the first-frame deadline', async () => {
    vi.useFakeTimers()
    const test = stream()
    test.verifier.verifyBearer.mockImplementation(
      () =>
        new Promise(() => {
          /* Wedged verifier. */
        }),
    )
    test.open(maskedFrame(auth))
    await flushListener()
    await vi.advanceTimersByTimeAsync(NODE_WS_AUTH_MS)
    expect(test.socket.destroyed).toBe(true)
    expect(test.request).not.toHaveBeenCalled()
  })
  it.each([
    { type: 'input', data: 'canary' },
    { ...auth, bearer: 'bad' },
    { ...auth, cookie: 'canary' },
  ])('H06/H07 refuses first frame %j', async (frame) => {
    const test = stream()
    test.open(maskedFrame(frame))
    await flushListener()
    expect(test.socket.destroyed).toBe(true)
    expect(test.request).not.toHaveBeenCalled()
    expect(test.verifier.verifyBearer).not.toHaveBeenCalled()
  })
  it.each(['Origin', 'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest'])(
    'H07 rejects handshake with bad %s',
    (name) => {
      const test = stream()
      test.handshake.rawHeaders[test.handshake.rawHeaders.indexOf(name) + 1] = 'cross-origin'
      expect(() => {
        test.open()
      }).toThrow()
      expect(test.socket.writes).toHaveLength(0)
    },
  )
  it.each([
    ['Sec-WebSocket-Version', '12'],
    ['Sec-WebSocket-Key', 'bad'],
    ['Upgrade', 'h2c'],
    ['Connection', 'keep-alive'],
    ['Authorization', `Bearer ${nodeBearer}`],
    ['Sec-WebSocket-Protocol', nodeBearer],
  ])('H06/H07 refuses non-protocol or header bearer %s', (name, value) => {
    const test = stream()
    const index = test.handshake.rawHeaders.indexOf(name)
    if (index === -1) test.handshake.rawHeaders.push(name, value)
    else test.handshake.rawHeaders[index + 1] = value
    expect(() => {
      test.open()
    }).toThrow()
  })
  it('H06 refuses an unbound verifier before upgrading', () => {
    const test = stream()
    const { verifier: _verifier, ...options } = test.options
    expect(() => {
      upgradeNodeTerminal(
        test.handshake,
        test.socket,
        Buffer.alloc(0),
        options,
        test.lifetime.signal,
      )
    }).toThrow()
    expect(test.socket.writes).toHaveLength(0)
  })
  it('H08 authenticates fragmented network chunks, scopes attach/input/resize/close to the shared port, and disposes on lock', async () => {
    const test = stream()
    test.open()
    const methods = vi.fn(test.options.methods)
    Object.defineProperty(test.options, 'methods', { value: methods })
    Object.defineProperty(test.handshake.socket, 'remoteAddress', { value: 'fd42::25' })
    const bytes = maskedFrame(auth)
    test.socket.emit('data', bytes.subarray(0, 1))
    test.socket.emit('data', bytes.subarray(1))
    await flushListener()
    expect(methods).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner' }), 'fd42::25')
    expect(test.request).toHaveBeenCalledWith(
      'node/terminal/attach',
      { terminalId: 'terminal-1' },
      expect.any(AbortSignal),
    )
    test.socket.emit(
      'data',
      Buffer.concat([
        maskedFrame({ type: 'input', data: 'canary' }),
        maskedFrame({ type: 'resize', size: { cols: 80, rows: 24 } }),
      ]),
    )
    await flushListener()
    expect(test.request).toHaveBeenCalledWith(
      'node/terminal/write',
      { terminalId: 'terminal-1', data: 'canary' },
      expect.any(AbortSignal),
    )
    expect(test.request).toHaveBeenCalledWith(
      'node/terminal/resize',
      { terminalId: 'terminal-1', size: { cols: 80, rows: 24 } },
      expect.any(AbortSignal),
    )
    test.ended.abort()
    expect(test.socket.destroyed).toBe(true)
    expect(test.options.terminal).toHaveBeenCalledTimes(1)
    const stopped = stream()
    stopped.open(maskedFrame(auth))
    await flushListener()
    stopped.socket.emit('data', maskedFrame({ type: 'close' }))
    await flushListener()
    expect(stopped.request).toHaveBeenCalledWith(
      'node/terminal/close',
      { terminalId: 'terminal-1' },
      expect.any(AbortSignal),
    )
    expect(stopped.socket.destroyed).toBe(true)
  })
  it('H08 ownership rejection and expired/revoked session never open or write a PTY', async () => {
    const test = stream()
    test.request.mockRejectedValueOnce(new Error('not owned'))
    test.open(maskedFrame(auth))
    await flushListener()
    expect(test.socket.destroyed).toBe(true)
    expect(test.options.terminal).not.toHaveBeenCalled()
    const expired = stream()
    expired.open(maskedFrame(auth))
    await flushListener()
    expired.verifier.verifyBearer.mockRejectedValue(new Error('expired'))
    expired.socket.emit('data', maskedFrame({ type: 'input', data: 'secret' }))
    await flushListener()
    expect(expired.socket.destroyed).toBe(true)
    expect(expired.request).toHaveBeenCalledTimes(1)
  })
  it.each([
    Buffer.from([0x81, 0x00]),
    Buffer.from([0x01, 0x80]),
    Buffer.from([0x82, 0x80]),
    Buffer.from([0x81, 0xff]),
    Buffer.from([0x89, 0xfe, 0, 126]),
    Buffer.from([0x88, 0x81]),
  ])(
    'H09 refuses unmasked, fragmented, binary, huge or malformed control frame %j',
    async (bytes) => {
      const test = stream()
      test.open(bytes)
      await flushListener()
      expect(test.socket.destroyed).toBe(true)
      expect(test.request).not.toHaveBeenCalled()
    },
  )
  it('H09 bounds UTF8 input, queued bytes and terminal frame rate before dispatch', async () => {
    const large = stream()
    large.open(maskedFrame(auth))
    await flushListener()
    large.socket.emit(
      'data',
      maskedFrame({ type: 'input', data: '界'.repeat(NODE_TERMINAL_INPUT_BYTES / 2) }),
    )
    await flushListener()
    expect(large.socket.destroyed).toBe(true)
    expect(large.request).toHaveBeenCalledTimes(1)
    const queued = stream()
    queued.open(Buffer.alloc(2 * 1024 * 1024 + 1))
    await flushListener()
    expect(queued.socket.destroyed).toBe(true)
    const flood = stream()
    flood.open(maskedFrame(auth))
    await flushListener()
    flood.socket.emit(
      'data',
      Buffer.concat(Array.from({ length: 65 }, () => maskedFrame({ type: 'input', data: 'x' }))),
    )
    await flushListener()
    expect(flood.socket.destroyed).toBe(true)
    expect(flood.request).toHaveBeenCalledTimes(1)
  })
  it('H13 parses/scopes outbound events and disconnect aborts the authorized subscription', async () => {
    const test = stream()
    const terminal = vi.fn<NonNullable<typeof test.options.terminal>>()
    terminal.mockImplementation(async (_session, _id, emit, signal) => {
      await emit({
        ...nodeEvent(),
        type: 'terminalOutput',
        terminalId: 'terminal-1',
        data: 'output',
      })
      expect(signal.aborted).toBe(false)
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
    })
    upgradeNodeTerminal(
      test.handshake,
      test.socket,
      maskedFrame(auth),
      { ...test.options, terminal },
      test.lifetime.signal,
    )
    await flushListener()
    expect(test.socket.writes[1]?.toString()).toContain('output')
    test.socket.destroy()
    await flushListener()
    expect(terminal).toHaveBeenCalledTimes(1)
    const wrong = stream()
    upgradeNodeTerminal(
      wrong.handshake,
      wrong.socket,
      maskedFrame(auth),
      {
        ...wrong.options,
        terminal: async (_session, _id, emit) => {
          await emit({
            ...nodeEvent(),
            type: 'terminalOutput',
            terminalId: 'other',
            data: 'canary',
          })
        },
      },
      wrong.lifetime.signal,
    )
    await flushListener()
    expect(wrong.socket.destroyed).toBe(true)
    expect(wrong.socket.writes).toHaveLength(1)
  })
  it('H09 a slow consumer cannot accumulate unlimited valid frames across rate windows', async () => {
    const test = stream()
    let time = 0
    upgradeNodeTerminal(
      test.handshake,
      test.socket,
      maskedFrame(auth),
      { ...test.options, clock: { ...test.options.clock, monotonicMs: () => time } },
      test.lifetime.signal,
    )
    await flushListener()
    test.request.mockImplementationOnce(
      (_method, _params, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('synthetic cancelled consumer'))
            },
            { once: true },
          )
        }),
    )
    const batch = Buffer.concat(
      Array.from({ length: 63 }, () =>
        maskedFrame({ type: 'input', data: 'x'.repeat(NODE_TERMINAL_INPUT_BYTES) }),
      ),
    )
    test.socket.emit('data', batch)
    await flushListener()
    time = 1000
    test.socket.emit('data', batch)
    time = 2000
    test.socket.emit('data', batch)
    expect(test.socket.destroyed).toBe(true)
    await flushListener()
  })
})
