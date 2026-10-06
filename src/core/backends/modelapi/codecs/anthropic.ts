// The Anthropic Messages codec (M95 lane A, PLAN.md D74 and M95).
//
// It turns a canonical `CreateResponseBody` into an Anthropic `POST
// /v1/messages` request and an Anthropic SSE stream back into canonical
// `StreamEvent`s ending in a canonical `ResponseObject`, so `ModelApiHost`
// keeps building one body and reading one stream. The transport (lane T)
// adds the preset's auth header and posts `path` with `body`; the registry
// (lane P) supplies the model id, output cap and capabilities; the host
// (lane I) gates web search. Nothing here touches the network,
// the clock or randomness: the same input encodes to the same bytes.
//
// Wire sources (AGENTS.md rule 13): `docs/certification/m95-captures.md`
// §Anthropic and `docs/certification/m95-captures/anthropic*/` (recorded
// 2026-10-04), plus the research §1.5 citations for request fields the
// captures never exercised (breakpoints [A-pc], the `drop_block` beta
// [A-pt], adaptive thinking [A-et, A-th]). Step 13's live turn through this
// codec rechecks the beta and the leaked-`final`-style surprises.
//
// Rules this codec owns:
// - Breakpoints: the system block and the request's last cacheable message
//   block, rolling, with TTL `5m` unless the caller injects `1h`. Only the
//   boundary marker moves; earlier content bytes remain stable (M95 tests).
// - Thinking replay: a `thinking` or `redacted_thinking` block goes back
//   byte for byte, first in its turn, only for the model that produced it
//   and only while thinking is enabled. Anything else in a canonical
//   reasoning item (another provider's envelope, a damaged envelope, a
//   model mismatch, thinking off) is dropped, never sent.
// - The edit rule: whenever a request replays thinking, it opts in to
//   `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta
//   `thinking-binding-controls-2026-08-01`), so a packing swap or an
//   omitted image earlier in the history drops the stale block server-side
//   instead of refusing the turn with a 400. Lane I therefore never needs
//   to track edits for this codec; without replayed thinking no beta is
//   sent.
// - Extra native fields the wire adds later (`tool_use.caller` and the
//   like) round-trip: decode keeps them out of the canonical item (which
//   has no channel for them), and lane I's replay wrapper hands them back
//   through `toolExtras`, keyed by call id. Unknown SSE event types are
//   tolerated; malformed known frames throw.

import * as z from 'zod/mini'

import {
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_FRAMES,
  ANTHROPIC_MAX_ITEM_BYTES,
  ANTHROPIC_MAX_ITEMS,
  ANTHROPIC_MAX_STREAM_BYTES,
  HTTP_TOO_MANY_REQUESTS,
  THINKING_OFF_EFFORT,
} from '../../../../shared/constants'
import { UI_TEXT } from '../../../../shared/l10n/text'
import { ModelApiError } from '../client'
import {
  type CreateResponseBody,
  type FunctionCallItem,
  type InputItem,
  type OutputItem,
  type ReasoningItem,
  type ResponseObject,
  type StreamEvent,
  type Usage,
} from '../schemas'
import type { SseEvent } from '../sse'

/** This codec's wire format name, for the registry's `WireCodec.format`. */
export const ANTHROPIC_FORMAT = 'anthropic' as const

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA_DROP_BLOCK = 'thinking-binding-controls-2026-08-01'
const ANTHROPIC_PATH = '/v1/messages'
const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number]
const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
const SPEND_CAP_REASON = 'enforced_spend_limit_reached'

class AnthropicCodecError extends Error {
  override readonly name = 'AnthropicCodecError'
}

/** Local errors read the installed language at the call, with stable technical codes. */
function codecError(code: string, message = UI_TEXT.anthropicCodecError): Error {
  return new AnthropicCodecError(`${message} (${code})`)
}

