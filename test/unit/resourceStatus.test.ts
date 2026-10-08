import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window, StatusBarAlignment, ThemeColor } from 'vscode'
import {
  createResourceStatus,
  createVsCodeResourceStatusItem,
  type ResourceStatusAction,
  type ResourceStatusItem,
} from '../../src/host/resources/resourceStatus'
import { UI_TEXT, RESOURCE_GIB_BYTES } from '../../src/shared/constants'
import {
  resourceSettingsSchema,
  type ResourceLevel,
  type ResourceStatus,
} from '../../src/shared/resources'
import { fill, formatBytes, formatPercent, setUiText } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import type { ResourceSurfacePort } from '../../src/webview/resources/resourcePort'
import { FakeStatusBarItem } from './mocks/vscode'

function status(level: ResourceLevel = 'normal'): ResourceStatus {
  return {
    level,
    settings: resourceSettingsSchema.parse({}),
    sample: {
      atMs: 0,
      cpuPercent: 100,
      memoryUsedPercent: 100,
      memoryAvailableBytes: 0,
      memoryTotalBytes: RESOURCE_GIB_BYTES,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
    },
    queued: [{ kind: 'check', class: 'background', count: 2 }],
    overrideUntilMs: null,
  }
}

function harness(initial: unknown = status()) {
  let snapshot = initial
  let conversation: string | undefined = 'a'
  const listeners = new Set<() => void>()
  const port: ResourceSurfacePort = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    resume: vi.fn(),
    settings: vi.fn(),
    show: vi.fn(),
  }
  const item: ResourceStatusItem = {
    update: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }
  const notice = vi.fn<(text: string, actions: readonly ResourceStatusAction[]) => void>()
  const invalidStatus = vi.fn()
  const command = { dispose: vi.fn() }
  const registerShow = vi.fn<(run: () => void) => typeof command>(() => command)
  const deps = {
    port,
    createItem: () => item,
    conversationId: () => conversation,
    notice,
    invalidStatus,
    registerShow,
  }
  return {
    deps,
    item,
    port,
    notice,
    invalidStatus,
    command,
    listeners,
    publish: (next: unknown) => {
      snapshot = next
      for (const listener of listeners) listener()
    },
    conversation: (id: string | undefined) => {
      conversation = id
    },
  }
}

beforeEach(() => {
  setUiText(EN, 'en')
  vi.mocked(window.createStatusBarItem).mockReset()
})

