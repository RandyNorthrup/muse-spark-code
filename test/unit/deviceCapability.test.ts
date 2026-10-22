// M100 phase 2, lane V: capability advertisement, built and admitted under
// lane 0's schema and byte cap. No listener beyond loopback, no model calls.
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  admitCapability,
  admitOfferCapability,
  buildCapability,
  capabilityGovernorSignals,
} from '../../src/core/devices/capability'
import { deviceCapabilitySchema, type DeviceCapability } from '../../src/shared/devices'
import { deviceGrant } from './helpers/deviceFixtures'

const ID = 'a'.repeat(32)
const NOW = 1_700_000_000_000
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

function measured(): Omit<DeviceCapability, 'observedAt'> {
  return {
    version: 1,
    deviceId: ID,
    receiverIncarnationId: '1'.repeat(32),
    platform: 'linux',
    osVersion: 'Kubuntu 26.04',
    tools: ['node', 'git'],
    engines: [{ model: { providerId: 'local', modelId: 'model/example:latest' }, budget: 'ok' }],
    presence: { touchId: false, windowsHello: false, tpm: true, secureEnclave: false },
    power: 'ac',
    sleepInhibited: false,
    slotCap: 5,
    pressure: { cpuPercent: 12, memoryPercent: 40, diskPercent: 61, transportResets: 3 },
  }
}

function oversized(): Omit<DeviceCapability, 'observedAt'> {
  const base = measured()
  type Engine = Omit<DeviceCapability, 'observedAt'>['engines'][number]
  const engines: Engine[] = Array.from(
    { length: DEVICE_LIMITS.capabilityEngines },
    (_, index): Engine => ({
      model: {
        modelId: `${String(index)}-model`.padEnd(DEVICE_LIMITS.modelIdChars, 'm'),
        providerId: 'provider'
          .repeat(DEVICE_LIMITS.modelIdChars)
          .slice(0, DEVICE_LIMITS.modelIdChars),
      },
      budget: 'ok',
    }),
  )
  return {
    ...base,
    tools: Array.from({ length: DEVICE_LIMITS.capabilityTools }, (_, index) =>
      `tool-${String(index)}-`.padEnd(DEVICE_LIMITS.labelChars, 'x'),
    ),
    engines,
    pressure: { ...base.pressure, transportResets: Number.MAX_SAFE_INTEGER },
  }
}

