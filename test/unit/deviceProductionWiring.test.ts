// M100 phase 2 (lane W): production wiring regressions. The unbound K ports
// refuse every security-relevant use; the production builder binds the real
// store layout, SecretStorage secrets, journal ownership and the unified
// driver selection; the tab serves the Devices surface lazily. Each case
// fails on the join base, where none of these modules exist.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicePairingError } from '../../src/core/devices/pairing'
import type { DeviceFrame } from '../../src/shared/devices'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import type { DeviceStorageProtection } from '../../src/core/devices/storageProtection'
import type { AttemptJournalOwner } from '../../src/core/devices/attemptJournal'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import type { DeviceExecutionHost } from '../../src/host/devices/deviceSecrets'
import { DEVICES_PANEL_VIEW_TYPE } from '../../src/shared/constants'
import type { DeviceHostMessage } from '../../src/shared/devicesPanel'
import { DevicesPanelTab } from '../../src/host/devices/devicePanelTab'
import {
  openDeviceProductionDeps,
  unboundDeviceLanePorts,
  type DeviceProductionBundle,
} from '../../src/host/devices/deviceProduction'
import {
  FakeLogOutputChannel,
  FakeWebviewPanel,
  fakeHostContext,
  memorySecrets,
} from './helpers/fakes'
import { window as fakeWindow } from './mocks/vscode'

vi.mock('vscode', async () => await import('./mocks/vscode'))

interface FakeStoreHandle {
  readonly kind: 'store'
}
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
}
const FakeDeviceStore = {
  open(directory: string): Promise<FakeStoreHandle> {
    fakeStoreState.opened.push(directory)
    return fakeStoreState.refuseOpen
      ? Promise.reject(new DevicePairingError('storage'))
      : Promise.resolve({ kind: 'store' })
  },
  create(directory: string, deviceId: string): Promise<FakeStoreHandle> {
    if (fakeStoreState.refuseCreate) return Promise.reject(new Error('must not provision twice'))
    fakeStoreState.created.push({ directory, deviceId })
    return Promise.resolve({ kind: 'store' })
  },
}

