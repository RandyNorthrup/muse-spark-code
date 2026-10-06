// Ollama's native `/api/chat` codec (M95, PLAN.md D74).
//
// Why native and not `/v1`: only the native API takes `options.num_ctx`
// per request, and our prompt and tools overflow the VRAM-sized default
// (4k under 24 GiB) silently through `/v1` (m95-research.md §1.9, from
// docs.ollama.com/api/chat, /context-length and /openai-compatibility,
// read 2026-09-29, Ollama v0.35.1).
//
// Pure in both directions: a canonical `CreateResponseBody` in, the native
// request bytes out; native NDJSON lines in, canonical `StreamEvent`s
// ending in a canonical `ResponseObject` out. No clock, no random id, keys
// in a fixed order, so requests n and n+1 of a session share every earlier
// native byte (D74 SoL-Pi invariant 1).
//
// The temporary seam (lanes T and I are not merged): lane T's `WireCodec`
// and `transport.ts` do not exist yet, so this file exports the codec as
// plain functions over explicit inputs. The caller injects what only it
// knows: the provider's model id, the `num_ctx` the panel stored for that
// model (`ProviderEntry.numCtx`, lane P), and the `think` level. Nothing
// here is a fake: every function does its documented job on real shapes,
// and lane T adapts these functions to `WireCodec` without changing them.

import * as z from 'zod/mini'
import {
  nativeModelMetadataSchema,
  type NativeModelMetadata,
} from '../../../providers/modelMetadata'

import {
  HTTP_TOO_MANY_REQUESTS,
  OLLAMA_ARGUMENT_MAX_BYTES,
  OLLAMA_CARRIAGE_RETURN,
  OLLAMA_FRAME_MAX_BYTES,
  OLLAMA_ITEM_MAX_BYTES,
  OLLAMA_LINE_FEED,
  OLLAMA_OUTPUT_MAX_ITEMS,
  OLLAMA_STREAM_MAX_BYTES,
} from '../../../../shared/constants'
import { UI_TEXT, fill } from '../../../../shared/l10n/text'
import { ModelApiError } from '../client'
import type {
  CreateResponseBody,
  FunctionCallItem,
  FunctionOutputPart,
  InputContentPart,
  InputItem,
  OutputItem,
  ReasoningItem,
  ResponseObject,
  StreamEvent,
  Usage,
} from '../schemas'

/** The native chat endpoint (research [OL-chat]). */
export const OLLAMA_CHAT_PATH = '/api/chat'

/** What `think` takes on the native request: a switch or a level [OL-chat]. */
export type OllamaThink = boolean | 'low' | 'medium' | 'high'

/**
 * The `think` level for a canonical effort tier. `none` (the Thinking
 * toggle off) disables thinking; unknown tiers leave it to the model.
 */
export function thinkForEffort(effort: string): OllamaThink {
  switch (effort) {
    case 'none': {
      return false
    }
    case 'minimal':
    case 'low': {
      return 'low'
    }
    case 'medium': {
      return 'medium'
    }
    case 'high':
    case 'xhigh':
    case 'max': {
      return 'high'
    }
    default: {
      return true
    }
  }
}

// Our opaque reasoning envelope binds native thinking to its producing model.
// Legacy unbound envelopes and foreign providers/models are never replayed.
const OLLAMA_THINKING_MARKER = 'ollama-thinking-v2:'
const thinkingEnvelopeSchema = z.object({ model: z.string(), thinking: z.string() })

function packThinking(thinking: string, model: string): string {
  return `${OLLAMA_THINKING_MARKER}${JSON.stringify({ model, thinking })}`
}

function unpackThinking(encrypted: string | undefined, model: string): string | undefined {
  if (encrypted?.startsWith(OLLAMA_THINKING_MARKER) !== true) return undefined
  try {
    const parsed = thinkingEnvelopeSchema.safeParse(
      JSON.parse(encrypted.slice(OLLAMA_THINKING_MARKER.length)) as unknown,
    )
    return parsed.success && parsed.data.model === model ? parsed.data.thinking : undefined
  } catch {
    return undefined
  }
}

function enforceLimit(size: number, maximum: number): void {
  if (size > maximum) throw new Error(UI_TEXT.ollamaStreamLimit)
}

const utf8 = new TextEncoder()

// --- native request shapes (what we send; validated on the way back) ---

