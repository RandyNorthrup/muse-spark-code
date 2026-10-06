import { WindowHold } from '../../src/host/git/worktreeRegistry'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as sdk from '@muse-code/sdk'
import {
  MSP_KNOWN_SCHEMA_FINGERPRINTS,
  MSP_UNRESPONSIVE_MISSES,
  type EnvironmentVariable,
  UI_TEXT,
} from '../../src/shared/constants'
import type {
  MuseCodeBackendManager,
  BackendManagerDeps,
  UnresponsiveHostDeps,
} from '../../src/host/backend/museCodeBackendManager'
import { readProxySettings } from '../../src/host/networkPosture'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import { fakeAccountHome } from './helpers/accountHome'

// Real SDK exports; each test controls the spawn boundary.
vi.mock('@muse-code/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof sdk>()),
}))

const VS_CODE_PROXY = 'https://proxy.example:8443'
const VS_CODE_NO_PROXY = ['localhost', '127.0.0.1']
const PROXY_NAMES = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'https_proxy',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
]

/** A manager with test-owned settings and startup dependencies. */
function managerWith(
  configured: readonly EnvironmentVariable[],
  proxy = VS_CODE_PROXY,
  log = new FakeLogOutputChannel(),
  overrides: Partial<BackendManagerDeps> = {},
): MuseCodeBackendManager {
  return fakeMuseCodeManager({
    log,
    getEnvironmentVariables: () => configured,
    getProxySettings: () => ({ proxy, noProxy: VS_CODE_NO_PROXY }),
    ...overrides,
  })
}

/** The values the child sees under any spelling of `name`. */
function valuesOf(env: NodeJS.ProcessEnv, name: string): readonly (string | undefined)[] {
  return Object.entries(env)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value)
}

/** The real handshake and manager against the existing test-owned fake CLI. */
async function startWithFingerprint(fingerprint: string): Promise<FakeLogOutputChannel> {
  const spawn = sdk.spawnMspConnection
  vi.spyOn(sdk, 'spawnMspConnection').mockImplementation((options) =>
    spawn({
      ...options,
      args: [path.resolve('test/e2e/fake-muse/serve.mjs')],
      env: {
        MUSE_FAKE_FINGERPRINT: fingerprint,
        XDG_CONFIG_HOME: path.resolve('test/fixtures/workspace/no-muse-config'),
      },
    }),
  )
  const log = new FakeLogOutputChannel()
  const manager = managerWith([], '', log, { getConfiguredBinaryPath: () => process.execPath })
  // This fixture has no sign-in; never read the developer's credential file.
  vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
  try {
    await manager.ensureHost()
  } finally {
    await manager.dispose()
  }
  return log
}

describe('MuseCodeBackendManager: known MSP builds (SDK142)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['sha256:61afea3112e0906e9dc3a536144278a74cb4b36fc6e20901a91d4432ba3568e2', '1.4.2-R4684.1'],
  ])('recognizes %s as %s without a mismatch warning', async (fingerprint, build) => {
    expect(MSP_KNOWN_SCHEMA_FINGERPRINTS[fingerprint]).toBe(build)
    const log = await startWithFingerprint(fingerprint)
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('MSP schema fingerprint mismatch'),
    )
    expect(log.info).toHaveBeenCalledWith(
      `MSP schema ${fingerprint} is Muse Code ${build}'s, an additive successor of the SDK's ${sdk.EXPECTED_SCHEMA_FINGERPRINT}`,
    )
  })

  it('keeps the 1.3.0-R3401.1 SDK pin outside the successor map and logs no mismatch', async () => {
    expect(sdk.EXPECTED_SCHEMA_FINGERPRINT).toBe(
      'sha256:7469c9e352e67def4a59df7e439984d7194fa351e1c8b7abb34060fd977ced81',
    )
    expect(MSP_KNOWN_SCHEMA_FINGERPRINTS[sdk.EXPECTED_SCHEMA_FINGERPRINT]).toBeUndefined()
    const log = await startWithFingerprint(sdk.EXPECTED_SCHEMA_FINGERPRINT)
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('MSP schema fingerprint mismatch'),
    )
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('MSP schema'))
  })

  // 1.4.1-R4503.1 never reached npm and no live frame of it was captured,
  // so its manifest fingerprint is not trusted as a known successor.
  it.each([
    'sha256:unknown-build',
    'sha256:e0e163db6ccf00dbe68402ce55d6319b3edc33c421f31e9583b587b2de8a118f',
  ])('still warns for %s', async (fingerprint) => {
    expect(MSP_KNOWN_SCHEMA_FINGERPRINTS[fingerprint]).toBeUndefined()
    const log = await startWithFingerprint(fingerprint)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('MSP schema fingerprint mismatch'),
    )
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('MSP schema'))
  })
})

