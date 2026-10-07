import { Usd, type UsdAmount } from '../../../../shared/usd'
// The Chat Completions wire codec (PLAN.md D74, M95 lane H): the shared
// implementation behind every `chat` preset (OpenRouter, Groq, DeepSeek,
// Mistral, Together, Fireworks, Hugging Face's router, Z.ai, local servers
// and Custom servers). Each preset's quirks arrive as data in
// `ChatPresetQuirks` (lane P fills them from `presets.ts`); this file holds
// no preset values, only the family's shared shape.
//
// Wire shapes below come from the 2026-10-04 captures in
// `docs/certification/m95-captures/<provider>/` (see
// `docs/certification/m95-captures.md`): the request bodies of each
// preset's tool-call stream, the follow-up carrying the tool result, and
// the streamed chunks (whole calls, fragments, parallel calls, usage on
// the finish chunk or on a `choices: []` chunk). Fields the wire later
// adds to a reasoning detail survive replay; unknown finish reasons
// end incomplete with their original reason retained.
//
// The codec is a pure function of its inputs: no clock, no random ids, keys
// in a fixed order, so requests n and n+1 of a session share every earlier
// native byte (acceptance 4). Lane T wraps `encodeChatRequest` and
// `ChatStreamDecoder` in its `WireCodec` (research §4); lane I stores the
// decoder's opaque reasoning payloads in the session's replay entries.

import type { ModelCapabilities } from '../../../providers/capabilities'
import * as z from 'zod/mini'
import {
  CODEC_EMPTY_TOOL_OUTPUT,
  CODEC_IMAGE_WITHOUT_VISION,
  UI_TEXT,
} from '../../../../shared/constants'
import { cleanWireText, isBlankWireText, nativeCallId, type CallIdFormat } from './shared'
export { parseNativeModelsList as parseChatModelsList } from '../../../providers/modelMetadata'
import type {
  CreateResponseBody,
  FunctionOutputPart,
  InputContentPart,
  InputItem,
  ResponseObject,
  StreamEvent,
  Usage,
} from '../schemas'
import { withStrictTools } from '../schemas'

/** The format name lane T's `WireCodec` carries for this codec. */
export const CHAT_CODEC_FORMAT = 'chat' as const

// --- preset quirks (lane P's data) ---

/** Which reasoning field a preset replays on its assistant messages. */
export type ChatReplayField = 'details' | 'content' | 'text' | 'none'

/**
 * The family's quirks as data, one value per preset from `presets.ts`:
 * the output-cap parameter, the reasoning request parameter, which extras
 * travel (`prompt_cache_key`, `stream_options.include_usage`, Z.ai's
 * `tool_stream`), whether tool results name their function (Mistral's
 * capture replays `name`), which reasoning field replays, and OpenRouter's
 * fixed routing object plus attribution headers.
 */
export interface ChatPresetQuirks {
  /** Selected model's effective supportsStrictTools; absent stays off. */
  readonly supportsStrictTools?: boolean | undefined
  /** The preset id (`openrouter`, `groq`, …); binds replayed reasoning. */
  readonly presetId: string
  /** The configured provider id; defaults to the preset id for that preset. */
  readonly providerId?: string | undefined
  /** The output-cap parameter the preset accepts. */
  readonly outputCap: 'max_tokens' | 'max_completion_tokens'
  /**
   * The reasoning request parameter: none (Mistral, Z.ai), OpenRouter's
   * `reasoning: {effort}` object, or the flat `reasoning_effort` string.
   */
  readonly reasoningParam: 'none' | 'effort-object' | 'effort-flat'
  /**
   * Maps the canonical effort (`body.reasoning.effort`) to the preset's
   * own level names. Absent means the effort goes as it came.
   */
  readonly effortMap?: Readonly<Record<string, string>> | undefined
  /** Send `prompt_cache_key` (Mistral, Fireworks in the captures). */
  readonly sendCacheKey: boolean
  /** Send `stream_options: {include_usage: true}` (every capture). */
  readonly includeUsage: boolean
  /** Send Z.ai's `tool_stream: true`, which fragments tool arguments. */
  readonly toolStream: boolean
  /**
   * Send `parallel_tool_calls` (research: Groq rejects unknown fields, so
   * this travels only where the preset says so; absent means omitted).
   */
  readonly parallelToolCalls?: boolean | undefined
  /** Local/custom presets may omit the tool choice parameter. */
  readonly toolChoice?: 'auto' | 'omit' | undefined
  /** Name the function on `tool` messages (Mistral's capture does). */
  readonly toolResultName: boolean
  /** Which reasoning field replays; `none` drops it. */
  readonly replayField: ChatReplayField
  /** OpenRouter's fixed routing object (`{zdr: true}` by default). */
  readonly routing?: ChatRouting | undefined
  /** Extra headers, in order (OpenRouter's three attribution headers). */
  readonly extraHeaders?: readonly (readonly [string, string])[] | undefined
}

/** OpenRouter's routing object; emitted in this fixed key order. */
export interface ChatRouting {
  readonly zdr?: boolean | undefined
  readonly dataCollection?: 'allow' | 'deny' | undefined
  readonly order?: readonly string[] | undefined
  readonly allowFallbacks?: boolean | undefined
}

/** Where Anthropic-style breakpoints go on this request. */
export type ChatBreakpoints = 'none' | 'anthropic' | 'last'

/** Per-request options: the native model id and the breakpoint placement. */
export interface ChatEncodeOptions {
  /** The caller's model capability record; unknown vision is refused. */
  readonly capabilities?: Pick<ModelCapabilities, 'vision' | 'supportsStrictTools'> | undefined
  /**
   * `anthropic` marks the system block and the last text block (OpenRouter
   * to an Anthropic upstream, as the `anthropic` codec's rule); `last`
   * marks only the last text block (a Gemini upstream); `none` sends
   * plain strings. Lane I picks this from the model's route.
   */
  readonly cacheBreakpoints?: ChatBreakpoints | undefined
}