export interface AnthropicEncodeOptions {
  /** The native model id (`<id>` resolved from `anthropic/<id>`); never `body.model`. */
  readonly model: string
  /** The preset's output cap for this model. */
  readonly maxTokens: number
  /**
   * The canonical effort: `none` disables thinking, `minimal` maps to
   * Anthropic's lowest tier `low`, the other five map to themselves.
   */
  readonly effort: string
  /** Cache TTL for the breakpoint; `5m` unless the preset says `1h`. */
  readonly cacheTtl?: '5m' | '1h'
  /**
   * Native fields decode saw on each `tool_use` (today `caller`), keyed by
   * call id, handed back by lane I's replay wrapper so they are replayed as
   * they came (rule 13) rather than dropped.
   */
  readonly toolExtras?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export interface AnthropicNativeRequest {
  readonly path: typeof ANTHROPIC_PATH
  /**
   * Format headers only. The transport adds the preset's auth header
   * (`Authorization: Bearer` for Anthropic, `x-api-key` for compatible
   * servers) and merges `anthropic-beta` when it must add its own betas.
   */
  readonly headers: Readonly<Record<string, string>>
  readonly body: AnthropicRequestBody
}

export interface AnthropicCacheControl {
  readonly type: 'ephemeral'
  readonly ttl: '5m' | '1h'
}

export interface AnthropicSystemBlock {
  readonly type: 'text'
  readonly text: string
  readonly cache_control?: AnthropicCacheControl
}

export interface AnthropicTool {
  readonly name: string
  readonly description: string
  readonly input_schema: Readonly<Record<string, unknown>>
  readonly cache_control?: AnthropicCacheControl
}

export interface AnthropicTextBlock {
  readonly type: 'text'
  readonly text: string
  readonly cache_control?: AnthropicCacheControl
}

export interface AnthropicImageBlock {
  readonly type: 'image'
  readonly source: {
    readonly type: 'base64'
    readonly media_type: string
    readonly data: string
  }
  readonly cache_control?: AnthropicCacheControl
}

export interface AnthropicToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  /** Replayed extras (`caller`, …); absent unless `toolExtras` supplied them. */
  readonly [extra: string]: unknown
}

export interface AnthropicThinkingBlock {
  readonly type: 'thinking'
  readonly thinking: string
  readonly signature: string
}

export interface AnthropicRedactedBlock {
  readonly type: 'redacted_thinking'
  readonly data: string
}

export interface AnthropicToolResultBlock {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: string | readonly (AnthropicTextBlock | AnthropicImageBlock)[]
  readonly cache_control?: AnthropicCacheControl
}

export type AnthropicMessageBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicThinkingBlock
  | AnthropicRedactedBlock
  | AnthropicToolResultBlock

export interface AnthropicMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string | readonly AnthropicMessageBlock[]
}

export interface AnthropicRequestBody {
  readonly model: string
  readonly max_tokens: number
  readonly system?: readonly AnthropicSystemBlock[]
  readonly messages: readonly AnthropicMessage[]
  readonly tools?: readonly AnthropicTool[]
  readonly tool_choice?: { readonly type: 'auto' }
  readonly stream: true
  readonly thinking?: {
    readonly type: 'adaptive'
    readonly block_binding?: { readonly prefix_mismatch_behavior: 'drop_block' }
  }
  readonly output_config?: { readonly effort: AnthropicEffort }
}

// --- the opaque thinking envelope (research §4): only this codec reads it ---

const OPAQUE_VERSION = 1

const thinkingEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    v: z.literal(OPAQUE_VERSION),
    provider: z.literal('anthropic'),
    kind: z.literal('thinking'),
    model: z.string(),
    thinking: z.string(),
    signature: z.string(),
  }),
  z.object({
    v: z.literal(OPAQUE_VERSION),
    provider: z.literal('anthropic'),
    kind: z.literal('redacted'),
    model: z.string(),
    data: z.string(),
  }),
])
type ThinkingEnvelope = z.infer<typeof thinkingEnvelopeSchema>

/** The envelope a reasoning item carries, or undefined when it is not ours to replay. */
function envelopeOf(item: ReasoningItem): ThinkingEnvelope | undefined {
  if (typeof item.encrypted_content !== 'string' || item.encrypted_content === '') {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(item.encrypted_content)
  } catch {
    return undefined
  }
  const checked = thinkingEnvelopeSchema.safeParse(parsed)
  return checked.success ? checked.data : undefined
}

/**
 * The thinking to replay for `model`, or undefined when the item is not a
 * reasoning item, carries no readable envelope, or belongs to another model.
 */
function replayableEnvelope(item: InputItem, model: string): ThinkingEnvelope | undefined {
  if (item.type !== 'reasoning') {
    return undefined
  }
  const envelope = envelopeOf(item)
  return envelope?.model === model ? envelope : undefined
}

// --- encode ---

/** Canonical effort to Anthropic's `output_config.effort`; undefined while thinking is off. */
function anthropicEffort(effort: string): AnthropicEffort | undefined {
  if (effort === THINKING_OFF_EFFORT) {
    return undefined
  }
  if (effort === 'minimal') {
    return 'low'
  }
  if ((ANTHROPIC_EFFORTS as readonly string[]).includes(effort)) {
    return effort as AnthropicEffort
  }
  throw codecError('unsupported_reasoning_effort', UI_TEXT.anthropicCodecEffortUnsupported)
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/

function imageBlock(imageUrl: string): AnthropicImageBlock {
  const match = DATA_URL_PATTERN.exec(imageUrl)
  const mediaType = match?.[1]
  if (match === null || mediaType === undefined || match[2] === undefined) {
    throw codecError('invalid_image_url', UI_TEXT.anthropicCodecImageInvalid)
  }
  if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    throw codecError('unsupported_image_type', UI_TEXT.anthropicCodecImageInvalid)
  }
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: match[2] } }
}

