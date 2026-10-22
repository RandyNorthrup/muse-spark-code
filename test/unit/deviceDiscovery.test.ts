// M100 lane D: discovery validation and the switch over the real store.
// A disabled policy starts nothing; bad ports and unknown interfaces
// refuse before any socket; the switch persists the choice in the real
// store and surfaces the live blocked verdict when the interface cannot
// serve. Live multicast stays lead-side on qualified machines.
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceDiscovery, type DeviceDiscoveryStatus } from '../../src/host/devices/deviceDiscovery'
import { DeviceDiscoverySwitch } from '../../src/host/devices/deviceDiscoverySwitch'
import { createDeviceMdnsPort } from '../../src/host/devices/deviceMdns'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import { deviceWebviewRequestSchema } from '../../src/shared/devicesPanel'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import { deviceStorage, endDeviceStorage, privateDeviceRoot } from './helpers/deviceFixtures'
import type { DeviceStorageProtection } from '../../src/core/devices/storageProtection'

const logged: LoggedMessage[] = []
const log = levelLogger(logged)

function discoveryWith(statuses: DeviceDiscoveryStatus[]): DeviceDiscovery {
  const discovery = new DeviceDiscovery(createDeviceMdnsPort(log), () => ['127.0.0.1'], log)
  discovery.onStatus((status) => {
    statuses.push(status)
  })
  return discovery
}

function enabledPolicy(): { isEnabled(): boolean; isPairedReceiverOffering(): boolean } {
  return { isEnabled: () => true, isPairedReceiverOffering: () => true }
}

function choice(isEnabled: boolean): unknown {
  return deviceWebviewRequestSchema.parse({
    type: 'deviceRequest',
    viewId: 'a'.repeat(32),
    requestId: 'b'.repeat(32),
    revision: 0,
    action: { kind: 'setDiscovery', enabled: isEnabled },
  })
}

describe('M100 discovery', () => {
  it('a disabled policy publishes off and opens nothing', async () => {
    const statuses: DeviceDiscoveryStatus[] = []
    const discovery = discoveryWith(statuses)
    await discovery.start(
      { isEnabled: () => false, isPairedReceiverOffering: () => true },
      '127.0.0.1',
      8443,
    )
    expect(statuses).toEqual([{ state: 'off' }])
    discovery.stop()
  })

  it('refuses a bad port and an unknown interface before any socket', async () => {
    const statuses: DeviceDiscoveryStatus[] = []
    const discovery = discoveryWith(statuses)
    await expect(discovery.start(enabledPolicy(), '127.0.0.1', 0)).rejects.toThrow(
      'invalid-device-address',
    )
    await expect(discovery.start(enabledPolicy(), '192.0.2.1', 8443)).rejects.toThrow(
      'invalid-device-address',
    )
    discovery.stop()
  })

  it('stop without a start publishes off once', () => {
    const statuses: DeviceDiscoveryStatus[] = []
    discoveryWith(statuses).stop()
    expect(statuses).toEqual([{ state: 'off' }])
  })
})

describe('M100 discovery switch', () => {
  const fixture: { parent: string; storage: DeviceStorageProtection | undefined } = {
    parent: '',
    storage: undefined,
  }
  beforeEach(async () => {
    logged.length = 0
    fixture.storage = await deviceStorage()
    fixture.parent = await privateDeviceRoot('m100-discovery-')
  })
  afterEach(async () => {
    await rm(fixture.parent, { recursive: true, force: true })
  })
  afterAll(endDeviceStorage)

  async function switched(): Promise<{
    discoverySwitch: DeviceDiscoverySwitch
    store: DeviceStore
    statuses: DeviceDiscoveryStatus[]
  }> {
    const statuses: DeviceDiscoveryStatus[] = []
    const discovery = discoveryWith(statuses)
    const store = await DeviceStore.create(
      path.join(fixture.parent, 'store'),
      'd'.repeat(32),
      fixture.storage,
    )
    const discoverySwitch = new DeviceDiscoverySwitch({
      host: {
        ui: 'desktop',
        remoteName: undefined,
        execution: 'local',
        secretLocation: 'execution-host',
      },
      store,
      discovery,
      isPairedReceiverOffering: () => true,
      localFacts: () =>
        Promise.resolve({
          address: '192.0.2.1',
          port: 8443,
          listenerApplication: 'Muse Spark Code',
          interfaceLabel: 'unusable',
        }),
      log,
    })
    await discoverySwitch.load()
    return { discoverySwitch, store, statuses }
  }

  it('reports disabled before any choice', async () => {
    const { discoverySwitch, store } = await switched()
    expect(discoverySwitch.status().enabled).toBe(false)
    expect(discoverySwitch.isEnabled()).toBe(false)
    await store.close()
  })

  it('a choice the interface cannot serve persists off with the blocked verdict', async () => {
    const { discoverySwitch, store, statuses } = await switched()
    const setup = await discoverySwitch.handle(choice(true))
    expect(setup.failure).toBe('blocked-or-unreachable')
    expect(discoverySwitch.status()).toMatchObject({
      enabled: false,
      failure: 'blocked-or-unreachable',
    })
    expect(statuses).toEqual([{ state: 'off' }])
    await expect(store.read()).resolves.toMatchObject({ discoveryEnabled: false })
    await store.close()
  })

  it('switching off is clean and persists off', async () => {
    const { discoverySwitch, store } = await switched()
    const setup = await discoverySwitch.handle(choice(false))
    expect(setup.failure).toBeUndefined()
    expect(discoverySwitch.status()).toMatchObject({ enabled: false })
    await expect(store.read()).resolves.toMatchObject({ discoveryEnabled: false })
    await store.close()
  })
})
