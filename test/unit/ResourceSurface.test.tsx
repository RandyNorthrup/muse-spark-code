// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT, RESOURCE_GIB_BYTES, RESOURCE_OVERRIDE_MS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  fill,
  formatBytes,
  formatDateTime,
  formatPercent,
  setUiText,
} from '../../src/shared/l10n/text'
import {
  resourceSettingsSchema,
  resourceStatusSchema,
  resourceSampleSchema,
  type ResourceLevel,
  type ResourceStatus,
} from '../../src/shared/resources'
import { App } from '../../src/webview/App'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceEvents } from '../../src/core/resources/events'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'
import { ResourceSurface } from '../../src/webview/resources/ResourceSurface'
import {
  ResourceTaskRow,
  type ResourceTaskRowProps,
} from '../../src/webview/resources/ResourceTaskRow'
import {
  createResourceSurfaceLoader,
  type ResourceSurfacePort,
} from '../../src/webview/resources/resourcePort'
import { testSettings } from './helpers/fakes'

function fixture(level: ResourceLevel = 'normal') {
  let snapshot: unknown = {
    level,
    sample: {
      atMs: 0,
      cpuPercent: 0,
      memoryUsedPercent: null,
      memoryAvailableBytes: RESOURCE_GIB_BYTES,
      memoryTotalBytes: RESOURCE_GIB_BYTES * 2,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
    },
    settings: resourceSettingsSchema.parse({}),
    queued: [],
    overrideUntilMs: null,
  } satisfies ResourceStatus
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
  return {
    port,
    listeners,
    publish: (next: unknown) => {
      act(() => {
        snapshot = next
        for (const listener of listeners) listener()
      })
    },
    current: () => resourceStatusSchema.parse(snapshot),
  }
}

beforeEach(() => {
  setUiText(EN, 'en')
})

