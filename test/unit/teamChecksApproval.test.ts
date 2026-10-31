// How a Muse Code worker's approval for a tool call is answered (RLF-TEAMWORKERS3):
// the team's own `run_checks` runs the person's configured commands and is
// answered yes once, only for a role that has the checks group; another
// server's tool, even one named `run_checks`, is refused as every unknown tool
// is. The tool name Muse Code reports for a session MCP server's tool is not
// captured yet (the live run records it, docs/certification/rlf-teamworkers3.md),
// so the match is on the server name this team gave its own server: a name
// Muse Code refuses in the person's settings.
import { describe, expect, it } from 'vitest'
import {
  classifyMuseWorkerApproval,
  WORKER_NATIVE_IO,
} from '../../src/core/team/workers/workerFence'
import type { WorkerRolePolicy } from '../../src/core/team/workers/workerTypes'
import { TEAM_CHECKS_SERVER, TEAM_CHECKS_TOOL } from '../../src/shared/constants'

const WITH_CHECKS: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'checks', 'report'],
  reportShape: 'summary',
}
const WITHOUT_CHECKS: WorkerRolePolicy = { ...WITH_CHECKS, toolGroups: ['read', 'report'] }

function answer(role: WorkerRolePolicy, tool: string) {
  return classifyMuseWorkerApproval({
    role,
    request: { kind: 'other', tool },
    dialect: 'bash',
    readOnlyCommands: new Set(),
    folder: '/work/copy',
    platform: process.platform,
    io: WORKER_NATIVE_IO,
    workspaceRoot: '/work/repo',
  })
}

describe('a worker’s approval for a tool call', () => {
  it('answers yes to the team’s own run_checks for a role that has the checks group', async () => {
    expect(await answer(WITH_CHECKS, `mcp__${TEAM_CHECKS_SERVER}__${TEAM_CHECKS_TOOL}`)).toBe(
      'allow',
    )
  })

  it('refuses it for a role without the checks group', async () => {
    expect(await answer(WITHOUT_CHECKS, `mcp__${TEAM_CHECKS_SERVER}__${TEAM_CHECKS_TOOL}`)).toBe(
      'deny',
    )
  })

  it('refuses every other tool, including another server’s run_checks', async () => {
    expect(await answer(WITH_CHECKS, `mcp__docs__${TEAM_CHECKS_TOOL}`)).toBe('deny')
    expect(await answer(WITH_CHECKS, TEAM_CHECKS_TOOL)).toBe('deny')
    expect(await answer(WITH_CHECKS, 'web_fetch')).toBe('deny')
  })
})
