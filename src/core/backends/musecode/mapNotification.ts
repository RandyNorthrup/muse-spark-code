// Maps Muse Session Protocol notifications onto backend-agnostic AgentEvents.
// Pure and total: an unknown method is `UNKNOWN_METHOD` and params that fail
// their schema are `MALFORMED_PARAMS`, and the caller decides how loudly to
// log either. Only the fields the UI consumes are validated; the wire carries
// far more (see the SDK's msp.d.ts). Shapes were verified against live
// captures on 2026-09-21/22 (docs/certification/m4.md).

import * as z from 'zod/mini'
import {
  type AgentEvent,
  answerSchema,
  approvalChoiceSchema,
  approvalSubjectSchema,
  questionSchema,
  requirementRefSchema,
  todoItemSchema,
} from '../../../shared/agentEvents'
import { UI_TEXT } from '../../../shared/constants'
import { toSessionGoal, toSnapshot, wireGoalSchema, wireItemSchema } from './sessionRecords'

export type MappedNotification =
  | { readonly sessionId: string; readonly event: AgentEvent }
  /** The host already holds this approval's terminal (`change.kind: alreadyTerminal`). */
  | { readonly sessionId: string; readonly closedApprovalId: string }

export const UNKNOWN_METHOD = 'unknown'
export const MALFORMED_PARAMS = 'malformed'
export type MapOutcome = MappedNotification | typeof UNKNOWN_METHOD | typeof MALFORMED_PARAMS

const ALREADY_TERMINAL = 'alreadyTerminal'

export interface WireNotification {
  readonly method: string
  readonly params?: Record<string, unknown> | undefined
}

const itemSchema = wireItemSchema

const sessionScoped = { sessionId: z.string() }

const schemas = {
  'turn/started': z.object({ ...sessionScoped, turnId: z.string() }),
  'item/started': z.object({ ...sessionScoped, item: itemSchema }),
  'item/delta': z.object({
    ...sessionScoped,
    itemId: z.string(),
    delta: z.string(),
    field: z.optional(z.string()),
  }),
  'item/updated': z.object({ ...sessionScoped, item: itemSchema }),
  'item/completed': z.object({ ...sessionScoped, item: itemSchema }),
  'turn/completed': z.object({
    ...sessionScoped,
    turnId: z.string(),
    terminal: z.string(),
    reason: z.optional(z.string()),
    durationMs: z.optional(z.number()),
    error: z.optional(z.object({ kind: z.string(), message: z.string() })),
  }),
  'turn/retryScheduled': z.object({
    ...sessionScoped,
    turnId: z.string(),
    attempt: z.number(),
    maxAttempts: z.number(),
    retryDelayMs: z.number(),
    reason: z.string(),
  }),
  // The session's running totals (D26): `cumulative` counts prompt tokens once
  // under the provider's cache convention; the raw per-completion counters
  // beside it do not sum across providers, so they are not shown.
  'session/tokenUsage': z.object({
    ...sessionScoped,
    modelId: z.optional(z.nullable(z.string())),
    cumulative: z.object({ promptTokens: z.number(), outputTokens: z.number() }),
  }),
  'session/contextUsage': z.object({
    ...sessionScoped,
    usedTokens: z.number(),
    windowTokens: z.optional(z.number()),
    pressure: z.string(),
  }),
  'session/modelChanged': z.object({ ...sessionScoped, modelId: z.string() }),
  'session/statusChanged': z.object({ ...sessionScoped, status: z.string() }),
  'session/nameChanged': z.object({ ...sessionScoped, name: z.string() }),
  'session/reasoningEffortChanged': z.object({ ...sessionScoped, reasoningEffort: z.string() }),
  'session/approvalModeChanged': z.object({ ...sessionScoped, mode: z.string() }),
  'session/todoListChanged': z.object({ ...sessionScoped, items: z.array(todoItemSchema) }),
  // The goal block replaced wholesale; an explicit `null` clears it (tdd
  // SS4.6.2, captured live 2026-09-25, M45). Absent reads as cleared too:
  // the schema types it optional, and it never means "unchanged".
  'session/goalChanged': z.object({
    ...sessionScoped,
    goal: z.optional(z.nullable(wireGoalSchema)),
  }),
  'skill/changed': z.object(sessionScoped),
  'approval/requested': z.object({
    ...sessionScoped,
    approvalId: z.string(),
    itemId: z.string(),
    toolName: z.string(),
    rawArgs: z.string(),
    currentRequirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    judgeEscalated: z.boolean(),
    protectedWrite: z.boolean(),
  }),
  'approval/updated': z.object({
    ...sessionScoped,
    approvalId: z.string(),
    currentRequirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    change: z.optional(z.object({ kind: z.string() })),
  }),
  'approval/resolved': z.object({
    ...sessionScoped,
    approvalId: z.string(),
    itemId: z.string(),
    decision: z.string(),
    resolvedBy: z.string(),
  }),
  'userInput/requested': z.object({
    ...sessionScoped,
    userInputId: z.string(),
    itemId: z.string(),
    questions: z.array(questionSchema),
  }),
  'userInput/settled': z.object({
    ...sessionScoped,
    userInputId: z.string(),
    outcome: z.string(),
    answers: z.array(answerSchema),
  }),
  // A queued submission reclaimed: its turn never runs (tdd SS3.6).
  'turn/unqueued': z.object({ ...sessionScoped, turnId: z.string() }),
  // Another client withdrew a submission; the item itself is re-sent as updated.
  'turn/retracted': z.object({ ...sessionScoped, turnId: z.string() }),
  // Live delivery dropped events between two cursors (spec 208 SS4.8).
  'view/gap': z.object({ ...sessionScoped, after: z.string(), next: z.string() }),
  // The account's provider cannot serve the session's standing model (#25603).
  'session/modelRouteUnserved': z.object({ ...sessionScoped, modelId: z.string() }),
} as const

