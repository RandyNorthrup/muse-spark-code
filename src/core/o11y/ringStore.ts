// Desktop observability (M111 lane OB, PLAN.md D91.22): the ring store's
// policy. Portable: no file access (the runtime's store owns the files).
// One JSONL file per signal per UTC day; pruning deletes whole day files
// past retention, and compacts the log tail under its byte cap. Metrics
// quantize to the 10-second resolution at ingest; minute rollups keep the
// charts cheap. Traces sample by trace id, with every error kept.

import { createHash } from 'node:crypto'
import {
  MILLISECONDS_PER_MINUTE,
  O11Y_CRASH_RETENTION_MS,
  O11Y_LOGS_MAX_BYTES,
  O11Y_LOGS_RETENTION_MS,
  O11Y_METRICS_RESOLUTION_MS,
  O11Y_METRICS_RETENTION_MS,
  O11Y_TRACES_RETENTION_MS,
  O11Y_TRACE_SAMPLE_KEEP_EVERY,
} from '../../shared/constants'
import {
  o11yLogRecordSchema,
  o11yMetricPointSchema,
  o11ySpanSchema,
  type O11yLogRecord,
  type O11yMetricPoint,
  type O11ySpan,
} from './signals'

/** The ring store's signals, each with its day-file prefix. */
export const O11Y_STORE_SIGNALS = ['metrics', 'logs', 'traces', 'crashes'] as const
export type O11yStoreSignal = (typeof O11Y_STORE_SIGNALS)[number]

/** One minute bucket over one metric series. */
export interface O11yMinuteBucket {
  readonly component: string
  readonly name: string
  /** The bucket's start, whole minutes since the epoch. */
  readonly minute: number
  readonly count: number
  readonly sum: number
  readonly min: number
  readonly max: number
}

/** The `YYYY-MM-DD` stamp's width, read off an example rather than counted. */
const DAY_STAMP_CHARS = '2026-10-31'.length

/** A day file's name for a signal at an instant: `metrics-2026-10-31.jsonl`. */
export function dayFileName(signal: O11yStoreSignal, atMs: number): string {
  const day = new Date(atMs).toISOString().slice(0, DAY_STAMP_CHARS)
  return `${signal}-${day}.jsonl`
}

/** A day-file stem: four digits, dash, two, dash, two. */
const DAY_STEM_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/** Whether a name is one of this signal's day files (never a stranger's). */
export function isDayFileName(file: string, signal: O11yStoreSignal): boolean {
  return (
    file.startsWith(`${signal}-`) &&
    file.endsWith('.jsonl') &&
    DAY_STEM_PATTERN.test(file.slice(signal.length + 1, -'.jsonl'.length))
  )
}

/** The retention each signal's day files prune against. */
export function retentionMs(signal: O11yStoreSignal): number {
  switch (signal) {
    case 'metrics': {
      return O11Y_METRICS_RETENTION_MS
    }
    case 'logs': {
      return O11Y_LOGS_RETENTION_MS
    }
    case 'traces': {
      return O11Y_TRACES_RETENTION_MS
    }
    case 'crashes': {
      return O11Y_CRASH_RETENTION_MS
    }
  }
}

/**
Which day files to delete: whole files whose day ended before the
retention cutoff. The input is never mutated. A name that is not one of
ours is never named for deletion: unknown files are left alone, never
swept.
*/
export function pruneDayFiles(
  files: readonly string[],
  signal: O11yStoreSignal,
  nowMs: number,
): readonly string[] {
  const cutoff = new Date(nowMs - retentionMs(signal)).toISOString().slice(0, DAY_STAMP_CHARS)
  return files.filter((file) => isDayFileName(file, signal) && file < `${signal}-${cutoff}.jsonl`)
}

/**
The log lines to keep under the byte cap: the newest lines whose encoded
bytes fit. The input is never mutated. Sizes are UTF-8 bytes, as written.
*/
export function pruneLogLines(
  lines: readonly string[],
  maxBytes: number = O11Y_LOGS_MAX_BYTES,
): readonly string[] {
  let total = 0
  let first = lines.length
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) break
    total += Buffer.byteLength(line, 'utf8')
    if (total > maxBytes) break
    first = index
  }
  return lines.slice(first)
}

