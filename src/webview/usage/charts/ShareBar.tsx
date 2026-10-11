import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { fill } from '../../../shared/l10n/text'
import type { UsagePageState } from '../../../shared/usagePage'
import { groupLabel, knownSum, metricLabel, metricText, metricValue } from '../display'
import { ChartFrame, CHART_PALETTE } from './ChartFrame'
import { chartSummary, groupedChart } from './StackedColumns'

export function ShareBar({ state }: { readonly state: UsagePageState }) {
  const { series: groups, points: buckets } = groupedChart(state)
  const points = groups.map((item) => ({
    id: item.id,
    label: item.label,
    values: [
      item.sourceId === undefined
        ? knownSum(
            state.breakdown
              .toSorted((a, b) => a.id.localeCompare(b.id))
              .slice(CHART_PALETTE.length)
              .map((row) => metricValue(row.totals, state.query.metric)),
          )
        : (() => {
            const row = state.breakdown.find((group) => group.id === item.sourceId)
            return row === undefined ? undefined : metricValue(row.totals, state.query.metric)
          })(),
    ],
  }))
  const total = knownSum(points.flatMap((point) => point.values)) ?? 0
  const denominator = total > 0 ? total : 1
  return (
    <ChartFrame
      title={fill(USAGE_TEXT.chartShare, { group: groupLabel(state.query.groupBy) })}
      summary={chartSummary(state.query, buckets)}
      series={[{ id: state.query.metric, label: metricLabel(state.query.metric), colour: 'other' }]}
      legend={groups}
      rowHeading={USAGE_TEXT.nameColumn}
      points={points}
      format={(value) => metricText(value, state.query.metric)}
    >
      {(active, pattern) =>
        points.map((point, index) => {
          const value = point.values[0]
          if (value === undefined) return null
          const width = (value / denominator) * 100
          const x =
            ((knownSum(points.slice(0, index).flatMap((row) => row.values)) ?? 0) / denominator) *
            100
          return (
            <g key={point.id}>
              <rect
                className={`usage-series-${groups[index]?.colour ?? 'other'}`}
                fill={pattern(groups[index]?.colour ?? 'other')}
                x={x}
                y={0}
                width={width}
                height={100}
              />
              {active === index ? (
                <rect className="usage-chart-active" x={x} y={0} width={width} height={100} />
              ) : null}
            </g>
          )
        })
      }
    </ChartFrame>
  )
}
