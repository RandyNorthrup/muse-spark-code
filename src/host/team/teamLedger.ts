// The team ledger (M96 lane A, PLAN.md D75): the durable record behind the
// Agent map's live and history views. Every delegation is one row, kept per
// workspace beside the session store, in an append-only file per local day.
// Writes are atomic single appends (one window's flush lands whole), reads
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

import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { redactSecrets } from '../../core/redact'
import {
  teamDayKey,
  type TeamMeterRow,
  type TeamMeterUsage,
  ZERO_TEAM_METER_USAGE,
} from '../../core/team/teamMeter'
import type { TeamMeasure, TeamWindow } from '../../core/team/teamPool'
import {
  TEAM_LEDGER_BRIEF_MAX_CHARS,
  TEAM_LEDGER_FILE_PREFIX,
  TEAM_LEDGER_FILE_SUFFIX,
  TEAM_LEDGER_LINE_MAX_BYTES,
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
  workspaceMode: z.union([
    z.literal('read-only'),
    z.literal('own-branch'),
    z.literal('in-place'),
  ]),
  branch: z.optional(z.string()),
  brief: z.string(),
  reasonCode: z.string(),
  dayKey: z.string(),
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
  clearedWindow: z.optional(z.nullable(z.enum(['task', 'day', 'lifetime']))),
  clearedEntryId: z.optional(z.string()),
})
export type TeamLedgerRow = z.infer<typeof teamLedgerRowSchema>

/** What `record` takes: the row without the stored envelope. */
export type TeamLedgerRecord = Omit<TeamLedgerRow, 'version' | 'dayKey'> & {
  /** Defaults to the local day of `startMs`. */
  readonly dayKey?: string
}

export interface TeamLedgerDeps {
  /** The workspace's ledger directory, beside the session store. */
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

/** Whether a status is live (D75's active states). */
export function isTeamLedgerActive(status: TeamLedgerStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'waitingApproval' ||
    status === 'throttled'
  )
}

function fileFor(directory: string, dayKey: string): string {
  return path.join(directory, `${TEAM_LEDGER_FILE_PREFIX}${dayKey}${TEAM_LEDGER_FILE_SUFFIX}`)
}

function dayKeyOfFile(name: string): string | undefined {
  if (!name.startsWith(TEAM_LEDGER_FILE_PREFIX) || !name.endsWith(TEAM_LEDGER_FILE_SUFFIX)) {
    return undefined
  }
  return name.slice(TEAM_LEDGER_FILE_PREFIX.length, -TEAM_LEDGER_FILE_SUFFIX.length)
}

export class TeamLedger {
  private pending: string[] = []
  private readonly lastStatus = new Map<string, TeamLedgerStatus>()
  private timer: NodeJS.Timeout | undefined
  /** Serialises flushes: one window's append lands whole. */
  private flushing: Promise<void> = Promise.resolve()

  public constructor(private readonly deps: TeamLedgerDeps) {}

  /** Starts the flush timer: usage rows land at least every `flushMs`. */
  public start(): void {
    if (this.timer !== undefined) {
      return
    }
    this.timer = setInterval(() => {
      void this.flush()
    }, this.deps.flushMs)
    this.timer.unref?.()
  }

  /** Stops the timer after flushing what is pending. */
  public async dispose(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
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
    const line = toLedgerLine(record)
    const parsed = teamLedgerRowSchema.safeParse(JSON.parse(line) as unknown)
    if (!parsed.success) {
      throw new Error(`Team ledger row is invalid: ${z.prettifyError(parsed.error)}`)
    }
    const previous = this.lastStatus.get(parsed.data.taskId)
    this.lastStatus.set(parsed.data.taskId, parsed.data.status)
    this.pending.push(line)
    if (previous === undefined || previous !== parsed.data.status) {
      await this.flush()
    }
  }

