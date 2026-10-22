// M96d cross-role stealing: a listed task runs under the met
// policy, and every meet that cannot run it refuses. Tool names are
// the group table's (`TEAM_TOOL_GROUP_TOOLS`): read_file reads,
// write_file writes, web_search is the network, mcp__ names are MCP
// grants.
import { describe, expect, it } from 'vitest'
import type { RoleDefinition } from '../../src/core/team/roles'
import {
  TaskPicker,
  type PickContext,
  type SchedulerEntry,
} from '../../src/core/team/scheduler/pick'
import { stealPolicy } from '../../src/core/team/scheduler/steal'
import type { TeamBoardTask } from '../../src/shared/team'
import { submitTasks as submit, taskSubmission as submission, testBoard } from './helpers/teamBoard'

function role(id: string, overrides: Partial<RoleDefinition> = {}): RoleDefinition {
  return {
    id,
    source: 'project',
    name: id,
    description: '',
    whenToUse: undefined,
    done: undefined,
    body: '',
    workspace: undefined,
    tools: undefined,
    writePaths: undefined,
    skills: undefined,
    report: undefined,
    delegates: undefined,
    model: undefined,
    effort: undefined,
    approvalMode: undefined,
    sha256: undefined,
    ...overrides,
  }
}

function task(
  writes: TeamBoardTask['writes'],
  altRoles: TeamBoardTask['alt_roles'],
): Pick<TeamBoardTask, 'writes' | 'alt_roles'> {
  return {
    ...(writes !== undefined && { writes }),
    ...(altRoles !== undefined && { alt_roles: altRoles }),
  }
}

function listed(writes: TeamBoardTask['writes']): Pick<TeamBoardTask, 'writes' | 'alt_roles'> {
  return task(writes, ['r'])
}

describe('M96d cross-role stealing', () => {
  it('meets every authority-bearing field', () => {
    const roleQ = role('q', {
      workspace: 'own-branch',
      tools: ['read_file', 'write_file', 'mcp__git__log', 'mcp__git__show', 'web_search'],
      writePaths: ['src/**'],
      delegates: ['a', 'b'],
      approvalMode: 'allowAll',
      skills: ['s1', 's2'],
    })
    const roleR = role('r', {
      workspace: 'in-place',
      tools: ['read_file', 'write_file', 'mcp__git__log', 'run_checks'],
      writePaths: ['src/**', 'docs/**'],
      delegates: ['b', 'c'],
      approvalMode: 'promptUnmatched',
      skills: ['s2', 's3'],
    })
    const stolen = stealPolicy(task(['src/a.ts'], ['r']), roleQ, roleR)
    expect(stolen).toEqual({
      ok: true,
      policy: {
        fromRoleId: 'q',
        toRoleId: 'r',
        workspace: 'own-branch',
        tools: ['read_file', 'write_file', 'mcp__git__log'],
        groups: ['read', 'write'],
        writePaths: ['src/**'],
        delegates: ['b'],
        approvalMode: 'promptUnmatched',
        skills: ['s2'],
        mcpGrants: ['mcp__git__log'],
        network: false,
      },
    })
  })

  it('keeps the network when both sides keep web search', () => {
    const roleQ = role('q', { tools: ['read_file', 'web_search'] })
    const roleR = role('r', { tools: ['read_file', 'web_search', 'write_file'] })
    const stolen = stealPolicy(task(undefined, ['r']), roleQ, roleR)
    expect(stolen.ok).toBe(true)
    if (!stolen.ok) return
    expect(stolen.policy.tools).toEqual(['read_file', 'web_search'])
    expect(stolen.policy.groups).toEqual(['read', 'webSearch'])
    expect(stolen.policy.network).toBe(true)
  })

  it('treats absent lists as the session set, wider than any list', () => {
    const listed = role('q', { tools: ['read_file'], skills: ['s1'] })
    const open = role('r', {})
    const stolen = stealPolicy(task(undefined, ['r']), listed, open)
    expect(stolen.ok).toBe(true)
    if (!stolen.ok) return
    expect(stolen.policy.tools).toEqual(['read_file'])
    expect(stolen.policy.skills).toEqual(['s1'])
    expect(stolen.policy.groups).toEqual(['read'])
    const bothOpen = stealPolicy(task(undefined, ['r']), role('q', {}), role('r', {}))
    expect(bothOpen.ok).toBe(true)
    if (!bothOpen.ok) return
    expect(bothOpen.policy.tools).toBeUndefined()
    expect(bothOpen.policy.groups).toBeUndefined()
    expect(bothOpen.policy.skills).toBeUndefined()
    expect(bothOpen.policy.mcpGrants).toBeUndefined()
    expect(bothOpen.policy.network).toBeUndefined()
  })

  it('refuses what is not listed, whatever the policies admit', () => {
    const roleQ = role('q', {})
    const roleR = role('r', {})
    expect(stealPolicy(task(undefined, ['other']), roleQ, roleR)).toEqual({
      ok: false,
      reason: 'not-listed',
    })
    expect(stealPolicy(task(undefined, undefined), roleQ, roleR)).toEqual({
      ok: false,
      reason: 'not-listed',
    })
  })

  it('refuses every meet that cannot run the task', () => {
    // Disjoint tools: nothing to run with.
    expect(
      stealPolicy(
        listed(undefined),
        role('q', { tools: ['read_file'] }),
        role('r', { tools: ['run_checks'] }),
      ),
    ).toEqual({ ok: false, reason: 'no-tools' })
    // A writing task under a read-only meet.
    expect(
      stealPolicy(
        listed(['src/a.ts']),
        role('q', { workspace: 'own-branch', tools: ['read_file', 'write_file'] }),
        role('r', { workspace: 'read-only', tools: ['read_file', 'write_file'] }),
      ),
    ).toEqual({ ok: false, reason: 'read-only' })
    // A writing task with no write tool left: both sides write, disjointly.
    expect(
      stealPolicy(
        listed(['src/a.ts']),
        role('q', { tools: ['read_file', 'write_file'] }),
        role('r', { tools: ['read_file', 'edit_file'] }),
      ),
    ).toEqual({ ok: false, reason: 'no-write-tool' })
    // Declared writes outside the met paths.
    expect(
      stealPolicy(
        listed(['other/a.ts']),
        role('q', { tools: ['read_file', 'write_file'], writePaths: ['src/**'] }),
        role('r', { tools: ['read_file', 'write_file'], writePaths: ['src/**', 'docs/**'] }),
      ),
    ).toEqual({ ok: false, reason: 'writes-uncovered' })
    // Write paths neither side contains: the meet itself refuses.
    expect(
      stealPolicy(
        listed(undefined),
        role('q', { tools: ['read_file'], writePaths: ['a/**'] }),
        role('r', { tools: ['read_file'], writePaths: ['b/**'] }),
      ),
    ).toEqual({ ok: false, reason: 'write-path-inclusion-unproven' })
  })

  it('never refuses an undeclared need it narrows', () => {
    // Empty delegates and an asking ceiling still run: delegation and
    // approval narrow the worker without blocking it.
    const stolen = stealPolicy(
      task(undefined, ['r']),
      role('q', { tools: ['read_file'], delegates: ['a'], approvalMode: 'allowAll' }),
      role('r', { tools: ['read_file'], delegates: ['b'], approvalMode: 'denyUnmatched' }),
    )
    expect(stolen).toEqual({
      ok: true,
      policy: expect.objectContaining({
        delegates: [],
        approvalMode: 'denyUnmatched',
      }),
    })
  })
})