describe('MuseCodeBackendManager: checkpoint native startup admission (M72)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('awaits the workspace fence before any native spawn, even with no capture setting involved', async () => {
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const spawn = vi.spyOn(sdk, 'spawnMspConnection').mockImplementation(() => {
      throw new Error('injected fake native spawn')
    })
    const manager = managerWith([], VS_CODE_PROXY, new FakeLogOutputChannel(), {
      getConfiguredBinaryPath: () => process.execPath,
      beforeWorkspaceHostStart: async () => {
        entered.resolve(undefined)
        await resume.promise
      },
    })
    const opening = manager.ensureHost()
    const settled = expect(opening).rejects.toThrow('injected fake native spawn')
    try {
      await entered.promise
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      resume.resolve(undefined)
    }
    await settled
    expect(spawn).toHaveBeenCalledOnce()
    expect(manager.isRunning).toBe(false)
    await manager.dispose()
  })

  it('spawns nothing when native presence or reservation admission is refused', async () => {
    const spawn = vi.spyOn(sdk, 'spawnMspConnection').mockImplementation(() => {
      throw new Error('must not spawn')
    })
    const manager = managerWith([], VS_CODE_PROXY, new FakeLogOutputChannel(), {
      getConfiguredBinaryPath: () => process.execPath,
      beforeWorkspaceHostStart: () => Promise.reject(new Error('injected native fence refusal')),
    })
    await expect(manager.ensureHost()).rejects.toThrow('injected native fence refusal')
    expect(spawn).not.toHaveBeenCalled()
    expect(manager.isRunning).toBe(false)
  })
})

