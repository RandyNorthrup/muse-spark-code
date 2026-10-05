// Lane R (M96, PLAN.md D75): the role keys on M76's parser.
//
// A role is an M76 agent definition (`AGENT.md`) with the role keys below,
// so there is one loader and one folder, and M83's imports become roles for
// free. Every key is optional, and a missing one keeps M76's meaning —
// except where the narrowing rules resolve it first. A file with an unknown
// or malformed role key is refused, naming the file.

import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_ID_PATTERN,
  AGENT_MAX_FILES,
  AGENT_TOOL_NAME_PATTERN,
  UI_TEXT,
  TEAM_NEW_ROLE_CEILING_GROUPS,
  TEAM_DELEGATE_TOOLS,
  TEAM_REPORT_SHAPES,
  TEAM_ROLE_DELEGATES_MAX,
  TEAM_ROLE_DONE_MAX_CHARS,
  TEAM_ROLE_SKILL_IDS_MAX,
  TEAM_ROLE_SKILL_ID_MAX_CHARS,
  TEAM_ROLE_SKILL_ID_PATTERN,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  TEAM_ROLE_WRITE_PATHS_MAX,
  TEAM_ROLE_WRITE_PATH_MAX_CHARS,
  TEAM_TOOL_GROUP_TOOLS,
  TEAM_WORKSPACE_MODES,
  TEAM_WORKSPACE_ORDER,
  type AgentSource,
  type EffortLevel,
  type TeamReportShape,
  type TeamWorkspaceMode,
} from '../../shared/constants'
import { APPROVAL_MODES, type ApprovalMode } from '../../shared/permissionModes'
import { fill } from '../../shared/l10n/text'
import {
  type AgentHole,
  type AgentRoot,
  type AgentsLoaderDeps,
  narrowApprovalMode,
  parseAgentFileForRole,
} from '../context/customAgents'
import { readContextText } from '../context/contextFiles'
import { builtinRoles } from './builtInRoles'
import { compileGlob, isGlobMatch } from '../backends/modelapi/globLimits'
import {
  groupsForTools,
  meetTeamToolNames,
  resolveTeamToolset,
  type TeamToolsetSession,
} from './toolsets'

/** The role keys, one line each in the front matter (PLAN.md D75). */
export const TEAM_ROLE_FRONT_MATTER_KEYS: readonly string[] = [
  'description',
  'when-to-use',
  'done',
  'workspace',
  'tools',
  'write-paths',
  'skills',
  'report',
  'delegates',
  'permission-mode',
  'model',
  'effort',
]

/** A role: an M76 agent definition with the role keys resolved. */
export interface RoleDefinition {
  readonly id: string
  readonly source: AgentSource
  readonly name: string
  readonly description: string
  readonly whenToUse: string | undefined
  readonly done: string | undefined
  readonly body: string
  /** The filed workspace; undefined keeps M76's meaning until resolved. */
  readonly workspace: TeamWorkspaceMode | undefined
  /** The filed allowlist; undefined runs with the session's own set. */
  readonly tools: readonly string[] | undefined
  readonly writePaths: readonly string[] | undefined
  readonly skills: readonly string[] | undefined
  readonly report: TeamReportShape | undefined
  readonly delegates: readonly string[] | undefined
  readonly model: string | undefined
  readonly effort: EffortLevel | undefined
  readonly approvalMode: ApprovalMode | undefined
  /** The file's SHA-256, for project roles: the allowance is kept with it. */
  readonly sha256: string | undefined
}

export type RoleFileParse =
  | { readonly ok: true; readonly role: Omit<RoleDefinition, 'id' | 'source' | 'sha256'> }
  | { readonly ok: false; readonly reason: string }

// Control characters (other than a tab) and format characters: text the
// model would read that no one reviewing the file sees (M76's principle).
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}]/u

function cleanText(value: string): string {
  return value.replaceAll('\t', ' ')
}

function isBoundedText(value: string, maxChars: number): boolean {
  return value.length <= maxChars && !HIDDEN_CHARACTER.test(cleanText(value))
}

