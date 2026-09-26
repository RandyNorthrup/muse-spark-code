// The session goal on the Model API backend (M45, PLAN.md D38): Muse Code's
// four goal tools with its own arguments, rules and result shape (captured
// live 2026-09-25, and the wording of Muse Code 1.3.0's goal messages), the
// user's verbs (MSP `goal/*`: set, edit, pause, resume, clear), and the
// section pinned into the instructions while the goal is active. Pure: the
// session holds the record, emits `goalChanged`, and decides about turns.
//
// What Muse Code's goal loop does and this one does not (D38): it queues a
// turn of its own to continue unfinished work after each turn, and runs a
// completion audit (a model call of its own) before a goal may close. Here
// the goal wakes a turn only when the user sets, edits or resumes it while
// nothing runs, as Muse Code does; nothing else ever starts a model call.

import * as z from 'zod/mini'
import type { SessionGoal } from '../../../shared/agentEvents'
import {
  GOAL_ID_PREFIX,
  GOAL_OBJECTIVE_MAX_CHARS,
  GOAL_PERCENT_MAX,
  GOAL_PROGRESS_REMINDER_STEPS,
  GOAL_STATUS,
  MODEL_API_TOOLS,
  MODEL_TEXT,
} from '../../../shared/constants'
import type { GoalCommand, GoalRefusal } from '../../agent/agentBackend'
import type { ToolOutcome } from './tools'

/**
 * One goal, as Muse Code's tools return it (`{ goal: { … } }`, snake case,
 * `null` for what is not set) without its `session_id`; stored with the
 * session as it is (D14).
 */
export const goalRecordSchema = z.object({
  goal_id: z.string(),
  objective: z.string(),
  status: z.string(),
  percent_complete: z.number(),
  current_work: z.nullable(z.string()),
  next_work: z.nullable(z.string()),
  token_budget: z.nullable(z.number()),
  tokens_used: z.number(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  last_progress_at_ms: z.nullable(z.number()),
})
export type GoalRecord = z.infer<typeof goalRecordSchema>

/** What a goal operation needs from the session: the clock and fresh ids. */
export interface GoalContext {
  readonly sessionId: string
  /** Epoch milliseconds. */
  readonly now: number
  readonly newId: () => string
}

/** A tool call's outcome and the goal after it (undefined when there is none). */
export interface GoalToolResult {
  readonly outcome: ToolOutcome
  readonly goal: GoalRecord | undefined
}

const newGoalArgs = z.object({
  objective: z.string(),
  token_budget: z.optional(z.nullable(z.number())),
})
const updateGoalArgs = z.object({ status: z.string() })
const reportProgressArgs = z.object({
  current_work: z.string(),
  next_work: z.string(),
  percent_complete: z.number(),
})

const TERMINAL_UPDATES: readonly string[] = [GOAL_STATUS.complete, GOAL_STATUS.blocked]

/** The four tools as the model is offered them (Muse Code's descriptions). */
export const GOAL_TOOL_DEFINITIONS = [
  {
    name: MODEL_API_TOOLS.createGoal,
    description:
      'Start a session goal only when requested. Fails if this session already has an unfinished goal; the failure message names the way out.',
    properties: {
      objective: { type: 'string', description: 'What the goal is done by, in a sentence' },
      token_budget: {
        type: 'integer',
        description: 'Optional: the tokens the goal may use before it stops',
      },
    },
    required: ['objective'],
  },
  {
    name: MODEL_API_TOOLS.getGoal,
    description:
      'Read the active session goal and progress. Returns {"goal": null} when no goal is set. Do not call to orient yourself, to check whether a goal exists, or on a greeting; only call when you are already working on an explicit goal and need its current state.',
    properties: {},
    required: [],
  },
  {
    name: MODEL_API_TOOLS.updateGoal,
    description:
      'Mark the active goal complete or blocked. Use complete only when no required work remains.',
    properties: {
      status: {
        type: 'string',
        enum: [...TERMINAL_UPDATES],
        description: 'The terminal goal status to set',
      },
    },
    required: ['status'],
  },
  {
    name: MODEL_API_TOOLS.reportProgress,
    description: `Report active goal progress. percent_complete=100 is equivalent to ${MODEL_API_TOOLS.updateGoal}(status="complete").`,
    properties: {
      current_work: { type: 'string', description: 'What you are doing now' },
      next_work: { type: 'string', description: 'What comes next' },
      percent_complete: { type: 'integer', description: 'From 0 to 100' },
    },
    required: ['current_work', 'next_work', 'percent_complete'],
  },
] as const

function failure(reason: string): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
}

/** `{ goal: … }` as Muse Code's goal tools answer it. */
export function goalResultText(sessionId: string, goal: GoalRecord | undefined): string {
  return JSON.stringify({ goal: goal === undefined ? null : { session_id: sessionId, ...goal } })
}

function answered(context: GoalContext, goal: GoalRecord | undefined): GoalToolResult {
  const text = goalResultText(context.sessionId, goal)
  return { outcome: { output: text, visibleOutput: text }, goal }
}

