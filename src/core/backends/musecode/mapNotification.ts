// Maps Muse Session Protocol notifications onto backend-agnostic AgentEvents.
// Pure and total: unknown methods and malformed params yield `undefined`, and
// the caller decides how loudly to log that. Only the fields the UI consumes
// are validated; the wire carries far more (see the SDK's msp.d.ts).

import * as z from 'zod/mini'
import type { AgentEvent } from '../../../shared/agentEvents'

export interface MappedNotification {
  readonly sessionId: string
  readonly event: AgentEvent
}

export interface WireNotification {
  readonly method: string
  readonly params?: Record<string, unknown> | undefined
}

const itemSchema = z.object({
  itemId: z.string(),
  kind: z.string(),
  status: z.string(),
  turnId: z.optional(z.string()),
  text: z.optional(z.string()),
})

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
  'item/completed': z.object({ ...sessionScoped, item: itemSchema }),
  'turn/completed': z.object({
    ...sessionScoped,
    turnId: z.string(),
    terminal: z.string(),
    reason: z.optional(z.string()),
    durationMs: z.optional(z.number()),
    error: z.optional(z.object({ kind: z.string(), message: z.string() })),
  }),
  'session/tokenUsage': z.object({
    ...sessionScoped,
    modelId: z.optional(z.string()),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cachedTokens: z.number(),
      reasoningTokens: z.number(),
    }),
  }),
  'session/contextUsage': z.object({
    ...sessionScoped,
    usedTokens: z.number(),
    windowTokens: z.optional(z.number()),
    pressure: z.string(),
  }),
  'session/modelChanged': z.object({ ...sessionScoped, modelId: z.string() }),
  'session/statusChanged': z.object({ ...sessionScoped, status: z.string() }),
  'session/reasoningEffortChanged': z.object({ ...sessionScoped, reasoningEffort: z.string() }),
  'session/approvalModeChanged': z.object({ ...sessionScoped, mode: z.string() }),
  'skill/changed': z.object(sessionScoped),
} as const

type MappedMethod = keyof typeof schemas

function isMappedMethod(method: string): method is MappedMethod {
  return Object.hasOwn(schemas, method)
}

/** The default delta field when the host omits one. */
const DEFAULT_DELTA_FIELD = 'text'

export function mapNotification(notification: WireNotification): MappedNotification | undefined {
  const { method } = notification
  if (!isMappedMethod(method)) {
    return undefined
  }
  const parsed = schemas[method].safeParse(notification.params)
  if (!parsed.success) {
    return undefined
  }
  const params = parsed.data
  switch (method) {
    case 'turn/started': {
      const { sessionId, turnId } = params as z.infer<(typeof schemas)['turn/started']>
      return { sessionId, event: { type: 'turnStarted', turnId } }
    }
    case 'item/started': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/started']>
      return {
        sessionId,
        event: {
          type: 'itemStarted',
          itemId: item.itemId,
          kind: item.kind,
          ...(item.turnId !== undefined && { turnId: item.turnId }),
        },
      }
    }
    case 'item/delta': {
      const { sessionId, itemId, delta, field } = params as z.infer<(typeof schemas)['item/delta']>
      return {
        sessionId,
        event: { type: 'textDelta', itemId, field: field ?? DEFAULT_DELTA_FIELD, delta },
      }
    }
    case 'item/completed': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/completed']>
      return {
        sessionId,
        event: {
          type: 'itemCompleted',
          itemId: item.itemId,
          kind: item.kind,
          status: item.status,
          ...(item.text !== undefined && { text: item.text }),
        },
      }
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
    case 'session/tokenUsage': {
      const { sessionId, usage, modelId } = params as z.infer<
        (typeof schemas)['session/tokenUsage']
      >
      return {
        sessionId,
        event: {
          type: 'tokenUsage',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens,
          reasoningTokens: usage.reasoningTokens,
          ...(modelId !== undefined && { modelId }),
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
    case 'skill/changed': {
      return { sessionId: params.sessionId, event: { type: 'skillsChanged' } }
    }
  }
}
