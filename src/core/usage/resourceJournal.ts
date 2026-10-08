// M107 J/M102: the machine's durable resource history. One append-only JSONL
// file per recording process (collector) and UTC day under the usage folder.
// Appends are flushed to disk; a crash can tear only the final line, which a
// read ignores. Any other unreadable line refuses the whole read: history is
// then explicitly unavailable, never a partial or invented view.
import * as z from 'zod/mini'
import {
  MILLISECONDS_PER_DAY,
  RESOURCE_HISTORY_DETAIL_DAYS,
  RESOURCE_HISTORY_RETENTION_MS,
  RESOURCE_JOURNAL_FILE_MAX_BYTES,
  RESOURCE_JOURNAL_FOLDER,
  RESOURCE_JOURNAL_FUTURE_SKEW_MS,
  RESOURCE_JOURNAL_READ_MAX_BYTES,
  RESOURCE_JOURNAL_REMOVE_MARGIN_DAYS,
  RESOURCE_JOURNAL_VERSION,
  USAGE_FOLDER,
  USAGE_LINE_FEED_BYTE,
  USAGE_RECORD_MAX_BYTES,
  USAGE_VERSION_FOLDER,
} from '../../shared/constants'
import { resourceHistoryRecordSchema } from '../../shared/resourceHistory'
import type { ResourceRecord } from '../../shared/resources'
import type { UsageFs } from './journalStore'
import type { ResourceRecordSink } from './resourceRecords'

export const RESOURCE_JOURNAL_ROOT = `${USAGE_FOLDER}/${USAGE_VERSION_FOLDER}/${RESOURCE_JOURNAL_FOLDER}`
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FILE_PATTERN = /^([\w-]+)\.(\d+)\.jsonl$/
const WRITER_PATTERN = /^[\w-]{1,128}$/
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
const lineSchema = z.strictObject({
  v: z.literal(RESOURCE_JOURNAL_VERSION),
  record: resourceHistoryRecordSchema,
})
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
}

export interface ResourceJournalOptions {
  /** This process's collector; never a path. */
  readonly writerId: string
  readonly now: () => number
  /** Consent: the host's usage-history choice. Off records nothing; reads still work. */
  readonly isEnabled: () => boolean
  /** A record past the per-file bound is dropped, not retried; called with no detail. */
  readonly onDropped?: () => void
}

function utcDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 'YYYY-MM-DD'.length)
}

function isNewer(value: unknown): boolean {
  const version = versionSchema.safeParse(value)
  return version.success && version.data.v > RESOURCE_JOURNAL_VERSION
}

/** Complete lines only; the bytes after the last line feed are a torn final append. */
function parseFile(bytes: Uint8Array, day: string): ResourceRecord[] {
  const records: ResourceRecord[] = []
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
  }
  return records
}

interface CachedFile {
  readonly size: number
  readonly mtimeMs: number
  readonly records: readonly ResourceRecord[]
}

export class ResourceJournal implements ResourceRecordSink {
  private generation = 0
  private readonly written = new Map<string, number>()
  private readonly cache = new Map<string, CachedFile>()
  private retainedDay: string | undefined
  private hasDropped = false

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

  private async readFile(file: string, day: string): Promise<CachedFile | undefined> {
    const stat = await this.fs.stat(file)
    if (stat === undefined) {
      this.cache.delete(file)
      return undefined
    }
    if (stat.size > RESOURCE_JOURNAL_FILE_MAX_BYTES)
      throw new ResourceJournalError('resourceHistoryTooLarge')
    const cached = this.cache.get(file)
    if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached
    const bytes = await this.fs.read(file, 0)
    if (bytes.byteLength > RESOURCE_JOURNAL_FILE_MAX_BYTES)
      throw new ResourceJournalError('resourceHistoryTooLarge')
    const next = { ...stat, records: parseFile(bytes, day) }
    this.cache.set(file, next)
    return next
  }

  /** Durable append. A rejected write stays retryable; the next attempt uses a fresh file. */
  public async append(input: ResourceRecord): Promise<void> {
    if (!this.options.isEnabled()) return
    const record = resourceHistoryRecordSchema.parse(input)
    const now = this.options.now()
    // Outside the readable window: it could never be shown, so it is never stored.
    if (record.atMs <= now - RESOURCE_HISTORY_RETENTION_MS) return
    if (record.atMs > now + RESOURCE_JOURNAL_FUTURE_SKEW_MS) return
    const line = `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record })}\n`
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
      // A failed write may have left a partial line; never append after it.
      this.generation += 1
      throw error
    }
    this.written.set(file, written + size)
  }

  /** Removes day folders past the retention window once per UTC day. */
  public async retain(): Promise<void> {
    const now = this.options.now()
    const today = utcDay(now)
    if (this.retainedDay === today) return
    const cutoff = utcDay(
      now -
        (RESOURCE_HISTORY_DETAIL_DAYS + RESOURCE_JOURNAL_REMOVE_MARGIN_DAYS) * MILLISECONDS_PER_DAY,
    )
    const days = await this.fs.list(RESOURCE_JOURNAL_ROOT)
    for (const day of days) {
      if (DAY_PATTERN.test(day) && day < cutoff)
        await this.fs.remove(`${RESOURCE_JOURNAL_ROOT}/${day}`)
    }
    this.retainedDay = today
  }

  /** Every collector's retained records, oldest day first and in each collector's append order. */
  public async read(): Promise<ResourceJournalRead> {
    const now = this.options.now()
    const first = utcDay(now - RESOURCE_HISTORY_RETENTION_MS)
    const last = utcDay(now + RESOURCE_JOURNAL_FUTURE_SKEW_MS)
    const records: ResourceRecord[] = []
    const sources: string[] = []
    const seen = new Set<string>()
    let total = 0
    const days = await this.fs.list(RESOURCE_JOURNAL_ROOT)
    for (const day of days) {
      if (!DAY_PATTERN.test(day) || day < first || day > last) continue
      const names = await this.fs.list(`${RESOURCE_JOURNAL_ROOT}/${day}`)
      const files = names
        .map((name) => FILE_PATTERN.exec(name))
        .filter((match) => match !== null)
        .map((match) => ({ name: match[0], writer: match[1] ?? '', generation: Number(match[2]) }))
        .toSorted((a, b) =>
          a.writer === b.writer ? a.generation - b.generation : a.writer.localeCompare(b.writer),
        )
      for (const { name, writer } of files) {
        const file = `${RESOURCE_JOURNAL_ROOT}/${day}/${name}`
        seen.add(file)
        const read = await this.readFile(file, day)
        if (read === undefined) continue
        total += read.size
        if (total > RESOURCE_JOURNAL_READ_MAX_BYTES)
          throw new ResourceJournalError('resourceHistoryTooLarge')
        for (const record of read.records) {
          // Seven recorded days; a record from a clock running ahead is out of range.
          if (record.atMs <= now - RESOURCE_HISTORY_RETENTION_MS) continue
          if (record.atMs > now + RESOURCE_JOURNAL_FUTURE_SKEW_MS) continue
          records.push(record)
          sources.push(writer)
        }
      }
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file)
    return { records, sources }
  }
}
