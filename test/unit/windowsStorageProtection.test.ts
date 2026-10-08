import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  isPrivateReading,
  isSafeAncestorReading,
  parseStorageReading,
  startStorageHelper,
  supervisedStorageHelper,
  windowsStorageProtection,
  type StorageHelper,
  type StorageHelperRequest,
} from '../../src/host/devices/windowsStorageProtection'
import { deviceMethods, deviceStorageProtection } from '../../src/host/devices/deviceBundle'
import type { DeviceServiceDeps } from '../../src/host/devices/deviceEntry'
import { FakeLogOutputChannel } from './helpers/fakes'
import { deferred } from './helpers/deviceExecutionFixtures'
import { ownedDeviceStorage, STORAGE_HELPER_STAND_IN } from './helpers/deviceFixtures'

// Readings in the helper's wire format, recorded on a Windows 11 host.
const ME = 'S-1-5-21-2150206276-3426440022-602146264-1001'
const SANDBOX_USERS = 'S-1-5-21-2150206276-3426440022-602146264-1005'
const FULL = 2_032_127
const MODIFY = 1_245_631
const READ_EXECUTE = 1_179_817
const securedFile = `${ME}|${ME}|1|32|1|0,0,${String(FULL)},${ME}`
const securedFolder = `${ME}|${ME}|1|16|1|0,3,${String(FULL)},${ME}`
// %TEMP% where a sandbox group may modify (and so delete) entries it inherits into.
const temp = `${ME}|${ME}|0|16|1|0,3,${String(MODIFY)},${SANDBOX_USERS};0,19,${String(FULL)},S-1-5-18;0,19,${String(FULL)},${ME}`
// %LOCALAPPDATA%: the same group may only read.
const local = `${ME}|${ME}|0|16|1|0,19,${String(READ_EXECUTE)},${SANDBOX_USERS};0,19,${String(FULL)},${ME}`
// A fresh mkdtemp folder inherits the group's modify right from %TEMP%.
const inheritedRoot = `${ME}|${ME}|0|16|1|0,19,${String(MODIFY)},${SANDBOX_USERS};0,19,${String(FULL)},${ME}`
const driveRoot =
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464|' +
  `${ME}|0|22|1|0,3,${String(FULL)},S-1-5-32-544;0,3,${String(FULL)},S-1-5-18;` +
  `0,3,${String(READ_EXECUTE)},S-1-5-32-545;0,11,3758161920,S-1-5-11;0,0,4,S-1-5-11`

function reading(text: string) {
  return parseStorageReading(text)
}

describe('Windows owner-only readings', () => {
  it('accepts exactly the shape secureFresh installs on a file and a folder', () => {
    expect(isPrivateReading(reading(securedFile), false)).toBe(true)
    expect(isPrivateReading(reading(securedFolder), true)).toBe(true)
    expect(isPrivateReading(reading(securedFolder), false)).toBe(false)
    expect(isPrivateReading(reading(securedFile), true)).toBe(false)
  })
  it.each([
    ['an extra rule for Everyone', `${securedFile};0,0,1179785,S-1-1-0`],
    ['an inherited rule', `${ME}|${ME}|1|32|1|0,16,${String(FULL)},${ME}`],
    ['an unprotected DACL', `${ME}|${ME}|0|32|1|0,0,${String(FULL)},${ME}`],
    ['another owner', `S-1-5-32-544|${ME}|1|32|1|0,0,${String(FULL)},${ME}`],
    ['less than full control', `${ME}|${ME}|1|32|1|0,0,${String(MODIFY)},${ME}`],
    ['a deny rule', `${ME}|${ME}|1|32|1|1,0,${String(FULL)},${ME}`],
    ['a second hard link', `${ME}|${ME}|1|32|2|0,0,${String(FULL)},${ME}`],
    ['a reparse point', `${ME}|${ME}|1|1056|1|0,0,${String(FULL)},${ME}`],
    ['a null DACL', `${ME}|${ME}|1|32|1|null`],
    ['an object ACE', `${ME}|${ME}|1|32|1|other`],
    ['no rule at all', `${ME}|${ME}|1|32|1|`],
  ])('refuses %s', (_name, text) => {
    expect(isPrivateReading(reading(text), false)).toBe(false)
  })
  it('refuses a folder rule that does not reach new entries', () => {
    expect(isPrivateReading(reading(`${ME}|${ME}|1|16|1|0,0,${String(FULL)},${ME}`), true)).toBe(
      false,
    )
  })
  it.each(['', 'a|b', `x|${ME}|1|32|1|`, `${ME}|${ME}|2|32|1|`, `${ME}|${ME}|1|-1|1|`])(
    'rejects the malformed reading %j',
    (text) => {
      expect(() => parseStorageReading(text)).toThrow('storage-protection')
    },
  )
})

