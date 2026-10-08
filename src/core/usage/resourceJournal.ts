// M107 J/M102: the machine's durable resource history. One append-only JSONL
// file per recording process (collector) and UTC day under the usage folder.
// Appends are flushed to disk; a crash can tear only the final line, which a
// read ignores. Any other unreadable line refuses the whole read: history is
// then explicitly unavailable, never a partial or invented view.
// D87.11 under D82's rollups: completed days become one daily row each in
// `rollups/<YYYY-MM>.json` (atomic, under a lock), kept for the usage-history
// days. Each collector also publishes its open minute so far to
// `live/<collector>.json`, so every surface shows the current minute.
import * as z from 'zod/mini'
import {
  MILLISECONDS_PER_DAY,
  RESOURCE_HISTORY_DETAIL_DAYS,
  RESOURCE_HISTORY_MAX_DAYS,
  RESOURCE_HISTORY_RETENTION_MS,
  RESOURCE_JOURNAL_FILE_MAX_BYTES,
  RESOURCE_JOURNAL_FOLDER,
  RESOURCE_JOURNAL_FUTURE_SKEW_MS,
  RESOURCE_JOURNAL_READ_MAX_BYTES,
  RESOURCE_JOURNAL_REMOVE_MARGIN_DAYS,
  RESOURCE_JOURNAL_RETAIN_MS,
  RESOURCE_JOURNAL_ROLLUP_DELAY_MS,
  RESOURCE_JOURNAL_VERSION,
  USAGE_FOLDER,
  USAGE_HISTORY_DAYS_DEFAULT,
  USAGE_LINE_FEED_BYTE,
  USAGE_RECORD_MAX_BYTES,
  USAGE_ROLLUP_LOCK_STALE_MS,
  USAGE_VERSION_FOLDER,
} from '../../shared/constants'
import {
  resourceHistoryDaySchema,
  resourceHistoryRecordSchema,
  type ResourceHistoryDay,
} from '../../shared/resourceHistory'
import type { ResourceKind, ResourceRecord } from '../../shared/resources'
import type { UsageFs, UsageLock } from './journalStore'
import type { ResourceRecordSink } from './resourceRecords'

export const RESOURCE_JOURNAL_ROOT = `${USAGE_FOLDER}/${USAGE_VERSION_FOLDER}/${RESOURCE_JOURNAL_FOLDER}`
const LIVE_ROOT = `${RESOURCE_JOURNAL_ROOT}/live`
const ROLLUPS_ROOT = `${RESOURCE_JOURNAL_ROOT}/rollups`
const LOCK_FILE = `${RESOURCE_JOURNAL_ROOT}/rollup.lock`
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FILE_PATTERN = /^([\w-]+)\.(\d+)\.jsonl$/
const LIVE_PATTERN = /^([\w-]+)\.json$/
const MONTH_PATTERN = /^(\d{4}-\d{2})\.json$/
const WRITER_PATTERN = /^[\w-]{1,128}$/
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
// `id` names one logical record within its collector: a retry after an uncertain
// write reuses it, so a complete line followed by an error is read once.
const lineSchema = z.strictObject({
  v: z.literal(RESOURCE_JOURNAL_VERSION),
  id: z.optional(z.string().check(z.regex(/^\d{1,15}$/))),
  record: resourceHistoryRecordSchema,
})
const liveSchema = z.strictObject({
  v: z.literal(RESOURCE_JOURNAL_VERSION),
  record: resourceHistoryRecordSchema.check(z.refine((record) => record.minute !== null)),
})
// The stored row also keeps the raw day's size, so a late append is rolled up again.
const storedDaySchema = z.extend(resourceHistoryDaySchema, {
  sourceBytes: z.int().check(z.gte(0)),
})
type StoredDay = z.infer<typeof storedDaySchema>
const rollupSchema = z
  .strictObject({
    v: z.literal(RESOURCE_JOURNAL_VERSION),
    month: z.string().check(z.regex(/^\d{4}-\d{2}$/)),
    days: z.array(storedDaySchema),
  })
  .check(
    z.refine(
      (value) =>
        new Set(value.days.map((row) => row.day)).size === value.days.length &&
        value.days.every((row) => row.day.startsWith(`${value.month}-`)),
    ),
  )
