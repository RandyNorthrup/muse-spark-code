import { describe, expect, it } from 'vitest'
import { DevicePanel } from '../../src/core/devices/devicePanel'
import type { DevicesPanelState, DeviceWebviewRequest } from '../../src/shared/devicesPanel'

const request: DeviceWebviewRequest = {
  type: 'deviceRequest',
  viewId: 'a'.repeat(32),
  requestId: 'b'.repeat(32),
  revision: 0,
  action: { kind: 'pair' },
}
function harness() {
  const performed: DeviceWebviewRequest[] = []
  const snapshots: undefined[] = []
  const published: unknown[] = []
  const performQueue: Promise<{ viewId: string; requestId: string }>[] = []
  const snapshotQueue: Promise<DevicesPanelState>[] = []
  const perform = (input: DeviceWebviewRequest) => {
    performed.push(input)
    return (
      performQueue.shift() ?? Promise.resolve({ viewId: input.viewId, requestId: input.requestId })
    )
  }
  const snapshot = (): Promise<DevicesPanelState> => {
    snapshots.push(undefined)
    return snapshotQueue.shift() ?? Promise.resolve({ enabled: false })
  }
  const publish = (message: unknown) => {
    published.push(message)
  }
  return {
    panel: new DevicePanel({ perform, snapshot, publish }),
    performed,
    snapshots,
    published,
    performQueue,
    snapshotQueue,
  }
}

describe('host-owned Devices snapshots', () => {
  it('holds observations until ready, replays the latest on reload and publishes later updates', async () => {
    const { panel, performed, snapshots, published } = harness()
    panel.publishObservation(await panel.observe())
    panel.publishObservation(await panel.observe())
    expect(published).toEqual([])
    expect(await panel.ready()).toMatchObject({ revision: 2, state: { enabled: false } })
    expect(published).toEqual([
      {
        type: 'deviceState',
        revision: 2,
        state: { enabled: false },
      },
    ])
    await panel.ready()
    expect(published).toHaveLength(2)
    expect(snapshots).toHaveLength(2)
    panel.publishObservation(await panel.observe())
    expect(published.at(-1)).toEqual({
      type: 'deviceState',
      revision: 3,
      state: { enabled: false },
    })
    expect(performed).toEqual([])
  })

  it('captures an initial observation when ready arrives before any cached state', async () => {
    const { panel, performed, snapshots, published } = harness()
    await panel.ready()
    expect(snapshots).toHaveLength(1)
    expect(published).toEqual([
      {
        type: 'deviceState',
        revision: 1,
        state: { enabled: false },
      },
    ])
    expect(performed).toEqual([])
  })

  it('does no work at construction and increases observations, replies and off states', async () => {
    const { panel, performed, snapshots } = harness()
    expect(snapshots).toEqual([])
    expect(performed).toEqual([])
    const observed = await panel.observe()
    expect(observed.revision).toBe(1)
    expect(await panel.request({ ...request, revision: 1 })).toMatchObject({
      revision: 2,
      setup: { viewId: request.viewId, requestId: request.requestId },
    })
    const third = await panel.observe()
    expect(third.revision).toBe(3)
    const fourth = await panel.observe()
    expect(fourth.revision).toBe(4)
  })
  it('serializes snapshot acquisition so a slow old read cannot supersede a newer observation', async () => {
    const { panel, snapshots, snapshotQueue } = harness()
    const held = Promise.withResolvers<DevicesPanelState>()
    snapshotQueue.push(held.promise)
    const first = panel.observe()
    const second = panel.observe()
    await expect.poll(() => snapshots.length).toBe(1)
    held.resolve({ enabled: false })
    const initial = await first
    expect(initial.revision).toBe(1)
    const later = await second
    expect(later.revision).toBe(2)
    expect(snapshots).toHaveLength(2)
  })
  it('refuses a future revision or invalid request before invoking any local authority', async () => {
    const { panel, performed } = harness()
    await expect(panel.request({ ...request, revision: 1 })).rejects.toThrow(
      'invalid-device-message',
    )
    await expect(panel.request({ ...request, viewId: 'bad' })).rejects.toThrow(
      'invalid-device-message',
    )
    expect(performed).toEqual([])
  })
  it.each(['viewId', 'requestId'] as const)(
    'binds action replies to the initiating %s',
    async (key) => {
      const { panel, performed, snapshots, performQueue } = harness()
      performQueue.push(
        Promise.resolve({
          viewId: request.viewId,
          requestId: request.requestId,
          [key]: 'c'.repeat(32),
        }),
      )
      await expect(panel.request(request)).rejects.toThrow('invalid-device-message')
      expect(snapshots).toEqual([])
      expect(performed).toHaveLength(1)
    },
  )
  it('refuses malformed snapshots and does not poison later valid observations', async () => {
    const { panel, snapshotQueue } = harness()
    const invalid: DevicesPanelState & { secret: string } = {
      enabled: true,
      discoveryEnabled: false,
      devices: [],
      secret: 'forbidden',
    }
    snapshotQueue.push(Promise.resolve(invalid))
    await expect(panel.observe()).rejects.toThrow()
    const observed = await panel.observe()
    expect(observed.revision).toBe(1)
  })
  it('abort drops action data without dispatching a physical Stop or retirement', async () => {
    const { panel, performed, snapshots, performQueue } = harness()
    const abort = new AbortController()
    abort.abort()
    await expect(panel.request(request, abort.signal)).rejects.toThrow('invalid-device-message')
    expect(performed).toEqual([])
    const replyValue = Promise.withResolvers<{ viewId: string; requestId: string }>()
    performQueue.push(replyValue.promise)
    const active = new AbortController()
    const reply = panel.request(request, active.signal)
    active.abort()
    replyValue.resolve({ viewId: request.viewId, requestId: request.requestId })
    await expect(reply).rejects.toThrow('invalid-device-message')
    expect(performed).toHaveLength(1)
    expect(snapshots).toEqual([])
  })
  it('drops a reply aborted while its complete snapshot is still being acquired', async () => {
    const { panel, snapshots, snapshotQueue } = harness()
    const held = Promise.withResolvers<DevicesPanelState>()
    snapshotQueue.push(held.promise)
    const active = new AbortController()
    const reply = panel.request(request, active.signal)
    await expect.poll(() => snapshots.length).toBe(1)
    active.abort()
    held.resolve({ enabled: false })
    await expect(reply).rejects.toThrow('invalid-device-message')
    const observed = await panel.observe()
    expect(observed.revision).toBe(2)
  })
})
