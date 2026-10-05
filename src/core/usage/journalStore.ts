// One file per process/day; only maintenance takes the shared lock.
import * as z from 'zod/mini'
import {
  USAGE_DAYS_FOLDER,
  USAGE_DETAIL_DAYS,
  USAGE_HISTORY_DAYS_DEFAULT,
  USAGE_HISTORY_DAYS_MIN,
  USAGE_HISTORY_DAYS_MAX,
  USAGE_FOLDER,
  USAGE_VERSION_FOLDER,
  USAGE_JOURNAL_VERSION,
  USAGE_RECORD_MAX_BYTES,
  USAGE_ROLLUPS_FOLDER,
  USAGE_ROLLUP_LOCK,
  USAGE_ROLLUP_LOCK_STALE_MS,
  USAGE_HISTOGRAM_EDGES_MS,
  USAGE_WINDOW_DAY_MS,
} from '../../shared/constants'
import {
  usageJournalEntrySchema,
  usageLimitSnapshotSchema,
  usageAmountSchema,
  usageCountSchema,
  usageCostSchema,
  usageTokensSchema,
  usageUnitsSchema,
  usageDaySchema,
  usageLabelSchema,
  usageKindSchema,
  usageIdSchema,
  type UsageJournalEntry,
  type UsageRecord,
  type UsageLimitSnapshot,
} from '../../shared/usageJournal'
import { createUsageRecord, usageLocalDay, type UsageRecordContext } from './journalRecord'
import type { Usage } from '../backends/modelapi/schemas'

export interface UsageFileStat {
  readonly size: number
  readonly mtimeMs: number
}
export interface UsageLock {
  isHeld(): Promise<boolean>
  release(): Promise<void>
}
/** Paths are relative to the private agent data folder; no caller supplies a reset path. */
export interface UsageFs {
  list(folder: string): Promise<readonly string[]>
  stat(file: string): Promise<UsageFileStat | undefined>
  read(file: string, offset: number, length: number): Promise<Uint8Array>
  append(file: string, line: string): Promise<void>
  writeFileAtomically(file: string, text: string): Promise<void>
  remove(file: string): Promise<void>
  acquireLock(file: string, staleMs: number): Promise<UsageLock | undefined>
}
export const USAGE_JOURNAL_ROOT = `${USAGE_FOLDER}/${USAGE_VERSION_FOLDER}`
const DAYS_ROOT = `${USAGE_JOURNAL_ROOT}/${USAGE_DAYS_FOLDER}`
const ROLLUPS_ROOT = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUPS_FOLDER}`
const LOCK_FILE = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUP_LOCK}`
const NEWLINE_BYTE = new TextEncoder().encode('\n')[0]
const decoder = new TextDecoder('utf-8', { fatal: true })
// The host constructs one writer per process; even an accidental second
// instance must not repeat a diagnostic that could otherwise flood the log.
const writeDiagnosticState = { hasLogged: false }
const histogramSchema = z
  .array(usageCountSchema)
  .check(z.length(USAGE_HISTOGRAM_EDGES_MS.length + 1))
export const usageRollupRowSchema = z.strictObject({
  day: usageDaySchema,
  client: usageLabelSchema,
  backend: z.enum(['museCode', 'modelApi']),
  provider: usageLabelSchema,
  model: usageLabelSchema,
  kind: usageKindSchema,
  records: usageCountSchema,
  tokens: usageTokensSchema,
  units: usageUnitsSchema,
  cost: usageCostSchema,
  durationMs: z.optional(usageAmountSchema),
  firstTokenMs: z.optional(usageAmountSchema),
  packedAvoided: z.optional(usageCountSchema),
  retries: usageCountSchema,
  rateLimited: usageCountSchema,
  latencyHistogram: histogramSchema,
  durationSamples: usageCountSchema,
  firstTokenSamples: usageCountSchema,
})
export type UsageRollupRow = z.infer<typeof usageRollupRowSchema>
const rollupSchema = z
  .strictObject({
    v: z.literal(USAGE_JOURNAL_VERSION),
    month: z.string().check(z.regex(/^\d{4}-\d{2}$/)),
    days: z.array(usageDaySchema),
    rows: z.array(usageRollupRowSchema),
    limits: z.array(usageLimitSnapshotSchema),
  })
  .check(
    z.refine(
      (value) =>
        new Set(value.days).size === value.days.length &&
        value.days.every((day) => day.startsWith(`${value.month}-`)) &&
        value.rows.every((row) => value.days.includes(row.day)) &&
        value.limits.every((limit) => value.days.includes(limit.day)),
    ),
  )
