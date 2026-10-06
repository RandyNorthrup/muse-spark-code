import { describe, expect, it, vi } from 'vitest'
import type { MhpParams } from '../../src/shared/hostApi/methods'
import { PanelConnection } from '../../src/runtime/panel/connection'
import { MHP_ERROR_CODES, MHP_PANEL, RUNTIME_PANEL } from '../../src/shared/constants'

async function rig(protocolRange?: MhpParams<'initialize'>['protocolRange']) {
  const frames: unknown[] = []
  const closed = vi.fn()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const peer = new PanelConnection(
    {
      capabilities: ['lifecycle'],
      initialize: () => Promise.resolve(),
      view: () => undefined,
      request: () => Promise.reject(new Error('unavailable')),
      notify: vi.fn(),
      closed,
    },
    log,
  )
  peer.delivery.connect((line, complete) => {
    frames.push(JSON.parse(line))
    complete()
    return true
  })
  peer.receive(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        host: { id: 'fake-editor', version: 'fake' },
        protocolRange: protocolRange ?? {
          minimum: MHP_PANEL.version,
          maximumExclusive: MHP_PANEL.maximumVersionExclusive,
        },
        capabilities: ['lifecycle', 'ui'],
        locale: 'en',
        theme: { kind: 'dark', tokens: {} },
        folders: [],
        trusted: false,
      },
    }),
  )
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  return { peer, frames, closed, log }
}

function receive(peer: PanelConnection, value: unknown) {
  peer.receive(JSON.stringify(value))
}
const input = { title: 'Fake input', prompt: 'Fake prompt' }

describe('native request correlation', () => {
  it.each(['success', 'cancelled'] as const)(
    'consumes a valid late %s reply after abort without disturbing another request',
    async (kind) => {
      const t = await rig()
      const signal = new AbortController()
      const first = expect(t.peer.request('ui/input', input, signal.signal)).rejects.toThrow(
        'MHP_CANCELLED',
      )
      const second = (async () => {
        try {
          return await t.peer.request('ui/input', input)
        } catch (error: unknown) {
          return error
        }
      })()
      signal.abort()
      await first
      receive(t.peer, {
        jsonrpc: '2.0',
        id: 'runtime-1',
        ...(kind === 'success'
          ? { result: 'late' }
          : { error: { code: MHP_ERROR_CODES.cancelled, message: 'MHP_CANCELLED' } }),
      })
      expect(t.closed).not.toHaveBeenCalled()
      receive(t.peer, { jsonrpc: '2.0', id: 'runtime-2', result: 'other' })
      expect(await second).toBe('other')
      t.peer.close()
    },
  )

  it('consumes a valid late reply after a timeout', async () => {
    const t = await rig()
    const signals: AbortController[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => {
      expect(duration).toBe(RUNTIME_PANEL.requestTimeoutMs)
      const signal = new AbortController()
      signals.push(signal)
      return signal.signal
    })
    try {
      const first = expect(t.peer.request('ui/input', input)).rejects.toThrow('MHP_CANCELLED')
      const second = (async () => {
        try {
          return await t.peer.request('ui/input', input)
        } catch (error: unknown) {
          return error
        }
      })()
      signals[0]?.abort()
      await first
      receive(t.peer, { jsonrpc: '2.0', id: 'runtime-1', result: null })
      expect(t.closed).not.toHaveBeenCalled()
      receive(t.peer, { jsonrpc: '2.0', id: 'runtime-2', result: 'alive' })
      expect(await second).toBe('alive')
    } finally {
      vi.restoreAllMocks()
      t.peer.close()
    }
  })

  it.each(['malformed', 'unknown', 'duplicate'] as const)(
    'still rejects a %s reply',
    async (kind) => {
      const t = await rig()
      const signal = new AbortController()
      const first = expect(t.peer.request('ui/input', input, signal.signal)).rejects.toThrow(
        'MHP_CANCELLED',
      )
      signal.abort()
      await first
      if (kind === 'duplicate') receive(t.peer, { jsonrpc: '2.0', id: 'runtime-1', result: null })
      receive(t.peer, {
        jsonrpc: '2.0',
        id: kind === 'unknown' ? 'unknown' : 'runtime-1',
        result: kind === 'malformed' ? 1 : null,
      })
      expect(t.closed).toHaveBeenCalledExactlyOnceWith(true)
    },
  )

  it('bounds retired ids by refusing new requests until a retained reply is consumed', async () => {
    const t = await rig()
    for (let index = 0; index < MHP_PANEL.maximumQueuedMessages; index++) {
      const signal = new AbortController()
      const result = expect(t.peer.request('ui/input', input, signal.signal)).rejects.toThrow(
        'MHP_CANCELLED',
      )
      signal.abort()
      await result
    }
    await expect(t.peer.request('ui/input', input)).rejects.toThrow('MHP_BACKPRESSURE')
    expect(t.closed).not.toHaveBeenCalled()
    receive(t.peer, { jsonrpc: '2.0', id: 'runtime-1', result: null })
    const next = t.peer.request('ui/input', input)
    receive(t.peer, {
      jsonrpc: '2.0',
      id: `runtime-${String(MHP_PANEL.maximumQueuedMessages + 1)}`,
      result: 'admitted',
    })
    expect(await next).toBe('admitted')
    t.peer.close()
  })
})

it.each([
  ['mhp/1.0.0', 'mhp/1.1.0'],
  ['mhp/1.1.0', 'mhp/1.2.0'],
  ['mhp/1.3.0', 'mhp/3.0.0'],
  ['mhp/2.0.0', 'mhp/3.0.0'],
])(
  'refuses unsupported version %s with the named negotiation error',
  async (minimum, maximumExclusive) => {
    const t = await rig({ minimum, maximumExclusive })
    expect(t.frames).toContainEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: MHP_ERROR_CODES.incompatibleVersion, message: 'MHP_INCOMPATIBLE_VERSION' },
    })
    await expect(t.peer.request('ui/input', input)).rejects.toThrow('MHP_NOT_INITIALIZED')
    t.peer.close()
  },
)
