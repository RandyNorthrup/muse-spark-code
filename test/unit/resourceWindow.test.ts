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
  RESOURCE_NONCE_MAX_CHARS,
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

const HEALTHY: ResourceSample = {
  atMs: 0,
  cpuPercent: 20,
  memoryUsedPercent: 40,
  memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
  memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
  gpuPercent: null,
  diskBusyPercent: null,
  pressure: null,
}

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
    steps.push({ ...HEALTHY, atMs: clock.now(), ...changes })
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
    // An identical reading (same instant, same values) keeps the same object, unannounced.
    await h.read()
    expect(h.host.status()).toBe(second)
    expect(changed).toHaveBeenCalledTimes(1)
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
    h.steps.push({ ...HEALTHY, cpuPercent: 11 })
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
  const surface = fakeSurface('panel:in-view')
  const removed = new Set<(surface: ReturnType<typeof fakeSurface>) => void>()
  const surfaces = {
    active: surface as ReturnType<typeof fakeSurface> | undefined,
    broadcast: vi.fn<(message: HostToWebviewMessage) => void>(),
    onRemoved: (listener: (surface: ReturnType<typeof fakeSurface>) => void) => {
      removed.add(listener)
      return {
        dispose: () => {
          removed.delete(listener)
        },
      }
    },
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
  const openConversation = vi.fn(() => ({
    surfaceId: 'panel:new',
    opened: Promise.resolve(),
  }))
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
    removed,
    remove: (gone: ReturnType<typeof fakeSurface>) => {
      for (const listener of removed) listener(gone)
    },
  }
}

function fakeSurface(id: string) {
  return { id, post: vi.fn<(message: HostToWebviewMessage) => void>(), reveal: vi.fn() }
}

/** The opens a fake surface was offered, as `seq@nonce`. */
const opens = (surface: ReturnType<typeof fakeSurface>) =>
  surface.post.mock.calls.flatMap(([message]) =>
    message.type === 'resourceOpen' ? [`${String(message.seq)}@${message.nonce}`] : [],
  )

