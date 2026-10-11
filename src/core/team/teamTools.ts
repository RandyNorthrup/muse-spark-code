import {
  TEAM_MODEL_TEXT,
  TEAM_BOOTSTRAP_MODEL_TEXT,
  TEAM_COLLECT_WAIT_MAX_SECONDS,
  TEAM_DELEGATE_MAX,
  TEAM_BRIEF_MAX_CHARS,
  TEAM_REASON_CODES,
  TEAM_IDENTIFIER_MAX_CHARS,
  TEAM_REASON_MAX_CHARS,
  TEAM_PLAN_ITEM_MAX_CHARS,
  TEAM_PATH_MAX_CHARS,
  TEAM_FILES_MAX,
  TEAM_PLAN_ITEMS_MAX,
  TEAM_TASK_IDS_MAX,
  TEAM_TOOL_NAMES,
  TEAM_DELEGATE_TOOLS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type McpTool } from '../mcp'
import { type TeamToolResult } from './teamSeams'
import {
  teamMergeOptionsSchema,
  teamRescheduleSchema,
  teamSchedulerFieldsSchema,
} from '../../shared/team'
import { schedulerToolAnswer, type SchedulerRosterSource } from './roster'
// The orchestrator's five tools on both backends (PLAN.md M96 lane T, D75
// "The orchestrator's tools"): `roster`, `delegate`, `collect`, `cancel`
// and `merge` (`reschedule` is M96c's, not this lane's).
//
// - On the Model API they are declared as function tools, replacing M48's
//   six `subagent_*` tools in a team conversation.
// - On Muse Code they are the `team` MCP server's tools (`mcp__team__*`).
// - A worker whose role names `delegates` gets `roster`, `delegate`,
//   `collect` and `cancel`, never `merge`: its sub-tasks' changes are merged
//   by the orchestrator.
//
// The JSON Schemas below are the one definition both backends declare, so
// the `team` server's tool list stays byte-identical across sessions and
// team edits. Descriptions never name a role, so they never change.

import * as z from 'zod/mini'
import teamToolSchemas from '../../shared/teamToolSchemas.json'

/** The five tool names, in declaration order. */
export { TEAM_TOOL_NAMES } from '../../shared/constants'
export type TeamToolName = (typeof TEAM_TOOL_NAMES)[number]

/** What a delegating worker gets: the four that never merge. */
export const TEAM_WORKER_TOOL_NAMES: readonly TeamToolName[] =
  TEAM_DELEGATE_TOOLS.filter(isTeamTool)

/** Whether a tool is one of the five. */
export function isTeamTool(name: string): name is TeamToolName {
  const names: readonly string[] = TEAM_TOOL_NAMES
  return names.includes(name)
}

/**
 * The tools a worker session is offered: none, unless its role names
 * `delegates`, and then the four without `merge`.
 */
export function teamToolsForWorker(
  delegatesTo: readonly string[] | undefined,
): readonly TeamToolName[] {
  return delegatesTo === undefined || delegatesTo.length === 0 ? [] : [...TEAM_WORKER_TOOL_NAMES]
}

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    role: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
      description: TEAM_MODEL_TEXT.toolTheRoleToRunEG,
    },
    brief: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_BRIEF_MAX_CHARS,
      description: TEAM_MODEL_TEXT.toolTheWholeTaskForAWorker,
    },
    reason: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [...TEAM_REASON_CODES],
          description: TEAM_MODEL_TEXT.toolWhyThisIsDelegatedOneOf,
        },
        detail: {
          type: 'string',
          minLength: 1,
          maxLength: TEAM_REASON_MAX_CHARS,
          description: TEAM_MODEL_TEXT.toolTheReasonInOneSentence2,
        },
      },
      required: ['code', 'detail'],
    },
    files: {
      type: 'array',
      maxItems: TEAM_FILES_MAX,
      items: { type: 'string', minLength: 1, maxLength: TEAM_PATH_MAX_CHARS },
      description: TEAM_MODEL_TEXT.toolWorkspacePathsTheWorkerIsPointed,
    },
    entry: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
      description: TEAM_MODEL_TEXT.toolOnePoolEntryToUseOnly,
    },
    continue: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
      description: TEAM_MODEL_TEXT.toolAFinishedTaskIdToReopen,
    },
  },
  required: ['role', 'brief', 'reason'],
} as const