/** A comma-separated list: each item non-empty, bounded and valid. */
function parseList(
  value: string,
  maxItems: number,
  maxChars: number,
  isValid: (item: string) => boolean,
): readonly string[] | undefined {
  const items = value.split(',').map((item) => item.trim())
  const isInvalid =
    items.length > maxItems ||
    items.some((item) => item.length === 0 || item.length > maxChars || !isValid(item))
  return isInvalid ? undefined : [...new Set(items)]
}

function isWorkspaceMode(value: string): value is TeamWorkspaceMode {
  for (const mode of TEAM_WORKSPACE_MODES) {
    if (mode === value) {
      return true
    }
  }
  return false
}

function isReportShape(value: string): value is TeamReportShape {
  for (const shape of TEAM_REPORT_SHAPES) {
    if (shape === value) {
      return true
    }
  }
  return false
}

/** A role's front matter, validated; unknown keys are the caller's to refuse. */
export function parseRoleFile(text: string): RoleFileParse {
  const parsed = parseAgentFileForRole(text, TEAM_ROLE_FRONT_MATTER_KEYS)
  if (!parsed.ok) {
    return parsed
  }
  if (parsed.unknownKeys.length > 0) {
    return {
      ok: false,
      reason: `front matter names an unknown role key: ${parsed.unknownKeys.toSorted((a, b) => a.localeCompare(b, 'en')).join(', ')}`,
    }
  }
  const { agent, roleFields } = parsed
  const get = (key: string): string | undefined => roleFields.get(key)
  const whenToUse = get('when-to-use')
  if (whenToUse !== undefined && !isBoundedText(whenToUse, TEAM_ROLE_WHEN_TO_USE_MAX_CHARS)) {
    return { ok: false, reason: 'front matter has an invalid when-to-use' }
  }
  const done = get('done')
  if (done !== undefined && !isBoundedText(done, TEAM_ROLE_DONE_MAX_CHARS)) {
    return { ok: false, reason: 'front matter has an invalid done' }
  }
  const workspace = get('workspace')
  if (workspace !== undefined && !isWorkspaceMode(workspace)) {
    return { ok: false, reason: 'front matter has an invalid workspace' }
  }
  // `tools` is M76's allowlist, unchanged; a role without it is met with the
  // session's own set downstream, never read as "all tools" here.
  const tools = agent.tools
  const writePaths = get('write-paths')
  const parsedPaths =
    writePaths === undefined
      ? undefined
      : parseList(writePaths, TEAM_ROLE_WRITE_PATHS_MAX, TEAM_ROLE_WRITE_PATH_MAX_CHARS, (item) =>
          isBoundedText(item, TEAM_ROLE_WRITE_PATH_MAX_CHARS),
        )
  if (writePaths !== undefined && parsedPaths === undefined) {
    return { ok: false, reason: 'front matter has an invalid write-paths' }
  }
  const skills = get('skills')
  const parsedSkills =
    skills === undefined
      ? undefined
      : parseList(skills, TEAM_ROLE_SKILL_IDS_MAX, TEAM_ROLE_SKILL_ID_MAX_CHARS, (item) =>
          TEAM_ROLE_SKILL_ID_PATTERN.test(item),
        )
  if (skills !== undefined && parsedSkills === undefined) {
    return { ok: false, reason: 'front matter has an invalid skills' }
  }
  const report = get('report')
  if (report !== undefined && !isReportShape(report)) {
    return { ok: false, reason: 'front matter has an invalid report' }
  }
  const delegates = get('delegates')
  const parsedDelegates =
    delegates === undefined
      ? undefined
      : parseList(delegates, TEAM_ROLE_DELEGATES_MAX, TEAM_ROLE_SKILL_ID_MAX_CHARS, (item) =>
          AGENT_ID_PATTERN.test(item),
        )
  if (delegates !== undefined && parsedDelegates === undefined) {
    return { ok: false, reason: 'front matter has an invalid delegates' }
  }
  return {
    ok: true,
    role: {
      name: agent.name,
      description: agent.description,
      whenToUse,
      done,
      body: agent.body,
      workspace,
      tools,
      writePaths: parsedPaths,
      skills: parsedSkills,
      report,
      delegates: parsedDelegates,
      model: agent.model,
      effort: agent.effort,
      approvalMode: agent.approvalMode,
    },
  }
}

