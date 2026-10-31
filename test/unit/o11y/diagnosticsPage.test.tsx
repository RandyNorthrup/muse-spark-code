// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import {
  fill,
  formatDateTime,
  formatDurationMs,
  formatNumber,
  plural,
} from '../../../src/shared/l10n/text'
import { nodeDiagnosticsSchema, type NodeDiagnostics } from '../../../src/shared/node'
import { DiagnosticsPage } from '../../../src/webview/diagnostics/DiagnosticsPage'

const MINUTE = 60 * 1000
const DAY = Date.UTC(2026, 9, 30, 12, 0, 0)

function pageWith(overrides: Partial<NodeDiagnostics>): NodeDiagnostics {
  return nodeDiagnosticsSchema.parse({
    health: [{ component: 'node', ready: true, detail: 'ready' }],
    export: { on: false },
    dropped: 0,
    unreadable: 0,
    metrics: [],
    logs: [],
    traces: [],
    crashes: [],
    ...overrides,
  })
}

function buckets(minutes: readonly number[]): NodeDiagnostics['metrics'][number]['buckets'] {
  return minutes.map((offset, index) => ({
    minute: DAY + offset * MINUTE,
    count: index + 1,
    avg: 10 + index,
    min: index,
    max: 20 + index,
  }))
}

