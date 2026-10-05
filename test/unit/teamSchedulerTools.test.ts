import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { createSchedulerTeamTools, type TeamBaseTools } from '../../src/core/team/teamTools'
import { teamSchedulerFieldsSchema } from '../../src/shared/team'
import { attempt, makeBoard, submission } from './helpers/teamScheduler'

const signal = new AbortController().signal
const args = {
  command_id: 'call-1',
  tasks: [
    {
      role: 'engineering',
      brief: 'Implement the change',
      reason: { code: 'parallel', text: 'Independent work' },
    },
  ],
}

function setup() {
  const { board, countAttempt } = makeBoard()
  const calls = {
    roster: vi.fn(() => Promise.resolve('headroom and daily budget')),
    delegate: vi.fn((input: Readonly<Record<string, unknown>>, _signal: AbortSignal) => {
      const parsed = z
        .object({
          tasks: z.array(z.looseObject({ role: z.string(), ...teamSchedulerFieldsSchema.shape })),
        })
        .parse(input)
      const added = board.submit(
        parsed.tasks.map((task, index) => {
          const { key, depends_on, priority, size, writes, overlap } = task
          return submission(`task-${String(index + 1)}`, {
            roleId: task.role,
            workspaceMode: task.role === 'research' ? 'read-only' : 'own-branch',
            fields: { key, depends_on, priority, size, writes, overlap },
          })
        }),
        0,
      )
      for (const task of added) {
        if (task.state === 'ready') board.begin(task.id, attempt())
      }
      return Promise.resolve(JSON.stringify(added))
    }),
    collect: vi.fn(() => Promise.resolve('report page')),
    cancel: vi.fn(() => Promise.resolve('cancelled')),
    merge: vi.fn(() => Promise.resolve('immediate merge must never run')),
  }
  const definition = (name: keyof typeof calls) => ({
    name,
    description: `Fixed ${name} description`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              role: { type: 'string' },
              brief: { type: 'string' },
              reason: { type: 'object' },
            },
            required: ['role', 'brief', 'reason'],
          },
        },
        command_id: { type: 'string' },
      },
      required: ['tasks', 'command_id'],
    },
    call: calls[name],
  })
  const definitions = {
    roster: definition('roster'),
    delegate: definition('delegate'),
    collect: definition('collect'),
    cancel: definition('cancel'),
    merge: definition('merge'),
  }
  const base: TeamBaseTools = definitions
  const enqueue = vi.fn(
    (options: { task_id: string; on_conflict: 'rework' | 'markers' }, _signal: AbortSignal) =>
      Promise.resolve({ task_id: options.task_id, position: 2 }),
  )
  const source = {
    read: vi.fn(() => ({ board: board.snapshot(), leases: [], mergeQueue: [], events: [] })),
  }
  const now = vi.fn(() => 10)
  const tools = createSchedulerTeamTools(base, board, { enqueue }, source, now)
  const rebuild = () => createSchedulerTeamTools(base, board, { enqueue }, source, now)
  const tool = (name: string) => tools.find((item) => item.name === name)!
  return {
    board,
    countAttempt,
    calls,
    enqueue,
    source,
    now,
    definitions,
    base,
    rebuild,
    tool,
    tools,
  }
}

