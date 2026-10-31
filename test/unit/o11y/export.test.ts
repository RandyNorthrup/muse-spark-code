// M111 lane OB: export stays off until the person names an https
// collector; retries follow the OTLP exporter spec (429/502/503/504 with
// backoff and jitter, Retry-After honoured, then give up); payloads
// rebuild the spec's ExportRequests from stored records.
import { describe, expect, it } from 'vitest'
import {
  O11Y_EXPORT_RETRY_INITIAL_MS,
  O11Y_EXPORT_RETRY_MAX_ELAPSED_MS,
  O11Y_EXPORT_RETRY_MAX_MS,
} from '../../../src/shared/constants'
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
} from '../../../src/core/o11y/export'

describe('export gate', () => {
  it('stays off without a target and refuses anything but https', () => {
    expect(o11yExportEndpoint(undefined)).toEqual({ ok: false, reason: 'off' })
    expect(o11yExportEndpoint('not a url')).toEqual({ ok: false, reason: 'not-url' })
    expect(o11yExportEndpoint('http://collector:4318')).toEqual({ ok: false, reason: 'not-https' })
    expect(o11yExportEndpoint('https://collector:4318')).toEqual({
      ok: true,
      url: 'https://collector:4318/',
    })
  })

  it('retries 429/502/503/504 only, backing off with jitter to the give-up bound', () => {
    for (const status of [429, 502, 503, 504]) expect(isRetryableExportStatus(status)).toBe(true)
    for (const status of [200, 400, 401, 403, 404, 408, 500]) {
      expect(isRetryableExportStatus(status)).toBe(false)
    }
    // Full jitter: the wait lands within the capped exponential window.
    const wait = exportBackoffMs(1, undefined, () => 0.5)
    expect(wait).toBeGreaterThanOrEqual(0)
    expect(wait).toBeLessThanOrEqual(
      Math.min(O11Y_EXPORT_RETRY_MAX_MS, O11Y_EXPORT_RETRY_INITIAL_MS * 4),
    )
    // Retry-After wins, clamped to the give-up bound.
    expect(exportBackoffMs(0, 2000, () => 0)).toBe(2000)
    expect(exportBackoffMs(0, O11Y_EXPORT_RETRY_MAX_ELAPSED_MS * 2, () => 0)).toBe(
      O11Y_EXPORT_RETRY_MAX_ELAPSED_MS,
    )
    expect(isExportGivenUp(O11Y_EXPORT_RETRY_MAX_ELAPSED_MS - 1)).toBe(false)
    expect(isExportGivenUp(O11Y_EXPORT_RETRY_MAX_ELAPSED_MS)).toBe(true)
  })

  it('reads Retry-After as delay seconds or an HTTP date', () => {
    const now = 1_761_864_000_000
    expect(retryAfterMs('2', now)).toBe(2000)
    expect(retryAfterMs(new Date(now + 5000).toUTCString(), now)).toBe(5000)
    expect(retryAfterMs('nonsense', now)).toBeUndefined()
    expect(retryAfterMs(undefined, now)).toBeUndefined()
  })
})

describe('export payloads', () => {
  it('rebuilds OTLP ExportRequests grouped by component', () => {
    const metrics = otlpMetricsPayload([
      { at: 1000, component: 'node', name: 'muse.node.requests', value: 3, attributes: [] },
    ]) as {
      resourceMetrics: { resource: unknown; scopeMetrics: { metrics: { name: string }[] }[] }[]
    }
    expect(metrics.resourceMetrics).toHaveLength(1)
    expect(metrics.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.name).toBe('muse.node.requests')
    const logs = otlpLogsPayload([
      { at: 1000, component: 'sysd', severity: 9, message: 'up', attributes: [] },
    ]) as { resourceLogs: unknown[] }
    expect(logs.resourceLogs).toHaveLength(1)
    const traces = otlpTracesPayload([
      {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        component: 'node',
        name: 'op',
        startMs: 1000,
        endMs: 1001,
        error: false,
        attributes: [],
      },
    ]) as { resourceSpans: unknown[] }
    expect(traces.resourceSpans).toHaveLength(1)
  })

  it('splits batches under the byte bound without dropping a record', () => {
    const records = ['aaa', 'bbb', 'ccc']
    const batches = splitExportBatches(records, (batch) => ({ items: batch }), 20)
    expect(batches.flat()).toEqual(records)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      expect(Buffer.byteLength(JSON.stringify({ items: batch }), 'utf8')).toBeLessThanOrEqual(20)
    }
  })
})
