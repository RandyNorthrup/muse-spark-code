// Desktop observability (M111 lane OB, PLAN.md D91.22): the file-backed
// ring store. JSONL day files under the node's owner-only root (through
// `NodePrivateFiles`, so every read, append and delete keeps its
// owner, mode and link checks): metrics, logs, sampled traces and crash
// records. Appends fsync per batch; pruning deletes whole day files past
// retention and compacts over-cap files to their newest lines. Malformed
// lines (a torn tail, tampering) are skipped at read and counted on the
// read, never trusted.

import {
  MILLISECONDS_PER_DAY,
  O11Y_DAY_FILE_MAX_BYTES,
  O11Y_DIAGNOSTICS_MAX_POINTS,
  O11Y_LOGS_MAX_BYTES,
  O11Y_RECEIVER_MAX_BODY_BYTES,
} from '../../shared/constants'
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
  retentionMs,
  rollupMinuteBuckets,
  sampleTraces,
  type O11yStoreSignal,
} from '../../core/o11y/ringStore'
import { parseCrashLine, serializeCrashRecord, type O11yCrashRecord } from '../../core/o11y/crash'
import type { O11yLogRecord, O11yMetricPoint, O11ySpan } from '../../core/o11y/signals'
import { isMissingFile, type NodePrivateFiles } from '../node/privateFiles'

/** One metric series as the Diagnostics page charts it. */
export interface O11yStoreSeries {
  readonly component: string
  readonly name: string
  readonly unit: string | undefined
  readonly buckets: readonly {
    readonly minute: number
    readonly count: number
    readonly avg: number
    readonly min: number
    readonly max: number
  }[]
}

/** One trace with its spans, newest trace first. */
export interface O11yStoreTrace {
  readonly traceId: string
  readonly spans: readonly O11ySpan[]
}

/** What a read skipped: malformed lines and unreadable files, this read. */
export interface O11yStoreSkipped {
  readonly lines: number
  readonly files: number
}

function serializePoint(point: O11yMetricPoint): string {
  return `${JSON.stringify(point)}\n`
}

function serializeLog(record: O11yLogRecord): string {
  return `${JSON.stringify(record)}\n`
}

function serializeSpan(span: O11ySpan): string {
  return `${JSON.stringify(span)}\n`
}

