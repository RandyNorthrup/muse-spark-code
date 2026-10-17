// RVM100W 2, 3, 4: the production builder and the real service factory on
// this OS's real filesystem and storage binding (the native helper on
// Windows, POSIX owner/mode checks elsewhere), with the production
// (unbound lane K) ports. First use provisions the private Devices folder;
// every failure path and disposal closes the pairing store and releases its
// `.pairing.lock`; an unbound execution owner still lets the service open,
// answer the ready handshake and refuse Pair with a typed, correlated
// `unsupported-host`.
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { AttemptJournal } from '../../src/core/devices/attemptJournal'
import { DevicePairingError } from '../../src/core/devices/pairing'
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
import { DEVICES_HELPER_DIR, DEVICES_STORAGE_DIR } from '../../src/shared/constants'
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
  return path.join(root, 'globalStorage', DEVICES_STORAGE_DIR)
}
function context(directory: string): DeviceProductionContext {
  return {
    storageDirectory: directory,
    helperDirectory: path.join(path.dirname(directory), DEVICES_HELPER_DIR),
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

  it('recovers from a first-use failure before the folder exists: the retry provisions it', async () => {
    const directory = await storageDirectory()
    // RVM100W2 1: the step before the Devices folder fails once (the Windows
    // helper's start; elsewhere, where no helper exists, the pairing store).
    const failures = { left: 1 }
    const failOnce = <T>(run: () => Promise<T>): Promise<T> => {
      if (failures.left === 0) return run()
      failures.left -= 1
      return Promise.reject(new DevicePairingError('storage'))
    }
    const flaky: DeviceProductionBundle =
      process.platform === 'win32'
        ? {
            ...realBundle,
            startWindowsStorageProtection: (options) =>
              failOnce(() => realBundle.startWindowsStorageProtection(options)),
          }
        : {
            ...realBundle,
            DeviceStore: {
              open: (...args) => realBundle.DeviceStore.open(...args),
              create: (...args) => failOnce(() => realBundle.DeviceStore.create(...args)),
            },
          }
    await expect(
      openDeviceProductionDeps(flaky, context(directory), unbound()),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(failures.left).toBe(0)
    // Nothing half made is left to repair: no folder on Windows, a private one elsewhere.
    if (process.platform === 'win32') expect(existsSync(directory)).toBe(false)
    else expect(await ownerOnlyEvidence(directory, true)).toBe('700')
    const deps = await openDeviceProductionDeps(flaky, context(directory), unbound())
    expect(await ownerOnlyEvidence(directory, true)).toBe('700')
    expect(existsSync(path.join(directory, 'attempts', 'attempts.json'))).toBe(true)
    const parentEntries = await readdir(path.dirname(directory))
    expect(parentEntries.filter((name) => name.endsWith('.stage'))).toEqual([])
    await deps.dispose()
  })

  it('never claims a Devices folder another creator made: it is checked and refused', async () => {
    const directory = await storageDirectory()
    // Another creator's folder, with data in it: not private (inherited ACL
    // on Windows, 0755 elsewhere; chmod, since mkdir's mode passes through
    // the ambient umask and a restrictive one would make it private).
    await mkdir(directory, { recursive: true, mode: 0o755 })
    if (process.platform !== 'win32') await chmod(directory, 0o755)
    await writeFile(path.join(directory, 'theirs.txt'), 'not ours', { mode: 0o600 })
    const before = await ownerOnlyEvidence(directory, true)
    expect(before).not.toBe('700')
    await expect(
      openDeviceProductionDeps(realBundle, context(directory), unbound()),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(await ownerOnlyEvidence(directory, true)).toBe(before)
    expect(await readFile(path.join(directory, 'theirs.txt'), 'utf8')).toBe('not ours')
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
