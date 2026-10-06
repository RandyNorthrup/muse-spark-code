// The Model API shapes the extension reads (dev.meta.ai/docs, 2026-09-22:
// api-reference/responses, protocols/responses, tool-calling, reasoning,
// error-handling, models; 2026-09-25: search-grounding and the Responses
// schemas for web search, PLAN.md M33). Only the fields the backend consumes
// are validated; unknown fields and unknown item / event types pass through
// (the API evolves additively).

import * as z from 'zod/mini'
import type { PromptCacheRetention } from '../../../shared/constants'
import { TOOL_SCHEMA_MAX_DEPTH } from '../../../shared/constants'
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
  /**
   * M101 lane P1 (BYO item 4): a thought signature Gemini attached to this
   * text part. Only the Gemini codec reads it; every other reader renders
   * the text and ignores the signature.
   */
  thoughtSignature: z.optional(z.string()),
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
  // Internal normalized receipt from the codecs' captured provider cost fields.
  provider_cost_usd: z.optional(z.number().check(z.nonnegative())),
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.optional(z.number()),
  input_tokens_details: z.optional(
    z.nullable(
      z.object({
        cached_tokens: z.optional(z.number()),
        // M95: writes are a disjoint subset of total input; 1h is a subset
        // of writes. Absent TTL information stays unknown, never guessed.
        cache_write_tokens: z.optional(z.number()),
        cache_write_tokens_1h: z.optional(z.number()),
      }),
    ),
  ),
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

// A count below zero is no count: it would lower the session budget's base (M82).
export const inputTokensSchema = z.object({ input_tokens: z.number().check(z.nonnegative()) })

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

/**
 * A PDF sent inline (M54, PLAN.md D47; file-handling, "Send a file inline"):
 * the bytes as a base64 data URL, never uploaded, with the name the model
 * sees.
 */
export interface InputFilePart {
  readonly type: 'input_file'
  readonly filename: string
  readonly file_data: string
}

export type InputContentPart =
  | InputFilePart
  | { readonly type: 'input_text'; readonly text: string }
  | { readonly type: 'input_image'; readonly image_url: string; readonly detail: 'auto' }
  | {
      readonly type: 'output_text'
      readonly text: string
      /**
       * M101 lane P1 (BYO item 4): a thought signature Gemini attached to
       * this text part, empty parts included (Pi #7356). Only the Gemini
       * codec reads it, replaying the part with its signature; every other
       * codec renders the text and ignores the signature.
       */
      readonly thoughtSignature?: string | undefined
    }

/**
 * A part of a function's output given as content (the Responses schema's
 * `FunctionCallOutputContentListParam`, read 2026-09-25): text and pictures,
 * which an MCP tool may return (M50).
 */
export type FunctionOutputPart =
  | { readonly type: 'input_text'; readonly text: string }
  | { readonly type: 'input_image'; readonly image_url: string; readonly detail: 'auto' }

export interface FunctionCallOutputItem {
  readonly type: 'function_call_output'
  readonly call_id: string
  /** The result as text, or as content parts when it holds pictures. */
  readonly output: string | readonly FunctionOutputPart[]
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
  // False everywhere the canonical body goes (Meta included); true only
  // where the model's quirks say `supportsStrictTools` (M101 item 24), set
  // through `withStrictTools`, never by hand.
  readonly strict: boolean
}

/**
 * Flags function tools strict where the model takes it (M101 item 24);
 * search tools pass through. Off returns the same definitions, so the
 * canonical body (and the golden bytes) stays `strict: false` where the
 * quirk is off.
 */
export function withStrictTools(
  tools: readonly ToolDefinition[],
  shouldUseStrict: boolean,
): readonly ToolDefinition[] {
  return shouldUseStrict
    ? tools.map((tool) => {
        if (tool.type !== 'function') return tool
        if (tool.parameters['type'] !== 'object') {
          throw new Error('strict_tool_schema_unsupported')
        }
        return { ...tool, parameters: strictToolSchema(tool.parameters), strict: true }
      })
    : tools
}

