// One file per process/day; snapshots and maintenance share a generation lock.
import * as z from 'zod/mini'
import {
  USAGE_DAYS_FOLDER,
  USAGE_DETAIL_DAYS,
  USAGE_FOLDER,
  USAGE_HISTORY_DAY_MIN,
  USAGE_VERSION_FOLDER,
  USAGE_JOURNAL_VERSION,
  USAGE_RECORD_MAX_BYTES,
  USAGE_LINE_FEED_BYTE,
  USAGE_ROLLUPS_FOLDER,
  USAGE_ROLLUP_LOCK,
  USAGE_ROLLUP_LOCK_STALE_MS,
  USAGE_HISTOGRAM_EDGES_MS,
  USAGE_WINDOW_DAY_MS,
} from '../../shared/constants'
import { legacyUsdSchema } from '../../shared/usdSchema'
import { parseJsonWithExactNumbers } from '../../shared/exactJson'
import {
  usageJournalEntrySchema,
  costSchemaWith,
  limitSchemaWith,
  recordSchemaWith,
  usageLimitSnapshotSchema,
  usageAmountSchema,
  usageCountSchema,
  usageCostSchema,
  usageUsdSchema,
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
import { emptyUsageMeasurements, type UsageAggregateRow } from './aggregate'
import { Usd } from '../../shared/usd'

export interface UsageFileStat {
  readonly size: number
  readonly mtimeMs: number
}
export interface UsageLock {
  readonly token: string
  readonly generation: number
  isHeld(): Promise<boolean>
  release(): Promise<void>
}
/** Paths are relative to the private agent data folder; no caller supplies a reset path. */
export interface UsageFs {
  list(folder: string): Promise<readonly string[]>
  stat(file: string): Promise<UsageFileStat | undefined>
  /** No length: read the complete file through one handle, for atomic rollups. */
  read(file: string, offset: number, length?: number): Promise<Uint8Array>
  /**
  `isDurable` flushes the appended bytes to disk before resolving. `commit`,
  a fence (here and below), runs at the last step before the change lands and
  refuses it by throwing.
  */
  append(
    file: string,
    line: string,
    isDurable?: boolean,
    commit?: () => Promise<void>,
  ): Promise<void>
  writeFileAtomically(file: string, text: string, commit?: () => Promise<void>): Promise<void>
  remove(file: string, commit?: () => Promise<void>): Promise<void>
  /** Strictly removes stale quarantined removals in `folder`; a failure throws. */
  sweep?(folder: string): Promise<void>
  acquireLock(file: string, staleMs: number): Promise<UsageLock | undefined>
}
export const USAGE_JOURNAL_ROOT = `${USAGE_FOLDER}/${USAGE_VERSION_FOLDER}`
const DAYS_ROOT = `${USAGE_JOURNAL_ROOT}/${USAGE_DAYS_FOLDER}`
const ROLLUPS_ROOT = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUPS_FOLDER}`
const LOCK_FILE = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUP_LOCK}`
const decoder = new TextDecoder('utf-8', { fatal: true })
// The host constructs one writer per process; even an accidental second
// instance must not repeat a diagnostic that could otherwise flood the log.
const writeDiagnosticState = { hasLogged: false }
// M121: version 1 stored dollars as JSON numbers. They read through
// `legacyUsdSchema` as the decimals they were written as; a line whose written
// digits a number cannot carry is refused (`parseUsageJson`), never rounded.
const USAGE_LEGACY_JOURNAL_VERSION = 1
const usageLegacyCostSchema = costSchemaWith(legacyUsdSchema)
const usageLegacyLimitSnapshotSchema = limitSchemaWith(
  USAGE_LEGACY_JOURNAL_VERSION,
  legacyUsdSchema,
)
// Version 2 predates the limit snapshot's `plan` field but is otherwise
// version 3's shape; the field stays optional, so one schema reads lines
// with and without it and the reader keeps them as the current version.
const USAGE_PREVIOUS_JOURNAL_VERSION = 2
const usagePreviousRecordSchema = recordSchemaWith(USAGE_PREVIOUS_JOURNAL_VERSION, usageCostSchema)
const usagePreviousLimitSnapshotSchema = limitSchemaWith(
  USAGE_PREVIOUS_JOURNAL_VERSION,
  usageUsdSchema,
)
/** A stored line: a current entry, or a version 1 or 2 entry read as current. */
const usageJournalReadSchema = z.union([
  usageJournalEntrySchema,
  z.pipe(
    z.discriminatedUnion('type', [usagePreviousRecordSchema, usagePreviousLimitSnapshotSchema]),
    z.transform((entry): UsageJournalEntry => ({ ...entry, v: USAGE_JOURNAL_VERSION })),
  ),
  z.pipe(
    z.discriminatedUnion('type', [
      recordSchemaWith(USAGE_LEGACY_JOURNAL_VERSION, usageLegacyCostSchema),
      usageLegacyLimitSnapshotSchema,
    ]),
    z.transform((entry): UsageJournalEntry => ({ ...entry, v: USAGE_JOURNAL_VERSION })),
  ),
])
const histogramSchema = z
  .array(usageCountSchema)
  .check(z.length(USAGE_HISTOGRAM_EDGES_MS.length + 1))