/**
 * One user message's blocks from its canonical parts; text-only stays a
 * string (capture 03). Callers pass text parts with text and image parts
 * with a URL, so this never yields an empty message.
 */
function userContent(
  parts: readonly (
    | { readonly text: string; readonly imageUrl?: undefined }
    | { readonly text?: undefined; readonly imageUrl: string }
  )[],
): string | AnthropicMessageBlock[] {
  const blocks: AnthropicMessageBlock[] = Array.from(parts, (part): AnthropicMessageBlock =>
    part.imageUrl === undefined ? { type: 'text', text: part.text } : imageBlock(part.imageUrl),
  )
  return blocks.every((block): block is AnthropicTextBlock => block.type === 'text')
    ? blocks.map((block) => block.text).join('')
    : blocks
}

function toolUseBlock(
  call: FunctionCallItem,
  toolExtras: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): AnthropicToolUseBlock {
  let input: unknown
  try {
    input = JSON.parse(call.arguments) as unknown
  } catch {
    throw codecError('invalid_tool_arguments_json', UI_TEXT.anthropicCodecToolArgumentsInvalid)
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw codecError('invalid_tool_arguments_object', UI_TEXT.anthropicCodecToolArgumentsInvalid)
  }
  const extras = toolExtras?.[call.call_id]
  return {
    type: 'tool_use',
    id: call.call_id,
    name: call.name,
    input: input as Readonly<Record<string, unknown>>,
    ...extras,
  }
}

/**
 * Encode one canonical body. Consecutive same-role items merge into one
 * native message (Anthropic carries a whole turn per message); thinking
 * blocks sort first in an assistant message, as the wire requires.
 * `web_search` tools and past `web_search_call` items are Meta-only
 * (acceptance 11): they are left out, never declared.
 */
