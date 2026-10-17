// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import { ChartFrame } from '../../src/webview/usage/charts/ChartFrame'
import { StackedColumns, groupedChart } from '../../src/webview/usage/charts/StackedColumns'
import { MirroredColumns } from '../../src/webview/usage/charts/MirroredColumns'
import { ShareBar } from '../../src/webview/usage/charts/ShareBar'
import { StepLines } from '../../src/webview/usage/charts/StepLines'
import { BurnLine } from '../../src/webview/usage/charts/BurnLine'
import { BreakdownTable } from '../../src/webview/usage/BreakdownTable'
import { KpiTiles } from '../../src/webview/usage/KpiTiles'
import {
  billedCost,
  costPlot,
  equivalentCost,
  knownSum,
  metricText,
  metricValue,
  money,
  percentOf,
  remainingUsd,
} from '../../src/webview/usage/display'
import { usageStateFor, usageTotals } from './helpers/usageFixtures'
import { MONEY_PERIOD_CASES } from './helpers/moneyPeriodCases'
import { formatPercent } from '../../src/shared/l10n/text'

function a(value: string) {
  return Usd.from(value).toAmount()
}

describe('usage charts', () => {
  it.each(MONEY_PERIOD_CASES)(
    'compares exact cost %s against %s as %s percent (RVM121B)',
    (current, previous, percent) => {
      const totals = usageTotals('reported')
      const previousTotals = usageTotals('reported')
      totals.costs[0]!.usd = a(current)
      previousTotals.costs[0]!.usd = a(previous)
      render(<KpiTiles totals={totals} previous={previousTotals} metric="cost" />)
      expect(
        screen.getByText(`${formatPercent(percent)} compared with the previous period`),
      ).toBeVisible()
    },
  )

  it.each([
    ['0.0000000001', '0.00000000001'],
    ['100000000000000000001', '100000000000000000000'],
  ])('sorts exact dollars %s and %s in both directions, with unknown last', (large, small) => {
    const rows = [large, small, undefined].map((amount, index) => ({
      id: ['a-large', 'z-small', 'a-unknown'][index]!,
      label: ['Large', 'Small', 'Unknown'][index]!,
      totals: {
        ...usageTotals('reported'),
        costs:
          amount === undefined
            ? []
            : [{ certainty: 'reported' as const, records: 1, usd: a(amount) }],
      },
    }))
    render(<BreakdownTable rows={rows} post={() => undefined} />)
    const labels = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getByRole('rowheader').textContent)
    fireEvent.click(screen.getByRole('button', { name: 'Cost: Sort Ascending' }))
    expect(labels()).toEqual(['Small', 'Large', 'Unknown'])
    fireEvent.click(screen.getByRole('button', { name: 'Cost: Sort Descending' }))
    expect(labels()).toEqual(['Large', 'Small', 'Unknown'])
  })

  it('has one keyboard tab stop, caption, summary, table and bucket description; arrows and Home/End visit each bucket', () => {
    const points = [0, 1, 2].map((index) => ({
      id: String(index),
      label: `day-${String(index)}`,
      values: [index * 10, undefined],
    }))
    const { container } = render(
      <ChartFrame
        title="Example"
        summary="Three days of costs"
        series={[
          { id: 'a', label: 'A', colour: 'blue' },
          { id: 'b', label: 'B', colour: 'purple' },
        ]}
        points={points}
        format={(value) => (value === undefined ? 'Unknown' : String(value))}
      >
        {() => <rect x={0} y={0} width={100} height={100} />}
      </ChartFrame>,
    )
    const chart = screen.getByRole('img', { name: 'Three days of costs' })
    expect(chart).toHaveAttribute('tabindex', '0')
    expect(container.querySelectorAll(':scope svg [tabindex]')).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('day-0: A: 0 and B: Unknown')
    for (const [key, expected] of [
      ['ArrowRight', 'day-1'],
      ['ArrowDown', 'day-2'],
      ['ArrowRight', 'day-2'],
      ['Home', 'day-0'],
      ['End', 'day-2'],
      ['ArrowLeft', 'day-1'],
      ['ArrowUp', 'day-0'],
    ]) {
      fireEvent.keyDown(chart, { key })
      expect(screen.getByRole('status')).toHaveTextContent(expected!)
    }
    expect(
      chart
        .getAttribute('aria-describedby')
        ?.split(' ')
        .every((id) => document.querySelector(`[id="${CSS.escape(id)}"]`) !== null),
    ).toBe(true)
    fireEvent.click(screen.getByText('Show Chart Data'))
    expect(screen.getByRole('table', { name: 'Example' })).toHaveTextContent('Unknown')
  })
  it.each(['cost', 'tokens', 'requests', 'time'] as const)(
    'agrees with service totals for generated %s buckets, with six groups and Other',
    (metric) => {
      for (let count = 1; count <= 100; count++) {
        const state = usageStateFor('nine-providers')
        state.query.metric = metric
        for (const row of state.breakdown) row.totals = usageTotals('reported', count)
        state.buckets[0]!.groups = state.breakdown
        const { points, series } = groupedChart(state)
        expect(series).toHaveLength(7)
        expect(series.at(-1)).toMatchObject({ label: 'Other', colour: 'other' })
        const expected = {
          // Cost geometry is whole nano-dollars (M121): $0.10 × count × 9.
          cost: count * 9 * 100_000_000,
          tokens: count * 1100 * 9,
          requests: 18,
          time: count * 10_000 * 9,
        }[metric]
        expect(knownSum(points[0]!.values)).toBeCloseTo(expected, 10)
      }
    },
  )
  it('keeps unknown tokens and costs absent, excludes reasoning and cache from token totals, and does not add plan equivalents to charges', () => {
    const totals = usageTotals('plan')
    totals.costs[0]!.usd = Usd.from('3').toAmount()
    totals.costs.push(
      { certainty: 'uncertain', records: 1, usd: Usd.from('2').toAmount() },
      { certainty: 'unpriced', records: 1, usd: Usd.from('0.3').toAmount() },
    )
    expect(billedCost(totals)).toBeUndefined()
    expect(equivalentCost(totals)).toBe('0.1')
    expect(metricValue(totals, 'tokens')).toBe(1100)
    totals.tokens.output = undefined
    expect(metricValue(totals, 'tokens')).toBeUndefined()
    expect(knownSum([undefined, undefined])).toBeUndefined()
    expect(billedCost(usageTotals('local'))).toBe('0')
  })
  it('computes budget shares, remainders and chart geometry from exact dollars (M121)', () => {
    // Binary floats made 0.57 of $1 read as 56.99…%.
    expect(percentOf(a('0.57'), a('1'))).toBe(57)
    expect(percentOf(a('1'), a('0'))).toBe(100)
    expect(remainingUsd(a('0.1'), a('0.3'))).toBe('0.2')
    expect(remainingUsd(a('2'), a('1'))).toBe('0')
    // Geometry is whole nano-dollars rounded up; its label reads back exactly.
    expect(costPlot(a('0.0000000001'))).toBe(1)
    expect(metricText(costPlot(a('0.125')), 'cost')).toBe('$0.13')
  })
  it.each(['0.0000000001', '0.00000000001'])(
    'labels one xAI tick (%s) exactly, never from plotted geometry (M121 P2-2)',
    (tick) => {
      const exact = money(a(tick))
      // Plotted geometry ceils both ticks to one nano-dollar and would label
      // each `$0.0000000010`: ten and a hundred times the actual charge.
      expect(exact).not.toBe('$0.0000000010')
      const tickTotals = () => ({
        ...usageTotals('reported', 1),
        costs: [{ certainty: 'reported' as const, records: 1, usd: a(tick) }],
      })
      const state = usageStateFor('one-provider')
      state.query.metric = 'cost'
      for (const row of [...state.breakdown, ...state.buckets[0]!.groups]) row.totals = tickTotals()
      state.buckets[0]!.totals = tickTotals()
      for (const Chart of [StackedColumns, ShareBar]) {
        const rendered = render(<Chart state={state} />)
        expect(screen.getByRole('status')).toHaveTextContent(exact)
        fireEvent.click(screen.getByText('Show Chart Data'))
        const table = screen.getByRole('table', { hidden: true })
        expect(table).toHaveTextContent(exact)
        expect(table).not.toHaveTextContent('$0.0000000010')
        rendered.unmount()
      }
      const budget = {
        ...usageStateFor().budgets[0]!,
        spentUsd: a(tick),
        projectedUsd: a(tick),
      }
      const burn = render(<BurnLine budget={budget} now={Date.now()} />)
      expect(screen.getByRole('status')).toHaveTextContent(exact)
      fireEvent.click(screen.getByText('Show Chart Data'))
      expect(screen.getByRole('table', { hidden: true })).toHaveTextContent(exact)
      expect(screen.getByRole('table', { hidden: true })).not.toHaveTextContent('$0.0000000010')
      burn.unmount()
      const table = render(<BreakdownTable rows={state.breakdown} post={() => undefined} />)
      expect(screen.getByRole('table')).toHaveTextContent(exact)
      table.unmount()
      const kpis = render(<KpiTiles totals={tickTotals()} previous={tickTotals()} metric="cost" />)
      expect(kpis.container.textContent).toContain(exact)
      expect(kpis.container.textContent).not.toContain('$0.0000000010')
      kpis.unmount()
    },
  )
  it.each([StackedColumns, MirroredColumns, ShareBar])(
    'renders SVG attributes without inline styles and preserves the numbers in its table',
    (Chart) => {
      const state = usageStateFor('nine-providers')
      const { container } = render(<Chart state={state} />)
      expect(container.querySelector('[style]')).toBeNull()
      expect(container.querySelector(':scope figure figcaption')).not.toBeNull()
      expect(screen.getByRole('img')).toHaveAttribute('aria-label')
      const table = screen.getByRole('table', { hidden: true })
      expect(within(table).getAllByRole('row', { hidden: true }).length).toBeGreaterThan(1)
    },
  )
  it.each([StackedColumns, MirroredColumns, ShareBar])(
    'gives every column/share series a distinct non-color pattern linked to this chart',
    (Chart) => {
      const { container } = render(<Chart state={usageStateFor('nine-providers')} />)
      const marks = [...container.querySelectorAll(':scope svg rect[class*="usage-series-"]')]
      expect(marks.length).toBeGreaterThan(0)
      const paths = new Map<string, string>()
      for (const mark of marks) {
        const fill = mark.getAttribute('fill')
        expect(fill).toMatch(/^url\(#.+\)$/)
        const patternId = fill!.slice('url(#'.length, -1)
        const pattern = document.querySelector(`[id="${CSS.escape(patternId)}"]`)
        expect(pattern?.tagName).toBe('pattern')
        expect(pattern?.closest('figure')).toBe(mark.closest('figure'))
        const colour = mark.getAttribute('class')!
        expect(pattern).toHaveAttribute('class', colour)
        paths.set(colour, pattern!.querySelector('path')!.getAttribute('d')!)
        expect(container.querySelector(`.usage-swatch.${colour}`)).not.toBeNull()
      }
      expect(new Set(paths.values()).size).toBe(paths.size)
    },
  )
  it('keeps pattern references unique when multiple charts share the document', () => {
    const state = usageStateFor('nine-providers')
    const { container } = render(
      <>
        <StackedColumns state={state} />
        <ShareBar state={state} />
      </>,
    )
    const ids = [...container.querySelectorAll('pattern')].map((pattern) => pattern.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('breaks step lines at a reset or unknown snapshot and preserves reported percentages above 100', () => {
    const snapshot = usageStateFor().limits[0]!
    const snapshots = [130, 20, undefined, 40].map((usedPercent, index) => ({
      ...snapshot,
      id: `s${String(index)}`,
      observedAt: snapshot.observedAt + index,
      windows: usedPercent === undefined ? [] : [{ ...snapshot.windows[0]!, usedPercent }],
    }))
    const { container } = render(<StepLines snapshots={snapshots} />)
    expect(container.querySelectorAll('polyline')).toHaveLength(3)
    for (const segment of container.querySelectorAll('polyline'))
      expect(segment.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(1)
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('130%')
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('Unknown')
    expect(container.querySelector('[style]')).toBeNull()
  })
  it('spaces provider-limit marks, step segments and keyboard selection by elapsed observation time', () => {
    const snapshot = usageStateFor().limits[0]!
    const snapshots = [60, 0, 1].map((minutes) => ({
      ...snapshot,
      id: `at-${String(minutes)}`,
      observedAt: snapshot.observedAt + minutes * 60_000,
      windows: [{ ...snapshot.windows[0]!, usedPercent: minutes + 10 }],
    }))
    const { container } = render(<StepLines snapshots={snapshots} />)
    const xs = [...container.querySelectorAll('circle')].map((mark) =>
      Number(mark.getAttribute('cx')),
    )
    expect(xs).toEqual([0, 100 / 60, 100])
    const coordinates = container.querySelector('polyline')!.getAttribute('points')!
    expect(coordinates.split(' ').map((pair) => Number(pair.split(',', 1)[0]))).toEqual([
      0,
      100 / 60,
      100 / 60,
      100,
      100,
    ])
    const active = container.querySelector('.usage-chart-active')!
    const chart = screen.getByRole('img')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(Number(active.getAttribute('x1'))).toBeCloseTo(100 / 60)
    expect(active.getAttribute('x2')).toBe(active.getAttribute('x1'))
    fireEvent.keyDown(chart, { key: 'End' })
    expect(active).toHaveAttribute('x1', '100')
    fireEvent.keyDown(chart, { key: 'Home' })
    expect(active).toHaveAttribute('x1', '0')
  })
  it('keeps coincident and single provider observations at the same finite time coordinate', () => {
    const snapshot = usageStateFor().limits[0]!
    const { container, rerender } = render(
      <StepLines snapshots={[snapshot, { ...snapshot, id: 'same-time' }]} />,
    )
    for (const mark of container.querySelectorAll('circle')) expect(mark).toHaveAttribute('cx', '0')
    fireEvent.keyDown(screen.getByRole('img'), { key: 'End' })
    expect(container.querySelector('.usage-chart-active')).toHaveAttribute('x1', '0')
    rerender(<StepLines snapshots={[snapshot]} />)
    expect(container.querySelector('circle')).toHaveAttribute('cx', '0')
    rerender(<StepLines snapshots={[]} />)
    expect(container.querySelector('circle')).toBeNull()
    expect(container.querySelector('.usage-chart-active')).toHaveAttribute('x1', '0')
    expect(container.querySelector('.usage-chart-active')).toHaveAttribute('x2', '0')
  })
  it('keeps cache and reasoning overlays inside their totals and draws no absent total', () => {
    const state = usageStateFor('one-provider')
    const { container, rerender } = render(<MirroredColumns state={state} />)
    expect(container.querySelector('rect.usage-series-blue')).toHaveAttribute('height', '50')
    expect(container.querySelector('rect.usage-series-purple')).toHaveAttribute('height', '5')
    expect(container.querySelector('rect.usage-series-green')).toHaveAttribute('height', '10')
    expect(container.querySelector('rect.usage-series-orange')).toHaveAttribute('height', '1.5')
    state.buckets[0]!.totals.tokens.input = undefined
    state.buckets[0]!.totals.tokens.reasoning = 200
    rerender(<MirroredColumns state={state} />)
    expect(container.querySelector('rect.usage-series-blue')).toBeNull()
    expect(container.querySelector('rect.usage-series-green')).toBeNull()
    expect(container.querySelector('rect.usage-series-orange')).toHaveAttribute('height', '50')
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('Unknown')
  })
  it('moves the visible column highlight with the keyboard bucket', () => {
    const state = usageStateFor('one-provider')
    state.buckets.push({ ...state.buckets[0]! })
    const { container } = render(<StackedColumns state={state} />)
    expect(container.querySelector('rect.usage-chart-active')).toHaveAttribute('x', '0')
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' })
    expect(container.querySelector('rect.usage-chart-active')).toHaveAttribute('x', '50')
  })
  it('shows full shares below a dollar, names each group once in the table, and keeps reserved-looking source ids distinct', () => {
    const state = usageStateFor('one-provider')
    state.breakdown[0]!.id = 'other'
    state.buckets[0]!.groups[0]!.id = 'other'
    const { container } = render(<ShareBar state={state} />)
    expect(container.querySelector(':scope svg rect.usage-series-blue')).toHaveAttribute(
      'width',
      '100',
    )
    const table = screen.getByRole('table', { hidden: true })
    expect(within(table).getAllByRole('columnheader', { hidden: true })).toHaveLength(2)
    expect(table).toHaveTextContent('$0.10')
    expect(table).not.toHaveTextContent('Unknown')
    const many = usageStateFor('nine-providers')
    for (const [index, row] of many.breakdown.entries()) {
      row.id = `z-provider-${String(index)}`
      many.buckets[0]!.groups[index]!.id = row.id
    }
    many.breakdown[0]!.id = 'other'
    many.buckets[0]!.groups[0]!.id = 'other'
    const chart = groupedChart(many)
    expect(new Set(chart.series.map((series) => series.id)).size).toBe(7)
    expect(knownSum(chart.points[0]!.values)).toBe(4_500_000_000)
  })
  it('shows projection only from the supplied budget source, with its cap and values in the table', () => {
    const budget = usageStateFor().budgets[0]!
    const { container, rerender } = render(<BurnLine budget={budget} now={Date.now()} />)
    expect(container.querySelector('.usage-projection')).not.toBeNull()
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('$2.50')
    rerender(<BurnLine budget={{ ...budget, projectedUsd: undefined }} now={Date.now()} />)
    expect(container.querySelector('.usage-projection')).toBeNull()
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('Unknown')
    rerender(<BurnLine budget={{ ...budget, capUsd: undefined }} now={Date.now()} />)
    expect(container.querySelector(':scope svg line.usage-series-orange')).toBeNull()
  })
})