// --- native request (what the transport sends) ---

export interface ChatTextPart {
  readonly type: 'text'
  readonly text: string
  readonly cache_control?: { readonly type: 'ephemeral' } | undefined
}

/** Chat's standard image-understanding input, independent of paid generation. */
export interface ChatImagePart {
  readonly type: 'image_url'
  readonly image_url: { readonly url: string; readonly detail: 'auto' }
}

export interface ChatSystemMessage {
  readonly role: 'system'
  readonly content: string | readonly ChatTextPart[]
}

export interface ChatUserMessage {
  readonly role: 'user'
  readonly content: string | readonly (ChatTextPart | ChatImagePart)[]
}

export interface ChatToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

export interface ChatAssistantMessage {
  readonly role: 'assistant'
  readonly content: string | readonly ChatTextPart[] | null
  readonly tool_calls?: readonly ChatToolCall[] | undefined
  /** OpenRouter: the streamed `reasoning_details`, unmodified, in order. */
  readonly reasoning_details?: readonly unknown[] | undefined
  /** DeepSeek, Fireworks, Z.ai: the turn's `reasoning_content`. */
  readonly reasoning_content?: string | undefined
  /** Groq, Together, Hugging Face: the turn's `reasoning` text. */
  readonly reasoning?: string | undefined
}

export interface ChatToolMessage {
  readonly role: 'tool'
  readonly tool_call_id: string
  readonly content: string | readonly ChatTextPart[]
  readonly name?: string | undefined
}

export type ChatMessage =
  ChatSystemMessage | ChatUserMessage | ChatAssistantMessage | ChatToolMessage

export interface ChatFunctionTool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    /** The JSON schema, rewritten the same way every time (no key sorting). */
    readonly parameters: Record<string, unknown>
    readonly strict?: boolean | undefined
  }
}

/**
 * The native request body, built in this fixed key order: model, messages,
 * tools, tool_choice, parallel_tool_calls, stream, stream_options, the
 * output cap, provider, reasoning, prompt_cache_key, tool_stream.
 */
export interface ChatCompletionRequest {
  readonly model: string
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ChatFunctionTool[] | undefined
  readonly tool_choice?: 'auto' | undefined
  readonly parallel_tool_calls?: boolean | undefined
  readonly stream: true
  readonly stream_options?: { readonly include_usage: true } | undefined
  readonly max_tokens?: number | undefined
  readonly max_completion_tokens?: number | undefined
  readonly prompt_cache_key?: string | undefined
  readonly tool_stream?: true | undefined
  readonly provider?:
    | {
        readonly zdr?: boolean | undefined
        readonly data_collection?: 'allow' | 'deny' | undefined
        readonly order?: readonly string[] | undefined
        readonly allow_fallbacks?: boolean | undefined
      }
    | undefined
  readonly reasoning?: { readonly effort: string } | undefined
  readonly reasoning_effort?: string | undefined
}

/** What the transport sends: codec-owned headers plus the JSON body. */
export interface ChatNativeRequest {
  /** Only the codec's extras (OpenRouter's attribution); auth is lane T's. */
  readonly headers: readonly (readonly [string, string])[]
  readonly body: ChatCompletionRequest
}

// --- opaque reasoning replay (research §4) ---

/**
 * The chat codec's half of a canonical reasoning item's `encrypted_content`:
 * the streamed reasoning kept verbatim (details in order, concatenated
 * text) with the preset id that produced it. Only this codec reads it, and
 * only for the same preset: switching providers drops it (acceptance 12).
 */
export interface ChatReasoningPayload {
  readonly v: 1
  readonly provider: string
  readonly model: string
  readonly text?: string | undefined
  readonly details?: readonly unknown[] | undefined
}

const CHAT_PAYLOAD_KEY = 'chat'

function opaqueReasoning(
  provider: string,
  model: string,
  text: string,
  details: readonly unknown[],
): string {
  const payload: ChatReasoningPayload = {
    v: 1,
    provider,
    model,
    ...(text !== '' && { text }),
    ...(details.length > 0 && { details }),
  }
  return JSON.stringify({ [CHAT_PAYLOAD_KEY]: payload })
}

/** Reads this codec's payload back; anything else (or another preset) is undefined. */
export function readChatReasoning(
  encryptedContent: string | null | undefined,
  providerId: string,
  model: string,
): ChatReasoningPayload | undefined {
  if (typeof encryptedContent !== 'string' || encryptedContent === '') {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(encryptedContent)
  } catch {
    return undefined
  }
  const result = chatReasoningEnvelopeSchema.safeParse(parsed)
  return !result.success ||
    result.data.chat.provider !== providerId ||
    result.data.chat.model !== model
    ? undefined
    : result.data.chat
}

const chatReasoningEnvelopeSchema = z.object({
  chat: z.object({
    v: z.literal(1),
    provider: z.string(),
    model: z.string(),
    text: z.optional(z.string()),
    details: z.optional(z.array(z.record(z.string(), z.unknown()))),
  }),
})

// --- encode: canonical body to a native request ---

function textOfParts(parts: readonly InputContentPart[]): string {
  // M101 lane P1 (BYO items 1, 13): blank text is dropped and lone
  // surrogates are removed (Pi `transform-messages.ts`).
  return parts
    .flatMap((part) => {
      if (part.type === 'input_text' || part.type === 'output_text') {
        return isBlankWireText(part.text) ? [] : [cleanWireText(part.text)]
      }
      throw new Error(UI_TEXT.execUnknownModel)
    })
    .join('')
}