/** Strict optional properties are nullable on the wire; restore omission for tool parsers. */
export function restoreOptionalToolArguments(json: string, tool: FunctionToolDefinition): string {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return json
  }
  const restore = (input: unknown, schema: Record<string, unknown>): unknown => {
    const items = schemaRecord.safeParse(schema['items'])
    if (Array.isArray(input) && items.success)
      return input.map((item: unknown) => restore(item, items.data))
    const record = schemaRecord.safeParse(input)
    const properties = schemaRecord.safeParse(schema['properties'])
    const required = z.array(z.string()).safeParse(schema['required'] ?? [])
    if (!record.success || !properties.success || !required.success) return input
    return Object.fromEntries(
      Object.entries(record.data).flatMap(([key, item]) => {
        const child = schemaRecord.safeParse(properties.data[key])
        if (!child.success) return [[key, item]]
        const type = child.data['type']
        const canAcceptNull = type === 'null' || (Array.isArray(type) && type.includes('null'))
        return item === null && !canAcceptNull && !required.data.includes(key)
          ? []
          : [[key, restore(item, child.data)]]
      }),
    )
  }
  return JSON.stringify(restore(value, tool.parameters))
}

// Conservative common strict subset. Unknown/unsupported constraints refuse
// the request rather than disappearing or changing their meaning silently.
const STRICT_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
])
const schemaRecord = z.record(z.string(), z.unknown())

function strictToolSchema(node: unknown, isOptional = false, depth = 0): Record<string, unknown> {
  const parsed = schemaRecord.safeParse(node)
  if (!parsed.success || depth > TOOL_SCHEMA_MAX_DEPTH) {
    throw new Error('strict_tool_schema_unsupported')
  }
  const schema = parsed.data
  const type = schema['type']
  if (!isGrammarType(type) || Object.keys(schema).some((key) => !STRICT_SCHEMA_KEYS.has(key))) {
    throw new Error('strict_tool_schema_unsupported')
  }
  if (schema['description'] !== undefined && typeof schema['description'] !== 'string') {
    throw new Error('strict_tool_schema_unsupported')
  }
  const types = typeof type === 'string' ? [type] : type
  // isGrammarType verified the union; parse again to narrow without a cast.
  const parsedTypes = z.array(z.string()).parse(types)
  for (const [kind, lowerKey, upperKey] of [
    ['string', 'minLength', 'maxLength'],
    ['array', 'minItems', 'maxItems'],
  ] as const) {
    for (const bound of [lowerKey, upperKey]) {
      const value = schema[bound]
      if (
        value !== undefined &&
        (typeof value !== 'number' ||
          value < 0 ||
          !Number.isSafeInteger(value) ||
          !parsedTypes.includes(kind))
      ) {
        throw new Error('strict_tool_schema_unsupported')
      }
    }
    const lower = schema[lowerKey]
    const upper = schema[upperKey]
    if (typeof lower === 'number' && typeof upper === 'number' && lower > upper) {
      throw new Error('strict_tool_schema_unsupported')
    }
  }
  const result = { ...schema }
  if (isOptional && !parsedTypes.includes('null')) {
    result['type'] = [...parsedTypes, 'null']
  }
  const values = schema['enum']
  if (values !== undefined) {
    const enumeration = z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .safeParse(values)
    if (!enumeration.success || enumeration.data.length === 0) {
      throw new Error('strict_tool_schema_unsupported')
    }
    result['enum'] =
      isOptional && !enumeration.data.includes(null)
        ? [...enumeration.data, null]
        : [...enumeration.data]
  }
  if (parsedTypes.includes('object')) {
    if (schema['additionalProperties'] !== undefined && schema['additionalProperties'] !== false) {
      throw new Error('strict_tool_schema_unsupported')
    }
    const properties = schemaRecord.safeParse(
      schema['properties'] === undefined ? {} : schema['properties'],
    )
    const required = z
      .array(z.string())
      .safeParse(schema['required'] === undefined ? [] : schema['required'])
    if (
      !properties.success ||
      !required.success ||
      required.data.some((key) => !Object.hasOwn(properties.data, key))
    ) {
      throw new Error('strict_tool_schema_unsupported')
    }
    result['properties'] = Object.fromEntries(
      Object.entries(properties.data).map(([key, value]) => [
        key,
        strictToolSchema(value, !required.data.includes(key), depth + 1),
      ]),
    )
    result['required'] = Object.keys(properties.data)
    result['additionalProperties'] = false
  } else if (
    ['properties', 'required', 'additionalProperties'].some((key) => Object.hasOwn(schema, key))
  ) {
    throw new Error('strict_tool_schema_unsupported')
  }
  if (parsedTypes.includes('array')) {
    result['items'] = strictToolSchema(schema['items'], false, depth + 1)
  } else if (Object.hasOwn(schema, 'items')) {
    throw new Error('strict_tool_schema_unsupported')
  }
  return result
}

