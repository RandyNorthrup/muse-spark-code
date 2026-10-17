// M100 phase 2 (lane W): production wiring regressions. The unbound K ports
// refuse every security-relevant use; the production builder binds the real
// store layout, SecretStorage secrets, journal ownership and the unified
// driver selection; the tab serves the Devices surface lazily. Each case
// fails on the join base, where none of these modules exist.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicePairingError } from '../../src/core/devices/pairing'
import type { DeviceFrame } from '../../src/shared/devices'
import {
  FakeDeviceWebviewPanel,
  deviceCheck,
  deviceGrant,
  fakeDeviceHostContext,
  fakeDevicesBundle,
} from './helpers/deviceFixtures'
import type { DeviceStorageProtection } from '../../src/core/devices/storageProtection'
import type { AttemptJournalOwner } from '../../src/core/devices/attemptJournal'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import {
  assertLocalDeviceHost,
  type DeviceExecutionHost,
} from '../../src/host/devices/deviceSecrets'
import { DEVICES_PANEL_VIEW_TYPE, DEVICES_STORAGE_DIR } from '../../src/shared/constants'

// The uniquely named sibling a Windows first use claims, then renames into place.
const STAGE_NAME = new RegExp(String.raw`^\.${DEVICES_STORAGE_DIR}-[a-f0-9]{32}\.stage$`)
import { parseDeviceHostMessage, type DeviceHostMessage } from '../../src/shared/devicesPanel'
import {
  DevicesPanelTab,
  deviceExecutionHost,
  devicesWindow,
} from '../../src/host/views/devicesPanelTab'
import {
  openDeviceProductionDeps,
  unboundDeviceLanePorts,
  type DeviceProductionBundle,
  type DeviceProductionContext,
} from '../../src/host/devices/deviceProduction'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { window as fakeWindow } from './mocks/vscode'

vi.mock('vscode', async () => await import('./mocks/vscode'))

interface FakeStoreHandle {
  readonly kind: 'store'
  close(): Promise<void>
}
// Every release this file observes, in order: store closes and helper ends.
const releases: string[] = []
const fakeStoreState = {
  opened: [] as string[],
  created: [] as { directory: string; deviceId: string }[],
  refuseOpen: true,
  refuseCreate: false,
}
function resetFakeStores(): void {
  fakeStoreState.opened = []
  fakeStoreState.created = []
  fakeStoreState.refuseOpen = true
  fakeStoreState.refuseCreate = false
  releases.length = 0
}
function fakeStoreHandle(): FakeStoreHandle {
  return {
    kind: 'store',
    close: () => {
      releases.push('store')
      return Promise.resolve()
    },
  }
}
const FakeDeviceStore = {
  open(directory: string): Promise<FakeStoreHandle> {
    fakeStoreState.opened.push(directory)
    return fakeStoreState.refuseOpen
      ? Promise.reject(new DevicePairingError('storage'))
      : Promise.resolve(fakeStoreHandle())
  },
  create(directory: string, deviceId: string): Promise<FakeStoreHandle> {
    if (fakeStoreState.refuseCreate) return Promise.reject(new Error('must not provision twice'))
    fakeStoreState.created.push({ directory, deviceId })
    return Promise.resolve(fakeStoreHandle())
  },
}

interface FakeJournalHandle {
  readonly kind: 'journal'
}
const fakeJournalState = {
  created: [] as { directory: string; owner: AttemptJournalOwner }[],
  opened: [] as { directory: string; owner: AttemptJournalOwner }[],
  refuseCreate: false,
  refuseOpen: false,
}
function resetFakeJournal(): void {
  fakeJournalState.created = []
  fakeJournalState.opened = []
  fakeJournalState.refuseCreate = false
  fakeJournalState.refuseOpen = false
}
const FakeAttemptJournal = {
  async open(directory: string, owner: AttemptJournalOwner): Promise<FakeJournalHandle> {
    fakeJournalState.opened.push({ directory, owner })
    if (fakeJournalState.refuseOpen) throw new DevicePairingError('storage')
    await owner.assertOwner()
    return { kind: 'journal' }
  },
  async create(directory: string, owner: AttemptJournalOwner): Promise<FakeJournalHandle> {
    if (fakeJournalState.refuseCreate) throw new DevicePairingError('storage')
    fakeJournalState.created.push({ directory, owner })
    await owner.assertOwner()
    return { kind: 'journal' }
  },
}

