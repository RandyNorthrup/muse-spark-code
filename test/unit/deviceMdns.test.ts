// Lane D: mDNS advertises only opaque id, port and version; a spoofed record
// never replaces the saved peer pin. No real socket opens in these tests.
//
// Wire vectors below are captures from the reference codec (dns-packet
// 5.6.1) for our exact records, decoded here as hex: the decoder under test
// never sees that library. Adversarial shapes are byte mutations of the
// fixed golden, so every refusal is proven against third-party bytes.
import { mkdtemp, realpath } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceDiscovery } from '../../src/host/devices/deviceDiscovery'
import {
  createDeviceMdnsPort,
  decodeDeviceMdnsPacket,
  type DeviceMdnsUdpSocket,
} from '../../src/host/devices/deviceMdns'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import { removeDeviceFixture } from './helpers/deviceFixtures'
import { startLaneTestHost } from './helpers/deviceLaneHosts'

// dns-packet 5.6.1 encoding of PTR + SRV(port 4321) + TXT(id, v=1) for
// instance d-aaa…a under _musespark._tcp.local, TTL 120.
const GOLDEN_RESPONSE_HEX =
  '0000800000000003000000000a5f6d757365737061726b045f746370056c6f63616c00000c00010000007800260e642d6161616161616161616161610a5f6d757365737061726b045f746370056c6f63616c000e642d6161616161616161616161610a5f6d757365737061726b045f746370056c6f63616c000021000100000078002c0000000010e10e642d6161616161616161616161610a5f6d757365737061726b045f746370056c6f63616c000e642d6161616161616161616161610a5f6d757365737061726b045f746370056c6f63616c00001000010000007800282369643d616161616161616161616161616161616161616161616161616161616161616103763d31'
// dns-packet 5.6.1 PTR query for _musespark._tcp.local.
const GOLDEN_QUERY_HEX =
  '0000000000010000000000000a5f6d757365737061726b045f746370056c6f63616c00000c0001'
// dns-packet 5.6.1 response for an unrelated printer service.
const GOLDEN_FOREIGN_HEX =
  '000080000000000200000000085f7072696e746572045f746370056c6f63616c00000c000100000078001d077072696e746572085f7072696e746572045f746370056c6f63616c00077072696e746572085f7072696e746572045f746370056c6f63616c00001000010000007800100f6d6f64656c3d73796e746865746963'

const goldenResponse = () => Buffer.from(GOLDEN_RESPONSE_HEX, 'hex')
const goldenQuery = () => Buffer.from(GOLDEN_QUERY_HEX, 'hex')
const goldenForeign = () => Buffer.from(GOLDEN_FOREIGN_HEX, 'hex')
const advertisement = { serviceId: 'a'.repeat(32), port: 4321, version: 1 as const }

class FakeSocket implements DeviceMdnsUdpSocket {
  private readonly messageListeners: ((message: Buffer, sender: { address: string }) => void)[] = []
  private readonly errorListeners: ((error: Error) => void)[] = []
  public boundPort: number | undefined
  public interfaceAddress: string | undefined
  public memberships: { address: string; interfaceAddress: string }[] = []
  public sent: { message: Buffer; port: number; address: string }[] = []
  public closed = 0
  public bindFails = false
  public bind(port: number, callback: () => void): void {
    if (this.bindFails) {
      queueMicrotask(() => {
        for (const listener of this.errorListeners) listener(new Error('bind-sentinel'))
      })
      return
    }
    this.boundPort = port
    queueMicrotask(callback)
  }
  public send(message: Buffer, port: number, address: string): void {
    this.sent.push({ message, port, address })
  }
  public addMembership(address: string, interfaceAddress: string): void {
    this.memberships.push({ address, interfaceAddress })
  }
  public setMulticastInterface(interfaceAddress: string): void {
    this.interfaceAddress = interfaceAddress
  }
  public onMessage(listener: (message: Buffer, sender: { address: string }) => void): void {
    this.messageListeners.push(listener)
  }
  public onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener)
  }
  public close(): void {
    this.closed += 1
  }
  public inject(message: Buffer, address: string): void {
    for (const listener of this.messageListeners) listener(message, { address })
  }
}