/** JSON-schema keywords no constrained-decoding grammar takes (llama.cpp server, SoL-Pi #59/#65). */
const GRAMMAR_UNSAFE_KEYS: ReadonlySet<string> = new Set([
  '$ref',
  '$defs',
  'definitions',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'patternProperties',
  'propertyNames',
  'contains',
])

/** The primitive types a constrained-decoding grammar converts. */
const GRAMMAR_SAFE_TYPES: ReadonlySet<string> = new Set([
  'object',
  'array',
  'string',
  'integer',
  'number',
  'boolean',
  'null',
])

function isGrammarType(value: unknown): boolean {
  return typeof value === 'string'
    ? GRAMMAR_SAFE_TYPES.has(value)
    : Array.isArray(value) &&
        value.length > 0 &&
        value.every((type: unknown) => typeof type === 'string' && GRAMMAR_SAFE_TYPES.has(type))
}

/**
 * Whether a tool parameter schema converts to a constrained-decoding
 * grammar (M101 item 24): known primitive types only, no references or
 * combinators, bounded depth. Structural, not a byte limit: the byte
 * budget beside it is a regression tripwire, and the exact upstream
 * grammar limit stays a residual until a live capture names it.
 */
export function isToolSchemaGrammarSafe(node: unknown, depth = 0): boolean {
  if (depth > TOOL_SCHEMA_MAX_DEPTH) {
    return false
  }
  if (
    node === null ||
    typeof node === 'string' ||
    typeof node === 'number' ||
    typeof node === 'boolean'
  ) {
    return true
  }
  if (typeof node !== 'object') {
    return false
  }
  if (Array.isArray(node)) {
    return node.every((item: unknown) => isToolSchemaGrammarSafe(item, depth + 1))
  }
  const entries: readonly [string, unknown][] = Object.entries(node)
  return entries.every(
    ([key, value]) =>
      !GRAMMAR_UNSAFE_KEYS.has(key) &&
      (key !== 'type' || isGrammarType(value)) &&
      isToolSchemaGrammarSafe(value, depth + 1),
  )
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
  // Optional: Tab asks for no reasoning summary (M94, PLAN.md D73), so it
  // omits the key. Every existing request still sends `summary: 'auto'`,
  // whose bytes are unchanged.
  readonly reasoning: { readonly effort: string; readonly summary?: 'auto' }
  readonly stream: true
  readonly store: false
  readonly include: readonly IncludeField[]
  readonly max_output_tokens: number
  /** One key per shared prefix, not per session (promptCache.ts, M56). */
  readonly prompt_cache_key: string
  /** How long Meta is asked to keep the cached prefix; a hint (M56). */
  readonly prompt_cache_retention: PromptCacheRetention
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

/** One image, PNG, returned inline: the only generation the extension asks for. */
export interface CreateImageBody {
  readonly model: string
  readonly prompt: string
  readonly n: 1
  readonly size: string
  readonly response_format: 'b64_json'
  readonly output_format: 'png'
}

/**
 * One edited image (M44): Meta's JSON form of `POST /images/edits`, the
 * sources inline as data URLs; the answer is an `ImagesResponse`.
 */
export interface EditImageBody extends CreateImageBody {
  readonly images: readonly { readonly image_url: string }[]
}
