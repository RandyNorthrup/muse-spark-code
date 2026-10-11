import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { fill, formatDateTime } from '../../../shared/l10n/text'
import type { UsagePageState, UsageQuery } from '../../../shared/usagePage'
import { dayLabel, groupLabel, knownSum, metricLabel, metricText, metricValue } from '../display'
import {
  ChartFrame,
  ColumnBucket,
  CHART_PALETTE,
  type ChartPoint,
  type ChartSeries,
} from './ChartFrame'

/** Order is chosen once from the page breakdown; every group chart reuses it. */
export function groupedChart(state: UsagePageState): {
  readonly series: readonly ChartSeries[]
  readonly points: readonly ChartPoint[]
} {
  const rows = state.breakdown.toSorted((a, b) => a.id.localeCompare(b.id))
  const shown = rows.slice(0, CHART_PALETTE.length)
  const remaining = rows.slice(CHART_PALETTE.length)
  const series: ChartSeries[] = shown.map((row, index) => ({
    id: `group:${row.id}`,
    sourceId: row.id,
    label: row.label,
    colour: CHART_PALETTE[index] ?? 'other',
  }))
  if (remaining.length > 0) series.push({ id: 'other', label: USAGE_TEXT.other, colour: 'other' })
  const points = state.buckets.map((bucket, index) => ({
    id: String(index),
    label: state.query.range === 'today' ? formatDateTime(bucket.at) : dayLabel(bucket.day),
    values: series.map((item) =>
      item.sourceId === undefined
        ? knownSum(
            remaining.map((row) => {
              const group = bucket.groups.find((candidate) => candidate.id === row.id)
              return group === undefined ? undefined : metricValue(group.totals, state.query.metric)
            }),
          )
        : (() => {
            const row = bucket.groups.find((group) => group.id === item.sourceId)
            return row === undefined ? undefined : metricValue(row.totals, state.query.metric)
          })(),
    ),
  }))
  return { series, points }
}
export function chartSummary(query: UsageQuery, points: readonly ChartPoint[]): string {
  return fill(USAGE_TEXT.chartSummary, {
    metric: metricLabel(query.metric),
    from: points[0]?.label ?? USAGE_TEXT.unknown,
    to: points.at(-1)?.label ?? USAGE_TEXT.unknown,
    group: groupLabel(query.groupBy),
  })
}
export function StackedColumns({ state }: { readonly state: UsagePageState }) {
  const { series, points } = groupedChart(state)
  const max = Math.max(1, ...points.map((point) => knownSum(point.values) ?? 0))
  const width = 100 / Math.max(1, points.length)
  const title = {
    cost: USAGE_TEXT.chartCost,
    tokens: USAGE_TEXT.chartTokens,
    requests: USAGE_TEXT.chartRequests,
    time: USAGE_TEXT.chartTime,
  }[state.query.metric]
  return (
    <ChartFrame
      title={title}
      summary={chartSummary(state.query, points)}
      series={series}
      points={points}
      format={(value) => metricText(value, state.query.metric)}
    >
      {(active, pattern) =>
        points.map((point, index) => {
          let bottom = 100
          return (
            <ColumnBucket
              key={point.id}
              x={index * width}
              width={width}
              isActive={active === index}
            >
              {point.values.map((value, seriesIndex) => {
                if (value === undefined) return null
                const height = (value / max) * 100
                bottom -= height
                return (
                  <rect
                    key={series[seriesIndex]?.id}
                    className={`usage-series-${series[seriesIndex]?.colour ?? 'other'}`}
                    fill={pattern(series[seriesIndex]?.colour ?? 'other')}
                    x={index * width + width / (2 * 2)}
                    y={bottom}
                    width={width / 2}
                    height={height}
                  />
                )
              })}
            </ColumnBucket>
          )
        })
      }
    </ChartFrame>
  )
}
