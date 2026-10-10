/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import axe from 'axe-core'
import { aggregateResources } from '../../src/core/usage/aggregate'
import { resourceHistoryText } from '../../src/core/usage/resourceText'
import {
  UI_TEXT,
  RESOURCE_HISTORY_MAX_EVENTS,
  RESOURCE_HISTORY_MAX_EVENT_TOTALS,
  RESOURCE_HISTORY_MAX_MINUTES,
  RESOURCE_HISTORY_MAX_WORK_KINDS,
  RESOURCE_HISTORY_MINUTE_MS,
  RESOURCE_HISTORY_PAGE_SIZE,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUnit,
  setUiText,
} from '../../src/shared/l10n/text'
import {
  resourceHistoryDateTime,
  resourceHistoryEventName,
  resourceHistoryLevel,
  resourceHistorySchema,
} from '../../src/shared/resourceHistory'
import type { ResourceRecord } from '../../src/shared/resources'
import ResourcesSection from '../../src/webview/usage/ResourcesSection'
import { LazyResourcesSection } from '../../src/webview/usage/LazyResourcesSection'
import { historyRecords } from './helpers/resources/history'

// The terminal/ACP text renders the same aggregate the page receives.
const usageResourcesText = (records: readonly ResourceRecord[]) =>
  resourceHistoryText(aggregateResources(records))

beforeEach(() => {
  setUiText(EN, 'en')
})

it('property: chart readings/limits, level band, event totals and harness table agree with the journal', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const records = historyRecords(seed)
    const { container, unmount } = render(
      <ResourcesSection history={aggregateResources(records)} />,
    )
    const minutes = records
      .filter((record) => record.minute !== null)
      .toSorted((a, b) => a.atMs - b.atMs)
    const charts = screen.getAllByRole('img').filter((element) => element.tagName === 'svg')
    for (const [index, metric] of ['cpuPercent', 'memoryUsedPercent'].entries()) {
      const expected = minutes
        .map((record) =>
          metric === 'cpuPercent' ? record.minute?.cpuPercent : record.minute?.memoryUsedPercent,
        )
        .filter((value) => value !== null)
      expect(
        Array.from(
          charts[index]?.querySelectorAll<SVGPathElement>('[data-reading]') ?? [],
          (node) => Number(node.dataset['reading']),
        ),
      ).toEqual(expected)
      expect(
        Array.from(charts[index]?.querySelectorAll<SVGPathElement>('[data-limit]') ?? [], (node) =>
          Number(node.dataset['limit']),
        ),
      ).toEqual(
        minutes.map((record) =>
          metric === 'cpuPercent'
            ? record.minute?.thresholds.cpuMaxPercent
            : record.minute?.thresholds.memoryMaxPercent,
        ),
      )
    }
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>('[data-level]'),
        (node) => node.dataset['level'],
      ),
    ).toEqual(minutes.map((record) => record.minute?.level))
    const tally = screen.getByRole('table', { name: UI_TEXT.resourceHistoryCount })
    expect(within(tally).getByText(formatNumber(4))).toBeInTheDocument()
    expect(within(tally).getByText(seed % 2 === 0 ? 'check' : 'worker')).toBeInTheDocument()
    const work = screen.getByRole('table', { name: UI_TEXT.resourceHarness })
    expect(
      within(work).getByText(
        formatUnit(
          minutes.reduce((sum, record) => sum + (record.work[0]?.cpuSeconds ?? 0), 0),
          'second',
        ),
      ),
    ).toBeInTheDocument()
    expect(within(work).getByText(formatBytes(7000))).toBeInTheDocument()
    const readings = screen.getByRole('table', { name: UI_TEXT.resourceHistory })
    expect(within(readings).getAllByRole('row')).toHaveLength(minutes.length + 1)
    expect(within(readings).getAllByText(UI_TEXT.resourceUnknown).length).toBeGreaterThan(0)
    const text = usageResourcesText(records)
    for (const record of minutes) {
      const minute = record.minute
      if (minute === null) throw new Error('fixture missing')
      expect(text).toContain(resourceHistoryLevel(minute.level))
      expect(text).toContain(
        `${UI_TEXT.resourceCpu}: ${minute.cpuPercent === null ? UI_TEXT.resourceUnknown : formatPercent(minute.cpuPercent)} / ${formatPercent(minute.thresholds.cpuMaxPercent)}`,
      )
    }
    expect(text).toContain(`${UI_TEXT.resourceCpuTime}: ${formatUnit(seed * 4 + 12, 'second')}`)
    unmount()
  }
})