describe('capability advertisement (lane V)', () => {
  it('builds a measured advertisement within the byte cap', () => {
    const capability = buildCapability(measured(), NOW)
    expect(deviceCapabilitySchema.parse(capability)).toEqual(capability)
    expect(capability.observedAt).toBe(NOW)
    expect(utf8Bytes(capability)).toBeLessThanOrEqual(DEVICE_LIMITS.capabilityBytes)
  })
  it('refuses a measurement that serializes past the byte cap', () => {
    expect(utf8Bytes({ ...oversized(), observedAt: NOW })).toBeGreaterThan(
      DEVICE_LIMITS.capabilityBytes,
    )
    expect(() => buildCapability(oversized(), NOW)).toThrow('invalid-frame')
    expect(buildCapability(measured(), NOW).tools).toEqual(['node', 'git'])
  })
  it('refuses unfit measurements without shipping them', () => {
    expect(() => buildCapability({ ...measured(), tools: ['node', 'node'] }, NOW)).toThrow(
      'invalid-frame',
    )
    expect(() =>
      buildCapability({ ...measured(), slotCap: DEVICE_LIMITS.workers + 1 }, NOW),
    ).toThrow('invalid-frame')
  })
  it('admits a fresh wire advertisement under the schema and cap', () => {
    const capability = buildCapability(measured(), NOW)
    const serialized = JSON.stringify(capability)
    const wire: unknown = JSON.parse(serialized)
    expect(admitCapability(wire, NOW)).toEqual(capability)
    expect(admitCapability(wire, NOW - DEVICE_LIMITS.clockSkewMs)).toEqual(capability)
  })
  it('refuses future-dated, wrong-version, unknown-field and oversized advertisements', () => {
    const capability = buildCapability(measured(), NOW)
    const future: unknown = {
      ...capability,
      observedAt: NOW + DEVICE_LIMITS.clockSkewMs + 1,
    }
    expect(() => admitCapability(future, NOW)).toThrow('invalid-frame')
    expect(() => admitCapability({ ...capability, version: 2 }, NOW)).toThrow('invalid-frame')
    expect(() => admitCapability({ ...capability, cipher: 'downgrade' }, NOW)).toThrow(
      'invalid-frame',
    )
    const wide: unknown = { ...oversized(), observedAt: NOW }
    expect(() => admitCapability(wide, NOW)).toThrow('invalid-frame')
  })
  it('applies the byte cap to multibyte measurements at build and admission', () => {
    const wide = {
      ...measured(),
      tools: Array.from({ length: DEVICE_LIMITS.capabilityTools }, (_, index) =>
        `${String(index)}-`.padEnd(DEVICE_LIMITS.labelChars, '\u{4F60}'),
      ),
    }
    const wire = { ...wide, observedAt: NOW }
    expect(JSON.stringify(wire).length).toBeLessThan(DEVICE_LIMITS.capabilityBytes)
    expect(utf8Bytes(wire)).toBeGreaterThan(DEVICE_LIMITS.capabilityBytes)
    expect(() => buildCapability(wide, NOW)).toThrow('invalid-frame')
    expect(() => admitCapability(wire, NOW)).toThrow('invalid-frame')
  })
  it('binds offers to the live advertisement', () => {
    const offer = deviceGrant('1'.repeat(32)).offer
    const capability = buildCapability(measured(), NOW)
    expect(() => {
      admitOfferCapability(offer, capability, NOW)
    }).not.toThrow()
    const otherDevice = buildCapability({ ...measured(), deviceId: '2'.repeat(32) }, NOW)
    expect(() => {
      admitOfferCapability(offer, otherDevice, NOW)
    }).toThrow('grant')
    const otherIncarnation = buildCapability(
      { ...measured(), receiverIncarnationId: '2'.repeat(32) },
      NOW,
    )
    expect(() => {
      admitOfferCapability(offer, otherIncarnation, NOW)
    }).toThrow('grant')
    const otherPlatform = buildCapability({ ...measured(), platform: 'darwin' }, NOW)
    expect(() => {
      admitOfferCapability(offer, otherPlatform, NOW)
    }).toThrow('incompatible')
    const fullSlots = buildCapability({ ...measured(), slotCap: 1 }, NOW)
    expect(() => {
      admitOfferCapability(offer, fullSlots, NOW)
    }).toThrow('capacity')
  })
  it('refuses the review future-dated capability before binding an offer', () => {
    const offer = deviceGrant('1'.repeat(32)).offer
    const future = buildCapability(measured(), NOW + DEVICE_LIMITS.clockSkewMs + 1)
    expect(future.observedAt).toBe(1_700_000_030_001)
    expect(() => admitCapability(future, NOW)).toThrow('invalid-frame')
    expect(() => {
      admitOfferCapability(offer, future, NOW)
    }).toThrow('invalid-frame')
    expect(() => {
      admitOfferCapability(offer, buildCapability(measured(), NOW + DEVICE_LIMITS.clockSkewMs), NOW)
    }).not.toThrow()
  })
  it('admits schema, UTF-8 cap and clock before considering offer binding', () => {
    const offer = deviceGrant('1'.repeat(32)).offer
    const capability = buildCapability(measured(), NOW)
    for (const candidate of [
      { ...capability, version: 2 },
      { ...capability, extra: true },
      { ...oversized(), observedAt: NOW },
      {
        ...capability,
        tools: Array.from({ length: DEVICE_LIMITS.capabilityTools }, (_, index) =>
          `${String(index)}-`.padEnd(DEVICE_LIMITS.labelChars, '\u{4F60}'),
        ),
      },
    ]) {
      expect(() => {
        admitOfferCapability(offer, candidate, NOW)
      }).toThrow('invalid-frame')
    }
    for (const now of [-1, NaN, Infinity, 0.5]) {
      expect(() => {
        admitOfferCapability(offer, capability, now)
      }).toThrow('invalid-frame')
    }
    expect(() => {
      admitOfferCapability({ ...offer, extra: true }, capability, NOW)
    }).toThrow('invalid-frame')
    const futureOtherDevice = buildCapability(
      { ...measured(), deviceId: '2'.repeat(32) },
      NOW + DEVICE_LIMITS.clockSkewMs + 1,
    )
    expect(() => {
      admitOfferCapability(offer, futureOtherDevice, NOW)
    }).toThrow('invalid-frame')
  })
  it('shapes pressure and transport signals for the governor', () => {
    const capability = buildCapability(measured(), NOW)
    const first = capabilityGovernorSignals(capability)
    expect(first).toEqual({
      cpuPercent: 12,
      memoryPercent: 40,
      diskPercent: 61,
      power: 'ac',
      slotCap: 5,
      transportResets: 3,
      observedAt: NOW,
      resetDelta: null,
      elapsedMs: null,
    })
    const next = capabilityGovernorSignals(capability, {
      observedAt: NOW - 60_000,
      transportResets: 1,
    })
    expect(next.resetDelta).toBe(2)
    expect(next.elapsedMs).toBe(60_000)
    const stalled = capabilityGovernorSignals(capability, {
      observedAt: NOW,
      transportResets: 1,
    })
    expect(stalled.resetDelta).toBe(null)
    expect(stalled.elapsedMs).toBe(null)
  })
  it('does not invent a transport rate when the counter restarts or time reverses', () => {
    const capability = buildCapability(measured(), NOW)
    for (const previous of [
      { observedAt: NOW - 1, transportResets: capability.pressure.transportResets + 1 },
      { observedAt: NOW + 1, transportResets: 0 },
    ]) {
      expect(capabilityGovernorSignals(capability, previous)).toMatchObject({
        resetDelta: null,
        elapsedMs: null,
      })
    }
  })
  it('refuses invalid sampling clocks and previous reset measurements', () => {
    const capability = buildCapability(measured(), NOW)
    for (const now of [-1, NaN, 0.5]) {
      expect(() => admitCapability(capability, now)).toThrow('invalid-frame')
    }
    for (const previous of [
      { observedAt: -1, transportResets: 0 },
      { observedAt: NOW - 1, transportResets: -1 },
      { observedAt: NaN, transportResets: 0 },
      { observedAt: NOW - 1, transportResets: 0.5 },
    ]) {
      expect(() => capabilityGovernorSignals(capability, previous)).toThrow('invalid-frame')
    }
  })
})