function contentOfParts(
  parts: readonly InputContentPart[],
  vision: boolean | undefined,
): ChatUserMessage['content'] {
  if (parts.every((part) => part.type !== 'input_image')) {
    return textOfParts(parts)
  }
  if (vision === undefined) {
    throw new Error(UI_TEXT.execUnknownModel)
  }
  // M101 lane P1 (BYO item 1): media rides as the image-omitted placeholder
  // where the model takes no images, so the turn keeps its shape.
  const blocks: (ChatTextPart | ChatImagePart)[] = []
  for (const part of parts) {
    if (part.type === 'input_image') {
      blocks.push(
        vision
          ? { type: 'image_url', image_url: { url: part.image_url, detail: part.detail } }
          : { type: 'text', text: CODEC_IMAGE_WITHOUT_VISION },
      )
    } else if (part.type === 'input_text' || part.type === 'output_text') {
      if (!isBlankWireText(part.text)) {
        blocks.push({ type: 'text', text: cleanWireText(part.text) })
      }
    } else {
      throw new Error(UI_TEXT.execUnknownModel)
    }
  }
  return blocks
}

/** Chat tool messages carry text; image results follow in a user message. */
function toolOutputText(output: string | readonly FunctionOutputPart[]): string {
  const text =
    typeof output === 'string'
      ? output
      : output
          .filter((part) => part.type === 'input_text')
          .map((part) => part.text)
          .join('')
  // M101 lane P1 (BYO item 1): an empty result rides as an explicit marker.
  return isBlankWireText(text) ? CODEC_EMPTY_TOOL_OUTPUT : cleanWireText(text)
}

/** M101 lane P1 (BYO 3): Mistral's 9-alphanumeric ids, every other preset's chat rule. */
function callIdFormat(quirks: ChatPresetQuirks): CallIdFormat {
  return quirks.presetId === 'mistral' ? 'mistral' : 'chat'
}

interface PendingCalls {
  text: string | null
  calls: ChatToolCall[]
  reasoning: ChatReasoningPayload | undefined
}

/**
 * Encodes one canonical body for a preset: the harness keeps building
 * `CreateResponseBody`, and this turns it into native bytes. Never sends
 * an empty tool list (vLLM refuses it); the compaction that needs tools on
 * every request keeps the turn's tools in the body (lane I, D74).
 */
export function encodeChatRequest(
  body: CreateResponseBody,
  model: string,
  quirks: ChatPresetQuirks,
  options?: ChatEncodeOptions,
): ChatNativeRequest {
  const messages: ChatMessage[] = [{ role: 'system', content: cleanWireText(body.instructions) }]
  const idFormat = callIdFormat(quirks)
  // Keep all parallel tool results adjacent before adding their user images.
  const pendingImages: ChatUserMessage[] = []
  const callNames = new Map<string, string>()
  for (const item of body.input) {
    if (item.type === 'function_call') {
      callNames.set(item.call_id, item.name)
    }
  }
  let pendingText = ''
  let pendingReasoning: ChatReasoningPayload | undefined
  let pending: PendingCalls | undefined
  const flushAssistant = (): void => {
    if (pending !== undefined) {
      // The turn's own reasoning goes back whenever it matches the
      // preset, tools declared or not (OpenRouter's capture 06 replays
      // `reasoning_details` with no `tools` key, accepted).
      messages.push(assistantMessage(pending.text, pending.calls, pending.reasoning, quirks))
      pending = undefined
      pendingText = ''
      pendingReasoning = undefined
    } else if (pendingText === '') {
      pendingReasoning = undefined
    } else {
      messages.push(assistantMessage(pendingText, [], pendingReasoning, quirks))
      pendingText = ''
      pendingReasoning = undefined
    }
  }
  const encodeItem = (item: InputItem): void => {
    if (item.type !== 'function_call_output') {
      messages.push(...pendingImages.splice(0))
    }
    switch (item.type) {
      case 'message': {
        if (item.role === 'developer') {
          flushAssistant()
          messages.push({ role: 'system', content: textOfParts(item.content) })
        } else if (item.role === 'assistant') {
          if (pending === undefined) {
            pendingText += textOfParts(item.content)
          } else {
            pending.text = `${pending.text ?? ''}${textOfParts(item.content)}`
          }
        } else {
          flushAssistant()
          messages.push({
            role: 'user',
            content: contentOfParts(item.content, options?.capabilities?.vision),
          })
        }

        break
      }
      case 'function_call': {
        if (pending === undefined) {
          pending = {
            text: pendingText === '' ? null : pendingText,
            calls: [],
            reasoning: pendingReasoning,
          }
          pendingText = ''
          pendingReasoning = undefined
        }
        // M101 lane P1 (BYO 3): the id the target format accepts, mapped
        // deterministically; the tool result below maps the same way.
        pending.calls.push({
          id: nativeCallId(item.call_id, idFormat),
          type: 'function',
          function: { name: item.name, arguments: cleanWireText(item.arguments) },
        })

        break
      }
      case 'function_call_output': {
        flushAssistant()
        const toolMessage: ChatToolMessage = {
          role: 'tool',
          tool_call_id: nativeCallId(item.call_id, idFormat),
          content: toolOutputText(item.output),
        }
        if (quirks.toolResultName) {
          const name = callNames.get(item.call_id)
          if (name === undefined) {
            messages.push(toolMessage)
          } else {
            messages.push({ ...toolMessage, name })
          }
        } else {
          messages.push(toolMessage)
        }
        const images =
          typeof item.output === 'string'
            ? []
            : item.output.filter((part) => part.type === 'input_image')
        if (images.length > 0) {
          pendingImages.push({
            role: 'user',
            content: contentOfParts(images, options?.capabilities?.vision),
          })
        }

        break
      }
      case 'reasoning': {
        const payload = readChatReasoning(
          item.encrypted_content,
          quirks.providerId ?? quirks.presetId,
          model,
        )
        if (payload !== undefined) {
          if (pending !== undefined && pending.reasoning === undefined) {
            pending.reasoning = payload
          } else {
            pendingReasoning = payload
          }
        }

        break
      }
      case 'web_search_call': {
        if (item.status !== 'completed') {
          throw new Error('chat codec: hosted search never reaches a BYO model')
        }
        flushAssistant()
        messages.push({ role: 'assistant', content: JSON.stringify(item) })

        break
      }
    }
  }
  for (const item of body.input) {
    encodeItem(item)
  }
  flushAssistant()
  messages.push(...pendingImages)

  const nativeTools: ChatFunctionTool[] = []
  const shouldUseStrictTools = (options?.capabilities ?? quirks).supportsStrictTools === true
  const tools = withStrictTools(body.tools, shouldUseStrictTools)
  for (const tool of tools) {
    if (tool.type !== 'function') {
      throw new Error('chat codec: hosted search never reaches a BYO model')
    }
    nativeTools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(shouldUseStrictTools && { strict: tool.strict }),
      },
    })
  }

  // A trailing developer message is request-only progress (M101), so the
  // rolling marker belongs to the preceding historical native message.
  const suffix = body.input.at(-1)
  const request: ChatCompletionRequest = {
    model,
    messages: markBreakpoints(
      messages,
      options?.cacheBreakpoints ?? 'none',
      suffix?.type === 'message' && suffix.role === 'developer',
    ),
    ...(nativeTools.length > 0 && {
      tools: nativeTools,
      ...(quirks.toolChoice !== 'omit' && { tool_choice: 'auto' as const }),
    }),
    ...(quirks.parallelToolCalls !== undefined && {
      parallel_tool_calls: quirks.parallelToolCalls,
    }),
    stream: true,
    ...(quirks.includeUsage && { stream_options: { include_usage: true as const } }),
    ...(quirks.outputCap === 'max_tokens'
      ? { max_tokens: body.max_output_tokens }
      : { max_completion_tokens: body.max_output_tokens }),
    ...(quirks.routing !== undefined && { provider: nativeRouting(quirks.routing) }),
    ...nativeReasoning(body, quirks),
    ...(quirks.sendCacheKey && { prompt_cache_key: body.prompt_cache_key }),
    ...(quirks.toolStream && { tool_stream: true as const }),
  }
  return { headers: quirks.extraHeaders ?? [], body: request }
}