/**
Quantize metric points to the store's resolution: within one bucket of
one series (component and name) the newest point wins. The input is never
mutated.
*/
export function quantizeMetricPoints(
  points: readonly O11yMetricPoint[],
  resolutionMs: number = O11Y_METRICS_RESOLUTION_MS,
): readonly O11yMetricPoint[] {
  const buckets = new Map<string, O11yMetricPoint>()
  for (const point of points) {
    const bucket = Math.floor(point.at / resolutionMs) * resolutionMs
    buckets.set(`${point.component}|${point.name}|${String(bucket)}`, point)
  }
  // Iterator.toArray does not resolve under this repo's TS lib; the spread
  // stays. PLAN.md §8 logs this.
  // eslint-disable-next-line unicorn/prefer-iterator-to-array
  return [...buckets.values()].toSorted((left, right) => left.at - right.at)
}

/**
Roll minute buckets over quantized points: count, sum, min and max per
series per whole UTC minute. The input is never mutated.
*/
export function rollupMinuteBuckets(
  points: readonly O11yMetricPoint[],
): readonly O11yMinuteBucket[] {
  const buckets = new Map<string, O11yMinuteBucket & { sum: number }>()
  for (const point of points) {
    const minute = Math.floor(point.at / MILLISECONDS_PER_MINUTE)
    const key = `${point.component}|${point.name}|${String(minute)}`
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, {
        component: point.component,
        name: point.name,
        minute,
        count: 1,
        sum: point.value,
        min: point.value,
        max: point.value,
      })
    } else {
      buckets.set(key, {
        ...bucket,
        count: bucket.count + 1,
        sum: bucket.sum + point.value,
        min: Math.min(bucket.min, point.value),
        max: Math.max(bucket.max, point.value),
      })
    }
  }
  // Iterator.toArray does not resolve under this repo's TS lib; the spread
  // stays. PLAN.md §8 logs this.
  // eslint-disable-next-line unicorn/prefer-iterator-to-array
  return [...buckets.values()].toSorted((left, right) => left.minute - right.minute)
}

/**
Whether a trace is kept whole: every trace holding an error span, plus
one in O11Y_TRACE_SAMPLE_KEEP_EVERY by the trace id's hash. Deterministic
per trace id, so a trace is kept or dropped as one.
*/
export function shouldKeepTrace(traceId: string, hasError: boolean): boolean {
  if (hasError) return true
  const digest = createHash('sha256').update(traceId, 'utf8').digest()
  return digest[0] !== undefined && digest[0] % O11Y_TRACE_SAMPLE_KEEP_EVERY === 0
}

/**
Group spans by trace and drop whole sampled-out traces: a trace whose
spans disagree about nothing is kept or dropped as one. The input is
never mutated.
*/
export function sampleTraces(spans: readonly O11ySpan[]): readonly O11ySpan[] {
  const errors = new Map<string, boolean>()
  for (const span of spans) {
    if (span.error) errors.set(span.traceId, true)
  }
  return spans.filter((span) => shouldKeepTrace(span.traceId, errors.get(span.traceId) === true))
}

/**
Thin one series to at most `maxPoints`, keeping order: every stride-th
point plus always the last, so the chart's newest edge stays true. The
input is never mutated.
*/
export function downsamplePoints<T>(points: readonly T[], maxPoints: number): readonly T[] {
  if (points.length <= maxPoints || maxPoints <= 0) {
    return maxPoints <= 0 ? [] : points
  }
  const stride = Math.ceil(points.length / maxPoints)
  const thinned = points.filter((_, index) => index % stride === 0)
  const last = points.at(-1)
  return last !== undefined && thinned.at(-1) !== last ? [...thinned, last] : thinned
}

/**
Parse one store line back: anything malformed or off-shape reads absent,
never trusted or repaired. One parser per record shape, over the shared
reader.
*/
function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch (error: unknown) {
    // Only a malformed store line reads absent: anything else keeps its
    // kind past the store.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

export function parseMetricLine(line: string): O11yMetricPoint | undefined {
  const parsed = o11yMetricPointSchema.safeParse(parseLine(line))
  return parsed.success ? parsed.data : undefined
}

export function parseLogLine(line: string): O11yLogRecord | undefined {
  const parsed = o11yLogRecordSchema.safeParse(parseLine(line))
  return parsed.success ? parsed.data : undefined
}

export function parseSpanLine(line: string): O11ySpan | undefined {
  const parsed = o11ySpanSchema.safeParse(parseLine(line))
  return parsed.success ? parsed.data : undefined
}