const ollamaToolCallSchema = z.object({
  id: z.optional(z.string()),
  function: z.object({
    index: z.optional(z.number()),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
})

const ollamaMessageSchema = z.object({
  role: z.optional(z.string()),
  content: z.optional(z.nullable(z.string())),
  thinking: z.optional(z.nullable(z.string())),
  tool_calls: z.optional(z.array(ollamaToolCallSchema)),
})

const ollamaLineSchema = z.object({
  model: z.optional(z.string()),
  message: z.optional(ollamaMessageSchema),
  done: z.optional(z.boolean()),
  done_reason: z.optional(z.string()),
  prompt_eval_count: z.optional(z.number()),
  prompt_eval_cached_count: z.optional(z.number()),
  eval_count: z.optional(z.number()),
  error: z.optional(z.string()),
})
export type OllamaLine = z.infer<typeof ollamaLineSchema>

/** What the caller injects: the model, its stored context, its thinking. */
export interface OllamaEncodeOptions {
  readonly model: string
  /** The context the panel stored for this model (32k, 64k or 128k, D74). */
  readonly numCtx: number
  /** Explicit `think`; derived from the body's effort tier when absent. */
  readonly think?: OllamaThink | undefined
}

/** One native chat message, in the request's fixed key order. */
interface OllamaRequestMessage {
  readonly role: string
  readonly content: string
  readonly images?: readonly string[] | undefined
  readonly thinking?: string | undefined
  readonly tool_calls?:
    | readonly {
        readonly function: { readonly name: string; readonly arguments: unknown }
      }[]
    | undefined
  readonly tool_name?: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A function call's arguments for the native request: an object [OL-chat]. */
function argumentsForWire(argumentsText: string): unknown {
  try {
    return JSON.parse(argumentsText) as unknown
  } catch {
    // Not JSON the model wrote: the server decides, and its error names
    // the call. Never an empty object, which would run a different call.
    return argumentsText
  }
}

/** The base64 payload of a data URL; anything else passes through. */
function imagePayload(imageUrl: string): string {
  const comma = imageUrl.indexOf(',')
  return comma === -1 ? imageUrl : imageUrl.slice(comma + 1)
}

function textOf(parts: readonly InputContentPart[]): string {
  return parts
    .flatMap((part) =>
      part.type === 'input_text' || part.type === 'output_text' ? [part.text] : [],
    )
    .join('')
}

/** A tool result's text; pictures have no native field and fail loudly. */
function toolOutputText(output: readonly FunctionOutputPart[]): string {
  for (const part of output) {
    if (part.type === 'input_image') {
      throw new Error(UI_TEXT.ollamaToolImageUnsupported)
    }
  }
  return textOf(output)
}

function imagesOf(parts: readonly InputContentPart[]): readonly string[] {
  return parts.flatMap((part) =>
    part.type === 'input_image' ? [imagePayload(part.image_url)] : [],
  )
}

/**
 * The native `/api/chat` request bytes for a canonical body. Keys in a
 * fixed order, tool schemas rewritten the same way every time, nothing
 * from the clock or random: the same session encodes the same bytes.
 *
 * Dropped, each for a reason: `web_search` tools and past `web_search_call`
 * items (acceptance 11: never declared; the native API has no search-call
 * role, and the reply that used them replays as text); Meta's `store`,
 * `include`, `prompt_cache_key` and `prompt_cache_retention` (no native
 * counterpart); `tool_choice` (the format has none: quirks `toolChoice:
 * 'omit'`). An empty tool list is never sent (quirks `neverSendEmptyTools`).
 *
 * Throws an explicit error for what the native API cannot carry (a PDF, a
 * tool result's pictures): the turn fails loudly instead of running on
 * silently shortened input.
 */
export function encodeOllamaRequest(
  body: CreateResponseBody,
  options: OllamaEncodeOptions,
): { readonly path: string; readonly body: string } {
  if (options.model === '') {
    throw new Error(UI_TEXT.ollamaModelRequired)
  }
  if (!Number.isSafeInteger(options.numCtx) || options.numCtx <= 0) {
    throw new Error(UI_TEXT.ollamaContextRequired)
  }
  const messages: OllamaRequestMessage[] = []
  if (body.instructions !== '') {
    messages.push({ role: 'system', content: body.instructions })
  }
  // Tool names for results: the call's own item carries the name, the
  // result only its id.
  const callNames = new Map<string, string>()
  for (const item of body.input) {
    if (item.type !== 'function_call') {
      continue
    }

    if (callNames.has(item.call_id)) throw new Error(UI_TEXT.ollamaDuplicateCall)
    callNames.set(item.call_id, item.name)
  }
  const pushMessage = (item: Extract<InputItem, { type: 'message' }>): void => {
    for (const part of item.content) {
      if (part.type === 'input_file') {
        throw new Error(UI_TEXT.ollamaPdfUnsupported)
      }
    }
    const images = imagesOf(item.content)
    messages.push({
      role: item.role === 'developer' ? 'system' : item.role,
      content: textOf(item.content),
      ...(images.length > 0 && { images }),
    })
  }
  const pushThinking = (item: ReasoningItem): void => {
    const thinking = unpackThinking(item.encrypted_content ?? undefined, options.model)
    // Another provider's reasoning: dropped, never replayed (D74).
    if (thinking === undefined) {
      return
    }
    const last = messages.at(-1)
    if (last?.role === 'assistant' && last.thinking === undefined) {
      messages[messages.length - 1] = { ...last, thinking }
      return
    }
    messages.push({ role: 'assistant', content: '', thinking })
  }
  const pushCall = (item: FunctionCallItem): void => {
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: item.name, arguments: argumentsForWire(item.arguments) } }],
    })
  }
  const pushCallOutput = (item: Extract<InputItem, { type: 'function_call_output' }>): void => {
    const content = typeof item.output === 'string' ? item.output : toolOutputText(item.output)
    const toolName = callNames.get(item.call_id)
    messages.push({
      role: 'tool',
      content,
      ...(toolName !== undefined && { tool_name: toolName }),
    })
  }
  const pushInputItem = (item: InputItem): void => {
    switch (item.type) {
      case 'message': {
        pushMessage(item)
        break
      }
      case 'reasoning': {
        pushThinking(item)
        break
      }
      case 'function_call': {
        pushCall(item)
        break
      }
      case 'function_call_output': {
        pushCallOutput(item)
        break
      }
      // A past web_search_call has no native role; the reply that used it
      // replays as text, so there is nothing to send.
      case 'web_search_call': {
        break
      }
    }
  }
  for (const item of body.input) {
    pushInputItem(item)
  }
  const tools = body.tools.flatMap((tool) =>
    tool.type === 'function'
      ? [
          {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          },
        ]
      : [],
  )
  const request = {
    model: options.model,
    messages,
    ...(tools.length > 0 && { tools }),
    options: { num_ctx: options.numCtx, num_predict: body.max_output_tokens },
    think: options.think ?? thinkForEffort(body.reasoning.effort),
    stream: true as const,
  }
  return { path: OLLAMA_CHAT_PATH, body: JSON.stringify(request) }
}

