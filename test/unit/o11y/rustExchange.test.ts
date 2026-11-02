// M111 lane OB: the Rust client's recorded exchange (see
// fixtures/otlp-rust-2026-10-31/README.md) through the real ingest: the
// bytes `muse-spark-otel` POSTed are bytes the receiver accepts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ingestOtlpLogs,
  ingestOtlpMetrics,
  ingestOtlpTraces,
  type O11yIngest,
} from '../../../src/core/o11y/signals'

function exchange(name: string): unknown {
  const url = new URL(`fixtures/otlp-rust-2026-10-31/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8'))
}

/** The exchange's one record, after the ingest proves ok with exactly one. */
function onlyRecord<T>(parsed: O11yIngest<T>): T | undefined {
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return undefined
  expect(parsed.records).toHaveLength(1)
  return parsed.records[0]
}

describe('recorded Rust exchange', () => {
  it('ingests the recorded spans with their error flags', () => {
    const parsed = ingestOtlpTraces(exchange('traces'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const names = parsed.records.map((record) => record.name)
    expect(names).toHaveLength(2)
    expect(names).toContain('failing')
    expect(names).toContain('render')
    expect(parsed.records.map((record) => record.component)).toEqual(['shell', 'shell'])
    expect(parsed.records.map((record) => record.error)).toEqual([true, true])
  })

  it('ingests the recorded counter with its string integer', () => {
    const record = onlyRecord(ingestOtlpMetrics(exchange('metrics')))
    expect(record?.component).toBe('shell')
    expect(record?.name).toBe('frames')
    expect(record?.value).toBe(1)
    expect(record?.unit).toBeUndefined()
  })

  it('ingests the recorded log with its severity', () => {
    const record = onlyRecord(ingestOtlpLogs(exchange('logs')))
    expect(record?.component).toBe('shell')
    expect(record?.severity).toBe(17)
    expect(record?.message).toBe('frame dropped')
    // The error event fired inside the render span, so the log links it.
    const traces = ingestOtlpTraces(exchange('traces'))
    expect(traces.ok).toBe(true)
    if (!traces.ok) return
    const render = traces.records.find((candidate) => candidate.name === 'render')
    expect(record?.traceId).toBe(render?.traceId)
    expect(record?.spanId).toBe(render?.spanId)
  })
})
