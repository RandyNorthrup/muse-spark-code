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
  nativeModelMetadataSchema,
  type NativeModelMetadata,
} from '../../../providers/modelMetadata'
import type { ModelCapabilityRecord } from '../../../providers/capabilityRecord'
import { capturedCapabilities } from '../../../providers/capturedCapabilities'

import {
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_FRAMES,
  ANTHROPIC_MAX_ITEM_BYTES,
  ANTHROPIC_MAX_ITEMS,
  ANTHROPIC_MAX_STREAM_BYTES,
  CODEC_EMPTY_TOOL_OUTPUT,
  CODEC_IMAGE_WITHOUT_VISION,
  HTTP_TOO_MANY_REQUESTS,
  THINKING_OFF_EFFORT,
  PROVIDER_MANUAL_THINKING_BUDGET,
} from '../../../../shared/constants'
import { UI_TEXT } from '../../../../shared/l10n/text'
import { ModelApiError } from '../transport'
import { cleanJsonStrings, cleanWireText, isBlankWireText, isRecord, nativeCallId } from './shared'
import {
  type CreateResponseBody,
  type FunctionCallItem,
  type FunctionOutputPart,
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
  readonly capabilityRecord?: ModelCapabilityRecord
  readonly thinkingBudget?: number
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
  /**
   * M101 lane P1 (BYO item 1): the model's image input, read from
   * `capabilities.vision` (lane P fills it from the model record; lane N
   * will own the normalized field). `false` sends the image-omitted
   * placeholder so the turn keeps its shape; unknown keeps today's bytes
   * and sends the image.
   */
  readonly capabilities?: { readonly vision: boolean } | undefined
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

/** M101 lane P1 (BYO item 1): a PDF sent inline, as the Messages API's `document` block. */
export interface AnthropicDocumentBlock {
  readonly type: 'document'
  readonly source: {
    readonly type: 'base64'
    readonly media_type: string
    readonly data: string
  }
  readonly cache_control?: AnthropicCacheControl
}

export type AnthropicMessageBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicDocumentBlock
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
    readonly type: 'adaptive' | 'enabled'
    readonly budget_tokens?: number
    readonly display?: 'summarized'
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

/** A canonical message's parts as this codec stages them: text, an image URL, or a parsed document. */
type StagedMessagePart =
  | { readonly text: string; readonly imageUrl?: undefined; readonly document?: undefined }
  | { readonly text?: undefined; readonly imageUrl: string; readonly document?: undefined }
  | {
      readonly text?: undefined
      readonly imageUrl?: undefined
      readonly document: AnthropicDocumentBlock
    }

/**
 * One staged part as its native block. Callers pass text parts with text
 * and image parts with a URL, so a user message built from these never
 * comes out empty (text-only stays a string, capture 03).
 */
function stagedBlock(part: StagedMessagePart, vision: boolean | undefined): AnthropicMessageBlock {
  // Image and document parts never read `text` (their branch wins below).
  const text: AnthropicTextBlock = { type: 'text', text: part.text ?? '' }
  const withoutImage = part.document ?? text
  return part.imageUrl === undefined ? withoutImage : imageOrPlaceholder(part.imageUrl, vision)
}

function userContent(
  parts: readonly StagedMessagePart[],
  vision: boolean | undefined,
): string | AnthropicMessageBlock[] {
  const blocks: AnthropicMessageBlock[] = Array.from(parts, (part) => stagedBlock(part, vision))
  return blocks.every((block): block is AnthropicTextBlock => block.type === 'text')
    ? blocks.map((block) => block.text).join('')
    : blocks
}

/** M101 lane P1 (BYO item 1): tool-result parts with blank text dropped and empty results marked. */
function toolResultContent(
  output: readonly FunctionOutputPart[],
  vision: boolean | undefined,
): string | readonly (AnthropicTextBlock | AnthropicImageBlock)[] {
  const blocks: (AnthropicTextBlock | AnthropicImageBlock)[] = []
  for (const part of output) {
    if (part.type === 'input_image') {
      blocks.push(imageOrPlaceholder(part.image_url, vision))
    } else if (!isBlankWireText(part.text)) {
      blocks.push({ type: 'text', text: cleanWireText(part.text) })
    }
  }
  return blocks.length === 0 ? CODEC_EMPTY_TOOL_OUTPUT : blocks
}

/**
 * M101 lane P1 (BYO item 1): an image, or the image-omitted placeholder
 * when the model takes no image input (`capabilities.vision === false`), so
 * the turn keeps its shape instead of breaking the request.
 */
function imageOrPlaceholder(
  imageUrl: string,
  vision: boolean | undefined,
): AnthropicTextBlock | AnthropicImageBlock {
  return vision === false
    ? { type: 'text', text: CODEC_IMAGE_WITHOUT_VISION }
    : imageBlock(imageUrl)
}

/** M101 lane P1 (BYO item 1): a PDF sent inline, as a `document` block. */
function documentBlock(fileData: string): AnthropicDocumentBlock {
  const match = DATA_URL_PATTERN.exec(fileData)
  const mediaType = match?.[1]
  const data = match?.[2]
  if (match === null || mediaType === undefined || mediaType === '' || data === undefined) {
    throw codecError('invalid_file_url')
  }
  return { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
}

/** M101 lane P1 (BYO item 1): an empty tool result rides as an explicit marker. */
function toolResultText(output: string): string {
  return isBlankWireText(output) ? CODEC_EMPTY_TOOL_OUTPUT : cleanWireText(output)
}

function toolUseBlock(
  call: FunctionCallItem,
  toolExtras: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): AnthropicToolUseBlock {
  // M101 lane P1 (BYO item 1): non-JSON arguments ride as `{}`, and lone
  // surrogates are removed (BYO 13); the call still runs instead of breaking
  // every later request (Pi `transform-messages.ts`).
  let parsed: unknown
  try {
    parsed = cleanJsonStrings(JSON.parse(cleanWireText(call.arguments)))
  } catch {
    parsed = {}
  }
  const cleaned = isRecord(parsed) ? parsed : {}
  const extras = toolExtras?.[call.call_id]
  return {
    type: 'tool_use',
    // M101 lane P1 (BYO 3): the id the format accepts, mapped deterministically.
    id: nativeCallId(call.call_id, 'anthropic'),
    name: call.name,
    input: cleaned,
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
  const record = options.capabilityRecord ?? capturedCapabilities('anthropic', options.model)
  const modes = record.reasoning.modes.state === 'yes' ? record.reasoning.modes.value : []
  const isThinking = options.effort !== THINKING_OFF_EFFORT
  if (isThinking && record.reasoning.supported.state === 'no')
    throw codecError('reasoning_unsupported')
  if (
    !isThinking &&
    (record.reasoning.forced.state === 'yes' || record.reasoning.canDisable.state === 'no')
  )
    throw codecError('thinking_cannot_disable')
  if (isThinking && !modes.includes('manual') && !modes.includes('adaptive'))
    throw codecError('unsupported_thinking_mode')
  const isManual = isThinking && modes.includes('manual') && !modes.includes('adaptive')
  const selectedEffort = isThinking && !isManual ? anthropicEffort(options.effort) : undefined
  const effort =
    selectedEffort !== undefined &&
    record.reasoning.effortLevels.state === 'yes' &&
    record.reasoning.effortLevels.value.includes(selectedEffort)
      ? selectedEffort
      : undefined
  const budget =
    options.thinkingBudget ??
    Math.max(record.reasoning.budget?.min ?? 0, PROVIDER_MANUAL_THINKING_BUDGET)
  if (
    isManual &&
    (!Number.isSafeInteger(budget) ||
      budget < Math.max(record.reasoning.budget?.min ?? 0, PROVIDER_MANUAL_THINKING_BUDGET) ||
      budget > (record.reasoning.budget?.max ?? Infinity) ||
      budget >= options.maxTokens)
  )
    throw codecError('invalid_thinking_budget')
  const ttl = options.cacheTtl ?? '5m'
  const messages: AnthropicMessage[] = []
  // Whether any reasoning item survives the replay rule below; the edit rule
  // (the `drop_block` opt-in) rides on the same answer.
  const isThinkingReplayed =
    isThinking && body.input.some((item) => replayableEnvelope(item, options.model) !== undefined)
  const shouldBindThinking =
    isThinkingReplayed && record.reasoning.replay.prefixEditPolicy === 'drop'

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

  const vision = options.capabilities?.vision
  const encodeItem = (item: InputItem): void => {
    switch (item.type) {
      case 'message': {
        // M101 lane P1 (BYO items 1, 13): blank text is dropped, lone
        // surrogates are removed, and a PDF rides as a `document` block
        // instead of breaking the request (Pi `transform-messages.ts`).
        const parts: StagedMessagePart[] = item.content.flatMap((part): StagedMessagePart[] => {
          switch (part.type) {
            case 'input_text':
            case 'output_text': {
              return isBlankWireText(part.text) ? [] : [{ text: cleanWireText(part.text) }]
            }
            case 'input_image': {
              return [{ imageUrl: part.image_url }]
            }
            case 'input_file': {
              return [{ document: documentBlock(part.file_data) }]
            }
          }
        })
        if (parts.length === 0) {
          return
        }
        if (item.role === 'assistant') {
          for (const part of parts) {
            assistantBlocks.push(stagedBlock(part, vision))
          }
          return
        }
        // `developer` has no Anthropic role; it reads as the user's words.
        flushAssistant()
        pushUser(userContent(parts, vision))
        return
      }
      case 'function_call': {
        assistantBlocks.push(toolUseBlock(item, options.toolExtras))
        return
      }
      case 'function_call_output': {
        flushAssistant()
        // The result names the mapped call id (BYO 3): the same mapping the
        // `tool_use` block above used, so the pair still matches.
        const toolUseId = nativeCallId(item.call_id, 'anthropic')
        const result: AnthropicToolResultBlock = {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content:
            typeof item.output === 'string'
              ? toolResultText(item.output)
              : toolResultContent(item.output, vision),
        }
        pushUser([result])
        return
      }
      case 'reasoning': {
        const envelope = isThinking ? replayableEnvelope(item, options.model) : undefined
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
      : [
          {
            type: 'text' as const,
            text: cleanWireText(body.instructions),
            cache_control: breakpoint,
          },
        ]
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
      ...(shouldBindThinking && { 'anthropic-beta': ANTHROPIC_BETA_DROP_BLOCK }),
    },
    body: {
      model: options.model,
      max_tokens: options.maxTokens,
      ...(system !== undefined && { system }),
      messages: nativeMessages,
      ...(nativeTools !== undefined && { tools: nativeTools }),
      ...(nativeTools !== undefined && { tool_choice: { type: 'auto' as const } }),
      stream: true,
      ...(isThinking && {
        thinking: {
          type: isManual ? ('enabled' as const) : ('adaptive' as const),
          ...(isManual && { budget_tokens: budget }),
          ...(!isManual && { display: 'summarized' as const }),
          ...(shouldBindThinking && {
            block_binding: { prefix_mismatch_behavior: 'drop_block' as const },
          }),
        },
        ...(effort !== undefined && { output_config: { effort } }),
      }),
    },
  }
}

// --- decode: Anthropic SSE to canonical events (every frame zod-parsed) ---

const anthropicUsageSchema = z.object({
  input_tokens: z.nullable(z.number()),
  cache_creation_input_tokens: z.optional(z.nullable(z.number())),
  cache_read_input_tokens: z.optional(z.nullable(z.number())),
  cache_creation: z.optional(
    z.nullable(
      z.object({
        ephemeral_5m_input_tokens: z.nullable(z.number()),
        ephemeral_1h_input_tokens: z.nullable(z.number()),
      }),
    ),
  ),
  output_tokens: z.nullable(z.number()),
  output_tokens_details: z.optional(
    z.nullable(z.object({ thinking_tokens: z.optional(z.nullable(z.number())) })),
  ),
})
type AnthropicUsage = z.infer<typeof anthropicUsageSchema>

const messageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    id: z.string(),
    model: z.optional(z.string()),
    usage: z.optional(z.nullable(anthropicUsageSchema)),
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
  usage: z.optional(z.nullable(anthropicUsageSchema)),
})

const streamErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({ type: z.optional(z.string()), message: z.string() }),
})

