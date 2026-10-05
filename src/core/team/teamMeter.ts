// Team meters (M96 lane A, PLAN.md D75): caps by measure and window as sums
// over ledger rows, plus the reservations still open in the team's scope of
// M82's journal. Admission never depends on a flush, because the reservation
// is written before each request is sent.
//
// Reported versus estimated: meters count the provider's reported usage
// wherever it reports any, and the extension's own measure otherwise,
// labelled estimated everywhere it shows. After a switch, each request is
// charged to the entry that sent it: rows carry their sending entry, and the
// meter sums rows, never the task's current entry. No `vscode` here.

import type { TeamMeasure, TeamWindow } from './teamPool'

/** One task's (or rollup's) usage, by kind, with its provenance. */
export interface TeamMeterUsage {
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  /** Informational: part of outputTokens, shown apart. */
  readonly reasoningTokens: number
  /** Model calls (inference count). */
  readonly calls: number
  readonly costUsd: number
  /** Delegations counted (1 per task row; N per totals rollup). */
  readonly tasks: number
  /** Hook-added tokens and paid-tool tokens: lines of their own (SoL-Pi rules 3 and 6). */
  readonly hookTokens: number
  readonly paidToolTokens: number
}

/** Zero usage: resets and fresh rows start here. */
export const ZERO_TEAM_METER_USAGE: TeamMeterUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  calls: 0,
  costUsd: 0,
  tasks: 0,
  hookTokens: 0,
  paidToolTokens: 0,
}

/**
 * A ledger row as the meter sees it (the host ledger owns the full row with
 * its zod schema; this structural view keeps core free of host imports).
 * `entryId` is the entry that SENT the request, so a continued task charges
 * its first part to the first entry and the rest to the next.
 */
export interface TeamMeterRow {
  /** A delegation attempt, a retention rollup, or a reset marker. */
  readonly kind: 'task' | 'totals' | 'reset'
  readonly entryId: string
  readonly agentKey: string
  readonly roleId: string
  /** The delegation, for `task` rows; a rollup's rows share none. */
  readonly taskId: string
  /** Local day the row's usage belongs to (`teamDayKey`). */
  readonly dayKey: string
  /** When the row's usage started: resets clear rows before their own time. */
  readonly startMs: number
  readonly usage: TeamMeterUsage
  /** True where the provider reports nothing and the extension measured. */
  readonly estimated: boolean
  /** Reset rows only: the window cleared, for one entry or (undefined) all. */
  readonly clearedWindow?: TeamWindow
  readonly clearedEntryId?: string
}

/** The local day a timestamp belongs to: the `day` window and the ledger file. */
export function teamDayKey(atMs: number): string {
  const day = new Date(atMs)
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const date = String(day.getDate()).padStart(2, '0')
  return `${String(day.getFullYear())}-${month}-${date}`
}

/** One open reservation: estimated input plus the whole output allowance. */
export interface TeamReservation {
  readonly id: string
  readonly workspaceId: string
  readonly entryId: string
  readonly agentKey: string
  readonly taskId: string
  readonly tokens: number
  readonly spendUsd: number
}

/**
 * The team's own scope of M82's journal, one per workspace, whatever
 * conversation or window started the task. Every admission reads the whole
 * scope, so two windows never pass a cap together. (Lane K hosts the
 * durable journal; tests stand in a fake. Never a fake in production code.)
 */
export interface TeamReservationJournal {
  /** Written before the request is sent; a request that does not fit is not sent. */
  reserve(reservation: Omit<TeamReservation, 'id'>): Promise<TeamReservation>
  settle(
    id: string,
    outcome:
      | { readonly kind: 'reported'; readonly tokens: number; readonly spendUsd: number }
      | { readonly kind: 'unknown' }
      | { readonly kind: 'nonsent' },
  ): Promise<void>
  /** Every reservation still open in the scope. */
  open(): Promise<readonly TeamReservation[]>
}

/** What the meter reads: ledger rows in the window, and open reservations. */
export interface TeamMeterSource {
  rows(): readonly TeamMeterRow[]
  openReservations(): readonly TeamReservation[]
}

/** A meter reading: the sum, and whether any of it was estimated. */
export interface TeamMeterReading {
  readonly value: number
  readonly estimated: boolean
}

function usageAmount(measure: TeamMeasure, usage: TeamMeterUsage): number {
  switch (measure) {
    case 'tokens': {
      return usage.inputTokens + usage.outputTokens
    }
    case 'inputTokens': {
      return usage.inputTokens
    }
    case 'outputTokens': {
      return usage.outputTokens
    }
    case 'spendUsd': {
      return usage.costUsd
    }
    case 'tasks': {
      return usage.tasks
    }
  }
}

function reservationAmount(measure: TeamMeasure, reservation: TeamReservation): number {
  switch (measure) {
    case 'tokens':
    case 'inputTokens':
    case 'outputTokens': {
      return reservation.tokens
    }
    case 'spendUsd': {
      return reservation.spendUsd
    }
    case 'tasks': {
      // A reservation is liability for a request, not a delegation.
      return 0
    }
  }
}

/** Whether a row counts for an entry's cap in a window. */
function rowInScope(
  row: TeamMeterRow,
  entryId: string,
  window: TeamWindow,
  scope: { readonly taskId: string; readonly dayKey: string },
  resetMs: number,
): boolean {
  if (row.kind === 'reset' || row.entryId !== entryId || row.startMs < resetMs) {
    return false
  }
  switch (window) {
    case 'day': {
      return row.dayKey === scope.dayKey
    }
    case 'lifetime': {
      return true
    }
    case 'task': {
      return row.kind === 'task' && row.taskId === scope.taskId
    }
  }
}

