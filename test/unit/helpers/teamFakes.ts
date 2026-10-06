// Fakes for the M96 lane A team tests: scripted agents, meter snapshots,
// a reservation journal and a limit classifier. Production code never sees
// these; they live in test/** only.

import type {
  TeamBudgetClaim,
  TeamClaimAdmission,
  TeamClaimLimits,
  TeamClaimOutcome,
  TeamClaimRecord,
  TeamReservation,
  TeamReservationJournal,
} from '../../../src/core/team/teamMeter'
import {
  TeamAgentMarks,
  type TEAM_DEFAULT_ENTRY,
  type TeamAgentProfile,
  type TeamCap,
  type TeamLimitClassification,
  type TeamLimitClassifier,
  type TeamPoolEntry,
  type TeamRolePool,
  type TeamSelectionSnapshot,
} from '../../../src/core/team/teamPool'

export function keyAgent(
  overrides: Partial<TeamAgentProfile> & { readonly key: string },
): TeamAgentProfile {
  return {
    kind: 'engine',
    billing: 'key',
    modelId: 'muse-spark-1.3',
    label: overrides.key,
    ...overrides,
  }
}

export function poolEntry(
  id: string,
  agent: TeamAgentProfile | typeof TEAM_DEFAULT_ENTRY,
  caps: readonly TeamCap[] = [],
  concurrent = 4,
): TeamPoolEntry {
  return { id, agent, concurrent, caps }
}

export function rolePool(
  roleId: string,
  entries: readonly TeamPoolEntry[],
  overrides: Partial<TeamRolePool> = {},
): TeamRolePool {
  return { roleId, entries, policy: 'ask', continueOnNext: false, ...overrides }
}

export interface SnapshotOptions {
  readonly nowMs?: number
  readonly defaultAgent?: TeamAgentProfile
  readonly runningByEntry?: ReadonlyMap<string, number>
  readonly runningByAgent?: ReadonlyMap<string, number>
  readonly used?: (entryId: string, cap: TeamCap) => number
  readonly firstTokens?: number
  readonly firstInputTokens?: number
  readonly firstOutputTokens?: number
  readonly firstSpendUsd?: number
  readonly agentLimit?: (agentKey: string) => number
  readonly available?: (agent: TeamAgentProfile) => boolean
  readonly marks?: TeamAgentMarks
  readonly startedThisTurn?: number
  readonly taskId?: string
}

export function selectionSnapshot(options: SnapshotOptions = {}): TeamSelectionSnapshot {
  return {
    nowMs: options.nowMs ?? 1_000_000,
    defaultAgent:
      options.defaultAgent ?? keyAgent({ key: 'default', label: 'Default (muse-spark-1.3)' }),
    startedThisTurn: options.startedThisTurn ?? 0,
    runningByEntry: options.runningByEntry ?? new Map(),
    runningByAgent: options.runningByAgent ?? new Map(),
    usedByEntryCap: options.used ?? (() => 0),
    firstRequest: {
      tokens: options.firstTokens ?? 1000,
      inputTokens: options.firstInputTokens ?? options.firstTokens ?? 1000,
      outputTokens: options.firstOutputTokens ?? 0,
      spendUsd: options.firstSpendUsd ?? 0.01,
    },
    agentLimit: options.agentLimit ?? (() => 8),
    isAgentAvailable: options.available ?? (() => true),
    global: { running: 0, limit: 20 },
    process: { running: 0, limit: 4 },
    teamBudget: undefined,
    marks: options.marks ?? new TeamAgentMarks(),
    taskId: options.taskId ?? 'task-1',
  }
}

/** A limit classifier scripted by error text: 'rate:120000' or 'usage[:resetMs]'. */
export function scriptedClassifier(): TeamLimitClassifier & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    classify(error: unknown): TeamLimitClassification | undefined {
      calls.push(error)
      if (typeof error !== 'string') {
        return undefined
      }
      if (error.startsWith('rate:')) {
        return { kind: 'rateLimit', retryAfterMs: Number(error.slice('rate:'.length)) }
      }
      if (error.startsWith('usage')) {
        const rest = error.slice('usage'.length)
        return {
          kind: 'usageLimit',
          resetMs: rest.startsWith(':') ? Number(rest.slice(1)) : undefined,
        }
      }
      return undefined
    },
  }
}

/** Test-only durable state shared by windows and reconstructed journal instances. */
export interface FakeTeamJournalState {
  readonly claims: Map<string, TeamClaimRecord>
  readonly otherPaidUsd: Map<string, number>
  latest: string
  next: number
}

/** D78 semantics: immutable intents, synchronous whole-scope check, replace-on-settle,
 * exact idempotent outcomes, unknown liability, and restart lookup by id.
 * No locking or liveness election. The real adapter owns filesystem durability.
 */
export class FakeTeamJournal implements TeamReservationJournal {
  public readonly calls: string[] = []
  public constructor(
    public readonly state: FakeTeamJournalState = {
      claims: new Map(),
      otherPaidUsd: new Map(),
      latest: '',
      next: 1,
    },
  ) {}

