import {
  AGENT_ID_PATTERN,
  TEAM_BUILTIN_ROLE_IDS,
  TEAM_JSON_SEGMENTS,
  type TeamBuiltinRoleId,
  TEAM_WRITE_SET_MAX,
} from '../../shared/constants'
import { type TeamAgentRef, type TeamModelSettings, teamSharedFileSchema } from '../../shared/team'
import { Usd, type UsdAmount } from '../../shared/usd'
import { distinctTeamModels, type TeamModelRef } from './sameModel'
// Lane R (M96, PLAN.md D75): the workspace team.
//
// The user's agents (pool entries), the workspace team (roles with ordered
// pools, the orchestrator slot), the user default, Default as an entry, and
// the `.muse/team.json` lowering merge. Caps are plain numbers keyed by
// measure: lane A gives the measures meaning; the lowering only ever moves
// a number down. The host reads the file and the workspace state; this
// module merges them without IO.

/** One pool entry's agent: Default, or a configured model on its backend. */
export type TeamPoolEntry =
  | { readonly kind: 'default' }
  | {
      readonly kind: 'agent'
      readonly agent: TeamModelRef | TeamAgentRef
      readonly settings?: TeamModelSettings | undefined
      /**
      The entry's own limits by measure (lane A), e.g. concurrent, task
      and day token caps. Numbers only; lane A types the measures.
      */
      readonly caps?: Readonly<Record<string, number>> | undefined
    }

/** Default: whatever the orchestrator slot resolves to when each task starts. */
export const DEFAULT_TEAM_ENTRY: TeamPoolEntry = { kind: 'default' }

export function isDefaultEntry(entry: TeamPoolEntry): boolean {
  return entry.kind === 'default'
}

/**
What Default resolves to: the orchestrator slot's model and backend right
now. Live, not a snapshot: a picker change applies to the next
delegation, and a running task keeps what it started on (lane A).
*/
export function resolveDefaultEntry(
  slot: TeamModelRef | TeamAgentRef,
  settings?: TeamModelSettings,
): TeamPoolEntry {
  return { ...(settings !== undefined && { settings }), kind: 'agent', agent: slot }
}

/** One role's ordered pool: new work goes to the first entry with headroom. */
export interface TeamRolePool {
  readonly entries: readonly TeamPoolEntry[]
}

/**
The orchestrator slot: the composer's picker, unless the workspace names
another model. An absent agent is Default's behaviour; Reset to Default
restores it (lane T).
*/
export interface TeamOrchestratorSlot {
  readonly agent?: TeamModelRef | TeamAgentRef | undefined
  readonly settings?: TeamModelSettings | undefined
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
Staff every role without a custom entry with Default as its only entry.
Default alone never turns the team on: the team runs once a custom entry
is a second, loaded model (acceptance 47; lane T decides from this).
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
The workspace team: the built-in roles staffed by Default, the user's
defaults over them, and the workspace's own choices over those. Pools
replace whole: a workspace pool lists exactly the entries it runs.
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
  readonly sharedFiles?: readonly z.infer<typeof teamSharedFileSchema>[]

  readonly roles?: Readonly<Record<string, TeamJsonRole>> | undefined
  /** Budget bounds as exact decimals: the JSON number converts at the boundary. */
  readonly budgets?: Readonly<Record<string, UsdAmount>> | undefined
}

export type TeamJsonParse =
  | { readonly ok: true; readonly file: TeamJsonFile }
  | { readonly ok: false; readonly reason: string }

