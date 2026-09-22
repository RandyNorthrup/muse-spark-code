// Backend-agnostic events a conversation emits. The MSP backend maps Muse
// Session Protocol notifications onto these; the Model API backend (M7) will
// map its own stream onto the same union. The webview renders only these, so
// it never learns which backend is active.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'

const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turnStarted'), turnId: z.string() }),
  z.object({
    type: z.literal('itemStarted'),
    itemId: z.string(),
    kind: z.string(),
    turnId: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('textDelta'),
    itemId: z.string(),
    field: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('itemCompleted'),
    itemId: z.string(),
    kind: z.string(),
    status: z.string(),
    text: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('turnCompleted'),
    turnId: z.string(),
    terminal: z.string(),
    reason: z.optional(z.string()),
    errorKind: z.optional(z.string()),
    durationMs: z.optional(z.number()),
  }),
  z.object({
    type: z.literal('tokenUsage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedTokens: z.number(),
    reasoningTokens: z.number(),
    modelId: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('contextUsage'),
    usedTokens: z.number(),
    windowTokens: z.optional(z.number()),
    pressure: z.string(),
  }),
  z.object({ type: z.literal('modelChanged'), modelId: z.string() }),
  z.object({ type: z.literal('sessionStatus'), status: z.string() }),
])

export type AgentEvent = z.infer<typeof agentEventSchema>

export { agentEventSchema }