/**
 * One assistant message with its tool calls and, where the preset replays
 * reasoning, the turn's own payload back in its own field: OpenRouter's
 * `reasoning_details` unmodified and in order, DeepSeek's / Fireworks' /
 * Z.ai's `reasoning_content`, Groq's / Together's / Hugging Face's
 * `reasoning`. Anything else (another preset's payload, a foreign shape)
 * is dropped, never translated.
 */
function assistantMessage(
  text: string | null,
  calls: readonly ChatToolCall[],
  reasoning: ChatReasoningPayload | undefined,
  quirks: ChatPresetQuirks,
): ChatAssistantMessage {
  const toolCalls = calls.length > 0 ? { tool_calls: [...calls] } : {}
  if (reasoning === undefined || quirks.replayField === 'none') {
    return { role: 'assistant', content: text, ...toolCalls }
  }
  if (quirks.replayField === 'details') {
    return {
      role: 'assistant',
      content: text,
      ...toolCalls,
      ...(reasoning.details !== undefined && { reasoning_details: reasoning.details }),
    }
  }
  if (reasoning.text === undefined || reasoning.text === '') {
    return { role: 'assistant', content: text, ...toolCalls }
  }
  // M101 lane P1 (BYO 13): lone surrogates are removed from replayed text.
  const reasoningText = cleanWireText(reasoning.text)
  return {
    role: 'assistant',
    content: text,
    ...toolCalls,
    ...(quirks.replayField === 'content'
      ? { reasoning_content: reasoningText }
      : { reasoning: reasoningText }),
  }
}

function nativeRouting(routing: ChatRouting): NonNullable<ChatCompletionRequest['provider']> {
  return {
    ...(routing.zdr !== undefined && { zdr: routing.zdr }),
    ...(routing.dataCollection !== undefined && { data_collection: routing.dataCollection }),
    ...(routing.order !== undefined && { order: routing.order }),
    ...(routing.allowFallbacks !== undefined && { allow_fallbacks: routing.allowFallbacks }),
  }
}

function nativeReasoning(
  body: CreateResponseBody,
  quirks: ChatPresetQuirks,
): Pick<ChatCompletionRequest, 'reasoning' | 'reasoning_effort'> {
  if (quirks.reasoningParam === 'none') {
    return {}
  }
  const effort = quirks.effortMap?.[body.reasoning.effort] ?? body.reasoning.effort
  return quirks.reasoningParam === 'effort-object'
    ? { reasoning: { effort } }
    : { reasoning_effort: effort }
}

// --- decode: native stream to canonical events ---

const chatToolCallSchema = z.object({
  index: z.optional(z.number()),
  id: z.optional(z.nullable(z.string())),
  type: z.optional(z.string()),
  function: z.optional(
    z.nullable(
      z.object({
        name: z.optional(z.nullable(z.string())),
        arguments: z.optional(z.nullable(z.string())),
      }),
    ),
  ),
})

const chatReasoningDetailSchema = z.looseObject({
  type: z.optional(z.string()),
  text: z.optional(z.nullable(z.string())),
  index: z.optional(z.number()),
})

const chatDeltaSchema = z.object({
  role: z.optional(z.string()),
  content: z.optional(z.nullable(z.string())),
  reasoning: z.optional(z.nullable(z.string())),
  reasoning_content: z.optional(z.nullable(z.string())),
  reasoning_details: z.optional(z.nullable(z.array(chatReasoningDetailSchema))),
  tool_calls: z.optional(z.nullable(z.array(chatToolCallSchema))),
  token_id: z.optional(z.nullable(z.number())),
  channel: z.optional(z.string()),
})

