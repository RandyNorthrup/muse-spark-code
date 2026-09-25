// The Model API shapes the extension reads (dev.meta.ai/docs, 2026-09-22:
// api-reference/responses, protocols/responses, tool-calling, reasoning,
// error-handling, models; 2026-09-25: search-grounding and the Responses
// schemas for web search, PLAN.md M33). Only the fields the backend consumes
// are validated; unknown fields and unknown item / event types pass through
// (the API evolves additively).

import * as z from 'zod/mini'
import { webResultSchema } from '../../../shared/webResults'

/** A source the reply cites (`url_citation`, search-grounding); offsets are not used. */
const urlCitationSchema = z.object({
  type: z.literal('url_citation'),
  url: z.string(),
  title: z.optional(z.string()),
})

const otherAnnotationSchema = z.object({ type: z.string() })

export const outputTextPartSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
  annotations: z.optional(z.array(z.union([urlCitationSchema, otherAnnotationSchema]))),
})

const refusalPartSchema = z.object({ type: z.literal('refusal'), refusal: z.string() })

const otherPartSchema = z.object({ type: z.string() })

export const messageItemSchema = z.object({
  type: z.literal('message'),
  id: z.optional(z.string()),
  role: z.string(),
  /** `commentary` on text the model writes before a tool call; absent on a final answer. */
  phase: z.optional(z.nullable(z.string())),
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

/**
 * What a search did (the Responses schema's `action`): `search` with its
 * queries (`query` is the deprecated single one), or `open_page` /
 * `find_in_page` on a URL. Meta's guide shows items without it, so it is
 * optional here though the schema requires it.
 */
export const webSearchActionSchema = z.object({
  type: z.string(),
  query: z.optional(z.string()),
  queries: z.optional(z.array(z.string())),
  url: z.optional(z.nullable(z.string())),
  pattern: z.optional(z.string()),
  sources: z.optional(z.array(z.object({ type: z.string(), url: z.string() }))),
})
export type WebSearchAction = z.infer<typeof webSearchActionSchema>

export const webSearchCallItemSchema = z.object({
  type: z.literal('web_search_call'),
  id: z.optional(z.string()),
  status: z.optional(z.string()),
  action: z.optional(webSearchActionSchema),
  // Present when the request includes `web_search_call.results`.
  results: z.optional(z.nullable(z.array(webResultSchema))),
})
export type WebSearchCallItem = z.infer<typeof webSearchCallItemSchema>

const otherItemSchema = z.object({ type: z.string(), id: z.optional(z.string()) })

export const outputItemSchema = z.union([
  messageItemSchema,
  functionCallItemSchema,
  reasoningItemSchema,
  webSearchCallItemSchema,
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

export function isWebSearchCallItem(item: OutputItem): item is WebSearchCallItem {
  return item.type === 'web_search_call'
}

export interface Citation {
  readonly url: string
  readonly title?: string
}

/** The sources a message cites, each URL once, in the order they first appear. */
export function citationsOf(item: MessageItem): readonly Citation[] {
  const citations: Citation[] = []
  const seen = new Set<string>()
  for (const part of item.content) {
    if (part.type !== 'output_text' || !('annotations' in part)) {
      continue
    }
    const annotations = part.annotations ?? []
    for (const annotation of annotations) {
      if (
        annotation.type !== 'url_citation' ||
        !('url' in annotation) ||
        seen.has(annotation.url)
      ) {
        continue
      }
      seen.add(annotation.url)
      citations.push({
        url: annotation.url,
        ...(annotation.title !== undefined &&
          annotation.title !== '' && { title: annotation.title }),
      })
    }
  }
  return citations
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

/**
 * What an assistant message was (protocols/responses, message phase):
 * `commentary` is text the model wrote before a tool call, and must be
 * replayed as such: replayed as a final answer before a `function_call`
 * it is a 400. `final_answer` is accepted on input only.
 */
export const MESSAGE_PHASES = ['commentary', 'final_answer'] as const
export type MessagePhase = (typeof MESSAGE_PHASES)[number]

/** A user or assistant message in the replayed conversation. */
export interface InputMessageItem {
  readonly type: 'message'
  readonly role: 'user' | 'assistant' | 'developer'
  readonly content: readonly InputContentPart[]
  readonly phase?: MessagePhase | undefined
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

/**
 * A search the model made, replayed so its reasoning keeps the item that
 * followed it (search-grounding: earlier `web_search_call` items may be
 * replayed). Its results stay out: they were asked for the transcript, and
 * the reply that used them is replayed already.
 */
export interface WebSearchCallInputItem {
  readonly type: 'web_search_call'
  readonly id?: string | undefined
  readonly status: string
  readonly action?: WebSearchAction | undefined
}

/** The replayed model items keep their wire shape (function calls, reasoning, searches). */
export type InputItem =
  | InputMessageItem
  | FunctionCallOutputItem
  | FunctionCallItem
  | ReasoningItem
  | WebSearchCallInputItem

export interface FunctionToolDefinition {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly strict: false
}

/** Meta's hosted search (search-grounding, M33): the model decides when to search. */
export interface WebSearchToolDefinition {
  readonly type: 'web_search'
}

export type ToolDefinition = FunctionToolDefinition | WebSearchToolDefinition

/** What the response adds beyond its defaults: reasoning to replay, search results to show. */
export type IncludeField = 'reasoning.encrypted_content' | 'web_search_call.results'

export interface CreateResponseBody {
  readonly model: string
  readonly input: readonly InputItem[]
  readonly instructions: string
  readonly tools: readonly ToolDefinition[]
  readonly tool_choice: 'auto'
  readonly reasoning: { readonly effort: string; readonly summary: 'auto' }
  readonly stream: true
  readonly store: false
  readonly include: readonly IncludeField[]
  readonly max_output_tokens: number
  readonly prompt_cache_key: string
}

// --- images (M34, dev.meta.ai/docs/api-reference/images, read 2026-09-25) ---

/** What `POST /images/generations` returns: each image inline when asked for `b64_json`. */
export const imagesResponseSchema = z.object({
  created: z.optional(z.number()),
  data: z.array(
    z.object({
      b64_json: z.optional(z.nullable(z.string())),
      revised_prompt: z.optional(z.nullable(z.string())),
    }),
  ),
})
export type ImagesResponse = z.infer<typeof imagesResponseSchema>

/** One image, PNG, returned inline: the only request the extension makes. */
export interface CreateImageBody {
  readonly model: string
  readonly prompt: string
  readonly n: 1
  readonly size: string
  readonly response_format: 'b64_json'
  readonly output_format: 'png'
}