/** Whether the allowlist holds a tool that writes (the write or rename groups). */
export function hasRoleWriteTool(tools: readonly string[] | undefined): boolean {
  if (tools === undefined) {
    return true
  }
  const writers = new Set([...TEAM_TOOL_GROUP_TOOLS.write, ...TEAM_TOOL_GROUP_TOOLS.rename])
  return tools.some((tool) => writers.has(tool))
}

/**
 * A role's workspace: the filed one, else `own-branch` for a role with a
 * write tool and `read-only` otherwise.
 */
export function resolveRoleWorkspace(
  role: Pick<RoleDefinition, 'workspace' | 'tools'>,
): TeamWorkspaceMode {
  if (role.workspace !== undefined) {
    return role.workspace
  }
  return hasRoleWriteTool(role.tools) ? 'own-branch' : 'read-only'
}

/** A missing allowlist or write-path list resolves to the whole session: wider than any list. */
function isSubsetOf(
  project: readonly string[] | undefined,
  shadow: readonly string[] | undefined,
): boolean {
  return project === undefined
    ? shadow === undefined
    : shadow === undefined || project.every((item) => shadow.includes(item))
}

/** A confined glob in the supported proof language; alternatives require a separate proof. */
function isConfinedWriteGlob(pattern: string): boolean {
  if (
    !isBoundedText(pattern, TEAM_ROLE_WRITE_PATH_MAX_CHARS) ||
    pattern.includes('\\') ||
    pattern.includes(':') ||
    /[{}]/u.test(pattern) ||
    pattern.split('/').some((part) => ['', '.', '..'].includes(part))
  ) {
    return false
  }
  try {
    compileGlob(pattern)
    return true
  } catch {
    return false
  }
}

/** One inclusion proof, shared by project validation and the permission meet. */
function isWritePathSubsetOf(
  project: readonly string[] | undefined,
  shadow: readonly string[] | undefined,
): boolean {
  if (project === undefined || shadow === undefined) {
    return project !== undefined || shadow === undefined
  }
  return project.every(
    (candidate) =>
      isConfinedWriteGlob(candidate) &&
      shadow.some((allowed) => {
        if (!isConfinedWriteGlob(allowed)) return false
        if (candidate === allowed) return true
        if (!/[*?[\]]/u.test(candidate)) return isGlobMatch(candidate, allowed)
        const root = allowed.endsWith('/**') ? allowed.slice(0, -'**'.length) : undefined
        return root !== undefined && !/[*?[\]]/u.test(root) && candidate.startsWith(root)
      }),
  )
}

/** Every authority can only reduce these permissions. Undefined lists mean unrestricted. */
export type RoleCeiling = Partial<
  Pick<RoleDefinition, 'workspace' | 'tools' | 'writePaths' | 'delegates' | 'approvalMode'>
>

