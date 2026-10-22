import { Usd, type UsdAmount } from '../../shared/usd'
import type {
  TeamAgentProfile,
  TeamMeasure,
  TeamPoolEntry,
  TeamRolePool,
  TeamSelectionSnapshot,
  TeamSelection,
  TeamEntryExhaustion,
} from './teamPool'
import {
  canMeetTaskConditions,
  isTaskAuthor,
  type TeamPreferenceList,
  type TeamSkip,
  type TeamAvailabilityProbe,
  type TeamCandidate,
  type TeamAvailability,
} from '../../shared/teamPreference'
import { isSameTeamModel } from './sameModel'
import { taskAuthorCandidates } from './borrow'

/** Live host facts; the installed governor owns admission, never this selector. */
export interface TeamAvailabilityFacts {
  readonly signedIn: boolean
  readonly healthy: boolean
  readonly nodeOnline: boolean
  readonly admitted: boolean
  readonly coolingUntilMs?: number
}

export class TeamLiveAvailability implements TeamAvailabilityProbe {
  constructor(
    private readonly read: (candidate: TeamCandidate, nowMs: number) => TeamAvailabilityFacts,
  ) {}

  probe(candidate: TeamCandidate, nowMs: number): TeamAvailability {
    const facts = this.read(candidate, nowMs)
    const unavailable = (reason: TeamSkip['reason']): TeamAvailability => ({
      available: false,
      skip: { candidateId: candidate.id, reason },
    })
    if (!facts.signedIn) return unavailable('signedOut')
    if (!facts.healthy) return unavailable('unhealthy')
    if (!facts.nodeOnline) return unavailable('nodeOffline')
    if (!facts.admitted) return unavailable('notAdmitted')
    if (facts.coolingUntilMs !== undefined && nowMs < facts.coolingUntilMs)
      return {
        available: false,
        skip: { candidateId: candidate.id, reason: 'coolingDown', untilMs: facts.coolingUntilMs },
      }
    return { available: true }
  }
}

function refAgent(ref: NonNullable<TeamCandidate['agent']>): TeamAgentProfile {
  return {
    key: ref.agentId,
    modelId: ref.model,
    kind: ref.kind,
    billing: ref.pays,
    label: ref.agentId,
  }
}

/** The agent a candidate sends work through right now: its own, or Default live resolved. */
export function candidateAgent(
  candidate: TeamCandidate,
  snapshot: Pick<TeamSelectionSnapshot, 'defaultAgent'>,
): TeamAgentProfile {
  return candidate.agent === undefined ? snapshot.defaultAgent : refAgent(candidate.agent)
}

/**
The live refusal for one candidate, before any capacity: authorship,
conditions, then the availability probe. `snapshot.conditions` must already
include the authorship (`selectionConditions`).
*/
export function liveCandidateSkip(
  candidate: TeamCandidate,
  agent: TeamAgentProfile,
  snapshot: TeamSelectionSnapshot,
): TeamSkip | undefined {
  const conditions = snapshot.conditions
  const isAuthor =
    isTaskAuthor(candidate.id, agent.modelId, conditions) ||
    isTaskAuthor(candidate.id, snapshot.engine?.(candidate) ?? agent.modelId, conditions) ||
    (conditions?.authorEngines ?? []).some((engine) => isSameTeamModel(engine, agent.modelId))
  const live = snapshot.availability?.probe(candidate, snapshot.nowMs)
  if (isAuthor) return { candidateId: candidate.id, reason: 'author' }
  if (!canMeetTaskConditions(candidate.conditions, conditions))
    return { candidateId: candidate.id, reason: 'conditions' }
  return live?.available === false ? live.skip : undefined
}

