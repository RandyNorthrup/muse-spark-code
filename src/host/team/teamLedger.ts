// The team ledger (M96 lane A, PLAN.md D75): the durable record behind the
// Agent map's live and history views. Every delegation is one row, kept per
// workspace beside the session store, in an append-only file per local day.
// Each window writes only its own folder; reads
// take the latest row per task, and a crashed writer's partial tail line is
// skipped, never fatal. Rows flush at state changes and at least every
// TEAM_LEDGER_FLUSH_MS, so partial usage survives a crash; files older than
// `museSpark.cleanupPeriodDays` are rolled into per-entry totals rows and
// removed, so a spent `lifetime` cap never refills. The brief is redacted
// and bounded; no other prompt text or code is stored.
//
// Host-side (Node fs), but every row validates with a zod schema before use
// (AGENTS rule 7), and the meter reads rows through teamMeter's structural
// view. No `vscode` here.

import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { storeErrorCode } from '../backend/storeErrors'
import * as z from 'zod/mini'
import type { CoreLogger } from '../../core/logging'
import { redactSecrets } from '../../core/redact'
import {
  teamDayKey,
  type TeamMeterRow,
  type TeamMeterUsage,
  ZERO_TEAM_METER_USAGE,
} from '../../core/team/teamMeter'
import type { TeamWindow } from '../../core/team/teamPool'
import {
  MILLISECONDS_PER_DAY,
  TEAM_LEDGER_BRIEF_MAX_CHARS,
  TEAM_LEDGER_FILE_PREFIX,
  TEAM_LEDGER_FILE_SUFFIX,
  TEAM_LEDGER_LINE_MAX_BYTES,
  TEAM_LEDGER_RETRY_MAX_MS,
  UI_TEXT,
} from '../../shared/constants'

/** A task's live state (D75): active until one of the inactive states. */
export const teamLedgerStatuses = [
  'queued',
  'running',
  'waitingApproval',
  'throttled',
  'finished',
  'failed',
  'stopped',
  'exhausted',
  'interrupted',
] as const
export type TeamLedgerStatus = (typeof teamLedgerStatuses)[number]

/** The terminal outcome, kept with the row once the task ends. */
export const teamLedgerOutcomes = [
  'merged',
  'discarded',
  'failed',
  'stopped',
  'capped',
  'cancelled',
  'interrupted',
] as const
export type TeamLedgerOutcome = (typeof teamLedgerOutcomes)[number]

const teamUsageSchema = z.object({
  inputTokens: z.number().check(z.nonnegative()),
  cachedInputTokens: z.number().check(z.nonnegative()),
  outputTokens: z.number().check(z.nonnegative()),
  reasoningTokens: z.number().check(z.nonnegative()),
  calls: z.number().check(z.nonnegative()),
  costUsd: z.number().check(z.nonnegative()),
  tasks: z.number().check(z.nonnegative()),
  hookTokens: z.number().check(z.nonnegative()),
  paidToolTokens: z.number().check(z.nonnegative()),
})

const teamSettingSchema = z.object({
  name: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
})

const teamLinksSchema = z.object({
  transcript: z.optional(z.string()),
  diff: z.optional(z.string()),
  findings: z.optional(z.string()),
})

const ownerIdSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/))
const dayKeySchema = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))
const recoveryDecisionSchema = z.object({ kind: z.literal('userTakeover'), ownerId: ownerIdSchema })
export type TeamRecoveryDecision = z.infer<typeof recoveryDecisionSchema>

const teamLeaseSchema = z.object({
  holder: z.string(),
  sinceMs: z.number(),
})