const frameTypeSchema = z.object({ type: z.string() })

/** Usage totals: total input is the sum of the three counters (research §1.5). */
function toUsage(usage: AnthropicUsage): Usage | undefined {
  // M101 lane P1 (BYO item 8): a proxy may null any counter it does not
  // report (Pi `anthropic-messages.ts`). Null headline counters leave the
  // usage unknown rather than counted wrong; null breakdowns count as zero.
  const input = usage.input_tokens
  const output = usage.output_tokens
  if (input === null || output === null) {
    return undefined
  }
  const created = usage.cache_creation_input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const split = usage.cache_creation ?? undefined
  const fiveMinute = split?.ephemeral_5m_input_tokens ?? 0
  const oneHour = split?.ephemeral_1h_input_tokens ?? 0
  const thinking = usage.output_tokens_details?.thinking_tokens ?? undefined
  for (const value of [input, output, created, read, fiveMinute, oneHour, thinking ?? 0]) {
    if (!Number.isFinite(value) || value < 0) {
      throw codecError('invalid_usage_counters')
    }
  }
  if (split !== undefined && fiveMinute + oneHour !== created) {
    throw codecError('invalid_cache_write_split')
  }
  return {
    input_tokens: input + created + read,
    output_tokens: output,
    total_tokens: input + created + read + output,
    input_tokens_details: {
      ...(read !== 0 && { cached_tokens: read }),
      ...(usage.cache_creation_input_tokens !== undefined && { cache_write_tokens: created }),
      ...(split !== undefined && { cache_write_tokens_1h: oneHour }),
    },
    ...(thinking !== undefined && {
      output_tokens_details: { reasoning_tokens: thinking },
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
        // M101 lane P1 (BYO item 8): a tool payload cut off at `max_tokens`
        // (or mangled by a proxy) still decodes with its partial arguments;
        // the host answers the incomplete call with an error instead of
        // running half-formed arguments (Pi `anthropic-messages.ts`).
        const source = pending.toolInput === '' ? '{}' : pending.toolInput
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
        // M101 lane P1 (BYO item 8): a proxy may send `"usage": null`.
        const startUsage = parsed.data.message.usage ?? undefined
        if (startUsage !== undefined) {
          latestUsage = startUsage
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
        const deltaUsage = parsed.data.usage ?? undefined
        if (deltaUsage !== undefined) {
          latestUsage = { ...latestUsage, ...deltaUsage }
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
    z.looseObject({
      id: z.string(),
      display_name: z.optional(z.string()),
      max_input_tokens: z.optional(z.number()),
      max_tokens: z.optional(z.number()),
      capabilities: z.optional(nativeModelMetadataSchema),
    }),
  ),
})

export interface AnthropicListedModel {
  readonly native?: NativeModelMetadata
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
    native: nativeModelMetadataSchema.parse(entry),
  }))
}