class FakeDeviceSecrets {
  public static built: { store: SecretStore; host: DeviceExecutionHost }[] = []
  public static reset(): void {
    FakeDeviceSecrets.built = []
  }
  public constructor(
    public readonly store: SecretStore,
    public readonly host: DeviceExecutionHost,
  ) {
    FakeDeviceSecrets.built.push({ store, host })
  }
}

function releaseFakeHelper(): void {
  // The fake helper holds no process.
}

function fakeBundle(options?: {
  readonly helper?: (options: {
    readonly directory: string
    readonly systemRoot: string
    readonly extensionPath: string
  }) => Promise<{ protection: DeviceStorageProtection | undefined; dispose: () => void }>
  readonly helperCalls?: { directory: string; systemRoot: string; extensionPath: string }[]
  readonly disposed?: { count: number }
}): DeviceProductionBundle {
  const helperCalls = options?.helperCalls ?? []
  const disposed = options?.disposed ?? { count: 0 }
  return {
    DeviceStore: FakeDeviceStore,
    DeviceSecrets: FakeDeviceSecrets,
    AttemptJournal: FakeAttemptJournal,
    startWindowsStorageProtection: async (request: {
      readonly directory: string
      readonly systemRoot: string
      readonly extensionPath: string
    }) => {
      helperCalls.push({ ...request })
      if (options?.helper === undefined) throw new DevicePairingError('storage')
      const binding = await options.helper(request)
      return {
        protection: binding.protection,
        dispose: () => {
          disposed.count += 1
          releases.push('helper')
          binding.dispose()
        },
      }
    },
    // Reason: structural fakes prove the production binding (directories,
    // secrets, owner, driver selection) without touching the real filesystem
    // stores, whose ownership check this sandbox refuses; PLAN.md §8.
  } as unknown as DeviceProductionBundle
}