const sent = (surface: ReturnType<typeof fakeSurface>) =>
  surface.post.mock.calls.map(([message]) => message.type)

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
    const ready = fakeSurface('panel:ready')
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

  // RVM107W1C pull model: a document names itself (ready/pull) and acks.

  it('offers the open to the ready document in view and spends it only on its ack', async () => {
    const h = windowHarness()
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'n1')
    await h.resources.show()
    expect(h.surface.reveal).toHaveBeenCalledTimes(1)
    expect(opens(h.surface)).toEqual(['1@n1'])
    h.resources.pull(h.surface, 'n1')
    expect(opens(h.surface)).toEqual(['1@n1', '1@n1'])
    h.resources.acknowledge(h.surface, 1, 'n1')
    h.resources.pull(h.surface, 'n1')
    expect(opens(h.surface)).toEqual(['1@n1', '1@n1'])
  })

  it('ignores a queued pull from a replaced document; the new document gets the open', async () => {
    // RVM107W1C P2-1: the document's own nonce, never an inferred generation.
    const h = windowHarness()
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'old')
    h.resources.surfaceReset(h.surface)
    await h.resources.show()
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'old')
    h.resources.pull(h.surface, 'old')
    expect(opens(h.surface)).toEqual([])
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'new')
    expect(opens(h.surface)).toEqual(['1@new'])
    h.resources.acknowledge(h.surface, 1, 'old')
    h.resources.pull(h.surface, 'new')
    expect(opens(h.surface)).toEqual(['1@new', '1@new'])
  })

  it('keeps an open across a reload between Show and its ack, delivered once', async () => {
    const h = windowHarness()
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'n1')
    await h.resources.show()
    expect(opens(h.surface)).toEqual(['1@n1'])
    h.resources.surfaceReset(h.surface)
    h.resources.acknowledge(h.surface, 1, 'n1')
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'n2')
    expect(opens(h.surface)).toEqual(['1@n1', '1@n2'])
    h.resources.acknowledge(h.surface, 1, 'n2')
    h.resources.surfaceReset(h.surface)
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'n3')
    expect(opens(h.surface)).toEqual(['1@n1', '1@n2'])
  })

  it('binds the target when Show runs, not after its awaits', async () => {
    // RVM107W1C P2-2a: Show in A, focus moves to B while the reading waits.
    const h = windowHarness()
    const reading = Promise.withResolvers<ResourceStatus>()
    h.port.refreshStatus.mockImplementationOnce(() => reading.promise)
    const other = fakeSurface('panel:other')
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'a')
    h.resources.surfaceReady(other)
    h.resources.pull(other, 'b')
    const showing = h.resources.show()
    await vi.waitFor(() => {
      expect(h.port.refreshStatus).toHaveBeenCalledTimes(1)
    })
    h.surfaces.active = other
    reading.resolve(fakeStatus('pause'))
    await showing
    expect(opens(h.surface)).toEqual(['1@a'])
    expect(opens(other)).toEqual([])
    expect(other.reveal).not.toHaveBeenCalled()
  })

  it('lets the latest Show win: an older continuation never overwrites it', async () => {
    // RVM107W1C P2-2b.
    const h = windowHarness()
    const first = Promise.withResolvers<ResourceStatus>()
    h.port.refreshStatus.mockImplementationOnce(() => first.promise)
    const other = fakeSurface('panel:other')
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'a')
    h.resources.surfaceReady(other)
    h.resources.pull(other, 'b')
    const older = h.resources.show()
    // The older Show is waiting in its reading when the newer one starts.
    await vi.waitFor(() => {
      expect(h.port.refreshStatus).toHaveBeenCalledTimes(1)
    })
    h.surfaces.active = other
    await h.resources.show()
    h.surfaces.active = h.surface
    first.resolve(fakeStatus('pause'))
    await older
    expect(opens(other)).toEqual(['2@b'])
    expect(opens(h.surface)).toEqual([])
    h.resources.pull(h.surface, 'a')
    expect(opens(h.surface)).toEqual([])
  })

  it('delivers one open with the latest seq for Show, Show, then the document pulls', async () => {
    const h = windowHarness()
    await h.resources.show()
    await h.resources.show()
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'n1')
    expect(opens(h.surface)).toEqual(['2@n1'])
  })

  it('sends nothing when the adapter is disposed during an awaited Show', async () => {
    // RVM107W1C P2-3.
    const h = windowHarness()
    const reading = Promise.withResolvers<ResourceStatus>()
    h.port.refreshStatus.mockImplementationOnce(() => reading.promise)
    h.load()
    h.resources.surfaceReady(h.surface)
    h.resources.pull(h.surface, 'n1')
    h.surface.post.mockClear()
    h.surfaces.broadcast.mockClear()
    const showing = h.resources.show()
    await vi.waitFor(() => {
      expect(h.port.refreshStatus).toHaveBeenCalledTimes(1)
    })
    h.resources.dispose()
    reading.resolve(fakeStatus('throttle'))
    await showing
    expect(h.surface.post).not.toHaveBeenCalled()
    expect(h.surfaces.broadcast).not.toHaveBeenCalled()
    expect(h.surface.reveal).not.toHaveBeenCalled()
    h.resources.pull(h.surface, 'n1')
    expect(h.surface.post).not.toHaveBeenCalled()
    expect(h.removed.size).toBe(0)
  })

  it('leaves nothing pending when opening the new conversation fails', async () => {
    // RVM107W1C P2-4.
    const h = windowHarness()
    h.surfaces.active = undefined
    h.openConversation.mockReturnValueOnce({
      surfaceId: 'panel:new',
      opened: Promise.reject(new Error('focus failed')),
    })
    await expect(h.resources.show()).rejects.toThrow('focus failed')
    const target = fakeSurface('panel:new')
    h.resources.surfaceReady(target)
    h.resources.pull(target, 'n1')
    expect(sent(target)).toEqual(['resourceStatus'])
  })

  it('binds a new conversation open to its own surface, never to another that is ready first', async () => {
    const h = windowHarness()
    h.surfaces.active = undefined
    await h.resources.show()
    expect(h.openConversation).toHaveBeenCalledTimes(1)
    const other = fakeSurface('panel:other')
    h.resources.surfaceReady(other)
    h.resources.pull(other, 'x')
    expect(sent(other)).toEqual(['resourceStatus'])
    const target = fakeSurface('panel:new')
    h.resources.surfaceReady(target)
    h.resources.pull(target, 'y')
    expect(opens(target)).toEqual(['1@y'])
  })

  it('cancels the open when its target is disposed', async () => {
    const h = windowHarness()
    await h.resources.show()
    h.remove(h.surface)
    const replacement = fakeSurface(h.surface.id)
    h.resources.surfaceReady(replacement)
    h.resources.pull(replacement, 'n2')
    expect(opens(replacement)).toEqual([])
  })

  it('says the governor is off and offers its settings instead of an empty popover', async () => {
    const h = windowHarness(fakeStatus('normal', false))
    h.vscode.window.showInformationMessage.mockResolvedValueOnce(UI_TEXT.openSettings)
    await h.resources.show()
    expect(opens(h.surface)).toEqual([])
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

  it('sends a status beyond the message bound as refused, so the chip says unavailable', () => {
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
    expect(h.surfaces.broadcast.mock.calls).toEqual([[{ type: 'resourceStatus', status: null }]])
    expect(h.warn).toHaveBeenCalledWith(
      'Resource status exceeds the window message bound; sent as refused',
    )
    const ready = fakeSurface('panel:ready')
    h.resources.surfaceReady(ready)
    expect(ready.post).toHaveBeenCalledWith({ type: 'resourceStatus', status: null })
    expect(parseHostToWebviewMessage({ type: 'resourceStatus', status: null }).ok).toBe(true)
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
    expect(parseHostToWebviewMessage({ type: 'resourceOpen', seq: 1, nonce: 'n1' }).ok).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'resourcePull', nonce: 'n1' }).ok).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'resourceOpenAck', seq: 1, nonce: 'n1' }).ok).toBe(
      true,
    )
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
      { type: 'resourceOpen', seq: 1 },
      { type: 'resourceOpen', seq: 0, nonce: 'n1' },
      { type: 'resourceOpen', seq: 1, nonce: 'n'.repeat(RESOURCE_NONCE_MAX_CHARS + 1) },
    ]
    for (const message of refused) expect(parseHostToWebviewMessage(message).ok).toBe(false)
    for (const message of [
      { type: 'resourceAction', action: 'kill' },
      { type: 'resourceAction', action: 'resume', untilMs: 1 },
      { type: 'resourceAction' },
      { type: 'resourcePull' },
      { type: 'resourcePull', nonce: '' },
      { type: 'resourcePull', nonce: 'n1', seq: 1 },
      { type: 'resourceOpenAck', nonce: 'n1' },
      { type: 'resourceOpenAck', seq: 1.5, nonce: 'n1' },
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
