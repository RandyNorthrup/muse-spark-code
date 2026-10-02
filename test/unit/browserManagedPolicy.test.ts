// The browser check's refusal under an administrator's policy (M81, PLAN.md
// D49; review RV81): every place Chrome and Edge read mandatory policy on
// each OS, a proxy or cloud management policy found there, recommended
// policy left alone, an absent place told apart from one that cannot be
// read, and the host's own reads (folders, files, plutil and reg.exe by
// absolute path) over a real temporary folder and a stand-in program.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findManagedProxyPolicy,
  isBlockingPolicyName,
  type ManagedPolicyReaders,
  parseRegistryListing,
} from '../../src/core/browser/browserManagedPolicy'
import { hostPolicyReaders } from '../../src/host/browser/browserPolicyReaders'
import { BROWSER_POLICY_FILE_MAX_BYTES } from '../../src/shared/constants'

const HKLM = 'HKEY_LOCAL_MACHINE'
const HKCU = 'HKEY_CURRENT_USER'
const NOT_FOUND = 'ERROR: The system was unable to find the specified registry key or value.'

/** A `reg query` listing as reg.exe prints it: the key and its values, then its subkeys. */
function listing(key: string, subkeys: readonly string[], values: readonly string[] = []): string {
  const head = values.length === 0 ? [] : [key, ...values.map((value) => `    ${value}`), '']
  return ['', ...head, ...subkeys.map((subkey) => `${key}\\${subkey}`), ''].join('\r\n')
}

interface Machine {
  readonly platform: NodeJS.Platform
  readonly user?: string
  readonly folders?: Readonly<Record<string, readonly string[] | Error>>
  readonly files?: Readonly<Record<string, string | Error>>
  readonly plists?: Readonly<Record<string, string | Error>>
  /** `reg query` output by key, the same in both views unless `registry32` has the key. */
  readonly registry?: Readonly<Record<string, string | Error>>
  readonly registry32?: Readonly<Record<string, string | Error>>
}

/** A stand-in read: the value, or its error as a rejection. */
function answer<T>(value: T | Error | undefined): Promise<T | undefined> {
  return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
}

/** Registry keys compare without case, as Windows does. */
function lower(table: Readonly<Record<string, string | Error>> = {}) {
  return new Map(Object.entries(table).map(([key, value]) => [key.toLowerCase(), value]))
}

/** A forced-preferences plist, as plutil prints it, holding one key. */
function xml(key: string): string {
  return `<?xml version="1.0"?><plist version="1.0"><dict>\n\t<key>${key}</key>\n\t<string>x</string>\n</dict></plist>`
}

function fake(machine: Machine) {
  const missing: string[] = []
  const registry = lower(machine.registry)
  const registry32 = lower(machine.registry32)
  const readers: ManagedPolicyReaders = {
    platform: machine.platform,
    userName: () => {
      if (machine.user === undefined) {
        throw new Error('ENOENT: no such user')
      }
      return machine.user
    },
    listFiles: async (folder) => await answer(machine.folders?.[folder]),
    readText: async (file) => await answer(machine.files?.[file]),
    isPresent: async (file) => {
      const value = machine.files?.[file] ?? machine.plists?.[file]
      await answer(value)
      return value !== undefined
    },
    plistXml: async (file) => (await answer(machine.plists?.[file])) ?? '',
    queryRegistry: async (key, view) => {
      const table = view === '/reg:32' && registry32.has(key.toLowerCase()) ? registry32 : registry
      const output = table.get(key.toLowerCase())
      if (output === undefined) {
        missing.push(key)
        throw new Error(NOT_FOUND)
      }
      return (await answer(output)) ?? ''
    },
  }
  return { readers, missing }
}