function parsedArgs<T>(schema: z.ZodMiniType<T>, args: string): T | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(args)
  } catch {
    return undefined
  }
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/** A validation code shared by user verbs and model tools, with separate text. */
type ObjectiveProblem = 'empty' | 'tooLong'

function objectiveProblem(objective: string): ObjectiveProblem | undefined {
  const trimmed = objective.trim()
  if (trimmed === '') {
    return 'empty'
  }
  // Count visible characters, including a joined emoji as one. Stop after
  // the first over-limit cluster so a huge pasted objective stays bounded.
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)
  const iterator = segments[Symbol.iterator]()
  let count = 0
  while (!iterator.next().done) {
    count += 1
    if (count > GOAL_OBJECTIVE_MAX_CHARS) {
      return 'tooLong'
    }
  }
  return undefined
}

function freshGoal(
  objective: string,
  tokenBudget: number | null,
  context: GoalContext,
): GoalRecord {
  return {
    goal_id: `${GOAL_ID_PREFIX}${context.newId()}`,
    objective: objective.trim(),
    status: GOAL_STATUS.active,
    percent_complete: 0,
    current_work: null,
    next_work: null,
    token_budget: tokenBudget,
    tokens_used: 0,
    created_at_ms: context.now,
    updated_at_ms: context.now,
    last_progress_at_ms: null,
  }
}

function isWholePercent(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= GOAL_PERCENT_MAX
}