// --- NDJSON (the native stream is newline-delimited JSON, [OL-chat]) ---

/**
 * Native NDJSON over byte chunks, with caps before decoding/concatenating.
 * Closing this iterator closes its byte source, including at native done.
 */
export async function* readOllamaLines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  let frameBytes = 0
  let streamBytes = 0
  const append = (bytes: Uint8Array): void => {
    frameBytes += bytes.byteLength
    enforceLimit(frameBytes, OLLAMA_FRAME_MAX_BYTES)
    buffered += decoder.decode(bytes, { stream: true })
  }
  for await (const chunk of chunks) {
    streamBytes += chunk.byteLength
    enforceLimit(streamBytes, OLLAMA_STREAM_MAX_BYTES)
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== OLLAMA_LINE_FEED && chunk[index] !== OLLAMA_CARRIAGE_RETURN) continue
      if (start === index && frameBytes === 0) {
        start = index + 1
        continue
      }
      append(chunk.subarray(start, index))
      const line = buffered + decoder.decode()
      buffered = ''
      frameBytes = 0
      start = index + 1
      if (line !== '') yield line
    }
    append(chunk.subarray(start))
  }
  buffered += decoder.decode()
  if (buffered !== '') yield buffered
}

// --- decode: native lines to canonical events ---

/** What the decoder needs: the model for the response, the HTTP status for errors. */
export interface OllamaDecodeOptions {
  readonly model: string
  readonly status: number
  /** Stable, session-unique request identity supplied by the caller; never a clock/random value here. */
  readonly responseId: string
}

function malformedFrame(status: number): ModelApiError {
  // Never include model-authored frame text in the locally authored failure.
  return new ModelApiError(UI_TEXT.ollamaMalformedFrame, status, undefined, undefined)
}

function isValidCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(value)
}

/**
 * The final line's usage as canonical `Usage`, or unknown. Counts must be
 * finite and non-negative, and cached at most input (as M75 validates);
 * anything else leaves the cost unknown rather than counted wrong.
 */
function usageOf(line: OllamaLine): Usage | undefined {
  const input = line.prompt_eval_count
  const output = line.eval_count
  if (!isValidCount(input) || !isValidCount(output)) {
    return undefined
  }
  const cached = line.prompt_eval_cached_count
  if (cached !== undefined && (!isValidCount(cached) || cached > input)) {
    return undefined
  }
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    ...(cached !== undefined && { input_tokens_details: { cached_tokens: cached } }),
  }
}