const PLAN_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    what: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_PLAN_ITEM_MAX_CHARS,
      description: TEAM_MODEL_TEXT.toolTheWorkYouKeepForYourself,
    },
    reason: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [...TEAM_REASON_CODES],
          description: TEAM_MODEL_TEXT.toolWhyYouKeepItOneOf,
        },
        detail: {
          type: 'string',
          minLength: 1,
          maxLength: TEAM_REASON_MAX_CHARS,
          description: TEAM_MODEL_TEXT.toolTheReasonInOneSentence2,
        },
      },
      required: ['code', 'detail'],
    },
  },
  required: ['what', 'reason'],
} as const

export interface TeamToolSchema {
  readonly description: string
  readonly properties: Record<string, unknown>
  readonly required: readonly string[]
  /** MCP behaviour hints; `readOnlyHint` tools never change anything. */
  readonly annotations?: Record<string, unknown>
}

/** The one definition both backends declare. */
export const TEAM_TOOL_SCHEMAS: Record<TeamToolName, TeamToolSchema> = {
  roster: {
    description: TEAM_MODEL_TEXT.toolShowTheTeamAsItIs,
    properties: {},
    required: [],
    annotations: { readOnlyHint: true },
  },
  delegate: {
    description: fill(TEAM_MODEL_TEXT.toolStartOneToTasksBehindOne, {
      value1: String(TEAM_DELEGATE_MAX),
    }),
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: TEAM_DELEGATE_MAX,
        items: TASK_SCHEMA,
      },
      plan: {
        type: 'array',
        maxItems: TEAM_PLAN_ITEMS_MAX,
        items: PLAN_ITEM_SCHEMA,
        description: TEAM_MODEL_TEXT.toolTheWorkYouKeepForYourself2,
      },
      command_id: {
        type: 'string',
        minLength: 1,
        maxLength: TEAM_IDENTIFIER_MAX_CHARS,
        description: TEAM_MODEL_TEXT.toolOptionalRequestIdARetryWith,
      },
      pipeline: {
        type: 'string',
        minLength: 1,
        maxLength: TEAM_IDENTIFIER_MAX_CHARS,
        description: TEAM_MODEL_TEXT.toolTheConfiguredPipelineToRun,
      },
      dry_run: {
        type: 'boolean',
        description: TEAM_MODEL_TEXT.toolAnswerThePlanWithoutStartingOr,
      },
    },
    required: ['tasks'],
  },
  collect: {
    description: TEAM_MODEL_TEXT.toolReturnTheReportsThatAreReady,
    properties: {
      task_ids: {
        type: 'array',
        maxItems: TEAM_TASK_IDS_MAX,
        items: { type: 'string', minLength: 1, maxLength: TEAM_IDENTIFIER_MAX_CHARS },
      },
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        description: fill(TEAM_MODEL_TEXT.toolSecondsToWaitForReportsAt, {
          value1: String(TEAM_COLLECT_WAIT_MAX_SECONDS),
        }),
      },
      part: { type: 'string', enum: ['report', 'diff', 'transcript'] },
      offset: { type: 'integer', minimum: 0 },
    },
    required: [],
    annotations: { readOnlyHint: true },
  },
  cancel: {
    description: TEAM_MODEL_TEXT.toolStopRunningTasksOrDiscardFinished,
    properties: {
      task_ids: {
        type: 'array',
        minItems: 1,
        maxItems: TEAM_TASK_IDS_MAX,
        items: { type: 'string', minLength: 1, maxLength: TEAM_IDENTIFIER_MAX_CHARS },
      },
    },
    required: ['task_ids'],
  },
  merge: {
    description: TEAM_MODEL_TEXT.toolBringAFinishedReviewedTaskChange,
    properties: {
      task_id: { type: 'string', minLength: 1, maxLength: TEAM_IDENTIFIER_MAX_CHARS },
      on_conflict: {
        type: 'string',
        enum: ['markers', 'rework'],
        description: TEAM_MODEL_TEXT.toolMarkersWritesConflictMarkersReworkSends,
      },
    },
    required: ['task_id'],
  },
}