export function encodeAnthropicRequest(
  body: CreateResponseBody,
  options: AnthropicEncodeOptions,
): AnthropicNativeRequest {
  const effort = anthropicEffort(options.effort)
  const ttl = options.cacheTtl ?? '5m'
  const messages: AnthropicMessage[] = []
  // Whether any reasoning item survives the replay rule below; the edit rule
  // (the `drop_block` opt-in) rides on the same answer.
  const isThinkingReplayed =
    effort !== undefined &&
    body.input.some((item) => replayableEnvelope(item, options.model) !== undefined)

  const pushUser = (content: string | readonly AnthropicMessageBlock[]): void => {
    const last = messages.at(-1)
    if (last?.role === 'user') {
      if (typeof content === 'string' && typeof last.content === 'string') {
        messages[messages.length - 1] = { role: 'user', content: last.content + content }
      } else {
        const merged: AnthropicMessageBlock[] = [
          ...(typeof last.content === 'string'
            ? [{ type: 'text' as const, text: last.content }]
            : last.content),
          ...(typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content),
        ]
        messages[messages.length - 1] = { role: 'user', content: merged }
      }
    } else {
      messages.push({ role: 'user', content })
    }
  }

  const assistantBlocks: AnthropicMessageBlock[] = []
  const flushAssistant = (): void => {
    if (assistantBlocks.length === 0) {
      return
    }
    // Thinking must lead the turn; every other block keeps canonical order.
    const thinking = assistantBlocks.filter(
      (block): block is AnthropicThinkingBlock | AnthropicRedactedBlock =>
        block.type === 'thinking' || block.type === 'redacted_thinking',
    )
    const rest = assistantBlocks.filter(
      (block) => block.type !== 'thinking' && block.type !== 'redacted_thinking',
    )
    messages.push({ role: 'assistant', content: [...thinking, ...rest] })
    assistantBlocks.length = 0
  }

  const encodeItem = (item: InputItem): void => {
    switch (item.type) {
      case 'message': {
        type MessagePart =
          | { readonly text: string; readonly imageUrl?: undefined }
          | { readonly text?: undefined; readonly imageUrl: string }
        const parts: MessagePart[] = item.content.flatMap((part): MessagePart[] => {
          switch (part.type) {
            case 'input_text':
            case 'output_text': {
              return part.text === '' ? [] : [{ text: part.text }]
            }
            case 'input_image': {
              return [{ imageUrl: part.image_url }]
            }
            case 'input_file': {
              throw codecError('unsupported_pdf_input', UI_TEXT.anthropicCodecPdfUnsupported)
            }
          }
        })
        if (parts.length === 0) {
          return
        }
        if (item.role === 'assistant') {
          for (const part of parts) {
            assistantBlocks.push(
              part.imageUrl === undefined
                ? { type: 'text', text: part.text }
                : imageBlock(part.imageUrl),
            )
          }
          return
        }
        // `developer` has no Anthropic role; it reads as the user's words.
        flushAssistant()
        pushUser(userContent(parts))
        return
      }
      case 'function_call': {
        assistantBlocks.push(toolUseBlock(item, options.toolExtras))
        return
      }
      case 'function_call_output': {
        flushAssistant()
        const result: AnthropicToolResultBlock =
          typeof item.output === 'string'
            ? { type: 'tool_result', tool_use_id: item.call_id, content: item.output }
            : {
                type: 'tool_result',
                tool_use_id: item.call_id,
                content: item.output.map((part) =>
                  part.type === 'input_image'
                    ? imageBlock(part.image_url)
                    : { type: 'text' as const, text: part.text },
                ),
              }
        pushUser([result])
        return
      }
      case 'reasoning': {
        const envelope = effort === undefined ? undefined : replayableEnvelope(item, options.model)
        if (envelope === undefined) {
          return
        }
        assistantBlocks.push(
          envelope.kind === 'redacted'
            ? { type: 'redacted_thinking', data: envelope.data }
            : { type: 'thinking', thinking: envelope.thinking, signature: envelope.signature },
        )
        return
      }
      case 'web_search_call': {
        return
      }
    }
  }
  // A trailing developer item is a request-only suffix (goal progress in
  // M101). Keep its text in a separate native block even when the preceding
  // user message would otherwise concatenate, and cache only the prefix.
  let cacheBoundary: { messageCount: number; lastBlockCount: number } | undefined
  for (const [index, item] of body.input.entries()) {
    if (index === body.input.length - 1 && item.type === 'message' && item.role === 'developer') {
      flushAssistant()
      const last = messages.at(-1)
      if (last !== undefined && typeof last.content === 'string') {
        messages[messages.length - 1] = {
          role: last.role,
          content: [{ type: 'text', text: last.content }],
        }
      }
      const content = messages.at(-1)?.content
      cacheBoundary = {
        messageCount: messages.length,
        lastBlockCount: Array.isArray(content) ? content.length : 0,
      }
    }
    encodeItem(item)
  }
  flushAssistant()
  if (messages.length === 0) {
    throw codecError('empty_turn', UI_TEXT.anthropicCodecEmptyTurn)
  }

  const tools = body.tools.filter((tool) => tool.type === 'function')
  const breakpoint: AnthropicCacheControl = { type: 'ephemeral', ttl }
  const system =
    body.instructions === ''
      ? undefined
      : [{ type: 'text' as const, text: body.instructions, cache_control: breakpoint }]
  const nativeTools =
    tools.length === 0
      ? undefined
      : tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }))
  const nativeMessages = messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : [...message.content],
  }))
  // Signed thinking cannot carry cache_control; it is replayed byte-exact.
  // Select the final eligible block, without leaving old rolling markers.
  const cacheable = nativeMessages.slice(0, cacheBoundary?.messageCount)
  for (const message of cacheable.toReversed()) {
    const content =
      cacheBoundary !== undefined && message === cacheable.at(-1)
        ? message.content.slice(0, cacheBoundary.lastBlockCount)
        : message.content
    const index = content.findLastIndex(
      (block) => block.type !== 'thinking' && block.type !== 'redacted_thinking',
    )
    const last = message.content[index]
    if (last !== undefined && last.type !== 'thinking' && last.type !== 'redacted_thinking') {
      message.content[index] = { ...last, cache_control: breakpoint }
      break
    }
  }

  return {
    path: ANTHROPIC_PATH,
    headers: {
      'anthropic-version': ANTHROPIC_VERSION,
      ...(isThinkingReplayed && { 'anthropic-beta': ANTHROPIC_BETA_DROP_BLOCK }),
    },
    body: {
      model: options.model,
      max_tokens: options.maxTokens,
      ...(system !== undefined && { system }),
      messages: nativeMessages,
      ...(nativeTools !== undefined && { tools: nativeTools }),
      ...(nativeTools !== undefined && { tool_choice: { type: 'auto' as const } }),
      stream: true,
      ...(effort !== undefined && {
        thinking: {
          type: 'adaptive' as const,
          ...(isThinkingReplayed && {
            block_binding: { prefix_mismatch_behavior: 'drop_block' as const },
          }),
        },
        output_config: { effort },
      }),
    },
  }
}

// --- decode: Anthropic SSE to canonical events (every frame zod-parsed) ---

const anthropicUsageSchema = z.object({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.optional(z.number()),
  cache_read_input_tokens: z.optional(z.number()),
  cache_creation: z.optional(
    z.object({
      ephemeral_5m_input_tokens: z.number(),
      ephemeral_1h_input_tokens: z.number(),
    }),
  ),
  output_tokens: z.number(),
  output_tokens_details: z.optional(
    z.nullable(z.object({ thinking_tokens: z.optional(z.number()) })),
  ),
})
type AnthropicUsage = z.infer<typeof anthropicUsageSchema>

const messageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    id: z.string(),
    model: z.optional(z.string()),
    usage: z.optional(anthropicUsageSchema),
  }),
})

const toolUseStartSchema = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
})

const redactedStartSchema = z.object({
  type: z.literal('redacted_thinking'),
  data: z.string(),
})

// `looseObject`: the inner block is re-parsed per type below, so its keys
// must survive the outer parse (a plain `object` would strip them).
const contentBlockStartSchema = z.object({
  type: z.literal('content_block_start'),
  index: z.number(),
  content_block: z.looseObject({ type: z.string() }),
})

const textDeltaSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
})

const inputJsonDeltaSchema = z.object({
  type: z.literal('input_json_delta'),
  partial_json: z.string(),
})

const thinkingDeltaSchema = z.object({
  type: z.literal('thinking_delta'),
  thinking: z.string(),
})

const signatureDeltaSchema = z.object({
  type: z.literal('signature_delta'),
  signature: z.string(),
})

const contentBlockDeltaSchema = z.object({
  type: z.literal('content_block_delta'),
  index: z.number(),
  delta: z.looseObject({ type: z.string() }),
})

const contentBlockStopSchema = z.object({
  type: z.literal('content_block_stop'),
  index: z.number(),
})

const messageDeltaSchema = z.object({
  type: z.literal('message_delta'),
  delta: z.object({ stop_reason: z.optional(z.nullable(z.string())) }),
  usage: z.optional(anthropicUsageSchema),
})

const streamErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({ type: z.optional(z.string()), message: z.string() }),
})

const frameTypeSchema = z.object({ type: z.string() })

/** Usage totals: total input is the sum of the three counters (research §1.5). */
function toUsage(usage: AnthropicUsage): Usage {
  for (const value of [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens ?? 0,
    usage.cache_read_input_tokens ?? 0,
    usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    usage.output_tokens_details?.thinking_tokens ?? 0,
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw codecError('invalid_usage_counters')
    }
  }
  const created = usage.cache_creation_input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const split = usage.cache_creation
  if (
    split !== undefined &&
    split.ephemeral_5m_input_tokens + split.ephemeral_1h_input_tokens !== created
  ) {
    throw codecError('invalid_cache_write_split')
  }
  return {
    input_tokens: usage.input_tokens + created + read,
    output_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens + created + read + usage.output_tokens,
    input_tokens_details: {
      ...(read !== 0 && { cached_tokens: read }),
      ...(usage.cache_creation_input_tokens !== undefined && { cache_write_tokens: created }),
      ...(split !== undefined && { cache_write_tokens_1h: split.ephemeral_1h_input_tokens }),
    },
    ...(usage.output_tokens_details?.thinking_tokens !== undefined && {
      output_tokens_details: { reasoning_tokens: usage.output_tokens_details.thinking_tokens },
    }),
  }
}

type StopOutcome = { status: 'completed' } | { status: 'incomplete'; reason: string }

function stopOutcome(stopReason: string | null | undefined): StopOutcome {
  switch (stopReason) {
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence': {
      return { status: 'completed' }
    }
    case 'max_tokens':
    case 'refusal':
    case 'pause_turn': {
      return { status: 'incomplete', reason: stopReason }
    }
    case null:
    case undefined: {
      return { status: 'incomplete', reason: 'missing_stop_reason' }
    }
    default: {
      return { status: 'incomplete', reason: stopReason }
    }
  }
}

interface PendingBlock {
  kind: 'text' | 'tool_use' | 'thinking' | 'redacted' | 'other'
  bytes: number
  toolInputBytes: number
  text: string
  thinking: string
  signature: string
  redacted: string
  toolId: string
  toolName: string
  toolInput: string
  extras: Record<string, unknown>
}

function emptyBlock(): PendingBlock {
  return {
    kind: 'other',
    bytes: 0,
    toolInputBytes: 0,
    text: '',
    thinking: '',
    signature: '',
    redacted: '',
    toolId: '',
    toolName: '',
    toolInput: '',
    extras: {},
  }
}

export interface AnthropicDecodeOptions {
  /** The BYO model id this turn ran on; stored in replayed envelopes. */
  readonly model: string
  /**
   * Receives each `tool_use` block's extra native fields (`caller`, …) as
   * decode finishes the block, so lane I's replay wrapper can hand them
   * back to `encodeAnthropicRequest` through `toolExtras` (rule 13).
   */
  readonly onToolExtras?: (callId: string, extras: Readonly<Record<string, unknown>>) => void
}

type ContentBlockWire = z.infer<typeof contentBlockStartSchema>['content_block']
type DeltaWire = z.infer<typeof contentBlockDeltaSchema>['delta']