const versionSchema = z.object({ v: z.int().check(z.gte(1)) })

/** Fixed codes only: no path, record content or error text crosses a surface. */
export type ResourceJournalFailure = 'resourceHistoryCorrupt' | 'resourceHistoryTooLarge'
export class ResourceJournalError extends Error {
  public constructor(public readonly code: ResourceJournalFailure) {
    super(code)
  }
}

/** Records in append order per collector; `sources[i]` names the collector of `records[i]`. */
export interface ResourceJournalRead {
  readonly records: readonly ResourceRecord[]
  readonly sources: readonly string[]
  /** Rolled-up completed days, oldest first. */
  readonly days: readonly ResourceHistoryDay[]
}

export interface ResourceJournalOptions {
  /** This process's collector; never a path. */
  readonly writerId: string
  readonly now: () => number
  /** Consent: the host's usage-history choice. Off records nothing; reads still work. */
  readonly isEnabled: () => boolean
  /** A record past the per-file bound is dropped, not retried; called with no detail. */
  readonly onDropped?: () => void
  /** D82's usage-history days for daily rows; an unreadable choice throws and retains nothing. */
  readonly historyDays?: () => number
  /** The last Delete history: nothing stamped at or before it is ever written. */
  readonly resetAtMs?: () => number
}

function utcDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 'YYYY-MM-DD'.length)
}

function isNewer(value: unknown): boolean {
  const version = versionSchema.safeParse(value)
  return version.success && version.data.v > RESOURCE_JOURNAL_VERSION
}

/** Complete lines only; the bytes after the last line feed are a torn final append. */
function parseFile(
  bytes: Uint8Array,
  day: string,
): { records: ResourceRecord[]; ids: (string | undefined)[] } {
  const records: ResourceRecord[] = []
  const ids: (string | undefined)[] = []
  let offset = 0
  for (
    let index = bytes.indexOf(USAGE_LINE_FEED_BYTE);
    index !== -1;
    index = bytes.indexOf(USAGE_LINE_FEED_BYTE, offset)
  ) {
    const line = bytes.subarray(offset, index)
    offset = index + 1
    if (line.byteLength >= USAGE_RECORD_MAX_BYTES)
      throw new ResourceJournalError('resourceHistoryCorrupt')
    let value: unknown
    try {
      value = JSON.parse(decoder.decode(line))
    } catch {
      throw new ResourceJournalError('resourceHistoryCorrupt')
    }
    // A newer build's line is skipped, as M102 skips newer usage records.
    if (isNewer(value)) continue
    const result = lineSchema.safeParse(value)
    if (!result.success || utcDay(result.data.record.atMs) !== day)
      throw new ResourceJournalError('resourceHistoryCorrupt')
    records.push(result.data.record)
    ids.push(result.data.id)
  }
  return { records, ids }
}

/** A later line with the same collector and id is a retried copy of one record. */
function isRepeat(ids: Set<string>, writer: string, id: string | undefined): boolean {
  if (id === undefined) return false
  const key = JSON.stringify([writer, id])
  if (ids.has(key)) return true
  ids.add(key)
  return false
}

function countLines(bytes: Uint8Array): number {
  let lines = 0
  for (
    let index = bytes.indexOf(USAGE_LINE_FEED_BYTE);
    index !== -1;
    index = bytes.indexOf(USAGE_LINE_FEED_BYTE, index + 1)
  )
    lines += 1
  return lines
}

