// Desktop observability (M111 lane OB, PLAN.md D91.22): the Diagnostics
// page's node method. Serves the health table (the node first, then the
// desktop's components), the export state, the dropped count and one page
// of each signal from the ring store, newest first. The collector
// endpoint shows as origin only: userinfo never reaches the page.

import {
  O11Y_DIAGNOSTICS_MAX_CRASHES,
  O11Y_DIAGNOSTICS_MAX_LOGS,
  O11Y_DIAGNOSTICS_MAX_SERIES,
  O11Y_DIAGNOSTICS_MAX_TRACES,
  O11Y_DIAGNOSTICS_WINDOW_MS,
} from '../../shared/constants'
import {
  nodeMethods,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../shared/hostApi/nodeMethods'
import { nodeHealth, type NodeHealthPorts } from '../node/health'
import { guardNodeMethod } from '../node/listenerGuard'
import type { O11yRingStore } from './store'

/** N supplies health's ports; OB assembles the page from the ring store. */
export interface NodeDiagnosticsPort {
  store: O11yRingStore
  health: NodeHealthPorts
  /** The resolved collector target (M110 lane O's gate), or undefined while off. */
  exportTarget: string | undefined
  /** Batches the receiver refused since start. */
  refused: () => number
  now: () => number
  /** Files an unexpected method failure; implementations print a fixed sentence. */
  report(error: unknown): void
}

/** The endpoint as origin only (`https://host:port`); undefined when off or malformed. */
export function diagnosticsExportOrigin(target: string | undefined): string | undefined {
  if (target === undefined) return undefined
  let url: URL
  try {
    url = new URL(target)
  } catch (error: unknown) {
    // Only a malformed target reads absent: anything else keeps its kind
    // past the page.
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
  return url.protocol === 'https:' ? url.origin : undefined
}

export function createNodeDiagnosticsMethods(port: NodeDiagnosticsPort) {
  const read = async (
    input: NodeMethodParams<'node/diagnostics/read'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/diagnostics/read'>> => {
    nodeMethods['node/diagnostics/read'].params.parse(input)
    signal.throwIfAborted()
    const health = await nodeHealth('/readyz', port.health)
    signal.throwIfAborted()
    const logs = await port.store.readRecentLogs(O11Y_DIAGNOSTICS_MAX_LOGS)
    signal.throwIfAborted()
    const traces = await port.store.readRecentTraces(O11Y_DIAGNOSTICS_MAX_TRACES)
    signal.throwIfAborted()
    const crashes = await port.store.readRecentCrashes(O11Y_DIAGNOSTICS_MAX_CRASHES)
    signal.throwIfAborted()
    const now = port.now()
    const metrics = await port.store.readMetricWindow(
      now - O11Y_DIAGNOSTICS_WINDOW_MS,
      now,
      O11Y_DIAGNOSTICS_MAX_SERIES,
    )
    const origin = diagnosticsExportOrigin(port.exportTarget)
    return nodeMethods['node/diagnostics/read'].result.parse({
      health: [
        {
          component: 'node',
          ready: health.word === 'ready',
          detail: health.word,
        },
        ...(health.desktop?.components.map((probe) => ({
          component: probe.component,
          ready: probe.ready,
          detail: probe.detail,
        })) ?? []),
      ],
      export: { on: origin !== undefined, ...(origin !== undefined && { endpoint: origin }) },
      dropped:
        port.refused() +
        port.store.sampledOut +
        logs.skipped.lines +
        traces.skipped.lines +
        crashes.skipped.lines +
        metrics.skipped.lines,
      unreadable:
        logs.skipped.files + traces.skipped.files + crashes.skipped.files + metrics.skipped.files,
      metrics: metrics.series,
      logs: logs.records.map((record) => ({
        at: record.at,
        component: record.component,
        severity: record.severity,
        message: record.message,
      })),
      traces: traces.traces.map((trace) => ({
        traceId: trace.traceId,
        spans: trace.spans.map((span) => ({
          spanId: span.spanId,
          ...(span.parentSpanId !== undefined && { parentSpanId: span.parentSpanId }),
          name: span.name,
          startMs: span.startMs,
          endMs: span.endMs,
          error: span.error,
        })),
      })),
      crashes: crashes.records.map((record) => ({
        at: record.at,
        component: record.component,
        kind: record.kind,
        code: record.code,
      })),
    })
  }

  // Every handler crosses the typed boundary: no raw TypeError or Error
  // escapes. Unexpected failures are reported to the serve log before the
  // typed `unavailable` refusal reaches the person.
  const guard = <I, O>(work: (input: I, signal: AbortSignal) => Promise<O>) =>
    guardNodeMethod(work, (error) => {
      port.report(error)
    })

  return {
    read: guard(read),
  }
}