/** A started block's accumulator and the `added` event for it, if it carries one. */
function startPendingBlock(
  raw: ContentBlockWire,
  itemId: string,
): { pending: PendingBlock; added: StreamEvent | undefined } {
  if (raw.type === 'text') {
    const pending = emptyBlock()
    pending.kind = 'text'
    return {
      pending,
      added: {
        type: 'response.output_item.added',
        item: { type: 'message', id: itemId, role: 'assistant', content: [] },
      },
    }
  }
  if (raw.type === 'tool_use') {
    const tool = toolUseStartSchema.safeParse(raw)
    if (!tool.success) {
      throw codecError('malformed_tool_use_start')
    }
    const pending = emptyBlock()
    pending.kind = 'tool_use'
    pending.toolId = tool.data.id
    pending.toolName = tool.data.name
    for (const [key, value] of Object.entries(tool.data)) {
      if (key !== 'type' && key !== 'id' && key !== 'name' && key !== 'input') {
        pending.extras[key] = value
      }
    }
    return {
      pending,
      added: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: tool.data.id,
          call_id: tool.data.id,
          name: tool.data.name,
          arguments: '',
        },
      },
    }
  }
  if (raw.type === 'thinking') {
    const pending = emptyBlock()
    pending.kind = 'thinking'
    return {
      pending,
      added: { type: 'response.output_item.added', item: { type: 'reasoning', id: itemId } },
    }
  }
  if (raw.type === 'redacted_thinking') {
    const redacted = redactedStartSchema.safeParse(raw)
    if (!redacted.success) {
      throw codecError('malformed_redacted_start')
    }
    const pending = emptyBlock()
    pending.kind = 'redacted'
    pending.redacted = redacted.data.data
    return {
      pending,
      added: { type: 'response.output_item.added', item: { type: 'reasoning', id: itemId } },
    }
  }
  // A future block type (research §1.5 names `fallback`): carried as
  // nothing, dropped at its stop.
  return { pending: emptyBlock(), added: undefined }
}

/** Check bytes before retaining a delta, including signature and tool arguments. */
function appendBlock(
  pending: PendingBlock,
  field: 'text' | 'toolInput' | 'thinking' | 'signature',
  value: string,
): void {
  const bytes = Buffer.byteLength(value, 'utf8')
  if (field === 'toolInput' && pending.toolInputBytes + bytes > ANTHROPIC_MAX_ARGUMENT_BYTES) {
    throw codecError('argument_limit', UI_TEXT.anthropicCodecLimitExceeded)
  }
  if (pending.bytes + bytes > ANTHROPIC_MAX_ITEM_BYTES) {
    throw codecError('item_bytes_limit', UI_TEXT.anthropicCodecLimitExceeded)
  }
  pending.bytes += bytes
  if (field === 'toolInput') pending.toolInputBytes += bytes
  pending[field] += value
}

/** Fold one delta into its block, returning the canonical events for it. */
function applyDelta(pending: PendingBlock, itemId: string, raw: DeltaWire): StreamEvent[] {
  if (raw.type === 'text_delta') {
    const parsed = textDeltaSchema.safeParse(raw)
    if (!parsed.success || pending.kind !== 'text') {
      throw codecError('malformed_text_delta')
    }
    const text = parsed.data.text
    appendBlock(pending, 'text', text)
    return text === '' ? [] : [{ type: 'response.output_text.delta', item_id: itemId, delta: text }]
  }
  if (raw.type === 'input_json_delta') {
    const parsed = inputJsonDeltaSchema.safeParse(raw)
    if (!parsed.success || pending.kind !== 'tool_use') {
      throw codecError('malformed_input_json_delta')
    }
    const fragment = parsed.data.partial_json
    appendBlock(pending, 'toolInput', fragment)
    return fragment === ''
      ? []
      : [
          {
            type: 'response.function_call_arguments.delta',
            item_id: pending.toolId,
            delta: fragment,
          },
        ]
  }
  if (raw.type === 'thinking_delta') {
    const parsed = thinkingDeltaSchema.safeParse(raw)
    if (!parsed.success || pending.kind !== 'thinking') {
      throw codecError('malformed_thinking_delta')
    }
    const thinking = parsed.data.thinking
    appendBlock(pending, 'thinking', thinking)
    return thinking === ''
      ? []
      : [{ type: 'response.reasoning_summary_text.delta', item_id: itemId, delta: thinking }]
  }
  if (raw.type === 'signature_delta') {
    const parsed = signatureDeltaSchema.safeParse(raw)
    if (!parsed.success || pending.kind !== 'thinking') {
      throw codecError('malformed_signature_delta')
    }
    appendBlock(pending, 'signature', parsed.data.signature)
    return []
  }
  return []
}

/**
 * Decode an Anthropic SSE stream (frames as `parseSse` yields them) into
 * canonical events, ending in one terminal response event. Unknown event
 * types are tolerated; a mid-stream `error` event becomes the canonical
 * `error` event and ends the stream.
 */
