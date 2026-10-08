// M107 U–C1/W: the window governor's status source, its lazy admission port,
// the VS Code window adapter and the strict status/action wire.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import {
  COMMAND_IDS,
  RESOURCE_GIB_BYTES,
  RESOURCE_OVERRIDE_MS,
  RESOURCE_STATUS_MAX_CHARS,
  UI_TEXT,
  VSCODE_COMMANDS,
} from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import {
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
  type HostToWebviewMessage,
} from '../../src/shared/protocol'
import {
  resourceSettingsSchema,
  resourceStatusSchema,
  type ResourceSample,
  type ResourceSettings,
  type ResourceStatus,
} from '../../src/shared/resources'
import type { ResourceWindowHost } from '../../src/core/resources/admission'
import { createResourceWindow } from '../../src/host/resources/resourceWindow'
import type * as GovernorEntry from '../../src/core/resources/resourceGovernorEntry'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'

const governorEntry = vi.hoisted(() => ({ load: 0 }))
vi.mock('../../src/core/resources/resourceGovernorEntry', async (importOriginal) => {
  const actual = await importOriginal<typeof GovernorEntry>()
  governorEntry.load++
  return actual
})

function launchHost(settings: () => ResourceSettings = () => resourceSettingsSchema.parse({})) {
  const clock = new FakeResourceClock()
  const steps: ResourceSample[] = []
  const errors = vi.fn()
  const events = new ResourceEvents(errors)
  const governor = new ResourceGovernor({
    clock,
    events,
    settings: settings(),
    sampler: new ScriptedResourceSampler(steps),
    hasRelocationTarget: null,
    onError: errors,
  })
  const host = new ResourceLaunchHost({
    governor,
    events,
    clock,
    settings,
    bindTree: () => Promise.resolve(null),
    onError: errors,
  })
  const read = async (changes: Partial<ResourceSample> = {}) => {
    steps.push({
      atMs: clock.now(),
      cpuPercent: 20,
      memoryUsedPercent: 40,
      memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
      memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
      ...changes,
    })
    await governor.refresh()
  }
  return { host, governor, clock, steps, errors, read }
}

describe('U–C1 window status source', () => {
  it('caches one checked snapshot until its content changes and says noRoute', async () => {
    const h = launchHost()
    const first = h.host.status()
    expect(resourceStatusSchema.parse(first)).toEqual(first)
    expect(first.relocation).toBe('noRoute')
    expect(h.host.status()).toBe(first)
    const changed = vi.fn()
    const unsubscribe = h.host.subscribe(changed)
    await h.read()
    const second = h.host.status()
    expect(second).not.toBe(first)
    expect(second.sample?.cpuPercent).toBe(20)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(h.host.status()).toBe(second)
    // A no-op settings check leaves the same object and no notification.
    h.host.settingsChanged()
    expect(h.host.status()).toBe(second)
    expect(changed).toHaveBeenCalledTimes(1)
    unsubscribe()
    h.clock.advance(1)
    await h.read({ cpuPercent: 30 })
    expect(changed).toHaveBeenCalledTimes(1)
    h.host.dispose()
  })

  it('notifies when queued work waits and again when its admission is withdrawn', async () => {
    const h = launchHost()
    await h.read({ memoryUsedPercent: 95 })
    await h.read({ memoryUsedPercent: 95 })
    expect(h.governor.level()).toBe('throttle')
    const first = await h.host.admit('backgroundTask', undefined, 'background')
    const changed = vi.fn()
    h.host.subscribe(changed)
    const controller = new AbortController()
    const waiting = h.host.admit('backgroundTask', controller.signal, 'background')
    await Promise.resolve()
    expect(changed).toHaveBeenCalled()
    expect(h.host.status().queued).toEqual([
      { kind: 'backgroundTask', class: 'background', count: 1 },
    ])
    const calls = changed.mock.calls.length
    controller.abort()
    await expect(waiting).rejects.toThrow('cancelled')
    expect(changed.mock.calls.length).toBeGreaterThan(calls)
    expect(h.host.status().queued).toEqual([])
    first.complete(true)
    h.host.dispose()
  })

  it('applies settings changes at once and refuses subscription after disposal', () => {
    let settings = resourceSettingsSchema.parse({})
    const h = launchHost(() => settings)
    const changed = vi.fn()
    h.host.subscribe(changed)
    settings = resourceSettingsSchema.parse({ cpuMaxPercent: 60 })
    h.host.settingsChanged()
    expect(h.host.status().settings.cpuMaxPercent).toBe(60)
    expect(changed).toHaveBeenCalledTimes(1)
    h.host.dispose()
    expect(() => h.host.subscribe(changed)).toThrow('disposed')
    expect(() => h.host.resume()).toThrow('disposed')
  })

  it('resumes with the fifteen-minute override and never turns on a disabled governor', async () => {
    const h = launchHost()
    await h.read({ memoryUsedPercent: 95 })
    await h.read({ memoryUsedPercent: 95 })
    expect(h.host.status().level).toBe('throttle')
    const resumed = h.host.resume()
    expect(resumed.level).toBe('normal')
    expect(resumed.overrideUntilMs).toBe(h.clock.now() + RESOURCE_OVERRIDE_MS)
    h.host.dispose()

    const off = launchHost(() => resourceSettingsSchema.parse({ enabled: false }))
    const status = off.host.resume()
    expect(status.overrideUntilMs).toBeNull()
    expect(status.settings.enabled).toBe(false)
    off.host.dispose()
  })

  it('takes one reading for Show without starting periodic sampling', async () => {
    const h = launchHost()
    h.steps.push({
      atMs: 0,
      cpuPercent: 11,
      memoryUsedPercent: 40,
      memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
      memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
    })
    const status = await h.host.refreshStatus()
    expect(status.sample?.cpuPercent).toBe(11)
    // No timer was scheduled: advancing the clock asks for no further reading.
    h.clock.advance(RESOURCE_OVERRIDE_MS)
    await Promise.resolve()
    expect(h.errors).not.toHaveBeenCalled()
    h.host.dispose()

    const off = launchHost(() => resourceSettingsSchema.parse({ enabled: false }))
    const offStatus = await off.host.refreshStatus()
    expect(offStatus.sample).toBeNull()
    off.host.dispose()
  })
})

