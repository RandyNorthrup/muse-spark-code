// The single-model check (PLAN.md M96 lane T, D75 "Scheduler and traffic").
// With one model (after `sameModel` dedupe) nothing team-related loads or
// changes requests: no server registered, no tool declared, no probe, no
// process, no wait before the first send. Pure: every lane-R/A/K input
// arrives through `TeamDecisionSource`, injected by the host.
//
// Read in the activation bundle from workspace state alone (the zero-traffic
// baseline): a workspace with no distinct custom entry, with Solo, or with
// the team off sends nothing for the team at any time.

import * as z from 'zod/mini'
import { TEAM_BOOTSTRAP_MODEL_TEXT, VERIFY_TOOLS } from './constants'
export { TEAM_BOOTSTRAP_MODEL_TEXT } from './constants'
import {
  isSameTeamModelId,
  partitionTeamCandidates,
  type TeamAvailabilityCandidate,
} from './teamAvailability'

import type { TeamDecisionSource } from '../core/team/teamSeams'

/** Why the conversation stays single-model, or runs the team. */
export type SingleModelReason =
  | 'team-off'
  | 'solo'
  | 'nothing-configured'
  | 'default-only'
  | 'duplicate-models'
  | 'key-entries-off'
  | 'unavailable'
  | 'not-loaded'
  | 'ready'

export type TeamConversationMode = 'single-model' | 'team'

export interface TeamConversationDecision {
  readonly mode: TeamConversationMode
  readonly reason: SingleModelReason
}

/**
The person's own switch (D217): teams are off only while explicitly set
`false`. An absent setting counts as on: the two-model rule, not a
default, keeps teams off until a second model is set up. Every entry
point asks this function and the shared availability rule together, so an
explicit off opens nothing on any surface.
*/
export function isTeamAvailable(setting: unknown): boolean {
  return setting !== false
}

/**
Decides a conversation's mode when it starts, from the latest probe
results already known. An entry counts only when it is both a different
model from the orchestrator slot's (after `sameModel` dedupe) and
observably loaded in this window. Key-billed entries need `teamWorkers`
on; unavailable or unready entries never count.
*/
export function decideTeamConversationMode(source: TeamDecisionSource): TeamConversationDecision {
  if (!source.teamSwitchOn) {
    return { mode: 'single-model', reason: 'team-off' }
  }
  if (source.soloTemplate) {
    return { mode: 'single-model', reason: 'solo' }
  }
  if (source.customEntries.length === 0) {
    return { mode: 'single-model', reason: 'nothing-configured' }
  }
  const { distinct, runnable } = partitionTeamCandidates(source.customEntries, {
    leadModelId: source.orchestratorModelId,
    isSameModel: source.isSameModel,
    teamWorkersOn: source.teamWorkersOn,
  })
  if (distinct.length === 0) {
    return { mode: 'single-model', reason: 'duplicate-models' }
  }
  if (distinct.every((entry) => entry.billsKey) && !source.teamWorkersOn) {
    return { mode: 'single-model', reason: 'key-entries-off' }
  }
  if (runnable.length === 0) {
    return { mode: 'single-model', reason: 'unavailable' }
  }
  const ready = runnable.filter((entry) => source.isEntryReady(entry.entryId))
  return ready.length === 0
    ? { mode: 'single-model', reason: 'not-loaded' }
    : { mode: 'team', reason: 'ready' }
}

/** The workspace-state keys the activation bundle reads (no probe, no process). */
export const TEAM_WORKSPACE_KEYS = {
  /** The workspace team (lanes R/A own the shape): template, roles and pools. */
  team: 'museSpark.team.config',
  conversationModes: 'museSpark.team.conversations',
} as const

/** The narrowest workspace-state read: `get` only, never `update`. */
export interface TeamWorkspaceStateReader {
  get(key: string): unknown
}

