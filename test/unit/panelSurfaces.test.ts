import { describe, expect, it, vi } from 'vitest'
import { MHP_PANEL } from '../../src/shared/constants'
import { PanelDelivery } from '../../src/runtime/panel/delivery'
import { PanelSurfaces, type PanelView } from '../../src/runtime/panel/surfaces'

const lifecycle = (event: string, extra = {}, surface = 'surface') => ({
  mhp: '1.2',
  kind: 'surface',
  surface,
  sessionId: 'session',
  surfaceKind: 'chat',
  event,
  ...extra,
})
const message = (seq: number, payload?: unknown) => ({
  mhp: '1.2',
  kind: 'panel',
  surface: 'surface',
  direction: 'toHost',
  seq,
  payload: payload ?? { type: 'ready' },
})

function fixture() {
  const delivery = new PanelDelivery()
  const written: unknown[] = []
  delivery.connect((line, complete) => {
    written.push(JSON.parse(line))
    complete()
    return true
  })
  const listeners = new Set<Parameters<PanelView['subscribe']>[0]>()
  const handle = vi.fn<PanelView['handle']>(() => undefined)
  const view: PanelView = {
    handle,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const fatal = vi.fn()
  const surfaces = new PanelSurfaces(
    delivery,
    (binding) =>
      binding.sessionId === 'session' && binding.surfaceKind === 'chat' ? view : undefined,
    log,
    fatal,
  )
  const emit = () => {
    for (const listener of listeners) listener({ type: 'notice', level: 'info', text: 'safe' })
  }
  return { delivery, surfaces, written, handle, log, fatal, lifecycle, message, emit, listeners }
}
describe('runtime MHP surface admission', () => {
  it('bounds retained binding bytes even after the surfaces close', () => {
    const f = fixture()
    const prefix = 'x'.repeat(MHP_PANEL.maximumEnvelopeBytes - 256)
    for (let index = 0; index < 2; index += 1) {
      const id = `${prefix}${String(index)}`
      f.surfaces.lifecycle(f.lifecycle('opened', {}, id))
      f.surfaces.lifecycle(f.lifecycle('closed', { droppedMessages: 0 }, id))
    }
    expect(() => {
      f.surfaces.lifecycle(f.lifecycle('opened', {}, `${prefix}overflow`))
    }).toThrow('MHP_PANEL_BACKPRESSURE')
    expect(f.listeners.size).toBe(0)
  })
  it('bounds surface bindings and tombstones for the lifetime of a carrier', () => {
    const f = fixture()
    for (let index = 0; index < 128; index += 1) {
      f.surfaces.lifecycle(f.lifecycle('opened', {}, `surface-${String(index)}`))
      f.surfaces.lifecycle(
        f.lifecycle('closed', { droppedMessages: 0 }, `surface-${String(index)}`),
      )
    }
    expect(() => {
      f.surfaces.lifecycle(f.lifecycle('opened', {}, 'overflow'))
    }).toThrow('MHP_PANEL_BACKPRESSURE')
    expect(f.listeners.size).toBe(0)
  })
  it('requires a registered session, immutable kind/binding, readiness and next sequence', () => {
    const f = fixture()
    expect(() => {
      f.surfaces.lifecycle({ ...f.lifecycle('opened'), sessionId: 'other' })
    }).toThrow('MHP_PANEL_UNKNOWN_SURFACE')
    f.surfaces.lifecycle(f.lifecycle('opened'))
    expect(() => {
      f.surfaces.message(f.message(1))
    }).toThrow('MHP_PANEL_NOT_READY')
    expect(() => {
      f.surfaces.lifecycle({ ...f.lifecycle('ready'), sessionId: 'other' })
    }).toThrow('MHP_PANEL_BINDING_MISMATCH')
    f.surfaces.lifecycle(f.lifecycle('ready'))
    expect(() => {
      f.surfaces.message({ ...f.message(1), direction: 'toPanel' })
    }).toThrow('MHP_PANEL_WRONG_DIRECTION')
    expect(() => {
      f.surfaces.message(f.message(1, { type: 'not-a-command' }))
    }).toThrow('MHP_PANEL_INVALID_PAYLOAD')
    f.surfaces.message(f.message(1))
    expect(f.handle).toHaveBeenCalledTimes(1)
    expect(() => {
      f.surfaces.message(f.message(1))
    }).toThrow('MHP_PANEL_OUT_OF_ORDER')
    expect(() => {
      f.surfaces.message(f.message(3))
    }).toThrow('MHP_PANEL_OUT_OF_ORDER')
  })
  it('queues output before ready, preserves counters on reload and replays once after ready', async () => {
    const f = fixture()
    f.surfaces.lifecycle(f.lifecycle('opened'))
    f.emit()
    expect(f.written).toEqual([])
    f.surfaces.lifecycle(f.lifecycle('ready'))
    expect(f.written[0]).toMatchObject({ seq: 1, direction: 'toPanel' })
    f.surfaces.message(f.message(1))
    await Promise.resolve()
    f.surfaces.lifecycle(
      f.lifecycle('reloaded', { stateRequest: { type: 'ready', attachmentEpoch: 2 } }),
    )
    f.emit()
    expect(f.written).toHaveLength(1)
    f.surfaces.lifecycle(f.lifecycle('ready'))
    f.surfaces.lifecycle(f.lifecycle('ready'))
    await vi.waitFor(() => {
      expect(f.handle).toHaveBeenCalledTimes(2)
    })
    expect(f.handle.mock.calls[1]?.[0]).toEqual({ type: 'ready', attachmentEpoch: 2 })
    expect(f.written[1]).toMatchObject({ seq: 2 })
    f.surfaces.message(f.message(2))
  })
  it('counts queued drops, unsubscribes, refuses reused ids, and lets a reconnect use a fresh id', () => {
    const f = fixture()
    f.surfaces.lifecycle(f.lifecycle('opened'))
    f.emit()
    f.emit()
    f.surfaces.detach()
    expect(f.log.warn).toHaveBeenCalledExactlyOnceWith('MHP_PANEL_DROPPED 2')
    expect(f.listeners.size).toBe(0)
    expect(f.delivery.totals.messages).toBe(0)
    expectRetired(f)
    f.surfaces.lifecycle(f.lifecycle('opened', {}, 'fresh'))
    f.surfaces.close()
    expect(() => {
      f.surfaces.lifecycle(f.lifecycle('opened', {}, 'third'))
    }).toThrow('MHP_PANEL_UNKNOWN_SURFACE')
  })
  it('orders asynchronous dispatch and closes queued work before any later side effect', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<undefined>()
    f.handle.mockImplementationOnce(() => pending.promise)
    f.surfaces.lifecycle(f.lifecycle('opened'))
    f.surfaces.lifecycle(f.lifecycle('ready'))
    f.surfaces.message(f.message(1))
    f.surfaces.message(f.message(2))
    f.surfaces.lifecycle(f.lifecycle('closed', { droppedMessages: 0 }))
    expect(f.log.warn).toHaveBeenCalledWith('MHP_PANEL_DROPPED 1')
    pending.resolve(undefined)
    await Promise.resolve()
    expect(f.handle).toHaveBeenCalledTimes(1)
  })
  it('closes fatally on a dispatched listener failure without logging its payload', async () => {
    const f = fixture()
    f.handle.mockRejectedValueOnce(new Error('synthetic private payload'))
    f.surfaces.lifecycle(f.lifecycle('opened'))
    f.surfaces.lifecycle(f.lifecycle('ready'))
    f.surfaces.message(f.message(1))
    await vi.waitFor(() => {
      expect(f.fatal).toHaveBeenCalledTimes(1)
    })
    expect(f.log.error).toHaveBeenCalledExactlyOnceWith('MHP_PANEL_DISPATCH_FAILED')
  })
})