/**
 * The Model API declaration, in `SUBAGENT_TOOL_DEFINITIONS` shape: name,
 * description, properties and required, in declaration order.
 */
export const TEAM_TOOL_DEFINITIONS: readonly {
  readonly name: string
  readonly description: string
  readonly properties: Record<string, unknown>
  readonly required: readonly string[]
}[] = TEAM_TOOL_NAMES.map((name) => ({
  name,
  description: TEAM_TOOL_SCHEMAS[name].description,
  properties: TEAM_TOOL_SCHEMAS[name].properties,
  required: TEAM_TOOL_SCHEMAS[name].required,
}))

/** The `team` MCP server's tool list, byte-identical across sessions and team edits. */
export function teamMcpToolList(): readonly McpTool[] {
  return TEAM_TOOL_NAMES.map((name) => {
    const schema = TEAM_TOOL_SCHEMAS[name]
    return {
      name,
      description: schema.description,
      inputSchema: {
        type: 'object',
        properties: schema.properties,
        ...(schema.required.length > 0 && { required: [...schema.required] }),
      },
      ...(schema.annotations !== undefined && { annotations: { ...schema.annotations } }),
      // The host routes the call; this list only describes.
      call: () =>
        Promise.reject(
          new Error(fill(TEAM_MODEL_TEXT.toolTeamToolIsAnsweredByThe, { value1: name })),
        ),
    }
  })
}

// --- argument schemas (validated before anything runs) ---

const identifierSchema = z
  .string()
  .check(z.maxLength(TEAM_IDENTIFIER_MAX_CHARS), z.trim(), z.minLength(1))
const pathSchema = z.string().check(z.maxLength(TEAM_PATH_MAX_CHARS), z.trim(), z.minLength(1))
const taskIdsSchema = z.array(identifierSchema).check(z.maxLength(TEAM_TASK_IDS_MAX))

const reasonSchema = z.object({
  code: z.enum(TEAM_REASON_CODES),
  detail: z.string().check(z.maxLength(TEAM_REASON_MAX_CHARS), z.trim(), z.minLength(1)),
})

export const rosterArgs = z.object({})

export const delegateArgs = z.object({
  tasks: z
    .array(
      z.object({
        role: identifierSchema,
        brief: z.string().check(z.maxLength(TEAM_BRIEF_MAX_CHARS), z.trim(), z.minLength(1)),
        reason: reasonSchema,
        files: z.optional(z.array(pathSchema).check(z.maxLength(TEAM_FILES_MAX))),
        entry: z.optional(identifierSchema),
        continue: z.optional(identifierSchema),
      }),
    )
    .check(z.minLength(1), z.maxLength(TEAM_DELEGATE_MAX)),
  plan: z.optional(
    z
      .array(
        z.object({
          what: z.string().check(z.maxLength(TEAM_PLAN_ITEM_MAX_CHARS), z.trim(), z.minLength(1)),
          reason: reasonSchema,
        }),
      )
      .check(z.maxLength(TEAM_PLAN_ITEMS_MAX)),
  ),
  command_id: z.optional(identifierSchema),
  pipeline: z.optional(identifierSchema),
  dry_run: z.optional(z.boolean()),
})
export type DelegateArgs = z.infer<typeof delegateArgs>

export const collectArgs = z.object({
  task_ids: z.optional(taskIdsSchema),
  wait_seconds: z.optional(z.int().check(z.nonnegative())),
  part: z.optional(z.enum(['report', 'diff', 'transcript'])),
  offset: z.optional(z.int().check(z.nonnegative())),
})

/**
 * `wait_seconds` within the backend's bound: a larger wait is clamped, never
 * refused, so `collect` waits no longer than its bound (M96 acceptance 13).
 */
export function clampCollectWait(waitSeconds: number | undefined): number | undefined {
  return waitSeconds === undefined
    ? undefined
    : Math.min(waitSeconds, TEAM_COLLECT_WAIT_MAX_SECONDS)
}

