// Lane T: the five team tools. Every drill from the lane's list is a case
// below: dry_run starts nothing, a task without a reason is refused,
// command_id retries are safe, workers never merge.

import { describe, expect, it } from 'vitest'
import {
  TeamCommandRegistry,
  teamCommandRecordsSchema,
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
  TEAM_IDENTIFIER_MAX_CHARS,
  TEAM_REASON_MAX_CHARS,
  TEAM_PLAN_ITEM_MAX_CHARS,
  TEAM_PATH_MAX_CHARS,
  TEAM_FILES_MAX,
  TEAM_PLAN_ITEMS_MAX,
  TEAM_TASK_IDS_MAX,
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
    await expect.poll(() => starts).toBe(1)
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

  it('keeps failed and pending start claims durable and refuses uncertain retries', async () => {
    let persisted: unknown
    const commands = new TeamCommandRegistry((records) => {
      persisted = structuredClone(records)
      return Promise.resolve()
    })
    const tasks = [{ role: 'qa' }]
    let starts = 0
    await expect(
      commands.run('failed', tasks, () => {
        starts += 1
        throw new Error('started then lost the answer')
      }),
    ).rejects.toThrow('lost the answer')
    expect(commands.snapshot()['failed']?.state).toBe('uncertain')
    await expect(
      commands.run('failed', tasks, () => {
        starts += 1
        return Promise.resolve({ output: 'duplicate', visibleOutput: '' })
      }),
    ).rejects.toThrow('uncertain')
    const held = Promise.withResolvers<{ output: string; visibleOutput: string }>()
    const entered = Promise.withResolvers<undefined>()
    const pending = commands.run('pending', tasks, () => {
      starts += 1
      entered.resolve(undefined)
      return held.promise
    })
    await entered.promise
    const restored = new TeamCommandRegistry()
    restored.restore(teamCommandRecordsSchema.parse(persisted))
    await expect(
      restored.run('pending', tasks, () => {
        starts += 1
        return Promise.resolve({ output: 'duplicate', visibleOutput: '' })
      }),
    ).rejects.toThrow('uncertain')
    await expect(restored.run('failed', [{ role: 'other' }], () => held.promise)).rejects.toThrow(
      'different tasks',
    )
    expect(starts).toBe(2)
    held.reject(new Error('interrupted'))
    await expect(pending).rejects.toThrow('interrupted')
    expect(commands.snapshot()['pending']?.state).toBe('uncertain')
  })

  it('does not dispatch until its retry claim is saved and refuses a failed save', async () => {
    const saved = Promise.withResolvers<undefined>()
    let starts = 0
    const commands = new TeamCommandRegistry(() => saved.promise)
    const pending = commands.run('save-first', [], () => {
      starts += 1
      return Promise.resolve({ output: 'task', visibleOutput: '' })
    })
    expect(starts).toBe(0)
    expect(commands.snapshot()['save-first']?.state).toBe('uncertain')
    saved.reject(new Error('disk full'))
    await expect(pending).rejects.toThrow('disk full')
    expect(starts).toBe(0)
    await expect(
      commands.run('save-first', [], () => {
        starts += 1
        return Promise.resolve({ output: 'duplicate', visibleOutput: '' })
      }),
    ).rejects.toThrow('uncertain')
  })

  it('serializes durable snapshots across concurrent command ids', async () => {
    const firstSave = Promise.withResolvers<undefined>()
    const saves: string[][] = []
    let starts = 0
    const commands = new TeamCommandRegistry(async (records) => {
      saves.push(Object.keys(records))
      if (saves.length === 1) await firstSave.promise
    })
    const start = () => {
      starts += 1
      return Promise.resolve({ output: 'task', visibleOutput: '' })
    }
    const first = commands.run('first', [], start)
    await expect.poll(() => saves.length).toBe(1)
    const second = commands.run('second', [], start)
    await Promise.resolve()
    expect(saves).toEqual([['first']])
    expect(starts).toBe(0)
    firstSave.resolve(undefined)
    await Promise.all([first, second])
    expect(saves.slice(1)).toEqual([
      ['first', 'second'],
      ['first', 'second'],
      ['first', 'second'],
    ])
    expect(starts).toBe(2)
  })

  it('rejects empty retry ids and oversized briefs before a runner sees them', () => {
    const task = { role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }
    expect(delegateArgs.safeParse({ tasks: [task], command_id: ' ' }).success).toBe(false)
    expect(
      delegateArgs.safeParse({ tasks: [{ ...task, brief: 'x'.repeat(TEAM_BRIEF_MAX_CHARS + 1) }] })
        .success,
    ).toBe(false)
    expect(
      delegateArgs.safeParse({
        tasks: [{ ...task, brief: `${' '.repeat(TEAM_BRIEF_MAX_CHARS)}x` }],
      }).success,
    ).toBe(false)
  })
})

