// Diagnostics page: the home node's health, export state, metric charts,
// recent logs, trace waterfalls and crash records from one
// `node/diagnostics/read` snapshot. The node web UI and the desktop app
// mount the same component. Waterfall bars carry computed geometry as
// inline styles, the same class of use as the file tree's virtualised rows.
import { useMemo, useState, type ReactNode } from 'react'
import { MILLISECONDS_PER_MINUTE, O11Y_SEVERITY_BAND, UI_TEXT } from '../../shared/constants'
import {
  fill,
  formatDateTime,
  formatDurationMs,
  formatNumber,
  plural,
} from '../../shared/l10n/text'
import type { PluralForms } from '../../shared/l10n/forms'
import type { NodeDiagnostics } from '../../shared/node'
import {
  CHART_PALETTE,
  ChartFrame,
  type ChartFrameText,
  type ChartSeries,
} from '../usage/charts/ChartFrame'
import '../charts/chart.css'
import './diagnostics.css'

export interface DiagnosticsPageText {
  readonly title: string
  readonly healthTitle: string
  readonly healthComponent: string
  readonly healthStatus: string
  readonly healthDetail: string
  readonly ready: string
  readonly notReady: string
  readonly unknown: string
  readonly logsTitle: string
  readonly logTime: string
  readonly logSeverity: string
  readonly logComponent: string
  readonly logMessage: string
  readonly emptyLogs: string
  readonly logTrace: string
  readonly logDebug: string
  readonly logInfo: string
  readonly logWarn: string
  readonly logFatal: string
  readonly tracesTitle: string
  readonly emptyTraces: string
  readonly traceDuration: string
  readonly traceStatus: string
  readonly traceError: string
  readonly traceSpans: PluralForms
  readonly crashesTitle: string
  readonly crashKind: string
  readonly crashSignal: string
  readonly emptyCrashes: string
  readonly exportOn: string
  readonly exportOff: string
  readonly dropped: PluralForms
  readonly unreadable: PluralForms
  readonly metricsTitle: string
  readonly emptyMetrics: string
  readonly metricSummary: string
  readonly chartKeyboard: string
  readonly chartBucket: string
  readonly chartEmpty: string
  readonly showDataTable: string
  readonly statMin: string
  readonly statAvg: string
  readonly statMax: string
}

function useDiagnosticsText(override?: DiagnosticsPageText): DiagnosticsPageText {
  return useMemo<DiagnosticsPageText>(
    () =>
      override ?? {
        title: UI_TEXT.nodeDiagnostics.title,
        healthTitle: UI_TEXT.nodeDiagnostics.healthTitle,
        healthComponent: UI_TEXT.nodeDiagnostics.healthComponent,
        healthStatus: UI_TEXT.nodeDiagnostics.healthStatus,
        healthDetail: UI_TEXT.nodeDiagnostics.healthDetail,
        ready: UI_TEXT.nodeDiagnostics.ready,
        notReady: UI_TEXT.nodeDiagnostics.notReady,
        unknown: UI_TEXT.nodeDiagnostics.unknown,
        logsTitle: UI_TEXT.nodeDiagnostics.logsTitle,
        logTime: UI_TEXT.nodeDiagnostics.logTime,
        logSeverity: UI_TEXT.nodeDiagnostics.logSeverity,
        logComponent: UI_TEXT.nodeDiagnostics.logComponent,
        logMessage: UI_TEXT.nodeDiagnostics.logMessage,
        emptyLogs: UI_TEXT.nodeDiagnostics.emptyLogs,
        logTrace: UI_TEXT.nodeDiagnostics.logTrace,
        logDebug: UI_TEXT.nodeDiagnostics.logDebug,
        logInfo: UI_TEXT.nodeDiagnostics.logInfo,
        logWarn: UI_TEXT.nodeDiagnostics.logWarn,
        logFatal: UI_TEXT.nodeDiagnostics.logFatal,
        tracesTitle: UI_TEXT.nodeDiagnostics.tracesTitle,
        emptyTraces: UI_TEXT.nodeDiagnostics.emptyTraces,
        traceDuration: UI_TEXT.nodeDiagnostics.traceDuration,
        traceStatus: UI_TEXT.nodeDiagnostics.traceStatus,
        traceError: UI_TEXT.nodeDiagnostics.traceError,
        traceSpans: UI_TEXT.nodeDiagnostics.traceSpans,
        crashesTitle: UI_TEXT.nodeDiagnostics.crashesTitle,
        crashKind: UI_TEXT.nodeDiagnostics.crashKind,
        crashSignal: UI_TEXT.nodeDiagnostics.crashSignal,
        emptyCrashes: UI_TEXT.nodeDiagnostics.emptyCrashes,
        exportOn: UI_TEXT.nodeDiagnostics.exportOn,
        exportOff: UI_TEXT.nodeDiagnostics.exportOff,
        dropped: UI_TEXT.nodeDiagnostics.dropped,
        unreadable: UI_TEXT.nodeDiagnostics.unreadable,
        metricsTitle: UI_TEXT.nodeDiagnostics.metricsTitle,
        emptyMetrics: UI_TEXT.nodeDiagnostics.emptyMetrics,
        metricSummary: UI_TEXT.nodeDiagnostics.metricSummary,
        chartKeyboard: UI_TEXT.nodeDiagnostics.chartKeyboard,
        chartBucket: UI_TEXT.nodeDiagnostics.chartBucket,
        chartEmpty: UI_TEXT.nodeDiagnostics.chartEmpty,
        showDataTable: UI_TEXT.nodeDiagnostics.showDataTable,
        statMin: UI_TEXT.nodeDiagnostics.statMin,
        statAvg: UI_TEXT.nodeDiagnostics.statAvg,
        statMax: UI_TEXT.nodeDiagnostics.statMax,
      },
    [override],
  )
}