function rollupRowSchemaWith<C extends typeof usageCostSchema | typeof usageLegacyCostSchema>(
  cost: C,
) {
  return z.strictObject({
    day: usageDaySchema,
    client: usageLabelSchema,
    backend: z.enum(['museCode', 'modelApi']),
    provider: usageLabelSchema,
    model: usageLabelSchema,
    kind: usageKindSchema,
    records: usageCountSchema,
    tokens: usageTokensSchema,
    units: usageUnitsSchema,
    cost,
    durationMs: z.optional(usageAmountSchema),
    firstTokenMs: z.optional(usageAmountSchema),
    packedAvoided: z.optional(usageCountSchema),
    retries: usageCountSchema,
    rateLimited: usageCountSchema,
    latencyHistogram: histogramSchema,
    durationSamples: usageCountSchema,
    firstTokenSamples: usageCountSchema,
    // Optional for existing v1 files, whose independent sums cannot recover paired rates.
    measurements: z.optional(
      z.strictObject({
        cache: z.strictObject({
          records: usageCountSchema,
          input: usageCountSchema,
          cached: usageCountSchema,
        }),
        speed: z.strictObject({
          records: usageCountSchema,
          output: usageCountSchema,
          durationMs: usageAmountSchema,
        }),
        latency: z.strictObject({ records: usageCountSchema, durationMs: usageAmountSchema }),
        firstToken: z.strictObject({ records: usageCountSchema, firstTokenMs: usageAmountSchema }),
      }),
    ),
  })
}
export const usageRollupRowSchema = rollupRowSchemaWith(usageCostSchema)
export type UsageRollupRow = z.infer<typeof usageRollupRowSchema>
function rollupSchemaWith<
  V extends number,
  C extends typeof usageCostSchema | typeof usageLegacyCostSchema,
  L extends
    | typeof usageLimitSnapshotSchema
    | typeof usagePreviousLimitSnapshotSchema
    | typeof usageLegacyLimitSnapshotSchema,
