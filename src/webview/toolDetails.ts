// What the rows of Muse Code's own tools show, read from their arguments and
// results (M43, PLAN.md D36). Pure; every shape here was captured live from
// Muse Code 1.3.0 on 2026-09-25 (docs/certification/m43.md): the memory,
// goal, schedule, web search and background-work tools answer in JSON, which
// the generic row showed raw.

import * as z from 'zod/mini'
import { webResultSchema } from '../shared/webResults'

/** Muse Code's memory scopes (`add_memory` and its siblings, `scope`). */
export const MEMORY_SCOPES = ['personal_project', 'project', 'personal'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

/** One memory call: where the note lives and what it says or became. */
export interface MemoryDetails {
  readonly scope: MemoryScope | undefined
  readonly path: string | undefined
  /** `add_memory`: the text added; `read_memory`: the text read back. */
  readonly note: string | undefined
  /** `edit_memory`: the exact text replaced, and its replacement. */
  readonly before: string | undefined
  readonly after: string | undefined
}

/** A session goal as the goal tools return it (`{ goal: … }`). */
export interface GoalDetails {
  readonly objective: string
  readonly status: string
  readonly percentComplete: number | undefined
  readonly currentWork: string | undefined
  readonly nextWork: string | undefined
  readonly tokensUsed: number | undefined
  readonly tokenBudget: number | undefined
}

/** One scheduled prompt (`cron_create`'s arguments, `cron_list`'s jobs). */
export interface ScheduledPrompt {
  readonly id: string | undefined
  readonly cron: string
  readonly prompt: string
  readonly isRecurring: boolean
  readonly nextFireAtMs: number | undefined
  readonly fireCount: number | undefined
}

/** One web search result; the query is the row's summary. */
export interface WebResult {
  readonly url: string
  readonly title: string | undefined
  readonly snippet: string | undefined
}

/** A shell call Muse Code moved to the background (`execution_state`). */
export interface BackgroundRun {
  readonly isRunning: boolean
  /** What the command printed before it was backgrounded. */
  readonly output: string
}

const memoryArgsSchema = z.object({
  scope: z.optional(z.string()),
  path: z.optional(z.string()),
  content: z.optional(z.string()),
  old_str: z.optional(z.string()),
  new_str: z.optional(z.string()),
})
const memoryReadSchema = z.object({ content: z.string() })

const goalSchema = z.object({
  goal: z.object({
    objective: z.string(),
    status: z.string(),
    percent_complete: z.optional(z.nullable(z.number())),
    current_work: z.optional(z.nullable(z.string())),
    next_work: z.optional(z.nullable(z.string())),
    tokens_used: z.optional(z.nullable(z.number())),
    token_budget: z.optional(z.nullable(z.number())),
  }),
})

const cronArgsSchema = z.object({
  cron: z.string(),
  prompt: z.string(),
  recurring: z.optional(z.boolean()),
})
const cronListSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      cron: z.string(),
      prompt: z.string(),
      recurring: z.optional(z.boolean()),
      next_fire_at_ms: z.optional(z.nullable(z.number())),
      fire_count: z.optional(z.nullable(z.number())),
    }),
  ),
})

const webResultsSchema = z.object({ results: z.array(webResultSchema) })

const imageArgsSchema = z.object({
  prompt: z.optional(z.string()),
  images: z.optional(z.array(z.string())),
})

const backgroundSchema = z.object({
  execution_state: z.string(),
  work_id: z.string(),
  output: z.optional(z.string()),
})

const BACKGROUND_RUNNING = 'background_running'
const JSON_INDENT = 2

