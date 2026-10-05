// Lane T: the five team tools. Every drill from the lane's list is a case
// below: dry_run starts nothing, a task without a reason is refused,
// command_id retries are safe, workers never merge.

import { describe, expect, it } from 'vitest'
import {
  clampCollectWait,
  delegateArgs,
  fingerprintDelegateTasks,
  isTeamTool,
  parseTeamArgs,
  singleModelAgainRefusal,
  teamMcpToolList,
  teamRunnerMissing,
  teamToolNotDeclared,
  teamToolsForWorker,
  TEAM_TOOL_NAMES,
  TEAM_WORKER_TOOL_NAMES,
} from '../../src/core/team/teamTools'
import { TEAM_COLLECT_WAIT_MAX_SECONDS } from '../../src/core/team/teamConstants'

describe('team tool names', () => {
  it('declares the five orchestrator tools, in order', () => {
    expect([...TEAM_TOOL_NAMES]).toEqual(['roster', 'delegate', 'collect', 'cancel', 'merge'])
  })

  it('recognises only the five', () => {
    for (const name of TEAM_TOOL_NAMES) {
      expect(isTeamTool(name)).toBe(true)
    }
    expect(isTeamTool('reschedule')).toBe(false)
    expect(isTeamTool('subagent_spawn')).toBe(false)
    expect(isTeamTool('merge_into')).toBe(false)
  })

  it('withholds merge from workers, and every tool from a role that never delegates', () => {
    expect([...teamToolsForWorker(['engineering'])]).toEqual([...TEAM_WORKER_TOOL_NAMES])
    expect(teamToolsForWorker(['engineering'])).not.toContain('merge')
    expect(teamToolsForWorker(undefined)).toEqual([])
    expect(teamToolsForWorker([])).toEqual([])
  })
})

describe('delegate arguments', () => {
  const task = {
    role: 'engineering',
    brief: 'Add the retry.',
    reason: { code: 'parallel', detail: 'Two independent pieces run at once.' },
  }

  it('accepts tasks with a rubric reason and kept plan items', () => {
    const parsed = delegateArgs.safeParse({
      tasks: [task],
      plan: [
        {
          what: 'Review the result.',
          reason: { code: 'asked_you', detail: 'You own integration.' },
        },
      ],
      command_id: 'cmd-1',
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses a task without a reason', () => {
    const { role, brief } = task
    const parsed = delegateArgs.safeParse({ tasks: [{ role, brief }] })
    expect(parsed.success).toBe(false)
  })

  it('refuses a reason outside the rubric', () => {
    const parsed = delegateArgs.safeParse({
      tasks: [{ ...task, reason: { code: 'because', detail: 'I feel like it.' } }],
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses an empty task list and more than six tasks', () => {
    expect(delegateArgs.safeParse({ tasks: [] }).success).toBe(false)
    expect(
      delegateArgs.safeParse({ tasks: [task, task, task, task, task, task, task] }).success,
    ).toBe(false)
    expect(delegateArgs.safeParse({ tasks: [task, task, task, task, task, task] }).success).toBe(
      true,
    )
  })

  it('reports argument failures through parseTeamArgs', () => {
    const refused = parseTeamArgs('delegate', { tasks: [] })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.reason).toContain('invalid arguments')
    }
    expect(parseTeamArgs('roster', {}).ok).toBe(true)
    expect(parseTeamArgs('merge', { task_id: ' ' }).ok).toBe(false)
  })
})

describe('collect wait bound', () => {
  it('clamps a longer wait to the backend bound, never refusing', () => {
    expect(clampCollectWait(TEAM_COLLECT_WAIT_MAX_SECONDS + 1)).toBe(TEAM_COLLECT_WAIT_MAX_SECONDS)
    expect(clampCollectWait(5)).toBe(5)
    expect(clampCollectWait(undefined)).toBe(undefined)
  })
})

describe('command_id', () => {
  it('fingerprints tasks stably across key order', () => {
    const first = fingerprintDelegateTasks([{ role: 'qa', brief: 'Test it.' }])
    const second = fingerprintDelegateTasks([{ brief: 'Test it.', role: 'qa' }])
    expect(first).toBe(second)
    expect(fingerprintDelegateTasks([{ role: 'qa', brief: 'Test it!' }])).not.toBe(first)
  })
})

describe('refusal texts', () => {
  it('names the boundary when the team went away mid-conversation', () => {
    expect(singleModelAgainRefusal()).toContain('from a new conversation')
  })

  it('never answers an empty success without a runner', () => {
    expect(teamRunnerMissing('delegate')).toContain('Error')
  })

  it('refuses an undeclared team tool as unknown', () => {
    expect(teamToolNotDeclared('delegate')).toContain('unknown tool')
  })
})

describe('team MCP tool list', () => {
  it('lists the five tools with stable, role-free descriptions', () => {
    const first = teamMcpToolList()
    const second = teamMcpToolList()
    expect(first.map((tool) => tool.name)).toEqual([...TEAM_TOOL_NAMES])
    expect(JSON.stringify(first.map(({ call: _call, ...rest }) => rest))).toBe(
      JSON.stringify(second.map(({ call: _call, ...rest }) => rest)),
    )
    for (const tool of first) {
      expect(tool.description).not.toContain('engineering')
    }
  })

  it('marks roster and collect read-only', () => {
    const byName = new Map(teamMcpToolList().map((tool) => [tool.name, tool]))
    expect(byName.get('roster')?.annotations).toMatchObject({ readOnlyHint: true })
    expect(byName.get('collect')?.annotations).toMatchObject({ readOnlyHint: true })
    expect(byName.get('delegate')?.annotations).toBeUndefined()
    expect(byName.get('merge')?.annotations).toBeUndefined()
  })
})
