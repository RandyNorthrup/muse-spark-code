// Lane R (M96, PLAN.md D75): the workspace team.
//
// The user's agents (pool entries), the workspace team (roles with ordered
// pools, the orchestrator slot), the user default, Default as an entry, and
// the `.muse/team.json` lowering merge. Caps are plain numbers keyed by
// measure: lane A gives the measures meaning; the lowering only ever moves
// a number down. The host reads the file and the workspace state; this
// module merges them without IO.

import {
  AGENT_ID_PATTERN,
  TEAM_BUILTIN_ROLE_IDS,
  TEAM_JSON_SEGMENTS,
  type TeamBuiltinRoleId,
} from '../../shared/constants'
import { distinctTeamModels, type TeamModelRef } from './sameModel'

/** One pool entry's agent: Default, or a configured model on its backend. */
export type TeamPoolEntry =
  | { readonly kind: 'default' }
  | {
      readonly kind: 'agent'
      readonly agent: TeamModelRef
      /**
       * The entry's own limits by measure (lane A), e.g. concurrent, task
       * and day token caps. Numbers only; lane A types the measures.
       */
      readonly caps?: Readonly<Record<string, number>> | undefined
    }

/** Default: whatever the orchestrator slot resolves to when each task starts. */
export const DEFAULT_TEAM_ENTRY: TeamPoolEntry = { kind: 'default' }

export function isDefaultEntry(entry: TeamPoolEntry): boolean {
  return entry.kind === 'default'
}

/**
 * What Default resolves to: the orchestrator slot's model and backend right
 * now. Live, not a snapshot: a picker change applies to the next
 * delegation, and a running task keeps what it started on (lane A).
 */
export function resolveDefaultEntry(slot: TeamModelRef): TeamPoolEntry {
  return { kind: 'agent', agent: slot }
}

/** One role's ordered pool: new work goes to the first entry with headroom. */
export interface TeamRolePool {
  readonly entries: readonly TeamPoolEntry[]
}

/**
 * The orchestrator slot: the composer's picker, unless the workspace names
 * another model. An absent agent is Default's behaviour; Reset to Default
 * restores it (lane T).
 */
export interface TeamOrchestratorSlot {
  readonly agent?: TeamModelRef | undefined
}

/** A workspace's team: its pools, and its orchestrator slot. */
export interface WorkspaceTeam {
  readonly roles: Readonly<Record<string, TeamRolePool>>
  readonly orchestrator: TeamOrchestratorSlot
}

export function emptyWorkspaceTeam(): WorkspaceTeam {
  return { roles: {}, orchestrator: {} }
}

/** The roles a team staffs: the built-ins, in table order. */
export function teamRoleIds(): TeamBuiltinRoleId[] {
  return [...TEAM_BUILTIN_ROLE_IDS]
}

/**
 * Staff every role without a custom entry with Default as its only entry.
 * Default alone never turns the team on: the team runs once a custom entry
 * is a second, loaded model (acceptance 47; lane T decides from this).
 */
export function staffWithDefault(team: WorkspaceTeam, roleIds: readonly string[]): WorkspaceTeam {
  const roles: Record<string, TeamRolePool> = { ...team.roles }
  for (const id of roleIds) {
    if ((roles[id]?.entries.length ?? 0) === 0) {
      roles[id] = { entries: [DEFAULT_TEAM_ENTRY] }
    }
  }
  return { roles, orchestrator: team.orchestrator }
}

/** The model ids a team holds, Default aside: lane T resolves Default first. */
export function teamModelIds(team: WorkspaceTeam): string[] {
  const ids: string[] = []
  const orchestrator = team.orchestrator.agent
  if (orchestrator !== undefined) {
    ids.push(orchestrator.model)
  }
  for (const pool of Object.values(team.roles)) {
    for (const entry of pool.entries) {
      if (entry.kind === 'agent') {
        ids.push(entry.agent.model)
      }
    }
  }
  return distinctTeamModels(ids)
}