const chatChoiceSchema = z.object({
  index: z.optional(z.number()),
  delta: z.optional(z.nullable(chatDeltaSchema)),
  finish_reason: z.optional(z.nullable(z.string())),
  native_finish_reason: z.optional(z.nullable(z.string())),
})

const chatUsageSchema = z.object({
  prompt_tokens: z.optional(z.number()),
  completion_tokens: z.optional(z.number()),
  total_tokens: z.optional(z.number()),
  prompt_tokens_details: z.optional(
    z.nullable(
      z.object({
        cached_tokens: z.optional(z.number()),
        cache_write_tokens: z.optional(z.number()),
      }),
    ),
  ),
  completion_tokens_details: z.optional(
    z.nullable(z.object({ reasoning_tokens: z.optional(z.number()) })),
  ),
  cost: z.optional(z.number()),
})
type ChatUsageWire = z.infer<typeof chatUsageSchema>

const chatErrorSchema = z.object({
  message: z.optional(z.string()),
  code: z.optional(z.nullable(z.union([z.string(), z.number()]))),
})

const chatChunkSchema = z.object({
  id: z.optional(z.string()),
  object: z.optional(z.string()),
  created: z.optional(z.number()),
  model: z.optional(z.string()),
  choices: z.optional(z.nullable(z.array(chatChoiceSchema))),
  usage: z.optional(z.unknown()),
  error: z.optional(z.nullable(chatErrorSchema)),
  message: z.optional(z.string()),
  code: z.optional(z.nullable(z.union([z.string(), z.number()]))),
})
type ChatChunk = z.infer<typeof chatChunkSchema>

export interface ChatDecodeResult {
  readonly events: readonly StreamEvent[]
  readonly response: ResponseObject
  /** OpenRouter's reported `cost`, where the stream carried one. */
  readonly providerCostUsd?: UsdAmount | undefined
}

/** Lane T supplies the shared constants when it creates a decoder. */
export interface ChatDecodeLimits {
  readonly frameBytes: number
  readonly streamBytes: number
  readonly argumentBytes: number
  readonly outputItems: number
}

const TEXT_ITEM_ID = 'chat-text'
const REASONING_ITEM_ID = 'chat-reasoning'
const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

function validCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

interface DecodedCall {
  key: string | number
  id: string
  syntheticId: boolean
  name: string
  args: string
  argumentBytes: number
  added: boolean
}

interface ChatToolCallDelta {
  readonly index?: number | undefined
  readonly id?: string | null | undefined
  readonly function?:
    | {
        readonly name?: string | null | undefined
        readonly arguments?: string | null | undefined
      }
    | null
    | undefined
}

function callItemOf(entry: DecodedCall): {
  readonly type: 'function_call'
  readonly id: string
  readonly call_id: string
  readonly name: string
  readonly arguments: string
} {
  return {
    type: 'function_call',
    id: entry.id,
    call_id: entry.id,
    name: entry.name,
    arguments: entry.args,
  }
}

/**
 * Incremental decoder over parsed `data:` payloads (lane T's SSE layer
 * parses frames; `[DONE]` and blanks are skipped here). One instance per
 * response; `feed` returns the canonical events for each payload and
 * `finish` the terminal events plus the canonical `ResponseObject`.
 *
 * Reads deltas and usage from every chunk (Mistral puts the whole call,
 * the finish reason and the usage in one chunk; Groq, Together and
 * Fireworks use a `choices: []` usage chunk). Only the first choice is
 * read; a turn carries one.
 */
export class ChatStreamDecoder {
  private readonly model: string
  private readonly quirks: ChatPresetQuirks
  private readonly limits: ChatDecodeLimits
  private streamBytes = 0
  private started = false
  private responseId: string | undefined
  private responseModel: string | undefined
  private text = ''
  private textAdded = false
  private reasoningText = ''
  private reasoningAdded = false
  private detailsRaw: z.infer<typeof chatReasoningDetailSchema>[] = []
  private contentPending = ''
  private isThinking = false
  private calls: DecodedCall[] = []
  private order: ('reasoning' | 'message' | 'calls')[] = []
  private usageRaw: ChatUsageWire | undefined
  private costRaw: UsdAmount | undefined
  private finishReason: string | undefined
  private streamError: { readonly code?: string | undefined; readonly message: string } | undefined