export async function* decodeAnthropicStream(
  frames: AsyncIterable<SseEvent> | Iterable<SseEvent>,
  options: AnthropicDecodeOptions,
): AsyncGenerator<StreamEvent> {
  let messageId = ''
  let streamBytes = 0
  let frameCount = 0
  let itemCount = 0
  let latestUsage: AnthropicUsage | undefined
  let stop: StopOutcome = { status: 'incomplete', reason: 'missing_stop_reason' }
  const output: OutputItem[] = []
  const blocks = new Map<number, PendingBlock>()
  const blockItemId = (index: number): string => `anthropic-${messageId}-${String(index)}`

  const block = (index: number): PendingBlock => {
    const found = blocks.get(index)
    if (found === undefined) {
      throw codecError('missing_block_start')
    }
    return found
  }

  const finishBlock = function* (index: number): Generator<StreamEvent> {
    const pending = block(index)
    blocks.delete(index)
    const itemId = blockItemId(index)
    switch (pending.kind) {
      case 'text': {
        const item = {
          type: 'message' as const,
          id: itemId,
          role: 'assistant',
          content: [{ type: 'output_text' as const, text: pending.text }],
        }
        output.push(item)
        yield { type: 'response.output_item.done', item }
        break
      }
      case 'thinking': {
        const envelope = JSON.stringify({
          v: OPAQUE_VERSION,
          provider: ANTHROPIC_FORMAT,
          kind: 'thinking',
          model: options.model,
          thinking: pending.thinking,
          signature: pending.signature,
        })
        const item: ReasoningItem = {
          type: 'reasoning',
          id: itemId,
          ...(pending.thinking !== '' && {
            summary: [{ type: 'summary_text', text: pending.thinking }],
          }),
          encrypted_content: envelope,
        }
        output.push(item)
        yield { type: 'response.output_item.done', item }
        break
      }
      case 'redacted': {
        const envelope = JSON.stringify({
          v: OPAQUE_VERSION,
          provider: ANTHROPIC_FORMAT,
          kind: 'redacted',
          model: options.model,
          data: pending.redacted,
        })
        const item: ReasoningItem = { type: 'reasoning', id: itemId, encrypted_content: envelope }
        output.push(item)
        yield { type: 'response.output_item.done', item }
        break
      }
      case 'tool_use': {
        const source = pending.toolInput === '' ? '{}' : pending.toolInput
        try {
          JSON.parse(source)
        } catch {
          throw codecError('invalid_tool_json')
        }
        const item: FunctionCallItem = {
          type: 'function_call',
          id: pending.toolId,
          call_id: pending.toolId,
          name: pending.toolName,
          arguments: source,
        }
        output.push(item)
        if (Object.keys(pending.extras).length > 0) {
          options.onToolExtras?.(pending.toolId, pending.extras)
        }
        yield {
          type: 'response.function_call_arguments.done',
          item_id: pending.toolId,
          arguments: item.arguments,
        }
        yield { type: 'response.output_item.done', item }
        break
      }
      case 'other': {
        break
      }
    }
  }

  for await (const frame of frames) {
    const bytes =
      Buffer.byteLength(frame.data, 'utf8') + Buffer.byteLength(frame.event ?? '', 'utf8')
    if (bytes > ANTHROPIC_MAX_FRAME_BYTES) {
      throw codecError('frame_bytes_limit', UI_TEXT.anthropicCodecLimitExceeded)
    }
    streamBytes += bytes
    frameCount += 1
    if (streamBytes > ANTHROPIC_MAX_STREAM_BYTES || frameCount > ANTHROPIC_MAX_FRAMES) {
      throw codecError('stream_limit', UI_TEXT.anthropicCodecLimitExceeded)
    }
    let data: unknown
    try {
      data = JSON.parse(frame.data)
    } catch {
      throw codecError('non_json_frame')
    }
    const kind = frameTypeSchema.safeParse(data)
    if (!kind.success) {
      throw codecError('missing_frame_type')
    }
    switch (kind.data.type) {
      case 'message_start': {
        const parsed = messageStartSchema.safeParse(data)
        if (!parsed.success) {
          throw codecError('malformed_message_start')
        }
        messageId = parsed.data.message.id
        if (parsed.data.message.usage !== undefined) {
          latestUsage = parsed.data.message.usage
        }
        yield {
          type: 'response.created',
          response: emptyResponse(messageId, options.model, output, undefined),
        }
        yield {
          type: 'response.in_progress',
          response: emptyResponse(messageId, options.model, output, undefined),
        }
        continue
      }
      case 'content_block_start': {
        const parsed = contentBlockStartSchema.safeParse(data)
        if (!parsed.success) {
          throw codecError('malformed_content_block_start')
        }
        itemCount += 1
        if (itemCount > ANTHROPIC_MAX_ITEMS) {
          throw codecError('item_count_limit', UI_TEXT.anthropicCodecLimitExceeded)
        }
        const started = startPendingBlock(parsed.data.content_block, blockItemId(parsed.data.index))
        started.pending.bytes = Buffer.byteLength(JSON.stringify(parsed.data.content_block), 'utf8')
        blocks.set(parsed.data.index, started.pending)
        if (started.added !== undefined) {
          yield started.added
        }
        continue
      }
      case 'content_block_delta': {
        const parsed = contentBlockDeltaSchema.safeParse(data)
        if (!parsed.success) {
          throw codecError('malformed_content_block_delta')
        }
        const pending = block(parsed.data.index)
        // Any other delta shape is tolerated and ignored (rule 13: the wire
        // evolves additively; captures §Anthropic).
        yield* applyDelta(pending, blockItemId(parsed.data.index), parsed.data.delta)
        continue
      }
      case 'content_block_stop': {
        const parsed = contentBlockStopSchema.safeParse(data)
        if (!parsed.success) {
          throw codecError('malformed_content_block_stop')
        }
        yield* finishBlock(parsed.data.index)
        continue
      }
      case 'message_delta': {
        const parsed = messageDeltaSchema.safeParse(data)
        if (!parsed.success) {
          throw codecError('malformed_message_delta')
        }
        stop = stopOutcome(parsed.data.delta.stop_reason)
        if (parsed.data.usage !== undefined) {
          latestUsage = { ...latestUsage, ...parsed.data.usage }
        }
        continue
      }
      case 'message_stop': {
        for (const index of blocks.keys()) {
          yield* finishBlock(index)
        }
        if (messageId === '') {
          throw codecError('missing_message_start')
        }
        const usage = latestUsage === undefined ? undefined : toUsage(latestUsage)
        const response = emptyResponse(messageId, options.model, output, usage)
        if (stop.status === 'completed') {
          yield { type: 'response.completed', response: { ...response, status: 'completed' } }
        } else {
          yield {
            type: 'response.incomplete',
            response: {
              ...response,
              status: 'incomplete',
              incomplete_details: { reason: stop.reason },
            },
          }
        }
        return
      }
      case 'ping': {
        continue
      }
      case 'error': {
        const parsed = streamErrorSchema.safeParse(data)
        if (!parsed.success) {
          throw codecError('malformed_stream_error')
        }
        yield {
          type: 'error',
          code: parsed.data.error.type ?? undefined,
          message: parsed.data.error.message,
        }
        return
      }
      default: {
        // Unknown event types must be tolerated (research §1.5, [A-st]).
        continue
      }
    }
  }
  throw codecError('missing_message_stop')
}