describe('resource status surfaces', () => {
  it('creates no sampler and shows only non-normal enabled levels, warning at pause', () => {
    const h = harness()
    const handle = createResourceStatus(h.deps)
    expect(h.item.hide).toHaveBeenCalledOnce()
    expect(h.item.show).not.toHaveBeenCalled()
    for (const [level, label] of [
      ['throttle', UI_TEXT.resourceThrottle],
      ['relocate', UI_TEXT.resourceRelocate],
      ['pause', UI_TEXT.resourcePause],
    ] as const) {
      h.publish(status(level))
      expect(h.item.update).toHaveBeenLastCalledWith(
        `${UI_TEXT.resourceTitle}: ${label}`,
        level === 'pause',
      )
    }
    expect(h.item.show).toHaveBeenCalledTimes(3)
    h.publish({ ...status('pause'), settings: { ...status().settings, enabled: false } })
    expect(h.item.hide).toHaveBeenCalledTimes(2)
    expect(h.notice).toHaveBeenCalledOnce()
    h.publish(status())
    expect(h.item.hide).toHaveBeenCalledTimes(3)
    handle.dispose()
  })

  it('refuses invalid/private status and never passes canaries to an item or notice', () => {
    const h = harness({ ...status('pause'), pid: 1234, path: 'private-canary' })
    const handle = createResourceStatus(h.deps)
    expect(h.invalidStatus).toHaveBeenCalledOnce()
    expect(h.item.update).not.toHaveBeenCalled()
    expect(h.notice).not.toHaveBeenCalled()
    h.publish({ ...status('pause'), sample: { ...status().sample, command: 'private-canary' } })
    expect(h.invalidStatus).toHaveBeenCalledTimes(2)
    h.publish(status('throttle'))
    expect(h.item.show).toHaveBeenCalledOnce()
    handle.dispose()
  })

  it('notices pause once per conversation, includes reading, floor and waiting count, with all three actions', () => {
    const h = harness(status('pause'))
    const handle = createResourceStatus(h.deps)
    expect(h.notice).toHaveBeenCalledWith(
      expect.stringContaining(
        fill(UI_TEXT.resourcePauseNotice, {
          metric: UI_TEXT.resourceAvailableMemory,
          reading: formatBytes(0),
          threshold: formatBytes(RESOURCE_GIB_BYTES * 0.15),
        }),
      ),
      expect.any(Array),
    )
    expect(h.notice.mock.calls[0]?.[0]).toContain(`${UI_TEXT.resourceWaiting}: 2`)
    expect(h.notice.mock.calls[0]?.[0]).toContain('check / background: 2')
    h.publish(status('pause'))
    h.publish(status())
    h.publish(status('pause'))
    expect(h.notice).toHaveBeenCalledOnce()
    const actions = h.notice.mock.calls[0]?.[1] ?? []
    expect(actions.map((action) => action.label)).toEqual([
      UI_TEXT.resourceResumeNow,
      UI_TEXT.openSettings,
      UI_TEXT.resourceShow,
    ])
    for (const action of actions) action.run()
    expect(h.port.resume).toHaveBeenCalledOnce()
    expect(h.port.settings).toHaveBeenCalledOnce()
    expect(h.port.show).toHaveBeenCalledOnce()
    h.conversation('b')
    h.publish(status('pause'))
    expect(h.notice).toHaveBeenCalledTimes(2)
    h.conversation('a')
    h.publish(status('pause'))
    expect(h.notice).toHaveBeenCalledTimes(2)
    handle.dispose()
  })

  it('says relocation is not available yet only when the governor reports no route', () => {
    const h = harness()
    const handle = createResourceStatus(h.deps)
    const cases = [
      { relocation: 'noRoute', isExplained: true },
      { relocation: 'off', isExplained: false },
      { relocation: 'noTarget', isExplained: false },
      { relocation: 'available', isExplained: false },
      { relocation: undefined, isExplained: false },
    ] as const
    for (const row of cases) {
      h.conversation(String(row.relocation))
      h.publish({
        ...status('pause'),
        ...(row.relocation !== undefined && { relocation: row.relocation }),
      })
      expect(h.invalidStatus).not.toHaveBeenCalled()
      const text = h.notice.mock.calls.at(-1)?.[0]
      expect(text).toContain(UI_TEXT.resourceWaiting)
      expect(text?.endsWith(` ${UI_TEXT.resourceRelocationNoRoute}`)).toBe(row.isExplained)
      expect(text?.includes(UI_TEXT.resourceRelocationNoRoute)).toBe(row.isExplained)
    }
    expect(h.notice).toHaveBeenCalledTimes(cases.length)
    handle.dispose()
  })

  it('uses unknown honestly and names CPU, used memory, optional GPU and disk thresholds', () => {
    const h = harness()
    const handle = createResourceStatus(h.deps)
    const base = status('pause')
    h.publish({ ...base, sample: null })
    expect(h.notice.mock.calls.at(-1)?.[0]).toContain(UI_TEXT.resourceUnknown)
    const cases = [
      { key: 'cpuPercent', label: UI_TEXT.resourceCpu, settings: base.settings },
      { key: 'memoryUsedPercent', label: UI_TEXT.resourceMemory, settings: base.settings },
      {
        key: 'gpuPercent',
        label: UI_TEXT.resourceGpu,
        settings: { ...base.settings, gpuMaxPercent: 50 },
      },
      {
        key: 'diskBusyPercent',
        label: UI_TEXT.resourceDisk,
        settings: { ...base.settings, diskBusyMaxPercent: 50 },
      },
    ]
    for (const row of cases) {
      h.conversation(row.key)
      h.publish({
        ...base,
        settings: row.settings,
        sample: {
          ...base.sample,
          memoryAvailableBytes: RESOURCE_GIB_BYTES,
          memoryUsedPercent: 0,
          cpuPercent: 0,
          [row.key]: 100,
        },
      })
      expect(h.notice.mock.calls.at(-1)?.[0]).toContain(`${row.label} is ${formatPercent(100)}`)
    }
    handle.dispose()
  })

  it('never emits a pause notice without a conversation and reads the installed language at use', () => {
    const h = harness()
    h.conversation(undefined)
    const handle = createResourceStatus(h.deps)
    h.publish(status('pause'))
    expect(h.notice).not.toHaveBeenCalled()
    setUiText({ ...EN, resourceTitle: 'Ressourcen', resourcePause: 'Pausiert' }, 'de')
    h.publish(status('pause'))
    expect(h.item.update).toHaveBeenLastCalledWith('Ressourcen: Pausiert', true)
    handle.dispose()
  })

  it('registers Show resources directly, cleans up once and ignores retained callbacks after disposal', () => {
    const h = harness()
    const handle = createResourceStatus(h.deps)
    h.deps.registerShow.mock.calls[0]?.[0]()
    expect(h.port.show).toHaveBeenCalledOnce()
    const late = [...h.listeners][0]
    handle.dispose()
    handle.dispose()
    expect(h.listeners.size).toBe(0)
    expect(h.item.dispose).toHaveBeenCalledOnce()
    expect(h.command.dispose).toHaveBeenCalledOnce()
    h.publish(status('pause'))
    late?.()
    expect(h.notice).not.toHaveBeenCalled()
    expect(h.item.show).not.toHaveBeenCalled()
  })

  it('uses the real VS Code item behind the same injected source without recursive command dispatch', () => {
    const h = harness(status('pause'))
    const item = new FakeStatusBarItem()
    const disposed = vi.spyOn(item, 'dispose')
    vi.mocked(window.createStatusBarItem).mockReturnValue(item)
    const handle = createResourceStatus({
      ...h.deps,
      createItem: () => createVsCodeResourceStatusItem({ window, StatusBarAlignment, ThemeColor }),
    })
    expect(item.command).toBe('museSpark.showResources')
    expect(item.name).toBe(UI_TEXT.resourceTitle)
    expect(item.text).toContain(UI_TEXT.resourcePause)
    expect(item.tooltip).toBe(UI_TEXT.resourceShow)
    expect(item.backgroundColor?.id).toBe('statusBarItem.warningBackground')
    h.publish(status('throttle'))
    expect(item.backgroundColor).toBeUndefined()
    h.publish(status())
    expect(item.visible).toBe(false)
    handle.dispose()
    expect(item.visible).toBe(false)
    expect(disposed).toHaveBeenCalledOnce()
  })

  it.each(['JCEF', 'WebView2', 'SWT'])(
    'delivers status and controls through the fake %s native bridge',
    () => {
      const h = harness(status('relocate'))
      const handle = createResourceStatus(h.deps)
      expect(h.item.update).toHaveBeenCalledWith(
        `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourceRelocate}`,
        false,
      )
      h.publish(status('pause'))
      h.notice.mock.calls[0]?.[1][0]?.run()
      expect(h.port.resume).toHaveBeenCalledOnce()
      h.publish(status())
      expect(h.item.hide).toHaveBeenCalledOnce()
      handle.dispose()
    },
  )
})
