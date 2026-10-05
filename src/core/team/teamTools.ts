import { TEAM_MODEL_TEXT, TEAM_BOOTSTRAP_MODEL_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
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
import type { McpTool } from '../mcp'
import type { TeamToolResult } from './teamSeams'
import {
  TEAM_COLLECT_WAIT_MAX_SECONDS,
  TEAM_DELEGATE_MAX,
  TEAM_BRIEF_MAX_CHARS,
  TEAM_REASON_CODES,
  TEAM_TOOL_NAMES,
  TEAM_DELEGATE_TOOLS,
} from '../../shared/constants'

/** The five tool names, in declaration order. */
export { TEAM_TOOL_NAMES } from '../../shared/constants'
export type TeamToolName = (typeof TEAM_TOOL_NAMES)[number]

/** What a delegating worker gets: the four that never merge. */
export const TEAM_WORKER_TOOL_NAMES = TEAM_DELEGATE_TOOLS.filter(isTeamTool)

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
    role: { type: 'string', description: TEAM_MODEL_TEXT.toolTheRoleToRunEG },
    brief: {
      type: 'string',
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
        detail: { type: 'string', description: TEAM_MODEL_TEXT.toolTheReasonInOneSentence },
      },
      required: ['code', 'detail'],
    },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: TEAM_MODEL_TEXT.toolWorkspacePathsTheWorkerIsPointed,
    },
    entry: { type: 'string', description: TEAM_MODEL_TEXT.toolOnePoolEntryToUseOnly },
    continue: {
      type: 'string',
      description: TEAM_MODEL_TEXT.toolAFinishedTaskIdToReopen,
    },
  },
  required: ['role', 'brief', 'reason'],
} as const

const PLAN_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    what: { type: 'string', description: TEAM_MODEL_TEXT.toolTheWorkYouKeepForYourself },
    reason: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [...TEAM_REASON_CODES],
          description: TEAM_MODEL_TEXT.toolWhyYouKeepItOneOf,
        },
        detail: { type: 'string', description: TEAM_MODEL_TEXT.toolTheReasonInOneSentence2 },
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
        items: PLAN_ITEM_SCHEMA,
        description: TEAM_MODEL_TEXT.toolTheWorkYouKeepForYourself2,
      },
      command_id: {
        type: 'string',
        description: TEAM_MODEL_TEXT.toolOptionalRequestIdARetryWith,
      },
      pipeline: { type: 'string', description: TEAM_MODEL_TEXT.toolTheConfiguredPipelineToRun },
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
      task_ids: { type: 'array', items: { type: 'string' } },
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
      task_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
    },
    required: ['task_ids'],
  },
  merge: {
    description: TEAM_MODEL_TEXT.toolBringAFinishedReviewedTaskChange,
    properties: {
      task_id: { type: 'string' },
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

const reasonSchema = z.object({
  code: z.enum(TEAM_REASON_CODES),
  detail: z.string().check(z.trim(), z.minLength(1)),
})

export const rosterArgs = z.object({})

export const delegateArgs = z.object({
  tasks: z
    .array(
      z.object({
        role: z.string().check(z.trim(), z.minLength(1)),
        brief: z.string().check(z.trim(), z.minLength(1), z.maxLength(TEAM_BRIEF_MAX_CHARS)),
        reason: reasonSchema,
        files: z.optional(z.array(z.string())),
        entry: z.optional(z.string().check(z.trim(), z.minLength(1))),
        continue: z.optional(z.string().check(z.trim(), z.minLength(1))),
      }),
    )
    .check(z.minLength(1), z.maxLength(TEAM_DELEGATE_MAX)),
  plan: z.optional(
    z.array(
      z.object({
        what: z.string().check(z.trim(), z.minLength(1)),
        reason: reasonSchema,
      }),
    ),
  ),
  command_id: z.optional(z.string().check(z.trim(), z.minLength(1))),
  pipeline: z.optional(z.string().check(z.trim(), z.minLength(1))),
  dry_run: z.optional(z.boolean()),
})
export type DelegateArgs = z.infer<typeof delegateArgs>

export const collectArgs = z.object({
  task_ids: z.optional(z.array(z.string())),
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
  task_ids: z.array(z.string().check(z.trim(), z.minLength(1))).check(z.minLength(1)),
})

export const mergeArgs = z.object({
  task_id: z.string().check(z.trim(), z.minLength(1)),
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
  private readonly pending = new Map<
    string,
    { fingerprint: string; result: Promise<TeamToolResult> }
  >()

  /** Concurrent retries share the first call, before its answer is recorded. */
  public async run(
    commandId: string | undefined,
    tasks: readonly unknown[],
    start: () => Promise<TeamToolResult>,
  ): Promise<TeamToolResult> {
    const fingerprint = fingerprintDelegateTasks(tasks)
    const claim = this.claim(commandId, fingerprint)
    if (claim.kind === 'refused') throw new Error(TEAM_MODEL_TEXT.toolCommandIdWasAlreadyUsedFor)
    if (claim.kind === 'replay') return { output: claim.answer, visibleOutput: '' }
    if (commandId === undefined) return await start()
    const pending = this.pending.get(commandId)
    if (pending !== undefined) {
      if (pending.fingerprint !== fingerprint)
        throw new Error(TEAM_MODEL_TEXT.toolCommandIdWasAlreadyUsedFor2)
      const result = await pending.result
      return { output: result.output, visibleOutput: '' }
    }
    const run = async (): Promise<TeamToolResult> => await start()
    const result = run()
    this.pending.set(commandId, { fingerprint, result })
    try {
      const answer = await result
      this.complete(commandId, { tasksFingerprint: fingerprint, answer: answer.output })
      return answer
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
    | { readonly kind: 'refused' } {
    if (commandId === undefined) {
      return { kind: 'claimed' }
    }
    const record = this.records.get(commandId)
    if (record === undefined) {
      return { kind: 'claimed' }
    }
    return record.tasksFingerprint === tasksFingerprint
      ? { kind: 'replay', answer: record.answer }
      : { kind: 'refused' }
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