describe('Windows ancestor readings', () => {
  it('accepts readable system folders and a folder others may add to but not delete from', () => {
    expect(isSafeAncestorReading(reading(driveRoot), undefined)).toBe(true)
    expect(isSafeAncestorReading(reading(temp), reading(local))).toBe(true)
    expect(isSafeAncestorReading(reading(securedFolder), reading(temp))).toBe(true)
  })
  it('refuses a folder another account could rename away and replace', () => {
    // The group may delete the fresh folder and add to %TEMP%: a swap.
    expect(isSafeAncestorReading(reading(inheritedRoot), reading(temp))).toBe(false)
  })
  it.each([
    ['delete-child and add', `0,0,${String(0x40 | 0x4)},S-1-1-0`],
    ['write-DACL', `0,0,${String(0x4_00_00)},S-1-1-0`],
    ['write-owner', `0,0,${String(0x8_00_00)},S-1-1-0`],
    ['generic-all', `0,0,${String(0x10_00_00_00)},S-1-1-0`],
  ])('refuses another principal holding %s', (_name, ace) => {
    expect(isSafeAncestorReading(reading(`${securedFolder};${ace}`), undefined)).toBe(false)
  })
  it('refuses entries others may delete through the parent and recreate', () => {
    const parent = `${ME}|${ME}|1|16|1|0,0,${String(0x40 | 0x2)},S-1-1-0;0,3,${String(FULL)},${ME}`
    expect(isSafeAncestorReading(reading(securedFolder), reading(parent))).toBe(false)
  })
  it('ignores inherit-only and deny rules, refuses audit rules, unknown owners and links', () => {
    const inheritOnly = `${securedFolder};0,11,${String(FULL)},S-1-1-0;1,0,${String(FULL)},S-1-1-0`
    expect(isSafeAncestorReading(reading(inheritOnly), undefined)).toBe(true)
    expect(isSafeAncestorReading(reading(`${securedFolder};2,0,1,S-1-1-0`), undefined)).toBe(false)
    expect(
      isSafeAncestorReading(reading(`S-1-1-0|${ME}|1|16|1|0,3,${String(FULL)},${ME}`), undefined),
    ).toBe(false)
    expect(
      isSafeAncestorReading(reading(`${ME}|${ME}|1|1040|1|0,3,${String(FULL)},${ME}`), undefined),
    ).toBe(false)
    expect(isSafeAncestorReading(reading(securedFile), undefined)).toBe(false)
    expect(isSafeAncestorReading(reading(`${ME}|${ME}|1|16|1|null`), undefined)).toBe(false)
  })
})

function port(answers: Record<string, string>) {
  const calls: [string, readonly string[], boolean | undefined][] = []
  const request: StorageHelperRequest = (operation, paths, isDirectory) => {
    calls.push([operation, paths, isDirectory])
    const answer = answers[operation]
    return answer === undefined
      ? Promise.reject(new Error('helper-sentinel'))
      : Promise.resolve(answer)
  }
  return { request, calls }
}

