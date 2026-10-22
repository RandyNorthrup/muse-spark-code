// M100 switch-on prerequisite 1: until lane K binds its owner-checked ports,
// the production lane ports refuse every security-relevant use with typed
// `unsupported-host`, paid use stays off, and teardown never throws.
import { describe, expect, it } from 'vitest'
import { DevicePairingError } from '../../src/core/devices/pairing'
import type { DeviceChannel } from '../../src/host/devices/deviceChannel'
import { unboundDeviceLanePorts } from '../../src/host/devices/deviceProduction'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DEVICE_FAILURES, type DeviceFrame } from '../../src/shared/devices'
import { deviceWebviewRequestSchema } from '../../src/shared/devicesPanel'
import type { PaidUseRequest } from '../../src/shared/paid'
import { usdAmountSchema } from '../../src/shared/usdSchema'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'

const PAIR_ID = 'ab'.repeat(16)

function testChannel(): DeviceChannel {
  return {
    pairId: PAIR_ID,
    receiverIncarnationId: undefined,
    isReceiver: false,
    // The refusal throws before the channel is used.
    send: () => undefined,
    close: () => undefined,
  }
}

describe('M100 unbound lane ports refuse', () => {
  it('refuses setup, actions, execution and policy with unsupported-host', async () => {
    const logged: LoggedMessage[] = []
    const log = levelLogger(logged)
    const ports = unboundDeviceLanePorts(log)
    const grant = deviceGrant(PAIR_ID)
    const dispatch = deviceCheck(grant)
    const use: PaidUseRequest = {
      feature: 'judge',
      modelId: 'muse-spark-1.3',
      dailyBudgetUsd: usdAmountSchema.parse('1'),
    }
    const request = deviceWebviewRequestSchema.parse({
      type: 'deviceRequest',
      viewId: 'ab'.repeat(16),
      requestId: 'cd'.repeat(16),
      revision: 0,
      action: { kind: 'pauseOffers', pairId: PAIR_ID },
    })
    for (const refused of [
      ports.setup(),
      ports.otherAction(request),
      ports.execution.retain([]),
      ports.execution.admit(dispatch),
      ports.policy.assertAllowed(dispatch),
      ports.policy.approve(dispatch),
      ports.policy.assertPaidBinding(dispatch, use),
    ]) {
      let error: unknown
      try {
        await refused
      } catch (error_) {
        error = error_
      }
      expect(error).toBeInstanceOf(DevicePairingError)
      expect(error).toMatchObject({ reason: 'unsupported-host' })
    }
    expect(ports.policy.paidGate.isOn('judge')).toBe(false)
    await expect(ports.policy.paidConsent.allows(use)).resolves.toBe(false)
    const errors = logged.filter((entry) => entry.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('lane K')
  })

  it('throws on connect and receive but never on teardown', async () => {
    const logged: LoggedMessage[] = []
    const ports = unboundDeviceLanePorts(levelLogger(logged))
    const channel = testChannel()
    const frame: DeviceFrame = {
      version: DEVICE_LIMITS.protocolVersion,
      pairId: PAIR_ID,
      receiverIncarnationId: 'cd'.repeat(16),
      requestId: '10'.repeat(16),
      body: { kind: 'offers', offers: [] },
    }
    expect(() => {
      ports.source.connected(channel)
    }).toThrow(DevicePairingError)
    await expect(ports.source.receive(frame, channel)).rejects.toThrow(DevicePairingError)
    expect(() => {
      ports.source.disconnected(DEVICE_FAILURES[0], channel)
    }).not.toThrow()
  })
})
