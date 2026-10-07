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

import { MILLISECONDS_PER_MINUTE, UI_TEXT } from '../../shared/constants'
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
  /** When the delegation began, not the time of a later usage settlement. */
  readonly startMs: number
  readonly usage: TeamMeterUsage
  /** True where the provider reports nothing and the extension measured. */
  readonly estimated: boolean
  /** Reset rows only: the window cleared, for one entry or (undefined) all. */
  readonly clearedWindow?: TeamWindow
  readonly clearedEntryId?: string
  /** Persisted cumulative usage at Reset, so later settlements count their delta. */
  readonly clearedUsage?: readonly {
    readonly entryId: string
    readonly taskId: string
    readonly dayKey: string
    readonly usage: TeamMeterUsage
  }[]
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
  readonly dayKey: string
  readonly startMs: number
  readonly workspaceId: string
  readonly entryId: string
  readonly agentKey: string
  readonly taskId: string
  readonly tokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly spendUsd: number
}

type TeamClaimUsage = Pick<TeamReservation, 'tokens' | 'inputTokens' | 'outputTokens' | 'spendUsd'>

/** A durable outcome replaces the reservation; liability retains its whole bound. */
export type TeamClaimOutcome =
  | (TeamClaimUsage & { readonly kind: 'reported' | 'liability' })
  | {
      readonly kind: 'refunded'
      readonly tokens: 0
      readonly inputTokens: 0
      readonly outputTokens: 0
      readonly spendUsd: 0
    }

export interface TeamClaimRecord {
  readonly reservation: TeamReservation
  readonly outcome?: TeamClaimOutcome
}

/** Current limits, read again synchronously just before dispatch. Zero is a hard stop. */
export interface TeamDailyBudgets {
  readonly paidDailyBudgetUsd: number
  readonly teamDailyBudgetUsd: number
  readonly teamDailyBudgetTokens: number
  readonly workspaceDailyBudgetUsd: number
  readonly workspaceDailyBudgetTokens: number
}

export type TeamClaimAdmission =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly measure: TeamMeasure
      readonly window: TeamWindow
      readonly used: number
      readonly amount: number
      readonly scope?: 'paid' | 'team' | 'workspace'
    }

export interface TeamClaimLimits {
  readonly budgets: TeamDailyBudgets
  readonly caps: readonly {
    readonly measure: TeamMeasure
    readonly window: TeamWindow
    readonly amount: number
  }[]
}

export interface TeamBudgetClaim {
  readonly reservation: TeamReservation
  /** Like D78's claim.check: reads ALL durable intents/outcomes, with no await before dispatch.
   * Includes this claim; entry caps include historical ledger use without counting it twice.
   * Missing/corrupt storage, a closed claim or an obsolete day throws and sends nothing.
   */
  check(limits: TeamClaimLimits): TeamClaimAdmission
}

/** Injected D78 adapter, hosted by integration; no production stand-in.
 * Each request publishes one permanent intent before check. All windows/workspaces
 * share paid/team totals; entry caps are workspace-scoped. Outcomes are durable
 * before acknowledgement, identical retries succeed, conflicting retries throw.
 */
export interface TeamReservationJournal {
  claim(reservation: Omit<TeamReservation, 'id'>): Promise<TeamBudgetClaim>
  settle(
    id: string,
    outcome: Exclude<TeamClaimOutcome, { readonly kind: 'refunded' }>,
  ): Promise<void>
  /** Only a known nonsent claim is refunded; retained intents are never removed. */
  refund(id: string): Promise<void>
  lookupByClaimId(id: string): Promise<TeamClaimRecord | undefined>
  /** Atomically persist max(candidate, latest), across windows and restarts. */
  latestDay(candidate: string): Promise<string>
}

/** Structural D78 settlement port shared by meter and host recovery. */
export interface TeamSettlementClaims {
  lookupByClaimId(id: string): Promise<
    | {
        readonly reservation: TeamClaimUsage & { readonly id: string; readonly dayKey: string }
        readonly outcome?: TeamClaimOutcome
      }
    | undefined
  >
  settle(
    id: string,
    outcome: Exclude<TeamClaimOutcome, { readonly kind: 'refunded' }>,
  ): Promise<void>
  refund(id: string): Promise<void>
}

/** Restart-safe settlement: no new reservation, double charge, or lost refund. */
export async function settleTeamClaim(
  journal: TeamSettlementClaims,
  id: string,
  outcome:
    | (TeamClaimUsage & { readonly kind: 'reported' })
    | { readonly kind: 'unknown' }
    | { readonly kind: 'nonsent' },
  failure: (reason: 'unavailable' | 'conflict') => Error,
): Promise<void> {
  const claim = await journal.lookupByClaimId(id)
  if (claim?.reservation.id !== id) throw failure('unavailable')
  let next: TeamClaimOutcome
  if (outcome.kind === 'nonsent')
    next = { kind: 'refunded', tokens: 0, inputTokens: 0, outputTokens: 0, spendUsd: 0 }
  else if (outcome.kind === 'unknown')
    next = {
      kind: 'liability',
      tokens: claim.reservation.tokens,
      inputTokens: claim.reservation.inputTokens,
      outputTokens: claim.reservation.outputTokens,
      spendUsd: claim.reservation.spendUsd,
    }
  else next = outcome
  if (claim.outcome !== undefined) {
    if (
      claim.outcome.kind !== next.kind ||
      claim.outcome.tokens !== next.tokens ||
      claim.outcome.inputTokens !== next.inputTokens ||
      claim.outcome.outputTokens !== next.outputTokens ||
      claim.outcome.spendUsd !== next.spendUsd
    ) {
      throw failure('conflict')
    }
    return
  }
  if (next.kind === 'refunded') await journal.refund(id)
  else await journal.settle(id, next)
}

