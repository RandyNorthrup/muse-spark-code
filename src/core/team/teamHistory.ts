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
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { knownSeverity } from '../../shared/reviewFindings'

const MILLISECONDS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE
const MILLISECONDS_PER_WEEK = MILLISECONDS_PER_DAY * DAYS_PER_WEEK

/** A finished (or interrupted) team task, as the ledger stores it. */
export type TeamHistoryOutcome =
  'merged' | 'discarded' | 'failed' | 'stopped' | 'capped' | 'cancelled' | 'interrupted'

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
  readonly models?: readonly string[]
  readonly outcomes?: readonly TeamHistoryOutcome[]
  /** Epoch milliseconds, inclusive. */
  readonly from?: number
  /** Epoch milliseconds, exclusive. */
  readonly to?: number
}

export type HistorySortKey = 'cost' | 'duration' | 'tokens'

/** Which window a totals figure covers. `day` is the UTC calendar day holding `now`; `week` is trailing 7 days. */
export type HistoryPeriod = 'day' | 'week' | 'all'

export interface HistoryTotals {
  readonly roleId: string
  readonly entryId: string | undefined
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

/** Tokens by kind, summed. Hook-added tokens stay a line of their own. */
export function totalTokens(row: Pick<TeamHistoryRow, 'tokens'>): number {
  return row.tokens.input + row.tokens.cachedInput + row.tokens.output + row.tokens.reasoning
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

function periodWindow(
  period: HistoryPeriod,
  now: number,
): { readonly from: number; readonly to: number } | undefined {
  if (period === 'all') {
    return undefined
  }
  if (period === 'week') {
    return { from: now - MILLISECONDS_PER_WEEK, to: now }
  }
  const start = Math.floor(now / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY
  return { from: start, to: start + MILLISECONDS_PER_DAY }
}

/**
 * Totals grouped by role, or by entry (per agent), over one period. Figures
 * the provider reported and our own estimates stay apart; unpriced tasks are
 * counted, never costed.
 */
export function historyTotals(
  rows: readonly TeamHistoryRow[],
  args: {
    readonly groupBy: 'role' | 'entry'
    readonly period: HistoryPeriod
    readonly now: number
  },
): HistoryTotals[] {
  const window = periodWindow(args.period, args.now)
  const inWindow =
    window === undefined
      ? rows
      : rows.filter((row) => row.startTime >= window.from && row.startTime < window.to)
  const byKey: Record<string, HistoryTotals> = {}
  for (const row of inWindow) {
    const key = args.groupBy === 'role' ? row.roleId : `${row.roleId}/${row.entryId}`
    const tokens = totalTokens(row)
    const current: HistoryTotals | undefined = byKey[key]
    if (current === undefined) {
      byKey[key] = {
        roleId: row.roleId,
        entryId: args.groupBy === 'entry' ? row.entryId : undefined,
        provider: args.groupBy === 'entry' ? row.provider : undefined,
        model: args.groupBy === 'entry' ? row.model : undefined,
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
  return Object.values(byKey).toSorted((left, right) =>
    args.groupBy === 'role'
      ? left.roleId.localeCompare(right.roleId)
      : `${left.roleId}/${left.entryId ?? ''}`.localeCompare(
          `${right.roleId}/${right.entryId ?? ''}`,
        ),
  )
}

function average(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((total, value) => total + value, 0) / values.length
}

/**
 * The record's figures for exactly the pool's entries, in the pool's order:
 * tasks done, capped, failed and cancelled; changes merged and discarded;
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
      done: scoped.filter((row) => row.outcome === 'merged').length,
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

function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value
  return text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')
    ? `"${text.replaceAll('"', '""')}"`
    : text
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