const TEAM_JSON_TOP_KEYS: ReadonlySet<string> = new Set(['roles', 'budgets', 'sharedFiles'])
const TEAM_JSON_ROLE_KEYS: ReadonlySet<string> = new Set(['off', 'reviewer', 'caps'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLowerableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
A lowering number's raw spelling: at most six fraction digits and fifteen
significant digits, so the double round trip keeps it exactly (P3-14).
*/
const TEAM_JSON_MAX_FRACTION_DIGITS = 6
const TEAM_JSON_MAX_SIGNIFICANT_DIGITS = 15
/** A `\uXXXX` escape: backslash-u plus four hex digits. */
const UNICODE_ESCAPE_LEAD = 2
const UNICODE_ESCAPE_HEX_DIGITS = 4

/**
Every number literal's raw spelling by path (RVCM96B2D P3-14). JSON.parse
rounds 0.499999999999999999 to 0.5 before any check sees it, so exactness
is judged on the text: a lowering number must be a plain decimal the
double round trip keeps exactly, otherwise the file is refused.
*/
function rawJsonNumbers(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const trail: string[] = []
  let at = 0
  const gap = (): void => {
    while (at < text.length && /\s/.test(text.charAt(at))) at += 1
  }
  const word = (): string => {
    let out = ''
    at += 1 // the opening quote
    while (at < text.length) {
      const char = text.charAt(at)
      if (char === '"') {
        at += 1
        return out
      }
      if (char !== '\\') {
        out += char
        at += 1
        continue
      }
      const esc = text.charAt(at + 1)
      const hex = text.slice(
        at + UNICODE_ESCAPE_LEAD,
        at + UNICODE_ESCAPE_LEAD + UNICODE_ESCAPE_HEX_DIGITS,
      )
      if (esc === 'u' && /^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCodePoint(Number.parseInt(hex, 16))
        at += UNICODE_ESCAPE_LEAD + UNICODE_ESCAPE_HEX_DIGITS
      } else {
        out += esc
        at += 2
      }
    }
    return out
  }
  const number = (): void => {
    const start = at
    if (text.charAt(at) === '-') at += 1
    while (at < text.length && /[0-9eE+.-]/.test(text.charAt(at))) at += 1
    found.set(JSON.stringify(trail), text.slice(start, at))
  }
  const record = (): void => {
    at += 1 // the opening brace
    gap()
    if (text.charAt(at) === '}') {
      at += 1
      return
    }
    let separator = ','
    while (separator === ',') {
      gap()
      const key = word()
      gap()
      at += 1 // the colon
      trail.push(key)
      value()
      trail.pop()
      gap()
      separator = text.charAt(at)
      at += 1
    }
  }
  const sequence = (): void => {
    at += 1 // the opening bracket
    gap()
    if (text.charAt(at) === ']') {
      at += 1
      return
    }
    let index = 0
    let separator = ','
    while (separator === ',') {
      trail.push(String(index))
      value()
      trail.pop()
      index += 1
      gap()
      separator = text.charAt(at)
      at += 1
    }
  }
  const value = (): void => {
    gap()
    switch (text.charAt(at)) {
      case '"': {
        word()
        break
      }
      case '{': {
        record()
        break
      }
      case '[': {
        sequence()
        break
      }
      default: {
        const char = text.charAt(at)
        if (char === '-' || (char >= '0' && char <= '9')) number()
        // true, false, null: one lowercase word.
        else while (at < text.length && /[a-z]/.test(text.charAt(at))) at += 1
      }
    }
    gap()
  }
  value()
  return found
}

/**
The raw spelling must survive the double round trip exactly: a plain
decimal within the digit bounds above. Anything else (a longer fraction,
an exponent, an unsafe integer) is refused, so a file value never silently
becomes another amount on its way to the ledger.
*/
function isExactNumber(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (match === null || (match[2]?.length ?? 0) > TEAM_JSON_MAX_FRACTION_DIGITS) return false
  const digits = `${match[1] ?? ''}${match[2] ?? ''}`.replace(/^0+/, '')
  return digits.length <= TEAM_JSON_MAX_SIGNIFICANT_DIGITS
}

/**
`.muse/team.json`, parsed. The file lowers only: a file that adds an
agent, a provider, a command, a role or an entry, sets `in-place`, or
holds an unknown key, is refused whole. In an untrusted workspace it is
not read at all (the host checks first).
*/
export function parseTeamJson(text: string): TeamJsonParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // Only malformed text refuses as not JSON; anything else keeps its kind.
    if (!(error instanceof SyntaxError)) throw error
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
  // RVCM96B2D P3-14: exactness is judged on the raw spellings, before
  // JSON.parse rounds them.
  const raw = rawJsonNumbers(text)
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
          if (
            !isLowerableNumber(cap) ||
            !isExactNumber(raw.get(JSON.stringify(['roles', id, 'caps', measure])))
          ) {
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
  let budgets: Record<string, UsdAmount> | undefined
  const rawBudgets = parsed['budgets']
  if (rawBudgets !== undefined) {
    if (!isRecord(rawBudgets)) {
      return { ok: false, reason: 'team.json holds an invalid budgets' }
    }
    for (const [name, budget] of Object.entries(rawBudgets)) {
      if (
        !isLowerableNumber(budget) ||
        !isExactNumber(raw.get(JSON.stringify(['budgets', name])))
      ) {
        return { ok: false, reason: `team.json holds an invalid budgets.${name}` }
      }
    }
    // Exact at the boundary: the raw spelling survived the double round
    // trip (P3-14), so the decimal it names converts without loss.
    budgets = Object.fromEntries(
      Object.entries(rawBudgets)
        .filter((entry): entry is [string, number] => isLowerableNumber(entry[1]))
        .map((entry): [string, UsdAmount] => [entry[0], Usd.from(entry[1]).toAmount()]),
    )
  }
  const sharedFiles = teamSharedFilesConfigShape.sharedFiles.safeParse(parsed['sharedFiles'])
  // RVCM96B2 P3-9: a stable entry path, never a raw zod dump: the headless
  // runner maps it to its translated table key with the entry spliced.
  if (!sharedFiles.success) return { ok: false, reason: 'team.json holds an invalid sharedFiles' }
  return {
    ok: true,
    file: {
      roles,
      ...(budgets !== undefined && { budgets }),
      ...(sharedFiles.data !== undefined && { sharedFiles: sharedFiles.data }),
    },
  }
}

/** The bounds a lowering is checked against: the workspace team's own. */
export interface TeamLoweringBase {
  readonly roles: Readonly<Record<string, { readonly caps: Readonly<Record<string, number>> }>>
  readonly budgets: Readonly<Record<string, UsdAmount>>
}

export interface LoweredTeam {
  readonly offRoles: readonly string[]
  readonly reviewers: Readonly<Record<string, string>>
  readonly caps: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly budgets: Readonly<Record<string, UsdAmount>>
}

export type TeamLowering =
  | { readonly ok: true; readonly lowered: LoweredTeam }
  | { readonly ok: false; readonly reason: string }

/**
The lowering merge: caps and budgets move down, roles turn off, a role
can require a different reviewer. Anything that raises, adds or widens
refuses the file whole.
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
  const budgets: Record<string, UsdAmount> = {}
  const fileBudgets = Object.entries(file.budgets ?? {})
  for (const [name, budget] of fileBudgets) {
    const baseBudget = base.budgets[name]
    if (baseBudget === undefined) {
      return { ok: false, reason: `team.json adds a budget: ${name}` }
    }
    if (Usd.from(budget).compare(Usd.from(baseBudget)) > 0) {
      return { ok: false, reason: `team.json raises budgets.${name}` }
    }
    budgets[name] = budget
  }
  return { ok: true, lowered: { offRoles, reviewers, caps, budgets } }
}

import * as z from 'zod/mini'

// Lane C owns only this team.json key. The M96 config reader composes this
// shape into its strict boundary schema; no parallel whole-config loader.
export const teamSharedFilesConfigShape = {
  sharedFiles: z.optional(z.array(teamSharedFileSchema).check(z.maxLength(TEAM_WRITE_SET_MAX))),
}
