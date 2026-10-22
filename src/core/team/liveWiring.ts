// Live wiring into D75 pools and the hosts (M120 lane W, PLAN.md D103).
//
// Lane S selects; this module feeds it live facts. The availability probe
// reads sign-in, health, node reachability and governor admission from the
// injected host facts (M100/M110 nodes arrive as candidate `node` ids).
// Snapshot assembly counts meter rows and open admissions exactly like the
// ledger does. Engine candidates sort by M95's provider file order, so the
// first configured provider serves first. Every dispatch lands one record
// the M116 playbook reads. Pure: every host fact arrives as an argument.

import { TeamLiveAvailability } from './selection'
import type { TeamAvailabilityProbe, TeamCandidate } from '../../shared/teamPreference'
import type { TeamCap, TeamSelection, TeamSelectionSnapshot } from './teamPool'
import type { TeamAgentMarks, TeamAgentProfile } from './teamPool'
import { teamDayKey, type TeamMeter } from './teamMeter'
import type { TeamBoardTask } from '../../shared/team'
import { Usd } from '../../shared/usd'

/**
The empty snapshot's first-request spend: a cent of sizing context, not a
charge. The ledger replaces it the moment a real first request is sized.
*/
const FIRST_REQUEST_SPEND_USD = 0.01

/** The live host facts selection reads; the host implements each one. */
export interface LiveHostFacts {
  readonly signedIn: (candidateId: string) => boolean
  readonly healthy: (candidateId: string) => boolean
  readonly nodeOnline: (nodeId: string | undefined) => boolean
  readonly governorAdmitted: (candidateId: string) => boolean
  readonly coolingUntilMs: (candidateId: string) => number | undefined
}

/** Lane S's probe over the host's facts: sign-in, health, node, admission. */
export function liveAvailabilityProbe(facts: LiveHostFacts): TeamAvailabilityProbe {
  return new TeamLiveAvailability((candidate, _nowMs) => {
    const cooling = facts.coolingUntilMs(candidate.id)
    return {
      signedIn: facts.signedIn(candidate.id),
      healthy: facts.healthy(candidate.id),
      nodeOnline: facts.nodeOnline(candidate.node),
      admitted: facts.governorAdmitted(candidate.id),
      ...(cooling !== undefined && { coolingUntilMs: cooling }),
    }
  })
}

/** Everything snapshot assembly reads, resolved for one delegation. */
export interface LiveSelectionSources extends LiveHostFacts {
  readonly nowMs: number
  readonly defaultAgent: TeamAgentProfile
  readonly meter: TeamMeter
  readonly marks: TeamAgentMarks
  readonly teamBudget:
    | {
        readonly spendUsedUsd: string
        readonly spendCapUsd: string
        readonly tokensUsed: number
        readonly tokensCap: number
      }
    | undefined
  readonly agentLimit: (agentKey: string) => number
  readonly isAgentAvailable: (agent: TeamAgentProfile) => boolean
  readonly global: { readonly running: number; readonly limit: number }
  readonly process: { readonly running: number; readonly limit: number }
  readonly runningByEntry: ReadonlyMap<string, number>
  readonly runningByAgent: ReadonlyMap<string, number>
  readonly startedThisTurn: number
  readonly taskId: string
}

/** Assembles the selection snapshot from the ledger, marks and host facts. */
export function assembleSnapshot(sources: LiveSelectionSources): TeamSelectionSnapshot {
  const dayKey = teamDayKey(sources.nowMs)
  return {
    nowMs: sources.nowMs,
    defaultAgent: sources.defaultAgent,
    startedThisTurn: sources.startedThisTurn,
    runningByEntry: sources.runningByEntry,
    runningByAgent: sources.runningByAgent,
    usedByEntryCap: (entryId: string, cap: TeamCap) =>
      sources.meter.used(entryId, cap, { taskId: sources.taskId, dayKey }).value,
    firstRequest: {
      tokens: 1000,
      inputTokens: 1000,
      outputTokens: 0,
      spendUsd: Usd.from(FIRST_REQUEST_SPEND_USD).toAmount(),
    },
    agentLimit: sources.agentLimit,
    isAgentAvailable: sources.isAgentAvailable,
    global: sources.global,
    process: sources.process,
    teamBudget:
      sources.teamBudget === undefined
        ? undefined
        : {
            spendUsedUsd: Usd.from(sources.teamBudget.spendUsedUsd).toAmount(),
            spendCapUsd: Usd.from(sources.teamBudget.spendCapUsd).toAmount(),
            tokensUsed: sources.teamBudget.tokensUsed,
            tokensCap: sources.teamBudget.tokensCap,
          },
    marks: sources.marks,
    taskId: sources.taskId,
  }
}

/**
Orders engine candidates by M95's provider file order: the first configured
provider serves first; candidates on unlisted providers keep their relative
order at the back. Non-engine candidates never move.
*/
export function orderCandidatesByProviders(
  candidates: readonly TeamCandidate[],
  providerOrder: readonly string[],
): TeamCandidate[] {
  const rank = new Map(providerOrder.map((provider, at) => [provider, at]))
  return [...candidates]
    .map((candidate, at) => ({ candidate, at }))
    .toSorted((left, right) => {
      const leftProvider = left.candidate.agent?.provider
      const rightProvider = right.candidate.agent?.provider
      const leftRank = leftProvider === undefined ? Infinity : (rank.get(leftProvider) ?? Infinity)
      const rightRank =
        rightProvider === undefined ? Infinity : (rank.get(rightProvider) ?? Infinity)
      return leftRank - rightRank || left.at - right.at
    })
    .map((item) => item.candidate)
}

/** One dispatch decision for the M116 playbook: who got the task and why. */
export interface TeamDispatch {
  readonly taskId: string
  readonly roleId: string
  readonly candidateId: string
  readonly entryId: string
  readonly atMs: number
  /** The skip reasons the winner beat, oldest check first. */
  readonly reasons: readonly string[]
}

/** Records a dispatch from a selection: the winner and every skip it beat. */
export function dispatchRecord(
  task: Pick<TeamBoardTask, 'id' | 'roleId'>,
  selection: Extract<TeamSelection, { kind: 'selected' }>,
  atMs: number,
): TeamDispatch {
  return {
    taskId: task.id,
    roleId: task.roleId,
    candidateId: selection.entry.id,
    entryId: selection.entry.id,
    atMs,
    reasons: (selection.skips ?? []).map((skip) => `${skip.candidateId}:${skip.reason}`),
  }
}
