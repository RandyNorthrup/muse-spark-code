// Lane D: the discovery switch stays off until an explicit local choice, and
// a denied bind answers the fixed Blocked-or-unreachable setup. Manual entry
// pairs with discovery fully blocked. No real socket opens in these tests.
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceDiscovery, type DeviceMdnsPort } from '../../src/host/devices/deviceDiscovery'
import { DeviceDiscoverySwitch } from '../../src/host/devices/deviceDiscoverySwitch'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import type { DeviceExecutionHost } from '../../src/host/devices/deviceSecrets'
import type { DeviceWebviewRequest } from '../../src/shared/modelsPanel'
import { removeDeviceFixture } from './helpers/deviceFixtures'
import { laneTestHost, startLaneTestHost } from './helpers/deviceLaneHosts'

const localHost: DeviceExecutionHost = laneTestHost
const facts = {
  address: '10.0.0.1',
  port: 4321,
  listenerApplication: 'node',
  interfaceLabel: 'lo',
}
function recordingPort() {
  const calls = { open: 0, advertise: 0, close: 0 }
  const port: DeviceMdnsPort = {
    open: () => {
      calls.open += 1
      return Promise.resolve({
        advertise: () => {
          calls.advertise += 1
        },
        close: () => {
          calls.close += 1
        },
      })
    },
    decode: () => {
      throw new Error('invalid-frame')
    },
  }
  return { port, calls }
}

const stores: DeviceStore[] = []
const fixture = { parent: '', serial: 0 }
afterEach(async () => {
  await removeDeviceFixture(stores, fixture.parent)
  fixture.parent = ''
  vi.restoreAllMocks()
})
async function radio(id: string, port: DeviceMdnsPort, isOffering = true, host = localHost) {
  fixture.serial += 1
  // Directory names are free text; device ids must be 32 hex chars.
  const deviceId = fixture.serial.toString(16).padStart(32, '0')
  if (fixture.parent === '')
    fixture.parent = await realpath(await mkdtemp(path.join(tmpdir(), 'm100-d-switch-')))
  const store = await DeviceStore.create(path.join(fixture.parent, id), deviceId)
  stores.push(store)
  const discovery = new DeviceDiscovery(port, () => ['10.0.0.1'])
  const control = new DeviceDiscoverySwitch({
    host,
    store,
    discovery,
    isPairedReceiverOffering: () => isOffering,
    localFacts: () => Promise.resolve(facts),
  })
  const { adapter } = startLaneTestHost(store, host)
  const act = (action: DeviceWebviewRequest['action']) =>
    control.handle({
      type: 'deviceRequest',
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
      revision: 0,
      action,
    })
  return { control, discovery, store, adapter, act }
}

