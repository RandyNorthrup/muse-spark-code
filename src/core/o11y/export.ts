// Desktop observability (M111 lane OB, PLAN.md D91.22): the opt-in
// export's gate. Nothing leaves the machine until the person names their
// collector (off by default, D91.22; M110 lane O's `OtelSettings` holds
// the endpoint), and then only over verified TLS. Retries follow the OTLP
// exporter spec (Stable): 429/502/503/504 and connection failures retry
// with exponential backoff and jitter, honouring Retry-After, bounded by
// the give-up elapsed time; everything else fails at once. Portable: the
// runtime's exporter owns the sockets.

import {
  MILLISECONDS_PER_SECOND,
  NANOSECONDS_PER_MILLISECOND,
  O11Y_EXPORT_RETRY_INITIAL_MS,
  O11Y_EXPORT_RETRY_MAX_ELAPSED_MS,
  O11Y_EXPORT_RETRY_MAX_MS,
  PROVIDER_RETRY_HTTP_STATUS,
} from '../../shared/constants'
import type { O11yLogRecord, O11yMetricPoint, O11ySpan } from './signals'

/** The OTLP/HTTP status codes that retry (opentelemetry-proto's table). */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
  PROVIDER_RETRY_HTTP_STATUS.badGateway,
  PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
  PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout,
])

/** Why export stays off or a batch failed: fixed words, never the payload. */
export type O11yExportRefusal = 'off' | 'not-url' | 'not-https' | 'gave-up' | 'refused' | 'failed'

export type O11yExportEndpoint =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'off' | 'not-url' | 'not-https' }

/**
The collector's base URL, or why export stays off: no target means off
(the caller resolves M110 lane O's `otelExportTarget` first); anything
but an `https:` URL is refused (D65).
*/
export function o11yExportEndpoint(target: string | undefined): O11yExportEndpoint {
  if (target === undefined) return { ok: false, reason: 'off' }
  let url: URL
  try {
    url = new URL(target)
  } catch (error: unknown) {
    // Only a malformed endpoint URL refuses: anything else keeps its
    // kind past the gate.
    if (!(error instanceof TypeError)) throw error
    return { ok: false, reason: 'not-url' }
  }
  return url.protocol === 'https:'
    ? { ok: true, url: url.href }
    : { ok: false, reason: 'not-https' }
}

/** Whether an export attempt's HTTP status retries (429/502/503/504 only). */
export function isRetryableExportStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

/**
The wait before the next attempt: exponential backoff with full jitter,
capped at O11Y_EXPORT_RETRY_MAX_MS, or the server's Retry-After when it
names one sooner — clamped to the give-up bound so a runaway server
cannot park the exporter past it. `random` is injected for determinism.
*/
export function exportBackoffMs(
  attempt: number,
  retryAfterMs: number | undefined,
  random: () => number,
): number {
  const capped = Math.min(
    O11Y_EXPORT_RETRY_MAX_MS,
    O11Y_EXPORT_RETRY_INITIAL_MS * 2 ** Math.max(0, attempt),
  )
  const backoff = Math.floor(random() * (capped + 1))
  return retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs < 0
    ? backoff
    : Math.min(Math.floor(retryAfterMs), O11Y_EXPORT_RETRY_MAX_ELAPSED_MS)
}

/** Whether the exporter has used its whole give-up bound. */
export function isExportGivenUp(elapsedMs: number): boolean {
  return elapsedMs >= O11Y_EXPORT_RETRY_MAX_ELAPSED_MS
}

/** Parse a Retry-After value (delay seconds or an HTTP date) into a wait. */
export function retryAfterMs(value: string | undefined, nowMs: number): number | undefined {
  if (value === undefined) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * MILLISECONDS_PER_SECOND)
  }
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs)
}

function nanos(ms: number): string {
  return String(ms * NANOSECONDS_PER_MILLISECOND)
}

function otlpAttributes(attributes: readonly { key: string; value: string }[]): unknown[] {
  return attributes.map((attribute) => ({
    key: attribute.key,
    value: { stringValue: attribute.value },
  }))
}