export const cancelArgs = z.object({
  task_ids: taskIdsSchema.check(z.minLength(1)),
})

export const mergeArgs = z.object({
  task_id: identifierSchema,
  on_conflict: z.optional(z.enum(['markers', 'rework'])),
})

const TEAM_ARG_SCHEMAS = {
  roster: rosterArgs,
  delegate: delegateArgs,
  collect: collectArgs,
  cancel: cancelArgs,
  merge: mergeArgs,
} as const

/** Validates one team tool's arguments before anything runs. */
export function parseTeamArgs(
  name: TeamToolName,
  args: unknown,
):
  | { readonly ok: true; readonly args: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string } {
  const result = TEAM_ARG_SCHEMAS[name].safeParse(args)
  return result.success
    ? { ok: true, args: result.data }
    : {
        ok: false,
        reason: fill(TEAM_MODEL_TEXT.toolInvalidArguments, {
          value1: z.prettifyError(result.error),
        }),
      }
}

// --- `command_id`: a retry is safe ---

/** A claimed `command_id` and what its call started, kept with the conversation. */
export interface TeamCommandRecord {
  /** Stable fingerprint of the tasks the call started. */
  readonly tasksFingerprint: string
  /** The runner's answer, replayed byte for byte on a retried call. */
  readonly answer: string
  /** A persisted start claim whose final outcome has not been reconciled. */
  readonly state?: 'uncertain' | undefined
}

/** Conversation storage shared by the engine and the Muse Code binding. */
export const teamCommandRecordsSchema = z.record(
  z.string(),
  z.object({
    tasksFingerprint: z.string(),
    answer: z.string(),
    state: z.optional(z.literal('uncertain')),
  }),
)

export interface TeamCommandStore {
  /** The persisted conversation's records, validated before restoring. */
  readonly load: () => unknown
  /** Resolves only when this exact claim/answer is durable. */
  readonly save: (records: Readonly<Record<string, TeamCommandRecord>>) => Promise<void>
}

/** Stable fingerprint of a `delegate` call's tasks: key order cannot change it. */
export function fingerprintDelegateTasks(tasks: readonly unknown[]): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item: unknown) => sorted(item))
    return typeof value !== 'object' || value === null
      ? value
      : Object.fromEntries(
          Object.entries(value)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, sorted(entry)]),
        )
  }
  return JSON.stringify(sorted(tasks))
}

/**
 * `command_id` claims, kept with the conversation (and restored from it on
 * resume). The same id with the same tasks replays the recorded answer; the
 * same id with other tasks is refused whole: without the id a dropped answer
 * would start the work twice (MCP 2026-07-28).
 */
export class TeamCommandRegistry {
  private readonly records = new Map<string, TeamCommandRecord>()
  private saving: Promise<void> = Promise.resolve()
  private readonly pending = new Map<
    string,
    { fingerprint: string; result: Promise<TeamToolResult> }
  >()

  public constructor(
    private readonly persist?: (
      records: Readonly<Record<string, TeamCommandRecord>>,
    ) => Promise<void>,
  ) {}

  /** Serialize snapshots so an earlier slow save cannot erase a later claim. */
  private async saveRecords(): Promise<void> {
    const snapshot = this.snapshot()
    const previous = this.saving
    const save = async (): Promise<void> => {
      try {
        await previous
      } catch {
        // Its caller already received that failure; later claims still save.
      }
      await this.persist?.(snapshot)
    }
    this.saving = save()
    await this.saving
  }