describe('the binding over a helper port', () => {
  const folder = path.resolve('store')
  it('checks, claims, replaces and flushes through one request each', async () => {
    const helper = port({ inspect: securedFile, secure: '', replace: '', sync: '' })
    const protection = windowsStorageProtection(helper.request)
    await protection.assertPrivate('pairs.json', false)
    await protection.secureFresh('pairs.json', false)
    await protection.replace('stage', 'pairs.json')
    await protection.syncDirectory(folder)
    expect(helper.calls).toEqual([
      ['inspect', ['pairs.json'], undefined],
      ['secure', ['pairs.json'], false],
      ['inspect', ['pairs.json'], undefined],
      ['replace', ['stage', 'pairs.json'], undefined],
      ['sync', [folder], undefined],
    ])
  })
  it('refuses a tampered DACL, a failed claim and a helper failure', async () => {
    const tampered = windowsStorageProtection(
      port({ inspect: `${securedFile};0,0,1179785,S-1-1-0`, secure: '' }).request,
    )
    await expect(tampered.assertPrivate('pairs.json', false)).rejects.toThrow('storage-protection')
    await expect(tampered.secureFresh('pairs.json', false)).rejects.toThrow('storage-protection')
    const broken = windowsStorageProtection(port({}).request)
    await expect(broken.assertPrivate('pairs.json', false)).rejects.toThrow('helper-sentinel')
    await expect(broken.replace('stage', 'pairs.json')).rejects.toThrow('helper-sentinel')
    await expect(broken.syncDirectory(folder)).rejects.toThrow('helper-sentinel')
  })
  it('reads the whole chain to the root in one request, each folder against its parent', async () => {
    const chain = [folder]
    for (let next = path.dirname(folder); next !== chain.at(-1); next = path.dirname(next))
      chain.push(next)
    const answers = chain.map(() => local)
    answers[0] = securedFolder
    answers[answers.length - 1] = driveRoot
    const helper = port({ inspect: answers.join('\t') })
    await windowsStorageProtection(helper.request).assertSafeAncestor(folder)
    expect(helper.calls).toEqual([['inspect', chain, undefined]])
    const root = chain.at(-1)!
    const top = port({ inspect: driveRoot })
    await windowsStorageProtection(top.request).assertSafeAncestor(root)
    expect(top.calls[0]?.[1]).toEqual([root])
    // One swappable folder anywhere in the chain refuses it.
    const swappable = port({ inspect: [inheritedRoot, temp, ...answers.slice(2)].join('\t') })
    await expect(
      windowsStorageProtection(swappable.request).assertSafeAncestor(folder),
    ).rejects.toThrow('storage-protection')
    const short = port({ inspect: securedFolder })
    await expect(
      windowsStorageProtection(short.request).assertSafeAncestor(folder),
    ).rejects.toThrow('storage-protection')
  })
})

// A stand-in helper speaking the same line protocol, so every OS runs this.
const echo = STORAGE_HELPER_STAND_IN
function fakeHelper(script: string, deadlineMs?: number) {
  return startStorageHelper(process.execPath, ['-e', script], process.env, deadlineMs)
}
// A request this test sends although the helper protocol has no such operation.
function untyped(helper: { request: StorageHelperRequest }) {
  return helper.request as (operation: string, paths: readonly string[]) => Promise<string>
}

describe('the long-lived helper protocol', () => {
  const absolute = String.raw`C:\store\pairs.json`
  it('answers requests in order, encodes paths and reports helper errors', async () => {
    const helper = fakeHelper(echo)
    try {
      const [first, second] = await Promise.all([
        helper.request('inspect', [absolute, String.raw`C:\store`]),
        helper.request('secure', [absolute], true),
      ])
      expect(first).toBe(String.raw`inspect:C:\store\pairs.json+C:\store`)
      expect(second).toBe(String.raw`secure:C:\store\pairs.json+1`)
      await expect(helper.request('sync', [absolute])).rejects.toThrow('storage-protection')
      await expect(helper.request('inspect', ['relative'])).rejects.toThrow('storage-protection')
      await expect(helper.request('ping', [])).resolves.toBe('ping:')
    } finally {
      helper.dispose()
    }
  })
  it('fails every request after a mismatched answer or the helper exiting', async () => {
    const swapped = fakeHelper(echo)
    await expect(untyped(swapped)('swap', [])).rejects.toThrow('storage-protection')
    await expect(swapped.request('ping', [])).rejects.toThrow('storage-protection')
    swapped.dispose()
    const exiting = fakeHelper(echo)
    await expect(exiting.request('replace', [absolute, absolute])).rejects.toThrow(
      'storage-protection',
    )
    await expect(exiting.request('ping', [])).rejects.toThrow('storage-protection')
    exiting.dispose()
    const missing = startStorageHelper(path.resolve('missing-helper-binary'), [], process.env)
    await expect(missing.request('ping', [])).rejects.toThrow()
    missing.dispose()
  })
})

describe('a helper that stops answering', () => {
  it('fails every waiting request at the deadline, ends that helper, and the next request starts afresh', async () => {
    const started: StorageHelper[] = []
    const supervised = supervisedStorageHelper(() => {
      // Only the first, hanging helper gets a short deadline; its successor the default.
      const helper = started.length === 0 ? fakeHelper(echo, 200) : fakeHelper(echo)
      started.push(helper)
      return helper
    })
    try {
      const hung = untyped(supervised)('hang', [])
      const waiting = untyped(supervised)('hang', [])
      await expect(hung).rejects.toThrow('storage-protection')
      await expect(waiting).rejects.toThrow('storage-protection')
      await started[0]?.exited
      await expect(supervised.request('ping', [])).resolves.toBe('ping:')
      expect(started).toHaveLength(2)
    } finally {
      supervised.dispose()
      await Promise.all(started.map((helper) => helper.exited))
    }
    await expect(supervised.request('ping', [])).rejects.toThrow('storage-protection')
  })
  it('refuses the store operation instead of leaving it pending', async () => {
    const helper = fakeHelper(echo, 200)
    const protection = windowsStorageProtection((_operation, paths) =>
      untyped(helper)('hang', paths),
    )
    await expect(protection.assertPrivate(String.raw`C:\store\pairs.json`, false)).rejects.toThrow(
      'storage-protection',
    )
    await helper.exited
  })
})