it('leaves chart and level gaps for unknown readings and missing minutes', () => {
  const history = aggregateResources(historyRecords())
  const { container } = render(<ResourcesSection history={history} />)
  const cpu = screen.getByRole('img', { name: UI_TEXT.resourceCpu })
  expect(
    Array.from(cpu.querySelectorAll('.usage-resource-reading'), (path) => path.getAttribute('d')),
  ).toEqual([
    'M 0 87 H 14.285714285714285',
    'M 57.14285714285714 83 H 71.42857142857143',
    'M 85.71428571428571 81 H 100',
  ])
  expect(
    Array.from(
      container.querySelectorAll<HTMLElement>('[data-level]'),
      (element) => element.style.width,
    ),
  ).toEqual(Array.from({ length: 4 }, () => '14.285714285714285%'))
})

it('joins adjacent known samples as step lines and applies each segment’s threshold', () => {
  const records = historyRecords().filter((record) => record.minute !== null)
  const first = records.at(-1)
  const second = records.at(-2)
  if (first?.minute == null || second?.minute == null) throw new Error('fixture missing')
  first.atMs = 0
  second.atMs = 5000
  second.minute.cpuPercent = 80
  second.minute.thresholds.cpuMaxPercent = 50
  render(<ResourcesSection history={aggregateResources([second, first])} />)
  const cpu = screen.getByRole('img', { name: UI_TEXT.resourceCpu })
  expect(cpu.querySelector('.usage-resource-reading')).toHaveAttribute(
    'd',
    'M 0 87 H 8.333333333333332 V 20',
  )
  expect(
    Array.from(
      cpu.querySelectorAll<SVGPathElement>('[data-limit]'),
      (path) => path.dataset['limit'],
    ),
  ).toEqual(['85', '50'])
})

it('renders all event details and preserves the same information in the text summary', () => {
  const events: ResourceRecord[] = [
    {
      type: 'resource',
      atMs: 0,
      minute: null,
      event: { type: 'levelChanged', atMs: 0, from: 'normal', to: 'pause', reason: 'critical' },
      work: [],
    },
    {
      type: 'resource',
      atMs: 1,
      minute: null,
      event: {
        type: 'relocated',
        atMs: 1,
        kind: 'check',
        level: 'relocate',
        reason: 'machineBusy',
      },
      work: [],
    },
    {
      type: 'resource',
      atMs: 2,
      minute: null,
      event: { type: 'paused', atMs: 2, kind: 'other' },
      work: [],
    },
    {
      type: 'resource',
      atMs: 3,
      minute: null,
      event: { type: 'override', atMs: 3, untilMs: 900_000 },
      work: [],
    },
  ]
  render(<ResourcesSection history={aggregateResources(events)} />)
  const table = screen.getByRole('table', { name: UI_TEXT.resourceHistoryEvents })
  const text = usageResourcesText(events)
  for (const record of events) {
    if (record.event === null) throw new Error('fixture missing')
    const label = resourceHistoryEventName(record.event.type)
    expect(table.textContent).toContain(label)
    expect(text).toContain(label)
  }
  expect(table.textContent).toContain('critical')
  expect(text).toContain('critical')
})

