// The team ledger's queries (M96, PLAN.md D75 "The team ledger" and
// acceptance 42): filters, text search, sorting, totals per role and agent
// for today, the week and all time, the record's figures per entry, and CSV
// and JSON export with transcript content only on request. Pure functions
// over rows; no `vscode` import.
//
// Seams to parallel lanes (explicit interfaces, never fakes): the row shape
// below is the structural subset of lane A's ledger row (D75's fields) and
// lane 0's `src/shared/team.ts` ledger schema that history needs. Rows are
// already redacted at write; the export re-applies `redactSecrets` as
// defence in depth. Durable pruning and the stored reset-record figures live
// in lane A's ledger region; `selectRetained` is the pure helper it calls.
// Transcript bodies arrive through the injected `loadTranscript`: without it,
// or without the tick, no transcript content leaves this module.

import { redactSecrets } from '../redact'
import {
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { knownSeverity } from '../../shared/reviewFindings'

const MILLISECONDS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE
const MILLISECONDS_PER_WEEK = MILLISECONDS_PER_DAY * DAYS_PER_WEEK

/**
 * A finished (or interrupted) team task, as the ledger stores it. `done` is
 * a success that needed no merge (research, review, a question answered);
 * `merged` is a success whose changes reached the checkout. The two are
 * counted separately, never equated.
 */
export type TeamHistoryOutcome =
  'done' | 'merged' | 'discarded' | 'failed' | 'stopped' | 'capped' | 'cancelled' | 'interrupted'

export interface TeamHistoryTokens {
  readonly input: number
  readonly cachedInput: number
  readonly output: number
  readonly reasoning: number
}

export interface TeamHistoryRow {
  readonly taskId: string
  readonly roleId: string
  readonly entryId: string
  /** The agent that ran the task, stable across the roles it serves. Undefined for rows written before agents were identified. */
  readonly agentId?: string
  readonly provider: string
  readonly model: string
  readonly outcome: TeamHistoryOutcome
  /** Bounded and redacted at write; re-redacted at export. */
  readonly brief: string
  readonly reasonCode: string
  /** Epoch milliseconds. */
  readonly startTime: number
  /** Epoch milliseconds; undefined while the usage is still partial. */
  readonly endTime: number | undefined
  readonly tokens: TeamHistoryTokens
  /** False when the provider reported usage; true for our own measure. */
  readonly estimated: boolean
  /** Model calls (inference count). */
  readonly modelCalls: number
  /** Undefined for unpriced entries. */
  readonly costUsd: number | undefined
  readonly hookAddedTokens?: number
  readonly paidToolCostUsd?: number
  /** The review's findings against this task's changes; severities as written. */
  readonly findingSeverities?: readonly string[]
  /** Rounds the task needed to pass review; undefined when it never went through one. */
  readonly roundsUsed?: number
}

/** What the history view filters on. The date range is [from, to): `from` inclusive, `to` exclusive. */
export interface HistoryFilter {
  readonly roleIds?: readonly string[]
  readonly entryIds?: readonly string[]
  /** Keeps only rows carrying one of these agent identities; rows without an agent never match a set agent filter. */
  readonly agentIds?: readonly string[]
  readonly models?: readonly string[]
  readonly outcomes?: readonly TeamHistoryOutcome[]
  /** Epoch milliseconds, inclusive. */
  readonly from?: number
  /** Epoch milliseconds, exclusive. */
  readonly to?: number
}

export type HistorySortKey = 'cost' | 'duration' | 'tokens'

/**
 * Which window a totals figure covers. `day` is the caller's local calendar
 * day holding `now` in the injected `timeZone`; `week` is trailing 7 days.
 */
export type HistoryPeriod = 'day' | 'week' | 'all'

export interface HistoryTotals {
  readonly roleId: string
  readonly entryId: string | undefined
  /** Set for `agent` grouping: the agent totalled. Rows without an agent land in one `unknown` bucket, shown, never dropped. */
  readonly agentId: string | undefined
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly tasks: number
  readonly tokens: number
  readonly estimatedTokens: number
  readonly costUsd: number
  readonly unpricedTasks: number
  readonly hookAddedTokens: number
  readonly paidToolCostUsd: number
}

/** The record's figures for one pool entry, judging it without reordering anything. */
export interface EntryFigures {
  readonly roleId: string
  readonly entryId: string
  readonly tasks: number
  readonly done: number
  readonly capped: number
  readonly failed: number
  readonly cancelled: number
  readonly merged: number
  readonly discarded: number
  readonly interrupted: number
  readonly findingsBySeverity: Record<string, number>
  readonly roundsToPassAvg: number | undefined
  readonly avgTokens: number | undefined
  readonly avgCostUsd: number | undefined
  readonly avgMinutes: number | undefined
}

/**
 * Tokens in and out, summed. Cached input is a subset of input and reasoning
 * is a subset of output (D75's accounting definition), so neither is ever
 * added again. Hook-added tokens stay a line of their own.
 */
export function totalTokens(row: Pick<TeamHistoryRow, 'tokens'>): number {
  return row.tokens.input + row.tokens.output
}

/** Milliseconds from start to end; undefined while the row has no end. */
export function durationMs(row: Pick<TeamHistoryRow, 'startTime' | 'endTime'>): number | undefined {
  return row.endTime === undefined ? undefined : row.endTime - row.startTime
}

/** Rows matching every set filter. The date range holds rows with `from <= startTime < to`. */
export function filterHistory(
  rows: readonly TeamHistoryRow[],
  filter: HistoryFilter,
): TeamHistoryRow[] {
  return rows.filter(
    (row) =>
      (filter.roleIds === undefined || filter.roleIds.includes(row.roleId)) &&
      (filter.entryIds === undefined || filter.entryIds.includes(row.entryId)) &&
      (filter.agentIds === undefined ||
        (row.agentId !== undefined && filter.agentIds.includes(row.agentId))) &&
      (filter.models === undefined || filter.models.includes(row.model)) &&
      (filter.outcomes === undefined || filter.outcomes.includes(row.outcome)) &&
      (filter.from === undefined || row.startTime >= filter.from) &&
      (filter.to === undefined || row.startTime < filter.to),
  )
}

/** Rows whose brief holds `text` (case-insensitive). Blank text matches everything. */
export function searchHistory(rows: readonly TeamHistoryRow[], text: string): TeamHistoryRow[] {
  if (text.trim() === '') {
    return [...rows]
  }
  const needle = text.toLowerCase()
  return rows.filter((row) => row.brief.toLowerCase().includes(needle))
}

function sortValue(row: TeamHistoryRow, key: HistorySortKey): number | undefined {
  switch (key) {
    case 'cost': {
      return row.costUsd
    }
    case 'duration': {
      return durationMs(row)
    }
    case 'tokens': {
      return totalTokens(row)
    }
  }
}

/**
 * Rows ordered by cost, duration or tokens, stable. Rows without a value
 * (unpriced cost, open duration) sort last in both directions.
 */
export function sortHistory(
  rows: readonly TeamHistoryRow[],
  sort: { readonly key: HistorySortKey; readonly direction: 'asc' | 'desc' },
): TeamHistoryRow[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  const sign = sort.direction === 'asc' ? 1 : -1
  indexed.sort((left, right) => {
    const leftValue = sortValue(left.row, sort.key)
    const rightValue = sortValue(right.row, sort.key)
    if (leftValue === undefined && rightValue === undefined) {
      return left.index - right.index
    }
    if (leftValue === undefined) {
      return 1
    }
    return rightValue === undefined
      ? -1
      : (leftValue - rightValue) * sign || left.index - right.index
  })
  return indexed.map((item) => item.row)
}

/**
 * The wall-clock fields of one instant in `timeZone`, read through
 * `formatToParts` so no locale's field order can move them.
 */
function wallFields(
  ms: number,
  timeZone: string,
): {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(ms)
  const at = (type: string): number => {
    const part = parts.find((item) => item.type === type)
    return part === undefined ? 0 : Number(part.value)
  }
  return {
    year: at('year'),
    month: at('month'),
    day: at('day'),
    hour: at('hour') % HOURS_PER_DAY,
    minute: at('minute'),
    second: at('second'),
  }
}

/** Passes of the wall-to-UTC solver: two converge, the third covers a DST jump. */
const WALL_SOLVE_PASSES = 3

/**
 * The UTC instant whose wall clock in `timeZone` reads `wallUtcMs` (a wall
 * reading expressed as UTC milliseconds). Solved iteratively: each pass
 * measures how far the guess's wall clock overshoots and shifts back.
 * Converges in two passes except across a DST jump, where three suffice;
 * an unknown zone throws the `Intl` `RangeError`.
 */
function utcFromWallClock(wallUtcMs: number, timeZone: string): number {
  let guess = wallUtcMs
  for (let pass = 0; pass < WALL_SOLVE_PASSES; pass += 1) {
    const fields = wallFields(guess, timeZone)
    const overshoot =
      Date.UTC(
        fields.year,
        fields.month - 1,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second,
      ) - wallUtcMs
    guess -= overshoot
    if (overshoot === 0) {
      break
    }
  }
  return guess
}

/**
 * The UTC bounds of the local calendar day holding `now` in `timeZone`:
 * local midnight to the next local midnight, DST jumps included.
 */
function localDayWindow(
  now: number,
  timeZone: string,
): { readonly from: number; readonly to: number } {
  const fields = wallFields(now, timeZone)
  const midnightWall = Date.UTC(fields.year, fields.month - 1, fields.day)
  return {
    from: utcFromWallClock(midnightWall, timeZone),
    to: utcFromWallClock(midnightWall + MILLISECONDS_PER_DAY, timeZone),
  }
}

function periodWindow(
  period: HistoryPeriod,
  now: number,
  timeZone: string,
): { readonly from: number; readonly to: number } | undefined {
  if (period === 'all') {
    return undefined
  }
  return period === 'week'
    ? { from: now - MILLISECONDS_PER_WEEK, to: now }
    : localDayWindow(now, timeZone)
}

/** Rows without an agent group under this bucket, shown, never dropped. */
const UNKNOWN_AGENT = 'unknown'

/** How `historyTotals` groups rows: by role, by entry (per agent slot) or by agent. */
export type HistoryGroupBy = 'role' | 'entry' | 'agent'

function totalsKey(groupBy: HistoryGroupBy, row: TeamHistoryRow): string {
  switch (groupBy) {
    case 'role': {
      return row.roleId
    }
    case 'entry': {
      return `${row.roleId}/${row.entryId}`
    }
    case 'agent': {
      return row.agentId ?? UNKNOWN_AGENT
    }
  }
}

function compareTotals(groupBy: HistoryGroupBy, left: HistoryTotals, right: HistoryTotals): number {
  switch (groupBy) {
    case 'role': {
      return left.roleId.localeCompare(right.roleId)
    }
    case 'entry': {
      return `${left.roleId}/${left.entryId ?? ''}`.localeCompare(
        `${right.roleId}/${right.entryId ?? ''}`,
      )
    }
    case 'agent': {
      return (left.agentId ?? UNKNOWN_AGENT).localeCompare(right.agentId ?? UNKNOWN_AGENT)
    }
  }
}

/**
 * Totals grouped by role, by entry (per agent slot) or by agent, over one
 * period. `day` is the local calendar day holding `now` in `timeZone` (an
 * IANA name such as `America/Los_Angeles`; unknown names throw the `Intl`
 * `RangeError`). Figures the provider reported and our own estimates stay
 * apart; unpriced tasks are counted, never costed.
 */
export function historyTotals(
  rows: readonly TeamHistoryRow[],
  args: {
    readonly groupBy: HistoryGroupBy
    readonly period: HistoryPeriod
    readonly now: number
    readonly timeZone: string
  },
): HistoryTotals[] {
  const window = periodWindow(args.period, args.now, args.timeZone)
  const inWindow =
    window === undefined
      ? rows
      : rows.filter((row) => row.startTime >= window.from && row.startTime < window.to)
  const byKey: Record<string, HistoryTotals> = {}
  for (const row of inWindow) {
    const key = totalsKey(args.groupBy, row)
    const tokens = totalTokens(row)
    const current: HistoryTotals | undefined = byKey[key]
    if (current === undefined) {
      byKey[key] = {
        roleId: row.roleId,
        entryId: args.groupBy === 'entry' ? row.entryId : undefined,
        agentId: args.groupBy === 'agent' ? row.agentId : undefined,
        provider: args.groupBy === 'role' ? undefined : row.provider,
        model: args.groupBy === 'role' ? undefined : row.model,
        tasks: 1,
        tokens,
        estimatedTokens: row.estimated ? tokens : 0,
        costUsd: row.costUsd ?? 0,
        unpricedTasks: row.costUsd === undefined ? 1 : 0,
        hookAddedTokens: row.hookAddedTokens ?? 0,
        paidToolCostUsd: row.paidToolCostUsd ?? 0,
      }
    } else {
      byKey[key] = {
        ...current,
        tasks: current.tasks + 1,
        tokens: current.tokens + tokens,
        estimatedTokens: current.estimatedTokens + (row.estimated ? tokens : 0),
        costUsd: current.costUsd + (row.costUsd ?? 0),
        unpricedTasks: current.unpricedTasks + (row.costUsd === undefined ? 1 : 0),
        hookAddedTokens: current.hookAddedTokens + (row.hookAddedTokens ?? 0),
        paidToolCostUsd: current.paidToolCostUsd + (row.paidToolCostUsd ?? 0),
      }
    }
  }
  return Object.values(byKey).toSorted((left, right) => compareTotals(args.groupBy, left, right))
}

function average(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((total, value) => total + value, 0) / values.length
}

/**
 * The record's figures for exactly the pool's entries, in the pool's order:
 * tasks done (outcome `done`), capped, failed and cancelled; changes merged
 * and discarded (`merged` counts merges only, never other successes);
 * review findings by severity; rounds needed to pass review; average tokens,
 * cost and minutes. Rows for entries no longer in the pool are ignored here
 * (history totals above still count them). The pool order array is never
 * mutated; the figures follow it.
 */
export function entryFigures(
  rows: readonly TeamHistoryRow[],
  poolOrder: readonly { readonly roleId: string; readonly entryId: string }[],
): EntryFigures[] {
  return poolOrder.map((entry) => {
    const scoped = rows.filter(
      (row) => row.roleId === entry.roleId && row.entryId === entry.entryId,
    )
    const findingsBySeverity: Record<string, number> = {}
    for (const row of scoped) {
      const severities = row.findingSeverities ?? []
      for (const raw of severities) {
        const bucket = knownSeverity(raw) ?? 'unknown'
        findingsBySeverity[bucket] = (findingsBySeverity[bucket] ?? 0) + 1
      }
    }
    return {
      roleId: entry.roleId,
      entryId: entry.entryId,
      tasks: scoped.length,
      done: scoped.filter((row) => row.outcome === 'done').length,
      capped: scoped.filter((row) => row.outcome === 'capped').length,
      failed: scoped.filter((row) => row.outcome === 'failed').length,
      cancelled: scoped.filter((row) => row.outcome === 'cancelled' || row.outcome === 'stopped')
        .length,
      merged: scoped.filter((row) => row.outcome === 'merged').length,
      discarded: scoped.filter((row) => row.outcome === 'discarded').length,
      interrupted: scoped.filter((row) => row.outcome === 'interrupted').length,
      findingsBySeverity,
      roundsToPassAvg: average(
        scoped.flatMap((row) => (row.roundsUsed === undefined ? [] : [row.roundsUsed])),
      ),
      avgTokens: average(scoped.map((row) => totalTokens(row))),
      avgCostUsd: average(
        scoped.flatMap((row) => (row.costUsd === undefined ? [] : [row.costUsd])),
      ),
      avgMinutes: average(
        scoped.flatMap((row) => {
          const duration = durationMs(row)
          return duration === undefined ? [] : [duration / MILLISECONDS_PER_MINUTE]
        }),
      ),
    }
  })
}

/**
 * Rows the retention keeps: everything when `cleanupPeriodDays` is 0, else
 * rows started within the last `cleanupPeriodDays` days.
 */
export function selectRetained(
  rows: readonly TeamHistoryRow[],
  now: number,
  cleanupPeriodDays: number,
): TeamHistoryRow[] {
  return cleanupPeriodDays === 0
    ? [...rows]
    : rows.filter((row) => row.startTime >= now - cleanupPeriodDays * MILLISECONDS_PER_DAY)
}

export interface HistoryExportOptions {
  /** Transcript bodies are included only when this is true; default false. */
  readonly includeTranscripts?: boolean
  readonly loadTranscript?: (row: TeamHistoryRow) => string | undefined
}

function exportBrief(row: TeamHistoryRow): string {
  return redactSecrets(row.brief)
}

function exportTranscript(row: TeamHistoryRow, options: HistoryExportOptions): string | undefined {
  const body =
    options.includeTranscripts !== true || options.loadTranscript === undefined
      ? undefined
      : options.loadTranscript(row)
  return body === undefined ? undefined : redactSecrets(body)
}

/**
 * Cell-opening characters a spreadsheet reads as a formula (the OWASP CSV
 * injection rule): equals, plus, minus, at, tab and carriage return.
 */
const CSV_FORMULA_PREFIXES = '=+-@\t\r'

function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value
  const guarded =
    text.length > 0 && CSV_FORMULA_PREFIXES.includes(text.charAt(0)) ? `'${text}` : text
  return guarded.includes('"') ||
    guarded.includes(',') ||
    guarded.includes('\n') ||
    guarded.includes('\r')
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded
}

