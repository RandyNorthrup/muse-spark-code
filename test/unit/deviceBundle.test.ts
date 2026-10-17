import { copyFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { deviceMethods } from '../../src/host/devices/deviceBundle'
import type { DeviceServiceDeps } from '../../src/host/devices/deviceEntry'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { requireFile } from '../../src/host/lazyBundle'
import { buildHostBundles } from './helpers/modelApiBundle'
import { FakeLogOutputChannel } from './helpers/fakes'
import { deferred } from './helpers/deviceExecutionFixtures'
import { removeFolder } from './helpers/temporaryFolders'

// The shipped Devices entry built the way scripts/build.mjs builds host
// bundles, beside the shared English fallback it loads; the file's folder
// is removed after its tests.
const built = { folder: '', file: '' }
beforeAll(async () => {
  // Node keys its module cache by real path (macOS's /var is a link).
  built.folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-devices-bundle-')))
  await buildHostBundles(built.folder, {
    devices: path.resolve('src/host/devices/deviceEntry.ts'),
  })
  built.file = path.join(built.folder, 'devices.js')
})
afterAll(() => removeFolder(built.folder))
afterEach(() => {
  setUiText(EN, 'en')
})
function dependencies(_bundle: unknown): Promise<DeviceServiceDeps> {
  return Promise.reject(new Error('local-authority-unavailable'))
}

describe('shared lazy Devices method port', () => {
  it('unused construction and disposal load no bundle, authority, storage or network', () => {
    const loadBundle = vi.fn(requireFile)
    const prepare = vi.fn(dependencies)
    const methods = deviceMethods({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
      loadBundle,
      dependencies: prepare,
    })
    methods.dispose()
    expect(loadBundle).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })
  it('loads the actual shipped factory only on explicit use and reuses its module across refused preparation', async () => {
    const loadBundle = vi.fn(requireFile)
    const prepare = vi.fn(dependencies)
    const methods = deviceMethods({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
      loadBundle,
      dependencies: prepare,
    })
    await expect(methods.service()).rejects.toThrow('local-authority-unavailable')
    await expect(methods.service()).rejects.toThrow('local-authority-unavailable')
    expect(loadBundle).toHaveBeenCalledExactlyOnceWith(built.file)
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(prepare.mock.calls[0]?.[0]).toMatchObject({
      createDeviceService: expect.any(Function),
      DeviceStore: expect.any(Function),
      DeviceSecrets: expect.any(Function),
      AttemptJournal: expect.any(Function),
      DeviceDiscovery: expect.any(Function),
      openDeviceProductionDeps: expect.any(Function),
      unboundDeviceLanePorts: expect.any(Function),
    })
  })
  it('missing lazy assets refuse before preparing credentials or authorities and can be retried', async () => {
    const prepare = vi.fn(dependencies)
    const methods = deviceMethods({
      bundlePath: path.join(built.folder, 'missing.js'),
      log: new FakeLogOutputChannel(),
      dependencies: prepare,
    })
    await expect(methods.service()).rejects.toThrow(EN.devices.bundleUnavailable)
    await expect(methods.service()).rejects.toThrow(EN.devices.bundleUnavailable)
    expect(prepare).not.toHaveBeenCalled()
  })
  it('rejects an incomplete module and retries the repaired packaged factory', async () => {
    const wrong = path.join(built.folder, 'wrong.js')
    writeFileSync(wrong, 'module.exports = { createDeviceService() {} }')
    const prepare = vi.fn(dependencies)
    const methods = deviceMethods({
      bundlePath: wrong,
      log: new FakeLogOutputChannel(),
      dependencies: prepare,
    })
    await expect(methods.service()).rejects.toThrow(EN.devices.bundleUnavailable)
    expect(prepare).not.toHaveBeenCalled()
    copyFileSync(built.file, wrong)
    await expect(methods.service()).rejects.toThrow('local-authority-unavailable')
    expect(prepare).toHaveBeenCalledOnce()
  })
  it('shares pending initialization and refuses disposal during preparation without opening a receiver', async () => {
    const held = deferred<DeviceServiceDeps>()
    const prepare = vi.fn(() => held.promise)
    const methods = deviceMethods({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
      dependencies: prepare,
    })
    const first = expect(methods.service()).rejects.toThrow('revoked')
    const second = expect(methods.service()).rejects.toThrow('revoked')
    expect(prepare).toHaveBeenCalledOnce()
    methods.dispose()
    // Dependencies need not be inspected after disposal; never substitute an empty success.
    held.reject(new Error('revoked'))
    await Promise.all([first, second])
    await expect(methods.service()).rejects.toThrow('revoked')
  })
})
