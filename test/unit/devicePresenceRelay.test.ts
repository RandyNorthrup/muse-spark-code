import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DEVICE_STEP_UP_METHODS, deviceStepUpSchema } from '../../src/shared/devices'
import {
  DevicePresenceRelay,
  deviceActionDigest,
  devicePresenceRelaySchema,
} from '../../src/core/devices/actionGrants'
import { MultiplexedDeviceChannel } from '../../src/core/devices/channel'
import { actionGrantFixture } from './helpers/actionGrantFixtures'
import { deferred } from './helpers/deviceExecutionFixtures'
import { channelReady, transferChannel } from './helpers/multiplexedChannelFixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

function relayFixture() {
  const f = actionGrantFixture()
  f.state.action = { ...f.state.action, operation: 'program' }
  const relay = new DevicePresenceRelay(f.grants, (request) =>
    deviceActionDigest(request, f.state.action),
  )
  const message = {
    version: DEVICE_LIMITS.protocolVersion,
    requestId: 'd'.repeat(DEVICE_LIMITS.idChars),
    pairId: f.request.pairId,
    ownerId: f.request.ownerId,
    kind: 'request',
    request: f.request,
    actionDigest: deviceActionDigest(f.request, f.state.action),
    method: 'local-confirm',
  }
  return { ...f, relay, message }
}