  constructor(model: string, quirks: ChatPresetQuirks, limits: ChatDecodeLimits) {
    if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new TypeError('chat codec: invalid stream limits')
    }
    this.model = model
    this.quirks = quirks
    this.limits = limits
  }

  private fail(code: string): StreamEvent[] {
    this.streamError = { code, message: UI_TEXT.turnFailed }
    this.usageRaw = undefined
    this.costRaw = undefined
    return [{ type: 'error', ...this.streamError }]
  }

  private finished(events: readonly StreamEvent[], response: ResponseObject): ChatDecodeResult {
    return {
      events,
      response,
      ...(this.costRaw !== undefined &&
        response.usage != null && { providerCostUsd: this.costRaw }),
    }
  }

  private snapshot(status: string): ResponseObject {
    return {
      id: this.responseId ?? 'chat-response',
      status,
      model: this.responseModel ?? this.model,
      output: this.outputItems(),
    }
  }

  private outputItems(): ResponseObject['output'] {
    const message = this.text === '' ? undefined : this.messageItem()
    const reasoning =
      this.reasoningText === '' && this.detailsRaw.length === 0 ? undefined : this.reasoningItem()
    const calls = this.calls.map(
      (call) =>
        ({
          type: 'function_call',
          id: call.id,
          call_id: call.id,
          name: call.name,
          arguments: call.args,
        }) as const,
    )
    const output: ResponseObject['output'] = []
    for (const slot of this.order) {
      if (slot === 'reasoning' && reasoning !== undefined) {
        output.push(reasoning)
      } else if (slot === 'message' && message !== undefined) {
        output.push(message)
      } else if (slot === 'calls') {
        output.push(...calls)
      }
    }
    return output
  }

  private messageItem(): Extract<ResponseObject['output'][number], { type: 'message' }> {
    return {
      type: 'message',
      id: TEXT_ITEM_ID,
      role: 'assistant',
      content: [{ type: 'output_text', text: this.text }],
    }
  }

  private reasoningItem(): Extract<ResponseObject['output'][number], { type: 'reasoning' }> {
    return {
      type: 'reasoning',
      id: REASONING_ITEM_ID,
      ...(this.reasoningText !== '' && {
        summary: [{ type: 'reasoning_text', text: this.reasoningText }],
      }),
      encrypted_content: opaqueReasoning(
        this.quirks.providerId ?? this.quirks.presetId,
        this.model,
        this.reasoningText,
        this.detailsRaw,
      ),
    }
  }

  private noteOrder(slot: 'reasoning' | 'message' | 'calls'): void {
    if (!this.order.includes(slot)) {
      this.order.push(slot)
    }
  }

  private pushText(piece: string, events: StreamEvent[]): void {
    if (piece === '') {
      return
    }
    this.noteOrder('message')
    if (this.textAdded) {
      this.text += piece
    } else {
      this.textAdded = true
      events.push({ type: 'response.output_item.added', item: this.messageItem() })
      this.text = piece
    }
    events.push({ type: 'response.output_text.delta', item_id: TEXT_ITEM_ID, delta: piece })
  }

  private ensureReasoningAdded(events: StreamEvent[]): void {
    this.noteOrder('reasoning')
    if (this.reasoningAdded) {
      return
    }

    this.reasoningAdded = true
    events.push({ type: 'response.output_item.added', item: this.reasoningItem() })
  }

  private pushReasoning(piece: string, events: StreamEvent[]): void {
    if (piece === '') {
      return
    }
    this.ensureReasoningAdded(events)
    this.reasoningText += piece
    events.push({
      type: 'response.reasoning_summary_text.delta',
      item_id: REASONING_ITEM_ID,
      summary_index: 0,
      delta: piece,
    })
  }

  /**
   * Splits `<think>` blocks (research §1: unclosed ones too) out of answer
   * text into reasoning; local servers stream thought this way.
   */
  private takeContent(piece: string, events: StreamEvent[]): void {
    this.contentPending += piece
    for (;;) {
      const tag = this.isThinking ? THINK_CLOSE : THINK_OPEN
      const position = this.contentPending.indexOf(tag)
      let held = 0
      if (position === -1) {
        for (let length = tag.length - 1; held === 0 && length > 0; length -= 1) {
          if (this.contentPending.endsWith(tag.slice(0, length))) {
            held = length
          }
        }
      }
      const end = position === -1 ? this.contentPending.length - held : position
      const text = this.contentPending.slice(0, end)
      if (this.isThinking) {
        this.pushReasoning(text, events)
      } else {
        this.pushText(text, events)
      }
      this.contentPending = this.contentPending.slice(end + (position === -1 ? 0 : tag.length))
      if (position === -1) {
        return
      }
      this.isThinking = !this.isThinking
    }
  }

  /**
   * Merges by native index, then native id. An unnamed/indexless/idless
   * continuation can reconnect only while one call is unambiguous.
   */
  private takeToolCall(call: ChatToolCallDelta, events: StreamEvent[]): string | undefined {
    const index = call.index
    let key: string | number
    if (typeof index === 'number' && Number.isFinite(index)) {
      key = Math.trunc(index)
    } else if (call.id != null) {
      key = this.calls.find((candidate) => candidate.id === call.id)?.key ?? call.id
    } else if (!call.function?.name && this.calls.length > 0) {
      const soleCall = this.calls.length === 1 ? this.calls[0] : undefined
      if (soleCall === undefined) {
        return 'ambiguous_tool_call'
      }
      key = soleCall.key
    } else {
      key = `anon-${String(this.calls.length)}`
    }
    let entry = this.calls.find((candidate) => candidate.key === key)
    if (entry === undefined) {
      if (call.id == null && this.responseId === undefined) {
        return 'missing_response_id'
      }
      entry = {
        key,
        id: call.id ?? `chat-call-${this.responseId ?? ''}-${String(this.calls.length)}`,
        syntheticId: call.id == null,
        name: call.function?.name ?? '',
        args: '',
        argumentBytes: 0,
        added: false,
      }
      this.calls.push(entry)
      this.noteOrder('calls')
    }
    if (entry.syntheticId && call.id != null) {
      entry.id = call.id
      entry.syntheticId = false
    }
    const name = call.function?.name
    if (typeof name === 'string' && entry.name === '') {
      entry.name = name
    }
    const fragment = call.function?.arguments
    if (typeof fragment === 'string' && fragment !== '') {
      const bytes = new TextEncoder().encode(fragment).byteLength
      if (entry.argumentBytes + bytes > this.limits.argumentBytes) {
        return 'stream_limit'
      }
      entry.argumentBytes += bytes
      entry.args += fragment
      if (!entry.added) {
        entry.added = true
        events.push({ type: 'response.output_item.added', item: callItemOf(entry) })
      }
      events.push({
        type: 'response.function_call_arguments.delta',
        item_id: entry.id,
        delta: fragment,
      })
    } else if (!entry.added) {
      entry.added = true
      events.push({ type: 'response.output_item.added', item: callItemOf(entry) })
    }
    return undefined
  }

  /**
   * Usage as M75 validates it (finite, non-negative, cached at most
   * input); missing means unknown, not zero (research §1). The last chunk
   * carrying usage wins: Mistral's single chunk, the finish chunk
   * (OpenRouter, DeepSeek, Z.ai) or the `choices: []` chunk
   * (Groq, Together, Fireworks).
   */
  private canonicalUsage(): Usage | undefined {
    const raw = this.usageRaw
    if (raw === undefined) {
      return undefined
    }
    const input = validCount(raw.prompt_tokens)
    const output = validCount(raw.completion_tokens)
    if (input === undefined || output === undefined) {
      return undefined
    }
    const counts = [
      raw.total_tokens,
      raw.prompt_tokens_details?.cached_tokens,
      raw.prompt_tokens_details?.cache_write_tokens,
      raw.completion_tokens_details?.reasoning_tokens,
    ]
    if (counts.some((value) => value !== undefined && validCount(value) === undefined)) {
      return undefined
    }
    const total = raw.total_tokens ?? input + output
    if (validCount(total) === undefined) {
      return undefined
    }
    const cached = validCount(raw.prompt_tokens_details?.cached_tokens)
    const reasoning = validCount(raw.completion_tokens_details?.reasoning_tokens ?? undefined)
    const written = validCount(raw.prompt_tokens_details?.cache_write_tokens)
    if ((cached !== undefined && cached > input) || (written !== undefined && written > input)) {
      return undefined
    }
    const usage = {
      input_tokens: input,
      output_tokens: output,
      total_tokens: total,
      ...((cached !== undefined || written !== undefined) && {
        input_tokens_details: {
          ...(cached !== undefined && { cached_tokens: cached }),
          ...(written !== undefined && { cache_write_tokens: written }),
        },
      }),
      ...(reasoning !== undefined && { output_tokens_details: { reasoning_tokens: reasoning } }),
    }
    return usage
  }

  feed(payload: unknown): StreamEvent[] {
    const events: StreamEvent[] = []
    if (this.streamError !== undefined) {
      return events
    }
    if (payload === null || (typeof payload !== 'string' && typeof payload !== 'object')) {
      return events
    }
    const wire = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const bytes = new TextEncoder().encode(wire).byteLength
    this.streamBytes += bytes
    if (bytes > this.limits.frameBytes || this.streamBytes > this.limits.streamBytes) {
      return this.fail('stream_limit')
    }
    let raw: unknown = payload
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed === '[DONE]' || trimmed.startsWith(':')) {
        return events
      }
      try {
        raw = JSON.parse(trimmed)
      } catch {
        return this.fail('malformed_chunk')
      }
    }
    if (typeof raw !== 'object' || raw === null) {
      return events
    }
    if (
      !('choices' in raw) &&
      !('usage' in raw) &&
      !('error' in raw) &&
      (!('object' in raw) || (raw.object !== 'chat.completion.chunk' && raw.object !== 'error'))
    ) {
      return events
    }
    let chunk: ChatChunk
    try {
      chunk = chatChunkSchema.parse(raw)
    } catch {
      return this.fail('malformed_chunk')
    }
    const error = readStreamError(chunk)
    if (error !== undefined) {
      this.streamError = error
      events.push({
        type: 'error',
        ...(error.code !== undefined && { code: error.code }),
        message: error.message,
      })
      return events
    }
    if (chunk.choices == null && chunk.usage == null) {
      return events
    }
    if (chunk.id !== undefined && this.responseId === undefined) {
      this.responseId = chunk.id
    }
    if (chunk.model !== undefined && this.responseModel === undefined) {
      this.responseModel = chunk.model
    }
    if (!this.started) {
      this.started = true
      events.push(
        { type: 'response.created', response: this.snapshot('in_progress') },
        { type: 'response.in_progress', response: this.snapshot('in_progress') },
      )
    }
    if (chunk.usage !== undefined && chunk.usage !== null) {
      const usage = chatUsageSchema.safeParse(chunk.usage)
      this.usageRaw = usage.success ? usage.data : undefined
      const cost = usage.success ? validCount(usage.data.cost) : undefined
      this.costRaw = cost === undefined ? undefined : Usd.from(cost).toAmount()
    }
    const choice = chunk.choices?.[0]
    const finish = choice?.finish_reason ?? choice?.native_finish_reason ?? undefined
    if (typeof finish === 'string' && finish !== '' && this.finishReason === undefined) {
      this.finishReason = finish
    }
    const delta = choice?.delta ?? undefined
    if (delta !== undefined) {
      if (delta.reasoning_details !== undefined && delta.reasoning_details !== null) {
        for (const entry of delta.reasoning_details) {
          const existing = this.detailsRaw.find(
            (detail) =>
              entry.index !== undefined &&
              detail.index === entry.index &&
              detail.type === entry.type &&
              typeof entry.text === 'string' &&
              typeof detail.text === 'string',
          )
          if (existing === undefined) {
            this.detailsRaw.push({ ...entry })
          } else {
            // Spread copies native fields as data properties, including future fields,
            // without invoking a target object's setters during fragment merging.
            this.detailsRaw[this.detailsRaw.indexOf(existing)] = {
              ...existing,
              ...entry,
              text: `${existing.text ?? ''}${entry.text ?? ''}`,
            }
          }
          this.ensureReasoningAdded(events)
          if (typeof entry.text === 'string' && entry.text !== '') {
            this.pushReasoning(entry.text, events)
          }
        }
      } else if (typeof delta.reasoning === 'string' && delta.reasoning !== '') {
        this.pushReasoning(delta.reasoning, events)
      } else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
        this.pushReasoning(delta.reasoning_content, events)
      }
      if (typeof delta.content === 'string' && delta.content !== '') {
        this.takeContent(delta.content, events)
      }
      if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
        for (const call of delta.tool_calls) {
          const failure = this.takeToolCall(call, events)
          if (failure !== undefined) {
            return this.fail(failure)
          }
        }
      }
    }
    return this.calls.length + Number(this.textAdded) + Number(this.reasoningAdded) >
      this.limits.outputItems
      ? this.fail('stream_limit')
      : events
  }

  /** The terminal events and the canonical response for one fed stream. */
  finish(): ChatDecodeResult {
    const events: StreamEvent[] = []
    if (this.isThinking) {
      this.pushReasoning(this.contentPending, events)
    } else {
      this.pushText(this.contentPending, events)
    }
    this.contentPending = ''
    for (const [index, item] of this.outputItems().entries()) {
      if (item.type === 'message' || item.type === 'reasoning') {
        events.push({ type: 'response.output_item.done', output_index: index, item })
      } else if (item.type === 'function_call' && 'call_id' in item) {
        events.push(
          {
            type: 'response.function_call_arguments.done',
            item_id: item.call_id,
            arguments: item.arguments,
          },
          { type: 'response.output_item.done', output_index: index, item },
        )
      }
    }
    const usage = this.canonicalUsage()
    const base = {
      id: this.responseId ?? 'chat-response',
      model: this.responseModel ?? this.model,
      output: this.outputItems(),
      ...(usage !== undefined && { usage }),
    }
    if (this.streamError !== undefined) {
      const response: ResponseObject = {
        ...base,
        status: 'failed',
        error: {
          ...(this.streamError.code !== undefined && { code: this.streamError.code }),
          message: this.streamError.message,
        },
      }
      events.push({ type: 'response.failed', response })
      return this.finished(events, response)
    }
    if (this.finishReason === 'length' || this.finishReason === undefined) {
      const response: ResponseObject = {
        ...base,
        status: 'incomplete',
        incomplete_details: {
          reason: this.finishReason === 'length' ? 'max_output_tokens' : 'stream_ended',
        },
      }
      events.push({ type: 'response.incomplete', response })
      return this.finished(events, response)
    }
    if (this.finishReason === 'content_filter') {
      const response: ResponseObject = {
        ...base,
        status: 'failed',
        error: { code: 'content_filter', message: UI_TEXT.turnFailed },
      }
      events.push({ type: 'response.failed', response })
      return this.finished(events, response)
    }
    if (
      this.finishReason !== 'stop' &&
      this.finishReason !== 'tool_calls' &&
      this.finishReason !== 'eos'
    ) {
      const response: ResponseObject = {
        ...base,
        status: 'incomplete',
        incomplete_details: { reason: this.finishReason },
      }
      events.push({ type: 'response.incomplete', response })
      return this.finished(events, response)
    }
    const response: ResponseObject = { ...base, status: 'completed' }
    events.push({ type: 'response.completed', response })
    return this.finished(events, response)
  }
}