/** The only permission computation: intersection, with no IO or precedence decisions. */
export function meetRolePermissions(
  role: RoleDefinition,
  ceilings: readonly RoleCeiling[],
):
  | { readonly ok: true; readonly role: RoleDefinition }
  | { readonly ok: false; readonly reason: string } {
  if (
    [role, ...ceilings].some(
      (input) => input.writePaths?.some((pattern) => !isConfinedWriteGlob(pattern)) === true,
    )
  ) {
    return { ok: false, reason: 'write-path-inclusion-unproven' }
  }
  let workspace = resolveRoleWorkspace(role)
  let tools = role.tools
  let writePaths = role.writePaths
  let delegates = role.delegates ?? []
  let approvalMode = role.approvalMode ?? 'denyUnmatched'
  for (const ceiling of ceilings) {
    const limit = resolveRoleWorkspace({ workspace: ceiling.workspace, tools: ceiling.tools })
    if (TEAM_WORKSPACE_ORDER[limit] < TEAM_WORKSPACE_ORDER[workspace]) workspace = limit
    tools = tools === undefined ? ceiling.tools : meetTeamToolNames(ceiling.tools, tools)
    if (!isWritePathSubsetOf(writePaths, ceiling.writePaths)) {
      if (isWritePathSubsetOf(ceiling.writePaths, writePaths)) {
        writePaths = ceiling.writePaths
      } else {
        return { ok: false, reason: 'write-path-inclusion-unproven' }
      }
    }
    delegates = delegates.filter((id) => (ceiling.delegates ?? []).includes(id))
    approvalMode = narrowApprovalMode(approvalMode, ceiling.approvalMode ?? 'denyUnmatched')
  }
  if (workspace === 'read-only' || writePaths?.length === 0) {
    tools = tools?.filter((tool) => !hasRoleWriteTool([tool]))
  }
  if (delegates.length === 0) {
    tools = tools?.filter((tool) => !TEAM_DELEGATE_TOOLS.includes(tool))
  }
  return {
    ok: true,
    role: freezeRole({ ...role, workspace, tools, writePaths, delegates, approvalMode }),
  }
}

/** Unconditional restrictions, including new ids before their hash allowance. */
function projectRoleRefusal(project: RoleDefinition): string | undefined {
  if (project.workspace === 'in-place') {
    return 'a project role can never set in-place'
  }
  if (project.model !== undefined) {
    return 'a project role names no model: the pool chooses it'
  }
  return project.skills === undefined
    ? undefined
    : 'a project role names no skills: they come from user configuration'
}

/**
 * A project role may only narrow the role it shadows (a built-in or
 * personal role of the same id): its workspace no wider, its tools and
 * `write-paths` subsets, its `delegates` a subset — compared on resolved
 * values, so leaving a key out never widens. It can never set `in-place`,
 * and it names no model (`model`) and no skills: the pool chooses the
 * model, and skills come from user-level configuration only.
 */
export function narrowProjectRole(
  shadow: RoleDefinition,
  project: RoleDefinition,
):
  | { readonly ok: true; readonly role: RoleDefinition }
  | { readonly ok: false; readonly reason: string } {
  const refusal = projectRoleRefusal(project)
  if (refusal !== undefined) {
    return { ok: false, reason: refusal }
  }
  const workspace = resolveRoleWorkspace(project)
  if (TEAM_WORKSPACE_ORDER[workspace] > TEAM_WORKSPACE_ORDER[resolveRoleWorkspace(shadow)]) {
    return {
      ok: false,
      reason: `a project role's workspace (${workspace}) is wider than the role it shadows`,
    }
  }
  if (!isSubsetOf(project.tools, shadow.tools)) {
    return { ok: false, reason: 'a project role adds a tool the role it shadows does not have' }
  }
  if (!isWritePathSubsetOf(project.writePaths, shadow.writePaths)) {
    return { ok: false, reason: 'a project role writes where the role it shadows does not' }
  }
  if (!isSubsetOf(project.delegates ?? [], shadow.delegates ?? [])) {
    return { ok: false, reason: 'a project role delegates where the role it shadows does not' }
  }
  const approvalMode = project.approvalMode ?? 'denyUnmatched'
  const hasWiderCeiling =
    narrowApprovalMode(shadow.approvalMode ?? 'denyUnmatched', approvalMode) !== approvalMode
  return hasWiderCeiling
    ? { ok: false, reason: 'a project role never widens the approval ceiling' }
    : meetRolePermissions({ ...project, approvalMode }, [shadow])
}

/** The file's SHA-256: the per-workspace allowance is kept with it. */
export function roleFileSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A workspace's allowance for a new-id project role's wider asks. */
export interface TeamRoleAllowance {
  readonly sha256: string
}

/** Whether the allowance covers this file: an edit asks again. */
export function isAllowanceForFile(
  allowance: TeamRoleAllowance | undefined,
  fileSha256: string,
): boolean {
  return allowance?.sha256 === fileSha256
}