type MappedMethod = keyof typeof schemas

function isMappedMethod(method: string): method is MappedMethod {
  return Object.hasOwn(schemas, method)
}

/** The default delta field when the host omits one. */
const DEFAULT_DELTA_FIELD = 'text'

export function mapNotification(notification: WireNotification): MapOutcome {
  const { method } = notification
  if (!isMappedMethod(method)) {
    return UNKNOWN_METHOD
  }
  const parsed = schemas[method].safeParse(notification.params)
  if (!parsed.success) {
    return MALFORMED_PARAMS
  }
  const params = parsed.data
  switch (method) {
    case 'turn/started': {
      const { sessionId, turnId } = params as z.infer<(typeof schemas)['turn/started']>
      return { sessionId, event: { type: 'turnStarted', turnId } }
    }
    case 'item/started': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/started']>
      return { sessionId, event: { type: 'itemStarted', item: toSnapshot(item) } }
    }
    case 'item/delta': {
      const { sessionId, itemId, delta, field } = params as z.infer<(typeof schemas)['item/delta']>
      return {
        sessionId,
        event: { type: 'textDelta', itemId, field: field ?? DEFAULT_DELTA_FIELD, delta },
      }
    }
    case 'item/updated': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/updated']>
      return { sessionId, event: { type: 'itemUpdated', item: toSnapshot(item) } }
    }
    case 'item/completed': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/completed']>
      return { sessionId, event: { type: 'itemCompleted', item: toSnapshot(item) } }
    }
    case 'turn/completed': {
      const { sessionId, turnId, terminal, reason, durationMs, error } = params as z.infer<
        (typeof schemas)['turn/completed']
      >
      return {
        sessionId,
        event: {
          type: 'turnCompleted',
          turnId,
          terminal,
          ...(reason !== undefined && { reason }),
          ...(error !== undefined && { errorKind: error.kind }),
          ...(durationMs !== undefined && { durationMs }),
        },
      }
    }
    case 'turn/retryScheduled': {
      const { sessionId, turnId, attempt, maxAttempts, retryDelayMs, reason } = params as z.infer<
        (typeof schemas)['turn/retryScheduled']
      >
      return {
        sessionId,
        event: { type: 'turnRetry', turnId, attempt, maxAttempts, retryDelayMs, reason },
      }
    }
    case 'session/tokenUsage': {
      const { sessionId, cumulative, modelId } = params as z.infer<
        (typeof schemas)['session/tokenUsage']
      >
      return {
        sessionId,
        event: {
          type: 'tokenUsage',
          inputTokens: cumulative.promptTokens,
          outputTokens: cumulative.outputTokens,
          ...(typeof modelId === 'string' && { modelId }),
        },
      }
    }
    case 'session/contextUsage': {
      const { sessionId, usedTokens, windowTokens, pressure } = params as z.infer<
        (typeof schemas)['session/contextUsage']
      >
      return {
        sessionId,
        event: {
          type: 'contextUsage',
          usedTokens,
          pressure,
          ...(windowTokens !== undefined && { windowTokens }),
        },
      }
    }
    case 'session/modelChanged': {
      const { sessionId, modelId } = params as z.infer<(typeof schemas)['session/modelChanged']>
      return { sessionId, event: { type: 'modelChanged', modelId } }
    }
    case 'session/statusChanged': {
      const { sessionId, status } = params as z.infer<(typeof schemas)['session/statusChanged']>
      return { sessionId, event: { type: 'sessionStatus', status } }
    }
    case 'session/nameChanged': {
      const { sessionId, name } = params as z.infer<(typeof schemas)['session/nameChanged']>
      return { sessionId, event: { type: 'sessionNamed', name } }
    }
    case 'session/reasoningEffortChanged': {
      const { sessionId, reasoningEffort } = params as z.infer<
        (typeof schemas)['session/reasoningEffortChanged']
      >
      return { sessionId, event: { type: 'effortChanged', effort: reasoningEffort } }
    }
    case 'session/approvalModeChanged': {
      const { sessionId, mode } = params as z.infer<(typeof schemas)['session/approvalModeChanged']>
      return { sessionId, event: { type: 'approvalModeChanged', mode } }
    }
    case 'session/todoListChanged': {
      const { sessionId, items } = params as z.infer<(typeof schemas)['session/todoListChanged']>
      return { sessionId, event: { type: 'todoChanged', items } }
    }
    case 'session/goalChanged': {
      const { sessionId, goal } = params as z.infer<(typeof schemas)['session/goalChanged']>
      return {
        sessionId,
        event: {
          type: 'goalChanged',
          goal: goal === undefined || goal === null ? null : toSessionGoal(goal),
        },
      }
    }
    case 'skill/changed': {
      return { sessionId: params.sessionId, event: { type: 'skillsChanged' } }
    }
    case 'approval/requested': {
      const p = params as z.infer<(typeof schemas)['approval/requested']>
      return {
        sessionId: p.sessionId,
        event: {
          type: 'approvalRequested',
          approvalId: p.approvalId,
          itemId: p.itemId,
          toolName: p.toolName,
          rawArgs: p.rawArgs,
          requirementId: p.currentRequirementId,
          subject: p.subject,
          availableChoices: p.availableChoices,
          isJudgeEscalated: p.judgeEscalated,
          isProtectedWrite: p.protectedWrite,
        },
      }
    }
    case 'approval/updated': {
      const p = params as z.infer<(typeof schemas)['approval/updated']>
      if (p.change?.kind === ALREADY_TERMINAL) {
        // A decision against it could only bounce: the card waits for its resolve.
        return { sessionId: p.sessionId, closedApprovalId: p.approvalId }
      }
      return {
        sessionId: p.sessionId,
        event: {
          type: 'approvalUpdated',
          approvalId: p.approvalId,
          requirementId: p.currentRequirementId,
          subject: p.subject,
          availableChoices: p.availableChoices,
        },
      }
    }
    case 'approval/resolved': {
      const { sessionId, approvalId, itemId, decision, resolvedBy } = params as z.infer<
        (typeof schemas)['approval/resolved']
      >
      return {
        sessionId,
        event: { type: 'approvalResolved', approvalId, itemId, decision, resolvedBy },
      }
    }
    case 'userInput/requested': {
      const { sessionId, userInputId, itemId, questions } = params as z.infer<
        (typeof schemas)['userInput/requested']
      >
      return { sessionId, event: { type: 'questionRequested', userInputId, itemId, questions } }
    }
    case 'userInput/settled': {
      const { sessionId, userInputId, outcome, answers } = params as z.infer<
        (typeof schemas)['userInput/settled']
      >
      return { sessionId, event: { type: 'questionSettled', userInputId, outcome, answers } }
    }
    case 'turn/unqueued': {
      const { sessionId, turnId } = params as z.infer<(typeof schemas)['turn/unqueued']>
      // Not a turn completion: the foreground turn, if any, runs on.
      return {
        sessionId,
        event: { type: 'turnWithdrawn', turnId, reason: UI_TEXT.turnUnqueued },
      }
    }
    case 'turn/retracted': {
      return {
        sessionId: params.sessionId,
        event: { type: 'backendNotice', level: 'info', text: UI_TEXT.turnRetracted },
      }
    }
    case 'view/gap': {
      return { sessionId: params.sessionId, event: { type: 'viewGap' } }
    }
    case 'session/modelRouteUnserved': {
      const { sessionId, modelId } = params as z.infer<
        (typeof schemas)['session/modelRouteUnserved']
      >
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'warning',
          text: `${UI_TEXT.modelRouteUnserved} (${modelId})`,
        },
      }
    }
  }
}