type Rollup = z.infer<typeof rollupSchema>
const versionSchema = z.object({ v: z.int().check(z.gte(1)) })
interface FileCache extends UsageFileStat {
  readonly offset: number
  readonly entries: UsageJournalEntry[]
  readonly newerVersionRecords: number
  readonly tornLines: number
  readonly invalidLines: number
}
export interface UsageJournalRead {
  readonly records: UsageRecord[]
  readonly limits: UsageLimitSnapshot[]
  readonly rollups: UsageRollupRow[]
  readonly recordCount: number
  readonly newerVersionRecords: number
  /** Unsupported monthly files: their internal record count is unknown. */
  readonly newerVersionFiles: number
  readonly tornLines: number
  readonly invalidLines: number
}
export interface UsageJournalOptions {
  readonly writerId: string
  readonly isEnabled: () => boolean
  readonly now: () => number
  /** A fixed diagnostic code, never error text, paths or record content. */
  readonly onWriteError: (code: 'usageWriteFailed') => void
}
function isNewer(value: unknown): boolean {
  const version = versionSchema.safeParse(value)
  return version.success && version.data.v > USAGE_JOURNAL_VERSION
}
function shiftedDay(day: string, days: number): string {
  return (
    new Date(Date.parse(`${day}T00:00:00Z`) + days * USAGE_WINDOW_DAY_MS)
      .toISOString()
      .split('T', 1)[0] ?? ''
  )
}
function sum(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
}
/** Optional sums stay absent when no call reported that counter. */
export function rollupUsageRecords(records: readonly UsageRecord[]): UsageRollupRow[] {
  const rows = new Map<string, UsageRollupRow>()
  for (const record of records) {
    const key = JSON.stringify([
      record.day,
      record.client,
      record.backend,
      record.provider,
      record.model,
      record.kind,
      record.cost.certainty,
    ])
    let row = rows.get(key)
    if (row === undefined) {
      row = {
        day: record.day,
        client: record.client,
        backend: record.backend,
        provider: record.provider,
        model: record.model,
        kind: record.kind,
        records: 0,
        tokens: {},
        units: {},
        cost: { certainty: record.cost.certainty },
        retries: 0,
        rateLimited: 0,
        latencyHistogram: Array.from({ length: USAGE_HISTOGRAM_EDGES_MS.length + 1 }, () => 0),
        durationSamples: 0,
        firstTokenSamples: 0,
      }
      rows.set(key, row)
    }
    row.records += 1
    for (const field of [
      'input',
      'cached',
      'cacheWrite',
      'cacheWrite5m',
      'cacheWrite1h',
      'output',
      'reasoning',
    ] as const) {
      const value = sum(row.tokens[field], record.tokens[field])
      if (value !== undefined) row.tokens[field] = value
    }
    if (record.tokens.estimated === true) row.tokens.estimated = true
    for (const field of ['searches', 'images', 'audioSeconds'] as const) {
      const value = sum(row.units[field], record.units?.[field])
      if (value !== undefined) row.units[field] = value
    }
    for (const field of ['usd', 'apiEquivalentUsd'] as const) {
      const value = sum(row.cost[field], record.cost[field])
      if (value !== undefined) row.cost[field] = value
    }
    row.durationMs = sum(row.durationMs, record.durationMs)
    row.firstTokenMs = sum(row.firstTokenMs, record.firstTokenMs)
    row.packedAvoided = sum(row.packedAvoided, record.packedAvoided)
    row.retries += record.retries ?? 0
    row.rateLimited += record.rateLimited === true ? 1 : 0
    if (record.durationMs !== undefined) {
      const index = USAGE_HISTOGRAM_EDGES_MS.findIndex(
        (edge) => record.durationMs !== undefined && record.durationMs <= edge,
      )
      const bucket = index === -1 ? USAGE_HISTOGRAM_EDGES_MS.length : index
      row.latencyHistogram[bucket] = (row.latencyHistogram[bucket] ?? 0) + 1
      row.durationSamples += 1
    }
    if (record.firstTokenMs !== undefined) row.firstTokenSamples += 1
  }
  const result: UsageRollupRow[] = []
  rows.forEach((row) => {
    result.push(row)
  })
  return result
}