  /** Appends everything pending in one atomic append. */
  public async flush(): Promise<void> {
    if (this.pending.length === 0) {
      return
    }
    const lines = this.pending
    this.pending = []
    await this.appendLines(this.dayKeyOfLines(lines) ?? teamDayKey(this.deps.now()), lines)
  }

  private async appendLines(dayKey: string, lines: readonly string[]): Promise<void> {
    const text = lines.join('')
    const next = this.flushing.then(async () => {
      await mkdir(this.deps.directory, { recursive: true })
      await appendFile(fileFor(this.deps.directory, dayKey), text, 'utf8')
    })
    this.flushing = next.catch(() => undefined)
    await next
  }

  /**
   * Every row of every day file, validated: malformed lines (a crashed
   * writer's partial tail) are skipped and counted, never fatal. Callers
   * take the latest row per task id.
   */
  public async read(): Promise<TeamLedgerRead> {
    const rows: TeamLedgerRow[] = []
    let skippedLines = 0
    let names: string[]
    try {
      names = await readdir(this.deps.directory)
    } catch {
      return { rows, skippedLines }
    }
    for (const name of names.toSorted()) {
      if (dayKeyOfFile(name) === undefined) {
        continue
      }
      let text: string
      try {
        text = await readFile(path.join(this.deps.directory, name), 'utf8')
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        if (line === '') {
          continue
        }
        // A crashed writer's partial tail never parses: skip it, never fail.
        const parsed = safeParseLine(line)
        if (parsed !== undefined) {
          rows.push(parsed)
          if (parsed.kind === 'task') {
            this.lastStatus.set(parsed.taskId, parsed.status)
          }
        } else {
          skippedLines += 1
        }
      }
    }
    return { rows, skippedLines }
  }

  /** The latest row per task id: state changes append, so last wins. */
  public static latestByTask(rows: readonly TeamLedgerRow[]): Map<string, TeamLedgerRow> {
    const latest = new Map<string, TeamLedgerRow>()
    for (const row of rows) {
      latest.set(row.taskId, row)
    }
    return latest
  }

  /**
   * Marks a task interrupted after its window died, with its partial usage:
   * appends a terminal snapshot only while the latest row is still active.
   * `maybeOpen` says the holder window's hint is still fresh, so that
   * window may still be open.
   */
  public async markInterrupted(
    latest: TeamLedgerRow,
    usage: TeamMeterUsage,
    estimated: boolean,
    maybeOpen: boolean,
  ): Promise<boolean> {
    if (latest.kind !== 'task' || !isTeamLedgerActive(latest.status)) {
      return false
    }
    await this.record({
      ...latest,
      startMs: latest.startMs,
      endMs: this.deps.now(),
      status: 'interrupted',
      outcome: 'interrupted',
      usage,
      estimated,
      interruptedMaybeOpen: maybeOpen,
      lease: { holder: this.deps.windowId, sinceMs: this.deps.now() },
    })
    return true
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
    const cutoff = teamDayKey(this.deps.now() - this.deps.retentionDays * 24 * 60 * 60 * 1000)
    let names: string[]
    try {
      names = await readdir(this.deps.directory)
    } catch {
      return { rolled: 0, removed: 0 }
    }
    let rolled = 0
    let removed = 0
    for (const name of names.toSorted()) {
      const dayKey = dayKeyOfFile(name)
      if (dayKey === undefined || dayKey >= cutoff) {
        continue
      }
      const { rows } = await this.readOne(name)
      // Rollups keep their old day (day caps never reread them) but live in
      // today's file, so removing the old file loses nothing.
      const lines = rollUp(rows).map((rollup) => toLedgerLine(rollup))
      if (lines.length > 0) {
        await this.appendLines(teamDayKey(this.deps.now()), lines)
        rolled += lines.length
      }
      await rm(path.join(this.deps.directory, name), { force: true })
      removed += 1
    }
    await this.flush()
    return { rolled, removed }
  }