/** Meter callers retain their localized storage refusal. */
export async function settleTeamReservation(
  journal: TeamReservationJournal,
  id: string,
  outcome: Parameters<typeof settleTeamClaim>[2],
): Promise<void> {
  await settleTeamClaim(
    journal,
    id,
    outcome,
    () => new Error(UI_TEXT.sessionBudgetStoreUnavailable),
  )
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

function reservationAmount(measure: TeamMeasure, reservation: TeamClaimUsage): number {
  switch (measure) {
    case 'tokens': {
      return reservation.tokens
    }
    case 'inputTokens': {
      return reservation.inputTokens
    }
    case 'outputTokens': {
      return reservation.outputTokens
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
function isRowInScope(
  row: TeamMeterRow,
  entryId: string,
  window: TeamWindow,
  scope: { readonly taskId: string; readonly dayKey: string },
): boolean {
  if (row.kind === 'reset' || row.entryId !== entryId) {
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
  /**
   * Whether a task past its minutes is stopped (D75): elapsed minutes
   * against the role's minutes per task.
   */
  public static isTaskOverdue(startMs: number, minutesPerTask: number, nowMs: number): boolean {
    return nowMs - startMs >= minutesPerTask * MILLISECONDS_PER_MINUTE
  }

  public constructor(private readonly source: TeamMeterSource) {}

  /**
   * The latest reset clearing an entry's window (0 when none): its persisted
   * baseline is subtracted from later usage. A reset names one window; a `task` window is
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
    const reset = this.source
      .rows()
      .find(
        (candidate) =>
          candidate.kind === 'reset' &&
          candidate.startMs === resetMs &&
          candidate.clearedWindow === cap.window &&
          (candidate.clearedEntryId === undefined || candidate.clearedEntryId === entryId),
      )
    let value = 0
    let isEstimated = false
    for (const row of this.source.rows()) {
      if (!isRowInScope(row, entryId, cap.window, scope)) {
        continue
      }
      const baseline = reset?.clearedUsage?.find(
        (cleared) =>
          cleared.entryId === row.entryId &&
          cleared.taskId === row.taskId &&
          cleared.dayKey === row.dayKey,
      )
      // Old markers without a baseline keep their original clearing semantics.
      if (reset?.clearedUsage === undefined && row.startMs < resetMs) continue
      const amount = Math.max(
        0,
        usageAmount(cap.measure, row.usage) -
          (baseline === undefined ? 0 : usageAmount(cap.measure, baseline.usage)),
      )
      value += amount
      if (amount > 0) isEstimated ||= row.estimated
    }
    for (const reservation of this.source.openReservations()) {
      if (reservation.entryId !== entryId) {
        continue
      }
      if (cap.window === 'day' && reservation.dayKey !== scope.dayKey) {
        continue
      }
      if (cap.window === 'task' && reservation.taskId !== scope.taskId) {
        continue
      }
      const amount = reservationAmount(cap.measure, reservation)
      if (amount === 0) {
        continue
      }
      value += amount
      // A reservation is an estimate until reported usage replaces it.
      isEstimated = true
    }
    return { value, estimated: isEstimated }
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

/** Publish the request's claim, then check the complete durable scope.
 * A local preflight avoids known failures; it is never the final admission.
 * Call the returned check synchronously at dispatch, with no await in between;
 * if it refuses, refund the nonsent claim. Limits are read anew on every check.
 */
export async function checkAndReserve(
  meter: TeamMeter,
  journal: TeamReservationJournal,
  request: Omit<TeamReservation, 'id'> & {
    readonly caps: TeamClaimLimits['caps']
    readonly budgets: () => TeamDailyBudgets
  },
): Promise<
  | Extract<TeamClaimAdmission, { readonly ok: false }>
  | {
      readonly ok: true
      readonly reservation: TeamReservation
      readonly check: () => TeamClaimAdmission
    }
> {
  const dayKey = await journal.latestDay(request.dayKey)
  for (const cap of request.caps) {
    const reading = meter.used(request.entryId, cap, { taskId: request.taskId, dayKey })
    // Tasks are counted at delegation admission, not again on every request.
    const want = reservationAmount(cap.measure, request)
    if (reading.value + want > cap.amount) {
      return {
        ok: false,
        measure: cap.measure,
        window: cap.window,
        used: reading.value,
        amount: cap.amount,
      }
    }
  }
  const claim = await journal.claim({
    workspaceId: request.workspaceId,
    entryId: request.entryId,
    agentKey: request.agentKey,
    taskId: request.taskId,
    tokens: request.tokens,
    inputTokens: request.inputTokens,
    outputTokens: request.outputTokens,
    spendUsd: request.spendUsd,
    startMs: request.startMs,
    dayKey,
  })
  const check = () => claim.check({ caps: request.caps, budgets: request.budgets() })
  try {
    const admitted = check()
    if (!admitted.ok) {
      await journal.refund(claim.reservation.id)
      return admitted
    }
    return { ok: true, reservation: claim.reservation, check }
  } catch (error: unknown) {
    await journal.refund(claim.reservation.id)
    throw error
  }
}