/** A partial team: the user's defaults, or a workspace's own choices. */
export interface PartialWorkspaceTeam {
  readonly roles?: Readonly<Record<string, TeamRolePool>> | undefined
  readonly orchestrator?: TeamOrchestratorSlot | undefined
}

/**
 * The workspace team: the built-in roles staffed by Default, the user's
 * defaults over them, and the workspace's own choices over those. Pools
 * replace whole: a workspace pool lists exactly the entries it runs.
 */
export function resolveWorkspaceTeam(args: {
  readonly user?: PartialWorkspaceTeam | undefined
  readonly workspace?: PartialWorkspaceTeam | undefined
}): WorkspaceTeam {
  const roles: Record<string, TeamRolePool> = {}
  for (const id of teamRoleIds()) {
    roles[id] = { entries: [DEFAULT_TEAM_ENTRY] }
  }
  for (const partial of [args.user, args.workspace]) {
    if (partial?.roles !== undefined) {
      for (const [id, pool] of Object.entries(partial.roles)) {
        roles[id] = { entries: [...pool.entries] }
      }
    }
  }
  const orchestrator = args.workspace?.orchestrator ?? args.user?.orchestrator ?? {}
  return { roles, orchestrator }
}

/** `.muse/team.json`, workspace-relative. */
export function teamJsonPath(workspaceRoot: string, platform: NodeJS.Platform): string {
  const separator = platform === 'win32' ? '\\' : '/'
  return `${workspaceRoot}${separator}${TEAM_JSON_SEGMENTS.join(separator)}`
}

/** One role's lowering: off, a required reviewer, and lowered numeric caps. */
export interface TeamJsonRole {
  readonly off?: boolean | undefined
  readonly reviewer?: string | undefined
  readonly caps?: Readonly<Record<string, number>> | undefined
}

/** The repository's lowering file: caps and budgets down, roles off, never more. */
export interface TeamJsonFile {
  readonly roles?: Readonly<Record<string, TeamJsonRole>> | undefined
  readonly budgets?: Readonly<Record<string, number>> | undefined
}

export type TeamJsonParse =
  | { readonly ok: true; readonly file: TeamJsonFile }
  | { readonly ok: false; readonly reason: string }

const TEAM_JSON_TOP_KEYS: ReadonlySet<string> = new Set(['roles', 'budgets'])
const TEAM_JSON_ROLE_KEYS: ReadonlySet<string> = new Set(['off', 'reviewer', 'caps'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLowerableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * `.muse/team.json`, parsed. The file lowers only: a file that adds an
 * agent, a provider, a command, a role or an entry, sets `in-place`, or
 * holds an unknown key, is refused whole. In an untrusted workspace it is
 * not read at all (the host checks first).
 */
export function parseTeamJson(text: string): TeamJsonParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'team.json is not JSON' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'team.json holds an object' }
  }
  for (const key of Object.keys(parsed)) {
    if (!TEAM_JSON_TOP_KEYS.has(key)) {
      return { ok: false, reason: `team.json holds an unknown key: ${key}` }
    }
  }
  const roles: Record<string, TeamJsonRole> = {}
  const rawRoles = parsed['roles']
  if (rawRoles !== undefined) {
    if (!isRecord(rawRoles)) {
      return { ok: false, reason: 'team.json holds an invalid roles' }
    }
    for (const [id, value] of Object.entries(rawRoles)) {
      if (!isRecord(value)) {
        return { ok: false, reason: `team.json holds an invalid role: ${id}` }
      }
      for (const key of Object.keys(value)) {
        if (!TEAM_JSON_ROLE_KEYS.has(key)) {
          return { ok: false, reason: `team.json holds an unknown key: roles.${id}.${key}` }
        }
      }
      const off = value['off']
      if (off !== undefined && typeof off !== 'boolean') {
        return { ok: false, reason: `team.json holds an invalid roles.${id}.off` }
      }
      const reviewer = value['reviewer']
      if (
        reviewer !== undefined &&
        (typeof reviewer !== 'string' || !AGENT_ID_PATTERN.test(reviewer))
      ) {
        return { ok: false, reason: `team.json holds an invalid roles.${id}.reviewer` }
      }
      const caps = value['caps']
      if (caps !== undefined) {
        if (!isRecord(caps)) {
          return { ok: false, reason: `team.json holds an invalid roles.${id}.caps` }
        }
        for (const [measure, cap] of Object.entries(caps)) {
          if (!isLowerableNumber(cap)) {
            return { ok: false, reason: `team.json holds an invalid roles.${id}.caps.${measure}` }
          }
        }
      }
      roles[id] = {
        ...(typeof off === 'boolean' && { off }),
        ...(typeof reviewer === 'string' && { reviewer }),
        ...(isRecord(caps) && {
          caps: Object.fromEntries(
            Object.entries(caps).filter((entry): entry is [string, number] =>
              isLowerableNumber(entry[1]),
            ),
          ),
        }),
      }
    }
  }
  let budgets: Record<string, number> | undefined
  const rawBudgets = parsed['budgets']
  if (rawBudgets !== undefined) {
    if (!isRecord(rawBudgets)) {
      return { ok: false, reason: 'team.json holds an invalid budgets' }
    }
    for (const [name, budget] of Object.entries(rawBudgets)) {
      if (!isLowerableNumber(budget)) {
        return { ok: false, reason: `team.json holds an invalid budgets.${name}` }
      }
    }
    budgets = Object.fromEntries(
      Object.entries(rawBudgets).filter((entry): entry is [string, number] =>
        isLowerableNumber(entry[1]),
      ),
    )
  }
  return { ok: true, file: { roles, ...(budgets !== undefined && { budgets }) } }
}