/** Overwrites bytes at an absolute offset; lengths must already match. */
function patch(packet: Buffer, offset: number, bytes: Buffer): Buffer {
  const next = Buffer.from(packet)
  bytes.copy(next, offset)
  return next
}

async function startDiscovery(socket: FakeSocket, port = 4321): Promise<DeviceDiscovery> {
  const discovery = new DeviceDiscovery(
    createDeviceMdnsPort(() => socket),
    () => ['10.0.0.1'],
  )
  await discovery.start(
    { isEnabled: () => true, isPairedReceiverOffering: () => true },
    '10.0.0.1',
    port,
  )
  return discovery
}

describe('mDNS binding', () => {
  it('binds the multicast group on the chosen interface and announces only id, port and version', async () => {
    const socket = new FakeSocket()
    const port = createDeviceMdnsPort(() => socket)
    const session = await port.open('10.0.0.1', () => undefined)
    expect(socket.boundPort).toBe(5353)
    expect(socket.interfaceAddress).toBe('10.0.0.1')
    expect(socket.memberships).toEqual([{ address: '224.0.0.251', interfaceAddress: '10.0.0.1' }])
    session.advertise(advertisement)
    expect(socket.sent).toHaveLength(1)
    const sent = socket.sent[0]
    if (sent === undefined) throw new Error('No test announcement')
    expect(sent.port).toBe(5353)
    expect(sent.address).toBe('224.0.0.251')
    const decoded = decodeDeviceMdnsPacket(sent.message)
    expect(decoded).toEqual(advertisement)
    expect(Object.keys(decoded).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
      'port',
      'serviceId',
      'version',
    ])
    const raw = sent.message.toString('latin1')
    expect(raw).not.toContain(hostname())
    expect(raw).not.toContain('PRIVATE KEY')
    session.close()
    expect(socket.closed).toBe(1)
  })
  it('decodes the reference capture and answers the reference query', async () => {
    expect(decodeDeviceMdnsPacket(goldenResponse())).toEqual(advertisement)
    const socket = new FakeSocket()
    const port = createDeviceMdnsPort(() => socket)
    const received: Buffer[] = []
    const session = await port.open('10.0.0.1', (message) => {
      received.push(message)
    })
    session.advertise(advertisement)
    const before = socket.sent.length
    socket.inject(goldenQuery(), '10.0.0.2')
    expect(socket.sent.length).toBeGreaterThan(before)
    // A well-formed query for another service gets silence, not a refusal:
    // it is simply not ours.
    const other = patch(goldenQuery(), 13, Buffer.from([0x58]))
    socket.inject(other, '10.0.0.2')
    expect(socket.sent.length).toBe(before + 1)
    // Queries carry no advertisement: decode refuses them, discovery stays silent.
    for (const message of received)
      expect(() => decodeDeviceMdnsPacket(message)).toThrow('invalid-frame')
    session.close()
  })
  it('refuses garbage, truncation, foreign services and extra-only records', () => {
    expect(() => decodeDeviceMdnsPacket(Buffer.from([0, 1, 2]))).toThrow('invalid-frame')
    expect(() => decodeDeviceMdnsPacket(Buffer.alloc(0))).toThrow('invalid-frame')
    expect(() => decodeDeviceMdnsPacket(goldenResponse().subarray(0, 20))).toThrow('invalid-frame')
    expect(() => decodeDeviceMdnsPacket(goldenResponse().subarray(0, -1))).toThrow('invalid-frame')
    expect(() => decodeDeviceMdnsPacket(goldenQuery())).toThrow('invalid-frame')
    expect(() => decodeDeviceMdnsPacket(goldenForeign())).toThrow('invalid-frame')
    // A TXT entry without our shape carries nothing, even under our service.
    const noId = patch(goldenResponse(), goldenResponse().indexOf('id='), Buffer.from('xx='))
    expect(() => decodeDeviceMdnsPacket(noId)).toThrow('invalid-frame')
    // An incompatible version decodes but never survives the contract parse.
    const versioned = patch(goldenResponse(), goldenResponse().indexOf('v=1'), Buffer.from('v=0'))
    expect(decodeDeviceMdnsPacket(versioned)).toEqual({ ...advertisement, version: 0 })
  })
  it('ignores extra entries and survives compression, flush bits and case', () => {
    const response = goldenResponse()
    // An extra TXT entry beside id and version is ignored, never returned.
    const idIndex = response.indexOf('id=')
    const rdLengthAt = idIndex - 3
    const extra = Buffer.concat([
      response.subarray(0, idIndex + 35),
      Buffer.from([0x08]),
      Buffer.from('account='),
      response.subarray(idIndex + 35),
    ])
    const grownLength = (response[rdLengthAt] ?? 0) * 256 + (response[rdLengthAt + 1] ?? 0) + 9
    const sized = patch(extra, rdLengthAt, Buffer.from([grownLength >> 8, grownLength & 0xff]))
    expect(sized.length).toBe(response.length + 9)
    expect(decodeDeviceMdnsPacket(sized)).toEqual(advertisement)
    // A TXT whose SRV instance was spoofed carries no usable port.
    const names = thumbs(response)
    const spoofed = patch(response, names[1] ?? 0, Buffer.from('e'))
    expect(() => decodeDeviceMdnsPacket(spoofed)).toThrow('invalid-frame')
    // Compression pointers resolve; a self-pointer loop refuses. The marker
    // omits the length prefix, so the wire name starts one byte earlier.
    const srvNameAt = (names[1] ?? 0) - 1
    const pointed = Buffer.concat([
      response.subarray(0, srvNameAt),
      Buffer.from([0xc0, (names[0] ?? 0) - 1]),
      response.subarray(srvNameAt + 38),
    ])
    expect(decodeDeviceMdnsPacket(pointed)).toEqual(advertisement)
    const loop = Buffer.concat([
      Buffer.from([0, 0, 0x80, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 0x0c]),
      Buffer.alloc(10),
    ])
    expect(() => decodeDeviceMdnsPacket(loop)).toThrow('invalid-frame')
    // Cache-flush classes and uppercase names still match our service.
    const srvTypeAt = response.indexOf(Buffer.from([0x00, 0x21]))
    const flushed = patch(response, srvTypeAt + 2, Buffer.from([0x80, 0x01]))
    expect(decodeDeviceMdnsPacket(flushed)).toEqual(advertisement)
    const upper = Buffer.from(
      response.toString('latin1').replaceAll('musespark', 'MUSESPARK'),
      'latin1',
    )
    expect(decodeDeviceMdnsPacket(upper)).toEqual(advertisement)
  })
  it('maps a denied bind to the fixed blocked-or-unreachable recovery', async () => {
    const socket = new FakeSocket()
    socket.bindFails = true
    await expect(startDiscovery(socket)).rejects.toThrow('blocked-or-unreachable')
  })
  it('drops an incompatible version through the contract parse end to end', async () => {
    const socket = new FakeSocket()
    const discovery = await startDiscovery(socket)
    const versioned = patch(goldenResponse(), goldenResponse().indexOf('v=1'), Buffer.from('v=0'))
    socket.inject(versioned, '10.0.0.2')
    expect(discovery.hint(advertisement.serviceId)).toBeUndefined()
    socket.inject(goldenResponse(), '10.0.0.2')
    expect(discovery.hint(advertisement.serviceId)).toEqual({ address: '10.0.0.2', port: 4321 })
    discovery.stop()
  })
})