  /** Concurrent retries share the first call, before its answer is recorded. */
  public async run(
    commandId: string | undefined,
    tasks: readonly unknown[],
    start: () => Promise<TeamToolResult>,
  ): Promise<TeamToolResult> {
    if (commandId === undefined) return await start()
    const fingerprint = fingerprintDelegateTasks(tasks)
    const pending = this.pending.get(commandId)
    if (pending !== undefined) {
      if (pending.fingerprint !== fingerprint)
        throw new Error(TEAM_MODEL_TEXT.toolCommandIdWasAlreadyUsedFor2)
      const result = await pending.result
      return { output: result.output, visibleOutput: '' }
    }
    const claim = this.claim(commandId, fingerprint)
    if (claim.kind === 'refused') throw new Error(TEAM_MODEL_TEXT.toolCommandIdWasAlreadyUsedFor2)
    if (claim.kind === 'uncertain') throw new Error(claim.reason)
    if (claim.kind === 'replay') return { output: claim.answer, visibleOutput: '' }
    // Claim before invoking the runner. This refusal remains durable even
    // when its start throws, is interrupted, or never returns an answer.
    this.complete(commandId, {
      tasksFingerprint: fingerprint,
      state: 'uncertain',
      answer: TEAM_MODEL_TEXT.toolUncertainDelegation,
    })
    const run = async (): Promise<TeamToolResult> => {
      await this.saveRecords()
      const answer = await start()
      this.records.set(commandId, { tasksFingerprint: fingerprint, answer: answer.output })
      await this.saveRecords()
      return answer
    }
    // run waits for persistence before the runner can reenter this registry.
    const result = run()
    this.pending.set(commandId, { fingerprint, result })
    try {
      return await result
    } finally {
      this.pending.delete(commandId)
    }
  }

  public restore(records: Readonly<Record<string, TeamCommandRecord>>): void {
    for (const [commandId, record] of Object.entries(records)) {
      this.records.set(commandId, record)
    }
  }

  public snapshot(): Record<string, TeamCommandRecord> {
    return Object.fromEntries(this.records)
  }

  public claim(
    commandId: string | undefined,
    tasksFingerprint: string,
  ):
    | { readonly kind: 'claimed' }
    | { readonly kind: 'replay'; readonly answer: string }
    | { readonly kind: 'refused' }
    | { readonly kind: 'uncertain'; readonly reason: string } {
    if (commandId === undefined) {
      return { kind: 'claimed' }
    }
    const record = this.records.get(commandId)
    if (record === undefined) {
      return { kind: 'claimed' }
    }
    if (record.tasksFingerprint !== tasksFingerprint) return { kind: 'refused' }
    return record.state === 'uncertain'
      ? { kind: 'uncertain', reason: record.answer }
      : { kind: 'replay', answer: record.answer }
  }

  public complete(commandId: string | undefined, answer: TeamCommandRecord): void {
    if (commandId !== undefined && !this.records.has(commandId)) {
      this.records.set(commandId, answer)
    }
  }
}

// --- refusal texts (model-facing English; LANE-T-SEAM: lane 0's TEAM_MODEL_TEXT) ---

/** A team conversation whose last ready distinct entry went away keeps its tools; from the next turn `delegate` is refused at call admission. */
export function singleModelAgainRefusal(): string {
  return TEAM_MODEL_TEXT.toolOnlyOneModelIsReadyThe
}

/** The team runner lanes A/W/I supply has not loaded: an explicit error, never an empty success. */
export function teamRunnerMissing(tool: string): string {
  return fill(TEAM_MODEL_TEXT.toolErrorIsUnavailableTheTeamRunner, { value1: tool })
}

/** A team tool called where the conversation never declared it. */
export function teamToolNotDeclared(tool: string): string {
  return fill(TEAM_BOOTSTRAP_MODEL_TEXT.undeclaredTool, { tool })
}

// M96c lane T2 composes with M96's five tools. Their admission, consent,
// idempotency and worker lifecycle remain in the injected M96 runtime.

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
  const fields = teamToolSchemas.teamSchedulerFieldsSchema
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
    inputSchema: structuredClone(teamToolSchemas.teamMergeOptionsSchema),
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
    inputSchema: structuredClone(teamToolSchemas.teamRescheduleSchema),
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    call: async (args, signal) => {
      signal.throwIfAborted()
      const change = await teamRescheduleSchema.parseAsync(args)
      signal.throwIfAborted()
      // Only mutate the board. Do not wake dispatch, request approval or call
      // the pool: a later scheduler event/sweep may use the revised order.
      await board.reschedule(change, now())
      signal.throwIfAborted()
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