const lanes: { directory: string }[] = []
async function lane(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'm100-w-'))
  lanes.push({ directory })
  return directory
}
const localHost: DeviceExecutionHost = deviceExecutionHost({
  uiKind: 'desktop',
  remoteName: undefined,
  extensionKind: 'workspace',
})
// The owner probe the journal check compares with: the folder's real owner
// as this OS's stat reports it, so the check runs on every platform.
async function ownerOf(directory: string): Promise<number> {
  const info = await stat(directory)
  return info.uid
}
async function modeOf(directory: string): Promise<number> {
  const info = await stat(directory)
  return info.mode & 0o777
}
afterAll(async () => {
  for (const { directory } of lanes.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('M100/W unbound lane ports', () => {
  it('refuses every security-relevant use and keeps paid use off', async () => {
    const log = new FakeLogOutputChannel()
    const ports = unboundDeviceLanePorts(log)
    expect(log.error).toHaveBeenCalledOnce()
    const dispatch = deviceCheck(deviceGrant('a'.repeat(32)))
    const channel = {
      pairId: 'a'.repeat(32),
      receiverIncarnationId: undefined,
      isReceiver: true,
      send: () => {
        // Refused before any frame is written.
      },
      close: () => {
        // Refused before any socket is touched.
      },
    }
    const frame: DeviceFrame = {
      version: 1,
      pairId: 'a'.repeat(32),
      receiverIncarnationId: 'b'.repeat(32),
      requestId: 'c'.repeat(32),
      body: { kind: 'offers', offers: [] },
    }
    await expect(ports.setup()).rejects.toMatchObject({ reason: 'unsupported-host' })
    await expect(
      ports.otherAction({
        type: 'deviceRequest',
        viewId: 'a'.repeat(32),
        requestId: 'b'.repeat(32),
        revision: 0,
        action: { kind: 'pair' },
      }),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    await expect(ports.execution.retain([])).rejects.toMatchObject({
      reason: 'unsupported-host',
    })
    await expect(ports.execution.admit(dispatch)).rejects.toMatchObject({
      reason: 'unsupported-host',
    })
    await expect(ports.policy.assertAllowed(dispatch)).rejects.toMatchObject({
      reason: 'unsupported-host',
    })
    await expect(ports.policy.approve(dispatch)).rejects.toMatchObject({
      reason: 'unsupported-host',
    })
    await expect(
      ports.policy.assertPaidBinding(dispatch, { feature: 'voice' }),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(ports.policy.paidGate.isOn('voice')).toBe(false)
    await expect(ports.policy.paidConsent.allows({ feature: 'voice' })).resolves.toBe(false)
    expect(() => {
      ports.source.connected(channel)
    }).toThrow(DevicePairingError)
    await expect(ports.source.receive(frame, channel)).rejects.toThrow(DevicePairingError)
    expect(() => {
      ports.source.disconnected('revoked', channel)
    }).not.toThrow()
  })
})

describe('M100/W production dependencies', () => {
  beforeEach(() => {
    resetFakeStores()
    resetFakeJournal()
    FakeDeviceSecrets.reset()
  })

  function context(directory: string, overrides: Partial<DeviceProductionContext> = {}) {
    return {
      storageDirectory: directory,
      helperDirectory: path.join(directory, 'helper'),
      systemRoot: undefined,
      extensionPath: '/ext',
      secrets: memorySecrets(),
      host: localHost,
      log: new FakeLogOutputChannel(),
      platform: 'linux' as const,
      ...overrides,
    }
  }
  const windows = { systemRoot: String.raw`C:\Windows`, platform: 'win32' as const }

  it('binds the store layout, secrets and journal ownership', async () => {
    const directory = await lane()
    const log = new FakeLogOutputChannel()
    const secrets = memorySecrets()
    const ports = unboundDeviceLanePorts(log)
    const uid = await ownerOf(directory)
    const deps = await openDeviceProductionDeps(
      fakeBundle(),
      context(directory, { secrets, log, userId: () => uid }),
      ports,
    )
    try {
      expect(fakeStoreState.opened).toEqual([path.join(directory, 'pairing')])
      expect(fakeStoreState.created).toHaveLength(1)
      expect(fakeStoreState.created[0]?.directory).toBe(path.join(directory, 'pairing'))
      expect(fakeStoreState.created[0]?.deviceId).toMatch(/^[a-f0-9]{32}$/)
      expect(fakeJournalState.created).toHaveLength(1)
      expect(fakeJournalState.created[0]?.directory).toBe(path.join(directory, 'attempts'))
      expect(FakeDeviceSecrets.built).toEqual([
        {
          store: secrets,
          host: {
            ui: 'desktop',
            remoteName: undefined,
            execution: 'local',
            secretLocation: 'execution-host',
          },
        },
      ])
      expect(deps.host).toBe(localHost)
      expect(deps.receiverIncarnationId).toMatch(/^[a-f0-9]{32}$/)
      expect(deps.setup).toBe(ports.setup)
      expect(deps.otherAction).toBe(ports.otherAction)
      expect(deps.execution).toBe(ports.execution)
      expect(deps.policy).toBe(ports.policy)
      expect(deps.source).toBe(ports.source)
      // The journal's owner check compares the folder's owner with this process.
      await expect(fakeJournalState.created[0]?.owner.assertOwner()).resolves.toBeUndefined()
    } finally {
      await deps.dispose()
    }
  })

  it('refuses a journal folder another user owns, and closes the store it opened', async () => {
    const directory = await lane()
    const uid = await ownerOf(directory)
    await expect(
      openDeviceProductionDeps(
        fakeBundle(),
        context(directory, { userId: () => uid + 1 }),
        unbound(),
      ),
    ).rejects.toMatchObject({ reason: 'storage' })
    // Both the first provisioning and the reopen ran the owner check and refused.
    expect(fakeJournalState.created).toHaveLength(1)
    expect(fakeJournalState.opened).toHaveLength(1)
    expect(releases).toEqual(['store'])
    await expect(
      openDeviceProductionDeps(
        fakeBundle(),
        context(directory, { userId: () => undefined }),
        unbound(),
      ),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(releases).toEqual(['store', 'store'])
  })

  it('reopens an existing store and journal instead of provisioning again', async () => {
    const directory = await lane()
    fakeStoreState.refuseOpen = false
    fakeStoreState.refuseCreate = true
    fakeJournalState.refuseCreate = true
    const uid = await ownerOf(directory)
    const deps = await openDeviceProductionDeps(
      fakeBundle(),
      context(directory, { userId: () => uid }),
      unbound(),
    )
    await deps.dispose()
    expect(fakeStoreState.opened).toHaveLength(1)
    expect(fakeStoreState.created).toHaveLength(0)
    expect(fakeJournalState.opened).toHaveLength(1)
    expect(fakeJournalState.created).toHaveLength(0)
    expect(releases).toEqual(['store'])
  })

  it('starts Windows storage protection with the helper directory and releases it', async () => {
    const directory = await lane()
    const helperCalls: { directory: string; systemRoot: string; extensionPath: string }[] = []
    const disposed = { count: 0 }
    const deps = await openDeviceProductionDeps(
      fakeBundle({
        helperCalls,
        helper: () => Promise.resolve({ protection: undefined, dispose: releaseFakeHelper }),
        disposed,
      }),
      context(directory, windows),
      unbound(),
    )
    expect(helperCalls).toEqual([
      {
        directory: path.join(directory, 'helper'),
        systemRoot: String.raw`C:\Windows`,
        extensionPath: '/ext',
      },
    ])
    await deps.dispose()
    expect(disposed.count).toBe(1)
    // The store closes first: its lock release still syncs through the helper.
    expect(releases).toEqual(['store', 'helper'])
    await deps.dispose()
    expect(releases).toEqual(['store', 'helper'])
  })

  it('closes the opened store, then ends the helper, when the journal fails', async () => {
    const directory = await lane()
    fakeJournalState.refuseCreate = true
    fakeJournalState.refuseOpen = true
    const disposed = { count: 0 }
    await expect(
      openDeviceProductionDeps(
        fakeBundle({
          helper: () => Promise.resolve({ protection: undefined, dispose: releaseFakeHelper }),
          disposed,
        }),
        context(directory, { ...windows, userId: () => undefined }),
        unbound(),
      ),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(disposed.count).toBe(1)
    expect(releases).toEqual(['store', 'helper'])
  })

  it('refuses Windows storage without a system root before any helper starts', async () => {
    const directory = await lane()
    const helperCalls: { directory: string; systemRoot: string; extensionPath: string }[] = []
    await expect(
      openDeviceProductionDeps(
        fakeBundle({ helperCalls }),
        context(directory, { platform: 'win32' }),
        unbound(),
      ),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(helperCalls).toHaveLength(0)
  })

  it.each([
    ['Remote SSH', 'ssh-remote'],
    ['WSL', 'wsl'],
    ['a dev container', 'dev-container'],
    ['a tunnel', 'tunnel'],
  ])('refuses %s hosts before touching storage (D80)', async (_name, remoteName) => {
    const parent = await lane()
    const directory = path.join(parent, DEVICES_STORAGE_DIR)
    const helperCalls: { directory: string; systemRoot: string; extensionPath: string }[] = []
    const host = deviceExecutionHost({ uiKind: 'desktop', remoteName, extensionKind: 'workspace' })
    expect(host).toEqual({
      ui: 'desktop',
      remoteName,
      execution: 'remote',
      secretLocation: 'client',
    })
    await expect(
      openDeviceProductionDeps(
        fakeBundle({ helperCalls }),
        context(directory, { ...windows, host }),
        unbound(),
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(existsSync(directory)).toBe(false)
    expect(helperCalls).toHaveLength(0)
    expect(fakeStoreState.opened).toHaveLength(0)
    expect(FakeDeviceSecrets.built).toHaveLength(0)
  })

  it('qualifies only a local desktop extension host', () => {
    expect(() => {
      assertLocalDeviceHost(localHost)
    }).not.toThrow()
    for (const facts of [
      { uiKind: 'web', remoteName: undefined, extensionKind: 'workspace' },
      { uiKind: 'desktop', remoteName: 'ssh-remote', extensionKind: 'ui' },
      { uiKind: 'web', remoteName: 'codespaces', extensionKind: 'workspace' },
    ] as const) {
      expect(() => {
        assertLocalDeviceHost(deviceExecutionHost(facts))
      }).toThrow(DevicePairingError)
    }
  })

  it('provisions a missing private Devices folder before the store and journal', async () => {
    const parent = await lane()
    const directory = path.join(parent, 'globalStorage', DEVICES_STORAGE_DIR)
    const uid = await ownerOf(parent)
    const deps = await openDeviceProductionDeps(
      fakeBundle(),
      context(directory, { userId: () => uid }),
      unbound(),
    )
    await deps.dispose()
    expect(existsSync(directory)).toBe(true)
    if (process.platform !== 'win32') {
      expect(await modeOf(directory)).toBe(0o700)
      expect(await modeOf(path.dirname(directory))).toBe(0o700)
    }
    expect(fakeStoreState.created[0]?.directory).toBe(path.join(directory, 'pairing'))
  })

  it('creates the Windows Devices folder already claimed, then never claims it again', async () => {
    const parent = await lane()
    const directory = path.join(parent, DEVICES_STORAGE_DIR)
    const claims = recordingProtection()
    const bundle = fakeBundle({
      helper: () => Promise.resolve({ protection: claims.protection, dispose: releaseFakeHelper }),
    })
    const first = await openDeviceProductionDeps(bundle, context(directory, windows), unbound())
    await first.dispose()
    // Only a uniquely named stage of this call's own is claimed, then renamed into place.
    expect(claims.claimed).toHaveLength(1)
    expect(path.dirname(claims.claimed[0] ?? '')).toBe(parent)
    expect(path.basename(claims.claimed[0] ?? '')).toMatch(STAGE_NAME)
    expect(existsSync(directory)).toBe(true)
    expect(await stagesIn(parent)).toEqual([])
    const second = await openDeviceProductionDeps(bundle, context(directory, windows), unbound())
    await second.dispose()
    expect(claims.claimed).toHaveLength(1)
  })

  it('never claims a Devices folder another creator made while this call staged its own', async () => {
    const parent = await lane()
    const directory = path.join(parent, DEVICES_STORAGE_DIR)
    const planted = path.join(directory, 'theirs.txt')
    // Another creator makes Devices (with data) between this call's check and its rename.
    const claims = recordingProtection(async () => {
      await mkdir(directory)
      await writeFile(planted, 'not ours')
    })
    const bundle = fakeBundle({
      helper: () => Promise.resolve({ protection: claims.protection, dispose: releaseFakeHelper }),
    })
    const deps = await openDeviceProductionDeps(bundle, context(directory, windows), unbound())
    await deps.dispose()
    expect(claims.claimed.map((file) => path.basename(file))).toEqual([
      expect.stringMatching(STAGE_NAME),
    ])
    expect(claims.claimed).not.toContain(directory)
    expect(await readFile(planted, 'utf8')).toBe('not ours')
    expect(await stagesIn(parent)).toEqual([])
  })

  it('leaves an existing POSIX Devices folder as it is, for the store and journal to check', async () => {
    const parent = await lane()
    const directory = path.join(parent, DEVICES_STORAGE_DIR)
    await mkdir(directory, { mode: 0o755 })
    const before = await modeOf(directory)
    const uid = await ownerOf(parent)
    const deps = await openDeviceProductionDeps(
      fakeBundle(),
      context(directory, { userId: () => uid }),
      unbound(),
    )
    await deps.dispose()
    expect(await modeOf(directory)).toBe(before)
  })
})

/** A Windows binding that records claims; `onClaim` runs inside the first claim. */
function recordingProtection(onClaim?: () => Promise<void>) {
  const claimed: string[] = []
  // Only the claim is observed; the fake store and journal use no binding.
  const protection: DeviceStorageProtection = {
    assertPrivate: () => Promise.resolve(),
    assertSafeAncestor: () => Promise.resolve(),
    secureFresh: async (file) => {
      claimed.push(file)
      if (claimed.length === 1) await onClaim?.()
    },
    replace: () => Promise.resolve(),
    syncDirectory: () => Promise.resolve(),
  }
  return { protection, claimed }
}
async function stagesIn(parent: string): Promise<string[]> {
  const names = await readdir(parent)
  return names.filter((name) => name.endsWith('.stage'))
}

function unbound() {
  return unboundDeviceLanePorts(new FakeLogOutputChannel())
}

describe('M100/W Devices panel tab', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (type, title) => new FakeDeviceWebviewPanel(type, title),
    )
  })

  function open(service: () => Promise<{ request(input: unknown): Promise<DeviceHostMessage> }>): {
    tab: DevicesPanelTab
    panel: FakeDeviceWebviewPanel
    context: ReturnType<typeof fakeDeviceHostContext>
  } {
    const context = fakeDeviceHostContext()
    const disposed = vi.fn()
    const tab = new DevicesPanelTab(context, service, disposed)
    tab.open()
    const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
    if (!(panel instanceof FakeDeviceWebviewPanel)) throw new TypeError('expected fake panel')
    return { tab, panel, context }
  }

  const readyState: DeviceHostMessage = {
    type: 'deviceState',
    revision: 1,
    state: { enabled: false },
  }

  it('opens one secured tab for the Devices surface and reveals it again', () => {
    const { tab, panel } = open(() =>
      Promise.resolve({ request: () => Promise.resolve(readyState) }),
    )
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledWith(
      DEVICES_PANEL_VIEW_TYPE,
      'Devices',
      expect.anything(),
      {},
    )
    expect(panel.webview.options.enableCommandUris).toBe(false)
    expect(panel.webview.html).toContain('data-surface="devices"')
    tab.open()
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledOnce()
    expect(panel.reveal).toHaveBeenCalledWith(undefined, false)
  })

  it('holds host traffic until the ready handshake, then routes and publishes', async () => {
    const request = vi.fn((input: unknown): Promise<DeviceHostMessage> => {
      if (
        typeof input !== 'object' ||
        input === null ||
        !('type' in input) ||
        (input.type !== 'devicesReady' && input.type !== 'deviceRequest')
      )
        throw new Error('invalid-device-message')
      return Promise.resolve(readyState)
    })
    const { tab, panel, context } = open(() => Promise.resolve({ request }))
    tab.publish(readyState)
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
    panel.webview.messages.fire({ type: 'devicesReady' })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledTimes(1)
    })
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(readyState)
    tab.publish(readyState)
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledTimes(2)
    })
    panel.webview.messages.fire({ type: 'bogus', text: 1 })
    await vi.waitFor(() => {
      expect(context.log.error).toHaveBeenCalledWith(
        expect.stringContaining('devices request failed'),
      )
    })
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2)
  })

  it('releases the tab reference on disposal', () => {
    const disposed = vi.fn()
    const context = fakeDeviceHostContext()
    const tab = new DevicesPanelTab(
      context,
      () => Promise.resolve({ request: () => Promise.resolve(readyState) }),
      disposed,
    )
    tab.open()
    const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
    if (!(panel instanceof FakeDeviceWebviewPanel)) throw new TypeError('expected fake panel')
    panel.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    tab.dispose()
  })
})

function openRefusing(error: Error) {
  const service = vi.fn(() => Promise.reject(error))
  const context = fakeDeviceHostContext()
  const tab = new DevicesPanelTab(context, service)
  tab.open()
  const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
  if (!(panel instanceof FakeDeviceWebviewPanel)) throw new TypeError('expected fake panel')
  return { tab, panel, service, context }
}

describe('M100/W Devices tab when the service cannot open', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (type, title) => new FakeDeviceWebviewPanel(type, title),
    )
  })
  const viewId = 'a'.repeat(32)
  const pair = (requestId: string, revision: number) => ({
    type: 'deviceRequest',
    viewId,
    requestId,
    revision,
    action: { kind: 'pair' },
  })

  it('answers the request with its typed refusal, correlated, then keeps answering locally', async () => {
    const { panel, service } = openRefusing(new DevicePairingError('unsupported-host'))
    panel.webview.messages.fire({ type: 'devicesReady' })
    await vi.waitFor(() => {
      expect(service).toHaveBeenCalledOnce()
    })
    // No observation exists, so ready leaves the document's own off state.
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
    panel.webview.messages.fire(pair('b'.repeat(32), 0))
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledOnce()
    })
    const refusal: unknown = vi.mocked(panel.webview.postMessage).mock.calls[0]?.[0]
    expect(refusal).toEqual({
      type: 'deviceState',
      revision: 1,
      state: { enabled: false },
      setup: { viewId, requestId: 'b'.repeat(32), failure: 'unsupported-host' },
    })
    expect(parseDeviceHostMessage(refusal).ok).toBe(true)
    // The document's revisions are now this tab's: the next request is answered here.
    panel.webview.messages.fire(pair('c'.repeat(32), 1))
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledTimes(2)
    })
    expect(vi.mocked(panel.webview.postMessage).mock.calls[1]?.[0]).toMatchObject({
      revision: 2,
      setup: { requestId: 'c'.repeat(32), failure: 'unsupported-host' },
    })
    expect(service).toHaveBeenCalledTimes(2)
  })

  it('answers unusable storage as storage and logs an untyped failure without a reply', async () => {
    const storage = openRefusing(new DevicePairingError('storage'))
    storage.panel.webview.messages.fire({ type: 'devicesReady' })
    storage.panel.webview.messages.fire(pair('d'.repeat(32), 0))
    await vi.waitFor(() => {
      expect(storage.panel.webview.postMessage).toHaveBeenCalledOnce()
    })
    expect(vi.mocked(storage.panel.webview.postMessage).mock.calls[0]?.[0]).toMatchObject({
      setup: { failure: 'storage' },
    })
    const untyped = openRefusing(new Error('bundle-unavailable-sentinel'))
    untyped.panel.webview.messages.fire({ type: 'devicesReady' })
    untyped.panel.webview.messages.fire(pair('e'.repeat(32), 0))
    await vi.waitFor(() => {
      expect(untyped.context.log.error).toHaveBeenCalledTimes(2)
    })
    expect(untyped.panel.webview.postMessage).not.toHaveBeenCalled()
  })
})

