// Desktop observability (M111 lane OB, PLAN.md D91.22): the opt-in TLS
// exporter. Sends the ring store's scrubbed records to the person's own
// collector as OTLP/HTTP JSON — only after they name an `https:`
// endpoint (off by default, D91.22; M110 lane O's settings hold it),
// over verified TLS (system trust, or the caller's private CA), with
// auth headers the caller draws from the vault. Retries follow the OTLP
// exporter spec: 429/502/503/504 and connection failures back off with
// jitter to the give-up bound, then fail said; anything else fails at
// once.

import { request as httpsRequest } from 'node:https'
import {
  NODE_HTTP_STATUS,
  O11Y_EXPORT_TIMEOUT_MS,
  O11Y_EXPORT_USER_AGENT,
  O11Y_RECEIVER_MAX_BODY_BYTES,
} from '../../shared/constants'
import {
  exportBackoffMs,
  isExportGivenUp,
  isRetryableExportStatus,
  o11yExportEndpoint,
  otlpLogsPayload,
  otlpMetricsPayload,
  otlpTracesPayload,
  retryAfterMs,
  splitExportBatches,
  type O11yExportRefusal,
} from '../../core/o11y/export'
import type { O11yLogRecord, O11yMetricPoint, O11ySpan } from '../../core/o11y/signals'
import { otelExportTarget, type OtelSettings } from '../node/ops/metrics'

export interface O11yExporterPorts {
  readonly settings: OtelSettings
  /** The collector's auth headers, drawn from the vault by the caller. */
  headers(): Promise<Record<string, string>>
  readonly now: () => number
  sleep(ms: number): Promise<void>
  readonly random: () => number
  /** A private collector CA in PEM; system trust when absent. */
  readonly ca?: string
  /** Files a failed attempt's error; implementations print a fixed sentence. */
  report?(error: unknown): void
}

export type O11yExportOutcome =
  | { readonly ok: true; readonly batches: number }
  | { readonly ok: false; readonly reason: O11yExportRefusal }

export interface O11yExportPost {
  readonly status: number
  readonly retryAfter: string | undefined
}

/** One Retry-After header value: the string, the first of many, or absent. */
function retryAfterHeader(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const first: unknown = Array.isArray(value) ? value[0] : undefined
  return typeof first === 'string' ? first : undefined
}

/** One OTLP/HTTP POST over verified TLS; rejects when the send fails. */
function postHttps(
  url: string,
  body: string,
  headers: Record<string, string>,
  ca: string | undefined,
): Promise<O11yExportPost> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'POST',
        timeout: O11Y_EXPORT_TIMEOUT_MS,
        ca,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body, 'utf8'),
          'user-agent': O11Y_EXPORT_USER_AGENT,
          ...headers,
        },
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            retryAfter: retryAfterHeader(response.headers['retry-after']),
          })
        })
      },
    )
    request.once('error', reject)
    request.once('timeout', () => {
      request.destroy(new Error('o11y export timed out'))
    })
    request.end(body)
  })
}

/** Whether a status is a full success: any 2xx (the spec's OTLP/HTTP table). */
function isOkStatus(status: number): boolean {
  return status >= NODE_HTTP_STATUS.ok && status < NODE_HTTP_STATUS.ok + 100
}

/**
Post one batch, retrying to the give-up bound: undefined once sent, the
said outcome when the batch fails for good.
*/
async function postBatch(
  url: string,
  body: string,
  headers: Record<string, string>,
  ports: O11yExporterPorts,
  started: number,
): Promise<O11yExportOutcome | undefined> {
  let attempt = 0
  for (;;) {
    let post: O11yExportPost
    try {
      post = await postHttps(url, body, headers, ports.ca)
    } catch (error: unknown) {
      // Connection failures retry like a 503 (the spec's OTLP/HTTP
      // connection section); anything else keeps its kind past the send.
      if (!(error instanceof Error)) throw error
      ports.report?.(error)
      const wait = exportBackoffMs(attempt, undefined, ports.random)
      attempt += 1
      if (isExportGivenUp(ports.now() - started + wait)) return { ok: false, reason: 'gave-up' }
      await ports.sleep(wait)
      continue
    }
    if (isOkStatus(post.status)) return undefined
    if (!isRetryableExportStatus(post.status)) return { ok: false, reason: 'refused' }
    const wait = exportBackoffMs(attempt, retryAfterMs(post.retryAfter, ports.now()), ports.random)
    attempt += 1
    if (isExportGivenUp(ports.now() - started + wait)) return { ok: false, reason: 'gave-up' }
    await ports.sleep(wait)
  }
}

async function exportBodies(
  path: '/v1/metrics' | '/v1/logs' | '/v1/traces',
  bodies: readonly string[],
  ports: O11yExporterPorts,
): Promise<O11yExportOutcome> {
  const endpoint = o11yExportEndpoint(otelExportTarget(ports.settings))
  if (!endpoint.ok) return endpoint
  if (bodies.length === 0) return { ok: true, batches: 0 }
  const headers = await ports.headers()
  const started = ports.now()
  // The endpoint href always ends with `/` (URL.href); the signal path
  // joins it without doubling the slash.
  const url = `${endpoint.url}${path.slice(1)}`
  const bodiesList = [...bodies]
  for (const body of bodiesList) {
    const failed = await postBatch(url, body, headers, ports, started)
    if (failed !== undefined) return failed
  }
  return { ok: true, batches: bodies.length }
}

/** Export stored metric points; batches fit the receiver's own body cap. */
export async function exportO11yMetrics(
  points: readonly O11yMetricPoint[],
  ports: O11yExporterPorts,
): Promise<O11yExportOutcome> {
  const batches = splitExportBatches(points, otlpMetricsPayload, O11Y_RECEIVER_MAX_BODY_BYTES)
  return await exportBodies(
    '/v1/metrics',
    batches.map((batch) => JSON.stringify(otlpMetricsPayload(batch))),
    ports,
  )
}

/** Export stored log records. */
export async function exportO11yLogs(
  records: readonly O11yLogRecord[],
  ports: O11yExporterPorts,
): Promise<O11yExportOutcome> {
  const batches = splitExportBatches(records, otlpLogsPayload, O11Y_RECEIVER_MAX_BODY_BYTES)
  return await exportBodies(
    '/v1/logs',
    batches.map((batch) => JSON.stringify(otlpLogsPayload(batch))),
    ports,
  )
}

/** Export stored spans. */
export async function exportO11yTraces(
  spans: readonly O11ySpan[],
  ports: O11yExporterPorts,
): Promise<O11yExportOutcome> {
  const batches = splitExportBatches(spans, otlpTracesPayload, O11Y_RECEIVER_MAX_BODY_BYTES)
  return await exportBodies(
    '/v1/traces',
    batches.map((batch) => JSON.stringify(otlpTracesPayload(batch))),
    ports,
  )
}
