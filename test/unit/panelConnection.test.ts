import { describe, expect, it, vi } from 'vitest'
import type { MhpParams } from '../../src/shared/hostApi/methods'
import { PanelConnection, type PanelConnectionPorts } from '../../src/runtime/panel/connection'
import { MHP_ERROR_CODES, MHP_PANEL, RUNTIME_PANEL } from '../../src/shared/constants'

async function rig(
  protocolRange?: MhpParams<'initialize'>['protocolRange'],
  overrides: Partial<PanelConnectionPorts> = {},
) {
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
      ...overrides,
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
        capabilities: ['lifecycle', 'ui', 'settings', 'surfaces'],
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
  ['mhp/1.1.0', 'mhp/1.4.0'],
  ['mhp/1.5.0', 'mhp/3.0.0'],
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

it('drains actual cancelled adapter work before reporting settlement', async () => {
  const pending = Promise.withResolvers<unknown>()
  const entered = Promise.withResolvers<boolean>()
  const t = await rig(undefined, {
    capabilities: ['lifecycle', 'settings'],
    request: () => {
      entered.resolve(true)
      return pending.promise
    },
  })
  receive(t.peer, {
    jsonrpc: '2.0',
    id: 2,
    method: 'settings/get',
    params: { key: 'museSpark.autosave' },
  })
  await entered.promise
  t.peer.close()
  const finished = vi.fn()
  const settling = (async () => {
    await t.peer.settled()
    finished()
  })()
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  expect(finished).not.toHaveBeenCalled()
  pending.resolve({ value: false })
  await settling
  expect(finished).toHaveBeenCalledOnce()
})

it('keeps bidirectional settings authoritative in the runtime even when the host offers them', async () => {
  const request = vi.fn(() => Promise.resolve({ value: false }))
  const t = await rig(undefined, { capabilities: ['lifecycle', 'settings'], request })
  expect(
    await t.peer.request('settings/get', { key: 'museSpark.autosave' }, AbortSignal.timeout(100)),
  ).toEqual({
    value: false,
  })
  expect(request).toHaveBeenCalledOnce()
  expect(t.frames.some((value) => JSON.stringify(value).includes('runtime-1'))).toBe(false)
  t.peer.close()
})

it('bounds cancelled adapter work until its actual completion, even with shared promises', async () => {
  const pending = Promise.withResolvers<unknown>()
  const request = vi.fn(() => pending.promise)
  const t = await rig(undefined, { capabilities: ['lifecycle', 'settings'], request })
  for (let id = 2; id < MHP_PANEL.maximumQueuedMessages + 2; id += 1) {
    receive(t.peer, {
      jsonrpc: '2.0',
      id,
      method: 'settings/get',
      params: { key: 'museSpark.autosave' },
    })
    receive(t.peer, { jsonrpc: '2.0', method: '$/cancelRequest', params: { id } })
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
  expect(request).toHaveBeenCalledTimes(MHP_PANEL.maximumQueuedMessages)
  receive(t.peer, {
    jsonrpc: '2.0',
    id: 'overflow',
    method: 'settings/get',
    params: { key: 'museSpark.autosave' },
  })
  expect(request).toHaveBeenCalledTimes(MHP_PANEL.maximumQueuedMessages)
  expect(t.frames).toContainEqual({
    jsonrpc: '2.0',
    id: 'overflow',
    error: { code: MHP_ERROR_CODES.internalError, message: 'MHP_BACKPRESSURE' },
  })
  pending.resolve({ value: false })
  await t.peer.settled()
  t.peer.close()
})

function noSubscription(): void {
  /* The ordering fixture emits no state. */
}

describe('auxiliary surface adoption ordering', () => {
  it('adopts the awaited open result before lifecycle and readiness from the same batch', async () => {
    const handle = vi.fn(() => Promise.resolve())
    const binding = { surface: 'plans', sessionId: 'session', surfaceKind: 'plans' } as const
    let isAdopted = false
    const t = await rig(undefined, {
      view: (candidate) =>
        isAdopted &&
        candidate.surface === binding.surface &&
        candidate.sessionId === binding.sessionId
          ? { handle, subscribe: () => noSubscription }
          : undefined,
    })
    const opening = (async () => {
      await t.peer.request('surfaces/open', {
        kind: 'plans',
        sessionId: 'session',
        placement: 'tab',
      })
      await Promise.resolve()
      isAdopted = true
    })()
    receive(t.peer, { jsonrpc: '2.0', id: 'runtime-1', result: { surfaceId: binding.surface } })
    receive(t.peer, { mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding, event: 'opened' })
    receive(t.peer, { mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding, event: 'ready' })
    receive(t.peer, {
      mhp: MHP_PANEL.wireVersion,
      kind: 'panel',
      surface: binding.surface,
      direction: 'toHost',
      seq: 1,
      payload: { type: 'presentationReady' },
    })
    await opening
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(t.closed).not.toHaveBeenCalled()
    expect(handle).toHaveBeenCalledExactlyOnceWith({ type: 'presentationReady' })
    expect(t.frames).not.toContainEqual(expect.objectContaining({ kind: 'error' }))
    t.peer.close()
  })
})