  private async readOne(name: string): Promise<TeamLedgerRead> {
    const rows: TeamLedgerRow[] = []
    let skippedLines = 0
    const text = await readFile(path.join(this.deps.directory, name), 'utf8')
    for (const line of text.split('\n')) {
      if (line === '') {
        continue
      }
      const parsed = safeParseLine(line)
      if (parsed !== undefined) {
        rows.push(parsed)
      } else {
        skippedLines += 1
      }
    }
    return { rows, skippedLines }
  }

  private dayKeyOfLines(lines: readonly string[]): string | undefined {
    const firstLine = lines[0]
    if (firstLine === undefined) {
      return undefined
    }
    try {
      const first = JSON.parse(firstLine) as { dayKey?: unknown }
      return typeof first.dayKey === 'string' ? first.dayKey : undefined
    } catch {
      return undefined
    }
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

/** Rolls pruned task rows into one totals row per entry and day. */
function rollUp(rows: readonly TeamLedgerRow[]): TeamLedgerRecord[] {
  const sums = new Map<
    string,
    {
      readonly entryId: string
      readonly agentKey: string
      readonly roleId: string
      readonly modelId: string
      readonly provider: string
      readonly billing: TeamLedgerRow['billing']
      readonly dayKey: string
      usage: TeamMeterUsage
      estimated: boolean
      startMs: number
    }
  >()
  for (const row of rows) {
    if (row.kind !== 'task') {
      continue
    }
    const key = `${row.entryId}\n${row.dayKey}`
    const kept = sums.get(key)
    const usage = row.usage
    if (kept === undefined) {
      sums.set(key, {
        entryId: row.entryId,
        agentKey: row.agentKey,
        roleId: row.roleId,
        modelId: row.modelId,
        provider: row.provider,
        billing: row.billing,
        dayKey: row.dayKey,
        usage: { ...usage },
        estimated: row.estimated,
        startMs: row.startMs,
      })
    } else {
      kept.usage = addUsage(kept.usage, usage)
      kept.estimated = kept.estimated || row.estimated
      kept.startMs = Math.min(kept.startMs, row.startMs)
    }
  }
  return [...sums.values()].map((sum) => ({
    kind: 'totals' as const,
    taskId: `totals:${sum.entryId}:${sum.dayKey}`,
    workspaceId: '',
    roleId: sum.roleId,
    entryId: sum.entryId,
    agentKey: sum.agentKey,
    modelId: sum.modelId,
    provider: sum.provider,
    billing: sum.billing,
    settings: [],
    workspaceMode: 'read-only' as const,
    brief: '',
    reasonCode: 'retention',
    dayKey: sum.dayKey,
    startMs: sum.startMs,
    status: 'finished' as const,
    outcome: undefined,
    usage: sum.usage,
    estimated: sum.estimated,
    links: {},
    lease: { holder: '', sinceMs: sum.startMs },
  }))
}

function addUsage(left: TeamMeterUsage, right: TeamMeterUsage): TeamMeterUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    calls: left.calls + right.calls,
    costUsd: left.costUsd + right.costUsd,
    tasks: left.tasks + right.tasks,
    hookTokens: left.hookTokens + right.hookTokens,
    paidToolTokens: left.paidToolTokens + right.paidToolTokens,
  }
}

/** A ledger read as the meter's source: task and totals rows in meter shape. */
export function ledgerMeterRows(rows: readonly TeamLedgerRow[]): TeamMeterRow[] {
  return rows
    .filter((row) => row.kind === 'task' || row.kind === 'totals')
    .map((row) => ({
      kind: row.kind as 'task' | 'totals',
      entryId: row.entryId,
      agentKey: row.agentKey,
      roleId: row.roleId,
      taskId: row.taskId,
      dayKey: row.dayKey,
      startMs: row.startMs,
      usage: row.usage,
      estimated: row.estimated,
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

export type { TeamMeasure, TeamWindow }
