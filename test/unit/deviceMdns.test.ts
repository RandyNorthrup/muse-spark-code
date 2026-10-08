// Lane D: mDNS advertises only opaque id, port and version; a spoofed record
// never replaces the saved peer pin. No real socket opens in these tests.
import { mkdtemp, realpath } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import * as dnsPacket from 'dns-packet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceDiscovery } from '../../src/host/devices/deviceDiscovery'
import {
  createDeviceMdnsPort,
  decodeDeviceMdnsPacket,
  type DeviceMdnsUdpSocket,
} from '../../src/host/devices/deviceMdns'
import { DevicePairing } from '../../src/host/devices/devicePairing'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import { DeviceSecrets, type DeviceExecutionHost } from '../../src/host/devices/deviceSecrets'
import type { DeviceWebviewRequest } from '../../src/shared/modelsPanel'
import { deviceTestExpiry, deviceTestNow, removeDeviceFixture } from './helpers/deviceFixtures'

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

const advertisement = { serviceId: 'a'.repeat(32), port: 4321, version: 1 as const }
function responsePacket(answers: dnsPacket.Answer[]): Buffer {
  return dnsPacket.encode({ type: 'response', answers })
}
const localHost: DeviceExecutionHost = {
  ui: 'desktop',
  remoteName: undefined,
  execution: 'local',
  secretLocation: 'execution-host',
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
  it('answers our service query and ignores unrelated traffic', async () => {
    const socket = new FakeSocket()
    const port = createDeviceMdnsPort(() => socket)
    const received: Buffer[] = []
    const session = await port.open('10.0.0.1', (message) => {
      received.push(message)
    })
    session.advertise(advertisement)
    const before = socket.sent.length
    socket.inject(
      dnsPacket.encode({
        type: 'query',
        questions: [{ type: 'PTR', name: '_musespark._tcp.local' }],
      }),
      '10.0.0.2',
    )
    expect(socket.sent.length).toBeGreaterThan(before)
    socket.inject(
      dnsPacket.encode({ type: 'query', questions: [{ type: 'A', name: 'printer.local' }] }),
      '10.0.0.2',
    )
    expect(socket.sent.length).toBe(before + 1)
    // Queries carry no advertisement: decode refuses them, discovery stays silent.
    for (const message of received)
      expect(() => decodeDeviceMdnsPacket(message)).toThrow('invalid-frame')
    session.close()
  })
  it('refuses garbage, foreign services, mismatched instances and extra-only records', () => {
    const instance = `d-${'a'.repeat(12)}._musespark._tcp.local`
    expect(() => decodeDeviceMdnsPacket(Buffer.from([0, 1, 2]))).toThrow('invalid-frame')
    expect(() => decodeDeviceMdnsPacket(Buffer.alloc(0))).toThrow('invalid-frame')
    expect(() =>
      decodeDeviceMdnsPacket(
        responsePacket([
          { type: 'TXT', name: instance, data: [Buffer.from('model=secret')], ttl: 120 },
        ]),
      ),
    ).toThrow('invalid-frame')
    // A TXT under another service never parses as ours, even with our shape.
    expect(() =>
      decodeDeviceMdnsPacket(
        responsePacket([
          {
            type: 'TXT',
            name: `d-${'b'.repeat(12)}._other._tcp.local`,
            data: [Buffer.from(`id=${'b'.repeat(32)}`), Buffer.from('v=1')],
            ttl: 120,
          },
          {
            type: 'SRV',
            name: `d-${'b'.repeat(12)}._other._tcp.local`,
            data: { port: 9999, target: 'x', priority: 0, weight: 0 },
            ttl: 120,
          },
        ]),
      ),
    ).toThrow('invalid-frame')
    // TXT without the matching SRV instance carries no usable port.
    expect(() =>
      decodeDeviceMdnsPacket(
        responsePacket([
          {
            type: 'TXT',
            name: instance,
            data: [Buffer.from(`id=${'c'.repeat(32)}`), Buffer.from('v=1')],
            ttl: 120,
          },
        ]),
      ),
    ).toThrow('invalid-frame')
    // Extra TXT entries beside id and version are ignored, never returned.
    const extra = decodeDeviceMdnsPacket(
      responsePacket([
        {
          type: 'TXT',
          name: instance,
          data: [
            Buffer.from(`id=${'d'.repeat(32)}`),
            Buffer.from('v=1'),
            Buffer.from('account=synthetic-sentinel'),
            Buffer.from('fingerprint=synthetic-sentinel'),
          ],
          ttl: 120,
        },
        {
          type: 'SRV',
          name: instance,
          data: { port: 4321, target: instance, priority: 0, weight: 0 },
          ttl: 120,
        },
      ]),
    )
    expect(extra).toEqual({ serviceId: 'd'.repeat(32), port: 4321, version: 1 })
  })
  it('maps a denied bind to the fixed blocked-or-unreachable recovery', async () => {
    const socket = new FakeSocket()
    socket.bindFails = true
    const discovery = new DeviceDiscovery(
      createDeviceMdnsPort(() => socket),
      () => ['10.0.0.1'],
    )
    await expect(
      discovery.start(
        { isEnabled: () => true, isPairedReceiverOffering: () => true },
        '10.0.0.1',
        4321,
      ),
    ).rejects.toThrow('blocked-or-unreachable')
    discovery.stop()
  })
})

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
    const values = new Map<string, string>()
    const secrets = new DeviceSecrets(
      {
        get: (key: string) => Promise.resolve(values.get(key)),
        store: (key: string, value: string) => {
          values.set(key, value)
          return Promise.resolve()
        },
        delete: (key: string) => {
          values.delete(key)
          return Promise.resolve()
        },
      },
      localHost,
    )
    const adapter = new DevicePairing({
      store,
      secrets,
      host: localHost,
      now: () => deviceTestNow,
      receiverIncarnationId: '1'.repeat(32),
      setup: () =>
        Promise.resolve({
          endpoint: { address: '127.0.0.1', port: 34_567 },
          certificateExpiresAt: deviceTestExpiry,
          listenerApplication: 'node',
          interfaceLabel: 'lo',
        }),
      disconnectPair: () => undefined,
      otherAction: (request: DeviceWebviewRequest) =>
        Promise.resolve({
          viewId: request.viewId,
          requestId: request.requestId,
          failure: 'grant' as const,
        }),
    })
    const act = (action: DeviceWebviewRequest['action']) =>
      adapter.handle({
        type: 'deviceRequest',
        viewId: '9'.repeat(32),
        requestId: 'f'.repeat(32),
        revision: 0,
        action,
      })
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
    // The drill: an attacker answers discovery pointing at itself.
    const attackerServiceId = 'e'.repeat(32)
    const attackerPacket = dnsPacket.encode({
      type: 'response',
      answers: [
        {
          type: 'PTR',
          name: '_musespark._tcp.local',
          data: `d-eeeeeeeeeeee._musespark._tcp.local`,
          ttl: 120,
        },
        {
          type: 'SRV',
          name: `d-eeeeeeeeeeee._musespark._tcp.local`,
          data: { port: 9999, target: 'attacker.local', priority: 0, weight: 0 },
          ttl: 120,
        },
        {
          type: 'TXT',
          name: `d-eeeeeeeeeeee._musespark._tcp.local`,
          data: [Buffer.from(`id=${attackerServiceId}`), Buffer.from('v=1')],
          ttl: 120,
        },
      ],
    })
    const socket = new FakeSocket()
    const discovery = new DeviceDiscovery(
      createDeviceMdnsPort(() => socket),
      () => ['10.0.0.1'],
    )
    await discovery.start(
      { isEnabled: () => true, isPairedReceiverOffering: () => true },
      '10.0.0.1',
      34_567,
    )
    socket.inject(attackerPacket, '10.0.0.99')
    const hint = discovery.hint(attackerServiceId)
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