describe('MuseCodeBackendManager: immutable account launch (M108)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses one account home for serve and credential inspection, ignoring account overrides', () => {
    vi.stubEnv('META_API_KEY', 'shell-account-canary')
    const accountHome = fakeAccountHome()
    const manager = managerWith(
      [{ name: 'XDG_CONFIG_HOME', value: '/different-home' }],
      '',
      new FakeLogOutputChannel(),
      { accountHome },
    )
    expect(manager.childEnvironment()['XDG_CONFIG_HOME']).toBe(accountHome.configHome)
    expect(manager.credentialFilePath().replaceAll('\\', '/')).toBe(
      `${accountHome.configHome}/muse/auth.json`,
    )
    expect(manager.hasEnvironmentKey()).toBe(false)
  })

  it('refuses revoked homes at ensureHost before native startup', async () => {
    const accountHome = fakeAccountHome()
    accountHome.assertCurrent.mockImplementation(() => {
      throw new Error('account revoked')
    })
    const spawn = vi.spyOn(sdk, 'spawnMspConnection').mockImplementation(() => {
      throw new Error('unexpected native spawn')
    })
    const manager = managerWith([], '', new FakeLogOutputChannel(), {
      accountHome,
      getConfiguredBinaryPath: () => process.execPath,
    })
    vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
    await expect(manager.ensureHost()).rejects.toThrow('account revoked')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rechecks the account after the workspace startup fence before spawning', async () => {
    const accountHome = fakeAccountHome()
    const spawn = vi.spyOn(sdk, 'spawnMspConnection').mockImplementation(() => {
      throw new Error('unexpected native spawn')
    })
    const manager = managerWith([], '', new FakeLogOutputChannel(), {
      accountHome,
      getConfiguredBinaryPath: () => process.execPath,
      beforeWorkspaceHostStart: () => {
        accountHome.assertCurrent.mockImplementation(() => {
          throw new Error('removed during admission')
        })
        return Promise.resolve()
      },
    })
    vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
    await expect(manager.ensureHost()).rejects.toThrow('removed during admission')
    expect(spawn).not.toHaveBeenCalled()
    expect(manager.isRunning).toBe(false)
  })

  it('serves two accounts in separate fake CLI processes with their own environment and usage', async () => {
    const spawn = sdk.spawnMspConnection
    const launches: Parameters<typeof sdk.spawnMspConnection>[0][] = []
    vi.spyOn(sdk, 'spawnMspConnection').mockImplementation((options) => {
      launches.push(options)
      return spawn({ ...options, args: [path.resolve('test/e2e/fake-muse/serve.mjs')] })
    })
    const work = fakeAccountHome('work')
    const personal = fakeAccountHome('personal')
    const manager = (accountHome: typeof work) => {
      const result = managerWith([], '', new FakeLogOutputChannel(), {
        accountHome,
        getConfiguredBinaryPath: () => process.execPath,
      })
      vi.spyOn(result, 'credentialFileVerdict').mockReturnValue('absent')
      return result
    }
    const a = manager(work)
    const b = manager(personal)
    try {
      const hostA = await a.ensureHost()
      const hostB = await b.ensureHost()
      expect(hostA).not.toBe(hostB)
      expect(launches.map((options) => options.env?.['XDG_CONFIG_HOME'])).toEqual([
        work.configHome,
        personal.configHome,
      ])
      const session = await hostA.startSession({
        workspaceRoot: '/fake/workspace',
        modelId: 'muse-spark-1.3',
        approvalMode: 'acceptEdits',
      })
      const done = Promise.withResolvers<undefined>()
      session.onEvent((event) => {
        if (event.type === 'turnCompleted') done.resolve(undefined)
      })
      await session.sendTurn([{ type: 'text', text: 'fake-only usage' }])
      await done.promise
      expect(work.observeUsage).toHaveBeenCalled()
      expect(personal.observeUsage).not.toHaveBeenCalled()
      expect(await hostB.readUsage()).toBeUndefined()
      work.assertCurrent.mockImplementation(() => {
        throw new Error('revoked cached host')
      })
      await expect(a.ensureHost()).rejects.toThrow('revoked cached host')
      expect(await b.ensureHost()).toBe(hostB)
      expect(launches).toHaveLength(2)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('closes a fake CLI whose account is revoked during initialization', async () => {
    const spawn = sdk.spawnMspConnection
    const accountHome = fakeAccountHome()
    const close = vi.fn(() => Promise.resolve())
    vi.spyOn(sdk, 'spawnMspConnection').mockImplementation((options) => {
      const pending = spawn({ ...options, args: [path.resolve('test/e2e/fake-muse/serve.mjs')] })
      const initialize = pending.initialize.bind(pending)
      vi.spyOn(pending, 'initialize').mockImplementation(async (params) => {
        const host = await initialize(params)
        accountHome.assertCurrent.mockImplementation(() => {
          throw new Error('revoked during initialize')
        })
        const closeHost = host.close.bind(host)
        vi.spyOn(host, 'close').mockImplementation(async () => {
          await close()
          return await closeHost()
        })
        return host
      })
      return pending
    })
    const manager = managerWith([], '', new FakeLogOutputChannel(), {
      accountHome,
      getConfiguredBinaryPath: () => process.execPath,
    })
    vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
    try {
      await expect(manager.ensureHost()).rejects.toThrow('revoked during initialize')
      expect(close).toHaveBeenCalledOnce()
      expect(manager.isRunning).toBe(false)
    } finally {
      await manager.dispose()
    }
  })
})

describe('MuseCodeBackendManager: VS Code’s proxy for the CLI (D25)', () => {
  beforeEach(() => {
    // The machine running the tests may have a proxy of its own.
    for (const name of PROXY_NAMES) {
      vi.stubEnv(name, undefined)
    }
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hands the proxy and its exclusions over when the environment has none', () => {
    const env = managerWith([]).childEnvironment()
    expect(valuesOf(env, 'HTTPS_PROXY')).toEqual([VS_CODE_PROXY])
    expect(valuesOf(env, 'HTTP_PROXY')).toEqual([VS_CODE_PROXY])
    // Loopback always bypasses the proxy, for the `ide` server (M56).
    expect(valuesOf(env, 'NO_PROXY')).toEqual(['localhost,127.0.0.1,::1'])
  })

  it('does not hand malformed VS Code proxy values to Muse Code', () => {
    const malformed = managerWith([], VS_CODE_PROXY, new FakeLogOutputChannel(), {
      getProxySettings: () =>
        readProxySettings({ get: (key) => (key === 'proxy' ? 42 : ['.corp', 42]) }),
    }).childEnvironment()
    expect(valuesOf(malformed, 'HTTPS_PROXY')).toEqual([])
    expect(valuesOf(malformed, 'NO_PROXY')).toEqual([])

    const partial = managerWith([], VS_CODE_PROXY, new FakeLogOutputChannel(), {
      getProxySettings: () =>
        readProxySettings({
          get: (key) => (key === 'proxy' ? VS_CODE_PROXY : ['.corp', 42]),
        }),
    }).childEnvironment()
    expect(valuesOf(partial, 'HTTPS_PROXY')).toEqual([VS_CODE_PROXY])
    expect(valuesOf(partial, 'NO_PROXY')).toEqual(['127.0.0.1,localhost,::1'])
  })

  it('never contradicts a proxy set in museSpark.environmentVariables, in either case', () => {
    const env = managerWith([
      { name: 'https_proxy', value: 'http://mine:3128' },
      { name: 'no_proxy', value: '.corp' },
    ]).childEnvironment()
    expect(valuesOf(env, 'HTTPS_PROXY')).toEqual(['http://mine:3128'])
    expect(Object.values(env)).not.toContain(VS_CODE_PROXY)
    expect(valuesOf(env, 'NO_PROXY')).toEqual(['.corp,127.0.0.1,localhost,::1'])
  })

  it('keeps an inherited proxy and its own NO_PROXY, adding only loopback', () => {
    vi.stubEnv('http_proxy', 'http://inherited:3128')
    vi.stubEnv('no_proxy', 'internal')
    const env = managerWith([]).childEnvironment()
    expect(Object.values(env)).not.toContain(VS_CODE_PROXY)
    expect(valuesOf(env, 'NO_PROXY')).toEqual(['internal,127.0.0.1,localhost,::1'])
  })

  it('adds nothing when VS Code has no proxy', () => {
    const env = managerWith([], '').childEnvironment()
    expect(valuesOf(env, 'HTTPS_PROXY')).toEqual([])
    expect(valuesOf(env, 'NO_PROXY')).toEqual([])
  })

  // M56 (PLAN.md D43): what the Diagnostics report says about the CLI's network.
  it('says where the CLI’s proxy comes from, and whether its certificate store is replaced', () => {
    expect(managerWith([]).proxySource()).toBe('vscode')
    expect(managerWith([], '').proxySource()).toBe('none')
    expect(managerWith([{ name: 'HTTPS_PROXY', value: 'http://mine:3128' }]).proxySource()).toBe(
      'environment',
    )
    vi.stubEnv('SSL_CERT_FILE', undefined)
    vi.stubEnv('SSL_CERT_DIR', undefined)
    expect(managerWith([]).hasCertificateOverride()).toBe(false)
    expect(
      managerWith([{ name: 'SSL_CERT_FILE', value: '/etc/corp.pem' }]).hasCertificateOverride(),
    ).toBe(true)
    vi.stubEnv('SSL_CERT_DIR', '/etc/ssl/corp')
    expect(managerWith([]).hasCertificateOverride()).toBe(true)
  })
})

// M56 (PLAN.md D43): `museSpark.sandboxNetwork` reaches `muse serve`'s arguments.
describe('MuseCodeBackendManager: the sandbox network (M56)', () => {
  it('passes the mode while the sandbox is on, and not when it is off', () => {
    const installDir = mkdtempSync(path.join(tmpdir(), 'muse-network-'))
    try {
      const binary = path.join(
        installDir,
        process.platform === 'win32' ? 'muse-bin-1.3.0.exe' : 'muse',
      )
      writeFileSync(binary, '')
      const launchWith = (shell: 'muse' | 'off') =>
        managerWith([], VS_CODE_PROXY, new FakeLogOutputChannel(), {
          getConfiguredBinaryPath: () => binary,
          getShellSandbox: () => shell,
          getSandboxNetwork: () => 'restricted',
        }).resolveLaunch()
      const sandboxed = launchWith('muse')
      expect(sandboxed.ok && sandboxed.launch.serveArgs).toEqual([
        'serve',
        '--sandbox-network',
        'restricted',
        '--trust-workspace',
      ])
      const unsandboxed = launchWith('off')
      expect(unsandboxed.ok && unsandboxed.launch.serveArgs).toEqual([
        'serve',
        '--disable-sandbox',
        '--trust-workspace',
      ])
    } finally {
      rmSync(installDir, { recursive: true, force: true })
    }
  })
})

// M71: a window held on someone else's pull request starts `muse serve`
// without the project's configuration, whatever VS Code trusts, until the
// user trusts the worktree in the card.
describe("MuseCodeBackendManager: a window held on someone else's pull request (M71)", () => {
  it('leaves --trust-workspace out while held, even in a folder VS Code trusts', () => {
    const installDir = mkdtempSync(path.join(tmpdir(), 'muse-held-'))
    try {
      const binary = path.join(
        installDir,
        process.platform === 'win32' ? 'muse-bin-1.3.0.exe' : 'muse',
      )
      writeFileSync(binary, '')
      const hold = new WindowHold({ folder: '/held/51-abc', pullRequest: undefined })
      const manager = managerWith([], VS_CODE_PROXY, new FakeLogOutputChannel(), {
        getConfiguredBinaryPath: () => binary,
        // VS Code trusts the folder (a trusted parent, or trust switched off).
        isWorkspaceTrusted: () => hold.allowsProjectConfiguration(true),
      })
      const held = manager.resolveLaunch()
      expect(held.ok && held.launch.serveArgs).toEqual([
        'serve',
        '--disable-sandbox',
        '--disable-shell',
      ])
      hold.release()
      const trusted = manager.resolveLaunch()
      expect(trusted.ok && trusted.launch.serveArgs).toEqual([
        'serve',
        '--disable-sandbox',
        '--trust-workspace',
      ])
      // Restricted Mode applies as well once it is let go.
      expect(hold.allowsProjectConfiguration(false)).toBe(false)
    } finally {
      rmSync(installDir, { recursive: true, force: true })
    }
  })
})

// M39: "CLI not found" must not hide a permission problem.
describe('MuseCodeBackendManager: the CLI lookup reads (M39)', () => {
  it('says in the log when a file is there but cannot be read, not when it is missing', () => {
    const log = new FakeLogOutputChannel()
    const manager = managerWith([], VS_CODE_PROXY, log)
    const installDir = mkdtempSync(path.join(tmpdir(), 'muse-lookup-'))
    try {
      expect(manager.installedVersion(installDir)).toBeUndefined()
      expect(log.warn).not.toHaveBeenCalled()
      // A folder where the version file should be: there, but not readable as a file.
      mkdirSync(path.join(installDir, '.muse-version'))
      expect(manager.installedVersion(installDir)).toBeUndefined()
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('while looking for the Muse Code CLI: Error: EISDIR'),
      )
    } finally {
      rmSync(installDir, { recursive: true, force: true })
    }
  })
})

