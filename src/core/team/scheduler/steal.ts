// M96d cross-role stealing (PLAN.md D75): a free lane of role R takes
// a task of role Q only when the task lists R in `alt_roles`. The
// task then runs under the intersection of Q's and R's resolved
// policies, field by field: the workspace mode, the tool groups, the
// `write-paths`, the `delegates`, the approval ceiling, the skills,
// the MCP server grants and the network. A field whose intersection
// leaves the task unable to run refuses the steal. Pure.

import {
  MCP_FUNCTION_PREFIX,
  type TeamToolGroup,
  type TeamWorkspaceMode,
} from '../../../shared/constants'
import type { ApprovalMode } from '../../../shared/permissionModes'
import type { TeamBoardTask } from '../../../shared/team'
import {
  hasRoleWriteTool,
  isWritePathSubsetOf,
  meetRolePermissions,
  resolveRoleWorkspace,
  type RoleCeiling,
  type RoleDefinition,
} from '../roles'
import { groupsForTools } from '../toolsets'

/** The stolen policy both roles admit: every field met, nothing widened. */
export interface StolenPolicy {
  readonly fromRoleId: string
  readonly toRoleId: string
  readonly workspace: TeamWorkspaceMode
  /** Met tool names; undefined resolves to the session's own set. */
  readonly tools: readonly string[] | undefined
  /** Groups keeping a met tool; undefined while the tools are the session's. */
  readonly groups: readonly TeamToolGroup[] | undefined
  readonly writePaths: readonly string[] | undefined
  readonly delegates: readonly string[]
  readonly approvalMode: ApprovalMode
  /** Met skills; undefined resolves to the session's own set. */
  readonly skills: readonly string[] | undefined
  /** Met `mcp__` tools; undefined while the tools are the session's. */
  readonly mcpGrants: readonly string[] | undefined
  /**
  Whether the `webSearch` group survives the meet; undefined while
  the tools are the session's, resolved at the session meet.
  */
  readonly network: boolean | undefined
}

export type StealRefusalReason =
  | 'not-listed'
  | 'write-path-inclusion-unproven'
  | 'no-tools'
  | 'read-only'
  | 'no-write-tool'
  | 'writes-uncovered'

export type StealResult =
  | { readonly ok: true; readonly policy: StolenPolicy }
  | { readonly ok: false; readonly reason: StealRefusalReason }

/** An absent list resolves to the whole session: wider than any list. */
function meetLists(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  if (left === undefined) return right
  return right === undefined ? left : left.filter((item) => right.includes(item))
}

function ceilingFrom(role: RoleDefinition): RoleCeiling {
  return {
    ...(role.workspace !== undefined && { workspace: role.workspace }),
    ...(role.tools !== undefined && { tools: role.tools }),
    ...(role.writePaths !== undefined && { writePaths: role.writePaths }),
    ...(role.delegates !== undefined && { delegates: role.delegates }),
    ...(role.approvalMode !== undefined && { approvalMode: role.approvalMode }),
  }
}

/**
Steal a task of role Q onto a free lane of role R: meet every
authority-bearing field and refuse when the meet cannot run the
task. The launcher meets the stolen tools with the session as usual.
*/
export function stealPolicy(
  task: Pick<TeamBoardTask, 'writes' | 'alt_roles'>,
  roleQ: RoleDefinition,
  roleR: RoleDefinition,
): StealResult {
  if (task.alt_roles?.includes(roleR.id) !== true) return { ok: false, reason: 'not-listed' }
  const met = meetRolePermissions(roleQ, [ceilingFrom(roleR)])
  if (!met.ok) return { ok: false, reason: 'write-path-inclusion-unproven' }
  const tools = met.role.tools
  if (tools?.length === 0) return { ok: false, reason: 'no-tools' }
  const writes = task.writes ?? []
  const isWriting = writes.length > 0
  if (isWriting && met.role.workspace === 'read-only') return { ok: false, reason: 'read-only' }
  if (isWriting && tools !== undefined && !hasRoleWriteTool(tools))
    return { ok: false, reason: 'no-write-tool' }
  if (isWriting && !isWritePathSubsetOf(writes, met.role.writePaths))
    return { ok: false, reason: 'writes-uncovered' }
  const groups = tools === undefined ? undefined : groupsForTools(tools)
  return {
    ok: true,
    policy: {
      fromRoleId: roleQ.id,
      toRoleId: roleR.id,
      // The meet always files a workspace; resolve from the tools if it ever does not.
      workspace: met.role.workspace ?? resolveRoleWorkspace(met.role),
      tools,
      groups,
      writePaths: met.role.writePaths,
      delegates: met.role.delegates ?? [],
      approvalMode: met.role.approvalMode ?? 'denyUnmatched',
      skills: meetLists(roleQ.skills, roleR.skills),
      mcpGrants:
        tools === undefined
          ? undefined
          : tools.filter((tool) => tool.startsWith(MCP_FUNCTION_PREFIX)),
      network: groups === undefined ? undefined : groups.includes('webSearch'),
    },
  }
}