/** Adapt lane 0's D75-compatible candidates without changing the legacy pool. */
function preferencePool(list: TeamPreferenceList, pool: TeamRolePool): TeamRolePool {
  if (list.role !== pool.roleId) throw new Error('team:preferenceRole')
  return {
    ...pool,
    ...(list.tasksPerTurn !== undefined && { tasksPerTurn: list.tasksPerTurn }),
    ...(list.exhausted !== undefined && { policy: list.exhausted }),
    entries: list.pool.map((candidate) => {
      const existing = pool.entries.find((entry) => entry.id === candidate.id)
      const ref = candidate.agent
      let agent: TeamPoolEntry['agent'] = { defaultEntry: true }
      if (ref !== undefined) {
        agent = refAgent(ref)
        const original = existing?.agent
        if (
          original !== undefined &&
          !isDefaultEntry(original) &&
          original.key === ref.agentId &&
          original.modelId === ref.model &&
          original.kind === ref.kind &&
          original.billing === ref.pays
        )
          agent = original
      }
      return {
        ...existing,
        id: candidate.id,
        agent,
        concurrent: candidate.concurrent,
        caps: candidate.caps,
      }
    }),
  }
}

function skipForRefusal(
  refusal: TeamEntryExhaustion,
  snapshot: TeamSelectionSnapshot,
  agent: TeamAgentProfile,
): TeamSkip {
  const mark = snapshot.marks.at(agent.key, snapshot.nowMs)
  let reason: TeamSkip['reason'] = 'busy'
  if (refusal.reason === 'rateLimited') reason = 'rateLimited'
  else if (refusal.reason === 'unavailable') reason = 'signedOut'
  else if (['cap', 'usageLimit', 'budget', 'turn'].includes(refusal.reason)) reason = 'capped'
  return {
    candidateId: refusal.entryId,
    reason,
    ...(mark !== undefined && { untilMs: mark.untilMs }),
  }
}

function isDefaultEntry(agent: TeamPoolEntry['agent']): agent is { readonly defaultEntry: true } {
  return 'defaultEntry' in agent
}

/** The amount of `firstRequest` a cap's measure counts. */
function firstRequestAmount(
  measure: TeamMeasure,
  firstRequest: TeamSelectionSnapshot['firstRequest'],
): number | UsdAmount {
  switch (measure) {
    case 'tokens': {
      return firstRequest.tokens
    }
    case 'inputTokens': {
      return firstRequest.inputTokens
    }
    case 'outputTokens': {
      return firstRequest.outputTokens
    }
    case 'spendUsd': {
      return firstRequest.spendUsd
    }
    case 'tasks': {
      return 1
    }
  }
}

function entryAgent(entry: TeamPoolEntry, snapshot: TeamSelectionSnapshot): TeamAgentProfile {
  return isDefaultEntry(entry.agent) ? snapshot.defaultAgent : entry.agent
}

/** Capability and author conditions used by selection, due-soon checks and recall. */
export function selectionConditions(snapshot: TeamSelectionSnapshot) {
  if (snapshot.authorship === undefined) return snapshot.conditions
  const authorship = snapshot.authorship
  const authors = taskAuthorCandidates(authorship.startedOn, authorship.record)
  return {
    ...snapshot.conditions,
    authorCandidates: [...new Set([...(snapshot.conditions?.authorCandidates ?? []), ...authors])],
    authorEngines: [
      ...new Set([
        ...(snapshot.conditions?.authorEngines ?? []),
        ...authors.map((id) => {
          const engine = authorship.engines.get(id)
          if (engine === undefined) throw new Error('team:authorEngineMissing')
          return engine
        }),
      ]),
    ],
  }
}