/**
 * A manager on the fake CLI, which from its first `model/list` on answers
 * nothing and stays up: the wedged `muse serve` of 2026-10-03 (CLI recovery).
 */
function wedgedManager(unresponsive: UnresponsiveHostDeps): MuseCodeBackendManager {
  const spawn = sdk.spawnMspConnection
  vi.spyOn(sdk, 'spawnMspConnection').mockImplementation((options) =>
    spawn({
      ...options,
      args: [path.resolve('test/e2e/fake-muse/serve.mjs')],
      env: {
        MUSE_FAKE_WEDGE: 'model/list',
        XDG_CONFIG_HOME: path.resolve('test/fixtures/workspace/no-muse-config'),
      },
    }),
  )
  const manager = managerWith([], '', new FakeLogOutputChannel(), {
    getConfiguredBinaryPath: () => process.execPath,
    unresponsive,
    // Three short deadlines in a row are enough; the silence is the host test's.
    commandTimeouts: { normalMs: 150, longMs: 150, unresponsiveSilenceMs: 0 },
  })
  // This fixture has no sign-in; never read the developer's credential file.
  vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
  return manager
}

/** The started host, after enough missed deadlines to count as not answering. */
async function wedge(manager: MuseCodeBackendManager) {
  const host = await manager.ensureHost()
  for (let miss = 0; miss < MSP_UNRESPONSIVE_MISSES; miss += 1) {
    await expect(host.listModels()).rejects.toThrow('Muse Code did not answer model/list')
  }
  return host
}