// A Windows machine with policies for other things, as this project's own
// workstation has: Chrome user policies with only list subkeys, no Edge key.
const WINDOWS: Readonly<Record<string, string>> = {
  [String.raw`${HKLM}\SOFTWARE`]: listing(String.raw`${HKLM}\SOFTWARE`, [
    'Classes',
    'Microsoft',
    'Policies',
  ]),
  [String.raw`${HKLM}\SOFTWARE\Policies`]: listing(String.raw`${HKLM}\SOFTWARE\Policies`, [
    'Adobe',
    'Microsoft',
  ]),
  [String.raw`${HKLM}\SOFTWARE\Policies\Microsoft`]: listing(
    String.raw`${HKLM}\SOFTWARE\Policies\Microsoft`,
    ['Windows', 'Windows Defender'],
  ),
  [String.raw`${HKCU}\SOFTWARE`]: listing(String.raw`${HKCU}\Software`, ['Microsoft', 'Policies']),
  [String.raw`${HKCU}\SOFTWARE\Policies`]: listing(String.raw`${HKCU}\Software\Policies`, [
    'Google',
    'Microsoft',
  ]),
  [String.raw`${HKCU}\SOFTWARE\Policies\Google`]: listing(
    String.raw`${HKCU}\Software\Policies\Google`,
    ['Chrome'],
  ),
  [String.raw`${HKCU}\SOFTWARE\Policies\Google\Chrome`]: listing(
    String.raw`${HKCU}\Software\Policies\Google\Chrome`,
    ['ExtensionInstallForcelist', 'LocalNetworkAccessAllowedForUrls', 'Recommended'],
  ),
  [String.raw`${HKCU}\SOFTWARE\Policies\Microsoft`]: listing(
    String.raw`${HKCU}\Software\Policies\Microsoft`,
    ['Windows'],
  ),
}

const CHROME_KEY = String.raw`${HKCU}\SOFTWARE\Policies\Google\Chrome`
const EDGE_KEY = String.raw`${HKLM}\SOFTWARE\Policies\Microsoft\Edge`

describe('the managed proxy policy check on Windows (RV81)', () => {
  it('finds none where Chrome and Edge have no proxy policy, without leaning on a failed read', async () => {
    const t = fake({ platform: 'win32', registry: WINDOWS })
    expect(await findManagedProxyPolicy(t.readers)).toEqual({ kind: 'none' })
    // Every absent key was told absent by its parent's listing, never by reg.exe failing.
    expect(t.missing).toEqual([])
  })

  it('refuses for a proxy or cloud management value under either browser, hive or view', async () => {
    const proxyMode = {
      ...WINDOWS,
      [CHROME_KEY]: listing(CHROME_KEY, ['Recommended'], ['ProxyMode    REG_SZ    direct']),
    }
    expect(
      await findManagedProxyPolicy(fake({ platform: 'win32', registry: proxyMode }).readers),
    ).toEqual({
      kind: 'found',
      where: `${CHROME_KEY} (ProxyMode)`,
    })
    const edgeIn32 = {
      [String.raw`${HKLM}\SOFTWARE\Policies\Microsoft`]: listing(
        String.raw`${HKLM}\SOFTWARE\Policies\Microsoft`,
        ['Edge'],
      ),
      [EDGE_KEY]: listing(EDGE_KEY, [], ['ProxySettings    REG_SZ    {"ProxyMode":"direct"}']),
    }
    expect(
      await findManagedProxyPolicy(
        fake({ platform: 'win32', registry: WINDOWS, registry32: edgeIn32 }).readers,
      ),
    ).toEqual({ kind: 'found', where: `${EDGE_KEY} (ProxySettings)` })
    const enrolled = {
      ...WINDOWS,
      [CHROME_KEY]: listing(CHROME_KEY, [], ['CloudManagementEnrollmentToken    REG_SZ    abc']),
    }
    expect(
      await findManagedProxyPolicy(fake({ platform: 'win32', registry: enrolled }).readers),
    ).toEqual({
      kind: 'found',
      where: `${CHROME_KEY} (CloudManagementEnrollmentToken)`,
    })
  })

  it('leaves recommended policy alone, and refuses when a key cannot be read', async () => {
    const recommended = {
      ...WINDOWS,
      [String.raw`${CHROME_KEY}\Recommended`]: listing(
        String.raw`${CHROME_KEY}\Recommended`,
        [],
        ['ProxyMode    REG_SZ    direct'],
      ),
    }
    expect(
      await findManagedProxyPolicy(fake({ platform: 'win32', registry: recommended }).readers),
    ).toEqual({ kind: 'none' })
    const denied = { ...WINDOWS, [CHROME_KEY]: new Error('ERROR: Access is denied.') }
    expect(
      await findManagedProxyPolicy(fake({ platform: 'win32', registry: denied }).readers),
    ).toEqual({
      kind: 'unreadable',
      where: CHROME_KEY,
      detail: 'ERROR: Access is denied.',
    })
  })

  it("reads reg.exe's listing: subkeys by name, value names with spaces, nothing deeper", () => {
    const key = String.raw`${HKLM}\SOFTWARE\Policies`
    expect(
      parseRegistryListing(
        key,
        listing(
          key,
          ['Microsoft', 'Windows Defender'],
          ['(Default)    REG_SZ', 'A name    REG_DWORD    0x1'],
        ),
      ),
    ).toEqual({ subkeys: ['Microsoft', 'Windows Defender'], values: ['(Default)', 'A name'] })
  })
})