it('reads the installed locale at render and summary time, including Intl values', () => {
  const history = historyRecords()
  setUiText(
    {
      ...EN,
      resourceTitle: 'Ressourcen',
      resourceHistoryDeferred: 'Zurückgestellt',
      resourceCpu: 'CPU-Nutzung',
    },
    'de',
  )
  render(<ResourcesSection history={aggregateResources(history)} />)
  expect(screen.getByRole('heading', { name: 'Ressourcen' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'CPU-Nutzung' })).toBeInTheDocument()
  expect(usageResourcesText(history)).toContain('Zurückgestellt (worker): 4')
  expect(screen.getByRole('table', { name: UI_TEXT.resourceHarness })).toHaveTextContent(
    formatBytes(7000),
  )
})

it('rejects private and invalid bridge payloads and reports empty history explicitly', () => {
  const view = render(<ResourcesSection history={{ ...aggregateResources([]), pid: 1234 }} />)
  expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.resourceHistoryInvalid)
  expect(view.container.textContent).not.toContain('1234')
  view.rerender(
    <ResourcesSection history={{ ...aggregateResources([]), minutes: historyRecords() }} />,
  )
  expect(screen.getByRole('alert')).toBeInTheDocument()
  view.rerender(<ResourcesSection history={aggregateResources([])} />)
  expect(screen.getByText(UI_TEXT.resourceHistoryEmpty)).toBeInTheDocument()
  expect(screen.queryByRole('table')).toBeNull()
  expect(usageResourcesText([])).toContain(UI_TEXT.resourceHistoryEmpty)
})

it('refuses unrepresentable and non-finite minute timestamps, event times and override deadlines', () => {
  const view = render(<ResourcesSection history={aggregateResources([])} />)
  for (const value of [Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001, Infinity, -Infinity, NaN]) {
    expect(() => resourceHistoryDateTime(value)).toThrow()
    const minute = historyRecords().find((record) => record.minute !== null)
    if (minute === undefined) throw new Error('fixture missing')
    const event: ResourceRecord = {
      type: 'resource',
      atMs: 0,
      minute: null,
      event: { type: 'override', atMs: 0, untilMs: 900_000 },
      work: [],
    }
    if (event.event?.type !== 'override') throw new Error('fixture missing')
    for (const records of [
      [{ ...minute, atMs: value }],
      [{ ...event, atMs: value }],
      [{ ...event, event: { ...event.event, atMs: value } }],
      [{ ...event, event: { ...event.event, untilMs: value } }],
    ]) {
      expect(() => aggregateResources(records)).toThrow()
      expect(() => usageResourcesText(records)).toThrow()
    }
    const valid = aggregateResources([minute, event])
    for (const history of [
      { ...valid, minutes: [{ ...minute, atMs: value }] },
      { ...valid, events: [{ ...event.event, atMs: value }] },
      { ...valid, events: [{ ...event.event, untilMs: value }] },
    ]) {
      expect(resourceHistorySchema.safeParse(history).success).toBe(false)
      view.rerender(<ResourcesSection history={history} />)
      expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.resourceHistoryInvalid)
      expect(screen.queryByRole('table')).toBeNull()
    }
  }
})

it('formats the maximum supported history date consistently in the view and text summary', () => {
  const minute = historyRecords().find((record) => record.minute !== null)
  if (minute === undefined) throw new Error('fixture missing')
  const atMs = 8_640_000_000_000_000
  const records: ResourceRecord[] = [
    { ...minute, atMs },
    {
      type: 'resource',
      atMs,
      minute: null,
      event: { type: 'override', atMs, untilMs: atMs },
      work: [],
    },
  ]
  render(<ResourcesSection history={aggregateResources(records)} />)
  expect(screen.getByRole('table', { name: UI_TEXT.resourceHistory })).toHaveTextContent(
    formatDateTime(atMs),
  )
  expect(screen.getByRole('table', { name: UI_TEXT.resourceHistoryEvents })).toHaveTextContent(
    formatDateTime(atMs),
  )
  expect(usageResourcesText(records)).toContain(formatDateTime(atMs))
})