interface FakeJournalHandle {
  readonly kind: 'journal'
}
const fakeJournalState = {
  created: [] as { directory: string; owner: AttemptJournalOwner }[],
  opened: [] as { directory: string; owner: AttemptJournalOwner }[],
  refuseCreate: false,
}
function resetFakeJournal(): void {
  fakeJournalState.created = []
  fakeJournalState.opened = []
  fakeJournalState.refuseCreate = false
}
const FakeAttemptJournal = {
  async open(directory: string, owner: AttemptJournalOwner): Promise<FakeJournalHandle> {
    fakeJournalState.opened.push({ directory, owner })
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
      ports.policy.assertPaidBinding(dispatch, { feature: 'webSearch' }),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(ports.policy.paidGate.isOn()).toBe(false)
    await expect(ports.policy.paidConsent.allows({ feature: 'webSearch' })).resolves.toBe(false)
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

  it('binds the store layout, secrets, journal ownership and the Linux driver', async () => {
    const directory = await lane()
    const log = new FakeLogOutputChannel()
    const secrets = memorySecrets()
    const ports = unboundDeviceLanePorts(log)
    const deps = await openDeviceProductionDeps(
      fakeBundle(),
      {
        storageDirectory: directory,
        helperDirectory: path.join(directory, 'helper'),
        systemRoot: undefined,
        extensionPath: '/ext',
        secrets,
        log,
        platform: 'linux',
      },
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
      expect(deps.driver.platform).toBe('linux')
      expect(deps.receiverIncarnationId).toMatch(/^[a-f0-9]{32}$/)
      expect(deps.setup).toBe(ports.setup)
      expect(deps.otherAction).toBe(ports.otherAction)
      expect(deps.execution).toBe(ports.execution)
      expect(deps.policy).toBe(ports.policy)
      expect(deps.source).toBe(ports.source)
    } finally {
      deps.dispose()
    }
  })

  it('reopens an existing store and journal instead of provisioning again', async () => {
    const directory = await lane()
    fakeStoreState.refuseOpen = false
    fakeStoreState.refuseCreate = true
    fakeJournalState.refuseCreate = true
    const deps = await openDeviceProductionDeps(
      fakeBundle(),
      {
        storageDirectory: directory,
        helperDirectory: path.join(directory, 'helper'),
        systemRoot: undefined,
        extensionPath: '/ext',
        secrets: memorySecrets(),
        log: new FakeLogOutputChannel(),
        platform: 'linux',
      },
      unboundDeviceLanePorts(new FakeLogOutputChannel()),
    )
    deps.dispose()
    expect(fakeStoreState.opened).toHaveLength(1)
    expect(fakeStoreState.created).toHaveLength(0)
    expect(fakeJournalState.opened).toHaveLength(1)
    expect(fakeJournalState.created).toHaveLength(0)
  })

  it('selects the production driver per platform without spawning', async () => {
    const directory = await lane()
    for (const platform of ['darwin', 'win32'] as const) {
      resetFakeStores()
      resetFakeJournal()
      const helperCalls: { directory: string; systemRoot: string; extensionPath: string }[] = []
      const deps = await openDeviceProductionDeps(
        fakeBundle({
          helperCalls,
          helper: () => Promise.resolve({ protection: undefined, dispose: releaseFakeHelper }),
        }),
        {
          storageDirectory: directory,
          helperDirectory: path.join(directory, 'helper'),
          systemRoot: String.raw`C:\Windows`,
          extensionPath: '/ext',
          secrets: memorySecrets(),
          log: new FakeLogOutputChannel(),
          platform,
        },
        unboundDeviceLanePorts(new FakeLogOutputChannel()),
      )
      try {
        expect(deps.driver.platform).toBe(platform)
        if (platform === 'win32') {
          expect(helperCalls).toEqual([
            {
              directory: path.join(directory, 'helper'),
              systemRoot: String.raw`C:\Windows`,
              extensionPath: '/ext',
            },
          ])
        }
      } finally {
        deps.dispose()
      }
    }
  })

  it('refuses Windows storage without a system root before any helper starts', async () => {
    const directory = await lane()
    const helperCalls: { directory: string; systemRoot: string; extensionPath: string }[] = []
    await expect(
      openDeviceProductionDeps(
        fakeBundle({ helperCalls }),
        {
          storageDirectory: directory,
          helperDirectory: path.join(directory, 'helper'),
          systemRoot: undefined,
          extensionPath: '/ext',
          secrets: memorySecrets(),
          log: new FakeLogOutputChannel(),
          platform: 'win32',
        },
        unboundDeviceLanePorts(new FakeLogOutputChannel()),
      ),
    ).rejects.toMatchObject({ reason: 'storage' })
    expect(helperCalls).toHaveLength(0)
  })
})

describe('M100/W Devices panel tab', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (type, title) => new FakeWebviewPanel(type, title),
    )
  })

  function open(service: () => Promise<{ request(input: unknown): Promise<DeviceHostMessage> }>): {
    tab: DevicesPanelTab
    panel: FakeWebviewPanel
    context: ReturnType<typeof fakeHostContext>
  } {
    const context = fakeHostContext()
    const disposed = vi.fn()
    const tab = new DevicesPanelTab(context, service, disposed)
    tab.open()
    const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
    if (!(panel instanceof FakeWebviewPanel)) throw new TypeError('expected fake panel')
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
    const context = fakeHostContext()
    const tab = new DevicesPanelTab(
      context,
      () => Promise.resolve({ request: () => Promise.resolve(readyState) }),
      disposed,
    )
    tab.open()
    const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
    if (!(panel instanceof FakeWebviewPanel)) throw new TypeError('expected fake panel')
    panel.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    tab.dispose()
  })
})
