// M100 lane D: mDNS discovery packets and the real UDP port. The encoder's
// three-record announcement decodes back to its service, port and version;
// truncated, empty and foreign-shaped packets refuse with the fixed word;
// opening the real socket on an unusable interface reports
// blocked-or-unreachable. Live multicast stays lead-side on qualified
// machines.
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  createDeviceMdnsPort,
  decodeDeviceMdnsPacket,
  encodeDeviceMdnsPacket,
} from '../../src/host/devices/deviceMdns'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'

const SERVICE_ID = 'a'.repeat(32)

describe('M100 mDNS codec', () => {
  it('round-trips service, port and version', () => {
    expect(decodeDeviceMdnsPacket(encodeDeviceMdnsPacket(SERVICE_ID, 8443))).toEqual({
      serviceId: SERVICE_ID,
      port: 8443,
      version: DEVICE_LIMITS.protocolVersion,
    })
    expect(decodeDeviceMdnsPacket(encodeDeviceMdnsPacket('b'.repeat(32), 1))).toMatchObject({
      serviceId: 'b'.repeat(32),
      port: 1,
    })
  })

  it('reads the TXT identity bytes it was given', () => {
    const packet = encodeDeviceMdnsPacket(SERVICE_ID, 8443)
    const at = packet.indexOf('id=') + 'id='.length
    const flipped = Buffer.from(packet)
    const next = flipped[at] === 'a'.codePointAt(0) ? 'b' : 'a'
    flipped.write(next, at, 'utf8')
    const decoded = decodeDeviceMdnsPacket(flipped)
    expect(decoded.serviceId).not.toBe(SERVICE_ID)
    expect(decoded.serviceId).toHaveLength(32)
    expect(decoded.port).toBe(8443)
  })

  it('refuses truncated, empty and foreign-shaped packets with the fixed word', () => {
    const packet = encodeDeviceMdnsPacket(SERVICE_ID, 8443)
    expect(() => decodeDeviceMdnsPacket(packet.subarray(0, Math.floor(packet.length / 2)))).toThrow(
      'invalid-frame',
    )
    expect(() => decodeDeviceMdnsPacket(Buffer.alloc(0))).toThrow('invalid-frame')
    const foreign = Buffer.from(packet)
    const marker = Buffer.from('_musespark', 'utf8')
    let at = foreign.indexOf(marker)
    while (at >= 0) {
      Buffer.from('_othersvc_', 'utf8').copy(foreign, at)
      at = foreign.indexOf(marker, at + marker.length)
    }
    expect(foreign.indexOf(marker)).toBe(-1)
    expect(() => decodeDeviceMdnsPacket(foreign)).toThrow('invalid-frame')
  })
})

describe('M100 mDNS port', () => {
  it('opening on an unusable interface reports blocked-or-unreachable', async () => {
    const logged: LoggedMessage[] = []
    const port = createDeviceMdnsPort(levelLogger(logged))
    await expect(port.open('192.0.2.1', () => undefined)).rejects.toThrow('blocked-or-unreachable')
    expect(logged.some((entry) => entry.level === 'error')).toBe(true)
  })
})
