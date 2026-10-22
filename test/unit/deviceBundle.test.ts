// The shipped Devices entry, bundled the way scripts/build.mjs bundles host
// entries, loaded through the product's own require. An unused port loads
// nothing; explicit use loads the real factory once and reuses its module;
// a missing or incomplete bundle refuses with the fixed words before any
// credential or authority work, and a repaired one is retried.
import { copyFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { deviceMethods } from '../../src/host/devices/deviceBundle'
import type { DeviceServiceDeps } from '../../src/host/devices/deviceEntry'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { requireFile } from '../../src/host/lazyBundle'
import { errorLogger } from './helpers/collectingLogger'
import { removeFolder } from './helpers/temporaryFolders'

// Bundling the real entry pulls its schema and transport graph; the file's
// folder is removed after its tests.
const BUNDLE_BUILD_TIMEOUT_MS = 60_000
const built = { folder: '', file: '' }
beforeAll(async () => {
  // Node keys its module cache by real path (macOS's /var is a link).
  built.folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-devices-bundle-')))
  built.file = path.join(built.folder, 'devices.js')
  await build({
    entryPoints: [path.resolve('src/host/devices/deviceEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
}, BUNDLE_BUILD_TIMEOUT_MS)
afterAll(() => removeFolder(built.folder))
afterEach(() => {
  setUiText(EN, 'en')
})
function dependencies(_bundle: unknown): Promise<DeviceServiceDeps> {
  return Promise.reject(new Error('local-authority-unavailable'))
}

describe('shared lazy Devices method port', () => {
  it('unused construction and disposal load no bundle, authority, storage or network', () => {
    const loaded: string[] = []
    const prepared: unknown[] = []
    const errors: string[] = []
    const methods = deviceMethods({
      bundlePath: built.file,
      log: errorLogger(errors),
      loadBundle: (file) => {
        loaded.push(file)
        return requireFile(file)
      },
      dependencies: (bundle) => {
        prepared.push(bundle)
        return dependencies(bundle)
      },
    })
    methods.dispose()
    expect(loaded).toEqual([])
    expect(prepared).toEqual([])
    expect(errors).toEqual([])
  })
  it('loads the actual shipped factory only on explicit use and reuses its module across refused preparation', async () => {
    const loaded: string[] = []
    const prepared: unknown[] = []
    const errors: string[] = []
    const methods = deviceMethods({
      bundlePath: built.file,
      log: errorLogger(errors),
      loadBundle: (file) => {
        loaded.push(file)
        return requireFile(file)
      },
      dependencies: (bundle) => {
        prepared.push(bundle)
        return dependencies(bundle)
      },
    })
    await expect(methods.service()).rejects.toThrow('local-authority-unavailable')
    await expect(methods.service()).rejects.toThrow('local-authority-unavailable')
    expect(loaded).toEqual([built.file])
    expect(prepared).toHaveLength(2)
    expect(prepared[0]).toMatchObject({
      createDeviceService: expect.any(Function),
      DeviceStore: expect.any(Function),
      DeviceSecrets: expect.any(Function),
      AttemptJournal: expect.any(Function),
      DeviceDiscovery: expect.any(Function),
      openDeviceProductionDeps: expect.any(Function),
      unboundDeviceLanePorts: expect.any(Function),
    })
    expect(errors).toEqual([])
    methods.dispose()
  })
  it('missing lazy assets refuse before preparing credentials or authorities and can be retried', async () => {
    const prepared: unknown[] = []
    const errors: string[] = []
    const methods = deviceMethods({
      bundlePath: path.join(built.folder, 'missing.js'),
      log: errorLogger(errors),
      dependencies: (bundle) => {
        prepared.push(bundle)
        return dependencies(bundle)
      },
    })
    await expect(methods.service()).rejects.toThrow(EN.devices.bundleUnavailable)
    await expect(methods.service()).rejects.toThrow(EN.devices.bundleUnavailable)
    expect(prepared).toEqual([])
    expect(errors).toHaveLength(2)
    methods.dispose()
  })
  it('rejects an incomplete module and retries the repaired packaged factory', async () => {
    const wrong = path.join(built.folder, 'wrong.js')
    writeFileSync(wrong, 'module.exports = { createDeviceService() {} }')
    const prepared: unknown[] = []
    const errors: string[] = []
    const methods = deviceMethods({
      bundlePath: wrong,
      log: errorLogger(errors),
      dependencies: (bundle) => {
        prepared.push(bundle)
        return dependencies(bundle)
      },
    })
    await expect(methods.service()).rejects.toThrow(EN.devices.bundleUnavailable)
    expect(prepared).toEqual([])
    copyFileSync(built.file, wrong)
    await expect(methods.service()).rejects.toThrow('local-authority-unavailable')
    expect(prepared).toHaveLength(1)
    methods.dispose()
  })
  it('shares pending initialization and refuses disposal during preparation without opening a receiver', async () => {
    const held = Promise.withResolvers<DeviceServiceDeps>()
    const prepared: unknown[] = []
    const errors: string[] = []
    const methods = deviceMethods({
      bundlePath: built.file,
      log: errorLogger(errors),
      dependencies: (bundle) => {
        prepared.push(bundle)
        return held.promise
      },
    })
    const first = expect(methods.service()).rejects.toThrow('revoked')
    const second = expect(methods.service()).rejects.toThrow('revoked')
    expect(prepared).toHaveLength(1)
    methods.dispose()
    // Dependencies need not be inspected after disposal; never substitute an empty success.
    held.reject(new Error('revoked'))
    await Promise.all([first, second])
    await expect(methods.service()).rejects.toThrow('revoked')
    expect(errors).toEqual([])
  })
})
