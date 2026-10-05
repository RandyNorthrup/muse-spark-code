// Fakes for the M96 lane A team tests: scripted agents, meter snapshots,
// a reservation journal and a limit classifier. Production code never sees
// these; they live in test/** only.

import type { TeamReservation, TeamReservationJournal } from '../../../src/core/team/teamMeter'
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
    firstRequest: { tokens: options.firstTokens ?? 1000, spendUsd: options.firstSpendUsd ?? 0.01 },
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

/** An in-memory reservation journal that records its call order. */
export class FakeTeamJournal implements TeamReservationJournal {
  private readonly held = new Map<string, TeamReservation>()
  private next = 1

  public readonly calls: string[] = []

  public reserve(reservation: Omit<TeamReservation, 'id'>): Promise<TeamReservation> {
    this.calls.push('reserve')
    const created: TeamReservation = { ...reservation, id: `res-${String(this.next++)}` }
    this.held.set(created.id, created)
    return Promise.resolve(created)
  }

  public settle(
    id: string,
    outcome:
      | { readonly kind: 'reported'; readonly tokens: number; readonly spendUsd: number }
      | { readonly kind: 'unknown' }
      | { readonly kind: 'nonsent' },
  ): Promise<void> {
    this.calls.push(`settle:${outcome.kind}`)
    if (outcome.kind === 'nonsent') {
      this.held.delete(id)
    }
    return Promise.resolve()
  }

  public open(): Promise<readonly TeamReservation[]> {
    const held: TeamReservation[] = []
    for (const reservation of this.held.values()) {
      held.push(reservation)
    }
    return Promise.resolve(held)
  }
}