function json(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * A generic row's arguments or result: JSON objects and arrays indented so
 * they read as data (an MCP server's tool, a tool the panel does not know),
 * anything else as it came.
 */
export function readableText(text: string): string {
  const parsed = json(text)
  return typeof parsed === 'object' && parsed !== null
    ? JSON.stringify(parsed, undefined, JSON_INDENT)
    : text
}

function scopeOf(scope: string | undefined): MemoryScope | undefined {
  return MEMORY_SCOPES.find((known) => known === scope)
}

/** A memory call's scope, note and edit, from its arguments and (for a read) its result. */
export function memoryDetails(tool: string, args: string, output: string): MemoryDetails {
  const parsed = memoryArgsSchema.safeParse(json(args))
  const given = parsed.success ? parsed.data : {}
  const read = tool === 'read_memory' ? memoryReadSchema.safeParse(json(output)) : undefined
  return {
    scope: scopeOf(given.scope),
    path: given.path,
    note: read?.success === true ? read.data.content : given.content,
    before: given.old_str,
    after: given.new_str,
  }
}

/** The goal a goal tool answered with; undefined while it runs or when it failed. */
export function goalDetails(output: string): GoalDetails | undefined {
  const parsed = goalSchema.safeParse(json(output))
  if (!parsed.success) {
    return undefined
  }
  const { goal } = parsed.data
  return {
    objective: goal.objective,
    status: goal.status,
    percentComplete: goal.percent_complete ?? undefined,
    currentWork: goal.current_work ?? undefined,
    nextWork: goal.next_work ?? undefined,
    tokensUsed: goal.tokens_used ?? undefined,
    tokenBudget: goal.token_budget ?? undefined,
  }
}

/**
 * The prompts a schedule call names: the one `cron_create` asked for, or
 * every job `cron_list` returned. `cron_delete` names none (its row says
 * which id it removed). Undefined when a `cron_list` result is not the
 * captured shape, so its text is shown instead of "none" (the review of
 * PR #29).
 */
export function scheduledPrompts(
  tool: string,
  args: string,
  output: string,
): readonly ScheduledPrompt[] | undefined {
  if (tool === 'cron_list') {
    const parsed = cronListSchema.safeParse(json(output))
    return parsed.success
      ? parsed.data.jobs.map((job) => ({
          id: job.id,
          cron: job.cron,
          prompt: job.prompt,
          isRecurring: job.recurring === true,
          nextFireAtMs: job.next_fire_at_ms ?? undefined,
          fireCount: job.fire_count ?? undefined,
        }))
      : undefined
  }
  const parsed = cronArgsSchema.safeParse(json(args))
  return parsed.success
    ? [
        {
          id: undefined,
          cron: parsed.data.cron,
          prompt: parsed.data.prompt,
          isRecurring: parsed.data.recurring === true,
          nextFireAtMs: undefined,
          fireCount: undefined,
        },
      ]
    : []
}

/**
 * A web search's results: Muse Code's `web_search` answers
 * `{ query, results: [{ url, title, snippet }] }`, and the Model API
 * backend's rows carry the same shape (M43). Undefined for any other text.
 */
export function webResults(output: string): readonly WebResult[] | undefined {
  const parsed = webResultsSchema.safeParse(json(output))
  return parsed.success
    ? parsed.data.results.map((result) => ({
        url: result.url,
        title: result.title ?? undefined,
        snippet: result.snippet ?? undefined,
      }))
    : undefined
}

/** What an image call asked for (M34, M44): the prompt and, for an edit, its sources. */
export function imageRequestOf(args: string): {
  readonly prompt: string | undefined
  readonly sources: readonly string[]
} {
  const parsed = imageArgsSchema.safeParse(json(args))
  return parsed.success
    ? { prompt: parsed.data.prompt, sources: parsed.data.images ?? [] }
    : { prompt: undefined, sources: [] }
}

/**
 * A shell call Muse Code moved to the background: its result is JSON with
 * `execution_state` (`background_running` while it runs) and the run's
 * `work_id` instead of the command's text; both are required, so output
 * that merely looks like it is not taken for one (the review of PR #29).
 * Undefined for an ordinary result.
 */
export function backgroundRun(output: string): BackgroundRun | undefined {
  const parsed = backgroundSchema.safeParse(json(output))
  return parsed.success
    ? {
        isRunning: parsed.data.execution_state === BACKGROUND_RUNNING,
        output: parsed.data.output ?? '',
      }
    : undefined
}
