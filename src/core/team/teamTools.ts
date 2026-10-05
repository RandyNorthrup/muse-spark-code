// M96c lane T2 composes with M96's five tools. Their admission, consent,
// idempotency and worker lifecycle remain in the injected M96 runtime.
import * as z from 'zod/mini'
import { TEAM_MODEL_TEXT } from '../../shared/constants'
import {
  teamMergeOptionsSchema,
  teamRescheduleSchema,
  teamSchedulerFieldsSchema,
} from '../../shared/team'
import type { McpTool } from '../mcp'
import { schedulerToolAnswer, type SchedulerRosterSource } from './roster'

/** The base delegate must validate the whole batch and submit it to the board
 * before dispatch. In particular, dry runs and command-id retries must not
 * submit another batch, and a refused edge must start no worker. */
export interface TeamBaseTools {
  roster: McpTool
  delegate: McpTool
  collect: McpTool
  cancel: McpTool
  merge: McpTool
}

/** Lane Q performs review/mode admission at enqueue and keeps landing's card
 * as the approval point. Enqueue never invokes the former immediate merge. */
export interface TeamMergeEnqueue {
  enqueue(
    options: z.infer<typeof teamMergeOptionsSchema>,
    signal: AbortSignal,
  ): Promise<{ task_id: string; position: number }>
}

/** S/X2 can journal the change before acknowledging it. This capability only
 * changes the board; it must not dispatch workers or buy a model request. */
export interface TeamRescheduleBoard {
  reschedule(input: z.infer<typeof teamRescheduleSchema>, at: number): void | Promise<void>
}

const delegateInputSchema = z.object({
  tasks: z.array(z.looseObject(teamSchedulerFieldsSchema.shape)).check(z.minLength(1)),
})
const delegateDefinitionSchema = z.looseObject({
  properties: z.looseObject({
    tasks: z.looseObject({
      items: z.looseObject({ properties: z.record(z.string(), z.unknown()) }),
    }),
  }),
})
const enqueueResultSchema = z.strictObject({
  task_id: teamMergeOptionsSchema.shape.task_id,
  position: z.int().check(z.gte(1)),
})

/** Keep the M96 envelope and task fields, adding only scheduler properties.
 * Base validation is still required by the injected delegate implementation. */
function delegateInput(args: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { tasks } = delegateInputSchema.parse(args)
  return { ...args, tasks }
}

function delegateDefinition(base: McpTool): McpTool['inputSchema'] {
  const parsed = delegateDefinitionSchema.parse(base.inputSchema)
  const tasks = parsed.properties.tasks
  const fields = z.toJSONSchema(teamSchedulerFieldsSchema, { io: 'input' })
  return {
    ...base.inputSchema,
    properties: {
      ...parsed.properties,
      tasks: {
        ...tasks,
        items: {
          ...tasks.items,
          properties: { ...tasks.items.properties, ...fields.properties },
        },
      },
    },
  }
}

/** Construct once per conversation. No provider probe or worker start occurs
 * here. X2 supplies the conversation's frozen base declarations and journalled
 * board; single-model conversations never call this factory. */
export function createSchedulerTeamTools(
  base: TeamBaseTools,
  board: TeamRescheduleBoard,
  queue: TeamMergeEnqueue,
  source: SchedulerRosterSource,
  now: () => number,
): readonly McpTool[] {
  const withLiveAnswer = (tool: McpTool): McpTool => ({
    ...structuredClone({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations !== undefined && { annotations: tool.annotations }),
    }),
    call: async (args, signal) => schedulerToolAnswer(await tool.call(args, signal), source),
  })
  const delegate = withLiveAnswer({
    ...base.delegate,
    inputSchema: delegateDefinition(base.delegate),
    call: async (args, signal) => await base.delegate.call(delegateInput(args), signal),
  })
  const merge: McpTool = {
    ...structuredClone({
      name: base.merge.name,
      description: base.merge.description,
      ...(base.merge.annotations !== undefined && { annotations: base.merge.annotations }),
    }),
    inputSchema: z.toJSONSchema(teamMergeOptionsSchema, { io: 'input' }),
    call: async (args, signal) => {
      const options = teamMergeOptionsSchema.parse(args)
      const result = enqueueResultSchema.parse(await queue.enqueue(options, signal))
      if (result.task_id !== options.task_id) throw new Error('enqueueTaskMismatch')
      return JSON.stringify(result)
    },
  }
  const reschedule: McpTool = {
    name: 'reschedule',
    description: TEAM_MODEL_TEXT.reschedule,
    inputSchema: z.toJSONSchema(teamRescheduleSchema, { io: 'input' }),
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    call: async (args, _signal) => {
      const change = await teamRescheduleSchema.parseAsync(args)
      // Only mutate the board. Do not wake dispatch, request approval or call
      // the pool: a later scheduler event/sweep may use the revised order.
      await board.reschedule(change, now())
      return schedulerToolAnswer(undefined, source)
    },
  }
  return [
    withLiveAnswer(base.roster),
    delegate,
    withLiveAnswer(base.collect),
    {
      ...base.cancel,
      inputSchema: structuredClone(base.cancel.inputSchema),
      ...(base.cancel.annotations !== undefined && {
        annotations: structuredClone(base.cancel.annotations),
      }),
    },
    merge,
    reschedule,
  ]
}
