// RVM100W 2, 3, 4: the production builder and the real service factory on
// this OS's real filesystem and storage binding (the native helper on
// Windows, POSIX owner/mode checks elsewhere), with the production
// (unbound lane K) ports. First use provisions the private Devices folder;
// every failure path and disposal closes the pairing store and releases its
// `.pairing.lock`; an unbound execution owner still lets the service open,
// answer the ready handshake and refuse Pair with a typed, correlated
// `unsupported-host`.
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { AttemptJournal } from '../../src/core/devices/attemptJournal'
import { createDeviceService } from '../../src/host/devices/deviceEntry'
import {
  openDeviceProductionDeps,
  unboundDeviceLanePorts,
  type DeviceProductionBundle,
  type DeviceProductionContext,
} from '../../src/host/devices/deviceProduction'
import { DeviceSecrets } from '../../src/host/devices/deviceSecrets'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import type { DeviceHostMessage } from '../../src/shared/devicesPanel'
import { EN } from '../../src/shared/l10n/en'
import {
  deviceStorage,
  endDeviceStorage,
  ownerOnlyEvidence,
  privateDeviceRoot,
} from './helpers/deviceFixtures'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'

vi.mock('vscode', async () => await import('./mocks/vscode'))

// The production classes; Windows' binding is this suite's shared native
// helper (ended after all), so a test never compiles one of its own.
const realBundle: DeviceProductionBundle = {
  DeviceStore,
  DeviceSecrets,
  AttemptJournal,
  startWindowsStorageProtection: async () => {
    const protection = await deviceStorage()
    if (protection === undefined) throw new Error('windows-binding-unavailable')
    return {
      protection,
      dispose: () => {
        // The shared helper outlives each preparation; endDeviceStorage ends it.
      },
    }
  },
}
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
afterAll(endDeviceStorage)

async function storageDirectory(): Promise<string> {
  const root = await privateDeviceRoot('m100-w2-')
  roots.push(root)
  // Two missing levels: the extension's globalStorage folder may not exist yet either.
  return path.join(root, 'globalStorage', 'devices')
}
function context(directory: string): DeviceProductionContext {
  return {
    storageDirectory: directory,
    helperDirectory: path.join(directory, 'helper'),
    systemRoot: process.env['SystemRoot'],
    extensionPath: process.cwd(),
    secrets: memorySecrets(),
    host: {
      ui: 'desktop',
      remoteName: undefined,
      execution: 'local',
      secretLocation: 'execution-host',
    },
    log: new FakeLogOutputChannel(),
  }
}
function unbound() {
  return unboundDeviceLanePorts(new FakeLogOutputChannel())
}

describe('RVM100W production storage on a real filesystem', () => {
  it('provisions a missing private Devices folder, then reopens it after disposal', async () => {
    const directory = await storageDirectory()
    const first = await openDeviceProductionDeps(realBundle, context(directory), unbound())
    expect(await ownerOnlyEvidence(directory, true)).toBe('700')
    if (process.platform !== 'win32')
      expect(await ownerOnlyEvidence(path.dirname(directory), true)).toBe('700')
    expect(await readdir(path.join(directory, 'pairing'))).toContain('.pairing.lock')
    expect(existsSync(path.join(directory, 'attempts', 'attempts.json'))).toBe(true)
    await first.dispose()
    expect(await readdir(path.join(directory, 'pairing'))).not.toContain('.pairing.lock')
    // The released lock lets the next preparation open the same store and journal.
    const second = await openDeviceProductionDeps(realBundle, context(directory), unbound())
    expect(second.store).not.toBe(first.store)
    await second.dispose()
    expect(await readdir(path.join(directory, 'pairing'))).not.toContain('.pairing.lock')
  })

  it('closes the opened store, releasing its lock, when the journal fails', async () => {
    const directory = await storageDirectory()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const protection = await deviceStorage()
    await protection?.secureFresh(directory, true)
    // A file where the journal folder belongs: provisioning and reopening both refuse.
    await writeFile(path.join(directory, 'attempts'), 'not a journal', { mode: 0o600 })
    await expect(
      openDeviceProductionDeps(realBundle, context(directory), unbound()),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(await readdir(path.join(directory, 'pairing'))).not.toContain('.pairing.lock')
    const store = await DeviceStore.open(
      path.join(directory, 'pairing'),
      protection,
      process.platform,
    )
    await store.close()
  })

  it('opens the real service with unbound lane K ports: ready observes, Pair refuses typed', async () => {
    const directory = await storageDirectory()
    const deps = await openDeviceProductionDeps(realBundle, context(directory), unbound())
    const published: DeviceHostMessage[] = []
    const reports: string[] = []
    try {
      const service = await createDeviceService(
        {
          ...deps,
          snapshot: () => Promise.resolve({ enabled: false as const }),
          publish: (message) => {
            published.push(message)
          },
          report: (reason) => {
            reports.push(reason)
          },
        },
        EN,
        'en',
      )
      try {
        const ready = await service.request({ type: 'devicesReady' })
        expect(ready).toEqual({ type: 'deviceState', revision: 1, state: { enabled: false } })
        expect(published).toEqual([ready])
        const viewId = 'a'.repeat(32)
        const requestId = 'b'.repeat(32)
        const pair = await service.request({
          type: 'deviceRequest',
          viewId,
          requestId,
          revision: ready.revision,
          action: { kind: 'pair' },
        })
        expect(pair.setup).toMatchObject({ viewId, requestId, failure: 'unsupported-host' })
        expect(pair.setup?.invitation).toBeUndefined()
        expect(reports).toEqual([])
      } finally {
        service.dispose()
      }
    } finally {
      await deps.dispose()
    }
  })
})