it('rejects bridge lists exceeding the named minute, event, count and work bounds', () => {
  const history = aggregateResources(historyRecords())
  const minute = history.minutes[0]
  const event = history.events[0]
  const count = history.counts[0]
  const work = history.work[0]
  if (!minute || !event || !count || !work) throw new Error('fixture missing')
  const view = render(<ResourcesSection history={history} />)
  for (const raw of [
    { ...history, minutes: Array.from({ length: RESOURCE_HISTORY_MAX_MINUTES + 1 }, () => minute) },
    { ...history, events: Array.from({ length: RESOURCE_HISTORY_MAX_EVENTS + 1 }, () => event) },
    {
      ...history,
      counts: Array.from({ length: RESOURCE_HISTORY_MAX_EVENT_TOTALS + 1 }, () => count),
    },
    { ...history, work: Array.from({ length: RESOURCE_HISTORY_MAX_WORK_KINDS + 1 }, () => work) },
  ]) {
    expect(resourceHistorySchema.safeParse(raw).success).toBe(false)
    view.rerender(<ResourcesSection history={raw} />)
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.resourceHistoryInvalid)
    expect(screen.queryByRole('table')).toBeNull()
  }
})

it('pages a full week of minutes and large event detail without rendering unbounded rows or chart paths', () => {
  const minute = historyRecords().find((record) => record.minute !== null)
  if (minute === undefined) throw new Error('fixture missing')
  const minutes = Array.from({ length: RESOURCE_HISTORY_MAX_MINUTES }, (_, index) => ({
    ...minute,
    atMs: index * RESOURCE_HISTORY_MINUTE_MS,
  }))
  const events: ResourceRecord[] = Array.from(
    { length: RESOURCE_HISTORY_PAGE_SIZE + 2 },
    (_, atMs) => ({
      type: 'resource',
      atMs,
      minute: null,
      work: [],
      event: { type: 'paused', atMs, kind: 'check' },
    }),
  )
  const history = aggregateResources([...minutes, ...events])
  const view = render(<ResourcesSection history={history} />)
  expect(view.container.querySelectorAll('[data-level]').length).toBe(RESOURCE_HISTORY_PAGE_SIZE)
  expect(view.container.querySelector(':scope tbody')?.children.length).toBe(
    RESOURCE_HISTORY_PAGE_SIZE,
  )
  const readings = () => screen.getByRole('table', { name: UI_TEXT.resourceHistory })
  const eventTable = () => screen.getByRole('table', { name: UI_TEXT.resourceHistoryEvents })
  const rows = (table: HTMLElement) => within(table).getAllByRole('row')
  const minuteNav = screen.getByRole('navigation', { name: UI_TEXT.resourceHistory })
  const eventNav = screen.getByRole('navigation', { name: UI_TEXT.resourceHistoryEvents })
  expect(rows(readings())).toHaveLength(RESOURCE_HISTORY_PAGE_SIZE + 1)
  expect(rows(eventTable())).toHaveLength(RESOURCE_HISTORY_PAGE_SIZE + 1)
  expect(rows(readings())[1]).toHaveTextContent(
    formatDateTime(
      (RESOURCE_HISTORY_MAX_MINUTES - RESOURCE_HISTORY_PAGE_SIZE) * RESOURCE_HISTORY_MINUTE_MS,
    ),
  )
  expect(view.container.querySelectorAll(':scope svg path')).toHaveLength(
    RESOURCE_HISTORY_PAGE_SIZE * 4,
  )
  expect(view.container.querySelectorAll('[data-level]')).toHaveLength(RESOURCE_HISTORY_PAGE_SIZE)
  expect(
    within(minuteNav).getByRole('button', { name: UI_TEXT.resourceHistoryNewer }),
  ).toBeDisabled()
  fireEvent.click(within(minuteNav).getByRole('button', { name: UI_TEXT.resourceHistoryOlder }))
  expect(rows(readings())).toHaveLength(RESOURCE_HISTORY_PAGE_SIZE + 1)
  expect(rows(readings())[1]).toHaveTextContent(
    formatDateTime(
      (RESOURCE_HISTORY_MAX_MINUTES - RESOURCE_HISTORY_PAGE_SIZE * 2) * RESOURCE_HISTORY_MINUTE_MS,
    ),
  )
  expect(rows(eventTable())).toHaveLength(RESOURCE_HISTORY_PAGE_SIZE + 1)
  fireEvent.click(within(eventNav).getByRole('button', { name: UI_TEXT.resourceHistoryOlder }))
  expect(rows(eventTable())).toHaveLength(3)
  expect(
    within(eventNav).getByRole('button', { name: UI_TEXT.resourceHistoryOlder }),
  ).toBeDisabled()
  expect(screen.getByRole('table', { name: UI_TEXT.resourceHistoryCount })).toHaveTextContent(
    formatNumber(events.length),
  )
  expect(screen.getByRole('table', { name: UI_TEXT.resourceHarness })).toHaveTextContent(
    formatUnit(history.work[0]?.cpuSeconds ?? 0, 'second'),
  )
  fireEvent.click(within(minuteNav).getByRole('button', { name: UI_TEXT.resourceHistoryNewer }))
  expect(rows(readings())[1]).toHaveTextContent(
    formatDateTime(
      (RESOURCE_HISTORY_MAX_MINUTES - RESOURCE_HISTORY_PAGE_SIZE) * RESOURCE_HISTORY_MINUTE_MS,
    ),
  )
  view.rerender(<ResourcesSection history={aggregateResources(historyRecords())} />)
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(rows(readings())).toHaveLength(5)
  expect(rows(eventTable())).toHaveLength(5)
})