/**
 * A mid-stream error under HTTP 200 (research: OpenRouter keeps 200 with a
 * string): any chunk carrying an `error` object, or the flat
 * `{object: "error", message}` shape, becomes the canonical error event.
 * HTTP error bodies stay lane T's per-format parser.
 */
function readStreamError(
  chunk: ChatChunk,
): { readonly code?: string | undefined; readonly message: string } | undefined {
  const nested = chunk.error
  if (nested !== undefined && nested !== null && typeof nested.message === 'string') {
    const code = nested.code
    return {
      ...((typeof code === 'string' || typeof code === 'number') && { code: String(code) }),
      message: nested.message,
    }
  }
  return chunk.object === 'error' && typeof chunk.message === 'string'
    ? { message: chunk.message, ...(chunk.code != null && { code: String(chunk.code) }) }
    : undefined
}

/** Decodes a whole buffered stream: feeds every payload, then finishes. */
export function decodeChatStream(
  payloads: readonly unknown[],
  model: string,
  quirks: ChatPresetQuirks,
  limits: ChatDecodeLimits,
): ChatDecodeResult {
  const decoder = new ChatStreamDecoder(model, quirks, limits)
  const events: StreamEvent[] = []
  for (const payload of payloads) {
    events.push(...decoder.feed(payload))
  }
  const done = decoder.finish()
  events.push(...done.events)
  return {
    events,
    response: done.response,
    ...(done.providerCostUsd !== undefined && { providerCostUsd: done.providerCostUsd }),
  }
}

