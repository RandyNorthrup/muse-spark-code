// M111 lane OB: the ring store's policy prunes whole day files past
// retention, compacts the log tail under its byte cap, quantizes metrics
// to the 10-second resolution, rolls minute buckets, and samples traces
// with every error kept.
import { describe, expect, it } from 'vitest'
import { O11Y_LOGS_MAX_BYTES, O11Y_METRICS_RESOLUTION_MS } from '../../../src/shared/constants'
import {
  dayFileName,
  downsamplePoints,
  isDayFileName,
  parseLogLine,
  parseMetricLine,
  parseSpanLine,
  pruneDayFiles,
  pruneLogLines,
  quantizeMetricPoints,
  rollupMinuteBuckets,
  sampleTraces,
  shouldKeepTrace,
} from '../../../src/core/o11y/ringStore'
import type { O11yMetricPoint } from '../../../src/core/o11y/signals'

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function point(at: number, value: number): O11yMetricPoint {
  return { at, component: 'node', name: 'cpu.percent', value, attributes: [] }
}

describe('ring store policy', () => {
  it('names day files per signal and prunes whole files past retention', () => {
    expect(dayFileName('metrics', NOW)).toBe('metrics-2026-10-31.jsonl')
    const files = [
      'metrics-2026-10-31.jsonl',
      'metrics-2026-10-24.jsonl',
      'metrics-2026-10-23.jsonl',
      'metrics-notes.txt',
      'logs-2026-10-20.jsonl',
    ]
    // Seven days back from the 31st is the 24th: it stays, older goes,
    // and files that are not ours are never named for deletion.
    expect(pruneDayFiles(files, 'metrics', NOW)).toEqual(['metrics-2026-10-23.jsonl'])
    expect(pruneDayFiles(files, 'logs', NOW)).toEqual(['logs-2026-10-20.jsonl'])
    expect(isDayFileName('metrics-2026-10-31.jsonl', 'metrics')).toBe(true)
    expect(isDayFileName('metrics-notes.txt', 'metrics')).toBe(false)
    expect(isDayFileName('logs-2026-10-31.jsonl', 'metrics')).toBe(false)
  })

  it('keeps the newest log lines that fit the byte cap', () => {
    const lines = ['a\n', 'b\n', 'c\n', 'd\n']
    expect(pruneLogLines(lines, 4)).toEqual(['c\n', 'd\n'])
    expect(pruneLogLines(lines, O11Y_LOGS_MAX_BYTES)).toEqual(lines)
    expect(pruneLogLines([], 4)).toEqual([])
  })

  it('quantizes points to the resolution with the newest winning', () => {
    const base = Math.floor(NOW / O11Y_METRICS_RESOLUTION_MS) * O11Y_METRICS_RESOLUTION_MS
    const quantized = quantizeMetricPoints([
      point(base + 1000, 1),
      point(base + 9000, 2),
      point(base + O11Y_METRICS_RESOLUTION_MS, 3),
    ])
    expect(quantized.map((item) => item.value)).toEqual([2, 3])
  })

  it('rolls minute buckets with count, sum, min and max', () => {
    const buckets = rollupMinuteBuckets([
      point(NOW, 1),
      point(NOW + 1000, 5),
      point(NOW + 61 * 1000, 9),
    ])
    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({ component: 'node', count: 2, sum: 6, min: 1, max: 5 })
    expect(buckets[1]).toMatchObject({ count: 1, sum: 9, min: 9, max: 9 })
  })

  it('keeps every error trace and samples the rest as whole traces', () => {
    const errorTrace = 'e'.repeat(32)
    const spans = [
      {
        traceId: errorTrace,
        spanId: 'a'.repeat(16),
        component: 'node' as const,
        name: 'op',
        startMs: NOW,
        endMs: NOW + 1,
        error: false,
        attributes: [],
      },
      {
        traceId: errorTrace,
        spanId: 'b'.repeat(16),
        component: 'node' as const,
        name: 'op.child',
        startMs: NOW,
        endMs: NOW + 1,
        error: true,
        attributes: [],
      },
    ]
    // Both spans of the error trace survive, as one trace.
    expect(sampleTraces(spans)).toHaveLength(2)
    // Sampling is deterministic per trace id: the same id decides once.
    const id = 'f'.repeat(32)
    expect(shouldKeepTrace(id, false)).toBe(shouldKeepTrace(id, false))
    // Over many ids about one in ten clean traces is kept.
    let kept = 0
    const total = 1000
    for (let index = 0; index < total; index += 1) {
      if (shouldKeepTrace(`trace-${String(index).padStart(26, '0')}`, false)) kept += 1
    }
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(total)
  })

  it('thins a series keeping order and always the last point', () => {
    expect(downsamplePoints([1, 2, 3], 5)).toEqual([1, 2, 3])
    expect(downsamplePoints([], 5)).toEqual([])
    expect(downsamplePoints([1, 2, 3], 0)).toEqual([])
    const thinned = downsamplePoints([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)
    expect(thinned[0]).toBe(1)
    expect(thinned.at(-1)).toBe(10)
    expect(thinned.length).toBeLessThanOrEqual(4)
  })

  it('parses store lines back and reads malformed ones absent', () => {
    const metric = point(NOW, 1)
    expect(parseMetricLine(JSON.stringify(metric))).toEqual(metric)
    expect(parseMetricLine('not json')).toBeUndefined()
    expect(parseMetricLine('{"at":1}')).toBeUndefined()
    const log = { at: NOW, component: 'node', severity: 9, message: 'up', attributes: [] }
    expect(parseLogLine(JSON.stringify(log))).toEqual(log)
    expect(parseLogLine('{"at":1}')).toBeUndefined()
    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      component: 'node',
      name: 'op',
      startMs: NOW,
      endMs: NOW + 1,
      error: false,
      attributes: [],
    }
    expect(parseSpanLine(JSON.stringify(span))).toEqual(span)
    expect(parseSpanLine('{"traceId":"x"}')).toBeUndefined()
  })
})