export const teamLedgerRowSchema = z.object({
  version: z.literal(1),
  kind: z.union([z.literal('task'), z.literal('totals'), z.literal('reset')]),
  taskId: z.string(),
  workspaceId: z.string(),
  roleId: z.string(),
  entryId: z.string(),
  agentKey: z.string(),
  modelId: z.string(),
  provider: z.string(),
  billing: z.union([z.literal('key'), z.literal('subscription'), z.literal('local')]),
  settings: z.array(teamSettingSchema),
  workspaceMode: z.union([z.literal('read-only'), z.literal('own-branch'), z.literal('in-place')]),
  branch: z.optional(z.string()),
  brief: z.string(),
  reasonCode: z.string(),
  dayKey: dayKeySchema,
  startMs: z.number(),
  endMs: z.optional(z.number()),
  status: z.enum(teamLedgerStatuses),
  outcome: z.optional(z.nullable(z.enum(teamLedgerOutcomes))),
  usage: teamUsageSchema,
  estimated: z.boolean(),
  links: teamLinksSchema,
  lease: teamLeaseSchema,
  continuedFrom: z.optional(z.string()),
  interruptedMaybeOpen: z.optional(z.boolean()),
  recoveryDecision: z.optional(recoveryDecisionSchema),
  sourceTaskId: z.optional(z.string()),
  clearedWindow: z.optional(z.nullable(z.enum(['task', 'day', 'lifetime']))),
  clearedEntryId: z.optional(z.string()),
  clearedUsage: z.optional(
    z.array(
      z.object({
        entryId: z.string(),
        taskId: z.string(),
        dayKey: dayKeySchema,
        usage: teamUsageSchema,
      }),
    ),
  ),
})
export type TeamLedgerRow = z.infer<typeof teamLedgerRowSchema>

/** What `record` takes: the row without the stored envelope. */
export type TeamLedgerRecord = Omit<TeamLedgerRow, 'version' | 'dayKey'> & {
  /** Defaults to the local day of `startMs`. */
  readonly dayKey?: string
}

export interface TeamLedgerDeps {
  readonly log: CoreLogger
  /** Workspace root; owned daily files live beneath <directory>/<windowId>/. */
  readonly directory: string
  readonly workspaceId: string
  /** This window's instance id: the lease holder its rows carry. */
  readonly windowId: string
  readonly now: () => number
  /** Usage-only updates flush at least this often (TEAM_LEDGER_FLUSH_MS). */
  readonly flushMs: number
  /** Files older than this many days roll up and are removed; 0 keeps everything. */
  readonly retentionDays: number
}

export interface TeamLedgerRead {
  readonly rows: readonly TeamLedgerRow[]
  /** Lines skipped: a crashed writer's partial tail, never fatal. */
  readonly skippedLines: number
}

/** D75's active states: running, waiting for approval, queued, throttled. */
const activeLedgerStatuses: ReadonlySet<TeamLedgerStatus> = new Set([
  'queued',
  'running',
  'waitingApproval',
  'throttled',
])

/** Whether a status is live (D75's active states). */
export function isTeamLedgerActive(status: TeamLedgerStatus): boolean {
  return activeLedgerStatuses.has(status)
}

function fileFor(directory: string, dayKey: string): string {
  return path.join(directory, `${TEAM_LEDGER_FILE_PREFIX}${dayKey}${TEAM_LEDGER_FILE_SUFFIX}`)
}