/**
 * Marks the system block and, in `anthropic` mode, the last text block
 * (rolling); in `last` mode only the last text block. Anything else keeps
 * plain strings, as every non-cache capture shows.
 */
function markBreakpoints(
  messages: readonly ChatMessage[],
  mode: ChatBreakpoints,
  hasRequestSuffix: boolean,
): readonly ChatMessage[] {
  if (mode === 'none') {
    return messages
  }
  const lastTextIndex = messages.findLastIndex(
    (message, index) =>
      (!hasRequestSuffix || index < messages.length - 1) &&
      ((typeof message.content === 'string' && message.content !== '') ||
        (Array.isArray(message.content) &&
          message.content.some(
            (part: ChatTextPart | ChatImagePart) => part.type === 'text' && part.text !== '',
          ))),
  )
  return messages.map((message, index) => {
    if (message.role === 'user' && typeof message.content !== 'string') {
      const lastPart = message.content.findLastIndex(
        (part) => part.type === 'text' && part.text !== '',
      )
      return {
        ...message,
        content: message.content.map((part, partIndex) =>
          index === lastTextIndex && partIndex === lastPart
            ? { ...part, cache_control: { type: 'ephemeral' as const } }
            : part,
        ),
      }
    }
    if (typeof message.content !== 'string') {
      return message
    }
    const isSystem = message.role === 'system' && index === 0
    const isLast = index === lastTextIndex
    const shouldMark = (mode === 'anthropic' && (isSystem || isLast)) || (mode === 'last' && isLast)
    return {
      ...message,
      content: [
        {
          type: 'text',
          text: message.content,
          ...(shouldMark && { cache_control: { type: 'ephemeral' as const } }),
        },
      ],
    }
  })
}