// A bundle whose binding is this OS's own helper (native on Windows), with
// its disposer counted, and a factory the test may hold.
function heldBundle(factory: () => Promise<{ dispose: () => void }>) {
  const bindings: (Awaited<ReturnType<typeof ownedDeviceStorage>> & {
    disposals: ReturnType<typeof vi.fn>
  })[] = []
  const startWindowsStorageProtection = vi.fn(async () => {
    const binding = await ownedDeviceStorage()
    const disposals = vi.fn(binding.dispose)
    bindings.push({ ...binding, disposals })
    return { ...binding, dispose: disposals }
  })
  const bundle = {
    createDeviceService: vi.fn(factory),
    DeviceStore: vi.fn(),
    DeviceSecrets: vi.fn(),
    AttemptJournal: vi.fn(),
    DeviceDiscovery: vi.fn(),
    startWindowsStorageProtection,
  }
  return { bundle, bindings }
}
async function expectEnded(binding: { current: () => StorageHelper | undefined }) {
  const helper = binding.current()
  expect(helper).toBeDefined()
  await helper?.exited
  await expect(helper?.request('ping', [])).rejects.toThrow('storage-protection')
}

describe('the Devices bundle storage seam', () => {
  it('ends the helper process of an owned binding when it is disposed', async () => {
    const binding = await ownedDeviceStorage()
    // Any request starts the helper; this folder does not exist, so it is refused.
    await expect(binding.protection.syncDirectory(path.resolve('store'))).rejects.toThrow(
      'storage-protection',
    )
    const helper = binding.current()
    expect(helper).toBeDefined()
    binding.dispose()
    await helper?.exited
    await expect(binding.protection.assertPrivate(path.resolve('store'), true)).rejects.toThrow(
      'storage-protection',
    )
  })
  it('ends the helpers of failed preparations and of the disposed methods', async () => {
    const helpers: StorageHelper[] = []
    const startWindowsStorageProtection = vi.fn(() => {
      const helper = fakeHelper(echo)
      helpers.push(helper)
      return Promise.resolve({
        protection: windowsStorageProtection(helper.request),
        current: () => helper,
        dispose: helper.dispose,
      })
    })
    const service = { dispose: vi.fn() }
    const bundle = {
      createDeviceService: vi.fn(() => Promise.resolve(service)),
      DeviceStore: vi.fn(),
      DeviceSecrets: vi.fn(),
      AttemptJournal: vi.fn(),
      DeviceDiscovery: vi.fn(),
      startWindowsStorageProtection,
    }
    const options = {
      helperDirectory: path.resolve('helpers'),
      systemRoot: String.raw`C:\Windows`,
      extensionPath: process.cwd(),
    }
    let attempts = 0
    const methods = deviceMethods({
      bundlePath: 'devices.js',
      log: new FakeLogOutputChannel(),
      loadBundle: () => bundle,
      async dependencies(loaded, scope) {
        await deviceStorageProtection(loaded, options, scope, 'win32')
        attempts += 1
        if (attempts < 3) throw new Error('damaged-state-sentinel')
        return {} as DeviceServiceDeps
      },
    })
    await expect(methods.service()).rejects.toThrow('damaged-state-sentinel')
    await expect(methods.service()).rejects.toThrow('damaged-state-sentinel')
    await Promise.all(helpers.map((helper) => helper.exited))
    await expect(methods.service()).resolves.toBe(service)
    expect(helpers).toHaveLength(3)
    expect(helpers[2]?.hasFailed()).toBe(false)
    methods.dispose()
    expect(service.dispose).toHaveBeenCalledOnce()
    await helpers[2]?.exited
    expect(helpers.every((helper) => helper.hasFailed())).toBe(true)
  })
  describe('disposal while a preparation is still pending', () => {
    const options = {
      helperDirectory: path.resolve('helpers'),
      systemRoot: String.raw`C:\Windows`,
      extensionPath: process.cwd(),
    }
    it('ends the helper of a held-dependencies preparation at once; the release settles as revoked', async () => {
      const service = { dispose: vi.fn() }
      const { bundle, bindings } = heldBundle(() => Promise.resolve(service))
      const registered = deferred<undefined>()
      const held = deferred<DeviceServiceDeps>()
      const methods = deviceMethods({
        bundlePath: 'devices.js',
        log: new FakeLogOutputChannel(),
        loadBundle: () => bundle,
        async dependencies(loaded, scope) {
          await deviceStorageProtection(loaded, options, scope, 'win32')
          registered.resolve(undefined)
          return await held.promise
        },
      })
      const serving = methods.service()
      await registered.promise
      methods.dispose()
      await expectEnded(bindings[0]!)
      held.resolve({} as DeviceServiceDeps)
      await expect(serving).rejects.toThrow('revoked')
      expect(bindings[0]?.disposals).toHaveBeenCalledOnce()
      expect(bundle.createDeviceService).not.toHaveBeenCalled()
    })
    it('ends the helper of a held-factory preparation at once; the release settles as revoked', async () => {
      const service = { dispose: vi.fn() }
      const held = deferred<typeof service>()
      const factoryEntered = deferred<undefined>()
      const { bundle, bindings } = heldBundle(() => {
        factoryEntered.resolve(undefined)
        return held.promise
      })
      const methods = deviceMethods({
        bundlePath: 'devices.js',
        log: new FakeLogOutputChannel(),
        loadBundle: () => bundle,
        async dependencies(loaded, scope) {
          await deviceStorageProtection(loaded, options, scope, 'win32')
          return {} as DeviceServiceDeps
        },
      })
      const serving = methods.service()
      await factoryEntered.promise
      methods.dispose()
      await expectEnded(bindings[0]!)
      held.resolve(service)
      await expect(serving).rejects.toThrow('revoked')
      expect(service.dispose).toHaveBeenCalledOnce()
      expect(bindings[0]?.disposals).toHaveBeenCalledOnce()
    })
    it('disposes a resource registered after revocation immediately, once', async () => {
      const late = vi.fn()
      const gate = deferred<undefined>()
      // Read inside the callback, asserted out here: a failed expect in the
      // callback would only reject the preparation, which settles as revoked.
      const observed = { callsWhenOwnReturned: -1 }
      const methods = deviceMethods({
        bundlePath: 'devices.js',
        log: new FakeLogOutputChannel(),
        loadBundle: () => heldBundle(() => Promise.resolve({ dispose: vi.fn() })).bundle,
        async dependencies(_loaded, scope) {
          await gate.promise
          scope.own(late)
          observed.callsWhenOwnReturned = late.mock.calls.length
          return {} as DeviceServiceDeps
        },
      })
      const serving = methods.service()
      methods.dispose()
      gate.resolve(undefined)
      await expect(serving).rejects.toThrow('revoked')
      expect(observed.callsWhenOwnReturned).toBe(1)
      methods.dispose()
      expect(late).toHaveBeenCalledOnce()
    })
  })
  it('binds Windows only, never without a system root, and hands its disposer to the scope', async () => {
    const protection = windowsStorageProtection(() => Promise.resolve(''))
    const dispose = vi.fn()
    const startWindowsStorageProtection = vi.fn(() =>
      Promise.resolve({ protection, current: () => undefined, dispose }),
    )
    const bundle = { startWindowsStorageProtection }
    const scope = { own: vi.fn() }
    const options = {
      helperDirectory: path.resolve('helpers'),
      systemRoot: String.raw`C:\Windows`,
      extensionPath: process.cwd(),
    }
    await expect(deviceStorageProtection(bundle, options, scope, 'linux')).resolves.toBeUndefined()
    await expect(deviceStorageProtection(bundle, options, scope, 'darwin')).resolves.toBeUndefined()
    expect(startWindowsStorageProtection).not.toHaveBeenCalled()
    await expect(deviceStorageProtection(bundle, options, scope, 'win32')).resolves.toBe(protection)
    expect(scope.own).toHaveBeenCalledExactlyOnceWith(dispose)
    expect(startWindowsStorageProtection).toHaveBeenCalledWith({
      directory: options.helperDirectory,
      systemRoot: options.systemRoot,
      extensionPath: options.extensionPath,
    })
    await expect(
      deviceStorageProtection(bundle, { ...options, systemRoot: undefined }, scope, 'win32'),
    ).rejects.toThrow('storage')
  })
})