describe('shared team argument size limits', () => {
  const task = { role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }
  const plan = { what: 'Review.', reason: task.reason }
  const oversizedId = 'x'.repeat(TEAM_IDENTIFIER_MAX_CHARS + 1)

  it.each(['role', 'entry', 'continue'])('bounds delegated %s before dispatch', (field) => {
    expect(delegateArgs.safeParse({ tasks: [{ ...task, [field]: oversizedId }] }).success).toBe(
      false,
    )
    expect(
      delegateArgs.safeParse({
        tasks: [{ ...task, [field]: 'x'.repeat(TEAM_IDENTIFIER_MAX_CHARS) }],
      }).success,
    ).toBe(true)
  })

  it.each(['command_id', 'pipeline'])(
    'bounds delegation %s before retaining a fingerprint',
    (field) => {
      expect(delegateArgs.safeParse({ tasks: [task], [field]: oversizedId }).success).toBe(false)
    },
  )

  it('bounds every reason, kept-plan text, file path and collection', () => {
    const oversizedReason = { ...task.reason, detail: 'x'.repeat(TEAM_REASON_MAX_CHARS + 1) }
    const args = [
      { tasks: [{ ...task, reason: oversizedReason }] },
      { tasks: [task], plan: [{ ...plan, reason: oversizedReason }] },
      { tasks: [task], plan: [{ ...plan, what: 'x'.repeat(TEAM_PLAN_ITEM_MAX_CHARS + 1) }] },
      { tasks: [task], plan: Array.from({ length: TEAM_PLAN_ITEMS_MAX + 1 }, () => plan) },
      { tasks: [{ ...task, files: ['x'.repeat(TEAM_PATH_MAX_CHARS + 1)] }] },
      { tasks: [{ ...task, files: Array.from({ length: TEAM_FILES_MAX + 1 }, () => 'a.ts') }] },
      { tasks: [{ ...task, files: [' '] }] },
    ]
    for (const value of args) expect(delegateArgs.safeParse(value).success).toBe(false)
    expect(
      delegateArgs.safeParse({
        tasks: [
          {
            ...task,
            reason: { ...task.reason, detail: 'x'.repeat(TEAM_REASON_MAX_CHARS) },
            files: Array.from({ length: TEAM_FILES_MAX }, () => 'x'.repeat(TEAM_PATH_MAX_CHARS)),
          },
        ],
        plan: Array.from({ length: TEAM_PLAN_ITEMS_MAX }, () => ({
          ...plan,
          what: 'x'.repeat(TEAM_PLAN_ITEM_MAX_CHARS),
        })),
      }).success,
    ).toBe(true)
  })

  it.each(['collect', 'cancel'] as const)('bounds %s ids and refuses blank identifiers', (name) => {
    for (const ids of [
      [oversizedId],
      [''],
      [' '],
      Array.from({ length: TEAM_TASK_IDS_MAX + 1 }, () => 't'),
    ])
      expect(parseTeamArgs(name, { task_ids: ids }).ok).toBe(false)
    expect(
      parseTeamArgs(name, { task_ids: Array.from({ length: TEAM_TASK_IDS_MAX }, () => 't') }).ok,
    ).toBe(true)
  })

  it('bounds merge identifiers', () => {
    expect(mergeArgs.safeParse({ task_id: oversizedId }).success).toBe(false)
    expect(mergeArgs.safeParse({ task_id: 'x'.repeat(TEAM_IDENTIFIER_MAX_CHARS) }).success).toBe(
      true,
    )
  })

  it('publishes the same argument limits to both backends', () => {
    expect(TEAM_TOOL_SCHEMAS.delegate.properties['command_id']).toMatchObject({
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
    })
    expect(TEAM_TOOL_SCHEMAS.delegate.properties['tasks']).toMatchObject({
      maxItems: TEAM_DELEGATE_MAX,
      items: {
        properties: {
          role: { maxLength: TEAM_IDENTIFIER_MAX_CHARS },
          brief: { maxLength: TEAM_BRIEF_MAX_CHARS },
          reason: { properties: { detail: { maxLength: TEAM_REASON_MAX_CHARS } } },
          files: { maxItems: TEAM_FILES_MAX, items: { maxLength: TEAM_PATH_MAX_CHARS } },
          entry: { maxLength: TEAM_IDENTIFIER_MAX_CHARS },
          continue: { maxLength: TEAM_IDENTIFIER_MAX_CHARS },
        },
      },
    })
    expect(TEAM_TOOL_SCHEMAS.delegate.properties['plan']).toMatchObject({
      maxItems: TEAM_PLAN_ITEMS_MAX,
      items: { properties: { what: { maxLength: TEAM_PLAN_ITEM_MAX_CHARS } } },
    })
    for (const name of ['collect', 'cancel'] as const)
      expect(TEAM_TOOL_SCHEMAS[name].properties['task_ids']).toMatchObject({
        maxItems: TEAM_TASK_IDS_MAX,
        items: { maxLength: TEAM_IDENTIFIER_MAX_CHARS },
      })
    expect(TEAM_TOOL_SCHEMAS.merge.properties['task_id']).toMatchObject({
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
    })
  })
})
