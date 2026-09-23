// The Model API shapes the extension reads (dev.meta.ai/docs, 2026-09-22:
// api-reference/responses, protocols/responses, tool-calling, reasoning,
// error-handling, models). Only the fields the backend consumes are
// validated; unknown fields and unknown item / event types pass through
// (the API evolves additively).

import * as z from 'zod/mini'

export const outputTextPartSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
})

const refusalPartSchema = z.object({ type: z.literal('refusal'), refusal: z.string() })

const otherPartSchema = z.object({ type: z.string() })

export const messageItemSchema = z.object({
  type: z.literal('message'),
  id: z.optional(z.string()),
  role: z.string(),
  content: z.array(z.union([outputTextPartSchema, refusalPartSchema, otherPartSchema])),
  status: z.optional(z.string()),
})
export type MessageItem = z.infer<typeof messageItemSchema>

export const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  id: z.optional(z.string()),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
  status: z.optional(z.string()),
})
export type FunctionCallItem = z.infer<typeof functionCallItemSchema>

export const reasoningItemSchema = z.object({
  type: z.literal('reasoning'),
  id: z.optional(z.string()),
  summary: z.optional(z.array(z.object({ type: z.string(), text: z.string() }))),
  encrypted_content: z.optional(z.nullable(z.string())),
  status: z.optional(z.string()),
})
export type ReasoningItem = z.infer<typeof reasoningItemSchema>

const otherItemSchema = z.object({ type: z.string(), id: z.optional(z.string()) })

export const outputItemSchema = z.union([
  messageItemSchema,
  functionCallItemSchema,
  reasoningItemSchema,
  otherItemSchema,
])
export type OutputItem = z.infer<typeof outputItemSchema>

// The union's catch-all member has `type: string`, so the discriminator
// alone cannot narrow; these guards check the member's own fields too.
export function isMessageItem(item: OutputItem): item is MessageItem {
  return item.type === 'message' && 'content' in item
}

export function isFunctionCallItem(item: OutputItem): item is FunctionCallItem {
  return item.type === 'function_call' && 'call_id' in item
}

export function isReasoningItem(item: OutputItem): item is ReasoningItem {
  return item.type === 'reasoning' && !('call_id' in item) && !('content' in item)
}

/**
 * The reply text of a message: its output text, and a refusal's own words
 * (PLAN.md D26: a refusal used to render as an empty reply).
 */
export function messageText(item: MessageItem): string {
  return item.content
    .flatMap((part) => {
      if (part.type === 'output_text' && 'text' in part) {
        return [part.text]
      }
      return part.type === 'refusal' && 'refusal' in part ? [part.refusal] : []
    })
    .join('')
}

export const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.optional(z.number()),
  input_tokens_details: z.optional(z.nullable(z.object({ cached_tokens: z.optional(z.number()) }))),
  output_tokens_details: z.optional(
    z.nullable(z.object({ reasoning_tokens: z.optional(z.number()) })),
  ),
})
export type Usage = z.infer<typeof usageSchema>

export const responseErrorSchema = z.object({
  code: z.optional(z.nullable(z.string())),
  message: z.string(),
})

export const responseSchema = z.object({
  id: z.string(),
  status: z.string(),
  model: z.optional(z.string()),
  output: z.array(outputItemSchema),
  usage: z.optional(z.nullable(usageSchema)),
  error: z.optional(z.nullable(responseErrorSchema)),
  incomplete_details: z.optional(z.nullable(z.object({ reason: z.optional(z.string()) }))),
})
export type ResponseObject = z.infer<typeof responseSchema>

// --- streaming events (`type` names them; `event:` carries the same) ---

const withResponse = { response: responseSchema }
const withItem = { output_index: z.optional(z.number()), item: outputItemSchema }

export const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('response.created'), ...withResponse }),
  z.object({ type: z.literal('response.in_progress'), ...withResponse }),
  z.object({ type: z.literal('response.completed'), ...withResponse }),
  z.object({ type: z.literal('response.failed'), ...withResponse }),
  z.object({ type: z.literal('response.incomplete'), ...withResponse }),
  z.object({ type: z.literal('response.output_item.added'), ...withItem }),
  z.object({ type: z.literal('response.output_item.done'), ...withItem }),
  z.object({
    type: z.literal('response.output_text.delta'),
    item_id: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('response.function_call_arguments.delta'),
    item_id: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('response.function_call_arguments.done'),
    item_id: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal('response.reasoning_summary_text.delta'),
    item_id: z.string(),
    summary_index: z.optional(z.number()),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.optional(z.nullable(z.string())),
    message: z.string(),
  }),
])
export type StreamEvent = z.infer<typeof streamEventSchema>

/** Just the discriminator, to tell an unknown event type from a malformed one. */
export const eventTypeSchema = z.object({ type: z.string() })

export const errorBodySchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.optional(z.nullable(z.string())),
    code: z.optional(z.nullable(z.string())),
    param: z.optional(z.nullable(z.string())),
  }),
})

export const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
})

export const inputTokensSchema = z.object({ input_tokens: z.number() })

// --- request items (what the backend sends back as `input`) ---

/** A user or assistant message in the replayed conversation. */
export interface InputMessageItem {
  readonly type: 'message'
  readonly role: 'user' | 'assistant' | 'developer'
  readonly content: readonly InputContentPart[]
}

export type InputContentPart =
  | { readonly type: 'input_text'; readonly text: string }
  | { readonly type: 'input_image'; readonly image_url: string; readonly detail: 'auto' }
  | { readonly type: 'output_text'; readonly text: string }

export interface FunctionCallOutputItem {
  readonly type: 'function_call_output'
  readonly call_id: string
  readonly output: string
}

/** The replayed model items keep their wire shape (function calls, reasoning). */
export type InputItem = InputMessageItem | FunctionCallOutputItem | FunctionCallItem | ReasoningItem

export interface FunctionToolDefinition {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly strict: false
}

export interface CreateResponseBody {
  readonly model: string
  readonly input: readonly InputItem[]
  readonly instructions: string
  readonly tools: readonly FunctionToolDefinition[]
  readonly tool_choice: 'auto'
  readonly reasoning: { readonly effort: string; readonly summary: 'auto' }
  readonly stream: true
  readonly store: false
  readonly include: readonly ['reasoning.encrypted_content']
  readonly max_output_tokens: number
  readonly prompt_cache_key: string
}
