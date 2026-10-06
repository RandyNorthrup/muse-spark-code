import { describe, expect, it, vi } from 'vitest'
import { DevicePanel } from '../../src/core/devices/devicePanel'
import type { DevicesPanelState, DeviceWebviewRequest } from '../../src/shared/modelsPanel'
import { deferred } from './helpers/deviceExecutionFixtures'

const request: DeviceWebviewRequest = {
  type: 'deviceRequest',
  viewId: 'a'.repeat(32),
  requestId: 'b'.repeat(32),
  revision: 0,
  action: { kind: 'pair' },
}
function harness() {
  const perform = vi.fn((input: DeviceWebviewRequest) =>
    Promise.resolve({
      viewId: input.viewId,
      requestId: input.requestId,
    }),
  )
  const snapshot = vi.fn((): Promise<DevicesPanelState> => Promise.resolve({ enabled: false }))
  return { panel: new DevicePanel({ perform, snapshot }), perform, snapshot }
}

describe('host-owned Devices snapshots', () => {
  it('does no work at construction and increases observations, replies and off states', async () => {
    const { panel, perform, snapshot } = harness()
    expect(snapshot).not.toHaveBeenCalled()
    expect(perform).not.toHaveBeenCalled()
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
    const { panel, snapshot } = harness()
    const held = deferred<DevicesPanelState>()
    snapshot.mockReturnValueOnce(held.promise)
    const first = panel.observe()
    const second = panel.observe()
    await vi.waitFor(() => {
      expect(snapshot).toHaveBeenCalledOnce()
    })
    held.resolve({ enabled: false })
    const initial = await first
    expect(initial.revision).toBe(1)
    const later = await second
    expect(later.revision).toBe(2)
    expect(snapshot).toHaveBeenCalledTimes(2)
  })
  it('refuses a future revision or invalid request before invoking any local authority', async () => {
    const { panel, perform } = harness()
    await expect(panel.request({ ...request, revision: 1 })).rejects.toThrow(
      'invalid-device-message',
    )
    await expect(panel.request({ ...request, viewId: 'bad' })).rejects.toThrow(
      'invalid-device-message',
    )
    expect(perform).not.toHaveBeenCalled()
  })
  it.each(['viewId', 'requestId'] as const)(
    'binds action replies to the initiating %s',
    async (key) => {
      const { panel, perform, snapshot } = harness()
      perform.mockResolvedValueOnce({
        viewId: request.viewId,
        requestId: request.requestId,
        [key]: 'c'.repeat(32),
      })
      await expect(panel.request(request)).rejects.toThrow('invalid-device-message')
      expect(snapshot).not.toHaveBeenCalled()
    },
  )
  it('refuses malformed snapshots and does not poison later valid observations', async () => {
    const { panel, snapshot } = harness()
    const invalid: DevicesPanelState & { secret: string } = {
      enabled: true,
      discoveryEnabled: false,
      devices: [],
      secret: 'forbidden',
    }
    snapshot.mockResolvedValueOnce(invalid)
    await expect(panel.observe()).rejects.toThrow()
    const observed = await panel.observe()
    expect(observed.revision).toBe(1)
  })
  it('abort drops action data without dispatching a physical Stop or retirement', async () => {
    const { panel, perform, snapshot } = harness()
    const abort = new AbortController()
    abort.abort()
    await expect(panel.request(request, abort.signal)).rejects.toThrow('invalid-device-message')
    expect(perform).not.toHaveBeenCalled()
    const held = deferred<Awaited<ReturnType<typeof perform>>>()
    perform.mockReturnValueOnce(held.promise)
    const active = new AbortController()
    const reply = panel.request(request, active.signal)
    active.abort()
    held.resolve({ viewId: request.viewId, requestId: request.requestId })
    await expect(reply).rejects.toThrow('invalid-device-message')
    expect(perform).toHaveBeenCalledOnce()
    expect(snapshot).not.toHaveBeenCalled()
  })
  it('drops a reply aborted while its complete snapshot is still being acquired', async () => {
    const { panel, snapshot } = harness()
    const held = deferred<DevicesPanelState>()
    snapshot.mockReturnValueOnce(held.promise)
    const active = new AbortController()
    const reply = panel.request(request, active.signal)
    await vi.waitFor(() => {
      expect(snapshot).toHaveBeenCalledOnce()
    })
    active.abort()
    held.resolve({ enabled: false })
    await expect(reply).rejects.toThrow('invalid-device-message')
    const observed = await panel.observe()
    expect(observed.revision).toBe(2)
  })
})
