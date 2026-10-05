// Lane T: the five team tools. Every drill from the lane's list is a case
// below: dry_run starts nothing, a task without a reason is refused,
// command_id retries are safe, workers never merge.

import { describe, expect, it } from 'vitest'
import {
  TeamCommandRegistry,
  cancelArgs,
  clampCollectWait,
  collectArgs,
  delegateArgs,
  type DelegateArgs,
  fingerprintDelegateTasks,
  isTeamTool,
  mergeArgs,
  parseTeamArgs,
  rosterArgs,
  singleModelAgainRefusal,
  teamMcpToolList,
  teamRunnerMissing,
  TEAM_TOOL_DEFINITIONS,
  TEAM_TOOL_SCHEMAS,
  teamToolNotDeclared,
  teamToolsForWorker,
  TEAM_TOOL_NAMES,
  TEAM_WORKER_TOOL_NAMES,
} from '../../src/core/team/teamTools'
import {
  TEAM_BRIEF_FILES_MAX_BYTES,
  TEAM_BRIEF_MAX_CHARS,
  TEAM_COLLECT_PAGE_CHARS,
  TEAM_COLLECT_WAIT_MAX_SECONDS,
  TEAM_DELEGATE_MAX,
  type TeamReasonCode,
} from '../../src/core/team/teamConstants'

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
    expect(clampCollectWait(0)).toBe(0)
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

describe('plan contracts', () => {
  it('pins the plan’s tunables the lanes code against (D75)', () => {
    expect(TEAM_DELEGATE_MAX).toBe(6)
    expect(TEAM_COLLECT_PAGE_CHARS).toBe(16_000)
    expect(TEAM_BRIEF_MAX_CHARS).toBe(8000)
    expect(TEAM_BRIEF_FILES_MAX_BYTES).toBe(65_536)
    const code: TeamReasonCode = 'parallel'
    const task: DelegateArgs = {
      tasks: [{ role: 'qa', brief: 'Test it.', reason: { code, detail: 'Two pieces.' } }],
    }
    expect(task.tasks).toHaveLength(1)
  })

  it('declares the same five tools on the Model API as on the team server', () => {
    expect(TEAM_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([...TEAM_TOOL_NAMES])
    for (const name of TEAM_TOOL_NAMES) {
      const definition = TEAM_TOOL_DEFINITIONS.find((tool) => tool.name === name)
      expect(definition?.description).toBe(TEAM_TOOL_SCHEMAS[name].description)
      expect(definition?.required).toEqual([...TEAM_TOOL_SCHEMAS[name].required])
    }
  })

  it('validates every tool’s arguments before anything runs', () => {
    expect(rosterArgs.safeParse({}).success).toBe(true)
    expect(collectArgs.safeParse({ wait_seconds: 5, part: 'diff', offset: 0 }).success).toBe(true)
    expect(collectArgs.safeParse({ wait_seconds: -1 }).success).toBe(false)
    expect(collectArgs.safeParse({ part: 'everything' }).success).toBe(false)
    expect(cancelArgs.safeParse({ task_ids: ['t1'] }).success).toBe(true)
    expect(cancelArgs.safeParse({ task_ids: [] }).success).toBe(false)
    expect(mergeArgs.safeParse({ task_id: 't1' }).success).toBe(true)
    expect(mergeArgs.safeParse({ task_id: 't1', on_conflict: 'markers' }).success).toBe(true)
    expect(mergeArgs.safeParse({ task_id: 't1', on_conflict: 'force' }).success).toBe(false)
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

describe('concurrent command retries', () => {
  it('shares pending work, rejects changed nested reasons and persists replay', async () => {
    const commands = new TeamCommandRegistry()
    const pending = Promise.withResolvers<{ output: string; visibleOutput: string }>()
    let starts = 0
    const tasks = [{ role: 'qa', reason: { code: 'specialty', detail: 'Tests.' } }]
    const start = () => {
      starts += 1
      return pending.promise
    }
    const first = commands.run('retry', tasks, start)
    const retry = commands.run(
      'retry',
      [{ reason: { detail: 'Tests.', code: 'specialty' }, role: 'qa' }],
      start,
    )
    expect(starts).toBe(1)
    await expect(
      commands.run(
        'retry',
        [{ role: 'qa', reason: { code: 'parallel', detail: 'Tests.' } }],
        start,
      ),
    ).rejects.toThrow('different tasks')
    pending.resolve({ output: 'task-1', visibleOutput: 'Started.' })
    const firstAnswer = await first
    const retryAnswer = await retry
    expect(firstAnswer.output).toBe('task-1')
    expect(retryAnswer.output).toBe('task-1')
    const restored = new TeamCommandRegistry()
    restored.restore(commands.snapshot())
    const restoredAnswer = await restored.run('retry', tasks, start)
    expect(restoredAnswer.output).toBe('task-1')
    expect(starts).toBe(1)
  })

  it('rejects empty retry ids and oversized briefs before a runner sees them', () => {
    const task = { role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }
    expect(delegateArgs.safeParse({ tasks: [task], command_id: ' ' }).success).toBe(false)
    expect(
      delegateArgs.safeParse({ tasks: [{ ...task, brief: 'x'.repeat(TEAM_BRIEF_MAX_CHARS + 1) }] })
        .success,
    ).toBe(false)
  })
})