export class TeamMeter {
  public constructor(private readonly source: TeamMeterSource) {}

  /**
   * The latest reset clearing an entry's window (0 when none): rows before
   * it do not count. A reset names exactly one window; a `task` window is
   * per task and needs none.
   */
  public lastResetMs(entryId: string | undefined, window: TeamWindow): number {
    let latest = 0
    for (const row of this.source.rows()) {
      if (
        row.kind === 'reset' &&
        row.clearedWindow === window &&
        (row.clearedEntryId === undefined || row.clearedEntryId === entryId) &&
        row.startMs > latest
      ) {
        latest = row.startMs
      }
    }
    return latest
  }

  /**
   * An entry's used amount for a cap: ledger rows in the window (task rows
   * and retention rollups alike, so a spent `lifetime` cap never refills
   * when old task rows age out) plus open reservations. `estimated` is true
   * where any of it was measured rather than reported.
   */
  public used(
    entryId: string,
    cap: { readonly measure: TeamMeasure; readonly window: TeamWindow },
    scope: { readonly taskId: string; readonly dayKey: string },
  ): TeamMeterReading {
    const resetMs = this.lastResetMs(entryId, cap.window)
    let value = 0
    let estimated = false
    for (const row of this.source.rows()) {
      if (!rowInScope(row, entryId, cap.window, scope, resetMs)) {
        continue
      }
      value += usageAmount(cap.measure, row.usage)
      estimated = estimated || row.estimated
    }
    for (const reservation of this.source.openReservations()) {
      if (reservation.entryId !== entryId) {
        continue
      }
      if (cap.window === 'task' && reservation.taskId !== scope.taskId) {
        continue
      }
      const amount = reservationAmount(cap.measure, reservation)
      if (amount !== 0) {
        value += amount
        // A reservation is an estimate until reported usage replaces it.
        estimated = true
      }
    }
    return { value, estimated }
  }

  /**
   * Whether a task past its minutes is stopped (D75): elapsed minutes
   * against the role's minutes per task.
   */
  public static isTaskOverdue(startMs: number, minutesPerTask: number, nowMs: number): boolean {
    return nowMs - startMs >= minutesPerTask * 60 * 1000
  }
}

/** The team's totals for Account & usage's Team section, with the lines apart. */
export interface TeamTotals {
  readonly tokens: number
  readonly costUsd: number
  readonly tasks: number
  readonly estimatedTokens: number
  readonly hookTokens: number
  readonly paidToolTokens: number
}

/**
 * Sums rows for a scope (a day, or everything): base tokens and cost, with
 * estimated, hook-added and paid-tool lines apart, so the ledger's totals
 * equal Account & usage's Team totals by construction.
 */
export function sumTeamTotals(
  rows: readonly TeamMeterRow[],
  scope: { readonly dayKey: string | undefined },
): TeamTotals {
  let tokens = 0
  let costUsd = 0
  let tasks = 0
  let estimatedTokens = 0
  let hookTokens = 0
  let paidToolTokens = 0
  for (const row of rows) {
    if (row.kind === 'reset') {
      continue
    }
    if (scope.dayKey !== undefined && row.dayKey !== scope.dayKey) {
      continue
    }
    const rowTokens = row.usage.inputTokens + row.usage.outputTokens
    tokens += rowTokens
    costUsd += row.usage.costUsd
    tasks += row.usage.tasks
    if (row.estimated) {
      estimatedTokens += rowTokens
    }
    hookTokens += row.usage.hookTokens
    paidToolTokens += row.usage.paidToolTokens
  }
  return { tokens, costUsd, tasks, estimatedTokens, hookTokens, paidToolTokens }
}

/**
 * Checks every cap of an entry against one estimate, then reserves it in
 * the journal: the reservation is written before the request is sent, so
 * admission never depends on a flush. A request that does not fit reserves
 * nothing and is not sent.
 */
export async function checkAndReserve(
  meter: TeamMeter,
  journal: TeamReservationJournal,
  request: {
    readonly workspaceId: string
    readonly entryId: string
    readonly agentKey: string
    readonly taskId: string
    readonly caps: readonly { readonly measure: TeamMeasure; readonly window: TeamWindow; readonly amount: number }[]
    readonly tokens: number
    readonly spendUsd: number
    readonly dayKey: string
  },
): Promise<
  | { readonly ok: true; readonly reservation: TeamReservation }
  | { readonly ok: false; readonly measure: TeamMeasure; readonly window: TeamWindow; readonly used: number; readonly amount: number }
> {
  for (const cap of request.caps) {
    const reading = meter.used(
      request.entryId,
      cap,
      { taskId: request.taskId, dayKey: request.dayKey },
    )
    const want =
      cap.measure === 'spendUsd'
        ? request.spendUsd
        : cap.measure === 'tasks'
          ? 1
          : request.tokens
    if (reading.value + want > cap.amount) {
      return { ok: false, measure: cap.measure, window: cap.window, used: reading.value, amount: cap.amount }
    }
  }
  const reservation = await journal.reserve({
    workspaceId: request.workspaceId,
    entryId: request.entryId,
    agentKey: request.agentKey,
    taskId: request.taskId,
    tokens: request.tokens,
    spendUsd: request.spendUsd,
  })
  return { ok: true, reservation }
}