describe('device-local presence relay', () => {
  it.each(DEVICE_STEP_UP_METHODS)('shows and answers %s only on the device', async (method) => {
    const f = relayFixture()
    const answer = deferred<boolean>()
    f.presence.confirm.mockReturnValue(answer.promise)
    const send = vi.fn()
    const pending = f.relay.receive({ ...f.message, method }, f.request.pairId, send)
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'waiting', actionDigest: f.message.actionDigest }),
    )
    expect(DevicePresenceRelay.waitingText('Receiver')).toContain('Receiver')
    expect(f.presence.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        method,
        actionDigest: f.message.actionDigest,
        action: f.state.action,
      }),
    )
    answer.resolve(true)
    await pending
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'attested',
        approval: expect.objectContaining({ presence: method }),
      }),
    )
    expect(await f.grants.admit(f.request)).toEqual(f.state.grant)
  })
  it('refuses a fake presence answer on the orchestrator', async () => {
    const f = relayFixture()
    const fake = { ...f.message, kind: 'answer', confirmed: true }
    expect(devicePresenceRelaySchema.safeParse(fake).success).toBe(false)
    await expect(f.relay.receive(fake, f.request.pairId, vi.fn())).rejects.toThrow()
    const forged = devicePresenceRelaySchema.parse({
      version: 1,
      requestId: f.message.requestId,
      pairId: f.request.pairId,
      ownerId: f.request.ownerId,
      kind: 'attested',
      approval: {
        version: 1,
        grantId: f.state.grant.grantId,
        actionDigest: f.message.actionDigest,
        presence: 'local-confirm',
        approvedAt: DEVICE_LIMITS.stepUpValidityMs,
        expiresAt: DEVICE_LIMITS.stepUpValidityMs * 2,
      },
    })
    await expect(f.relay.receive(forged, f.request.pairId, vi.fn())).rejects.toThrow(
      'presence-unverified',
    )
    if (forged.kind !== 'attested') throw new Error('fixture')
    await expect(f.grants.attestStepUp(forged.approval)).rejects.toThrow('presence-unverified')
    expect(f.presence.confirm).not.toHaveBeenCalled()
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
  })
  it('refuses a usage settlement the receiver did not record', async () => {
    const f = relayFixture()
    f.state.used.tokens = f.request.quota.tokens
    const settlement = {
      version: 1,
      pairId: f.request.pairId,
      ownerId: f.request.ownerId,
      requestId: f.message.requestId,
      kind: 'settlement',
      usage: { tokens: 0 },
    }
    await expect(f.relay.receive(settlement, f.request.pairId, vi.fn())).rejects.toThrow()
    expect(f.state.used.tokens).toBe(f.request.quota.tokens)
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'quota-exceeded' })
  })
  it('refuses wrong versions, unknown fields, methods and inner owners', () => {
    const f = relayFixture()
    for (const candidate of [
      { ...f.message, version: 2 },
      { ...f.message, confirmed: true },
      { ...f.message, method: 'unattested' },
      { ...f.message, ownerId: 'a'.repeat(DEVICE_LIMITS.idChars) },
      { ...f.message, request: { ...f.request, pairId: 'a'.repeat(DEVICE_LIMITS.idChars) } },
    ])
      expect(devicePresenceRelaySchema.safeParse(candidate).success).toBe(false)
  })
  it('refuses another channel pair or action digest before prompting', async () => {
    const f = relayFixture()
    const send = vi.fn()
    await expect(
      f.relay.receive(f.message, 'a'.repeat(DEVICE_LIMITS.idChars), send),
    ).rejects.toThrow('presence-unverified')
    await expect(
      f.relay.receive(
        { ...f.message, actionDigest: 'a'.repeat(DEVICE_LIMITS.digestChars) },
        f.request.pairId,
        send,
      ),
    ).rejects.toThrow('presence-unverified')
    expect(send).not.toHaveBeenCalled()
    expect(f.presence.confirm).not.toHaveBeenCalled()
  })
  it('returns a typed refusal when local presence is denied', async () => {
    const f = relayFixture()
    f.presence.confirm.mockResolvedValue(false)
    const send = vi.fn()
    await f.relay.receive(f.message, f.request.pairId, send)
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'refused',
        refusal: expect.objectContaining({ reason: 'presence-unverified' }),
      }),
    )
  })
  it('RVM100P2A-P3 rejects a presence relay for another channel pair at enqueue', () => {
    const f = relayFixture()
    const source = new MultiplexedDeviceChannel(channelReady)
    const relay = devicePresenceRelaySchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      requestId: f.message.requestId,
      pairId: f.request.pairId,
      ownerId: f.request.ownerId,
      kind: 'waiting',
      actionDigest: f.message.actionDigest,
    })
    expect(() => source.enqueue({ kind: 'presenceRelay', relay })).toThrow('invalid-frame')
  })
  it('RVM100P2A-P3 enforces the channel grant cap independently of the relay refine', () => {
    const f = relayFixture()
    const source = new MultiplexedDeviceChannel({ ...channelReady, pairId: f.request.pairId })
    const relay = devicePresenceRelaySchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      requestId: f.message.requestId,
      pairId: f.request.pairId,
      ownerId: f.request.ownerId,
      kind: 'waiting',
      actionDigest: f.message.actionDigest,
    })
    const input = { kind: 'presenceRelay' as const, relay }
    const encode = TextEncoder.prototype.encode
    // Relay schema uses Buffer.byteLength; emulate oversized channel encoding only.
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (text) {
      return text === JSON.stringify(input)
        ? new Uint8Array(DEVICE_LIMITS.grantBytes + 1)
        : encode.call(new TextEncoder(), text)
    })
    expect(devicePresenceRelaySchema.safeParse(relay).success).toBe(true)
    expect(() => source.enqueue(input)).toThrow('invalid-frame')
  })
  it('carries validated waiting and attested envelopes on the control stream', async () => {
    const f = relayFixture()
    const identity = { ...channelReady, pairId: f.request.pairId }
    const source = new MultiplexedDeviceChannel(identity)
    const target = new MultiplexedDeviceChannel(identity)
    const request = devicePresenceRelaySchema.parse(f.message)
    source.enqueue({ kind: 'presenceRelay', relay: request })
    transferChannel(source, target)
    const delivery = target.takeIncoming(true)
    expect(delivery?.stream).toBe('control')
    if (delivery?.message.kind !== 'presenceRelay') throw new Error('fixture')
    target.complete(delivery)
    await f.relay.receive(delivery.message.relay, f.request.pairId, (relay) => {
      target.enqueue({ kind: 'presenceRelay', relay })
    })
    transferChannel(target, source)
    const waiting = source.takeIncoming(true)
    expect(waiting?.message).toMatchObject({ kind: 'presenceRelay', relay: { kind: 'waiting' } })
    if (waiting === undefined) throw new Error('fixture')
    source.complete(waiting)
    const attested = source.takeIncoming(true)
    expect(attested?.message).toMatchObject({ kind: 'presenceRelay', relay: { kind: 'attested' } })
    if (attested?.message.kind !== 'presenceRelay' || attested.message.relay.kind !== 'attested')
      throw new Error('fixture')
    expect(deviceStepUpSchema.safeParse(attested.message.relay.approval).success).toBe(true)
  })
})