/**
The first entry with headroom, in pool order. Headroom means all of
D75's hold: `concurrent` has room, every `day` and `lifetime` cap (and
any `task` cap the entry sets) has room for the task's first request, the
agent is not marked or unavailable, and the per-agent, global, process,
turn and team limits have room. A pool with no entries answers
"not staffed" at once, under every policy.
*/
export function selectTeamEntry(
  pool: TeamRolePool,
  snapshot: TeamSelectionSnapshot,
  tasksPerTurnDefault: number,
): TeamSelection {
  const conditions = selectionConditions(snapshot)
  if (conditions !== undefined) snapshot = { ...snapshot, conditions }
  const preference = snapshot.preference
  if (preference !== undefined) {
    if (snapshot.availability === undefined) throw new Error('team:availabilityMissing')
    pool = preferencePool(preference, pool)
  }
  if (pool.entries.length === 0) {
    return { kind: 'notStaffed', roleId: pool.roleId }
  }
  const reasons: TeamEntryExhaustion[] = []
  const skips: TeamSkip[] = []
  for (const entry of pool.entries) {
    const candidate = preference?.pool.find((item) => item.id === entry.id)
    if (candidate !== undefined) {
      const skip = liveCandidateSkip(candidate, entryAgent(entry, snapshot), snapshot)
      if (skip !== undefined) {
        skips.push(skip)
        reasons.push({ entryId: entry.id, reason: 'unavailable', skip })
        continue
      }
    }
    const refusal = refuseEntry(pool, entry, snapshot, tasksPerTurnDefault)
    if (refusal === undefined) {
      return {
        kind: 'selected',
        entry,
        agent: entryAgent(entry, snapshot),
        ...(preference !== undefined && { skips }),
      }
    }
    reasons.push(refusal)
    if (preference !== undefined)
      skips.push(skipForRefusal(refusal, snapshot, entryAgent(entry, snapshot)))
  }
  return {
    kind: 'exhausted',
    roleId: pool.roleId,
    policy: pool.policy,
    reasons,
    ...(preference !== undefined && { skips }),
  }
}

/** Why an entry has no headroom, if any: the first limit that refuses. */
function refuseEntry(
  pool: TeamRolePool,
  entry: TeamPoolEntry,
  snapshot: TeamSelectionSnapshot,
  tasksPerTurnDefault: number,
): TeamEntryExhaustion | undefined {
  const agent = entryAgent(entry, snapshot)
  const mark = snapshot.marks.at(agent.key, snapshot.nowMs)
  if (mark !== undefined) {
    return {
      entryId: entry.id,
      reason: mark.kind === 'rateLimited' ? 'rateLimited' : 'usageLimit',
    }
  }
  if (!snapshot.isAgentAvailable(agent)) {
    return { entryId: entry.id, reason: 'unavailable' }
  }
  const agentRunning = snapshot.runningByAgent.get(agent.key) ?? 0
  if (agentRunning >= snapshot.agentLimit(agent.key)) {
    return { entryId: entry.id, reason: 'agent' }
  }
  if (snapshot.global.running >= snapshot.global.limit) {
    return { entryId: entry.id, reason: 'global' }
  }
  if (agent.kind !== 'engine' && snapshot.process.running >= snapshot.process.limit) {
    return { entryId: entry.id, reason: 'process' }
  }
  const turnLimit = pool.tasksPerTurn ?? tasksPerTurnDefault
  if (snapshot.startedThisTurn >= turnLimit) {
    return { entryId: entry.id, reason: 'turn' }
  }
  if ((snapshot.runningByEntry.get(entry.id) ?? 0) >= entry.concurrent) {
    return { entryId: entry.id, reason: 'concurrent' }
  }
  if (snapshot.teamBudget !== undefined && agent.billing === 'key') {
    const budget = snapshot.teamBudget
    if (
      Usd.from(budget.spendUsedUsd)
        .add(Usd.from(snapshot.firstRequest.spendUsd))
        .compare(Usd.from(budget.spendCapUsd)) > 0 ||
      budget.tokensUsed + snapshot.firstRequest.tokens > budget.tokensCap
    ) {
      return { entryId: entry.id, reason: 'budget' }
    }
  }
  for (const cap of entry.caps) {
    const isValid =
      Number.isFinite(cap.amount) &&
      (snapshot.preference === undefined ? cap.amount > 0 : cap.amount >= 0)
    if (!isValid) {
      continue
    }
    const used = snapshot.usedByEntryCap(entry.id, cap)
    if (
      Usd.from(used)
        .add(Usd.from(firstRequestAmount(cap.measure, snapshot.firstRequest)))
        .compare(Usd.from(cap.amount)) > 0
    ) {
      return { entryId: entry.id, reason: 'cap', cap, used: Number(used) }
    }
  }
  return undefined
}
