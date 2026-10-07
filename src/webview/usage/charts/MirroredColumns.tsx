import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { formatDateTime } from '../../../shared/l10n/text'
import type { UsagePageState } from '../../../shared/usagePage'
import { count, dayLabel } from '../display'
import { ChartFrame, ColumnBucket } from './ChartFrame'
import { chartSummary } from './StackedColumns'

export function MirroredColumns({ state }: { readonly state: UsagePageState }) {
  const series = [
    { id: 'input', label: USAGE_TEXT.inputTokens, colour: 'blue' },
    { id: 'output', label: USAGE_TEXT.outputTokens, colour: 'purple' },
    { id: 'cached', label: USAGE_TEXT.cachedTokens, colour: 'green' },
    { id: 'reasoning', label: USAGE_TEXT.reasoningTokens, colour: 'orange' },
  ]
  const points = state.buckets.map((bucket, index) => ({
    id: String(index),
    label: state.query.range === 'today' ? formatDateTime(bucket.at) : dayLabel(bucket.day),
    values: [
      bucket.totals.tokens.input,
      bucket.totals.tokens.output,
      bucket.totals.tokens.cached,
      bucket.totals.tokens.reasoning,
    ],
  }))
  const max = Math.max(
    1,
    ...points.flatMap((point) => point.values.slice(0, 2).filter((value) => value !== undefined)),
  )
  const width = 100 / Math.max(1, points.length)
  return (
    <ChartFrame
      title={USAGE_TEXT.chartTokens}
      summary={chartSummary(state.query, points)}
      series={series}
      points={points}
      format={count}
    >
      {(active, pattern) => (
        <>
          <line className="usage-chart-axis" x1={0} x2={100} y1={100 / 2} y2={100 / 2} />
          {points.map((point, index) => (
            <ColumnBucket
              key={point.id}
              x={index * width}
              width={width}
              isActive={active === index}
            >
              {point.values
                .slice(0, 2)
                .map((value, direction) =>
                  value === undefined ? null : (
                    <rect
                      key={direction}
                      className={`usage-series-${direction === 0 ? 'blue' : 'purple'}`}
                      fill={pattern(direction === 0 ? 'blue' : 'purple')}
                      x={index * width + width / (2 * 2)}
                      y={direction === 0 ? 100 / 2 - ((value / max) * 100) / 2 : 100 / 2}
                      width={width / 2}
                      height={((value / max) * 100) / 2}
                    />
                  ),
                )}
              {point.values.slice(2).map((subset, subsetIndex) => {
                const total = point.values[subsetIndex]
                if (subset === undefined || total === undefined) return null
                const height = ((Math.min(subset, total) / max) * 100) / 2
                return (
                  <rect
                    key={`subset-${String(subsetIndex)}`}
                    className={`usage-series-${subsetIndex === 0 ? 'green' : 'orange'}`}
                    fill={pattern(subsetIndex === 0 ? 'green' : 'orange')}
                    x={index * width + width / (2 * 2)}
                    y={subsetIndex === 0 ? 100 / 2 - height : 100 / 2}
                    width={width / 2}
                    height={height}
                  />
                )
              })}
            </ColumnBucket>
          ))}
        </>
      )}
    </ChartFrame>
  )
}