/** The ceiling tools: the `read` and `codeIntel` groups' tools. */
export function newRoleCeilingTools(): string[] {
  const tools: string[] = []
  for (const group of TEAM_NEW_ROLE_CEILING_GROUPS) {
    const groupTools = TEAM_TOOL_GROUP_TOOLS[group]
    for (const tool of groupTools) {
      if (!tools.includes(tool)) {
        tools.push(tool)
      }
    }
  }
  return tools
}

/** What a new-id project role asks beyond the ceiling, for the Roles section to show. */
export interface NewRoleAsks {
  readonly workspace: TeamWorkspaceMode | undefined
  readonly tools: readonly string[]
  readonly writePaths: boolean
  readonly delegates: boolean
}

export function newRoleAsks(role: RoleDefinition): NewRoleAsks {
  const ceiling = new Set(newRoleCeilingTools())
  return {
    workspace: resolveRoleWorkspace(role) === 'read-only' ? undefined : resolveRoleWorkspace(role),
    tools: (role.tools ?? []).filter((tool) => !ceiling.has(tool)),
    writePaths: role.writePaths !== undefined && role.writePaths.length > 0,
    delegates: (role.delegates ?? []).length > 0,
  }
}

/**
 * A new-id project role as it runs: the ceiling until the workspace allows
 * its wider asks for this file's SHA-256. A personal role never passes
 * through here: it is the user's own and may change anything.
 */
export function applyNewRoleCeiling(
  role: RoleDefinition,
  allowance: TeamRoleAllowance | undefined,
): RoleDefinition {
  const refusal = projectRoleRefusal(role)
  if (refusal !== undefined) {
    throw new Error(refusal)
  }
  const isAllowed = role.sha256 !== undefined && isAllowanceForFile(allowance, role.sha256)
  const met = meetRolePermissions(role, isAllowed ? [] : [newIdCeiling()])
  if (!met.ok) throw new Error(UI_TEXT.teamRoleGlobUnproven)
  return met.role
}

/** New-id project powers before an explicit allowance. Empty write paths writes nowhere. */
function newIdCeiling(): RoleCeiling {
  return {
    workspace: 'read-only',
    tools: newRoleCeilingTools(),
    writePaths: [],
    delegates: [],
    approvalMode: 'allowAll',
  }
}

/** A failed input is data, never permission to consult a lower source. */
export interface RoleUnknown {
  readonly kind: 'unknown'
  readonly input: 'catalogue' | 'role' | 'environment'
  readonly issue: 'missing' | 'unreadable' | 'malformed' | 'ambiguous' | 'untrusted' | 'widening'
  readonly source: AgentHole['source']
  readonly id: string | undefined
  readonly path: string
}

export type RoleInput<T> = RoleUnknown | { readonly kind: 'known'; readonly value: T }

const ceilingSchema = z.strictObject({
  workspace: z.optional(z.enum(TEAM_WORKSPACE_MODES)),
  tools: z.optional(z.array(z.string().check(z.regex(AGENT_TOOL_NAME_PATTERN)))),
  writePaths: z.optional(z.array(z.string().check(z.minLength(1)))),
  delegates: z.optional(z.array(z.string().check(z.regex(AGENT_ID_PATTERN)))),
  approvalMode: z.enum(APPROVAL_MODES),
})

const environmentSchema = z.strictObject({
  session: z.strictObject({
    offered: z.array(z.string().check(z.regex(AGENT_TOOL_NAME_PATTERN))),
    delegates: z.array(z.string().check(z.regex(AGENT_ID_PATTERN))),
    webSearchAllowed: z.boolean(),
    imagesAllowed: z.boolean(),
  }),
  approvalMode: z.enum(APPROVAL_MODES),
  ceilings: z.array(ceilingSchema),
  allowances: z.record(
    z.string().check(z.regex(AGENT_ID_PATTERN)),
    z.strictObject({ sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)) }),
  ),
})
export interface RoleEnvironment {
  readonly session: TeamToolsetSession
  readonly approvalMode: ApprovalMode
  readonly ceilings: readonly RoleCeiling[]
  readonly allowances: Readonly<Record<string, TeamRoleAllowance>>
}