describe('DiagnosticsPage', () => {
  it('renders every section with its heading', () => {
    render(<DiagnosticsPage page={pageWith({})} />)
    expect(screen.getByRole('heading', { name: UI_TEXT.nodeDiagnostics.title })).toBeVisible()
    for (const heading of [
      UI_TEXT.nodeDiagnostics.healthTitle,
      UI_TEXT.nodeDiagnostics.metricsTitle,
      UI_TEXT.nodeDiagnostics.logsTitle,
      UI_TEXT.nodeDiagnostics.tracesTitle,
      UI_TEXT.nodeDiagnostics.crashesTitle,
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  it('shows health rows with readiness words and the empty states', () => {
    render(
      <DiagnosticsPage
        page={pageWith({
          health: [
            { component: 'node', ready: true, detail: 'ready' },
            { component: 'desktop', ready: false, detail: 'starting' },
          ],
        })}
      />,
    )
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.ready)).toBeVisible()
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.notReady)).toBeVisible()
    expect(screen.getByText('starting')).toBeVisible()
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.emptyMetrics)).toBeVisible()
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.emptyLogs)).toBeVisible()
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.emptyTraces)).toBeVisible()
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.emptyCrashes)).toBeVisible()
  })

  it('shows the export state and the dropped counts only when nonzero', () => {
    const { rerender } = render(<DiagnosticsPage page={pageWith({})} />)
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.exportOff)).toBeVisible()
    expect(screen.queryByText(plural(UI_TEXT.nodeDiagnostics.dropped, 1))).toBeNull()
    expect(screen.queryByText(plural(UI_TEXT.nodeDiagnostics.unreadable, 1))).toBeNull()
    rerender(
      <DiagnosticsPage
        page={pageWith({
          export: { on: true, endpoint: 'https://otel.example:4318' },
          dropped: 1,
          unreadable: 2,
        })}
      />,
    )
    expect(
      screen.getByText(
        fill(UI_TEXT.nodeDiagnostics.exportOn, { endpoint: 'https://otel.example:4318' }),
      ),
    ).toBeVisible()
    expect(screen.getByText(plural(UI_TEXT.nodeDiagnostics.dropped, 1))).toBeVisible()
    expect(screen.getByText(plural(UI_TEXT.nodeDiagnostics.unreadable, 2))).toBeVisible()
  })

  it('charts each series as min, average and max lines with a data table', () => {
    render(
      <DiagnosticsPage
        page={pageWith({
          metrics: [
            { component: 'node', name: 'cpu.time', unit: 'ms', buckets: buckets([0, 1, 2]) },
          ],
        })}
      />,
    )
    expect(screen.getAllByText('node: cpu.time (ms)')).toHaveLength(2)
    for (const word of [
      UI_TEXT.nodeDiagnostics.statMin,
      UI_TEXT.nodeDiagnostics.statAvg,
      UI_TEXT.nodeDiagnostics.statMax,
    ]) {
      expect(screen.getAllByText(word)).toHaveLength(2)
    }
    // The data table carries the exact bucket values.
    fireEvent.click(screen.getByText(UI_TEXT.nodeDiagnostics.showDataTable))
    expect(screen.getByText(formatNumber(10))).toBeVisible()
    expect(screen.getByText(formatNumber(22))).toBeVisible()
    expect(
      screen.getByText(
        fill(UI_TEXT.nodeDiagnostics.metricSummary, {
          series: 'cpu.time',
          from: formatDateTime(DAY),
          to: formatDateTime(DAY + 2 * MINUTE),
        }),
      ),
    ).toBeVisible()
  })

  it('breaks chart lines across a missing minute instead of joining the gap', () => {
    const { container } = render(
      <DiagnosticsPage
        page={pageWith({
          metrics: [{ component: 'node', name: 'cpu.time', buckets: buckets([0, 1, 3]) }],
        })}
      />,
    )
    // Three series, each in two segments around the missing minute.
    expect(container.querySelectorAll('polyline')).toHaveLength(6)
  })

  it('shows severity bands as words and unknown numbers raw', () => {
    render(
      <DiagnosticsPage
        page={pageWith({
          logs: [
            { at: DAY, component: 'node', severity: 9, message: 'started' },
            { at: DAY, component: 'node', severity: 17, message: 'failed' },
            { at: DAY, component: 'node', severity: 0, message: 'plain' },
            { at: DAY, component: 'node', severity: 99, message: 'future' },
          ],
        })}
      />,
    )
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.logInfo)).toBeVisible()
    expect(screen.getByText(UI_TEXT.nodeDiagnostics.traceError)).toBeVisible()
    expect(screen.getByText(formatNumber(0))).toBeVisible()
    expect(screen.getByText(formatNumber(99))).toBeVisible()
    expect(screen.getByText('failed')).toBeVisible()
  })

  it('expands a trace into a nested waterfall with durations and error status', () => {
    render(
      <DiagnosticsPage
        page={pageWith({
          traces: [
            {
              traceId: 'abc123',
              spans: [
                {
                  spanId: 'root',
                  name: 'GET /health',
                  startMs: DAY,
                  endMs: DAY + 40,
                  error: false,
                },
                {
                  spanId: 'child',
                  parentSpanId: 'root',
                  name: 'read store',
                  startMs: DAY + 5,
                  endMs: DAY + 30,
                  error: true,
                },
              ],
            },
          ],
        })}
      />,
    )
    const button = screen.getByRole('button', {
      name: `abc123 (${plural(UI_TEXT.nodeDiagnostics.traceSpans, 2)}, ${formatDateTime(DAY)})`,
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText(
        `GET /health (${UI_TEXT.nodeDiagnostics.traceDuration}: ${formatDurationMs(40)})`,
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        `read store (${UI_TEXT.nodeDiagnostics.traceDuration}: ${formatDurationMs(25)}, ` +
          `${UI_TEXT.nodeDiagnostics.traceStatus}: ${UI_TEXT.nodeDiagnostics.traceError})`,
      ),
    ).toBeVisible()
  })

  it('renders a parent cycle without hanging', () => {
    render(
      <DiagnosticsPage
        page={pageWith({
          traces: [
            {
              traceId: 'loop',
              spans: [
                {
                  spanId: 'a',
                  parentSpanId: 'b',
                  name: 'span a',
                  startMs: DAY,
                  endMs: DAY + 1,
                  error: false,
                },
                {
                  spanId: 'b',
                  parentSpanId: 'a',
                  name: 'span b',
                  startMs: DAY,
                  endMs: DAY + 1,
                  error: false,
                },
              ],
            },
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: new RegExp(String.raw`^loop \(`) }))
    expect(screen.getAllByText(new RegExp(String.raw`^span a \(`)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(new RegExp(String.raw`^span b \(`)).length).toBeGreaterThan(0)
  })

  it('shows signal and exit crashes in their own wordings', () => {
    render(
      <DiagnosticsPage
        page={pageWith({
          crashes: [
            { at: DAY, component: 'node', kind: 'signal', code: 'SIGTERM' },
            { at: DAY, component: 'desktop', kind: 'oom', code: 'renderer' },
          ],
        })}
      />,
    )
    expect(
      screen.getByText(
        `node: ${UI_TEXT.nodeDiagnostics.crashSignal}: SIGTERM, ${formatDateTime(DAY)}`,
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        `desktop: ${UI_TEXT.nodeDiagnostics.crashKind}: oom (renderer), ${formatDateTime(DAY)}`,
      ),
    ).toBeVisible()
  })
})