interface PendingCall {
  readonly itemId: string
  readonly callId: string
  readonly name: string
  readonly argumentsText: string
  readonly itemIndex: number
}

/**
 * Decodes counted Ollama 0.35.1 frames. Native index/id identifies a whole
 * call across lines; native arguments are objects, not invented JSON deltas.
 * The caller supplies a session-unique responseId, which namespaces item
 * and fallback call ids without rewriting any previous request's history.
 * Native done is the terminal boundary; EOF without it is truncation.
 */
export async function* decodeOllamaStream(
  chunks: AsyncIterable<Uint8Array>,
  options: OllamaDecodeOptions,
): AsyncGenerator<StreamEvent> {
  if (options.responseId === '') throw new Error(UI_TEXT.ollamaResponseIdRequired)
  const output: OutputItem[] = []
  const addItem = (item: OutputItem): void => {
    enforceLimit(output.length + 1, OLLAMA_OUTPUT_MAX_ITEMS)
    output.push(item)
  }
  let messageBytes = 0
  let reasoningBytes = 0
  let messageId = 0
  let messageText = ''
  let hasMessage = false
  let reasoningId = 0
  let reasoningText = ''
  let hasReasoning = false
  const calls = new Map<string, PendingCall>()
  const nativeIds = new Set<string>()
  let hasDone = false
  let doneReason: string | undefined
  let usage: Usage | undefined

  const messageItemId = `${options.responseId}:message`
  const reasoningItemId = `${options.responseId}:reasoning`

  for await (const line of readOllamaLines(chunks)) {
    let json: unknown
    try {
      json = JSON.parse(line) as unknown
    } catch {
      throw malformedFrame(options.status)
    }
    const parsed = ollamaLineSchema.safeParse(json)
    if (!parsed.success) {
      throw malformedFrame(options.status)
    }
    const frame = parsed.data
    if (frame.model !== undefined && frame.model !== options.model) {
      throw malformedFrame(options.status)
    }
    if (frame.error !== undefined && frame.error !== '') {
      throw new ModelApiError(frame.error, options.status, undefined, undefined)
    }
    const message = frame.message
    if (message?.content != null && message.content !== '') {
      if (!hasMessage) {
        hasMessage = true
        messageId = output.length
        const item: OutputItem = {
          type: 'message',
          id: messageItemId,
          role: 'assistant',
          content: [],
        }
        addItem(item)
        yield { type: 'response.output_item.added', output_index: messageId, item }
      }
      messageBytes += utf8.encode(message.content).byteLength
      enforceLimit(messageBytes, OLLAMA_ITEM_MAX_BYTES)
      messageText += message.content
      yield { type: 'response.output_text.delta', item_id: messageItemId, delta: message.content }
    }
    if (message?.thinking != null && message.thinking !== '') {
      if (!hasReasoning) {
        hasReasoning = true
        reasoningId = output.length
        const item: OutputItem = { type: 'reasoning', id: reasoningItemId }
        addItem(item)
        yield { type: 'response.output_item.added', output_index: reasoningId, item }
      }
      reasoningBytes += utf8.encode(message.thinking).byteLength
      enforceLimit(reasoningBytes, OLLAMA_ITEM_MAX_BYTES)
      reasoningText += message.thinking
      yield {
        type: 'response.reasoning_summary_text.delta',
        item_id: reasoningItemId,
        summary_index: 0,
        delta: message.thinking,
      }
    }
    const toolCalls = message?.tool_calls ?? []
    for (const call of toolCalls) {
      const index = call.function.index
      if (
        (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) ||
        call.id === '' ||
        (index === undefined && call.id === undefined)
      )
        throw malformedFrame(options.status)
      const key = index === undefined ? `id:${call.id ?? ''}` : `index:${String(index)}`
      // Captured whole calls cannot be concatenated or repeated under a new identity.
      if (calls.has(key) || (call.id !== undefined && nativeIds.has(call.id))) {
        throw malformedFrame(options.status)
      }
      const fragment = JSON.stringify(call.function.arguments)
      enforceLimit(utf8.encode(fragment).byteLength, OLLAMA_ARGUMENT_MAX_BYTES)
      const pending: PendingCall = {
        itemId: `${options.responseId}:tool:${String(calls.size)}`,
        callId: call.id ?? `${options.responseId}:call:${String(index)}`,
        name: call.function.name,
        argumentsText: fragment,
        itemIndex: output.length,
      }
      const item: OutputItem = {
        type: 'function_call',
        id: pending.itemId,
        call_id: pending.callId,
        name: pending.name,
        arguments: '',
      }
      addItem(item)
      calls.set(key, pending)
      if (call.id !== undefined) nativeIds.add(call.id)
      yield { type: 'response.output_item.added', output_index: pending.itemIndex, item }
      yield {
        type: 'response.function_call_arguments.delta',
        item_id: pending.itemId,
        delta: fragment,
      }
    }
    if (frame.done !== true) {
      continue
    }
    hasDone = true
    doneReason = frame.done_reason
    usage = usageOf(frame)
    break
  }
  if (!hasDone) {
    throw new ModelApiError(UI_TEXT.ollamaMissingFinal, options.status, undefined, undefined)
  }
  let doneItem: OutputItem
  if (hasMessage) {
    doneItem = {
      type: 'message',
      id: messageItemId,
      role: 'assistant',
      content: messageText === '' ? [] : [{ type: 'output_text', text: messageText }],
    }
    output[messageId] = doneItem
  } else {
    messageId = output.length
    doneItem = { type: 'message', id: messageItemId, role: 'assistant', content: [] }
    addItem(doneItem)
    yield { type: 'response.output_item.added', output_index: messageId, item: doneItem }
  }
  yield { type: 'response.output_item.done', output_index: messageId, item: doneItem }
  if (hasReasoning) {
    const item: OutputItem = {
      type: 'reasoning',
      id: reasoningItemId,
      summary: [{ type: 'summary_text', text: reasoningText }],
      encrypted_content: packThinking(reasoningText, options.model),
    }
    output[reasoningId] = item
    yield { type: 'response.output_item.done', output_index: reasoningId, item }
  }
  for (const call of calls.values()) {
    const item: OutputItem = {
      type: 'function_call',
      id: call.itemId,
      call_id: call.callId,
      name: call.name,
      arguments: call.argumentsText,
    }
    output[call.itemIndex] = item
    yield {
      type: 'response.function_call_arguments.done',
      item_id: call.itemId,
      arguments: call.argumentsText,
    }
    yield { type: 'response.output_item.done', output_index: call.itemIndex, item }
  }
  let status: ResponseObject['status'] = 'failed'
  if (doneReason === undefined || doneReason === 'stop') {
    status = 'completed'
  } else if (doneReason === 'length') {
    status = 'incomplete'
  }
  const response: ResponseObject = {
    id: options.responseId,
    status,
    model: options.model,
    output,
    ...(usage !== undefined && { usage }),
    ...(status === 'failed' &&
      doneReason !== undefined && {
        error: { message: fill(UI_TEXT.ollamaFinishReason, { reason: doneReason }) },
      }),
    ...(status === 'incomplete' && { incomplete_details: { reason: 'length' } }),
  }
  if (status === 'completed') {
    yield { type: 'response.completed', response }
  } else if (status === 'incomplete') {
    yield { type: 'response.incomplete', response }
  } else {
    yield { type: 'response.failed', response }
  }
}

