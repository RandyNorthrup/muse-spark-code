import { describe, expect, it } from 'vitest'
import { handleDeviceRequest } from '../../src/host/devices/deviceMessageHandler'
import type {
  DeviceHostMessage,
  DevicesPanelState,
  DeviceWebviewRequest,
} from '../../src/shared/devicesPanel'
import type { DevicesPanelPort } from '../../src/shared/protocol'

const UI_PAIR_ID = '2'.repeat(32)
const uiDevice: Extract<DevicesPanelState, { enabled: true }>['devices'][number] = {
  deviceId: '1'.repeat(32),
  pairId: UI_PAIR_ID,
  label: 'Mac receiver',
  fingerprint: '4'.repeat(64),
  endpoint: { address: '10.2.3.4', port: 32_123 },
  status: 'connected',
  waitingApprovals: 0,
  unresolvedAttempts: 0,
  retainedLiabilityUsd: 0,
  offers: [],
}
function uiMessage(): DeviceHostMessage {
  return {
    type: 'deviceState',
    revision: 1,
    state: { enabled: true, discoveryEnabled: false, devices: [uiDevice] },
  }
}
function uiPort() {
  const response = uiMessage()
  let revision = response.revision
  const calls: { request: DeviceWebviewRequest; signal: AbortSignal | undefined }[] = []
  const queued: DeviceHostMessage[] = []
  const port: DevicesPanelPort = {
    request: (request, signal) => {
      calls.push({ request, signal })
      const next =
        queued.shift() ??
        ({
          ...response,
          revision: revision + 1,
          setup: { viewId: request.viewId, requestId: request.requestId },
        } satisfies DeviceHostMessage)
      revision = next.revision
      return Promise.resolve(next)
    },
  }
  return { port, calls, queued }
}

const request = {
  type: 'deviceRequest',
  revision: 1,
  viewId: UI_PAIR_ID,
  requestId: UI_PAIR_ID,
  action: { kind: 'pair' },
}
describe('M100 U local host handler', () => {
  it('forwards the browser abort signal to the same shared method port', async () => {
    const { port, calls } = uiPort()
    const controller = new AbortController()
    await handleDeviceRequest(request, port, controller.signal)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal).toBe(controller.signal)
  })
  it('refuses a reply addressed to a different view even when the request id matches', async () => {
    const { port, queued } = uiPort()
    queued.push({
      ...uiMessage(),
      setup: { viewId: 'f'.repeat(32), requestId: UI_PAIR_ID },
    })
    await expect(handleDeviceRequest(request, port)).rejects.toThrow('invalid-device-message')
  })

  it.each([
    { ...request, type: 'sendMessage' },
    { ...request, action: { kind: 'offer', paidConsent: true } },
    { ...request, requestId: 'invalid' },
    { ...request, secret: 'private-sentinel' },
  ])(
    'validates unknown incoming messages before calling the injected authority: %j',
    async (raw) => {
      const { port, calls } = uiPort()
      await expect(handleDeviceRequest(raw, port)).rejects.toThrow('invalid-device-message')
      expect(calls).toEqual([])
    },
  )
  it('delegates an explicit request only and correlates a validated state reply', async () => {
    const { port, calls } = uiPort()
    expect(calls).toEqual([])
    const result = await handleDeviceRequest(request, port)
    expect(calls).toHaveLength(1)
    expect(result).toEqual({
      ...uiMessage(),
      revision: 2,
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID },
    })
  })
  it('adds the local request id to a validated observation without manufacturing state', async () => {
    const port: DevicesPanelPort = {
      request: () => Promise.resolve(uiMessage()),
    }
    const result = await handleDeviceRequest(request, port)
    expect(result.state).toEqual(uiMessage().state)
    expect(result.setup?.requestId).toBe(UI_PAIR_ID)
  })
  it('rejects malformed or private response fields without reflecting them', async () => {
    const { port, queued } = uiPort()
    // A forged adapter reply the typed port cannot express: the handler must
    // reject it at runtime instead of reflecting it (PLAN.md §8).
    const forged = {
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID },
      secret: 'private-sentinel',
    } as unknown as DeviceHostMessage
    queued.push(forged)
    await expect(handleDeviceRequest(request, port)).rejects.toThrow(/^invalid-device-message$/)
  })
  it('scrubs unexpected adapter failures to a fixed word', async () => {
    const port: DevicesPanelPort = {
      request: () => Promise.reject(new Error('private-host-sentinel')),
    }
    await expect(handleDeviceRequest(request, port)).rejects.toThrow(/^invalid-device-message$/)
  })
  it('rejects a response bound to a different request', async () => {
    const { port, queued } = uiPort()
    queued.push({
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: 'f'.repeat(32) },
    })
    await expect(handleDeviceRequest(request, port)).rejects.toThrow('invalid-device-message')
  })
})