const CSV_COLUMNS = [
  'task_id',
  'role',
  'entry',
  'provider',
  'model',
  'outcome',
  'reason',
  'start',
  'end',
  'duration_ms',
  'tokens_in',
  'tokens_cached',
  'tokens_out',
  'tokens_reasoning',
  'estimated',
  'model_calls',
  'cost_usd',
  'hook_tokens',
  'paid_tool_usd',
  'brief',
] as const

/** The summary rows as CSV. No transcript content unless the tick is set. */
export function exportHistoryCsv(
  rows: readonly TeamHistoryRow[],
  options: HistoryExportOptions = {},
): string {
  const isWithTranscripts = options.includeTranscripts === true
  const header = isWithTranscripts ? [...CSV_COLUMNS, 'transcript'] : [...CSV_COLUMNS]
  const lines = [header.map((column) => csvCell(column)).join(',')]
  for (const row of rows) {
    const duration = durationMs(row)
    const cells: (string | number)[] = [
      row.taskId,
      row.roleId,
      row.entryId,
      row.provider,
      row.model,
      row.outcome,
      row.reasonCode,
      new Date(row.startTime).toISOString(),
      row.endTime === undefined ? '' : new Date(row.endTime).toISOString(),
      duration ?? '',
      row.tokens.input,
      row.tokens.cachedInput,
      row.tokens.output,
      row.tokens.reasoning,
      row.estimated ? 'true' : 'false',
      row.modelCalls,
      row.costUsd ?? '',
      row.hookAddedTokens ?? 0,
      row.paidToolCostUsd ?? 0,
      exportBrief(row),
    ]
    if (isWithTranscripts) {
      cells.push(exportTranscript(row, options) ?? '')
    }
    lines.push(cells.map((cell) => csvCell(cell)).join(','))
  }
  return `${lines.join('\n')}\n`
}