/**
Whether the workspace's stored team alone rules the team out, before any
probe result is consulted. Anything stored that is not a visible Solo
template or an absent team leaves the decision to the probes: this reader
never turns the team on by itself.
*/
export function readTeamWorkspaceHint(state: TeamWorkspaceStateReader): {
  readonly soloTemplate: boolean
  readonly hasStoredTeam: boolean
} {
  const stored: unknown = state.get(TEAM_WORKSPACE_KEYS.team)
  if (stored === undefined || stored === null) {
    return { soloTemplate: false, hasStoredTeam: false }
  }
  if (typeof stored !== 'object') {
    return { soloTemplate: false, hasStoredTeam: false }
  }
  const template: unknown = 'template' in stored ? stored.template : undefined
  return {
    soloTemplate: template === 'Solo' || template === 'solo',
    hasStoredTeam: true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
Whether the stored team names an entry that could make a conversation a
team one: an agent this surface runs, a model other than the
orchestrator's (model ids compared trimmed, lane R's `sameModel`), and,
when it bills a key, `teamWorkers` on. The stored-state form of the one
availability rule: read in the activation bundle from workspace state
alone, without such an entry nothing loads and nothing is probed (Solo,
single-model, key entries with `teamWorkers` off; acceptance 1 and 47).
`canRunAgent` narrows `canRunKind` where dispatch looks past the kind
(headless refuses subscription workers); absent, the kind alone decides.
*/
export function hasRunnableTeamEntry(
  state: TeamWorkspaceStateReader,
  options: {
    readonly orchestratorModelId: string
    readonly isTeamWorkersOn: boolean
    readonly canRunKind: (kind: string) => boolean
    readonly canRunAgent?: (agent: { readonly kind: string; readonly pays: unknown }) => boolean
  },
): boolean {
  const stored: unknown = state.get(TEAM_WORKSPACE_KEYS.team)
  if (!isRecord(stored) || stored['template'] === 'Solo') return false
  const roles: unknown = stored['roles']
  if (!Array.isArray(roles)) return false
  const candidates: TeamAvailabilityCandidate[] = []
  for (const role of roles) {
    if (!isRecord(role)) continue
    const pool: unknown = role['pool']
    if (!Array.isArray(pool)) continue
    for (const entry of pool) {
      const agent = isRecord(entry) ? entry['agent'] : undefined
      if (!isRecord(agent)) continue
      const { kind, model, pays } = agent
      if (typeof kind !== 'string' || typeof model !== 'string') continue
      candidates.push({
        modelId: model,
        billsKey: pays === 'key',
        isAvailable: options.canRunAgent?.({ kind, pays }) ?? options.canRunKind(kind),
      })
    }
  }
  return (
    partitionTeamCandidates(candidates, {
      leadModelId: options.orchestratorModelId,
      isSameModel: isSameTeamModelId,
      teamWorkersOn: options.isTeamWorkersOn,
    }).runnable.length > 0
  )
}

const conversationModesSchema = z.record(z.string(), z.enum(['single-model', 'team']))

/** Unknown/older sessions stay single-model, irrespective of today's setup. */
export function readTeamConversationMode(
  state: TeamWorkspaceStateReader,
  sessionId: string,
): TeamConversationMode {
  const parsed = conversationModesSchema.safeParse(state.get(TEAM_WORKSPACE_KEYS.conversationModes))
  return parsed.success ? (parsed.data[sessionId] ?? 'single-model') : 'single-model'
}

/** The declared set is workspace metadata, never reconstructed from new probes on resume. */
export async function storeTeamConversationMode(
  state: TeamWorkspaceStateReader & { update(key: string, value: unknown): unknown },
  sessionId: string,
  mode: TeamConversationMode,
): Promise<void> {
  const parsed = conversationModesSchema.safeParse(state.get(TEAM_WORKSPACE_KEYS.conversationModes))
  await state.update(TEAM_WORKSPACE_KEYS.conversationModes, {
    ...(parsed.success && parsed.data),
    [sessionId]: mode,
  })
}

/** Pure call-admission rule, shared by the backend's current-state checks. */
export function teamInPlaceRefusalFor({
  name,
  capability,
  isExternalWriter,
  isUnknownMcp,
  detail,
}: {
  readonly name: string
  readonly capability: string | undefined
  readonly isExternalWriter: boolean
  readonly isUnknownMcp: boolean
  readonly detail: string
}):
  | { readonly output: string; readonly visibleOutput: string; readonly failureReason: string }
  | undefined {
  // Read-only metadata cannot turn a writing name into a read. Unknown
  // MCP tools have no proved read capability, so they refuse in place.
  const isWritingName = /^mcp__[^_].*__(?:write|edit|create|delete|move|rename|remove)/i.test(name)
  if (
    !isExternalWriter &&
    !isWritingName &&
    !isUnknownMcp &&
    capability !== 'edit' &&
    capability !== 'shell' &&
    name !== 'merge' &&
    name !== VERIFY_TOOLS.runChecks
  )
    return undefined
  return {
    output: `Error: ${TEAM_BOOTSTRAP_MODEL_TEXT.inPlaceRefusal}`,
    visibleOutput: detail,
    failureReason: detail,
  }
}
