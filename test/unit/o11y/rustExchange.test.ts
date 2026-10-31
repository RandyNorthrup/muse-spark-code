// M111 lane OB: the Rust client's recorded exchange (see
// fixtures/otlp-rust-2026-10-31/README.md) through the real ingest: the
// bytes `muse-spark-otel` POSTed are bytes the receiver accepts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ingestOtlpLogs, ingestOtlpMetrics, ingestOtlpTraces } from '../../../src/core/o11y/signals'

function exchange(name: string): unknown {
  const url = new URL(`fixtures/otlp-rust-2026-10-31/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8'))
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
    const parsed = ingestOtlpMetrics(exchange('metrics'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.records.length).toBe(1)
    expect(parsed.records[0]?.component).toBe('shell')
    expect(parsed.records[0]?.name).toBe('frames')
    expect(parsed.records[0]?.value).toBe(1)
    expect(parsed.records[0]?.unit).toBeUndefined()
  })

  it('ingests the recorded log with its severity', () => {
    const parsed = ingestOtlpLogs(exchange('logs'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.records.length).toBe(1)
    expect(parsed.records[0]?.component).toBe('shell')
    expect(parsed.records[0]?.severity).toBe(17)
    expect(parsed.records[0]?.message).toBe('frame dropped')
    // The error event fired inside the render span, so the log links it.
    const traces = ingestOtlpTraces(exchange('traces'))
    expect(traces.ok).toBe(true)
    if (!traces.ok) return
    const render = traces.records.find((record) => record.name === 'render')
    expect(parsed.records[0]?.traceId).toBe(render?.traceId)
    expect(parsed.records[0]?.spanId).toBe(render?.spanId)
  })
})
