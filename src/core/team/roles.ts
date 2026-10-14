// Lane R (M96, PLAN.md D75): the role keys on M76's parser.
//
// A role is an M76 agent definition (`AGENT.md`) with the role keys below,
// so there is one loader and one folder, and M83's imports become roles for
// free. Every key is optional, and a missing one keeps M76's meaning —
// except where the narrowing rules resolve it first. A file with an unknown
// or malformed role key is refused, naming the file.

import {
  AGENT_ID_PATTERN,
  TEAM_REPORT_SHAPES,
  TEAM_ROLE_DELEGATES_MAX,
  TEAM_ROLE_DONE_MAX_CHARS,
  TEAM_ROLE_SKILL_IDS_MAX,
  TEAM_ROLE_SKILL_ID_MAX_CHARS,
  TEAM_ROLE_SKILL_ID_PATTERN,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  TEAM_ROLE_WRITE_PATHS_MAX,
  TEAM_ROLE_WRITE_PATH_MAX_CHARS,
  TEAM_WORKSPACE_MODES,
  type AgentSource,
  type EffortLevel,
  type TeamReportShape,
  type TeamToolGroup,
  type TeamWorkspaceMode,
} from '../../shared/constants'
import { type ApprovalMode } from '../../shared/permissionModes'
import { parseAgentFileForRole } from '../context/customAgents'

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
  /** Captured built-in policy; files cannot declare or infer these groups. */
  readonly toolGroups?: readonly TeamToolGroup[] | undefined
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