export class UsageJournalStore {
  private readonly cache = new Map<string, FileCache>()
  private readonly rollupCache = new Map<
    string,
    UsageFileStat & { readonly rollup: Rollup | undefined }
  >()
  private queue = Promise.resolve()
  public constructor(
    private readonly fs: UsageFs,
    private readonly options: UsageJournalOptions,
  ) {
    usageIdSchema.parse(options.writerId)
  }
  private logWriteError(): void {
    if (writeDiagnosticState.hasLogged) return
    writeDiagnosticState.hasLogged = true
    try {
      this.options.onWriteError('usageWriteFailed')
    } catch {
      /* Diagnostics cannot fail a model call. */
    }
  }
  private async write(previous: Promise<void>, file: string, line: string): Promise<void> {
    try {
      await previous
      if (this.options.isEnabled()) await this.fs.append(file, line)
    } catch {
      this.logWriteError()
    }
  }
  private async readFile(file: string): Promise<FileCache> {
    const stat = await this.fs.stat(file)
    if (stat === undefined) {
      this.cache.delete(file)
      return {
        size: 0,
        mtimeMs: 0,
        offset: 0,
        entries: [],
        newerVersionRecords: 0,
        tornLines: 0,
        invalidLines: 0,
      }
    }
    const cached = this.cache.get(file)
    if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached
    const previous =
      cached !== undefined && stat.size > cached.size && stat.mtimeMs >= cached.mtimeMs
        ? cached
        : undefined
    const start = previous?.offset ?? 0
    const bytes = await this.fs.read(file, start, stat.size - start)
    const entries = [...(previous?.entries ?? [])]
    let newerVersionRecords = previous?.newerVersionRecords ?? 0
    let invalidLines = previous?.invalidLines ?? 0
    let offset = 0
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== NEWLINE_BYTE) continue
      const line = bytes.subarray(offset, index)
      offset = index + 1
      try {
        if (line.byteLength >= USAGE_RECORD_MAX_BYTES) {
          invalidLines += 1
          continue
        }
        const value: unknown = JSON.parse(decoder.decode(line))
        if (isNewer(value)) {
          newerVersionRecords += 1
          continue
        }
        const result = usageJournalEntrySchema.safeParse(value)
        if (result.success) entries.push(result.data)
        else invalidLines += 1
      } catch {
        invalidLines += 1
      }
    }
    const next = {
      ...stat,
      entries,
      offset: start + offset,
      newerVersionRecords,
      invalidLines,
      tornLines: offset < bytes.length ? 1 : 0,
    }
    this.cache.set(file, next)
    return next
  }
  private async readRollups(): Promise<{ rollups: Rollup[]; newer: number }> {
    const rollups: Rollup[] = []
    let newer = 0
    const names = await this.fs.list(ROLLUPS_ROOT)
    for (const name of names) {
      if (!/^\d{4}-\d{2}\.json$/.test(name)) continue
      const file = `${ROLLUPS_ROOT}/${name}`
      const stat = await this.fs.stat(file)
      if (stat === undefined) continue
      const cached = this.rollupCache.get(file)
      if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        if (cached.rollup === undefined) newer += 1
        else rollups.push(cached.rollup)
        continue
      }
      const value: unknown = JSON.parse(decoder.decode(await this.fs.read(file, 0, stat.size)))
      if (isNewer(value)) {
        newer += 1
        this.rollupCache.set(file, { ...stat, rollup: undefined })
        continue
      }
      const rollup = rollupSchema.parse(value)
      if (`${rollup.month}.json` !== name) throw new Error('invalidRollupMonth')
      this.rollupCache.set(file, { ...stat, rollup })
      rollups.push(rollup)
    }
    return { rollups, newer }
  }
  private async readDay(day: string): Promise<FileCache[]> {
    const files: FileCache[] = []
    const names = await this.fs.list(`${DAYS_ROOT}/${day}`)
    for (const name of names) {
      if (!/^[\w.-]+\.jsonl$/.test(name)) continue
      files.push(await this.readFile(`${DAYS_ROOT}/${day}/${name}`))
    }
    return files
  }
  /** Keeps normalisation, settlement and validation inside the non-failing tap. */
  public noteUsage(usage: Partial<Usage> | undefined, context: UsageRecordContext): void {
    try {
      if (!this.options.isEnabled()) return
      this.append(createUsageRecord(usage, context))
    } catch {
      this.logWriteError()
    }
  }
  /** Fire-and-forget at the model boundary. flush() is for shutdown/tests. */
  public append(input: unknown): void {
    try {
      if (!this.options.isEnabled()) return
      const entry = usageJournalEntrySchema.parse(input)
      const file = `${DAYS_ROOT}/${entry.day}/${this.options.writerId}.jsonl`
      const line = `${JSON.stringify(entry)}\n`
      this.queue = this.write(this.queue, file, line)
    } catch {
      this.logWriteError()
    }
  }
  public async flush(): Promise<void> {
    await this.queue
  }

  public async read(): Promise<UsageJournalRead> {
    const stored = await this.readRollups()
    const covered = new Set(stored.rollups.flatMap((rollup) => rollup.days))
    const records: UsageRecord[] = []
    const limits = stored.rollups.flatMap((rollup) => rollup.limits)
    let newerVersionRecords = 0
    let tornLines = 0
    let invalidLines = 0
    const days = await this.fs.list(DAYS_ROOT)
    for (const day of days) {
      if (!usageDaySchema.safeParse(day).success || covered.has(day)) continue
      const files = await this.readDay(day)
      for (const file of files) {
        newerVersionRecords += file.newerVersionRecords
        tornLines += file.tornLines
        invalidLines += file.invalidLines
        for (const entry of file.entries) {
          if (entry.day !== day) {
            invalidLines += 1
            continue
          }
          if (entry.type === 'usage') records.push(entry)
          else limits.push(entry)
        }
      }
    }
    const rollups = stored.rollups.flatMap((rollup) => rollup.rows)
    return {
      records,
      limits,
      rollups,
      newerVersionRecords,
      newerVersionFiles: stored.newer,
      tornLines,
      invalidLines,
      recordCount:
        records.length +
        limits.length +
        rollups.reduce((count, row) => count + row.records, 0) +
        newerVersionRecords,
    }
  }
  /** Covers a day atomically before deleting it. Bad/future raw data stays untouched. */
  public async retain(historyDays = USAGE_HISTORY_DAYS_DEFAULT): Promise<boolean> {
    z.int().check(z.gte(USAGE_HISTORY_DAYS_MIN), z.lte(USAGE_HISTORY_DAYS_MAX)).parse(historyDays)
    await this.flush()
    const lock = await this.fs.acquireLock(LOCK_FILE, USAGE_ROLLUP_LOCK_STALE_MS)
    if (lock === undefined) return false
    try {
      const stored = await this.readRollups()
      // A newer maintenance format must be handled by its own reader.
      if (stored.newer > 0) return false
      const today = usageLocalDay(this.options.now())
      const detailCutoff = shiftedDay(today, -(USAGE_DETAIL_DAYS - 1))
      const historyCutoff = shiftedDay(today, -(historyDays - 1))
      const months = new Map(stored.rollups.map((rollup) => [rollup.month, rollup]))
      const covered = new Set(stored.rollups.flatMap((rollup) => rollup.days))
      const rawDays = await this.fs.list(DAYS_ROOT)
      for (const day of rawDays) {
        if (!usageDaySchema.safeParse(day).success || day >= detailCutoff) continue
        if (!(await lock.isHeld())) throw new Error('usageLockLost')
        if (!covered.has(day) && day >= historyCutoff) {
          const files = await this.readDay(day)
          if (
            files.some(
              (file) =>
                file.tornLines + file.invalidLines + file.newerVersionRecords > 0 ||
                file.entries.some((entry) => entry.day !== day),
            )
          )
            continue
          if (!(await lock.isHeld())) throw new Error('usageLockLost')
          const month = day.slice(0, 'YYYY-MM'.length)
          const previous = months.get(month) ?? {
            v: USAGE_JOURNAL_VERSION,
            month,
            days: [],
            rows: [],
            limits: [],
          }
          const entries = files.flatMap((file) => file.entries)
          const next: Rollup = {
            ...previous,
            days: [...previous.days, day],
            rows: [
              ...previous.rows,
              ...rollupUsageRecords(entries.filter((entry) => entry.type === 'usage')),
            ],
            limits: [...previous.limits, ...entries.filter((entry) => entry.type === 'limit')],
          }
          await this.fs.writeFileAtomically(
            `${ROLLUPS_ROOT}/${month}.json`,
            `${JSON.stringify(rollupSchema.parse(next))}\n`,
          )
          months.set(month, next)
          covered.add(day)
        }
        if (!(await lock.isHeld())) throw new Error('usageLockLost')
        await this.fs.remove(`${DAYS_ROOT}/${day}`)
        this.cache.clear()
      }
      for (const rollup of months.values()) {
        const days = rollup.days.filter((day) => day >= historyCutoff)
        if (days.length === rollup.days.length) continue
        if (!(await lock.isHeld())) throw new Error('usageLockLost')
        const file = `${ROLLUPS_ROOT}/${rollup.month}.json`
        if (days.length === 0) await this.fs.remove(file)
        else
          await this.fs.writeFileAtomically(
            file,
            `${JSON.stringify({ ...rollup, days, rows: rollup.rows.filter((row) => days.includes(row.day)), limits: rollup.limits.filter((limit) => days.includes(limit.day)) })}\n`,
          )
      }
      return true
    } finally {
      await lock.release()
    }
  }
  /** The service owns count-and-confirm; this method has no path argument. */
  public async reset(): Promise<void> {
    await this.flush()
    const lock = await this.fs.acquireLock(LOCK_FILE, USAGE_ROLLUP_LOCK_STALE_MS)
    if (lock === undefined) throw new Error('usageLocked')
    try {
      if (!(await lock.isHeld())) throw new Error('usageLockLost')
      await this.fs.remove(USAGE_FOLDER)
      this.cache.clear()
      this.rollupCache.clear()
    } finally {
      await lock.release()
    }
  }
}