describe('resource chip and popover', () => {
  it('renders the real governor pause, resume override and fresh expiry through the injected port', async () => {
    const h = fixture()
    const clock = new FakeResourceClock()
    const critical = resourceSampleSchema.parse({ ...h.current().sample, memoryAvailableBytes: 0 })
    const events = new ResourceEvents(vi.fn())
    const governor = new ResourceGovernor({
      clock,
      events,
      settings: resourceSettingsSchema.parse({}),
      sampler: new ScriptedResourceSampler([critical, { ...critical, atMs: RESOURCE_OVERRIDE_MS }]),
      hasRelocationTarget: () => false,
      onError: vi.fn(),
    })
    h.port.resume = () => {
      governor.resumeNow()
    }
    const detach = events.subscribe(() => {
      h.publish(governor.status([]))
    })
    render(<ResourceSurface port={h.port} />)
    await act(async () => {
      await governor.refresh()
    })
    expect(
      screen.getByRole('button', { name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}` }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.resourceResumeNow }))
    expect(
      screen.getByRole('button', { name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourceNormal}` }),
    ).toBeInTheDocument()
    expect(h.current().overrideUntilMs).toBe(RESOURCE_OVERRIDE_MS)
    await act(async () => {
      clock.advance(RESOURCE_OVERRIDE_MS)
      await governor.refresh()
    })
    expect(
      screen.getByRole('button', { name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}` }),
    ).toBeInTheDocument()
    detach()
    governor.dispose()
  })

  it('renders repeated schema-valid queue rows without duplicate-key errors or dropped counts', () => {
    const h = fixture('pause')
    h.publish({
      ...h.current(),
      queued: [
        { kind: 'check', class: 'background', count: 1 },
        { kind: 'check', class: 'background', count: 2 },
      ],
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      // Record React's duplicate-key warning without printing it; the assertion must reject it.
    })
    try {
      render(<ResourceSurface port={h.port} />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getAllByText(/check \/ background/)).toHaveLength(2)
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
  it('shows each level, unknown versus real zero, thresholds and the size-capped memory floor', () => {
    const h = fixture()
    render(<ResourceSurface port={h.port} />)
    const chip = screen.getByRole('button', {
      name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourceNormal}`,
    })
    fireEvent.click(chip)
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.resourceTitle })
    expect(
      within(dialog).getByText(`${formatPercent(0)} / ${formatPercent(85)}`),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(`${UI_TEXT.resourceUnknown} / ${formatPercent(90)}`),
    ).toHaveAttribute('title', UI_TEXT.resourceUnavailable)
    expect(
      within(dialog).getByText(
        `${formatBytes(RESOURCE_GIB_BYTES)} / ${formatBytes(RESOURCE_GIB_BYTES * 2 * 0.15)}`,
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(UI_TEXT.resourceGpu)).toBeNull()
    expect(within(dialog).queryByText(UI_TEXT.resourceDisk)).toBeNull()
    expect(within(dialog).queryByText(UI_TEXT.resourceWaiting)).toBeNull()
    for (const [level, label] of [
      ['throttle', UI_TEXT.resourceThrottle],
      ['relocate', UI_TEXT.resourceRelocate],
      ['pause', UI_TEXT.resourcePause],
    ] as const) {
      h.publish({ ...h.current(), level })
      expect(chip).toHaveTextContent(label)
      expect(chip.parentElement).toHaveAttribute('data-resource-level', level)
    }
  })

  it('explains a governor with no relocation route in the popover, and nothing for other states', () => {
    const h = fixture()
    const governor = new ResourceGovernor({
      clock: new FakeResourceClock(),
      events: new ResourceEvents(vi.fn()),
      settings: resourceSettingsSchema.parse({ relocate: 'ask' }),
      sampler: new ScriptedResourceSampler([]),
      hasRelocationTarget: null,
      onError: vi.fn(),
    })
    h.publish(governor.status([]))
    render(<ResourceSurface port={h.port} />)
    fireEvent.click(screen.getByRole('button'))
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.resourceTitle })
    expect(within(dialog).getByText(UI_TEXT.resourceRelocationNoRoute)).toBeInTheDocument()
    for (const relocation of ['off', 'available', 'noTarget', undefined] as const) {
      h.publish({ ...h.current(), relocation })
      expect(within(dialog).queryByText(UI_TEXT.resourceRelocationNoRoute)).toBeNull()
    }
    governor.dispose()
  })

  it('reports optional enabled metrics and null samples as unknown, queue counts and an override expiry', () => {
    const h = fixture('pause')
    h.publish({
      ...h.current(),
      sample: null,
      settings: { ...h.current().settings, gpuMaxPercent: 50, diskBusyMaxPercent: 50 },
      queued: [{ kind: 'check', class: 'foreground', count: 2 }],
      overrideUntilMs: RESOURCE_OVERRIDE_MS,
    })
    render(<ResourceSurface port={h.port} />)
    fireEvent.click(
      screen.getByRole('button', { name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}` }),
    )
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getAllByText(`${UI_TEXT.resourceUnknown} / ${formatPercent(50)}`),
    ).toHaveLength(2)
    expect(
      within(dialog).getByText(`${UI_TEXT.resourceUnknown} / ${UI_TEXT.resourceUnknown}`),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(UI_TEXT.resourceWaiting)).toBeInTheDocument()
    expect(within(dialog).getByText(/check \/ foreground/).parentElement).toHaveTextContent('2')
    expect(
      within(dialog).getByText(
        fill(UI_TEXT.resourceOverrideNotice, { time: formatDateTime(RESOURCE_OVERRIDE_MS) }),
      ),
    ).toBeInTheDocument()
  })

  it('invokes all three actions directly and restores focus on Close and Escape', () => {
    const h = fixture('pause')
    render(<ResourceSurface port={h.port} />)
    const chip = screen.getByRole('button')
    for (const label of [
      UI_TEXT.resourceResumeNow,
      UI_TEXT.openSettings,
      UI_TEXT.resourceShow,
      UI_TEXT.usageClose,
    ]) {
      fireEvent.click(chip)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: UI_TEXT.usageClose }))
      expect(chip).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(chip)
    }
    expect(h.port.resume).toHaveBeenCalledOnce()
    expect(h.port.settings).toHaveBeenCalledOnce()
    expect(h.port.show).toHaveBeenCalledOnce()
    fireEvent.click(chip)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(chip)
  })

  it('closes on focus leaving, keeps internal focus, and hides controls behind other modals', () => {
    const h = fixture()
    const view = render(<ResourceSurface port={h.port} />)
    const chip = screen.getByRole('button')
    fireEvent.click(chip)
    fireEvent.blur(screen.getByRole('dialog'), {
      relatedTarget: screen.getByRole('button', { name: UI_TEXT.resourceResumeNow }),
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    view.rerender(<ResourceSurface port={h.port} isInert />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(chip.parentElement).toHaveAttribute('inert')
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    view.rerender(<ResourceSurface port={h.port} />)
    fireEvent.blur(screen.getByRole('dialog'), { relatedTarget: document.body })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rejects private or malformed snapshots, hides explicit OFF and unsubscribes on unmount', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const h = fixture()
    const view = render(<ResourceSurface port={h.port} />)
    h.publish({ ...h.current(), pid: 123, path: 'canary' })
    expect(screen.queryByRole('button')).toBeNull()
    h.publish({ level: 'pause' })
    expect(screen.queryByRole('button')).toBeNull()
    h.publish({
      level: 'normal',
      settings: { ...resourceSettingsSchema.parse({}), enabled: false },
      sample: null,
      queued: [],
      overrideUntilMs: null,
    })
    expect(screen.queryByRole('button')).toBeNull()
    view.unmount()
    expect(h.listeners.size).toBe(0)
    expect(disconnect).toHaveBeenCalledOnce()
    disconnect.mockRestore()
  })

  it('reads installed translations at render and works without a heartbeat on a companion page', () => {
    const h = fixture('throttle')
    setUiText({ ...EN, resourceTitle: 'Ressourcen', resourceThrottle: 'Gedrosselt' }, 'de')
    render(<ResourceSurface port={h.port} />)
    expect(screen.getByRole('button', { name: 'Ressourcen: Gedrosselt' })).toBeInTheDocument()
  })

  it('mounts beside only its own heartbeat and follows its retirement without losing the chip', async () => {
    const h = fixture()
    const subscribe = vi.spyOn(h.port, 'subscribe')
    const otherApp = (
      <div className="app" data-testid="other">
        <ul>
          <li className="status-line">
            <canvas className="heartbeat-trace" />
          </li>
        </ul>
      </div>
    )
    const view = render(
      <>
        {otherApp}
        <div className="app" data-testid="own">
          <ul>
            <li className="status-line" data-testid="heartbeat">
              <canvas className="heartbeat-trace" />
            </li>
          </ul>
          <ResourceSurface port={h.port} />
        </div>
      </>,
    )
    await waitFor(() => {
      expect(within(screen.getByTestId('heartbeat')).getByRole('button')).toBeInTheDocument()
    })
    expect(within(screen.getByTestId('other')).queryByRole('button')).toBeNull()
    fireEvent.click(within(screen.getByTestId('heartbeat')).getByRole('button'))
    view.rerender(
      <>
        {otherApp}
        <div className="app" data-testid="own">
          <ul />
          <ResourceSurface port={h.port} />
        </div>
      </>,
    )
    await waitFor(() => {
      expect(
        within(screen.getByTestId('own')).getByRole('button', {
          name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourceNormal}`,
        }),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: UI_TEXT.usageClose }))
    })
    expect(subscribe).toHaveBeenCalledOnce()
  })

  it('loads the App surface only when injected and cannot reopen after a late load on unmount', async () => {
    const h = fixture()
    const pending = Promise.withResolvers<{ default: typeof ResourceSurface }>()
    const load = vi.fn(() => pending.promise)
    const resources = createResourceSurfaceLoader(h.port, load)
    const view = render(<App postMessage={vi.fn()} />)
    expect(load).not.toHaveBeenCalled()
    view.rerender(<App postMessage={vi.fn()} resources={resources} />)
    expect(load).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'init',
            settings: testSettings,
            emptyStateHint: '',
            composerPlaceholder: '',
          },
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'authState', status: 'signedIn' } }),
      )
    })
    await waitFor(() => {
      expect(load).toHaveBeenCalledOnce()
    })
    expect(screen.queryByText(UI_TEXT.resourceTitle)).toBeNull()
    view.unmount()
    await act(async () => {
      pending.resolve({ default: ResourceSurface })
      await pending.promise
    })
    expect(screen.queryByText(UI_TEXT.resourceTitle)).toBeNull()
    expect(h.listeners.size).toBe(0)
  })
})