function expectRetired(f: ReturnType<typeof fixture>): void {
  expect(() => {
    f.surfaces.message(f.message(1))
  }).toThrow('MHP_PANEL_UNKNOWN_SURFACE')
  expect(() => {
    f.surfaces.lifecycle(f.lifecycle('opened'))
  }).toThrow('MHP_PANEL_INVALID_LIFECYCLE')
}

it('retires every old session binding and drops queued output before a replacement can subscribe', () => {
  const f = fixture()
  f.surfaces.lifecycle(f.lifecycle('opened'))
  f.emit()
  expect(f.surfaces.retireSession('session')).toMatchObject([
    { surface: 'surface', sessionId: 'session' },
  ])
  expect(f.delivery.totals.messages).toBe(0)
  expect(f.listeners.size).toBe(0)
  expectRetired(f)
})

it('accepts one correctly bound native close acknowledgement after runtime retirement', () => {
  const f = fixture()
  f.surfaces.lifecycle(f.lifecycle('opened'))
  f.surfaces.retireSession('session')
  expect(() => {
    f.surfaces.lifecycle({ ...f.lifecycle('closed', { droppedMessages: 0 }), sessionId: 'wrong' })
  }).toThrow('MHP_PANEL_BINDING_MISMATCH')
  f.surfaces.lifecycle(f.lifecycle('closed', { droppedMessages: 0 }))
  expect(() => {
    f.surfaces.lifecycle(f.lifecycle('closed', { droppedMessages: 0 }))
  }).toThrow('MHP_PANEL_UNKNOWN_SURFACE')
})