/** All file and runtime inputs, detached from the caller before any resolution. */
interface RoleSnapshot {
  readonly definitions: readonly RoleDefinition[]
  readonly environment: RoleEnvironment
}

export interface RolesLoad {
  readonly snapshot: RoleInput<RoleSnapshot>
  /** Resolved roles only; an Unknown snapshot offers none. */
  readonly roles: readonly RoleDefinition[]
  readonly holes: readonly AgentHole[]
  readonly warnings: readonly string[]
}

export type RoleResolution =
  | { readonly kind: 'found'; readonly role: RoleDefinition }
  | { readonly kind: 'unknown'; readonly reason: string }
  | {
      readonly kind: 'unloaded'
      readonly hole: AgentHole
      readonly unknown: RoleUnknown
      readonly reason: string
    }

const ROLE_PRECEDENCE: readonly AgentSource[] = ['project', 'user', 'builtin']

function freezeList<T>(items: readonly T[] | undefined): readonly T[] | undefined {
  return items === undefined ? undefined : Object.freeze([...items])
}

function freezeRole(role: RoleDefinition): RoleDefinition {
  return Object.freeze({
    ...role,
    tools: freezeList(role.tools),
    writePaths: freezeList(role.writePaths),
    skills: freezeList(role.skills),
    delegates: freezeList(role.delegates),
  })
}

/** A built-in as a role: its filed values are its resolved ones. */
function builtinToRole(role: ReturnType<typeof builtinRoles>[number]): RoleDefinition {
  return freezeRole({
    ...role,
    skills: undefined,
    model: undefined,
    effort: undefined,
    approvalMode: undefined,
    sha256: undefined,
  })
}

function freezeEnvironment(environment: RoleEnvironment): RoleEnvironment {
  return Object.freeze({
    ...environment,
    session: Object.freeze({
      ...environment.session,
      offered: Object.freeze([...environment.session.offered]),
      delegates: Object.freeze([...environment.session.delegates]),
    }),
    ceilings: Object.freeze(
      environment.ceilings.map((ceiling) =>
        Object.freeze({
          ...ceiling,
          tools: freezeList(ceiling.tools),
          writePaths: freezeList(ceiling.writePaths),
          delegates: freezeList(ceiling.delegates),
        }),
      ),
    ),
    allowances: Object.freeze(
      Object.fromEntries(
        Object.entries(environment.allowances).map(([id, allowance]) => [
          id,
          Object.freeze({ ...allowance }),
        ]),
      ),
    ),
  })
}

/** Resolve one complete known snapshot. Precedence chooses prose; ceilings choose powers. */
function resolveSnapshotRole(snapshot: RoleSnapshot, id: string): RoleDefinition | undefined {
  const definitions = snapshot.definitions.filter((role) => role.id === id)
  const requested = ROLE_PRECEDENCE.flatMap((source) =>
    definitions.filter((role) => role.source === source),
  )[0]
  if (requested === undefined) return undefined
  const ceilings: RoleCeiling[] = [...snapshot.environment.ceilings]
  if (requested.source === 'project') {
    const shadow =
      definitions.find((role) => role.source === 'user') ??
      definitions.find((role) => role.source === 'builtin')
    if (shadow !== undefined)
      ceilings.push({
        ...shadow,
        // Delegation names authorize these tools separately from the ordinary allowlist (D75).
        tools:
          shadow.tools === undefined
            ? undefined
            : [
                ...shadow.tools,
                ...(shadow.delegates?.length === undefined || shadow.delegates.length === 0
                  ? []
                  : TEAM_DELEGATE_TOOLS),
              ],
      })
    else if (!isAllowanceForFile(snapshot.environment.allowances[id], requested.sha256 ?? ''))
      ceilings.push(newIdCeiling())
  }
  const available = resolveTeamToolset(
    {
      groups: groupsForTools(requested.tools ?? snapshot.environment.session.offered),
      tools: requested.tools,
      writePaths: requested.writePaths,
    },
    { ...snapshot.environment.session, delegates: requested.delegates ?? [] },
  )
  ceilings.push({
    workspace: 'in-place',
    tools: available.tools,
    writePaths: undefined,
    delegates: snapshot.environment.session.delegates,
    approvalMode: snapshot.environment.approvalMode,
  })
  const met = meetRolePermissions({ ...requested, tools: available.tools }, ceilings)
  if (!met.ok) throw new Error(UI_TEXT.teamRoleGlobUnproven)
  return met.role
}