/** Day files read oldest first, so the latest row per task wins. */
function compareFileNames(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

function dayKeyOfFile(name: string): string | undefined {
  return name.startsWith(TEAM_LEDGER_FILE_PREFIX) && name.endsWith(TEAM_LEDGER_FILE_SUFFIX)
    ? name.slice(TEAM_LEDGER_FILE_PREFIX.length, -TEAM_LEDGER_FILE_SUFFIX.length)
    : undefined
}

export class TeamLedger {
  /** The latest row per task id: state changes append, so last wins. */
  public static latestByTask(rows: readonly TeamLedgerRow[]): Map<string, TeamLedgerRow> {
    const latest = new Map<string, TeamLedgerRow>()
    for (const row of rows) {
      const kept = latest.get(row.taskId)
      // A takeover supersedes its source even when folder order puts the source last.
      if (kept?.recoveryDecision?.ownerId !== row.lease.holder) latest.set(row.taskId, row)
    }
    return latest
  }

  private readonly pending = new Map<string, string[]>()
  private readonly lastStatus = new Map<string, TeamLedgerStatus>()
  private timer: NodeJS.Timeout | undefined
  private timerStarted = false
  private generation = 0
  private publishedGeneration = 0
  /** Serialises flushes: one window's append lands whole. */
  private flushing: Promise<void> = Promise.resolve()

  private readonly ownedDirectory: string

  public constructor(private readonly deps: TeamLedgerDeps) {
    this.ownedDirectory = path.join(deps.directory, ownerIdSchema.parse(deps.windowId))
  }

  private async readOne(name: string): Promise<TeamLedgerRead> {
    const rows: TeamLedgerRow[] = []
    let skippedLines = 0
    const text = await readFile(path.join(this.ownedDirectory, name), 'utf8')
    for (const line of text.split('\n')) {
      if (line === '') {
        continue
      }
      const parsed = safeParseLine(line)
      if (parsed === undefined) {
        skippedLines += 1
      } else {
        rows.push(parsed)
      }
    }
    return { rows, skippedLines }
  }

  /** One publication, including its acknowledgement or requeue, after the previous one settles. */
  private async queued<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.flushing
    const run = (async () => {
      await previous
      return await work()
    })()
    this.flushing = settled(run)
    return await run
  }

  private async appendLines(dayKey: string, lines: readonly string[]): Promise<void> {
    const text = lines.join('')
    await mkdir(this.ownedDirectory, { recursive: true })
    const file = await open(fileFor(this.ownedDirectory, dayKeySchema.parse(dayKey)), 'a')
    try {
      // Separate a previous crashed writer's partial tail from the next whole row.
      await file.appendFile(`\n${text}`, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (!this.timerStarted) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.periodicFlush(delayMs)
    }, delayMs)
    this.timer.unref()
  }

  private async periodicFlush(delayMs: number): Promise<void> {
    let nextDelay = this.deps.flushMs
    try {
      await this.flush()
    } catch {
      // Fixed words: neither an account/path nor arbitrary filesystem text reaches logs.
      this.deps.log.warn('Team ledger publication failed; retrying')
      nextDelay = Math.min(TEAM_LEDGER_RETRY_MAX_MS, delayMs * 2)
    }
    this.scheduleFlush(nextDelay)
  }

  /** Called only inside the publication queue, including Reset's baseline capture. */
  private async flushPending(): Promise<void> {
    if (this.generation <= this.publishedGeneration && this.pending.size === 0) return
    const snapshotGeneration = this.generation
    const batches = [...this.pending]
    this.pending.clear()
    for (const [index, [dayKey, lines]] of batches.entries()) {
      try {
        await this.appendLines(dayKey, lines)
      } catch (error: unknown) {
        // Requeue before a newer generation can publish: older state always precedes it.
        for (const [pendingDay, pendingLines] of batches.slice(index)) {
          this.pending.set(pendingDay, [...pendingLines, ...(this.pending.get(pendingDay) ?? [])])
        }
        throw error
      }
    }
    this.publishedGeneration = snapshotGeneration
  }

  /** Retention runs in the same publication queue as snapshots and Reset. */
  private async prunePublished(): Promise<{ readonly rolled: number; readonly removed: number }> {
    const read = await this.read()
    const latest = TeamLedger.latestByTask(read.rows)
    const cutoff = teamDayKey(this.deps.now() - this.deps.retentionDays * MILLISECONDS_PER_DAY)
    let names: string[]
    try {
      names = await readdir(this.ownedDirectory)
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT') throw error
      return { rolled: 0, removed: 0 }
    }
    let rolled = 0
    let removed = 0
    for (const name of names.toSorted(compareFileNames)) {
      const dayKey = dayKeyOfFile(name)
      if (dayKey === undefined || dayKey >= cutoff) {
        continue
      }
      const { rows } = await this.readOne(name)
      if (
        Array.from(TeamLedger.latestByTask(rows), ([, row]) => row).some(
          (row) =>
            row.kind === 'task' && isTeamLedgerActive(latest.get(row.taskId)?.status ?? row.status),
        )
      )
        continue
      // Rollups keep their old day (day caps never reread them) but live in
      // today's file, so removing the old file loses nothing.
      const lines = Array.from(rollUp(rows, latest), (rollup) => toLedgerLine(rollup))
      if (lines.length > 0) {
        await this.appendLines(teamDayKey(this.deps.now()), lines)
        rolled += lines.length
      }
      await rm(path.join(this.ownedDirectory, name), { force: true })
      removed += 1
    }
    return { rolled, removed }
  }

  /** Validates and enqueues a snapshot while the publication queue is held. */
  private async recordPending(candidate: string): Promise<void> {
    const parsed = teamLedgerRowSchema.safeParse(JSON.parse(candidate) as unknown)
    if (!parsed.success) {
      throw new Error(`Team ledger row is invalid: ${z.prettifyError(parsed.error)}`)
    }
    if (
      parsed.data.workspaceId !== this.deps.workspaceId ||
      (parsed.data.kind === 'task' && parsed.data.lease.holder !== this.deps.windowId)
    ) {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    let line = toLedgerLine(parsed.data)
    if (parsed.data.kind === 'reset') {
      await this.flushPending()
      const { rows } = await this.read()
      line = toLedgerLine({
        ...parsed.data,
        clearedUsage: ledgerMeterRows(rows)
          .filter(
            (row) =>
              row.kind !== 'reset' &&
              (parsed.data.clearedEntryId === undefined ||
                row.entryId === parsed.data.clearedEntryId) &&
              row.startMs < parsed.data.startMs,
          )
          .map((row) => ({
            entryId: row.entryId,
            taskId: row.taskId,
            dayKey: row.dayKey,
            usage: row.usage,
          })),
      })
    }
    const previous = this.lastStatus.get(parsed.data.taskId)
    this.lastStatus.set(parsed.data.taskId, parsed.data.status)
    const lines = this.pending.get(parsed.data.dayKey) ?? []
    lines.push(line)
    this.pending.set(parsed.data.dayKey, lines)
    this.generation += 1
    if (previous === undefined || previous !== parsed.data.status) {
      await this.flushPending()
    }
  }

  /** Starts the flush timer: usage rows land at least every `flushMs`. */
  public start(): void {
    if (this.timerStarted) return
    this.timerStarted = true
    this.scheduleFlush(this.deps.flushMs)
  }

  /** Stops the timer after flushing what is pending, including an in-flight publication. */
  public async dispose(): Promise<void> {
    this.timerStarted = false
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    await this.flush()
  }

  /**
   * Appends a row version: state changes (and ends) flush at once, usage
   * updates wait for the timer. The brief is redacted and bounded here, so
   * no secret and no other prompt text reaches the file.
   */
  public async record(record: TeamLedgerRecord): Promise<void> {
    const candidate = toLedgerLine(record)
    await this.queued(() => this.recordPending(candidate))
  }

  /** Serializes the whole snapshot, acknowledgement and retry, never just one day's append. */
  public async flush(): Promise<void> {
    await this.queued(() => this.flushPending())
  }

  /**
   * Every row of every day file, validated: malformed lines (a crashed
   * writer's partial tail) are skipped and counted, never fatal. Callers
   * take the latest row per task id.
   */
  public async read(): Promise<TeamLedgerRead> {
    const rows: TeamLedgerRow[] = []
    let skippedLines = 0
    // Legacy shared files remain readable but are never written or pruned.
    const roots = [this.deps.directory]
    const owners = await ledgerNames(this.deps.directory)
    for (const item of owners) {
      if (item.isDirectory() && ownerIdSchema.safeParse(item.name).success)
        roots.push(path.join(this.deps.directory, item.name))
    }
    for (const directory of roots) {
      const names = await ledgerNames(directory)
      const sorted = names.toSorted((left, right) => compareFileNames(left.name, right.name))
      for (const item of sorted) {
        if (!item.isFile() || dayKeyOfFile(item.name) === undefined) continue
        const text = await readFile(path.join(directory, item.name), 'utf8')
        for (const line of text.split('\n')) {
          if (line === '') continue
          const parsed = safeParseLine(line)
          if (parsed === undefined) skippedLines += 1
          else {
            rows.push(parsed)
            if (parsed.kind === 'task' && parsed.lease.holder === this.deps.windowId)
              this.lastStatus.set(parsed.taskId, parsed.status)
          }
        }
      }
    }
    return { rows, skippedLines }
  }

  /**
   * Marks a task interrupted after its window died, with its partial usage:
   * appends a terminal snapshot only while the latest row is still active.
   * A foreign owner needs the explicit Take over decision. Hints never
   * authorize recovery. The source remains byte-exact; this window appends
   * its own snapshot and records the decision as a decision, not proof.
   */
  public async markInterrupted(
    latest: TeamLedgerRow,
    usage: TeamMeterUsage,
    isEstimated: boolean,
    decision: TeamRecoveryDecision | undefined,
  ): Promise<boolean> {
    if (
      latest.kind !== 'task' ||
      !isTeamLedgerActive(latest.status) ||
      (latest.lease.holder !== this.deps.windowId &&
        (decision?.kind !== 'userTakeover' || decision.ownerId !== latest.lease.holder))
    ) {
      return false
    }
    return await this.queued(async () => {
      await this.flushPending()
      const { rows } = await this.read()
      const current = TeamLedger.latestByTask(rows).get(latest.taskId)
      // A changed snapshot needs a fresh recovery decision, never stale accounting.
      if (
        current?.workspaceId !== this.deps.workspaceId ||
        !isTeamLedgerActive(current.status) ||
        JSON.stringify(current) !== JSON.stringify(latest)
      ) {
        return false
      }
      await this.recordPending(
        toLedgerLine({
          ...current,
          endMs: this.deps.now(),
          status: 'interrupted',
          outcome: 'interrupted',
          usage,
          estimated: isEstimated,
          ...(decision !== undefined && { recoveryDecision: decision }),
          lease: { holder: this.deps.windowId, sinceMs: this.deps.now() },
        }),
      )
      return true
    })
  }

  /**
   * Rolls files older than `retentionDays` into per-entry totals rows of
   * their own (kept until Reset, so a spent `lifetime` cap never refills)
   * and removes the old files. With 0, everything is kept.
   */
  public async prune(): Promise<{ readonly rolled: number; readonly removed: number }> {
    if (this.deps.retentionDays <= 0) {
      return { rolled: 0, removed: 0 }
    }
    await this.flush()
    return await this.queued(async () => {
      // Usage may have queued after the preliminary flush; roll up only its durable version.
      await this.flushPending()
      return await this.prunePublished()
    })
  }
}

/** Settles when the promise does, never rejecting: its caller has the failure. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch {
    // Reported to the one who awaited it.
  }
}

/** Parses one file line: undefined for a crashed writer's partial tail. */
function safeParseLine(line: string): TeamLedgerRow | undefined {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch {
    return undefined
  }
  const parsed = teamLedgerRowSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Serialises a record: redacted, bounded and validated at the call site. */
function toLedgerLine(record: TeamLedgerRecord): string {
  const brief = redactSecrets(record.brief).slice(0, TEAM_LEDGER_BRIEF_MAX_CHARS)
  const row: TeamLedgerRow = {
    ...record,
    version: 1,
    dayKey: record.dayKey ?? teamDayKey(record.startMs),
    brief,
  }
  const line = `${JSON.stringify(row)}\n`
  if (Buffer.byteLength(line) > TEAM_LEDGER_LINE_MAX_BYTES) {
    throw new Error('Team ledger row exceeds the line bound')
  }
  return line
}

/** One deterministic rollup per terminal delegation preserves reset boundaries.
 * Repeating a prune after an interrupted removal writes the same identities.
 */
function rollUp(
  rows: readonly TeamLedgerRow[],
  latest: ReadonlyMap<string, TeamLedgerRow>,
): TeamLedgerRecord[] {
  return Array.from(TeamLedger.latestByTask(rows), ([, row]) => row).map((row) =>
    row.kind === 'task'
      ? {
          ...row,
          kind: 'totals',
          status: latest.get(row.taskId)?.status ?? row.status,
          outcome: latest.get(row.taskId)?.outcome ?? row.outcome,
          sourceTaskId: row.taskId,
          taskId: `totals:${row.taskId}:${row.entryId}:${row.dayKey}`,
          brief: '',
          links: {},
          reasonCode: 'retention',
        }
      : row,
  )
}

async function ledgerNames(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (error: unknown) {
    if (storeErrorCode(error) === 'ENOENT') return []
    throw error
  }
}

/** A ledger read as the meter's source: task and totals rows in meter shape. */
export function ledgerMeterRows(rows: readonly TeamLedgerRow[]): TeamMeterRow[] {
  const latest = new Map<string, TeamLedgerRow>()
  for (const row of rows) {
    const key = `${row.workspaceId}\n${row.entryId}\n${row.dayKey}\n${row.sourceTaskId ?? row.taskId}`
    const kept = latest.get(key)
    // A recreated source task has settled since its same-owner retention rollup.
    const isSupersededRollup =
      kept?.kind === 'task' && row.kind === 'totals' && kept.lease.holder === row.lease.holder
    if (!isSupersededRollup && kept?.recoveryDecision?.ownerId !== row.lease.holder)
      latest.set(key, row)
  }
  return Array.from(latest, ([, row]) => row).map((row) => ({
    kind: row.kind,
    entryId: row.entryId,
    agentKey: row.agentKey,
    roleId: row.roleId,
    taskId: row.sourceTaskId ?? row.taskId,
    dayKey: row.dayKey,
    startMs: row.startMs,
    usage: row.usage,
    estimated: row.estimated,
    ...(row.clearedWindow !== undefined &&
      row.clearedWindow !== null && { clearedWindow: row.clearedWindow }),
    ...(row.clearedEntryId !== undefined && { clearedEntryId: row.clearedEntryId }),
    ...(row.clearedUsage !== undefined && { clearedUsage: row.clearedUsage }),
  }))
}

/** A reset marker: kept in the ledger with its time and what it cleared. */
export function resetLedgerRow(row: {
  readonly workspaceId: string
  readonly entryId: string
  readonly window: TeamWindow
  readonly clearedEntryId: string | undefined
  readonly startMs: number
}): TeamLedgerRecord {
  return {
    kind: 'reset',
    taskId: `reset:${row.entryId}:${String(row.startMs)}`,
    workspaceId: row.workspaceId,
    roleId: '',
    entryId: row.entryId,
    agentKey: '',
    modelId: '',
    provider: '',
    billing: 'local',
    settings: [],
    workspaceMode: 'read-only',
    brief: '',
    reasonCode: 'reset',
    startMs: row.startMs,
    status: 'finished',
    outcome: undefined,
    usage: { ...ZERO_TEAM_METER_USAGE },
    estimated: false,
    links: {},
    lease: { holder: '', sinceMs: row.startMs },
    clearedWindow: row.window,
    ...(row.clearedEntryId !== undefined && { clearedEntryId: row.clearedEntryId }),
  }
}