/** The numbers a lowering is checked against: the workspace team's own. */
export interface TeamLoweringBase {
  readonly roles: Readonly<Record<string, { readonly caps: Readonly<Record<string, number>> }>>
  readonly budgets: Readonly<Record<string, number>>
}

export interface LoweredTeam {
  readonly offRoles: readonly string[]
  readonly reviewers: Readonly<Record<string, string>>
  readonly caps: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly budgets: Readonly<Record<string, number>>
}

export type TeamLowering =
  | { readonly ok: true; readonly lowered: LoweredTeam }
  | { readonly ok: false; readonly reason: string }

/**
 * The lowering merge: caps and budgets move down, roles turn off, a role
 * can require a different reviewer. Anything that raises, adds or widens
 * refuses the file whole.
 */
export function lowerTeamWithJson(base: TeamLoweringBase, file: TeamJsonFile): TeamLowering {
  const offRoles: string[] = []
  const reviewers: Record<string, string> = {}
  const caps: Record<string, Record<string, number>> = {}
  const fileRoles = Object.entries(file.roles ?? {})
  for (const [id, role] of fileRoles) {
    const baseRole = base.roles[id]
    if (baseRole === undefined) {
      return { ok: false, reason: `team.json adds a role: ${id}` }
    }
    if (role.off === true) {
      offRoles.push(id)
    }
    if (role.reviewer !== undefined) {
      reviewers[id] = role.reviewer
    }
    const roleCaps = Object.entries(role.caps ?? {})
    for (const [measure, cap] of roleCaps) {
      const baseCap = baseRole.caps[measure]
      if (baseCap === undefined) {
        return { ok: false, reason: `team.json adds a cap: roles.${id}.caps.${measure}` }
      }
      if (cap > baseCap) {
        return { ok: false, reason: `team.json raises roles.${id}.caps.${measure}` }
      }
      caps[id] = { ...caps[id], [measure]: cap }
    }
  }
  const budgets: Record<string, number> = {}
  const fileBudgets = Object.entries(file.budgets ?? {})
  for (const [name, budget] of fileBudgets) {
    const baseBudget = base.budgets[name]
    if (baseBudget === undefined) {
      return { ok: false, reason: `team.json adds a budget: ${name}` }
    }
    if (budget > baseBudget) {
      return { ok: false, reason: `team.json raises budgets.${name}` }
    }
    budgets[name] = budget
  }
  return { ok: true, lowered: { offRoles, reviewers, caps, budgets } }
}
