import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { fill, formatDateTime, formatPercent } from '../../../shared/l10n/text'
import type { UsageLimitSnapshot } from '../../../shared/usageJournal'
import { ChartFrame, CHART_PALETTE, type ChartSeries } from './ChartFrame'

/** Separate provider figures avoid adding unrelated quota percentages together. */
export function StepLines({ snapshots }: { readonly snapshots: readonly UsageLimitSnapshot[] }) {
  const sorted = snapshots.toSorted((a, b) => a.observedAt - b.observedAt)
  const byWindow = new Map(
    sorted.flatMap((snapshot) => snapshot.windows.map((window) => [window.id, window] as const)),
  )
  const windows: UsageLimitSnapshot['windows'] = []
  byWindow.forEach((window) => {
    windows.push(window)
  })
  const series: ChartSeries[] = windows.map((window, index) => ({
    id: window.id,
    label: window.label ?? window.id,
    colour: CHART_PALETTE[index] ?? 'other',
  }))
  const first = sorted[0]?.observedAt ?? 0
  const span = (sorted.at(-1)?.observedAt ?? first) - first
  const points = sorted.map((snapshot) => ({
    id: snapshot.id,
    label: formatDateTime(snapshot.observedAt),
    x: span === 0 ? 0 : ((snapshot.observedAt - first) / span) * 100,
    values: windows.map(
      (window) => snapshot.windows.find((candidate) => candidate.id === window.id)?.usedPercent,
    ),
  }))
  const max = Math.max(
    100,
    ...points.flatMap((point) => point.values.filter((value) => value !== undefined)),
  )
  const summary = fill(USAGE_TEXT.chartSummary, {
    metric: USAGE_TEXT.providerWindows,
    from: points[0]?.label ?? USAGE_TEXT.unknown,
    to: points.at(-1)?.label ?? USAGE_TEXT.unknown,
    group: sorted[0]?.provider ?? USAGE_TEXT.provider,
  })
  return (
    <ChartFrame
      title={`${USAGE_TEXT.chartLimits}: ${sorted[0]?.provider ?? USAGE_TEXT.unknown}`}
      summary={summary}
      series={series}
      points={points}
      format={(value) => (value === undefined ? USAGE_TEXT.unknown : formatPercent(value))}
    >
      {(active, pattern) => (
        <>
          {series.map((item, seriesIndex) => {
            // Missing snapshots and resets start a new segment, never a made-up continuation.
            const segments: string[] = []
            let segment = ''
            let previous: number | undefined
            for (const point of points) {
              const value = point.values[seriesIndex]
              if (value === undefined) {
                if (segment !== '') segments.push(segment)
                segment = ''
                previous = undefined
                continue
              }
              const x = point.x
              const y = 100 - (value / max) * 100
              if (previous !== undefined && value >= previous)
                segment += ` ${String(x)},${String(100 - (previous / max) * 100)}`
              else if (segment !== '') {
                segments.push(segment)
                segment = ''
              }
              segment += ` ${String(x)},${String(y)}`
              previous = value
            }
            if (segment !== '') segments.push(segment)
            return (
              <g key={item.id}>
                {segments.map((coordinates, index) => (
                  <polyline
                    key={index}
                    className={`usage-line usage-series-${item.colour}`}
                    points={coordinates.trim()}
                  />
                ))}
                {points.map((point) => {
                  const value = point.values[seriesIndex]
                  return value === undefined ? null : (
                    <circle
                      key={point.id}
                      className={`usage-series-${item.colour}`}
                      fill={pattern(item.colour)}
                      cx={point.x}
                      cy={100 - (value / max) * 100}
                      r={2}
                    />
                  )
                })}
              </g>
            )
          })}
          <line
            className="usage-chart-active"
            x1={points[active]?.x ?? 0}
            x2={points[active]?.x ?? 0}
            y1={0}
            y2={100}
          />
        </>
      )}
    </ChartFrame>
  )
}