function isBudget(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function createGoal(
  args: string,
  goal: GoalRecord | undefined,
  context: GoalContext,
): GoalToolResult {
  const parsed = parsedArgs(newGoalArgs, args)
  if (parsed === undefined) {
    return { outcome: failure(MODEL_TEXT.goalEmptyObjective), goal }
  }
  if (goal?.status === GOAL_STATUS.active) {
    return { outcome: failure(MODEL_TEXT.goalUnfinishedExists), goal }
  }
  if (goal?.status === GOAL_STATUS.paused) {
    return { outcome: failure(MODEL_TEXT.goalPausedExists), goal }
  }
  const problem = objectiveProblem(parsed.objective)
  if (problem !== undefined) {
    const text =
      problem === 'empty'
        ? MODEL_TEXT.goalEmptyObjective
        : `${MODEL_TEXT.goalObjectiveTooLong} ${String(GOAL_OBJECTIVE_MAX_CHARS)}`
    return { outcome: failure(text), goal }
  }
  const budget = parsed.token_budget ?? null
  return budget === null || isBudget(budget)
    ? answered(context, freshGoal(parsed.objective, budget, context))
    : { outcome: failure(MODEL_TEXT.goalBadBudget), goal }
}

function updateGoal(
  args: string,
  goal: GoalRecord | undefined,
  context: GoalContext,
): GoalToolResult {
  if (goal?.status !== GOAL_STATUS.active) {
    return { outcome: failure(MODEL_TEXT.goalNoActive), goal }
  }
  const parsed = parsedArgs(updateGoalArgs, args)
  if (parsed === undefined || !TERMINAL_UPDATES.includes(parsed.status)) {
    return { outcome: failure(MODEL_TEXT.goalBadStatus), goal }
  }
  // Complete is exactly 100 percent (Muse Code's goal store rule).
  const isComplete = parsed.status === GOAL_STATUS.complete
  return answered(context, {
    ...goal,
    status: parsed.status,
    percent_complete: isComplete ? GOAL_PERCENT_MAX : goal.percent_complete,
    updated_at_ms: context.now,
  })
}

function reportProgress(
  args: string,
  goal: GoalRecord | undefined,
  context: GoalContext,
): GoalToolResult {
  if (goal?.status !== GOAL_STATUS.active) {
    return { outcome: failure(MODEL_TEXT.goalNoActive), goal }
  }
  const parsed = parsedArgs(reportProgressArgs, args)
  if (parsed === undefined || !isWholePercent(parsed.percent_complete)) {
    return { outcome: failure(MODEL_TEXT.goalBadPercent), goal }
  }
  if (parsed.current_work.trim() === '' || parsed.next_work.trim() === '') {
    return { outcome: failure(MODEL_TEXT.goalEmptyWork), goal }
  }
  // 100 percent is the same as update_goal(status="complete").
  const isComplete = parsed.percent_complete === GOAL_PERCENT_MAX
  return answered(context, {
    ...goal,
    status: isComplete ? GOAL_STATUS.complete : goal.status,
    percent_complete: parsed.percent_complete,
    current_work: parsed.current_work,
    next_work: parsed.next_work,
    updated_at_ms: context.now,
    last_progress_at_ms: context.now,
  })
}

/** One goal tool call: its outcome for the model and the row, and the goal after it. */
export function runGoalTool(
  tool: string,
  args: string,
  goal: GoalRecord | undefined,
  context: GoalContext,
): GoalToolResult {
  switch (tool) {
    case MODEL_API_TOOLS.createGoal: {
      return createGoal(args, goal, context)
    }
    case MODEL_API_TOOLS.updateGoal: {
      return updateGoal(args, goal, context)
    }
    case MODEL_API_TOOLS.reportProgress: {
      return reportProgress(args, goal, context)
    }
    default: {
      return answered(context, goal)
    }
  }
}

/**
 * A user's verb (MSP `goal/<verb>`) applied to the goal, or the refusal
 * Muse Code gives (captured live 2026-09-25): none to act on (`noGoal`), or
 * a pause of a goal that is not active, a resume of one that is not paused,
 * an edit of a finished one (`wrongState`). A set replaces whatever was
 * there; an edit keeps the status.
 */
export function applyGoalCommand(
  goal: GoalRecord | undefined,
  command: GoalCommand,
  context: GoalContext,
): GoalRefusal | { readonly goal: GoalRecord | undefined } {
  if (command.verb === 'set') {
    return { goal: freshGoal(command.objective, null, context) }
  }
  if (goal === undefined) {
    return 'noGoal'
  }
  const updated = { ...goal, updated_at_ms: context.now }
  switch (command.verb) {
    case 'edit': {
      const isOpen = goal.status === GOAL_STATUS.active || goal.status === GOAL_STATUS.paused
      return isOpen ? { goal: { ...updated, objective: command.objective.trim() } } : 'wrongState'
    }
    case 'pause': {
      return goal.status === GOAL_STATUS.active
        ? { goal: { ...updated, status: GOAL_STATUS.paused } }
        : 'wrongState'
    }
    case 'resume': {
      return goal.status === GOAL_STATUS.paused
        ? { goal: { ...updated, status: GOAL_STATUS.active } }
        : 'wrongState'
    }
    case 'clear': {
      return { goal: undefined }
    }
  }
}

/** Why a set or edit's objective is refused before anything changes, or undefined. */
export function goalObjectiveProblem(command: GoalCommand): ObjectiveProblem | undefined {
  return command.verb === 'set' || command.verb === 'edit'
    ? objectiveProblem(command.objective)
    : undefined
}

/** Whether the goal is one the agent works toward now. */
export function isGoalActive(goal: GoalRecord | undefined): goal is GoalRecord {
  return goal?.status === GOAL_STATUS.active
}

/** Tokens a model call used while the goal was active; the budget stops it (`budget_limited`). */
export function withTokensUsed(goal: GoalRecord, tokens: number, now: number): GoalRecord {
  const used = goal.tokens_used + tokens
  const isOverBudget = goal.token_budget !== null && used >= goal.token_budget
  return {
    ...goal,
    tokens_used: used,
    ...(isOverBudget && { status: GOAL_STATUS.budgetLimited, updated_at_ms: now }),
  }
}

/** The goal as the panel shows it (MSP's `Goal` block). */
export function toSessionGoal(goal: GoalRecord): SessionGoal {
  return {
    objective: goal.objective,
    status: goal.status,
    percentComplete: goal.percent_complete,
    ...(goal.current_work !== null && { currentWork: goal.current_work }),
    ...(goal.next_work !== null && { nextWork: goal.next_work }),
  }
}

/**
 * The section pinned into the instructions while the goal is active (D38):
 * the objective and progress, and the rules of Muse Code's goal reminder;
 * after `GOAL_PROGRESS_REMINDER_STEPS` model calls without progress, its
 * step-probe note too. Undefined while there is no active goal.
 */
export function goalInstructions(
  goal: GoalRecord | undefined,
  stepsSinceProgress: number,
): string | undefined {
  if (!isGoalActive(goal)) {
    return undefined
  }
  const progress = [
    `- Objective: ${goal.objective}`,
    `- Progress: ${String(goal.percent_complete)}%`,
    ...(goal.current_work === null ? [] : [`- Current work: ${goal.current_work}`]),
    ...(goal.next_work === null ? [] : [`- Next work: ${goal.next_work}`]),
    ...(goal.token_budget === null
      ? []
      : [`- Tokens used: ${String(goal.tokens_used)} of a budget of ${String(goal.token_budget)}`]),
  ]
  const probe =
    stepsSinceProgress >= GOAL_PROGRESS_REMINDER_STEPS
      ? [
          `Progress has not been reported in the last ${String(stepsSinceProgress)} model calls. Call ${MODEL_API_TOOLS.reportProgress} with current_work, next_work, and percent_complete before continuing unless the goal is already achieved.`,
        ]
      : []
  return [
    '# Session goal',
    'The user set a goal for this session. Keep working toward it across turns until it is achieved.',
    progress.join('\n'),
    `Report progress with ${MODEL_API_TOOLS.reportProgress} as you finish steps. Treat the goal as achieved only when current evidence proves every requirement is satisfied (files, command output, test results) and no required work remains; if the evidence is incomplete or indirect, keep working. Then call ${MODEL_API_TOOLS.updateGoal} with status "complete" (or ${MODEL_API_TOOLS.reportProgress} with percent_complete 100). If you cannot proceed, call ${MODEL_API_TOOLS.updateGoal} with status "blocked" and say what blocks you; never fake, bypass or disable a test to satisfy the goal.`,
    ...probe,
  ].join('\n\n')
}
