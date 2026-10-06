import { describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { type DeviceFrame } from '../../src/shared/devices'
import {
  checkedDeviceAddress,
  checkedDeviceInterface,
  resolveDeviceAddress,
} from '../../src/core/devices/deviceAddress'
import { DeviceFrameDecoder, encodeDeviceFrame } from '../../src/core/devices/deviceFraming'

const transportFrame: DeviceFrame = {
  version: 1,
  pairId: 'a'.repeat(32),
  receiverIncarnationId: 'b'.repeat(32),
  requestId: 'c'.repeat(32),
  body: { kind: 'offers', offers: [] },
}

describe('device address boundary', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.0.1',
    '192.168.1.5',
    '::1',
    'fd12::1',
    'fc00:0:0:0:0:0:0:1',
  ])('allows chosen private literal %s', (address) => {
    expect(checkedDeviceAddress(address)).toBeDefined()
  })
  it.each([
    '0.0.0.0',
    '::',
    '8.8.8.8',
    '169.254.169.254',
    '100.100.100.200',
    '172.32.0.1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fe80::1',
    'fd00:ec2::254',
    'FD00:0EC2:0:0:0:0:0:0254',
    'fd12::1%eth0',
    '0177.0.0.1',
    'http://10.0.0.1',
  ])('refuses public, metadata, mapped, wildcard or nonliteral %s', (address) => {
    expect(() => checkedDeviceAddress(address)).toThrow('invalid-device-address')
  })
  it('requires actual interface ownership and normalizes IPv6', () => {
    expect(checkedDeviceInterface('fd12:0:0:0:0:0:0:1', ['fd12::1'])).toBe('fd12::1')
    expect(() => checkedDeviceInterface('10.1.2.3', ['10.1.2.4'])).toThrow(
      'invalid-device-interface',
    )
  })
  it('rechecks all DNS answers and pins the checked literal per connection', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(['10.1.2.3'])
      .mockResolvedValueOnce(['10.1.2.3', '169.254.169.254'])
    expect(await resolveDeviceAddress('receiver.local', '10.1.2.4', lookup)).toBe('10.1.2.3')
    await expect(resolveDeviceAddress('receiver.local', '10.1.2.4', lookup)).rejects.toThrow()
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('refuses missing/flooded answers, loopback substitution and wrong family', async () => {
    for (const addresses of [
      [],
      ['127.0.0.1'],
      ['::1'],
      ['fd12::1'],
      Array.from({ length: DEVICE_LIMITS.entries + 1 }, () => '10.0.0.1'),
    ]) {
      await expect(
        resolveDeviceAddress('peer.local', '10.0.0.2', () => Promise.resolve(addresses)),
      ).rejects.toThrow()
    }
  })
  it('accepts manual literal without discovery or a second lookup', async () => {
    const lookup = vi.fn()
    expect(await resolveDeviceAddress('10.0.0.1', '10.0.0.2', lookup)).toBe('10.0.0.1')
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('device pre-parse boundary', () => {
  it('RVM100T-P3 concatenates once per complete frame without copying incomplete prefixes', () => {
    const bytes = encodeDeviceFrame(transportFrame)
    const decoder = new DeviceFrameDecoder()
    const concat = vi.spyOn(Buffer, 'concat')
    try {
      for (let offset = 0; offset < bytes.length - 1; offset += 1)
        expect(decoder.push(bytes.subarray(offset, offset + 1), 1)).toEqual([])
      expect(concat).not.toHaveBeenCalled()
      expect(decoder.push(bytes.subarray(-1), 1)).toEqual([transportFrame])
      expect(concat).toHaveBeenCalledTimes(1)
    } finally {
      concat.mockRestore()
    }
  })
  it('RVM100T-P3 refuses 128 KiB in one-byte records at the fragment bound in under one second', () => {
    const json = Buffer.from(JSON.stringify(transportFrame))
    const bytes = Buffer.concat([
      json,
      Buffer.alloc(DEVICE_LIMITS.frameBytes - json.length, 0x20),
      Buffer.from('\n'),
    ])
    const decoder = new DeviceFrameDecoder()
    let refusedAt: number | undefined
    const started = performance.now()
    for (let offset = 0; offset < bytes.length; offset += 1) {
      try {
        decoder.push(bytes.subarray(offset, offset + 1), 1)
      } catch (error) {
        expect(error).toEqual(new Error('invalid-frame'))
        refusedAt = offset
        break
      }
    }
    expect(refusedAt).toBe(DEVICE_LIMITS.frameFragments)
    expect(performance.now() - started).toBeLessThan(1000)
  })
  it('RVM100T-P3 admits the exact fragment cap and resets it for the next frame', () => {
    const json = Buffer.from(JSON.stringify(transportFrame))
    const bytes = Buffer.concat([
      json,
      Buffer.alloc(DEVICE_LIMITS.frameFragments - json.length, 0x20),
    ])
    const decoder = new DeviceFrameDecoder()
    for (let frame = 0; frame < 2; frame += 1) {
      for (let offset = 0; offset < bytes.length; offset += 1)
        expect(decoder.push(bytes.subarray(offset, offset + 1), 1)).toEqual([])
      expect(decoder.push(Buffer.from('\n'), 1)).toEqual([transportFrame])
      expect(decoder.incomplete).toBe(false)
    }
  })
  it('reports incompatible protocol versions with a fixed upgrade reason', () => {
    expect(() =>
      new DeviceFrameDecoder().push(
        Buffer.from(`${JSON.stringify({ ...transportFrame, version: 0 })}\n`),
        1,
      ),
    ).toThrow('incompatible')
  })
  it('assembles fragmented UTF-8 frames and separates coalesced frames', () => {
    const bytes = encodeDeviceFrame(transportFrame)
    const decoder = new DeviceFrameDecoder()
    expect(decoder.push(bytes.subarray(0, 5), 2)).toEqual([])
    expect(decoder.incomplete).toBe(true)
    expect(decoder.push(Buffer.concat([bytes.subarray(5), bytes]), 2)).toEqual([
      transportFrame,
      transportFrame,
    ])
    expect(decoder.incomplete).toBe(false)
  })
  it('rejects oversize bytes before parsing and before concatenating fragments', () => {
    const decoder = new DeviceFrameDecoder()
    expect(decoder.push(Buffer.alloc(DEVICE_LIMITS.frameBytes, 0x20), 1)).toEqual([])
    expect(() => decoder.push(Buffer.from(' '), 1)).toThrow('invalid-frame')
    expect(() =>
      new DeviceFrameDecoder().push(Buffer.alloc(DEVICE_LIMITS.frameBytes + 1), 1),
    ).toThrow('invalid-frame')
  })
  it('counts byte length for multibyte text and outgoing frames', () => {
    const frame: DeviceFrame = {
      ...transportFrame,
      body: {
        kind: 'dispatch',
        dispatch: {
          kind: 'lane',
          identity: {
            pairId: transportFrame.pairId,
            receiverIncarnationId: transportFrame.receiverIncarnationId,
            boardId: 'd'.repeat(32),
            taskId: 'e'.repeat(32),
            attemptId: 'f'.repeat(32),
          },
          payloadDigest: 'a'.repeat(64),
          repositoryId: 'd'.repeat(32),
          grantId: 'e'.repeat(32),
          grantRevision: 1,
          snapshot: {
            baseCommit: 'a'.repeat(40),
            tree: 'b'.repeat(40),
            manifestDigest: 'c'.repeat(64),
          },
          caps: {
            workers: 1,
            processes: 1,
            heavyChecks: 0,
            tokens: 1,
            spendUsd: 0,
            artifactBytes: 0,
          },
          mode: 'manual',
          route: {
            pairId: transportFrame.pairId,
            deviceId: 'd'.repeat(32),
            receiverIncarnationId: transportFrame.receiverIncarnationId,
            poolId: 'e'.repeat(32),
            entryId: 'f'.repeat(32),
            model: { providerId: 'local', modelId: 'model' },
          },
          roleId: 'a'.repeat(32),
          isolation: 'own-branch',
          brief: '🐈'.repeat(4096),
          guidance: '🐈'.repeat(4096),
          plannedWrites: Array.from({ length: 100 }, () => '🐈'.repeat(255)),
        },
      },
    }
    expect(JSON.stringify(frame).length).toBeLessThan(DEVICE_LIMITS.frameBytes)
    expect(() => encodeDeviceFrame(frame)).toThrow('invalid-frame')
  })
  it.each([
    '{"version":1,"version":1}',
    String.raw`{"version":1,"\u0076ersion":1}`,
    JSON.stringify(transportFrame).replace('"version":1', String.raw`"version":1,"\u0076ersion":1`),
    JSON.stringify(transportFrame).replace('"offers":[]', '"offers":[],"offers":[]'),
    JSON.stringify({ ...transportFrame, version: 0 }),
    JSON.stringify({ ...transportFrame, secret: 'synthetic-sentinel' }),
    '{broken}',
  ])('rejects duplicate keys, unknown versions/fields and malformed JSON: %s', (text) => {
    expect(() => new DeviceFrameDecoder().push(Buffer.from(`${text}\n`), 1)).toThrow()
  })
  it('refuses invalid UTF-8, blank frames and excessive nesting', () => {
    for (const bytes of [
      Buffer.from([0xff, 0x0a]),
      Buffer.from('\n'),
      Buffer.from(`${'['.repeat(40)}0${']'.repeat(40)}\n`),
    ]) {
      expect(() => new DeviceFrameDecoder().push(bytes, 1)).toThrow()
    }
  })
  it('rejects invalid UTF-8 and excessive nesting before invoking JSON.parse', () => {
    const parse = vi.spyOn(JSON, 'parse')
    try {
      for (const bytes of [
        Buffer.from([0xff, 0x0a]),
        Buffer.from(`${'['.repeat(40)}0${']'.repeat(40)}\n`),
      ]) {
        expect(() => new DeviceFrameDecoder().push(bytes, 1)).toThrow()
        expect(parse).not.toHaveBeenCalled()
      }
    } finally {
      parse.mockRestore()
    }
  })
  it('validates outbound data before writing a frame', () => {
    const frame = { ...transportFrame }
    Object.defineProperty(frame, 'version', { value: 0 })
    expect(() => encodeDeviceFrame(frame)).toThrow('invalid-frame')
  })
  it('rejects floods before parsing beyond available queue capacity', () => {
    const bytes = Buffer.concat(
      Array.from({ length: DEVICE_LIMITS.queuedFrames + 1 }, () =>
        encodeDeviceFrame(transportFrame),
      ),
    )
    expect(() => new DeviceFrameDecoder().push(bytes, DEVICE_LIMITS.queuedFrames)).toThrow(
      'invalid-frame',
    )
    expect(() => new DeviceFrameDecoder().push(encodeDeviceFrame(transportFrame), 0)).toThrow(
      'invalid-frame',
    )
  })
})