function task(overrides: Partial<ResourceTaskRowProps> = {}) {
  const runNow = vi.fn()
  const move = vi.fn()
  const keepHere = vi.fn()
  const props: ResourceTaskRowProps = {
    kind: 'check',
    workClass: 'foreground',
    phase: 'queued',
    runNow,
    target: { name: 'Mac mini', move, keepHere },
    ...overrides,
  }
  return { props, runNow, move, keepHere }
}

describe('resource Traffic/task row', () => {
  it('names the pending device and reason without claiming a completed move, and dispatches controls', () => {
    const h = task()
    render(<ResourceTaskRow {...h.props} />)
    expect(screen.getByText(UI_TEXT.resourceWaiting)).toBeInTheDocument()
    expect(screen.getByText('Mac mini')).toBeInTheDocument()
    expect(
      screen.queryByText(fill(UI_TEXT.resourceRelocatedNotice, { device: 'Mac mini' })),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.resourceRunNow }))
    fireEvent.click(
      screen.getByRole('button', { name: fill(UI_TEXT.resourceMoveTo, { device: 'Mac mini' }) }),
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.resourceKeepHere }))
    expect(h.runNow).toHaveBeenCalledOnce()
    expect(h.move).toHaveBeenCalledOnce()
    expect(h.keepHere).toHaveBeenCalledOnce()
  })

  it('removes controls after admission and never offers Run now to background or already-running work', () => {
    const h = task()
    const view = render(<ResourceTaskRow {...h.props} phase="admitted" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(
      screen.getByText(fill(UI_TEXT.resourceRelocatedNotice, { device: 'Mac mini' })),
    ).toBeInTheDocument()
    view.rerender(<ResourceTaskRow {...h.props} workClass="background" />)
    expect(screen.queryByRole('button', { name: UI_TEXT.resourceRunNow })).toBeNull()
    view.rerender(<ResourceTaskRow {...h.props} phase="running" />)
    expect(screen.queryByRole('button', { name: UI_TEXT.resourceRunNow })).toBeNull()
    expect(screen.getByRole('button', { name: UI_TEXT.resourceKeepHere })).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.resourceWaiting)).toBeInTheDocument()
  })

  it('limits relocation to queued workers and checks with an injected target; a running worker never moves', () => {
    const h = task()
    const view = render(<ResourceTaskRow {...h.props} kind="worker" />)
    expect(screen.getByRole('button', { name: UI_TEXT.resourceKeepHere })).toBeInTheDocument()
    view.rerender(<ResourceTaskRow {...h.props} kind="worker" phase="running" />)
    expect(screen.queryByRole('button', { name: UI_TEXT.resourceKeepHere })).toBeNull()
    for (const kind of [
      'toolShell',
      'backgroundTask',
      'mcpServer',
      'subagent',
      'bestOfN',
      'schedule',
      'browserCheck',
      'hook',
      'museServe',
      'other',
    ] as const) {
      view.rerender(<ResourceTaskRow {...h.props} kind={kind} />)
      expect(screen.queryByRole('button', { name: UI_TEXT.resourceKeepHere })).toBeNull()
    }
    const { target: _target, runNow: _runNow, ...noControls } = h.props
    view.rerender(<ResourceTaskRow {...noControls} />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<ResourceTaskRow {...noControls} phase="admitted" />)
    expect(screen.queryByText(UI_TEXT.resourceWaiting)).toBeNull()
  })
})