describe('U–C1 lazy admission port', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('imports nothing on attach, then hands the loaded host to every attacher once', async () => {
    const admission = await import('../../src/core/resources/admission')
    const before = governorEntry.load
    const dispose = admission.configureResources({ inspect: () => undefined, onError: vi.fn() })
    const attach = vi.fn<(window: ResourceWindowHost) => void>()
    const stop = admission.onResourceWindow(attach)
    expect(governorEntry.load).toBe(before)
    expect(attach).not.toHaveBeenCalled()
    const loaded = await admission.loadResourceWindow()
    expect(loaded).toBeDefined()
    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach.mock.calls[0]?.[0]).toBe(loaded)
    expect(loaded?.port.status().relocation).toBe('noRoute')
    // A later attacher hears the loaded host at once.
    const late = vi.fn<(window: ResourceWindowHost) => void>()
    admission.onResourceWindow(late)
    expect(late).toHaveBeenCalledWith(loaded)
    stop()
    dispose()
    await Promise.resolve()
  })

  it('returns no window when admission is not configured', async () => {
    const admission = await import('../../src/core/resources/admission')
    expect(await admission.loadResourceWindow()).toBeUndefined()
  })
})

function fakeStatus(level: ResourceStatus['level'], isEnabled = true): ResourceStatus {
  return resourceStatusSchema.parse({
    level,
    settings: { enabled: isEnabled },
    sample: null,
    queued: [],
    overrideUntilMs: level === 'normal' && isEnabled ? 1000 : null,
    relocation: 'noRoute',
  })
}

