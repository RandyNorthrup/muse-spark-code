import { describe, expect, it, vi } from 'vitest'
import { handleDeviceRequest } from '../../src/host/devices/deviceMessageHandler'
import { UI_PAIR_ID, uiMessage, uiPort } from './helpers/deviceUiFakes'

const request = { type: 'deviceRequest', requestId: UI_PAIR_ID, action: { kind: 'pair' } }
describe('M100 U local host handler', () => {
  it.each([
    { ...request, type: 'sendMessage' },
    { ...request, action: { kind: 'offer', paidConsent: true } },
    { ...request, requestId: 'invalid' },
    { ...request, secret: 'private-sentinel' },
  ])(
    'validates unknown incoming messages before calling the injected authority: %j',
    async (raw) => {
      const port = uiPort()
      await expect(handleDeviceRequest(raw, port)).rejects.toThrow('invalid-device-message')
      expect(port.request).not.toHaveBeenCalled()
    },
  )
  it('delegates an explicit request only and correlates a validated state reply', async () => {
    const port = uiPort()
    expect(port.request).not.toHaveBeenCalled()
    const result = await handleDeviceRequest(request, port)
    expect(port.request).toHaveBeenCalledWith(request)
    expect(result).toEqual({ ...uiMessage(), setup: { requestId: UI_PAIR_ID } })
  })
  it('adds the local request id to a validated observation without manufacturing state', async () => {
    const port = { request: vi.fn(() => Promise.resolve(uiMessage())) }
    const result = await handleDeviceRequest(request, port)
    expect(result.state).toEqual(uiMessage().state)
    expect(result.setup?.requestId).toBe(UI_PAIR_ID)
  })
  it('rejects malformed or private response fields without reflecting them', async () => {
    const port = uiPort()
    const forged = { ...uiMessage(), setup: { requestId: UI_PAIR_ID }, secret: 'private-sentinel' }
    port.request.mockResolvedValue(forged)
    await expect(handleDeviceRequest(request, port)).rejects.toThrow(/^invalid-device-message$/)
  })
  it('scrubs unexpected adapter failures to a fixed word', async () => {
    const port = uiPort()
    port.request.mockRejectedValue(new Error('private-host-sentinel'))
    await expect(handleDeviceRequest(request, port)).rejects.toThrow(/^invalid-device-message$/)
  })
  it('rejects a response bound to a different request', async () => {
    const port = uiPort()
    port.request.mockResolvedValue({ ...uiMessage(), setup: { requestId: 'f'.repeat(32) } })
    await expect(handleDeviceRequest(request, port)).rejects.toThrow('invalid-device-message')
  })
})