/** Absolute offsets of the three instance-name occurrences in the golden. */
function thumbs(packet: Buffer): number[] {
  const marker = Buffer.from(`d-${'a'.repeat(12)}`)
  const offsets: number[] = []
  let from = 0
  for (;;) {
    const at = packet.indexOf(marker, from)
    if (at === -1) return offsets
    offsets.push(at)
    from = at + 1
  }
}

describe('a spoofed mDNS record never replaces the saved peer pin', () => {
  const stores: DeviceStore[] = []
  let parent = ''
  afterEach(async () => {
    await removeDeviceFixture(stores, parent)
    vi.restoreAllMocks()
  })
  async function pairedHost(id: string) {
    parent =
      parent === '' ? await realpath(await mkdtemp(path.join(tmpdir(), 'm100-d-spoof-'))) : parent
    const store = await DeviceStore.create(path.join(parent, id), id.repeat(32))
    stores.push(store)
    const { adapter, act } = startLaneTestHost(store)
    return { adapter, act }
  }
  it('stays an address hint; material still demands the saved fingerprint', async () => {
    const victim = await pairedHost('a')
    const peer = await pairedHost('b')
    const localReply = await victim.act({ kind: 'pair' })
    const peerReply = await peer.act({ kind: 'pair' })
    expect(localReply.failure).toBeUndefined()
    expect(peerReply.failure).toBeUndefined()
    const localInvite = localReply.invitation
    const peerInvite = peerReply.invitation
    if (localInvite === undefined || peerInvite === undefined) throw new Error('No test invitation')
    const imported = await victim.act({
      kind: 'importInvitation',
      text: JSON.stringify(peerInvite),
    })
    expect(imported.failure).toBeUndefined()
    const confirmationReply = await victim.act({
      kind: 'confirmFingerprint',
      invitationId: peerInvite.invitationId,
      fingerprint: peerInvite.fingerprint,
    })
    const confirmation = confirmationReply.confirmation
    const peerImported = await peer.act({
      kind: 'importInvitation',
      text: JSON.stringify(localInvite),
    })
    expect(peerImported.failure).toBeUndefined()
    const peerConfirmationReply = await peer.act({
      kind: 'confirmFingerprint',
      invitationId: localInvite.invitationId,
      fingerprint: localInvite.fingerprint,
    })
    const peerConfirmation = peerConfirmationReply.confirmation
    if (confirmation === undefined || peerConfirmation === undefined)
      throw new Error('No test confirmation')
    const completed = await victim.act({
      kind: 'importConfirmation',
      confirmation: peerConfirmation,
    })
    expect(completed.failure).toBeUndefined()
    const pairId = confirmation.pairId
    // Positive control: the saved peer fingerprint materials the pair.
    await expect(
      victim.adapter.material(pairId, peerInvite.fingerprint, false),
    ).resolves.toBeDefined()
    // The drill: an attacker answers discovery pointing at itself. The
    // attacker packet is the golden shape with the attacker's id and port:
    // in hex the id is 61 * 32 and the port 10e1.
    const socket = new FakeSocket()
    const discovery = await startDiscovery(socket, 34_567)
    const attackerHex = goldenResponse()
      .toString('hex')
      .replaceAll('61'.repeat(32), '65'.repeat(32))
      .replaceAll('10e1', '270f')
    const attackerPacket = Buffer.from(attackerHex, 'hex')
    socket.inject(attackerPacket, '10.0.0.99')
    const hint = discovery.hint('e'.repeat(32))
    expect(hint).toEqual({ address: '10.0.0.99', port: 9999 })
    expect(Object.keys(hint ?? {}).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
      'address',
      'port',
    ])
    // The hint carries no identity: pairing with the attacker's pin fails,
    // and the saved peer still materials.
    await expect(victim.adapter.material(pairId, '0'.repeat(64), false)).rejects.toThrow('unpaired')
    await expect(
      victim.adapter.material(pairId, peerInvite.fingerprint, false),
    ).resolves.toBeDefined()
    discovery.stop()
  })
})