function windowHarness(initial: ResourceStatus = fakeStatus('pause')) {
  let status = initial
  const listeners = new Set<() => void>()
  const statusItem = { update: vi.fn(), show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
  const createStatus = vi.fn<ResourceWindowHost['createStatus']>(() => ({
    dispose: statusItem.dispose,
  }))
  const port = {
    status: vi.fn(() => status),
    subscribe: vi.fn((changed: () => void) => {
      listeners.add(changed)
      return () => {
        listeners.delete(changed)
      }
    }),
    resume: vi.fn(() => {
      status = fakeStatus('normal', status.settings.enabled)
      return status
    }),
    refreshStatus: vi.fn(() => Promise.resolve(status)),
    settingsChanged: vi.fn(),
  }
  const window: ResourceWindowHost = {
    port,
    createStatus,
    createVsCodeItem: vi.fn(() => statusItem),
  }
  const surface = { post: vi.fn<(message: HostToWebviewMessage) => void>(), reveal: vi.fn() }
  const surfaces = {
    active: surface as typeof surface | undefined,
    broadcast: vi.fn<(message: HostToWebviewMessage) => void>(),
  }
  let configuration:
    ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined
  const vscode = {
    window: {
      createStatusBarItem: vi.fn(),
      showInformationMessage: vi.fn((_message: string, ..._items: string[]) =>
        Promise.resolve<string | undefined>(undefined),
      ),
      showWarningMessage: vi.fn((_message: string, ..._items: string[]) =>
        Promise.resolve<string | undefined>(undefined),
      ),
    },
    commands: { executeCommand: vi.fn(() => Promise.resolve()) },
    workspace: {
      onDidChangeConfiguration: vi.fn(
        (listener: (event: { affectsConfiguration(section: string): boolean }) => void) => {
          configuration = listener
          return { dispose: vi.fn() }
        },
      ),
    },
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class {
      public constructor(public readonly id: string) {}
    },
  }
  let attach: ((loaded: ResourceWindowHost) => void) | undefined
  const openConversation = vi.fn(() => Promise.resolve())
  const warn = vi.fn()
  const resources = createResourceWindow({
    vscode,
    onLoad: (attacher) => {
      attach = attacher
      return () => {
        attach = undefined
      }
    },
    load: () => {
      attach?.(window)
      return Promise.resolve(window)
    },
    surfaces,
    openConversation,
    conversationId: () => 'conversation',
    warn,
  })
  return {
    resources,
    window,
    port,
    surface,
    surfaces,
    vscode,
    openConversation,
    warn,
    statusItem,
    createStatus,
    load: () => attach?.(window),
    change: (next: ResourceStatus) => {
      status = next
      for (const listener of listeners) listener()
    },
    configure: (section: string) => {
      configuration?.({ affectsConfiguration: (name) => section.startsWith(name) })
    },
    listeners,
  }
}

describe('U–C1 VS Code window adapter', () => {
  it('publishes the checked status once per change to every surface and each new one', () => {
    const h = windowHarness()
    expect(h.surfaces.broadcast).not.toHaveBeenCalled()
    h.load()
    expect(h.createStatus).toHaveBeenCalledTimes(1)
    const sent = h.surfaces.broadcast.mock.calls.map(([message]) => message)
    expect(sent).toEqual([{ type: 'resourceStatus', status: JSON.stringify(fakeStatus('pause')) }])
    h.change(fakeStatus('pause'))
    expect(h.surfaces.broadcast).toHaveBeenCalledTimes(1)
    h.change(fakeStatus('throttle'))
    expect(h.surfaces.broadcast).toHaveBeenCalledTimes(2)
    const ready = { post: vi.fn<(message: HostToWebviewMessage) => void>() }
    h.resources.surfaceReady(ready)
    expect(ready.post).toHaveBeenCalledWith({
      type: 'resourceStatus',
      status: JSON.stringify(fakeStatus('throttle')),
    })
    expect(ready.post).toHaveBeenCalledTimes(1)
    for (const [message] of h.surfaces.broadcast.mock.calls)
      expect(parseHostToWebviewMessage(message).ok).toBe(true)
  })

  it('binds the status item to the same lazy port, with no late command registration', () => {
    const h = windowHarness()
    h.load()
    const deps = h.createStatus.mock.calls[0]?.[0]
    expect(deps?.registerShow).toBeUndefined()
    expect(deps?.conversationId()).toBe('conversation')
    expect(deps?.port.getSnapshot()).toBe(h.port.status())
    deps?.createItem()
    expect(h.window.createVsCodeItem).toHaveBeenCalledWith(h.vscode)
    deps?.notice('paused', [{ label: UI_TEXT.resourceResumeNow, run: vi.fn() }])
    expect(h.vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'paused',
      UI_TEXT.resourceResumeNow,
    )
  })

  it('opens the chip popover in the surface in view for Show resources', async () => {
    const h = windowHarness()
    await h.resources.show()
    expect(h.port.refreshStatus).toHaveBeenCalledTimes(1)
    expect(h.surface.reveal).toHaveBeenCalledTimes(1)
    expect(h.surface.post).toHaveBeenCalledWith({ type: 'resourceOpen' })
    expect(h.surfaces.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resourceStatus' }),
    )
  })

  it('opens a conversation when none is in view and opens the popover once it is ready', async () => {
    const h = windowHarness()
    h.surfaces.active = undefined
    await h.resources.show()
    expect(h.openConversation).toHaveBeenCalledTimes(1)
    const ready = { post: vi.fn<(message: HostToWebviewMessage) => void>() }
    h.resources.surfaceReady(ready)
    expect(ready.post.mock.calls.map(([message]) => message.type)).toEqual([
      'resourceStatus',
      'resourceOpen',
    ])
    const later = { post: vi.fn<(message: HostToWebviewMessage) => void>() }
    h.resources.surfaceReady(later)
    expect(later.post.mock.calls.map(([message]) => message.type)).toEqual(['resourceStatus'])
  })

  it('says the governor is off and offers its settings instead of an empty popover', async () => {
    const h = windowHarness(fakeStatus('normal', false))
    h.vscode.window.showInformationMessage.mockResolvedValueOnce(UI_TEXT.openSettings)
    await h.resources.show()
    expect(h.surface.post).not.toHaveBeenCalledWith({ type: 'resourceOpen' })
    expect(h.vscode.window.showInformationMessage).toHaveBeenCalledWith(
      UI_TEXT.resourceGovernorOff,
      UI_TEXT.openSettings,
    )
    expect(h.vscode.commands.executeCommand).toHaveBeenCalledWith(
      VSCODE_COMMANDS.openSettings,
      'museSpark.resource',
    )
    await h.resources.resume()
    expect(h.vscode.window.showInformationMessage).toHaveBeenLastCalledWith(
      UI_TEXT.resourceGovernorOff,
      UI_TEXT.openSettings,
    )
  })

  it('resumes through the governor override and says until when', async () => {
    const h = windowHarness()
    await h.resources.resume()
    expect(h.port.resume).toHaveBeenCalledTimes(1)
    expect(h.vscode.window.showInformationMessage).toHaveBeenCalledWith(
      fill(UI_TEXT.resourceOverrideNotice, { time: formatDateTime(1000) }),
    )
    await h.resources.action('resume')
    expect(h.port.resume).toHaveBeenCalledTimes(2)
  })

  it('routes the popover controls: settings to the machine settings, show to the usage page', async () => {
    const h = windowHarness()
    await h.resources.action('settings')
    expect(h.vscode.commands.executeCommand).toHaveBeenLastCalledWith(
      VSCODE_COMMANDS.openSettings,
      'museSpark.resource',
    )
    await h.resources.action('show')
    expect(h.vscode.commands.executeCommand).toHaveBeenLastCalledWith(COMMAND_IDS.openUsagePage)
  })

  it('reapplies machine settings on a configuration change once loaded', () => {
    const h = windowHarness()
    h.configure('museSpark.resourceCpuMaxPercent')
    expect(h.port.settingsChanged).not.toHaveBeenCalled()
    h.load()
    h.configure('editor.fontSize')
    expect(h.port.settingsChanged).not.toHaveBeenCalled()
    h.configure('museSpark.resourceCpuMaxPercent')
    expect(h.port.settingsChanged).toHaveBeenCalledTimes(1)
  })

  it('never sends a status beyond the message bound', () => {
    const h = windowHarness()
    h.port.status.mockReturnValue({
      ...fakeStatus('pause'),
      queued: Array.from({ length: RESOURCE_STATUS_MAX_CHARS }, () => ({
        kind: 'check' as const,
        class: 'background' as const,
        count: 1,
      })),
    })
    h.load()
    expect(h.surfaces.broadcast).not.toHaveBeenCalled()
    expect(h.warn).toHaveBeenCalledWith(
      'Resource status exceeds the window message bound; not sent',
    )
  })

  it('disposes the status item and its subscription exactly with the window', () => {
    const h = windowHarness()
    h.load()
    expect(h.listeners.size).toBe(1)
    h.resources.dispose()
    expect(h.statusItem.dispose).toHaveBeenCalledTimes(1)
    expect(h.listeners.size).toBe(0)
    h.load()
    expect(h.createStatus).toHaveBeenCalledTimes(1)
  })
})

describe('U–C1 strict resource wire', () => {
  const text = JSON.stringify(fakeStatus('pause'))

  it('accepts the bounded status, the open request and the three popover actions', () => {
    expect(parseHostToWebviewMessage({ type: 'resourceStatus', status: text })).toEqual({
      ok: true,
      message: { type: 'resourceStatus', status: text },
    })
    expect(parseHostToWebviewMessage({ type: 'resourceOpen' }).ok).toBe(true)
    for (const action of ['show', 'settings', 'resume'])
      expect(parseWebviewToHostMessage({ type: 'resourceAction', action }).ok).toBe(true)
  })

  it('refuses oversized, empty, unknown-field and unknown-action messages', () => {
    const refused = [
      { type: 'resourceStatus', status: 'x'.repeat(RESOURCE_STATUS_MAX_CHARS + 1) },
      { type: 'resourceStatus', status: '' },
      { type: 'resourceStatus', status: text, level: 'pause' },
      { type: 'resourceStatus', status: JSON.parse(text) as unknown },
      { type: 'resourceOpen', force: true },
    ]
    for (const message of refused) expect(parseHostToWebviewMessage(message).ok).toBe(false)
    for (const message of [
      { type: 'resourceAction', action: 'kill' },
      { type: 'resourceAction', action: 'resume', untilMs: 1 },
      { type: 'resourceAction' },
    ])
      expect(parseWebviewToHostMessage(message).ok).toBe(false)
    expect(
      parseHostToWebviewMessage({
        type: 'resourceStatus',
        status: 'x'.repeat(RESOURCE_STATUS_MAX_CHARS),
      }).ok,
    ).toBe(true)
  })
})