describe('M96c scheduler tools', () => {
  it('accepts every scheduler field and preserves the base envelope before atomic board submission', async () => {
    const { tool, calls, board } = setup()
    const input = {
      ...args,
      plan: [{ what: 'Integrate', reason: { code: 'coupled', text: 'Keep integration' } }],
      pipeline: 'change',
      tasks: [
        {
          ...args.tasks[0],
          role: 'research',
          key: 'research',
          priority: 'high',
          size: 'S',
          writes: [],
          overlap: 'allow',
        },
        { ...args.tasks[0], key: 'write', depends_on: [{ task: 'research' }], writes: ['src/**'] },
      ],
    }
    await tool('delegate').call(input, signal)
    expect(calls.delegate).toHaveBeenCalledWith(
      {
        ...input,
        tasks: [
          input.tasks[0],
          { ...input.tasks[1], priority: 'normal', size: 'M', overlap: 'serialize' },
        ],
      },
      signal,
    )
    expect(board.task('task-2')).toMatchObject({
      state: 'queued',
      depends_on: [{ task: 'task-1', on: 'done' }],
      writes: ['src/**'],
    })
    expect(board.task('task-1')).toMatchObject({ priority: 'high', size: 'S', overlap: 'allow' })
  })

  it('refuses cycles, unknown tasks and foreign edges as a whole before any attempt', async () => {
    for (const dependency of ['missing', 'foreign']) {
      const { tool, board, countAttempt } = setup()
      await expect(
        tool('delegate').call(
          { ...args, tasks: [{ ...args.tasks[0], depends_on: [{ task: dependency }] }] },
          signal,
        ),
      ).rejects.toMatchObject({ edge: ['task-1', dependency] })
      expect(board.snapshot().tasks).toEqual([])
      expect(countAttempt).not.toHaveBeenCalled()
    }
    const { tool, board, countAttempt } = setup()
    await expect(
      tool('delegate').call(
        {
          ...args,
          tasks: [
            { ...args.tasks[0], key: 'a', depends_on: [{ task: 'b' }] },
            { ...args.tasks[0], key: 'b', depends_on: [{ task: 'a' }] },
          ],
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'cycle', edge: ['task-1', 'task-2', 'task-1'] })
    expect(board.snapshot().tasks).toEqual([])
    expect(countAttempt).not.toHaveBeenCalled()
  })

  it('refuses malformed scheduler fields before invoking delegate and keeps dry runs and command ids with base admission', async () => {
    const { tool, calls } = setup()
    for (const input of [{}, { tasks: [] }]) {
      await expect(tool('delegate').call(input, signal)).rejects.toThrow()
    }
    for (const fields of [
      { priority: 'highest' },
      { size: 'XXL' },
      { overlap: 'ignore' },
      { depends_on: [{ task: 'a', on: 'started' }] },
      { writes: ['bad\0path'] },
    ]) {
      await expect(
        tool('delegate').call({ ...args, tasks: [{ ...args.tasks[0], ...fields }] }, signal),
      ).rejects.toThrow()
    }
    expect(calls.delegate).not.toHaveBeenCalled()
    calls.delegate.mockImplementationOnce(() => Promise.resolve('dry run, no work'))
    const dryRun = { ...args, dry_run: true }
    await tool('delegate').call(dryRun, signal)
    expect(calls.delegate).toHaveBeenCalledWith(
      {
        ...dryRun,
        tasks: [{ ...args.tasks[0], priority: 'normal', size: 'M', overlap: 'serialize' }],
      },
      signal,
    )
  })

  it('enqueues merge with a one-based position, defaults to rework and never invokes immediate merge', async () => {
    const { tool, enqueue, calls } = setup()
    expect(JSON.parse(await tool('merge').call({ task_id: 'task-1' }, signal))).toEqual({
      task_id: 'task-1',
      position: 2,
    })
    expect(enqueue).toHaveBeenCalledWith({ task_id: 'task-1', on_conflict: 'rework' }, signal)
    await tool('merge').call({ task_id: 'task-1', on_conflict: 'markers' }, signal)
    expect(enqueue).toHaveBeenLastCalledWith({ task_id: 'task-1', on_conflict: 'markers' }, signal)
    expect(calls.merge).not.toHaveBeenCalled()
  })

  it('refuses invalid merge input and invalid or mismatched queue receipts', async () => {
    const { tool, enqueue } = setup()
    await expect(
      tool('merge').call({ task_id: 'task-1', land_without_checks: true }, signal),
    ).rejects.toThrow()
    expect(enqueue).not.toHaveBeenCalled()
    enqueue.mockResolvedValueOnce({ task_id: 'task-1', position: 0 })
    await expect(tool('merge').call({ task_id: 'task-1' }, signal)).rejects.toThrow()
    enqueue.mockResolvedValueOnce({ task_id: 'task-2', position: 1 })
    await expect(tool('merge').call({ task_id: 'task-1' }, signal)).rejects.toThrow(
      'enqueueTaskMismatch',
    )
  })

  it('reschedules priority, hold, release and dependencies without starting or spending', async () => {
    const { tool, board, countAttempt, calls, enqueue } = setup()
    board.submit([submission('a'), submission('b')], 0)
    await tool('reschedule').call(
      { task_ids: ['b'], priority: 'urgent', hold: true, depends_on: [{ task: 'a' }] },
      signal,
    )
    expect(board.task('b')).toMatchObject({
      priority: 'urgent',
      held: true,
      state: 'queued',
      depends_on: [{ task: 'a', on: 'merged' }],
      attempts: [],
    })
    await tool('reschedule').call({ task_ids: ['b'], hold: false, depends_on: [] }, signal)
    expect(board.task('b')).toMatchObject({ held: false, state: 'ready', attempts: [] })
    expect(countAttempt).not.toHaveBeenCalled()
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reschedule refuses relink cycles atomically and cannot change running tasks', async () => {
    const { tool, board } = setup()
    board.submit([submission('a'), submission('b')], 0)
    const before = board.snapshot()
    await expect(
      tool('reschedule').call({ task_ids: ['a'], depends_on: [{ task: 'a' }] }, signal),
    ).rejects.toMatchObject({ code: 'cycle' })
    expect(board.snapshot()).toEqual(before)
    expect(board.begin('a', attempt())).toBe(true)
    await expect(
      tool('reschedule').call({ task_ids: ['a', 'b'], priority: 'urgent' }, signal),
    ).rejects.toMatchObject({ code: 'state' })
    expect(board.task('b').priority).toBe('normal')
  })

  it('waits for the journalled board acknowledgement before publishing a reschedule answer', async () => {
    const { board, base, enqueue, source, now } = setup()
    board.submit([submission('a')], 0)
    const journal = Promise.withResolvers<undefined>()
    const reschedule = vi.fn(async (change: unknown, at: number) => {
      board.reschedule(change, at)
      await journal.promise
    })
    const tools = createSchedulerTeamTools(base, { reschedule }, { enqueue }, source, now)
    const onAnswer = vi.fn()
    const pending = (async () => {
      await tools
        .find((tool) => tool.name === 'reschedule')!
        .call({ task_ids: ['a'], priority: 'urgent' }, signal)
      onAnswer()
    })()
    await vi.waitFor(() => {
      expect(reschedule).toHaveBeenCalledOnce()
    })
    expect(onAnswer).not.toHaveBeenCalled()
    expect(source.read).not.toHaveBeenCalled()
    journal.resolve(undefined)
    await pending
    expect(onAnswer).toHaveBeenCalledOnce()
    expect(board.task('a').priority).toBe('urgent')
  })

  it('keeps declarations byte-identical as live state and base definitions change', async () => {
    const { tools, tool, board, definitions, source, calls, rebuild } = setup()
    const declaration = (list = tools) =>
      JSON.stringify(list.map(({ call: _call, ...definition }) => definition))
    const before = declaration()
    expect(source.read).not.toHaveBeenCalled()
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
    board.submit([submission('a')], 0)
    await tool('roster').call({}, signal)
    await tool('collect').call({ part: 'transcript', offset: 16_000, wait_seconds: 0 }, signal)
    expect(declaration(rebuild())).toBe(before)
    definitions.delegate.inputSchema.properties.tasks.maxItems = 1
    definitions.roster.inputSchema.properties.tasks.maxItems = 1
    definitions.cancel.inputSchema.properties.tasks.maxItems = 1
    expect(declaration()).toBe(before)
    expect(tools.map((item) => item.name)).toEqual([
      'roster',
      'delegate',
      'collect',
      'cancel',
      'merge',
      'reschedule',
    ])
  })

  it('extends the delegate schema while preserving its base constraints and required fields', () => {
    const { tool, definitions } = setup()
    const schema = z
      .object({
        properties: z.object({
          tasks: z.object({
            minItems: z.number(),
            maxItems: z.number(),
            items: z.object({
              type: z.string(),
              additionalProperties: z.boolean(),
              required: z.array(z.string()),
              properties: z.record(z.string(), z.unknown()),
            }),
          }),
        }),
        required: z.array(z.string()),
      })
      .parse(tool('delegate').inputSchema)
    expect(schema.properties.tasks).toMatchObject({
      minItems: 1,
      maxItems: 6,
      items: { type: 'object', additionalProperties: false, required: ['role', 'brief', 'reason'] },
    })
    expect(schema.required).toEqual(['tasks', 'command_id'])
    expect(Object.keys(schema.properties.tasks.items.properties)).toEqual([
      'role',
      'brief',
      'reason',
      'key',
      'depends_on',
      'priority',
      'size',
      'writes',
      'overlap',
    ])
    expect(definitions.delegate.inputSchema.properties.tasks.items.properties).toEqual({
      role: { type: 'string' },
      brief: { type: 'string' },
      reason: { type: 'object' },
    })
  })

  it('preserves report paging and base headroom data with the current live board at the tail', async () => {
    const { tool, calls, board } = setup()
    board.submit([submission('a')], 0)
    const input = { task_ids: ['a'], part: 'transcript', offset: 16_000, wait_seconds: 0 }
    const answer = JSON.parse(await tool('collect').call(input, signal))
    expect(calls.collect).toHaveBeenCalledWith(input, signal)
    expect(answer).toMatchObject({
      kind: 'data',
      result: 'report page',
      scheduler: { board: { tasks: [{ id: 'a', state: 'ready' }] } },
    })
    expect(JSON.parse(await tool('roster').call({}, signal))).toMatchObject({
      result: 'headroom and daily budget',
    })
  })
})
