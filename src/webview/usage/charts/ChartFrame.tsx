import { webviewKey } from '../../../shared/keybindings'
import { useId, useState, type ReactNode } from 'react'
import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { fill, formatList } from '../../../shared/l10n/text'

export const CHART_PALETTE = ['blue', 'purple', 'orange', 'green', 'yellow', 'red'] as const
export interface ChartSeries {
  readonly id: string
  readonly label: string
  readonly colour: string
  readonly sourceId?: string
}
export interface ChartPoint {
  readonly id: string
  readonly label: string
  readonly values: readonly (number | undefined)[]
}
export function ColumnBucket({
  x,
  width,
  isActive,
  children,
}: {
  readonly x: number
  readonly width: number
  readonly isActive: boolean
  readonly children: ReactNode
}) {
  return (
    <g>
      {children}
      {isActive ? (
        <rect className="usage-chart-active" x={x} y={0} width={width} height={100} />
      ) : null}
    </g>
  )
}

export function ChartFrame({
  title,
  summary,
  series,
  legend = series,
  rowHeading = USAGE_TEXT.dateColumn,
  points,
  format,
  children,
}: {
  readonly title: string
  readonly summary: string
  readonly series: readonly ChartSeries[]
  readonly legend?: readonly ChartSeries[]
  readonly rowHeading?: string
  readonly points: readonly ChartPoint[]
  readonly format: (value: number | undefined) => string
  readonly children: (active: number, pattern: (colour: string) => string) => ReactNode
}) {
  const id = useId()
  const patterns = {
    blue: 'M0 2H4',
    purple: 'M2 0V4',
    orange: 'M0 4L4 0',
    green: 'M0 0L4 4',
    yellow: 'M0 0L4 4M0 4L4 0',
    red: 'M1 2H3',
    other: 'M0 2H4M2 0V4',
  }
  const [selected, setSelected] = useState(0)
  const active = Math.min(selected, Math.max(0, points.length - 1))
  const point = points[active]
  const description =
    point === undefined
      ? USAGE_TEXT.emptyRange
      : fill(USAGE_TEXT.chartBucket, {
          date: point.label,
          values: formatList(
            series.map((item, index) => `${item.label}: ${format(point.values[index])}`),
          ),
        })
  return (
    <figure className="usage-chart">
      <figcaption id={`${id}-caption`}>{title}</figcaption>
      <p id={`${id}-summary`}>{summary}</p>
      <p id={`${id}-keyboard`}>{USAGE_TEXT.chartKeyboard}</p>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        tabIndex={0}
        aria-label={summary}
        aria-describedby={`${id}-keyboard ${id}-bucket`}
        onKeyDown={(event) => {
          let next: number
          switch (webviewKey('usage.chart', event)) {
            case 'previous': {
              next = Math.max(0, active - 1)
              break
            }
            case 'next': {
              next = Math.min(points.length - 1, active + 1)
              break
            }
            case 'first': {
              next = 0
              break
            }
            case 'last': {
              next = Math.max(0, points.length - 1)
              break
            }
            default: {
              return
            }
          }
          event.preventDefault()
          setSelected(next)
        }}
      >
        <defs>
          {Object.entries(patterns).map(([colour, path]) => (
            <pattern
              key={colour}
              id={`${id}-${colour}`}
              className={`usage-series-${colour}`}
              width={2 * 2}
              height={2 * 2}
              patternUnits="userSpaceOnUse"
            >
              <rect className="usage-pattern-base" width={2 * 2} height={2 * 2} />
              <path className="usage-pattern-halo" d={path} />
              <path className="usage-pattern-cue" d={path} />
            </pattern>
          ))}
        </defs>
        {children(active, (colour) => `url(#${id}-${colour})`)}
      </svg>
      <p id={`${id}-bucket`} role="status">
        {description}
      </p>
      <ul className="usage-legend">
        {legend.map((item) => (
          <li key={item.id}>
            <span className={`usage-swatch usage-series-${item.colour}`} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
      <details>
        <summary>{USAGE_TEXT.showDataTable}</summary>
        <div className="usage-table-scroll" tabIndex={0} role="region" aria-label={title}>
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{rowHeading}</th>
                {series.map((item) => (
                  <th key={item.id} scope="col">
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  {series.map((item, index) => (
                    <td key={item.id}>{format(row.values[index])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