function otlpResource(component: string): unknown {
  return { attributes: [{ key: 'service.name', value: { stringValue: component } }] }
}

/** Group stored records by their component, in first-seen order. */
function groupByComponent<T extends { readonly component: string }>(
  records: readonly T[],
): [string, T[]][] {
  const byComponent = new Map<string, T[]>()
  // Map.groupBy does not resolve under this repo's TS lib (as with
  // Iterator.toArray); the explicit loop stays. PLAN.md §8 logs this.
  // eslint-disable-next-line unicorn/prefer-group-by
  for (const record of records) {
    const group = byComponent.get(record.component) ?? []
    group.push(record)
    byComponent.set(record.component, group)
  }
  return [...byComponent]
}

/**
Rebuild an OTLP/HTTP metrics ExportRequest from stored points, grouped
by component. What the receiver scrubbed is what the collector gets.
*/
export function otlpMetricsPayload(points: readonly O11yMetricPoint[]): unknown {
  return {
    resourceMetrics: groupByComponent(points).map(([component, group]) => ({
      resource: otlpResource(component),
      scopeMetrics: [
        {
          scope: { name: 'muse-spark-code' },
          metrics: group.map((point) => ({
            name: point.name,
            ...(point.unit !== undefined && { unit: point.unit }),
            gauge: {
              dataPoints: [
                {
                  timeUnixNano: nanos(point.at),
                  asDouble: point.value,
                  attributes: otlpAttributes(point.attributes),
                },
              ],
            },
          })),
        },
      ],
    })),
  }
}

/** Rebuild an OTLP/HTTP logs ExportRequest from stored records. */
export function otlpLogsPayload(records: readonly O11yLogRecord[]): unknown {
  return {
    resourceLogs: groupByComponent(records).map(([component, group]) => ({
      resource: otlpResource(component),
      scopeLogs: [
        {
          scope: { name: 'muse-spark-code' },
          logRecords: group.map((record) => ({
            timeUnixNano: nanos(record.at),
            severityNumber: record.severity,
            body: { stringValue: record.message },
            ...(record.traceId !== undefined && { traceId: record.traceId }),
            ...(record.spanId !== undefined && { spanId: record.spanId }),
            attributes: otlpAttributes(record.attributes),
          })),
        },
      ],
    })),
  }
}

/** Rebuild an OTLP/HTTP traces ExportRequest from stored spans. */
export function otlpTracesPayload(spans: readonly O11ySpan[]): unknown {
  return {
    resourceSpans: groupByComponent(spans).map(([component, group]) => ({
      resource: otlpResource(component),
      scopeSpans: [
        {
          scope: { name: 'muse-spark-code' },
          spans: group.map((span) => ({
            traceId: span.traceId,
            spanId: span.spanId,
            ...(span.parentSpanId !== undefined && { parentSpanId: span.parentSpanId }),
            name: span.name,
            startTimeUnixNano: nanos(span.startMs),
            endTimeUnixNano: nanos(span.endMs),
            status: { code: span.error ? 2 : 1 },
            attributes: otlpAttributes(span.attributes),
          })),
        },
      ],
    })),
  }
}

/**
Split records into byte-bounded batches: each batch's payload JSON fits
`maxBytes`, and a single record past it is its own batch (said by the
count, never silently dropped). The input is never mutated.
*/
export function splitExportBatches<T>(
  records: readonly T[],
  payload: (batch: readonly T[]) => unknown,
  maxBytes: number,
): readonly (readonly T[])[] {
  const batches: T[][] = []
  let current: T[] = []
  const flush = (): void => {
    if (current.length > 0) batches.push(current)
    current = []
  }
  for (const record of records) {
    const candidate = [...current, record]
    if (
      current.length > 0 &&
      Buffer.byteLength(JSON.stringify(payload(candidate)), 'utf8') > maxBytes
    ) {
      flush()
      current = [record]
    } else {
      current = candidate
    }
  }
  flush()
  return batches
}