describe('discovery switch', () => {
  it('reads off by default and never touches the network until chosen', async () => {
    const { port, calls } = recordingPort()
    const { control } = await radio('a', port)
    await control.load()
    expect(control.isEnabled()).toBe(false)
    expect(calls).toEqual({ open: 0, advertise: 0, close: 0 })
    // A neighboring lane's kind is not ours: it throws for the chain.
    await expect(
      control.handle({
        type: 'deviceRequest',
        viewId: '9'.repeat(32),
        requestId: 'f'.repeat(32),
        revision: 0,
        action: { kind: 'pair' },
      }),
    ).rejects.toThrow('invalid-frame')
    await expect(
      control.handle({
        type: 'deviceRequest',
        viewId: 'nope',
        requestId: 'nope',
        revision: 0,
        action: { kind: 'pair' },
      }),
    ).rejects.toThrow('invalid-frame')
    expect(calls).toEqual({ open: 0, advertise: 0, close: 0 })
  })
  it('starts and stops discovery on the explicit choice and persists it', async () => {
    const { port, calls } = recordingPort()
    const first = await radio('b', port)
    await first.control.load()
    expect(await first.act({ kind: 'setDiscovery', enabled: true })).toMatchObject({
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
    })
    expect(first.control.isEnabled()).toBe(true)
    expect(calls.open).toBe(1)
    const storedOn = await first.store.read()
    expect(storedOn.discoveryEnabled).toBe(true)
    expect(await first.act({ kind: 'setDiscovery', enabled: false })).not.toHaveProperty('failure')
    expect(first.control.isEnabled()).toBe(false)
    expect(calls.close).toBe(1)
    const storedOff = await first.store.read()
    expect(storedOff.discoveryEnabled).toBe(false)
  })
  it('stays silent when chosen without a paired offer: consent alone opens nothing', async () => {
    const { port, calls } = recordingPort()
    const { control, act } = await radio('b2', port, false)
    await control.load()
    expect(await act({ kind: 'setDiscovery', enabled: true })).not.toHaveProperty('failure')
    expect(control.isEnabled()).toBe(true)
    // The choice persists, but without an offering receiver no socket opens
    // and nothing is announced: consent without an offer is zero traffic.
    expect(calls).toEqual({ open: 0, advertise: 0, close: 0 })
  })
  it('restores the persisted choice across restart, including pre-switch state', async () => {
    const { port } = recordingPort()
    const first = await radio('c', port)
    await first.control.load()
    await first.act({ kind: 'setDiscovery', enabled: true })
    // A fresh switch over the same store reopens the persisted choice.
    const revived = new DeviceDiscoverySwitch({
      host: localHost,
      store: first.store,
      discovery: first.discovery,
      isPairedReceiverOffering: () => true,
      localFacts: () => Promise.resolve(facts),
    })
    await revived.load()
    expect(revived.isEnabled()).toBe(true)
    // State written before the switch existed opens and reads as off.
    const stored: unknown = JSON.parse(
      await readFile(path.join(fixture.parent, 'c', 'pairs.json'), 'utf8'),
    )
    if (typeof stored !== 'object' || stored === null) throw new Error('No test state')
    const legacy: Record<string, unknown> = {}
    for (const key of Object.keys(stored)) {
      if (key !== 'discoveryEnabled') legacy[key] = Reflect.get(stored, key)
    }
    await writeFile(path.join(fixture.parent, 'c', 'pairs.json'), JSON.stringify(legacy))
    const legacySwitch = new DeviceDiscoverySwitch({
      host: localHost,
      store: first.store,
      discovery: first.discovery,
      isPairedReceiverOffering: () => true,
      localFacts: () => Promise.resolve(facts),
    })
    await legacySwitch.load()
    expect(legacySwitch.isEnabled()).toBe(false)
  })
  it('answers a denied bind with fixed Blocked-or-unreachable recovery and no leaked text', async () => {
    const denying: DeviceMdnsPort = {
      open: () => Promise.reject(new Error('synthetic-private-path-sentinel')),
      decode: () => {
        throw new Error('invalid-frame')
      },
    }
    const { control, act, store } = await radio('d', denying)
    await control.load()
    const reply = await act({ kind: 'setDiscovery', enabled: true })
    expect(reply.failure).toBe('blocked-or-unreachable')
    expect(reply.listenerApplication).toBe('node')
    expect(reply.interfaceLabel).toBe('lo')
    expect(JSON.stringify(reply)).not.toContain('synthetic-private-path-sentinel')
    expect(control.isEnabled()).toBe(false)
    const storedDenied = await store.read()
    expect(storedDenied.discoveryEnabled).toBe(false)
  })
  it('refuses the switch on an unqualified host without probing', async () => {
    const { port, calls } = recordingPort()
    const remote = { ...localHost, execution: 'remote' as const }
    const { act } = await radio('e', port, true, remote)
    const reply = await act({ kind: 'setDiscovery', enabled: true })
    expect(reply.failure).toBe('unsupported-host')
    expect(calls).toEqual({ open: 0, advertise: 0, close: 0 })
  })
})

describe('manual entry with discovery fully blocked', () => {
  it('pairs over typed text while multicast stays denied and silent', async () => {
    const denying: DeviceMdnsPort = {
      open: () => Promise.reject(new Error('multicast-denied-sentinel')),
      decode: () => {
        throw new Error('invalid-frame')
      },
    }
    const victim = await radio('f', denying)
    const peer = await radio('g', denying)
    await victim.control.load()
    await peer.control.load()
    expect(victim.control.isEnabled()).toBe(false)
    const localReply = await victim.adapter.handle({
      type: 'deviceRequest',
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
      revision: 0,
      action: { kind: 'pair' },
    })
    const peerReply = await peer.adapter.handle({
      type: 'deviceRequest',
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
      revision: 0,
      action: { kind: 'pair' },
    })
    expect(localReply.failure).toBeUndefined()
    expect(peerReply.failure).toBeUndefined()
    expect(localReply.invitation).toBeDefined()
    expect(peerReply.invitation).toBeDefined()
  })
})
