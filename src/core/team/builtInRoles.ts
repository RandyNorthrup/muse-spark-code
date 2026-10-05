// Lane R (M96, PLAN.md D75): the seven built-in roles.
//
// Each ships as an AGENT.md the user can copy into `.agents/agents/` or the
// personal folder and edit. An edited copy shadows the built-in (M76's
// precedence). The `tools` line of each file is expanded from
// `TEAM_ROLE_TOOLSETS`, so the files cannot drift from the one definition.

import {
  TEAM_BUILTIN_ROLE_IDS,
  TEAM_BUILTIN_ROLE_TEXT,
  TEAM_ROLE_TOOLSETS,
  TEAM_TOOL_GROUP_TOOLS,
  type AgentSource,
  type TeamBuiltinRoleId,
  type TeamReportShape,
  type TeamToolGroup,
  type TeamWorkspaceMode,
} from '../../shared/constants'

/** A built-in role, resolved: an M76 agent definition with the role keys. */
export interface BuiltinRole {
  readonly id: string
  readonly source: AgentSource
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly done: string
  readonly body: string
  readonly workspace: TeamWorkspaceMode
  /** Canonical tool names, expanded from the role's groups. */
  readonly tools: readonly string[]
  readonly writePaths: readonly string[] | undefined
  readonly report: TeamReportShape
  readonly delegates: readonly string[]
}

const BUILTIN_ROLE_NAMES: Readonly<Record<TeamBuiltinRoleId, string>> = {
  research: 'Research',
  design: 'Design',
  marketing: 'Marketing',
  engineering: 'Engineering',
  qa: 'QA',
  'code-review': 'Code Review',
  docs: 'Docs',
}

const BUILTIN_ROLE_WORKSPACES: Readonly<Record<TeamBuiltinRoleId, TeamWorkspaceMode>> = {
  research: 'read-only',
  design: 'own-branch',
  marketing: 'own-branch',
  engineering: 'own-branch',
  qa: 'own-branch',
  'code-review': 'read-only',
  docs: 'own-branch',
}

const BUILTIN_ROLE_REPORTS: Readonly<Record<TeamBuiltinRoleId, TeamReportShape>> = {
  research: 'summary',
  design: 'summary',
  marketing: 'summary',
  engineering: 'summary',
  qa: 'qa',
  'code-review': 'review',
  docs: 'summary',
}

/** The canonical tools of groups, in table order, each once. */
export function toolsOfGroups(groups: readonly TeamToolGroup[]): string[] {
  const tools: string[] = []
  for (const group of groups) {
    for (const tool of TEAM_TOOL_GROUP_TOOLS[group]) {
      if (!tools.includes(tool)) {
        tools.push(tool)
      }
    }
  }
  return tools
}

/** The seven built-in roles, in table order. */
export function builtinRoles(): BuiltinRole[] {
  return TEAM_BUILTIN_ROLE_IDS.map((id) => {
    const text = TEAM_BUILTIN_ROLE_TEXT[id]
    const toolset = TEAM_ROLE_TOOLSETS[id]
    return {
      id,
      source: 'builtin' as const,
      name: BUILTIN_ROLE_NAMES[id],
      description: text.description,
      whenToUse: text.whenToUse,
      done: text.done,
      body: text.body,
      workspace: BUILTIN_ROLE_WORKSPACES[id],
      tools: toolsOfGroups(toolset.groups),
      writePaths: toolset.writePaths,
      report: BUILTIN_ROLE_REPORTS[id],
      delegates: [],
    }
  })
}

/**
 * A built-in role as an AGENT.md file: front matter with the role keys,
 * then the body. What "Copy Built-in Role to Project" writes (lane U1).
 */
export function builtinRoleFile(id: TeamBuiltinRoleId): string {
  const role = builtinRoles().find((candidate) => candidate.id === id)
  if (role === undefined) {
    throw new Error(`unknown built-in role ${id}`)
  }
  const lines = [
    '---',
    `name: ${role.name}`,
    `description: ${role.description}`,
    `when-to-use: ${role.whenToUse}`,
    `done: ${role.done}`,
    `workspace: ${role.workspace}`,
    `tools: ${role.tools.join(', ')}`,
  ]
  if (role.writePaths !== undefined) {
    lines.push(`write-paths: ${role.writePaths.join(', ')}`)
  }
  lines.push(`report: ${role.report}`, '---', '', role.body)
  return `${lines.join('\n')}\n`
}