/** Group records by a key, in first-seen order. */
function groupRecordsBy<T>(records: readonly T[], keyOf: (record: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  // Map.groupBy does not resolve under this repo's TS lib (as
  // `src/core/o11y/export.ts` records); the explicit loop stays.
  // PLAN.md §8 logs this.
  // eslint-disable-next-line unicorn/prefer-group-by
  for (const record of records) {
    const key = keyOf(record)
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }
  return [...groups]
}

export class O11yRingStore {
  private sampledOutSpans = 0

  constructor(
    private readonly files: NodePrivateFiles,
    private readonly now: () => number = Date.now,
  ) {}

  private async appendGrouped<T>(
    signal: O11yStoreSignal,
    records: readonly T[],
    atOf: (record: T) => number,
    serialize: (record: T) => string,
  ): Promise<void> {
    const byDay = new Map<string, string>()
    for (const record of records) {
      const name = dayFileName(signal, atOf(record))
      byDay.set(name, `${byDay.get(name) ?? ''}${serialize(record)}`)
    }
    const days = [...byDay]
    for (const [name, text] of days) await this.files.append(name, text)
  }

  private async readDayFile(name: string, maxBytes: number): Promise<string | undefined> {
    try {
      return await this.files.read(name, maxBytes)
    } catch (error: unknown) {
      // A missing day file is an empty day, never an error; anything else
      // skips the file for this read, and the caller counts it.
      if (isMissingFile(error)) return undefined
      throw error
    }
  }

  private async readSignalDays<T>(
    signal: O11yStoreSignal,
    parse: (line: string) => T | undefined,
  ): Promise<{ records: T[]; skipped: O11yStoreSkipped }> {
    const records: T[] = []
    let lines = 0
    let files = 0
    const days = Math.ceil(retentionMs(signal) / MILLISECONDS_PER_DAY) + 1
    for (let back = 0; back < days; back += 1) {
      const name = dayFileName(signal, this.now() - back * MILLISECONDS_PER_DAY)
      let text: string | undefined
      try {
        text = await this.readDayFile(name, O11Y_DAY_FILE_MAX_BYTES)
      } catch (error: unknown) {
        // A day file that cannot be read is skipped and counted for this
        // read; anything that is not an error keeps its kind past the store.
        if (!(error instanceof Error)) throw error
        files += 1
        continue
      }
      if (text === undefined) continue
      const items = text.split('\n')
      for (const line of items) {
        if (line === '') continue
        const record = parse(line)
        if (record === undefined) lines += 1
        else records.push(record)
      }
    }
    return { records, skipped: { lines, files } }
  }

  async appendMetrics(points: readonly O11yMetricPoint[]): Promise<void> {
    await this.appendGrouped('metrics', points, (point) => point.at, serializePoint)
  }

  async appendLogs(records: readonly O11yLogRecord[]): Promise<void> {
    await this.appendGrouped('logs', records, (record) => record.at, serializeLog)
  }

  async appendSpans(spans: readonly O11ySpan[]): Promise<void> {
    const kept = sampleTraces(spans)
    this.sampledOutSpans += spans.length - kept.length
    await this.appendGrouped('traces', kept, (span) => span.startMs, serializeSpan)
  }

  async appendCrash(record: O11yCrashRecord): Promise<void> {
    await this.appendGrouped('crashes', [record], (item) => item.at, serializeCrashRecord)
  }

  /** Spans dropped by sampling since start (errors are always kept). */
  get sampledOut(): number {
    return this.sampledOutSpans
  }

  /** The newest log records first, up to `limit`. */
  async readRecentLogs(
    limit: number,
  ): Promise<{ records: O11yLogRecord[]; skipped: O11yStoreSkipped }> {
    const read = await this.readSignalDays('logs', parseLogLine)
    return {
      records: read.records.toSorted((left, right) => right.at - left.at).slice(0, limit),
      skipped: read.skipped,
    }
  }

  /** The newest traces first (each with its spans oldest-first), up to `limit` traces. */
  async readRecentTraces(
    limit: number,
  ): Promise<{ traces: O11yStoreTrace[]; skipped: O11yStoreSkipped }> {
    const read = await this.readSignalDays('traces', parseSpanLine)
    const traces = groupRecordsBy(read.records, (span) => span.traceId)
      .map(([traceId, spans]): O11yStoreTrace => ({
        traceId,
        spans: spans.toSorted((left, right) => left.startMs - right.startMs),
      }))
      .toSorted((left, right) => {
        const leftEnd = Math.max(...left.spans.map((span) => span.endMs))
        const rightEnd = Math.max(...right.spans.map((span) => span.endMs))
        return rightEnd - leftEnd
      })
    return { traces: traces.slice(0, limit), skipped: read.skipped }
  }

  /** The newest crash records first, up to `limit`. */
  async readRecentCrashes(
    limit: number,
  ): Promise<{ records: O11yCrashRecord[]; skipped: O11yStoreSkipped }> {
    const read = await this.readSignalDays('crashes', parseCrashLine)
    return {
      records: read.records.toSorted((left, right) => right.at - left.at).slice(0, limit),
      skipped: read.skipped,
    }
  }

  /**
  The metric series in a window: quantized points rolled to minute
  buckets, thinned to O11Y_DIAGNOSTICS_MAX_POINTS buckets a series, up to
  `maxSeries` series in first-seen order.
  */
  async readMetricWindow(
    sinceMs: number,
    untilMs: number,
    maxSeries: number,
  ): Promise<{ series: O11yStoreSeries[]; skipped: O11yStoreSkipped }> {
    const read = await this.readSignalDays('metrics', parseMetricLine)
    const windowed = quantizeMetricPoints(
      read.records.filter((point) => point.at >= sinceMs && point.at <= untilMs),
    )
    const series: O11yStoreSeries[] = []
    const groups = groupRecordsBy(
      windowed,
      (point) => `${point.component}|${point.name}|${point.unit ?? ''}`,
    )
    for (const [, points] of groups) {
      if (series.length >= maxSeries) break
      const first = points[0]
      if (first === undefined) continue
      const buckets = downsamplePoints(
        rollupMinuteBuckets(points),
        O11Y_DIAGNOSTICS_MAX_POINTS,
      ).map((bucket) => ({
        minute: bucket.minute,
        count: bucket.count,
        avg: bucket.sum / bucket.count,
        min: bucket.min,
        max: bucket.max,
      }))
      series.push({ component: first.component, name: first.name, unit: first.unit, buckets })
    }
    return { series, skipped: read.skipped }
  }

  /**
  Prune to the caps: delete whole day files past retention (strangers
  never named), and compact over-cap files to their newest lines — a file
  can only overshoot its cap by one batch, so the compaction read is
  bounded by the cap plus one batch. Returns what changed.
  */
  async prune(): Promise<{ deleted: string[]; compacted: string[] }> {
    const listed = await this.files.list()
    const deleted: string[] = []
    const compacted: string[] = []
    const signals: O11yStoreSignal[] = ['metrics', 'logs', 'traces', 'crashes']
    for (const signal of signals) {
      const dropped = pruneDayFiles(listed, signal, this.now())
      for (const name of dropped) {
        await this.files.remove(name)
        deleted.push(name)
      }
      const kept = listed.filter((name) => isDayFileName(name, signal) && !dropped.includes(name))
      for (const name of kept) {
        const cap = signal === 'logs' ? O11Y_LOGS_MAX_BYTES : O11Y_DAY_FILE_MAX_BYTES
        let text: string | undefined
        try {
          text = await this.readDayFile(name, cap + O11Y_RECEIVER_MAX_BODY_BYTES)
        } catch (error: unknown) {
          // A file that cannot be read is left for the next prune (and
          // for retention after that); anything that is not an error
          // keeps its kind past the store.
          if (!(error instanceof Error)) throw error
          continue
        }
        if (text === undefined) continue
        const lines = text.split('\n').filter((line) => line !== '')
        const keptLines = pruneLogLines(
          lines.map((line) => `${line}\n`),
          cap,
        )
        if (keptLines.length === lines.length) continue
        await this.files.write(name, keptLines.join(''))
        compacted.push(name)
      }
    }
    return { deleted, compacted }
  }
}
