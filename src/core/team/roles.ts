// Lane R (M96, PLAN.md D75): the role keys on M76's parser.
//
// A role is an M76 agent definition (`AGENT.md`) with the role keys below,
// so there is one loader and one folder, and M83's imports become roles for
// free. Every key is optional, and a missing one keeps M76's meaning —
// except where the narrowing rules resolve it first. A file with an unknown
// or malformed role key is refused, naming the file.

import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_ID_PATTERN,
  AGENT_MAX_FILES,
  TEAM_NEW_ROLE_CEILING_GROUPS,
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
import type { ApprovalMode } from '../../shared/permissionModes'
import {
  type AgentHole,
  type AgentRoot,
  type AgentsLoaderDeps,
  narrowApprovalMode,
  parseAgentFileForRole,
} from '../context/customAgents'
import { type CatalogKind, loadCatalogFiles } from '../context/catalogFiles'
import { builtinRoles } from './builtInRoles'

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
  if (project.workspace === 'in-place') {
    return { ok: false, reason: 'a project role can never set in-place' }
  }
  if (project.model !== undefined) {
    return { ok: false, reason: 'a project role names no model: the pool chooses it' }
  }
  if (project.skills !== undefined) {
    return {
      ok: false,
      reason: 'a project role names no skills: they come from user configuration',
    }
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
  if (!isSubsetOf(project.writePaths, shadow.writePaths)) {
    return { ok: false, reason: 'a project role writes where the role it shadows does not' }
  }
  if (!isSubsetOf(project.delegates ?? [], shadow.delegates ?? [])) {
    return { ok: false, reason: 'a project role delegates where the role it shadows does not' }
  }
  const hasWiderCeiling =
    project.approvalMode !== undefined &&
    narrowApprovalMode(shadow.approvalMode ?? 'allowAll', project.approvalMode) !==
      project.approvalMode
  return hasWiderCeiling
    ? { ok: false, reason: 'a project role never widens the approval ceiling' }
    : { ok: true, role: project }
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
  if (role.sha256 !== undefined && isAllowanceForFile(allowance, role.sha256)) {
    return role
  }
  const ceiling = new Set(newRoleCeilingTools())
  return {
    ...role,
    workspace: 'read-only',
    tools: role.tools === undefined ? [...ceiling] : role.tools.filter((tool) => ceiling.has(tool)),
    writePaths: undefined,
    delegates: [],
  }
}

const ROLE_CATALOG: CatalogKind = {
  kind: 'role',
  fileName: 'AGENT.md',
  // Roles are M76 agent definitions: the same file, caps and layout.
  maxBytes: AGENT_FILE_MAX_BYTES,
  idPattern: AGENT_ID_PATTERN,
  maxEntries: AGENT_MAX_FILES,
}

export interface RolesLoad {
  /** Built-ins first, then the files in root order; each id once. */
  readonly roles: readonly RoleDefinition[]
  readonly holes: readonly AgentHole[]
  readonly warnings: readonly string[]
}

/** What a name resolves to: a role, nothing, or a hole of higher precedence than any match. */
export type RoleResolution =
  | { readonly kind: 'found'; readonly role: RoleDefinition }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unloaded'; readonly hole: AgentHole }

const ROLE_PRECEDENCE: readonly AgentSource[] = ['project', 'user', 'builtin']

/** A built-in as a role: its filed values are its resolved ones. */
function builtinToRole(role: ReturnType<typeof builtinRoles>[number]): RoleDefinition {
  return {
    id: role.id,
    source: role.source,
    name: role.name,
    description: role.description,
    whenToUse: role.whenToUse,
    done: role.done,
    body: role.body,
    workspace: role.workspace,
    tools: role.tools,
    writePaths: role.writePaths,
    skills: undefined,
    report: role.report,
    delegates: role.delegates,
    model: undefined,
    effort: undefined,
    approvalMode: undefined,
    sha256: undefined,
  }
}

/** A loaded file with its SHA-256: the allowance of a new-id project role is kept with it. */
interface LoadedRoleFile {
  readonly role: Omit<RoleDefinition, 'id' | 'source' | 'sha256'>
  readonly sha256: string
}

type RoleFileEntry =
  | { readonly ok: true; readonly name: string; readonly entry: LoadedRoleFile }
  | { readonly ok: false; readonly reason: string }

/** Parses one AGENT.md as a role, stashing its SHA-256 for the allowance. */
function parseRoleEntry(text: string): RoleFileEntry {
  const parsed = parseRoleFile(text)
  return parsed.ok
    ? {
        ok: true,
        name: parsed.role.name,
        entry: { role: parsed.role, sha256: roleFileSha256(text) },
      }
    : parsed
}