  private check(own: TeamReservation, limits: TeamClaimLimits): TeamClaimAdmission {
    this.calls.push('check')
    const stored = this.state.claims.get(own.id)
    if (stored === undefined || stored.outcome !== undefined || own.dayKey !== this.state.latest) {
      throw new Error('Claim closed or day obsolete')
    }
    const day = Array.from(this.state.claims, ([, claim]) => claim).filter(
      (claim) => claim.reservation.dayKey === own.dayKey,
    )
    const workspace = day.filter((claim) => claim.reservation.workspaceId === own.workspaceId)
    const budgetChecks = [
      {
        scope: 'paid',
        measure: 'spendUsd',
        amount: limits.budgets.paidDailyBudgetUsd,
        used: sumClaims(day, 'spendUsd') + (this.state.otherPaidUsd.get(own.dayKey) ?? 0),
      },
      {
        scope: 'team',
        measure: 'spendUsd',
        amount: limits.budgets.teamDailyBudgetUsd,
        used: sumClaims(day, 'spendUsd'),
      },
      {
        scope: 'team',
        measure: 'tokens',
        amount: limits.budgets.teamDailyBudgetTokens,
        used: sumClaims(day, 'tokens'),
      },
      {
        scope: 'workspace',
        measure: 'spendUsd',
        amount: limits.budgets.workspaceDailyBudgetUsd,
        used: sumClaims(workspace, 'spendUsd'),
      },
      {
        scope: 'workspace',
        measure: 'tokens',
        amount: limits.budgets.workspaceDailyBudgetTokens,
        used: sumClaims(workspace, 'tokens'),
      },
    ] as const
    for (const budget of budgetChecks) {
      if (budget.amount === 0 || budget.used > budget.amount)
        return { ok: false, window: 'day', ...budget }
    }
    for (const cap of limits.caps) {
      const rows = Array.from(this.state.claims, ([, claim]) => claim).filter(
        ({ reservation, outcome }) =>
          outcome?.kind !== 'refunded' &&
          reservation.workspaceId === own.workspaceId &&
          reservation.entryId === own.entryId &&
          (cap.window !== 'day' || reservation.dayKey === own.dayKey) &&
          (cap.window !== 'task' || reservation.taskId === own.taskId),
      )
      const used =
        cap.measure === 'tasks'
          ? new Set(rows.map(({ reservation }) => reservation.taskId)).size
          : sumClaims(rows, cap.measure)
      if (used > cap.amount)
        return { ok: false, measure: cap.measure, window: cap.window, used, amount: cap.amount }
    }
    return { ok: true }
  }

  private finish(id: string, outcome: TeamClaimOutcome): Promise<void> {
    const claim = this.state.claims.get(id)
    if (claim === undefined) return Promise.reject(new Error('Missing claim'))
    if (
      claim.outcome !== undefined &&
      (claim.outcome.kind !== outcome.kind ||
        claim.outcome.tokens !== outcome.tokens ||
        claim.outcome.inputTokens !== outcome.inputTokens ||
        claim.outcome.outputTokens !== outcome.outputTokens ||
        claim.outcome.spendUsd !== outcome.spendUsd)
    ) {
      return Promise.reject(new Error('Conflicting durable outcome'))
    }
    this.state.claims.set(id, { ...claim, outcome })
    return Promise.resolve()
  }

  public latestDay(candidate: string): Promise<string> {
    return advanceFakeTeamDay(this.state, candidate)
  }

  public claim(reservation: Omit<TeamReservation, 'id'>): Promise<TeamBudgetClaim> {
    this.calls.push('claim')
    const created = { ...reservation, id: `res-${String(this.state.next++)}` }
    this.state.claims.set(created.id, { reservation: created })
    return Promise.resolve({ reservation: created, check: (limits) => this.check(created, limits) })
  }

  public settle(
    id: string,
    outcome: Exclude<TeamClaimOutcome, { readonly kind: 'refunded' }>,
  ): Promise<void> {
    this.calls.push(`settle:${outcome.kind}`)
    return this.finish(id, outcome)
  }

  public refund(id: string): Promise<void> {
    this.calls.push('refund')
    return this.finish(id, refundedTeamOutcome())
  }

  public lookupByClaimId(id: string): Promise<TeamClaimRecord | undefined> {
    this.calls.push('lookupByClaimId')
    return Promise.resolve(this.state.claims.get(id))
  }

  public open(): Promise<readonly TeamReservation[]> {
    return Promise.resolve(
      Array.from(this.state.claims, ([, claim]) => claim)
        .filter(({ outcome }) => outcome === undefined || outcome.kind === 'liability')
        .map(({ reservation }) => reservation),
    )
  }
}

function sumClaims(
  claims: readonly TeamClaimRecord[],
  measure: 'tokens' | 'inputTokens' | 'outputTokens' | 'spendUsd',
): number {
  return claims.reduce((total, claim) => total + (claim.outcome ?? claim.reservation)[measure], 0)
}

/** Both lane journals use the same monotonic day and zero refund value. */
export function advanceFakeTeamDay(state: { latest: string }, candidate: string): Promise<string> {
  state.latest = candidate > state.latest ? candidate : state.latest
  return Promise.resolve(state.latest)
}
export function refundedTeamOutcome(): Extract<TeamClaimOutcome, { readonly kind: 'refunded' }> {
  return { kind: 'refunded', tokens: 0, inputTokens: 0, outputTokens: 0, spendUsd: 0 }
}
