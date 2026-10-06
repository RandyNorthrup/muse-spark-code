/** @vitest-environment jsdom */
import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import axe from 'axe-core'
import { aggregateResources } from '../../src/core/usage/aggregate'
import { usageResourcesText } from '../../src/core/usage/usageText'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  formatBytes,
  formatNumber,
  formatPercent,
  formatUnit,
  setUiText,
} from '../../src/shared/l10n/text'
import { resourceHistoryEventName, resourceHistoryLevel } from '../../src/shared/resourceHistory'
import type { ResourceRecord } from '../../src/shared/resources'
import ResourcesSection from '../../src/webview/usage/ResourcesSection'
import { LazyResourcesSection } from '../../src/webview/usage/LazyResourcesSection'
import { historyRecords } from './helpers/resources/history'

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