export interface HistoryJsonRow {
  readonly taskId: string
  readonly roleId: string
  readonly entryId: string
  readonly provider: string
  readonly model: string
  readonly outcome: TeamHistoryOutcome
  readonly reasonCode: string
  readonly start: string
  readonly end: string | undefined
  readonly durationMs: number | undefined
  readonly tokens: TeamHistoryTokens
  readonly estimated: boolean
  readonly modelCalls: number
  readonly costUsd: number | undefined
  readonly hookAddedTokens: number
  readonly paidToolCostUsd: number
  readonly brief: string
  readonly transcript?: string
}

/** The summary rows as JSON. Transcript bodies go in only with the tick. */
export function exportHistoryJson(
  rows: readonly TeamHistoryRow[],
  options: HistoryExportOptions = {},
): string {
  const output: HistoryJsonRow[] = rows.map((row) => {
    const transcript = exportTranscript(row, options)
    return {
      taskId: row.taskId,
      roleId: row.roleId,
      entryId: row.entryId,
      provider: row.provider,
      model: row.model,
      outcome: row.outcome,
      reasonCode: row.reasonCode,
      start: new Date(row.startTime).toISOString(),
      end: row.endTime === undefined ? undefined : new Date(row.endTime).toISOString(),
      durationMs: durationMs(row),
      tokens: row.tokens,
      estimated: row.estimated,
      modelCalls: row.modelCalls,
      costUsd: row.costUsd,
      hookAddedTokens: row.hookAddedTokens ?? 0,
      paidToolCostUsd: row.paidToolCostUsd ?? 0,
      brief: exportBrief(row),
      ...(transcript !== undefined && { transcript }),
    }
  })
  return `${JSON.stringify(output, undefined, 2)}\n`
}