function production(directory: string) {
  return {
    storageDirectory: directory,
    helperDirectory: path.join(directory, 'helper'),
    systemRoot: undefined,
    extensionPath: '/ext',
    secrets: memorySecrets(),
    host: localHost,
  }
}

/** The window with its tab open and the document ready; `closed` sees the tab end. */
async function readyWindow(bundle: unknown) {
  const devices = devicesWindow({
    hostContext: fakeDeviceHostContext(),
    bundlePath: 'devices.js',
    log: new FakeLogOutputChannel(),
    production: production(await lane()),
    loadBundle: () => bundle,
  })
  devices.open()
  const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
  if (!(panel instanceof FakeDeviceWebviewPanel)) throw new TypeError('expected fake panel')
  const closed = vi.fn()
  panel.onDidDispose(closed)
  panel.webview.messages.fire({ type: 'devicesReady' })
  return { devices, closed }
}

describe('M100/W window-owned Devices service', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (type, title) => new FakeDeviceWebviewPanel(type, title),
    )
  })

  function windowBundle(prepare: () => Promise<unknown>) {
    const ended = { deps: 0, service: 0 }
    const service = {
      request: vi.fn(() => Promise.resolve(readyState)),
      dispose: vi.fn(() => {
        ended.service += 1
      }),
    }
    const bundle = fakeDevicesBundle({
      createDeviceService: vi.fn(() => Promise.resolve(service)),
      unboundDeviceLanePorts: vi.fn(() => ({})),
      openDeviceProductionDeps: vi.fn(async () => {
        await prepare()
        return {
          dispose: () => {
            ended.deps += 1
            return Promise.resolve()
          },
        }
      }),
    })
    return { bundle, service, ended }
  }
  const readyState: DeviceHostMessage = {
    type: 'deviceState',
    revision: 1,
    state: { enabled: false },
  }

  it('revokes a preparation still in flight when the window ends', async () => {
    const held: { release?: () => void } = {}
    const started = Promise.withResolvers<undefined>()
    const { bundle, ended } = windowBundle(
      () =>
        new Promise<void>((resolve) => {
          held.release = resolve
          started.resolve(undefined)
        }),
    )
    const { devices, closed } = await readyWindow(bundle)
    await started.promise
    devices.dispose()
    expect(closed).toHaveBeenCalledOnce()
    held.release?.()
    await vi.waitFor(() => {
      expect(ended.deps).toBe(1)
    })
    expect(bundle.createDeviceService).not.toHaveBeenCalled()
  })

  it('ends a bound service with its storage when the window ends', async () => {
    const { bundle, service, ended } = windowBundle(() => Promise.resolve())
    const { devices, closed } = await readyWindow(bundle)
    await vi.waitFor(() => {
      expect(service.request).toHaveBeenCalledOnce()
    })
    expect(bundle.openDeviceProductionDeps).toHaveBeenCalledWith(
      bundle,
      expect.objectContaining({ host: localHost }),
      {},
    )
    devices.dispose()
    expect(ended).toEqual({ deps: 1, service: 1 })
    expect(closed).toHaveBeenCalledOnce()
  })
})