>(version: V, cost: C, limit: L) {
  return z
    .strictObject({
      v: z.literal(version),
      month: z.string().check(z.regex(/^\d{4}-\d{2}$/)),
      days: z.array(usageDaySchema),
      rows: z.array(rollupRowSchemaWith(cost)),
      limits: z.array(limit),
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
}
const rollupSchema = rollupSchemaWith(
  USAGE_JOURNAL_VERSION,
  usageCostSchema,
  usageLimitSnapshotSchema,
)
type Rollup = z.infer<typeof rollupSchema>
const previousRollupSchema = rollupSchemaWith(
  USAGE_PREVIOUS_JOURNAL_VERSION,
  usageCostSchema,
  usagePreviousLimitSnapshotSchema,
)
const legacyRollupSchema = rollupSchemaWith(
  USAGE_LEGACY_JOURNAL_VERSION,
  usageLegacyCostSchema,
  usageLegacyLimitSnapshotSchema,
)
/** An older month reads as current with the same exact decimals (M121, T7);
the next retention that changes it writes it back as current. */
function rollupToCurrent(
  rollup: z.infer<typeof previousRollupSchema> | z.infer<typeof legacyRollupSchema>,
): Rollup {
  return {
    ...rollup,
    v: USAGE_JOURNAL_VERSION,
    limits: rollup.limits.map((limit) => ({ ...limit, v: USAGE_JOURNAL_VERSION })),
  }
}
// A version 1 month reads as current with the same exact decimals (M121);
// the next retention that changes it writes it back as current.
const rollupReadSchema = z.union([
  rollupSchema,
  z.pipe(
    previousRollupSchema,
    z.transform((rollup) => rollupToCurrent(rollup)),
  ),
  z.pipe(
    legacyRollupSchema,
    z.transform((rollup) => rollupToCurrent(rollup)),
  ),
])
// Refusal counts need only metadata, never validation of the unproved money.
const rollupCountSchema = z.object({
  rows: z.array(z.object({ records: usageCountSchema })),
  limits: z.array(z.unknown()),
})
/** Dollar fields version 1 wrote as JSON numbers (records, limits and rollups). */
const USAGE_LEGACY_MONEY_KEYS: ReadonlySet<string> = new Set([
  'usd',
  'apiEquivalentUsd',
  'usedUsd',
  'limitUsd',
  'remainingUsd',
])
/**
Parse stored JSON. A version 1 dollar is exact only when the number it
parses to has the same decimal value as the digits written: 0.17 wrote
JSON.stringify's shortest spelling, which always does; digits beyond a
double (an edited or foreign file) do not, and `isExact` is false so the
reader refuses the record instead of rounding it. The written digits come
from `parseJsonWithExactNumbers`, never the reviver's source text, so the
refusal holds on Node 20 as well as newer runtimes (M121 P2-1).
*/
function parseUsageJson(text: string): { readonly value: unknown; readonly isExact: boolean } {
  return parseJsonWithExactNumbers(text, USAGE_LEGACY_MONEY_KEYS)
}

const versionSchema = z.object({ v: z.int().check(z.gte(1)) })
interface FileCache extends UsageFileStat {
  readonly offset: number
  readonly entries: UsageJournalEntry[]
  readonly newerVersionRecords: number
  readonly tornLines: number
  readonly invalidLines: number
  readonly inexactRecords: number
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
  /**
  Version 1 records (lines, or a month's rollup rows) whose written dollars
  a number cannot carry: refused and named on the page, never rounded (M121).
  */
  readonly inexactRecords: number
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
/**
Adapt a validated stored rollup without inventing unknown paired rates
(C-M113-2 shares this with the usage service instead of copying it).
*/
export function toAggregateRow(row: UsageRollupRow): UsageAggregateRow {
  return {
    day: row.day,
    client: row.client,
    backend: row.backend,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    histogram: row.latencyHistogram,
    ...(row.measurements !== undefined && { measurements: row.measurements }),
    totals: {
      records: row.records,
      tokens: row.tokens,
      units: row.units,
      costs: [
        {
          certainty: row.cost.certainty,
          records: row.records,
          ...(row.cost.usd !== undefined && { usd: row.cost.usd }),
          ...(row.cost.apiEquivalentUsd !== undefined && {
            apiEquivalentUsd: row.cost.apiEquivalentUsd,
          }),
        },
      ],
      retries: row.retries,
      rateLimited: row.rateLimited,
      ...(row.durationMs !== undefined && { durationMs: row.durationMs }),
      ...(row.firstTokenMs !== undefined && { firstTokenMs: row.firstTokenMs }),
      ...(row.packedAvoided !== undefined && { packedAvoided: row.packedAvoided }),
    },
  }
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
      const amount = record.cost[field]
      if (amount === undefined) continue
      // Exact decimal sums (M121); version 1 rollups rounded to micro-dollars.
      row.cost[field] = Usd.from(row.cost[field] ?? 0)
        .add(Usd.from(amount))
        .toAmount()
    }
    const measurements = (row.measurements ??= emptyUsageMeasurements())
    if (record.tokens.input !== undefined && record.tokens.cached !== undefined) {
      measurements.cache.records += 1
      measurements.cache.input += record.tokens.input
      measurements.cache.cached += record.tokens.cached
    }
    if (record.tokens.output !== undefined && record.durationMs !== undefined) {
      measurements.speed.records += 1
      measurements.speed.output += record.tokens.output
      measurements.speed.durationMs += record.durationMs
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
      measurements.latency.records += 1
      measurements.latency.durationMs += record.durationMs
    }
    if (record.firstTokenMs === undefined) continue
    row.firstTokenSamples += 1
    measurements.firstToken.records += 1
    measurements.firstToken.firstTokenMs += record.firstTokenMs
  }
  const result: UsageRollupRow[] = []
  rows.forEach((row) => {
    result.push(row)
  })
  return result
}

/**
The lock went away mid-read: the snapshot may mix generations, so the
read retries once with cold caches instead of returning it. Caught by
identity in `read` only; it never surfaces to a caller.
*/
class UsageLockRacedError extends Error {}

export class UsageJournalStore {
  private readonly cache = new Map<string, FileCache>()
  private readonly rollupCache = new Map<
    string,
    UsageFileStat & { readonly rollup: Rollup | undefined; readonly inexact: number }
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
      // Diagnostics cannot fail a model call: the once-only write error stands in.
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
        inexactRecords: 0,
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
    let inexactRecords = previous?.inexactRecords ?? 0
    let offset = 0
    // Native byte search avoids instrumenting one JavaScript iteration per byte
    // in large cold scans; offsets still advance only over complete lines.
    for (
      let index = bytes.indexOf(USAGE_LINE_FEED_BYTE);
      index !== -1;
      index = bytes.indexOf(USAGE_LINE_FEED_BYTE, offset)
    ) {
      const line = bytes.subarray(offset, index)
      offset = index + 1
      let text: string
      try {
        text = decoder.decode(line)
      } catch (error) {
        // Bytes that are not UTF-8 are not a line: the line counts invalid
        // and the scan moves on; anything else keeps its kind past the journal.
        if (error instanceof TypeError) {
          invalidLines += 1
          continue
        }
        throw error
      }
      try {
        if (line.byteLength >= USAGE_RECORD_MAX_BYTES) {
          invalidLines += 1
          continue
        }
        const { value, isExact } = parseUsageJson(text)
        if (isNewer(value)) {
          newerVersionRecords += 1
          continue
        }
        if (!isExact) {
          inexactRecords += 1
          continue
        }
        const result = usageJournalReadSchema.safeParse(value)
        if (result.success) entries.push(result.data)
        else invalidLines += 1
      } catch (error) {
        // Malformed JSON counts the line invalid and the scan moves on;
        // anything else keeps its kind past the journal.
        if (error instanceof SyntaxError) {
          invalidLines += 1
          continue
        }
        throw error
      }
    }
    const next = {
      ...stat,
      entries,
      offset: start + offset,
      newerVersionRecords,
      invalidLines,
      inexactRecords,
      tornLines: offset < bytes.length ? 1 : 0,
    }
    this.cache.set(file, next)
    return next
  }
  private async readRollups(): Promise<{ rollups: Rollup[]; newer: number; inexact: number }> {
    const rollups: Rollup[] = []
    let newer = 0
    let inexact = 0
    const names = await this.fs.list(ROLLUPS_ROOT)
    for (const name of names) {
      if (!/^\d{4}-\d{2}\.json$/.test(name)) continue
      const file = `${ROLLUPS_ROOT}/${name}`
      const stat = await this.fs.stat(file)
      if (stat === undefined) continue
      const cached = this.rollupCache.get(file)
      if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        if (cached.inexact > 0) inexact += cached.inexact
        else if (cached.rollup === undefined) newer += 1
        else rollups.push(cached.rollup)
        continue
      }
      const { value, isExact } = parseUsageJson(decoder.decode(await this.fs.read(file, 0)))
      if (isNewer(value)) {
        newer += 1
        this.rollupCache.set(file, { ...stat, rollup: undefined, inexact: 0 })
        continue
      }
      if (!isExact) {
        // The whole month is refused, and kept untouched for a later reader.
        const metadata = rollupCountSchema.safeParse(value)
        const count = metadata.success
          ? Math.max(
              1,
              metadata.data.rows.reduce((total, row) => total + row.records, 0) +
                metadata.data.limits.length,
            )
          : 1
        inexact += count
        this.rollupCache.set(file, { ...stat, rollup: undefined, inexact: count })
        continue
      }
      const rollup = rollupReadSchema.parse(value)
      if (`${rollup.month}.json` !== name) throw new Error('invalidRollupMonth')
      this.rollupCache.set(file, { ...stat, rollup, inexact: 0 })
      rollups.push(rollup)
    }
    return { rollups, newer, inexact }
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
  private async readSnapshot(): Promise<UsageJournalRead> {
    const stored = await this.readRollups()
    const covered = new Set(stored.rollups.flatMap((rollup) => rollup.days))
    const records: UsageRecord[] = []
    const limits = stored.rollups.flatMap((rollup) => rollup.limits)
    let newerVersionRecords = 0
    let tornLines = 0
    let invalidLines = 0
    let inexactRecords = stored.inexact
    const days = await this.fs.list(DAYS_ROOT)
    for (const day of days) {
      if (!usageDaySchema.safeParse(day).success || covered.has(day)) continue
      const files = await this.readDay(day)
      for (const file of files) {
        newerVersionRecords += file.newerVersionRecords
        tornLines += file.tornLines
        invalidLines += file.invalidLines
        inexactRecords += file.inexactRecords
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
      inexactRecords,
      recordCount:
        records.length +
        limits.length +
        rollups.reduce((count, row) => count + row.records, 0) +
        newerVersionRecords +
        inexactRecords,
    }
  }
  /** Keeps normalisation, settlement and validation inside the non-failing tap. */
  public noteUsage(usage: Partial<Usage> | undefined, context: UsageRecordContext): void {
    try {
      if (!this.options.isEnabled()) return
      this.append(createUsageRecord(usage, context))
    } catch {
      // Diagnostics cannot fail a model call: the once-only write error stands in.
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
      // Diagnostics cannot fail a model call: the once-only write error stands in.
      this.logWriteError()
    }
  }
  public async flush(): Promise<void> {
    await this.queue
  }

  public async read(): Promise<UsageJournalRead> {
    // A stale lease may be reclaimed while a process is paused. Never return
    // bytes gathered across generations; retry once, including a raced parse.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const lock = await this.fs.acquireLock(LOCK_FILE, USAGE_ROLLUP_LOCK_STALE_MS)
        if (lock === undefined) throw new Error('usageLocked')
        try {
          const snapshot = await this.readSnapshot()
          if (await lock.isHeld()) return snapshot
        } catch (error) {
          // The lock went away mid-read: the snapshot may mix generations,
          // so it never returns. A held lock means the read itself failed,
          // which keeps its kind.
          if (await lock.isHeld()) throw error
          throw new UsageLockRacedError('usageLockRaced', { cause: error })
        } finally {
          await lock.release()
        }
        this.cache.clear()
        this.rollupCache.clear()
      } catch (error) {
        // A raced lock retries once with cold caches; anything else,
        // including a second race, keeps its kind.
        if (!(error instanceof UsageLockRacedError)) throw error
        this.cache.clear()
        this.rollupCache.clear()
      }
    }
    throw new Error('usageLockLost')
  }
  /**
  Covers a day atomically before deleting it. Bad/future raw data stays
  untouched. NOLIMITSSET (PLAN.md D121): null keeps every rolled-up day —
  history is kept until the person sets a day count or clears it; a set
  whole number of days of at least 1 trims as set.
  */
  public async retain(historyDays: number | null = null): Promise<boolean> {
    if (historyDays !== null) z.int().check(z.gte(USAGE_HISTORY_DAY_MIN)).parse(historyDays)
    await this.flush()
    const lock = await this.fs.acquireLock(LOCK_FILE, USAGE_ROLLUP_LOCK_STALE_MS)
    if (lock === undefined) return false
    try {
      const stored = await this.readRollups()
      // A newer maintenance format must be handled by its own reader.
      // So is a refused month: rewriting it would lose what it holds.
      if (stored.newer > 0 || stored.inexact > 0) return false
      const today = usageLocalDay(this.options.now())
      const detailCutoff = shiftedDay(today, -(USAGE_DETAIL_DAYS - 1))
      const historyCutoff = historyDays === null ? null : shiftedDay(today, -(historyDays - 1))
      const months = new Map(stored.rollups.map((rollup) => [rollup.month, rollup]))
      const covered = new Set(stored.rollups.flatMap((rollup) => rollup.days))
      const rawDays = await this.fs.list(DAYS_ROOT)
      for (const day of rawDays) {
        if (!usageDaySchema.safeParse(day).success || day >= detailCutoff) continue
        if (!(await lock.isHeld())) throw new Error('usageLockLost')
        if (!covered.has(day) && (historyCutoff === null || day >= historyCutoff)) {
          const files = await this.readDay(day)
          if (
            files.some(
              (file) =>
                file.tornLines +
                  file.invalidLines +
                  file.newerVersionRecords +
                  file.inexactRecords >
                  0 || file.entries.some((entry) => entry.day !== day),
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
        const days =
          historyCutoff === null ? rollup.days : rollup.days.filter((day) => day >= historyCutoff)
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