describe('the managed proxy policy check on Linux and macOS (RV81)', () => {
  const CHROME = '/etc/opt/chrome/policies/managed'
  const EDGE = '/etc/opt/edge/policies/managed'

  it('finds none where no managed folder exists, and refuses for a proxy policy in any file', async () => {
    expect(await findManagedProxyPolicy(fake({ platform: 'linux' }).readers)).toEqual({
      kind: 'none',
    })
    const proxied = fake({
      platform: 'linux',
      folders: { [CHROME]: ['b.json', 'a.json'], [EDGE]: ['edge.json'] },
      files: {
        [`${CHROME}/a.json`]: '{"HomepageLocation":"https://example.com"}',
        [`${CHROME}/b.json`]: '{"RestoreOnStartup":1}',
        [`${EDGE}/edge.json`]:
          '{"ProxySettings":{"ProxyMode":"fixed_servers","ProxyServer":"10.0.0.1:3128"}}',
      },
    })
    expect(await findManagedProxyPolicy(proxied.readers)).toEqual({
      kind: 'found',
      where: `${EDGE}/edge.json (ProxySettings)`,
    })
    const chromium = fake({
      platform: 'linux',
      folders: { '/etc/chromium/policies/managed': ['p'] },
      files: { '/etc/chromium/policies/managed/p': '{"ProxyServerMode":2}' },
    })
    expect(await findManagedProxyPolicy(chromium.readers)).toMatchObject({ kind: 'found' })
  })

  it('refuses for the cloud enrollment token file, and where a folder or file cannot be read', async () => {
    const enrolled = fake({
      platform: 'linux',
      files: { '/etc/opt/chrome/policies/enrollment/CloudManagementEnrollmentToken': 'token' },
    })
    expect(await findManagedProxyPolicy(enrolled.readers)).toEqual({
      kind: 'found',
      where: '/etc/opt/chrome/policies/enrollment/CloudManagementEnrollmentToken',
    })
    for (const machine of [
      { folders: { [CHROME]: new Error('EACCES: permission denied') } },
      { folders: { [CHROME]: ['x.json'] }, files: { [`${CHROME}/x.json`]: '{"ProxyMode":' } },
      { folders: { [CHROME]: ['x.json'] }, files: { [`${CHROME}/x.json`]: '["ProxyMode"]' } },
      { folders: { [CHROME]: Array.from({ length: 65 }, (_, index) => `${String(index)}.json`) } },
    ]) {
      expect(
        await findManagedProxyPolicy(fake({ platform: 'linux', ...machine }).readers),
      ).toMatchObject({
        kind: 'unreadable',
      })
    }
  })

  it("reads the machine's and the user's forced preferences on macOS", async () => {
    const machine = '/Library/Managed Preferences/com.google.Chrome.plist'
    const user = '/Library/Managed Preferences/ada/com.microsoft.Edge.plist'
    expect(await findManagedProxyPolicy(fake({ platform: 'darwin', user: 'ada' }).readers)).toEqual(
      {
        kind: 'none',
      },
    )
    expect(
      await findManagedProxyPolicy(
        fake({ platform: 'darwin', user: 'ada', plists: { [machine]: xml('ProxyMode') } }).readers,
      ),
    ).toEqual({ kind: 'found', where: `${machine} (ProxyMode)` })
    expect(
      await findManagedProxyPolicy(
        fake({
          platform: 'darwin',
          user: 'ada',
          plists: { [machine]: xml('HomepageLocation'), [user]: xml('ProxyPacUrl') },
        }).readers,
      ),
    ).toEqual({ kind: 'found', where: `${user} (ProxyPacUrl)` })
    expect(
      await findManagedProxyPolicy(
        fake({ platform: 'darwin', user: 'ada', plists: { [machine]: new Error('plutil failed') } })
          .readers,
      ),
    ).toEqual({ kind: 'unreadable', where: machine, detail: 'plutil failed' })
    expect(await findManagedProxyPolicy(fake({ platform: 'darwin' }).readers)).toMatchObject({
      kind: 'unreadable',
      where: '/Library/Managed Preferences',
    })
  })

  it('names every proxy policy and the enrollment token, and nothing else', () => {
    for (const name of [
      'ProxyMode',
      'ProxyServerMode',
      'ProxyServer',
      'ProxyPacUrl',
      'ProxyPacMandatory',
      'ProxyBypassList',
      'ProxySettings',
      'proxysettings',
      'CloudManagementEnrollmentToken',
    ]) {
      expect(isBlockingPolicyName(name)).toBe(true)
    }
    for (const name of ['HomepageLocation', 'ExtensionInstallForcelist', 'Recommended']) {
      expect(isBlockingPolicyName(name)).toBe(false)
    }
  })
})