/** Capture every input first. Any failure invalidates the whole catalogue. */
export async function loadRoles(
  deps: AgentsLoaderDeps,
  roots: readonly AgentRoot[],
  opts: { readonly trustedWorkspace: boolean; readonly inputs?: RoleInput<unknown> },
): Promise<RolesLoad> {
  const definitions = builtinRoles().map((role) => builtinToRole(role))
  const unknowns: RoleUnknown[] = []
  const files = new Map<string, string>()
  const warnings: string[] = []
  const pathModule = deps.platform === 'win32' ? path.win32 : path.posix
  const refuse = (input: RoleUnknown): void => {
    unknowns.push(Object.freeze({ ...input }))
  }
  // Clone runtime inputs before asynchronous reads can give the caller a chance to change them.
  const parsedEnvironment =
    opts.inputs?.kind === 'known' ? environmentSchema.safeParse(opts.inputs.value) : undefined
  const environment =
    parsedEnvironment?.success === true ? freezeEnvironment(parsedEnvironment.data) : undefined
  if (environment === undefined) {
    refuse(
      opts.inputs?.kind === 'unknown'
        ? opts.inputs
        : {
            kind: 'unknown',
            input: 'environment',
            issue: opts.inputs === undefined ? 'missing' : 'malformed',
            source: 'user',
            id: undefined,
            path: '',
          },
    )
  }
  const isTrustedWorkspace = opts.trustedWorkspace
  const capturedRoots = roots.map((root) => ({ ...root }))
  for (const root of capturedRoots) {
    const rootUnknown = {
      kind: 'unknown',
      input: 'catalogue',
      source: root.source,
      id: undefined,
      path: root.directory,
    } as const
    if (
      !pathModule.isAbsolute(root.directory) ||
      (root.source === 'project' &&
        (root.confineTo === undefined || !pathModule.isAbsolute(root.confineTo)))
    ) {
      refuse({ ...rootUnknown, issue: 'malformed' })
      continue
    }
    if (!isTrustedWorkspace && root.source === 'project') {
      refuse({ ...rootUnknown, issue: 'untrusted' })
      continue
    }
    let ids: readonly string[]
    try {
      await deps.io.realPath(root.directory)
      ids = await deps.io.listDirectory(root.directory)
    } catch {
      refuse({ ...rootUnknown, issue: 'unreadable' })
      continue
    }
    const seen = new Set<string>()
    const orderedIds = ids.toSorted((a, b) => a.localeCompare(b, 'en'))
    for (const id of orderedIds) {
      const file = pathModule.join(root.directory, id, 'AGENT.md')
      const input = { kind: 'unknown', input: 'role', source: root.source, id, path: file } as const
      if (
        !AGENT_ID_PATTERN.test(id) ||
        seen.has(id) ||
        definitions.some((role) => role.source === root.source && role.id === id)
      ) {
        refuse({
          ...input,
          issue:
            seen.has(id) ||
            definitions.some((role) => role.source === root.source && role.id === id)
              ? 'ambiguous'
              : 'malformed',
        })
        continue
      }
      seen.add(id)
      if (definitions.filter((role) => role.source !== 'builtin').length >= AGENT_MAX_FILES) {
        refuse({ ...input, issue: 'malformed' })
        continue
      }
      try {
        const read = await readContextText(deps, file, root.confineTo, AGENT_FILE_MAX_BYTES)
        if (read === undefined) {
          refuse({ ...input, issue: 'missing' })
          continue
        }
        if (!read.ok) {
          refuse({ ...input, issue: 'malformed' })
          continue
        }
        const parsed = parseRoleFile(read.text)
        if (
          !parsed.ok ||
          parsed.role.writePaths?.some((pattern) => !isConfinedWriteGlob(pattern)) === true
        ) {
          refuse({ ...input, issue: 'malformed' })
          continue
        }
        files.set(`${root.source}:${id}`, file)
        definitions.push(
          freezeRole({
            ...parsed.role,
            id,
            source: root.source,
            sha256: root.source === 'project' ? roleFileSha256(read.text) : undefined,
          }),
        )
      } catch {
        refuse({ ...input, issue: 'unreadable' })
      }
    }
  }
  // Validate shadowing only after every input is known.
  if (unknowns.length === 0) {
    for (const role of definitions) {
      if (role.source !== 'project') continue
      const shadow =
        definitions.find((candidate) => candidate.source === 'user' && candidate.id === role.id) ??
        definitions.find((candidate) => candidate.source === 'builtin' && candidate.id === role.id)
      const narrowed = narrowProjectRole(shadow ?? role, role)
      if (!narrowed.ok)
        refuse({
          kind: 'unknown',
          input: 'role',
          issue: 'widening',
          source: 'project',
          id: role.id,
          path: files.get(`project:${role.id}`) ?? '',
        })
    }
  }
  if (
    environment?.ceilings.some(
      (ceiling) => ceiling.writePaths?.some((pattern) => !isConfinedWriteGlob(pattern)) === true,
    ) === true
  ) {
    refuse({
      kind: 'unknown',
      input: 'environment',
      issue: 'malformed',
      source: 'user',
      id: undefined,
      path: '',
    })
  }
  const known =
    environment === undefined
      ? undefined
      : Object.freeze({ definitions: Object.freeze(definitions), environment })
  const roles: RoleDefinition[] = []
  if (known !== undefined && unknowns.length === 0) {
    const roleIds = new Set(definitions.map((role) => role.id))
    for (const id of roleIds) {
      try {
        const resolved = resolveSnapshotRole(known, id)
        if (resolved !== undefined) roles.push(resolved)
      } catch {
        refuse({
          kind: 'unknown',
          input: 'role',
          issue: 'widening',
          source: 'project',
          id,
          path: '',
        })
      }
    }
  }
  const unknown = unknowns[0]
  if (unknown !== undefined) warnings.push(UI_TEXT.teamRoleResolutionUnknown)
  const snapshot: RoleInput<RoleSnapshot> =
    unknown ??
    (known === undefined
      ? {
          kind: 'unknown',
          input: 'environment',
          issue: 'missing',
          source: 'user',
          id: undefined,
          path: '',
        }
      : { kind: 'known', value: known })
  return Object.freeze({
    snapshot: Object.freeze(snapshot),
    roles: Object.freeze(unknown === undefined ? roles : []),
    holes: Object.freeze(
      unknowns.map(({ source, id, path: file }) => Object.freeze({ source, id, path: file })),
    ),
    warnings: Object.freeze(warnings),
  })
}

/** No role is offered from an incomplete snapshot. */
export function offeredRoles(catalogue: RolesLoad): readonly RoleDefinition[] {
  return catalogue.snapshot.kind === 'known' ? catalogue.roles : []
}

/** An Unknown anywhere blocks every name, independent of source precedence. */
export function resolveRole(catalogue: RolesLoad, id: string): RoleResolution {
  if (catalogue.snapshot.kind === 'unknown') {
    const unknown = catalogue.snapshot
    return {
      kind: 'unloaded',
      unknown,
      hole: { source: unknown.source, id: unknown.id, path: unknown.path },
      reason: UI_TEXT.teamRoleResolutionUnknown,
    }
  }
  const role = catalogue.roles.find((candidate) => candidate.id === id)
  return role === undefined
    ? { kind: 'unknown', reason: fill(UI_TEXT.teamRoleNotFound, { role: id }) }
    : { kind: 'found', role }
}