it('clips an older chart page at the next hidden threshold segment within the same minute', () => {
  const record = historyRecords().find((row) => row.minute !== null)
  if (record?.minute == null) throw new Error('fixture missing')
  const minute = record.minute
  const records = Array.from({ length: RESOURCE_HISTORY_PAGE_SIZE + 2 }, (_, index) => ({
    ...record,
    atMs: index * 100,
    minute: { ...minute, cpuPercent: index },
  }))
  const { container } = render(<ResourcesSection history={aggregateResources(records)} />)
  const navigation = screen.getByRole('navigation', { name: UI_TEXT.resourceHistory })
  fireEvent.click(within(navigation).getByRole('button', { name: UI_TEXT.resourceHistoryOlder }))
  const chart = screen.getByRole('img', { name: UI_TEXT.resourceCpu })
  expect(chart.querySelector('[data-reading]')).toHaveAttribute('d', 'M 0 100 H 50 V 99')
  expect(
    Array.from(container.querySelectorAll<HTMLElement>('[data-level]'), (node) => node.style.width),
  ).toEqual(['50%', '50%'])
})

it('loads the real section through its lazy boundary', async () => {
  await act(async () => {
    render(<LazyResourcesSection history={aggregateResources(historyRecords())} />)
    await Promise.resolve()
  })
  expect(await screen.findByRole('table', { name: UI_TEXT.resourceHarness })).toBeInTheDocument()
})

it('provides accessible charts and data tables', async () => {
  const { container } = render(<ResourcesSection history={aggregateResources(historyRecords())} />)
  for (const label of [
    UI_TEXT.resourceHistory,
    UI_TEXT.resourceHistoryEvents,
    UI_TEXT.resourceHarness,
  ])
    expect(screen.getByRole('region', { name: label })).toHaveAttribute('tabindex', '0')
  // jsdom has no layout/canvas; the rig browser drill checks four themes and 320 px.
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(result.violations).toEqual([])
})