// --- errors (research [OL-err]: `{"error": "…"}`) ---

/**
 * A non-2xx answer as a `ModelApiError`. The status is preserved so the
 * transport's retry policy (429 / 500 / 503) reads it; a 429 keeps the
 * `HTTP 429:` reason the host's rate-limit retry reads (D74). The message
 * is the server's own text, or the status line when the body is not an
 * error envelope.
 */
/** Tags retain their native details. No local route is certified without its capture. */
export function parseOllamaModelsList(body: unknown): readonly NativeModelMetadata[] {
  const rows = z.object({ models: z.array(nativeModelMetadataSchema) }).parse(body).models
  for (const row of rows) z.string().check(z.minLength(1)).parse(row['name'])
  return rows
}

export function parseOllamaError(status: number, body: unknown, statusText: string): ModelApiError {
  const rawError = isRecord(body) ? body['error'] : undefined
  const serverMessage = typeof rawError === 'string' && rawError !== '' ? rawError : undefined
  if (serverMessage !== undefined) {
    return new ModelApiError(
      status === HTTP_TOO_MANY_REQUESTS
        ? `HTTP ${String(status)}: ${serverMessage}`
        : serverMessage,
      status,
      status === HTTP_TOO_MANY_REQUESTS ? 'rate_limit_error' : undefined,
      undefined,
    )
  }
  return new ModelApiError(
    `HTTP ${String(status)} ${statusText}`.trim(),
    status,
    undefined,
    undefined,
  )
}