/** A wedged manager whose window has a turn running, or none, and what it was told. */
function recovery(isTurnRunning: boolean) {
  const told: string[] = []
  const holder: { manager?: MuseCodeBackendManager } = {}
  const manager = wedgedManager({
    isTurnRunning: () => isTurnRunning,
    restart: async () => {
      told.push('restart')
      await holder.manager?.dispose()
    },
    sayRestarted: () => {
      told.push('sayRestarted')
    },
    offerRestart: () => {
      told.push('offerRestart')
    },
  })
  holder.manager = manager
  return { manager, told }
}

describe('MuseCodeBackendManager: a Muse Code that stops answering (CLI recovery)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restarts it at once when no turn runs, then says so', async () => {
    const { manager, told } = recovery(false)
    try {
      const host = await wedge(manager)
      await vi.waitFor(() => {
        expect(told).toEqual(['restart', 'sayRestarted'])
      })
      expect(manager.isRunning).toBe(false)
      // The old host refuses at once; the next ensureHost starts a fresh one.
      await expect(host.listModels()).rejects.toThrow(UI_TEXT.museCodeNotAnswering)
      expect(told).toEqual(['restart', 'sayRestarted'])
    } finally {
      await manager.dispose()
    }
  })

  it('offers the restart once while a turn runs, and restarts nothing by itself', async () => {
    const { manager, told } = recovery(true)
    try {
      const host = await wedge(manager)
      await vi.waitFor(() => {
        expect(told).toEqual(['offerRestart'])
      })
      // The same episode says nothing more.
      await expect(host.listModels()).rejects.toThrow(UI_TEXT.museCodeNotAnswering)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(told).toEqual(['offerRestart'])
      expect(manager.isRunning).toBe(true)
    } finally {
      await manager.dispose()
    }
  })
})