// An OpenTelemetry severity number as its band's word; a number outside
// 1-24 is shown raw rather than forced into a band it does not belong to.
function severityWord(severity: number, strings: DiagnosticsPageText): string {
  const band = severity >= 1 ? Math.floor((severity - 1) / O11Y_SEVERITY_BAND) : -1
  const words = [
    strings.logTrace,
    strings.logDebug,
    strings.logInfo,
    strings.logWarn,
    strings.traceError,
    strings.logFatal,
  ]
  return words[band] ?? formatNumber(severity)
}

type DiagnosticsSeries = NodeDiagnostics['metrics'][number]
type DiagnosticsBucket = DiagnosticsSeries['buckets'][number]
type DiagnosticsSpan = NodeDiagnostics['traces'][number]['spans'][number]

interface MetricPoint {
  readonly id: string
  readonly label: string
  readonly x: number
  readonly minute: number
  readonly values: readonly [number, number, number]
  readonly min: number
  readonly avg: number
  readonly max: number
}

interface MetricLine extends ChartSeries {
  readonly key: 'min' | 'avg' | 'max'
}

function MetricChart({
  series,
  strings,
}: {
  readonly series: DiagnosticsSeries
  readonly strings: DiagnosticsPageText
}) {
  const buckets: readonly DiagnosticsBucket[] = series.buckets
  const first = buckets[0]?.minute ?? 0
  const last = buckets.at(-1)?.minute ?? first
  const span = last - first
  const points: readonly MetricPoint[] = buckets.map((bucket) => ({
    id: `${series.component}-${series.name}-${String(bucket.minute)}`,
    label: formatDateTime(bucket.minute),
    x: span === 0 ? 0 : ((bucket.minute - first) / span) * 100,
    minute: bucket.minute,
    values: [bucket.min, bucket.avg, bucket.max],
    min: bucket.min,
    avg: bucket.avg,
    max: bucket.max,
  }))
  const lines: readonly MetricLine[] = [
    { id: 'min', label: strings.statMin, colour: CHART_PALETTE[0], key: 'min' },
    { id: 'avg', label: strings.statAvg, colour: CHART_PALETTE[1], key: 'avg' },
    { id: 'max', label: strings.statMax, colour: CHART_PALETTE[2], key: 'max' },
  ]
  const floor = buckets.length === 0 ? 0 : Math.min(...buckets.map((bucket) => bucket.min))
  const ceiling = buckets.length === 0 ? 1 : Math.max(...buckets.map((bucket) => bucket.max))
  const range = ceiling === floor ? 1 : ceiling - floor
  const heightOf = (value: number): number => 100 - ((value - floor) / range) * 100
  const from = points[0]?.label
  const to = points.at(-1)?.label
  const summary =
    from === undefined || to === undefined
      ? strings.chartEmpty
      : fill(strings.metricSummary, { series: series.name, from, to })
  const title =
    series.unit === undefined
      ? `${series.component}: ${series.name}`
      : `${series.component}: ${series.name} (${series.unit})`
  const frameText: ChartFrameText = {
    keyboard: strings.chartKeyboard,
    emptyRange: strings.chartEmpty,
    showDataTable: strings.showDataTable,
    rowHeading: strings.logTime,
    bucket: (date: string, values: string) => fill(strings.chartBucket, { date, values }),
  }
  return (
    <ChartFrame
      title={title}
      summary={summary}
      series={lines}
      points={points}
      format={(value) => (value === undefined ? strings.unknown : formatNumber(value))}
      text={frameText}
    >
      {(active, pattern) => (
        <>
          {lines.map((line) => {
            // A missing minute starts a new segment, never a made-up line
            // across the gap.
            const segments: string[] = []
            let segment = ''
            let previousMinute: number | undefined
            for (const point of points) {
              if (
                previousMinute !== undefined &&
                point.minute - previousMinute > MILLISECONDS_PER_MINUTE
              ) {
                if (segment !== '') segments.push(segment)
                segment = ''
              }
              segment += ` ${String(point.x)},${String(heightOf(point[line.key]))}`
              previousMinute = point.minute
            }
            if (segment !== '') segments.push(segment)
            return (
              <g key={line.id}>
                {segments.map((coordinates, index) => (
                  <polyline
                    key={index}
                    className={`usage-line usage-series-${line.colour}`}
                    points={coordinates.trim()}
                  />
                ))}
                {points.map((point) => (
                  <circle
                    key={point.id}
                    className={`usage-series-${line.colour}`}
                    fill={pattern(line.colour)}
                    cx={point.x}
                    cy={heightOf(point[line.key])}
                    r={2}
                  />
                ))}
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

function HealthTable({
  health,
  strings,
}: {
  readonly health: NodeDiagnostics['health']
  readonly strings: DiagnosticsPageText
}) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">{strings.healthComponent}</th>
          <th scope="col">{strings.healthStatus}</th>
          <th scope="col">{strings.healthDetail}</th>
        </tr>
      </thead>
      <tbody>
        {health.map((row) => (
          <tr key={row.component}>
            <th scope="row">{row.component}</th>
            <td>{row.ready ? strings.ready : strings.notReady}</td>
            <td>{row.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LogsTable({
  logs,
  strings,
}: {
  readonly logs: NodeDiagnostics['logs']
  readonly strings: DiagnosticsPageText
}) {
  if (logs.length === 0) {
    return <p>{strings.emptyLogs}</p>
  }
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">{strings.logTime}</th>
          <th scope="col">{strings.logSeverity}</th>
          <th scope="col">{strings.logComponent}</th>
          <th scope="col">{strings.logMessage}</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((record, index) => (
          <tr key={`${String(record.at)}-${String(index)}`}>
            <td>{formatDateTime(record.at)}</td>
            <td>{severityWord(record.severity, strings)}</td>
            <td>{record.component}</td>
            <td>{record.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TraceWaterfall({
  spans,
  strings,
}: {
  readonly spans: readonly DiagnosticsSpan[]
  readonly strings: DiagnosticsPageText
}) {
  const byId = new Map(spans.map((span) => [span.spanId, span] as const))
  const roots = spans.filter(
    (span) => span.parentSpanId === undefined || !byId.has(span.parentSpanId),
  )
  const kids = new Map<string, DiagnosticsSpan[]>()
  for (const span of spans) {
    if (span.parentSpanId === undefined || !byId.has(span.parentSpanId)) continue
    const list = kids.get(span.parentSpanId) ?? []
    list.push(span)
    kids.set(span.parentSpanId, list)
  }
  const starts = spans.map((span) => span.startMs)
  const ends = spans.map((span) => span.endMs)
  const traceStart = starts.length === 0 ? 0 : Math.min(...starts)
  const traceWidth = (ends.length === 0 ? 0 : Math.max(...ends)) - traceStart || 1
  const renderRow = (span: DiagnosticsSpan, seen: ReadonlySet<string>): ReactNode => {
    const duration = formatDurationMs(span.endMs - span.startMs)
    const label = span.error
      ? `${span.name} (${strings.traceDuration}: ${duration}, ${strings.traceStatus}: ${strings.traceError})`
      : `${span.name} (${strings.traceDuration}: ${duration})`
    const left = ((span.startMs - traceStart) / traceWidth) * 100
    const width = Math.max(((span.endMs - span.startMs) / traceWidth) * 100, 1)
    const childSpans = kids.get(span.spanId) ?? []
    return (
      <li key={span.spanId}>
        <div className="diagnostics-span-head">{label}</div>
        <div className="diagnostics-span-track">
          <span
            className={
              span.error
                ? 'diagnostics-span-bar usage-series-red'
                : 'diagnostics-span-bar usage-series-blue'
            }
            style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
            aria-hidden="true"
          />
        </div>
        {childSpans.length > 0 && !seen.has(span.spanId) && (
          <ul>{childSpans.map((child) => renderRow(child, new Set(seen).add(span.spanId)))}</ul>
        )}
      </li>
    )
  }
  return (
    <ul className="diagnostics-waterfall">
      {(roots.length === 0 ? spans : roots).map((span) => renderRow(span, new Set()))}
    </ul>
  )
}

function TraceList({
  traces,
  strings,
}: {
  readonly traces: NodeDiagnostics['traces']
  readonly strings: DiagnosticsPageText
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  if (traces.length === 0) {
    return <p>{strings.emptyTraces}</p>
  }
  const toggle = (traceId: string): void => {
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(traceId)) {
        next.delete(traceId)
      } else {
        next.add(traceId)
      }
      return next
    })
  }
  return (
    <ul className="diagnostics-traces">
      {traces.map((trace) => {
        const starts = trace.spans.map((span) => span.startMs)
        const at = starts.length === 0 ? undefined : formatDateTime(Math.min(...starts))
        const counts = plural(strings.traceSpans, trace.spans.length)
        const label =
          at === undefined ? `${trace.traceId} (${counts})` : `${trace.traceId} (${counts}, ${at})`
        return (
          <li key={trace.traceId}>
            <button
              type="button"
              onClick={() => {
                toggle(trace.traceId)
              }}
              aria-expanded={open.has(trace.traceId)}
            >
              {label}
            </button>
            {open.has(trace.traceId) && trace.spans.length > 0 && (
              <TraceWaterfall spans={trace.spans} strings={strings} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function CrashList({
  crashes,
  strings,
}: {
  readonly crashes: NodeDiagnostics['crashes']
  readonly strings: DiagnosticsPageText
}) {
  if (crashes.length === 0) {
    return <p>{strings.emptyCrashes}</p>
  }
  return (
    <ul>
      {crashes.map((crash, index) => (
        <li key={`${crash.component}-${String(crash.at)}-${String(index)}`}>
          {crash.kind === 'signal'
            ? `${crash.component}: ${strings.crashSignal}: ${crash.code}, ${formatDateTime(crash.at)}`
            : `${crash.component}: ${strings.crashKind}: ${crash.kind} (${crash.code}), ${formatDateTime(crash.at)}`}
        </li>
      ))}
    </ul>
  )
}

export function DiagnosticsPage({
  page,
  text,
}: {
  readonly page: NodeDiagnostics
  readonly text?: DiagnosticsPageText
}) {
  const strings = useDiagnosticsText(text)
  const exported =
    page.export.on && page.export.endpoint !== undefined
      ? fill(strings.exportOn, { endpoint: page.export.endpoint })
      : strings.exportOff
  return (
    <main className="diagnostics-page" aria-label={strings.title}>
      <h1>{strings.title}</h1>
      <section aria-label={strings.healthTitle}>
        <h2>{strings.healthTitle}</h2>
        <HealthTable health={page.health} strings={strings} />
      </section>
      <section aria-label={exported}>
        <p>{exported}</p>
        {page.dropped > 0 && <p>{plural(strings.dropped, page.dropped)}</p>}
        {page.unreadable > 0 && <p>{plural(strings.unreadable, page.unreadable)}</p>}
      </section>
      <section aria-label={strings.metricsTitle}>
        <h2>{strings.metricsTitle}</h2>
        {page.metrics.length === 0 ? (
          <p>{strings.emptyMetrics}</p>
        ) : (
          page.metrics.map((series) => (
            <MetricChart
              key={`${series.component}-${series.name}`}
              series={series}
              strings={strings}
            />
          ))
        )}
      </section>
      <section aria-label={strings.logsTitle}>
        <h2>{strings.logsTitle}</h2>
        <LogsTable logs={page.logs} strings={strings} />
      </section>
      <section aria-label={strings.tracesTitle}>
        <h2>{strings.tracesTitle}</h2>
        <TraceList traces={page.traces} strings={strings} />
      </section>
      <section aria-label={strings.crashesTitle}>
        <h2>{strings.crashesTitle}</h2>
        <CrashList crashes={page.crashes} strings={strings} />
      </section>
    </main>
  )
}
