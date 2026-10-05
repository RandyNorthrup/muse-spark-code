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
// LANE-T-SEAM (lane 0): the English descriptions relocate into
// `TEAM_MODEL_TEXT` in `src/shared/constants.ts` at integration.

import * as z from 'zod/mini'
import type { McpTool } from '../mcp'
import type { TeamToolResult } from './teamSeams'
import {
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
} from './teamConstants'

/** The five tool names, in declaration order. */
export const TEAM_TOOL_NAMES = ['roster', 'delegate', 'collect', 'cancel', 'merge'] as const
export type TeamToolName = (typeof TEAM_TOOL_NAMES)[number]

/** What a delegating worker gets: the four that never merge. */
export const TEAM_WORKER_TOOL_NAMES = ['roster', 'delegate', 'collect', 'cancel'] as const

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
      description: 'The role to run, e.g. engineering',
    },
    brief: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_BRIEF_MAX_CHARS,
      description:
        'The whole task for a worker that has not seen this conversation: goal, context, files, constraints, done criteria',
    },
    reason: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [...TEAM_REASON_CODES],
          description: 'Why this is delegated: one of the rubric codes',
        },
        detail: {
          type: 'string',
          minLength: 1,
          maxLength: TEAM_REASON_MAX_CHARS,
          description: 'The reason in one sentence',
        },
      },
      required: ['code', 'detail'],
    },
    files: {
      type: 'array',
      maxItems: TEAM_FILES_MAX,
      items: { type: 'string', minLength: 1, maxLength: TEAM_PATH_MAX_CHARS },
      description: 'Workspace paths the worker is pointed at',
    },
    entry: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
      description: 'One pool entry to use, only if it has headroom',
    },
    continue: {
      type: 'string',
      minLength: 1,
      maxLength: TEAM_IDENTIFIER_MAX_CHARS,
      description: 'A finished task id to reopen with a follow-up on its own branch',
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
      description: 'The work you keep for yourself',
    },
    reason: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [...TEAM_REASON_CODES],
          description: 'Why you keep it: one of the rubric codes',
        },
        detail: {
          type: 'string',
          minLength: 1,
          maxLength: TEAM_REASON_MAX_CHARS,
          description: 'The reason in one sentence',
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
    description:
      'Show the team as it is now: each role with its pool and headroom, the queue, the budget left today and finished tasks not yet merged. Call it once before delegating.',
    properties: {},
    required: [],
    annotations: { readOnlyHint: true },
  },
  delegate: {
    description: `Start one to ${String(TEAM_DELEGATE_MAX)} tasks behind one approval and answer at once with each task's id, entry, state and ceilings. A retry with the same command_id and the same tasks starts nothing new. dry_run plans without starting or spending anything.`,
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
        description: 'The work you keep for yourself, so the user sees the whole plan',
      },
      command_id: {
        type: 'string',
        minLength: 1,
        maxLength: TEAM_IDENTIFIER_MAX_CHARS,
        description:
          'Optional request id; a retry with the same id and tasks reuses the tasks already started',
      },
      pipeline: {
        type: 'string',
        minLength: 1,
        maxLength: TEAM_IDENTIFIER_MAX_CHARS,
        description: 'The configured pipeline to run',
      },
      dry_run: {
        type: 'boolean',
        description: 'Answer the plan without starting or spending anything',
      },
    },
    required: ['tasks'],
  },
  collect: {
    description: `Return the reports that are ready, with the tasks still running and their time and consumption. Waits at most wait_seconds. Page a large part with part and offset.`,
    properties: {
      task_ids: {
        type: 'array',
        maxItems: TEAM_TASK_IDS_MAX,
        items: { type: 'string', minLength: 1, maxLength: TEAM_IDENTIFIER_MAX_CHARS },
      },
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        description: `Seconds to wait for reports, at most ${String(TEAM_COLLECT_WAIT_MAX_SECONDS)}`,
      },
      part: { type: 'string', enum: ['report', 'diff', 'transcript'] },
      offset: { type: 'integer', minimum: 0 },
    },
    required: [],
    annotations: { readOnlyHint: true },
  },
  cancel: {
    description:
      'Stop running tasks, or discard finished ones: their working copies and branches are removed.',
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
    description:
      'Bring a finished, reviewed task change into the working branch as uncommitted changes: the only path from a worker branch to the user. Asks the user before writing.',
    properties: {
      task_id: { type: 'string', minLength: 1, maxLength: TEAM_IDENTIFIER_MAX_CHARS },
      on_conflict: {
        type: 'string',
        enum: ['markers', 'rework'],
        description:
          'markers writes conflict markers; rework sends the conflict back to the task branch',
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
      call: () => Promise.reject(new Error(`team tool ${name} is answered by the host`)),
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
    : { ok: false, reason: `invalid arguments: ${z.prettifyError(result.error)}` }
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
        throw new Error('command_id was already used for different tasks')
      const result = await pending.result
      return { output: result.output, visibleOutput: '' }
    }
    const claim = this.claim(commandId, fingerprint)
    if (claim.kind === 'refused') throw new Error('command_id was already used for different tasks')
    if (claim.kind === 'uncertain') throw new Error(claim.reason)
    if (claim.kind === 'replay') return { output: claim.answer, visibleOutput: '' }
    // Claim before invoking the runner. This refusal remains durable even
    // when its start throws, is interrupted, or never returns an answer.
    this.complete(commandId, {
      tasksFingerprint: fingerprint,
      state: 'uncertain',
      answer:
        'Error: command_id has an uncertain delegation outcome; inspect its tasks before issuing a new command_id.',
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
  return 'Only one model is ready: the team applies from a new conversation. Do the work yourself or ask the user.'
}

/** The team runner lanes A/W/I supply has not loaded: an explicit error, never an empty success. */
export function teamRunnerMissing(tool: string): string {
  return `Error: ${tool} is unavailable: the team runner is not loaded in this window.`
}

/** A team tool called where the conversation never declared it. */
export function teamToolNotDeclared(tool: string): string {
  return `Error: unknown tool ${tool}`
}

/**
 * An orchestrator writing tool called while an `in-place` worker task runs:
 * edits, `rename_symbol`, the shell, `then_run` and `merge` wait (D75). The
 * transcript's visible line is `UI_TEXT.teamInPlaceOrchestratorRefused`.
 */
export function inPlaceRefusal(): string {
  return 'A worker is writing in place: edits, rename_symbol, the shell, then_run and merge wait until its task ends.'
}