/**
 * Every valid role: the built-ins first, then the personal files, then the
 * project files with the same id rules as M76. Personal roots load in any
 * workspace; a project root loads only in a trusted workspace, and
 * elsewhere it is a hole, so its names refuse instead of falling back to a
 * lower role. A project file that shadows a built-in or personal role may
 * only narrow it; a project file with a new id keeps its asks and runs
 * under the ceiling until the workspace allows them.
 */
export async function loadRoles(
  deps: AgentsLoaderDeps,
  roots: readonly AgentRoot[],
  opts: { readonly trustedWorkspace: boolean },
): Promise<RolesLoad> {
  const warnings: string[] = []
  const holes: AgentHole[] = []
  const personal = new Map<string, RoleDefinition>()
  const project = new Map<string, RoleDefinition>()
  const pathModule = deps.platform === 'win32' ? path.win32 : path.posix
  const takeProjectEntry = (
    root: AgentRoot,
    id: string,
    filed: Omit<RoleDefinition, 'id' | 'source' | 'sha256'>,
    sha256: string,
  ): void => {
    const role: RoleDefinition = { ...filed, id, source: 'project', sha256 }
    const builtin = builtinRoles().find((candidate) => candidate.id === id)
    const shadowed =
      personal.get(id) ?? (builtin === undefined ? undefined : builtinToRole(builtin))
    if (shadowed === undefined) {
      project.set(id, role)
      return
    }
    const narrowed = narrowProjectRole(shadowed, role)
    if (!narrowed.ok) {
      warnings.push(`project role ${id} skipped: ${narrowed.reason}`)
      holes.push({
        source: 'project',
        id,
        path: pathModule.join(root.directory, id, ROLE_CATALOG.fileName),
      })
      return
    }
    project.set(id, narrowed.role)
  }
  // Personal roots first, so a project file meets the role it shadows.
  const userRoots = roots.filter((root) => root.source === 'user')
  const projectRoots = roots.filter((root) => root.source === 'project')
  for (const root of userRoots) {
    const load = await loadCatalogFiles(deps, [root], ROLE_CATALOG, parseRoleEntry)
    warnings.push(...load.warnings)
    for (const rootLoad of load.roots) {
      for (const refused of rootLoad.refused) {
        holes.push({ source: 'user', id: refused.id, path: refused.file })
      }
    }
    for (const entry of load.entries) {
      personal.set(entry.id, {
        ...entry.entry.role,
        id: entry.id,
        source: 'user',
        sha256: undefined,
      })
    }
  }
  for (const root of projectRoots) {
    if (!opts.trustedWorkspace) {
      warnings.push('loading the project roles failed: the workspace is not trusted')
      holes.push({ source: 'project', id: undefined, path: root.directory })
      continue
    }
    const load = await loadCatalogFiles(deps, [root], ROLE_CATALOG, parseRoleEntry)
    warnings.push(...load.warnings)
    for (const rootLoad of load.roots) {
      for (const refused of rootLoad.refused) {
        holes.push({ source: 'project', id: refused.id, path: refused.file })
      }
    }
    const entries = load.entries
    for (const entry of entries) {
      takeProjectEntry(root, entry.id, entry.entry.role, entry.entry.sha256)
    }
  }
  const roles: RoleDefinition[] = []
  for (const builtin of builtinRoles()) {
    if (!personal.has(builtin.id) && !project.has(builtin.id)) {
      roles.push(builtinToRole(builtin))
    } else {
      const higher = project.has(builtin.id) ? 'project' : 'personal'
      warnings.push(
        `builtin role ${builtin.id} skipped: the ${higher} role with the same id takes precedence`,
      )
    }
  }
  for (const role of personal.values()) {
    if (!project.has(role.id)) {
      roles.push(role)
    }
  }
  for (const role of project.values()) {
    roles.push(role)
  }
  return { roles, holes, warnings }
}

/** The roles the orchestrator is offered: those whose name resolves to them. */
export function offeredRoles(catalogue: RolesLoad): readonly RoleDefinition[] {
  return catalogue.roles.filter((role) => {
    const resolved = resolveRole(catalogue, role.id)
    return resolved.kind === 'found' && resolved.role === role
  })
}

/** What a name resolves to: a role, nothing, or a hole of higher precedence than any match. */
export function resolveRole(roles: RolesLoad, id: string): RoleResolution {
  for (const source of ROLE_PRECEDENCE) {
    const hole = roles.holes.find(
      (candidate) =>
        candidate.source === source && (candidate.id === undefined || candidate.id === id),
    )
    if (hole !== undefined) {
      return { kind: 'unloaded', hole }
    }
    const role = roles.roles.find((candidate) => candidate.source === source && candidate.id === id)
    if (role !== undefined) {
      return { kind: 'found', role }
    }
  }
  return { kind: 'unknown' }
}