describe("the host's policy reads (RV81)", () => {
  const folders: string[] = []

  afterEach(async () => {
    await Promise.all(
      folders.map(async (folder) => {
        await rm(folder, { recursive: true, force: true })
      }),
    )
    folders.length = 0
  })

  it('tells an absent folder or file from one that is there, lists files only, and bounds what it reads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'muse-policy-'))
    folders.push(root)
    await mkdir(path.join(root, 'nested'))
    await writeFile(path.join(root, 'proxy.json'), '{"ProxyMode":"direct"}')
    await writeFile(
      path.join(root, 'huge.json'),
      Buffer.alloc(BROWSER_POLICY_FILE_MAX_BYTES + 1, 32),
    )
    const readers = hostPolicyReaders({ platform: 'linux', env: {}, systemRoot: undefined })
    expect(await readers.listFiles(path.join(root, 'absent'))).toBeUndefined()
    const listed = (await readers.listFiles(root)) ?? []
    expect(listed.toSorted((a, b) => a.localeCompare(b))).toEqual(['huge.json', 'proxy.json'])
    expect(await readers.readText(path.join(root, 'proxy.json'))).toBe('{"ProxyMode":"direct"}')
    expect(await readers.readText(path.join(root, 'absent.json'))).toBeUndefined()
    await expect(readers.readText(path.join(root, 'huge.json'))).rejects.toThrow('larger than')
    expect(await readers.isPresent(path.join(root, 'proxy.json'))).toBe(true)
    expect(await readers.isPresent(path.join(root, 'proxy.json', 'below'))).toBe(false)
  })

  it('runs plutil and reg.exe by absolute path with an argument array', async () => {
    const runs: { file: string; args: readonly string[] }[] = []
    const readers = hostPolicyReaders({
      platform: 'win32',
      env: {},
      systemRoot: String.raw`C:\Windows`,
      run: (file, args) => {
        runs.push({ file, args })
        return Promise.resolve('')
      },
    })
    await readers.queryRegistry(String.raw`${HKLM}\SOFTWARE`, '/reg:32')
    await readers.plistXml('/Library/Managed Preferences/com.google.Chrome.plist')
    expect(runs).toEqual([
      {
        file: String.raw`C:\Windows\System32\reg.exe`,
        args: ['query', String.raw`${HKLM}\SOFTWARE`, '/reg:32'],
      },
      {
        file: '/usr/bin/plutil',
        args: [
          '-convert',
          'xml1',
          '-o',
          '-',
          '/Library/Managed Preferences/com.google.Chrome.plist',
        ],
      },
    ])
    const rootless = hostPolicyReaders({ platform: 'win32', env: {}, systemRoot: undefined })
    await expect(rootless.queryRegistry(String.raw`${HKLM}\SOFTWARE`, '/reg:64')).rejects.toThrow(
      'SystemRoot',
    )
  })
})