function emptyResponse(
  id: string,
  model: string,
  output: OutputItem[],
  usage: Usage | undefined,
): ResponseObject {
  return { id, status: 'in_progress', model, output, usage: usage ?? null }
}

// --- errors: the envelope to `ModelApiError` (lane T retries from this) ---

const anthropicErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({ type: z.string(), message: z.string() }),
})

/**
 * Map a non-2xx Messages answer to `ModelApiError`: the envelope's message,
 * its `error.type` as the kind, and — for a 429 whose prose names the spend
 * cap (research §1.5, [A-rl]) — that reason as the code, so the transport
 * never retries what no wait would fix. Anything unenveloped falls back to
 * the status, as the Meta client does.
 */
export function parseAnthropicError(status: number, body: unknown): ModelApiError {
  const parsed = anthropicErrorSchema.safeParse(body)
  if (!parsed.success) {
    return new ModelApiError(`HTTP ${String(status)}`, status, undefined, undefined)
  }
  const { type, message } = parsed.data.error
  const isSpendCapped = status === HTTP_TOO_MANY_REQUESTS && message.includes(SPEND_CAP_REASON)
  return new ModelApiError(message, status, type, isSpendCapped ? SPEND_CAP_REASON : undefined)
}

// --- models list: `GET /v1/models` (capture 01; the scan lives in lane P) ---

const anthropicModelsListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.optional(z.string()),
      max_input_tokens: z.optional(z.number()),
      max_tokens: z.optional(z.number()),
    }),
  ),
})

export interface AnthropicListedModel {
  readonly id: string
  readonly displayName: string | undefined
  readonly maxInputTokens: number | undefined
  readonly maxTokens: number | undefined
}

/** The validated entries of a list answer; lane P maps these to capabilities and prices. */
export function parseAnthropicModelsList(body: unknown): AnthropicListedModel[] {
  const parsed = anthropicModelsListSchema.safeParse(body)
  if (!parsed.success) {
    throw codecError('invalid_models_list')
  }
  return parsed.data.data.map((entry) => ({
    id: entry.id,
    displayName: entry.display_name,
    maxInputTokens: entry.max_input_tokens,
    maxTokens: entry.max_tokens,
  }))
}