/** The mean of known readings; none known stays null, never 0. */
function meanReading(values: readonly (number | null)[]): number | null {
  const known = values.filter((value) => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length
}

/** One completed day: each collector's latest snapshot per minute segment, then plain sums. */
function dayRow(
  day: string,
  records: readonly ResourceRecord[],
  sources: readonly string[],
  sourceBytes: number,
): StoredDay {
  const snapshots = new Map<string, NonNullable<ResourceRecord['minute']>>()
  // Per collector and segment, so a later cumulative snapshot replaces its earlier rows.
  const work = new Map<string, StoredDay['work'][number]>()
  let events = 0
  for (const [index, record] of records.entries()) {
    if (record.minute === null) {
      events += 1
      continue
    }
    snapshots.set(JSON.stringify([sources[index] ?? '', record.atMs]), record.minute)
    for (const row of record.work)
      work.set(JSON.stringify([sources[index] ?? '', record.atMs, row.kind]), row)
  }
  const totals = new Map<ResourceKind, StoredDay['work'][number]>()
  for (const row of work.values()) {
    const total = totals.get(row.kind) ?? { kind: row.kind, cpuSeconds: 0, peakMemoryBytes: 0 }
    total.cpuSeconds += row.cpuSeconds
    total.peakMemoryBytes = Math.max(total.peakMemoryBytes, row.peakMemoryBytes)
    totals.set(row.kind, total)
  }
  const levels = { normal: 0, throttle: 0, relocate: 0, pause: 0 }
  const minutes = Array.from(snapshots, ([, value]) => value)
  for (const minute of minutes) levels[minute.level] += 1
  return storedDaySchema.parse({
    day,
    minutes: minutes.length,
    cpuPercent: meanReading(minutes.map((minute) => minute.cpuPercent)),
    memoryUsedPercent: meanReading(minutes.map((minute) => minute.memoryUsedPercent)),
    levels,
    events,
    work: Array.from(totals, ([, value]) => value),
    sourceBytes,
  })
}

interface CachedFile {
  readonly size: number
  readonly mtimeMs: number
  /** The bytes actually read, which the read budget is charged. */
  readonly bytes: number
  readonly records: readonly ResourceRecord[]
  readonly ids: readonly (string | undefined)[]
}

export class ResourceJournal implements ResourceRecordSink {
  private generation = 0
  private readonly written = new Map<string, number>()
  private readonly cache = new Map<string, CachedFile>()
  private retainedAt: number | undefined
  private hasDropped = false
  private sequence = 0
  private retry: { readonly text: string; readonly id: string } | undefined

  public constructor(
    private readonly fs: UsageFs,
    private readonly options: ResourceJournalOptions,
  ) {
    if (!WRITER_PATTERN.test(options.writerId)) throw new Error('invalidResourceWriter')
  }

  private drop(): void {
    if (this.hasDropped) return
    this.hasDropped = true
    try {
      this.options.onDropped?.()
    } catch {
      /* A diagnostic never fails the recorder. */
    }
  }

  /** `budget`: bytes this read may still use; checked before and after reading. */
  private async readFile(
    file: string,
    day: string,
    budget = RESOURCE_JOURNAL_READ_MAX_BYTES,
  ): Promise<CachedFile | undefined> {
    const stat = await this.fs.stat(file)
    if (stat === undefined) {
      this.cache.delete(file)
      return undefined
    }
    if (stat.size > RESOURCE_JOURNAL_FILE_MAX_BYTES)
      throw new ResourceJournalError('resourceHistoryTooLarge')
    const cached = this.cache.get(file)
    if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached
    if (stat.size > budget) throw new ResourceJournalError('resourceHistoryTooLarge')
    // Read only what was measured: a file growing meanwhile ends in a torn tail.
    const bytes = await this.fs.read(file, 0, stat.size)
    if (bytes.byteLength > RESOURCE_JOURNAL_FILE_MAX_BYTES || bytes.byteLength > budget)
      throw new ResourceJournalError('resourceHistoryTooLarge')
    const next = { ...stat, bytes: bytes.byteLength, ...parseFile(bytes, day) }
    this.cache.set(file, next)
    return next
  }

  /** A day's journal files, each collector's generations in order. */
  private async dayFiles(day: string) {
    const names = await this.fs.list(`${RESOURCE_JOURNAL_ROOT}/${day}`)
    return names
      .map((name) => FILE_PATTERN.exec(name))
      .filter((match) => match !== null)
      .map((match) => ({ name: match[0], writer: match[1] ?? '', generation: Number(match[2]) }))
      .toSorted((a, b) =>
        a.writer === b.writer ? a.generation - b.generation : a.writer.localeCompare(b.writer),
      )
  }

  private async readDay(day: string) {
    const records: ResourceRecord[] = []
    const sources: string[] = []
    const ids = new Set<string>()
    let bytes = 0
    const files = await this.dayFiles(day)
    for (const { name, writer } of files) {
      const read = await this.readFile(`${RESOURCE_JOURNAL_ROOT}/${day}/${name}`, day)
      if (read === undefined) continue
      bytes += read.size
      for (const [index, record] of read.records.entries()) {
        if (isRepeat(ids, writer, read.ids[index])) continue
        records.push(record)
        sources.push(writer)
      }
    }
    return { records, sources, bytes }
  }

  /** Months this build can read; a newer build's month file is left to that build. */
  private async readRollups(
    budget = Infinity,
  ): Promise<{ months: Map<string, StoredDay[]>; newer: Set<string>; bytes: number }> {
    const months = new Map<string, StoredDay[]>()
    const newer = new Set<string>()
    let bytes = 0
    const names = await this.fs.list(ROLLUPS_ROOT)
    for (const name of names) {
      const month = MONTH_PATTERN.exec(name)?.[1]
      if (month === undefined) continue
      const file = `${ROLLUPS_ROOT}/${name}`
      const stat = await this.fs.stat(file)
      if (stat === undefined) continue
      if (stat.size > RESOURCE_JOURNAL_FILE_MAX_BYTES || bytes + stat.size > budget)
        throw new ResourceJournalError('resourceHistoryTooLarge')
      const content = await this.fs.read(file, 0, stat.size)
      bytes += content.byteLength
      if (bytes > budget) throw new ResourceJournalError('resourceHistoryTooLarge')
      let value: unknown
      try {
        value = JSON.parse(decoder.decode(content))
      } catch {
        throw new ResourceJournalError('resourceHistoryCorrupt')
      }
      if (isNewer(value)) {
        newer.add(month)
        continue
      }
      const result = rollupSchema.safeParse(value)
      if (!result.success || result.data.month !== month)
        throw new ResourceJournalError('resourceHistoryCorrupt')
      months.set(month, result.data.days)
    }
    return { months, newer, bytes }
  }

  private async rollUp(now: number, historyDays: number, lock: UsageLock): Promise<void> {
    const keepFrom = utcDay(now - (historyDays - 1) * MILLISECONDS_PER_DAY)
    const completeBefore = utcDay(now - RESOURCE_JOURNAL_ROLLUP_DELAY_MS)
    const expiredBefore = utcDay(
      now -
        (RESOURCE_HISTORY_DETAIL_DAYS + RESOURCE_JOURNAL_REMOVE_MARGIN_DAYS) * MILLISECONDS_PER_DAY,
    )
    const { months, newer } = await this.readRollups()
    const rows = new Map(
      Array.from(months, ([, value]) => value)
        .flat()
        .map((row) => [row.day, row]),
    )
    const changed = new Set<string>()
    const removals: string[] = []
    const days = await this.fs.list(RESOURCE_JOURNAL_ROOT)
    for (const day of days) {
      if (!DAY_PATTERN.test(day)) continue
      if (day < keepFrom) {
        removals.push(`${RESOURCE_JOURNAL_ROOT}/${day}`)
        continue
      }
      const month = day.slice(0, 'YYYY-MM'.length)
      if (day >= completeBefore || newer.has(month)) continue
      let read: Awaited<ReturnType<ResourceJournal['readDay']>>
      try {
        read = await this.readDay(day)
      } catch {
        // An unreadable day is kept raw (never rolled up or silently dropped).
        continue
      }
      if (rows.get(day)?.sourceBytes !== read.bytes) {
        rows.set(day, dayRow(day, read.records, read.sources, read.bytes))
        changed.add(month)
      }
      if (day < expiredBefore) removals.push(`${RESOURCE_JOURNAL_ROOT}/${day}`)
    }
    for (const [day] of rows)
      if (day < keepFrom) {
        rows.delete(day)
        changed.add(day.slice(0, 'YYYY-MM'.length))
      }
    // Daily rows are durable before any raw day they summarize is removed.
    for (const month of changed) {
      if (!(await lock.isHeld())) throw new Error('resourceHistoryLockLost')
      const monthRows = Array.from(rows, ([, value]) => value)
        .filter((row) => row.day.startsWith(`${month}-`))
        .toSorted((a, b) => a.day.localeCompare(b.day))
      const file = `${ROLLUPS_ROOT}/${month}.json`
      if (monthRows.length === 0) await this.fs.remove(file)
      else
        await this.fs.writeFileAtomically(
          file,
          `${JSON.stringify(rollupSchema.parse({ v: RESOURCE_JOURNAL_VERSION, month, days: monthRows }))}\n`,
        )
    }
    for (const folder of removals) {
      if (!(await lock.isHeld())) throw new Error('resourceHistoryLockLost')
      await this.fs.remove(folder)
    }
    const live = await this.fs.list(LIVE_ROOT)
    for (const name of live) {
      if (!LIVE_PATTERN.test(name)) continue
      const stat = await this.fs.stat(`${LIVE_ROOT}/${name}`)
      if (stat !== undefined && stat.mtimeMs <= now - RESOURCE_HISTORY_RETENTION_MS)
        await this.fs.remove(`${LIVE_ROOT}/${name}`)
    }
  }

  /** Every collector's open minute that its journal does not yet hold. */
  private async readLive(
    now: number,
    journal: ReadonlySet<string>,
    budget: number,
  ): Promise<{ records: ResourceRecord[]; sources: string[]; bytes: number }> {
    const records: ResourceRecord[] = []
    const sources: string[] = []
    let bytes = 0
    const names = await this.fs.list(LIVE_ROOT)
    for (const name of names) {
      const writer = LIVE_PATTERN.exec(name)?.[1]
      if (writer === undefined) continue
      const file = `${LIVE_ROOT}/${name}`
      const stat = await this.fs.stat(file)
      if (stat === undefined) continue
      if (stat.size >= USAGE_RECORD_MAX_BYTES)
        throw new ResourceJournalError('resourceHistoryCorrupt')
      if (bytes + stat.size > budget) throw new ResourceJournalError('resourceHistoryTooLarge')
      const content = await this.fs.read(file, 0, stat.size)
      bytes += content.byteLength
      if (bytes > budget) throw new ResourceJournalError('resourceHistoryTooLarge')
      let value: unknown
      try {
        value = JSON.parse(decoder.decode(content))
      } catch {
        throw new ResourceJournalError('resourceHistoryCorrupt')
      }
      if (isNewer(value)) continue
      const result = liveSchema.safeParse(value)
      if (!result.success) throw new ResourceJournalError('resourceHistoryCorrupt')
      const record = result.data.record
      // Out of range, or the journal already holds the segment's final snapshot.
      if (
        record.atMs <= now - RESOURCE_HISTORY_RETENTION_MS ||
        record.atMs > now + RESOURCE_JOURNAL_FUTURE_SKEW_MS ||
        journal.has(JSON.stringify([writer, record.atMs]))
      )
        continue
      records.push(record)
      sources.push(writer)
    }
    return { records, sources, bytes }
  }

  /** Durable append. A rejected write stays retryable; the next attempt uses a fresh file. */
  public async append(input: ResourceRecord): Promise<void> {
    if (!this.options.isEnabled()) return
    const record = resourceHistoryRecordSchema.parse(input)
    // Recorded before the last Delete history: it must never reappear.
    if (record.atMs <= (this.options.resetAtMs?.() ?? -1)) return
    const now = this.options.now()
    // Outside the readable window: it could never be shown, so it is never stored.
    if (record.atMs <= now - RESOURCE_HISTORY_RETENTION_MS) return
    if (record.atMs > now + RESOURCE_JOURNAL_FUTURE_SKEW_MS) return
    const text = JSON.stringify(record)
    const id = this.retry?.text === text ? this.retry.id : String((this.sequence += 1))
    const line = `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, id, record })}\n`
    const size = encoder.encode(line).byteLength
    if (size >= USAGE_RECORD_MAX_BYTES) throw new Error('resourceRecordTooLarge')
    try {
      await this.retain()
    } catch {
      // Retention retries at the next append; it never holds back a record.
    }
    const file = `${RESOURCE_JOURNAL_ROOT}/${utcDay(record.atMs)}/${this.options.writerId}.${String(this.generation)}.jsonl`
    const written = this.written.get(file) ?? 0
    if (written + size > RESOURCE_JOURNAL_FILE_MAX_BYTES) {
      this.drop()
      return
    }
    try {
      await this.fs.append(file, line, true)
    } catch (error) {
      // A failed write may have left a partial or even a complete line; never
      // append after it, and retry under the same id so a read keeps one copy.
      this.generation += 1
      this.retry = { text, id }
      throw error
    }
    this.retry = undefined
    this.written.set(file, written + size)
  }

  /** Publishes the open minute so far (atomically replaced); it is never appended. */
  public async writeLive(input: ResourceRecord): Promise<void> {
    if (!this.options.isEnabled()) return
    const { record } = liveSchema.parse({ v: RESOURCE_JOURNAL_VERSION, record: input })
    if (record.atMs <= (this.options.resetAtMs?.() ?? -1)) return
    const text = JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record })
    if (encoder.encode(text).byteLength >= USAGE_RECORD_MAX_BYTES)
      throw new Error('resourceRecordTooLarge')
    await this.fs.writeFileAtomically(`${LIVE_ROOT}/${this.options.writerId}.json`, text)
  }

  /**
   * Rolls completed days up into daily rows, then removes raw days past the
   * detail window (only once rolled up), day rows past the usage-history days
   * and expired live files. At most hourly; another process holding the lock
   * defers it.
   */
  public async retain(): Promise<void> {
    const now = this.options.now()
    if (
      this.retainedAt !== undefined &&
      now >= this.retainedAt &&
      now - this.retainedAt < RESOURCE_JOURNAL_RETAIN_MS
    )
      return
    // Nothing stored yet: a reader never creates the journal folder or its lock.
    const stored = await this.fs.list(RESOURCE_JOURNAL_ROOT)
    if (stored.length === 0) return
    const historyDays = this.options.historyDays?.() ?? USAGE_HISTORY_DAYS_DEFAULT
    const lock = await this.fs.acquireLock(LOCK_FILE, USAGE_ROLLUP_LOCK_STALE_MS)
    if (lock === undefined) return
    try {
      await this.rollUp(now, historyDays, lock)
      this.retainedAt = now
    } finally {
      await lock.release()
    }
  }

  /** Every collector's retained records, oldest day first and in each collector's append order. */
  public async read(): Promise<ResourceJournalRead> {
    const now = this.options.now()
    const first = utcDay(now - RESOURCE_HISTORY_RETENTION_MS)
    const last = utcDay(now + RESOURCE_JOURNAL_FUTURE_SKEW_MS)
    const records: ResourceRecord[] = []
    const sources: string[] = []
    const seen = new Set<string>()
    const segments = new Set<string>()
    const ids = new Set<string>()
    let total = 0
    const days = await this.fs.list(RESOURCE_JOURNAL_ROOT)
    for (const day of days) {
      if (!DAY_PATTERN.test(day) || day < first || day > last) continue
      const files = await this.dayFiles(day)
      for (const { name, writer } of files) {
        const file = `${RESOURCE_JOURNAL_ROOT}/${day}/${name}`
        seen.add(file)
        const read = await this.readFile(file, day, RESOURCE_JOURNAL_READ_MAX_BYTES - total)
        if (read === undefined) continue
        total += read.bytes
        if (total > RESOURCE_JOURNAL_READ_MAX_BYTES)
          throw new ResourceJournalError('resourceHistoryTooLarge')
        for (const [index, record] of read.records.entries()) {
          if (isRepeat(ids, writer, read.ids[index])) continue
          // Seven recorded days; a record from a clock running ahead is out of range.
          if (record.atMs <= now - RESOURCE_HISTORY_RETENTION_MS) continue
          if (record.atMs > now + RESOURCE_JOURNAL_FUTURE_SKEW_MS) continue
          records.push(record)
          sources.push(writer)
          if (record.minute !== null) segments.add(JSON.stringify([writer, record.atMs]))
        }
      }
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file)
    const live = await this.readLive(now, segments, RESOURCE_JOURNAL_READ_MAX_BYTES - total)
    total += live.bytes
    if (total > RESOURCE_JOURNAL_READ_MAX_BYTES)
      throw new ResourceJournalError('resourceHistoryTooLarge')
    const { months } = await this.readRollups(RESOURCE_JOURNAL_READ_MAX_BYTES - total)
    // An unreadable usage-history choice removes nothing, so every stored row is shown.
    let historyDays = RESOURCE_HISTORY_MAX_DAYS
    try {
      historyDays = this.options.historyDays?.() ?? USAGE_HISTORY_DAYS_DEFAULT
    } catch {
      // Retention refuses on the same error; reads stay complete.
    }
    const keepFrom = utcDay(now - (historyDays - 1) * MILLISECONDS_PER_DAY)
    return {
      records: [...records, ...live.records],
      sources: [...sources, ...live.sources],
      days: Array.from(months, ([, value]) => value)
        .flat()
        .filter((row) => row.day >= keepFrom)
        .toSorted((a, b) => a.day.localeCompare(b.day))
        .map(({ sourceBytes: _bytes, ...row }) => row),
    }
  }

  /**
   * What Delete history removes: every stored line (read or not, valid or
   * not), each live minute and each daily row. Counting never parses records.
   */
  public async count(): Promise<number> {
    let entries = 0
    const days = await this.fs.list(RESOURCE_JOURNAL_ROOT)
    for (const day of days) {
      if (!DAY_PATTERN.test(day)) continue
      const files = await this.dayFiles(day)
      for (const { name } of files)
        entries += countLines(await this.fs.read(`${RESOURCE_JOURNAL_ROOT}/${day}/${name}`, 0))
    }
    const live = await this.fs.list(LIVE_ROOT)
    entries += live.filter((name) => LIVE_PATTERN.test(name)).length
    const rollups = await this.fs.list(ROLLUPS_ROOT)
    for (const name of rollups) {
      if (!MONTH_PATTERN.test(name)) continue
      try {
        const value: unknown = JSON.parse(
          decoder.decode(await this.fs.read(`${ROLLUPS_ROOT}/${name}`, 0)),
        )
        const result = rollupSchema.safeParse(value)
        entries += result.success ? result.data.days.length : 1
      } catch {
        // An unreadable month file is still one stored entry the delete removes.
        entries += 1
      }
    }
    return entries
  }
}