function entry(id: string, roleId: string): SchedulerEntry {
  return {
    id,
    roleId,
    agentProfileId: `agent-${id}`,
    modelId: 'm',
    kind: 'museCode',
    poolFit: 1,
    remainingDayTokens: 1000,
    eligible: () => true,
  }
}

function pickContext(
  entries: readonly SchedulerEntry[],
  roles?: PickContext['roles'],
): PickContext {
  return {
    now: 1,
    entries,
    ...(roles !== undefined && { roles }),
    canStart: () => true,
    estimatedTokens: () => 10,
    minutes: () => 5,
    landingOverlap: () => false,
    waits: [],
    youngerStarted: () => false,
    conversationWeight: () => 1,
  }
}

describe('M96d stolen picks', () => {
  it('ranks a listed steal below its own role with the met policy', () => {
    const board = testBoard()
    submit(board, [
      { ...submission('q1', { alt_roles: ['r'] }), roleId: 'q' },
      { ...submission('r1', {}), roleId: 'r' },
    ])
    const policies = new Map([
      ['q', role('q', { tools: ['read_file', 'write_file'] })],
      ['r', role('r', { tools: ['read_file', 'write_file', 'run_checks'] })],
    ])
    const context = pickContext([entry('e-q', 'q'), entry('e-r', 'r')], (roleId) =>
      policies.get(roleId),
    )
    const picker = new TaskPicker()
    const ranked = picker.rank(board.snapshot().tasks, context)
    const own = ranked.filter((pick) => pick.task.id === 'q1' && pick.entry.id === 'e-q')
    const stolen = ranked.filter((pick) => pick.task.id === 'q1' && pick.entry.id === 'e-r')
    expect(own).toHaveLength(1)
    expect(stolen).toHaveLength(1)
    const ownPick = own[0]
    const stolenPick = stolen[0]
    if (ownPick === undefined || stolenPick === undefined) throw new Error('picks missing')
    expect(ownPick.stolenPolicy).toBeUndefined()
    expect(stolenPick.stolenPolicy).toEqual({
      fromRoleId: 'q',
      toRoleId: 'r',
      workspace: 'own-branch',
      tools: ['read_file', 'write_file'],
      groups: ['read', 'write'],
      writePaths: undefined,
      delegates: [],
      approvalMode: 'denyUnmatched',
      skills: undefined,
      mcpGrants: [],
      network: false,
    })
    // Same task, same lane quality: the steal scores half, ranking below.
    expect(stolenPick.fit).toBe(ownPick.fit / 2)
    expect(ranked.indexOf(stolenPick)).toBeGreaterThan(ranked.indexOf(ownPick))
    // The first pick is own-role work, not the steal.
    expect(picker.pick(board.snapshot().tasks, context)?.task.id).toBe('q1')
    expect(picker.pick(board.snapshot().tasks, context)?.entry.id).toBe('e-q')
  })

  it('keeps M96c behaviour without role policies or refused meets', () => {
    const board = testBoard()
    submit(board, [{ ...submission('q1', { alt_roles: ['r'] }), roleId: 'q' }])
    const picker = new TaskPicker()
    // No policies: no lane steals, whatever the task lists.
    const blind = picker.rank(
      board.snapshot().tasks,
      pickContext([entry('e-q', 'q'), entry('e-r', 'r')]),
    )
    expect(blind.every((pick) => pick.entry.roleId === pick.task.roleId)).toBe(true)
    expect(blind.every((pick) => pick.stolenPolicy === undefined)).toBe(true)
    // A refused meet steals nothing either.
    const policies = new Map([
      ['q', role('q', { tools: ['read_file'] })],
      ['r', role('r', { tools: ['run_checks'] })],
    ])
    const refused = picker.rank(
      board.snapshot().tasks,
      pickContext([entry('e-r', 'r')], (roleId) => policies.get(roleId)),
    )
    expect(refused).toEqual([])
  })
})
