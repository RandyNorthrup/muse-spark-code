// The Gemini `generateContent` codec (PLAN.md D74, M95 lane G): the pure
// translation between the harness's canonical request and stream shapes
// (`../schemas`: `CreateResponseBody`, `StreamEvent`, `ResponseObject`) and
// Google's native `generateContent` wire
// (`docs/certification/m95-research.md` §1.6, captured 2026-10-04 in
// `docs/certification/m95-captures/gemini/`).
//
// A pure function of the canonical body: no clock, no random id (D74's
// SoL-Pi invariant 1). The transport (lane T) owns retries, the origin check,
// `redirect: 'error'` and credentials: `encodeGeminiRequest` returns only the
// path and the JSON body, never an `x-goog-api-key` header, and
// `decodeGeminiStream` reads an already-fetched byte stream. The registry and
// presets (lane P) own the origin, the model reference and the price card.

import * as z from 'zod/mini'
import {
  nativeModelMetadataSchema,
  type NativeModelMetadata,
} from '../../../providers/modelMetadata'
import { capturedCapabilities } from '../../../providers/capturedCapabilities'
import type { ModelCapabilityRecord } from '../../../providers/capabilityRecord'
import { PROVIDER_MANUAL_THINKING_BUDGET } from '../../../../shared/constants'
import { UI_TEXT } from '../../../../shared/l10n/text'

import { ModelApiError } from '../client'
import type {
  CreateResponseBody,
  FunctionCallOutputItem,
  FunctionToolDefinition,
  InputContentPart,
  InputItem,
  ResponseObject,
  StreamEvent,
  Usage,
} from '../schemas'
import { parseSse } from '../sse'

// --- wire constants -----------------------------------------------------------

/** `POST {origin}/v1beta/models/{model}:streamGenerateContent?alt=sse`, streamed (research §1.6). */
export function geminiStreamPath(nativeModelId: string): string {
  return `/v1beta/models/${nativeModelId}:streamGenerateContent?alt=sse`
}

/** `GET {origin}/v1beta/models?pageSize=1000`, the free key test (captured 2026-10-04). */
export const GEMINI_MODELS_PATH = '/v1beta/models?pageSize=1000'

/**
 * The documented value that skips thought-signature validation for foreign
 * or injected history (research §1.6 [G-ts]): a replayed call the harness
 * never saw a signature for (another provider's turn kept across a model
 * switch, PLAN.md M95 acceptance 12) carries this instead of a signature,
 * since Gemini 3 answers an unsigned first call with a 400.
 */
export const GEMINI_SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/** `thinkingConfig.thinkingLevel` on 3.x models (research §1.6). */
export const GEMINI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number]

function isThinkingLevel(value: string): value is GeminiThinkingLevel {
  return (GEMINI_THINKING_LEVELS as readonly string[]).includes(value)
}

/**
 * The harness effort tier to Gemini's thinking level. Tiers above `high`
 * clamp to it; `none` (Thinking off) and anything unknown send no level,
 * which is always valid, and leave how much the model thinks to it: lane I
 * owns per-model effort validity from the registry.
 */
export function geminiThinkingLevelForEffort(effort: string): GeminiThinkingLevel | undefined {
  if (isThinkingLevel(effort)) {
    return effort
  }
  return effort === 'xhigh' || effort === 'max' ? 'high' : undefined
}

// --- native response schemas (validated before use, AGENTS.md rule 7) --------

const geminiFunctionCallSchema = z.object({
  name: z.string(),
  args: z.optional(z.unknown()),
  id: z.optional(z.string()),
})

const geminiPartSchema = z.object({
  text: z.optional(z.string()),
  thought: z.optional(z.boolean()),
  thoughtSignature: z.optional(z.string()),
  functionCall: z.optional(geminiFunctionCallSchema),
})

const geminiCandidateSchema = z.object({
  content: z.optional(
    z.object({
      parts: z.optional(z.array(geminiPartSchema)),
      role: z.optional(z.string()),
    }),
  ),
  finishReason: z.optional(z.string()),
})

const geminiUsageSchema = z.object({
  promptTokenCount: z.optional(z.number()),
  candidatesTokenCount: z.optional(z.number()),
  totalTokenCount: z.optional(z.number()),
  cachedContentTokenCount: z.optional(z.number()),
  thoughtsTokenCount: z.optional(z.number()),
})

const geminiChunkSchema = z.object({
  candidates: z.optional(z.array(geminiCandidateSchema)),
  usageMetadata: z.optional(geminiUsageSchema),
  modelVersion: z.optional(z.string()),
  responseId: z.optional(z.string()),
})
type GeminiChunk = z.infer<typeof geminiChunkSchema>

const geminiErrorSchema = z.object({
  error: z.object({
    code: z.optional(z.number()),
    message: z.optional(z.string()),
    status: z.optional(z.string()),
  }),
})

const geminiModelsListSchema = z.object({
  models: z.array(
    z.looseObject({
      name: z.string(),
      inputTokenLimit: z.optional(z.number()),
      outputTokenLimit: z.optional(z.number()),
      supportedGenerationMethods: z.optional(z.array(z.string())),
    }),
  ),
})

// --- the tool-parameters schema subset ----------------------------------------

/**
 * The `functionDeclarations.parameters` keys the codec sends: the OpenAPI
 * 3.0 subset field set. Everything else the harness or an MCP server may
 * put in a JSON schema (`$schema`, `additionalProperties`, `strict`,
 * composition keywords outside `anyOf`, …) has no representation here and is
 * dropped; the host's own zod parsing of the model's arguments stays the
 * backstop for a loosened schema. `$ref` is resolved against the parameters
 * root instead: external or unresolvable references throw, since silently
 * dropping a whole subschema would not be a schema at all.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  'anyOf',
  'default',
  'description',
  'enum',
  'example',
  'format',
  'items',
  'maxItems',
  'maximum',
  'maxLength',
  'maxProperties',
  'minItems',
  'minimum',
  'minLength',
  'minProperties',
  'nullable',
  'pattern',
  'properties',
  'propertyOrdering',
  'required',
  'title',
  'type',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A `#/…` JSON pointer (`~0`/`~1` unescaped) read from `root`. */
function resolvePointer(root: unknown, pointer: string): unknown {
  let current: unknown = root
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (isRecord(current)) {
      const next: unknown = current[key]
      if (next === undefined) {
        throw new Error(`Gemini codec: unresolvable $ref '${pointer}'`)
      }
      current = next
    } else if (Array.isArray(current) && /^\d+$/.test(key)) {
      const next: unknown = current[Number(key)]
      if (next === undefined) {
        throw new Error(`Gemini codec: $ref '${pointer}' points past an array`)
      }
      current = next
    } else {
      throw new Error(`Gemini codec: unresolvable $ref '${pointer}'`)
    }
  }
  return current
}

function rewriteSchemaNode(node: unknown, root: unknown, resolving: readonly string[]): unknown {
  // A `$ref` continues with its target instead of recursing: only arrays and
  // objects branch.
  let current: unknown = node
  let seen = resolving
  for (;;) {
    if (Array.isArray(current)) {
      return current.map((entry) => rewriteSchemaNode(entry, root, seen))
    }
    if (!isRecord(current)) {
      return current
    }
    const ref: unknown = current['$ref']
    if (ref === undefined) {
      break
    }
    if (typeof ref !== 'string') {
      throw new TypeError('Gemini codec: $ref must be a string')
    }
    if (!ref.startsWith('#/')) {
      throw new Error(`Gemini codec: external $ref '${ref}' has no Gemini form`)
    }
    if (seen.includes(ref)) {
      throw new Error(`Gemini codec: circular $ref '${ref}'`)
    }
    seen = [...seen, ref]
    current = resolvePointer(root, ref.slice(1))
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) {
      continue
    }
    if (key === 'properties' && isRecord(value)) {
      const properties: Record<string, unknown> = {}
      for (const [name, schema] of Object.entries(value)) {
        properties[name] = rewriteSchemaNode(schema, root, seen)
      }
      out[key] = properties
    } else if (key === 'items' || key === 'anyOf') {
      out[key] = rewriteSchemaNode(value, root, seen)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Rewrites a tool's `parameters` to Gemini's OpenAPI 3.0 subset, key order
 * and values otherwise untouched so the same canonical body always encodes
 * to the same bytes.
 */
export function toGeminiSchemaSubset(parameters: Record<string, unknown>): Record<string, unknown> {
  const rewritten = rewriteSchemaNode(parameters, parameters, [])
  if (!isRecord(rewritten)) {
    throw new Error('Gemini codec: tool parameters must be a schema object')
  }
  return rewritten
}

// --- encode: canonical body to a native request -------------------------------

/** What the transport sends: the path below the preset's origin, and the JSON body. */
export interface GeminiNativeRequest {
  readonly path: string
  readonly body: Record<string, unknown>
}

interface GeminiContent {
  readonly role: 'user' | 'model'
  readonly parts: unknown[]
}

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/s

/** The data URL of an `input_image` or `input_file` part. */
function inlineDataUrl(part: InputContentPart): string {
  if (part.type === 'input_image') {
    return part.image_url
  }
  return part.type === 'input_file' ? part.file_data : ''
}

/** An `input_image` or `input_file` data URL as Gemini's `inlineData`. */
function toInlineData(part: InputContentPart): unknown {
  const match = DATA_URL_PATTERN.exec(inlineDataUrl(part))
  if (match === null) {
    throw new Error('Gemini codec: image and file parts must be data URLs')
  }
  const mimeType = match[1]
  const data = match[3]
  return { inlineData: { ...(mimeType !== undefined && { mimeType }), data: data ?? '' } }
}

/** A message's content parts as native parts (`output_text` is replayed assistant text). */
function toNativeParts(content: readonly InputContentPart[]): unknown[] {
  const parts: unknown[] = []
  for (const part of content) {
    if (part.type === 'input_image' || part.type === 'input_file') {
      parts.push(toInlineData(part))
    } else {
      parts.push({ text: part.text })
    }
  }
  return parts
}

/**
 * A tool result as the `functionResponse.response` object (research §1.6):
 * a JSON-object string goes back as that object (the capture replays
 * `{"timezone": …, "time": …}` verbatim); anything else, including text
 * joined from content parts, as `{result}`. No tool-result image form was
 * captured or recorded in research §1.6, so media refuses the whole request
 * with a named error before any text-only representation can be sent.
 */
function toFunctionResponseBody(output: FunctionCallOutputItem['output']): Record<string, unknown> {
  if (typeof output !== 'string' && output.some((part) => part.type === 'input_image')) {
    throw new ModelApiError(
      'GeminiToolResultImageUnsupported',
      0,
      'unsupported_content',
      'gemini_tool_result_image_unsupported',
    )
  }
  const text =
    typeof output === 'string'
      ? output
      : output
          .filter((part) => part.type === 'input_text')
          .map((part) => part.text)
          .join('\n')
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) {
      return parsed
    }
  } catch {
    // Not a JSON object: wrapped below.
  }
  return { result: text }
}

/**
 * The canonical input as native `contents`, consecutive same-role items one
 * content: the harness replays assistant text, calls and results as separate
 * items, while Gemini groups a turn's parts under one `user` or `model`
 * content (the captured replay's shape). A reasoning item carrying a thought
 * signature arms the next call; signature-less reasoning (another provider's,
 * kept across a switch) and `web_search_call` items (never declared to a
 * BYO model, M95 acceptance 11) have no native form and stay out.
 */
interface ContentsBuild {
  readonly contents: { role: 'user' | 'model'; parts: unknown[] }[]
  readonly callNames: Map<string, string>
  pendingSignature: string | undefined
}

function pushParts(build: ContentsBuild, role: 'user' | 'model', parts: unknown[]): void {
  if (parts.length === 0) {
    return
  }
  const current = build.contents.at(-1)
  if (current?.role === role) {
    current.parts.push(...parts)
  } else {
    build.contents.push({ role, parts: [...parts] })
  }
}

function convertItem(build: ContentsBuild, item: InputItem): void {
  if (item.type === 'message') {
    pushParts(build, item.role === 'user' ? 'user' : 'model', toNativeParts(item.content))
    return
  }
  if (item.type === 'function_call_output') {
    const name = build.callNames.get(item.call_id)
    if (name === undefined) {
      throw new Error(`Gemini codec: no function call '${item.call_id}' for its output`)
    }
    pushParts(build, 'user', [
      {
        functionResponse: {
          id: item.call_id,
          name,
          response: toFunctionResponseBody(item.output),
        },
      },
    ])
    return
  }
  if (item.type === 'function_call') {
    let args: unknown
    try {
      args = JSON.parse(item.arguments)
    } catch {
      throw new Error(`Gemini codec: function call '${item.name}' has non-JSON arguments`)
    }
    // The signature goes back in the exact part it came in, unmerged
    // (research §1.6); an unsigned call takes the documented dummy so a
    // foreign step still validates.
    const thoughtSignature = build.pendingSignature ?? GEMINI_SKIP_THOUGHT_SIGNATURE
    build.pendingSignature = undefined
    pushParts(build, 'model', [
      {
        functionCall: { name: item.name, args, id: item.call_id },
        thoughtSignature,
      },
    ])
    return
  }
  if (item.type !== 'reasoning') {
    // `web_search_call` items are dropped: see above.
    return
  }
  if (typeof item.encrypted_content === 'string' && item.encrypted_content !== '') {
    build.pendingSignature = item.encrypted_content
  }
}

function toContents(input: readonly InputItem[]): GeminiContent[] {
  const build: ContentsBuild = { contents: [], callNames: new Map(), pendingSignature: undefined }
  for (const item of input) {
    if (item.type === 'function_call') {
      build.callNames.set(item.call_id, item.name)
    }
  }
  for (const item of input) {
    convertItem(build, item)
  }
  return build.contents
}

/**
 * The native request for one canonical body: `systemInstruction` from the
 * instructions (text only, research §1.6), `functionDeclarations` in the
 * schema subset with `AUTO` calling, and the output cap plus thinking level
 * in `generationConfig`. Meta-only fields (`store`, `prompt_cache_key`,
 * `include`, `tool_choice`) are never sent.
 */
export function encodeGeminiRequest(
  body: CreateResponseBody,
  nativeModelId: string,
  capabilityRecord?: ModelCapabilityRecord,
  thinkingBudget?: number,
): GeminiNativeRequest {
  const declarations = body.tools
    .filter((tool): tool is FunctionToolDefinition => tool.type === 'function')
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toGeminiSchemaSubset(tool.parameters),
    }))
  const thinkingLevel = geminiThinkingLevelForEffort(body.reasoning.effort)
  const record = capabilityRecord ?? capturedCapabilities('gemini', nativeModelId)
  if (body.reasoning.effort !== 'none' && record.reasoning.supported.state === 'no')
    throw new Error(`${UI_TEXT.providerCapabilityUnsupported} (gemini_reasoning_unsupported)`)
  if (
    body.reasoning.effort === 'none' &&
    (record.reasoning.forced.state === 'yes' || record.reasoning.canDisable.state === 'no')
  )
    throw new Error(`${UI_TEXT.providerCapabilityUnsupported} (gemini_thinking_cannot_disable)`)
  const modes = record.reasoning.modes.state === 'yes' ? record.reasoning.modes.value : []
  const isBudgetUsed = modes.includes('budget')
  const budget =
    body.reasoning.effort === 'none'
      ? 0
      : (thinkingBudget ??
        Math.max(record.reasoning.budget?.min ?? 0, PROVIDER_MANUAL_THINKING_BUDGET))
  if (
    isBudgetUsed &&
    (!Number.isSafeInteger(budget) ||
      budget < (record.reasoning.budget?.min ?? 0) ||
      (body.reasoning.effort !== 'none' && budget <= 0) ||
      budget > (record.reasoning.budget?.max ?? Infinity) ||
      budget >= body.max_output_tokens)
  )
    throw new Error(`${UI_TEXT.providerCapabilityUnsupported} (gemini_invalid_thinking_budget)`)
  if (thinkingLevel !== undefined && !isBudgetUsed && !modes.includes('level'))
    throw new Error(`${UI_TEXT.providerCapabilityUnsupported} (gemini_unknown_thinking_mode)`)
  const supportedLevel =
    thinkingLevel !== undefined &&
    record.reasoning.effortLevels.state === 'yes' &&
    record.reasoning.effortLevels.value.includes(thinkingLevel)
      ? thinkingLevel
      : undefined
  const request: Record<string, unknown> = {
    ...(body.instructions !== '' && {
      systemInstruction: { parts: [{ text: body.instructions }] },
    }),
    contents: toContents(body.input),
  }
  if (declarations.length > 0) {
    request['tools'] = [{ functionDeclarations: declarations }]
    request['toolConfig'] = { functionCallingConfig: { mode: 'AUTO' } }
  }
  request['generationConfig'] = {
    maxOutputTokens: body.max_output_tokens,
    ...(isBudgetUsed
      ? { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } }
      : thinkingLevel !== undefined && {
          thinkingConfig: {
            ...(supportedLevel !== undefined && { thinkingLevel: supportedLevel }),
            includeThoughts: true,
          },
        }),
  }
  return { path: geminiStreamPath(nativeModelId), body: request }
}

// --- decode: native stream to canonical events ---------------------------------

const SSE_DONE_SENTINEL = '[DONE]'

/**
 * One SSE frame's JSON. A malformed frame ends the turn with an error: the
 * reply can no longer be trusted. The error carries the frame's length, not
 * its text, since the frame is model output.
 */
function parseFrameJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    throw new ModelApiError(
      `Malformed stream frame (${String(data.length)} characters)`,
      0,
      undefined,
      undefined,
    )
  }
}

/** A decoded call: the wire id is kept, so replay and the prefix never shift. */
interface DecodedCall {
  readonly id: string
  readonly name: string
  readonly args: string
  readonly signature: string | undefined
}

/**
 * `usageMetadata` to canonical usage. `cachedContentTokenCount` stays out
 * while absent: implicit caching never appeared in the captures, so the
 * cached count is unknown, not zero (captures § Gemini, item 11).
 */
function toUsage(usage: z.infer<typeof geminiUsageSchema>): Usage | undefined {
  const { promptTokenCount, candidatesTokenCount, cachedContentTokenCount, thoughtsTokenCount } =
    usage
  if (promptTokenCount === undefined || candidatesTokenCount === undefined) {
    return undefined
  }
  return {
    input_tokens: promptTokenCount,
    // Thinking is billed as output (research §1.6; captures 04 and 05).
    output_tokens: candidatesTokenCount + (thoughtsTokenCount ?? 0),
    ...(usage.totalTokenCount !== undefined && { total_tokens: usage.totalTokenCount }),
    ...(cachedContentTokenCount !== undefined && {
      input_tokens_details: { cached_tokens: cachedContentTokenCount },
    }),
    ...(thoughtsTokenCount !== undefined && {
      output_tokens_details: { reasoning_tokens: thoughtsTokenCount },
    }),
  }
}

const GEMINI_MAX_TOKENS = 'MAX_TOKENS'
const GEMINI_MESSAGE_ID = 'msg_1'
const GEMINI_REASONING_ID = 'rs_1'

/**
 * Only `STOP` completes a turn (including calls, capture 02). A missing
 * terminal reason is an interrupted stream; calls never override a cut or
 * failed finish reason.
 */
function terminalEvent(
  responseId: string,
  model: string,
  text: string,
  thoughtText: string,
  calls: readonly DecodedCall[],
  finishReason: string | undefined,
  usage: Usage | undefined,
): StreamEvent {
  const output: ResponseObject['output'] = []
  if (thoughtText !== '') {
    output.push({
      type: 'reasoning',
      id: GEMINI_REASONING_ID,
      summary: [{ type: 'summary_text', text: thoughtText }],
    })
  }
  if (text !== '' || calls.length === 0) {
    output.push({
      type: 'message',
      id: GEMINI_MESSAGE_ID,
      role: 'assistant',
      ...(calls.length > 0 && text !== '' && { phase: 'commentary' }),
      content: [{ type: 'output_text', text }],
    })
  }
  for (const call of calls) {
    if (call.signature !== undefined) {
      output.push({ type: 'reasoning', id: `rs_${call.id}`, encrypted_content: call.signature })
    }
    output.push({
      type: 'function_call',
      id: call.id,
      call_id: call.id,
      name: call.name,
      arguments: call.args,
    })
  }
  const response: ResponseObject = {
    id: responseId,
    status: 'completed',
    model,
    output,
    ...(usage !== undefined && { usage }),
  }
  if (finishReason === 'STOP') {
    return { type: 'response.completed', response }
  }
  // Text before a `MAX_TOKENS` cut stays readable; the reason says it was cut.
  if (finishReason === GEMINI_MAX_TOKENS || finishReason === undefined) {
    return {
      type: 'response.incomplete',
      response: {
        ...response,
        status: 'incomplete',
        incomplete_details: {
          reason:
            finishReason === GEMINI_MAX_TOKENS
              ? 'max_output_tokens'
              : 'stream_ended_without_finish_reason',
        },
      },
    }
  }
  return {
    type: 'response.failed',
    response: {
      ...response,
      status: 'failed',
      error: { message: `Gemini stopped the turn: ${finishReason}` },
    },
  }
}

/**
 * One native SSE stream as canonical events ending in a canonical response,
 * for the qualified model reference `model`. Chunks stream whole candidates
 * (text accumulates across them); only the last `usageMetadata` counts.
 * A `thoughtSignature` on a text part is dropped: the captured replay
 * without it was accepted, so it is not needed to validate the next request
 * (capture 03). An empty stream, or one with no response id, throws: there
 * is no canonical response to end in.
 */
export async function* decodeGeminiStream(
  chunks: AsyncIterable<Uint8Array>,
  model: string,
): AsyncGenerator<StreamEvent> {
  let responseId: string | undefined
  let usage: Usage | undefined
  let finishReason: string | undefined
  let text = ''
  let thoughtText = ''
  const calls: DecodedCall[] = []
  let isMessageOpen = false
  let isReasoningOpen = false
  let isSeenFrame = false
  for await (const frame of parseSse(chunks)) {
    if (frame.data.trim() === '' || frame.data === SSE_DONE_SENTINEL) {
      continue
    }
    const parsed = geminiChunkSchema.safeParse(parseFrameJson(frame.data))
    if (!parsed.success) {
      throw new ModelApiError('Gemini stream frame had no candidates', 0, undefined, undefined)
    }
    const chunk: GeminiChunk = parsed.data
    // A JSON frame with none of the response's fields is not a heartbeat
    // (Gemini sends none): the reply can no longer be trusted.
    if (
      chunk.candidates === undefined &&
      chunk.usageMetadata === undefined &&
      chunk.responseId === undefined &&
      chunk.modelVersion === undefined
    ) {
      throw new ModelApiError('Gemini stream frame had no candidates', 0, undefined, undefined)
    }
    isSeenFrame = true
    if (responseId === undefined && chunk.responseId !== undefined) {
      responseId = chunk.responseId
      const opening: ResponseObject = {
        id: responseId,
        status: 'in_progress',
        model,
        output: [],
      }
      yield { type: 'response.created', response: opening }
    }
    if (chunk.usageMetadata !== undefined) {
      const mapped = toUsage(chunk.usageMetadata)
      if (mapped !== undefined) {
        usage = mapped
      }
    }
    const candidates = chunk.candidates ?? []
    for (const candidate of candidates) {
      if (candidate.finishReason !== undefined) {
        finishReason = candidate.finishReason
      }
      const parts = candidate.content?.parts ?? []
      for (const part of parts) {
        if (part.thought === true && part.text !== undefined && part.text !== '') {
          if (!isReasoningOpen) {
            isReasoningOpen = true
            yield {
              type: 'response.output_item.added',
              item: { type: 'reasoning', id: GEMINI_REASONING_ID, summary: [] },
            }
          }
          thoughtText += part.text
          yield {
            type: 'response.reasoning_summary_text.delta',
            item_id: GEMINI_REASONING_ID,
            delta: part.text,
          }
        } else if (part.functionCall !== undefined) {
          const callId = part.functionCall.id ?? `call_${String(calls.length)}`
          const call: DecodedCall = {
            id: callId,
            name: part.functionCall.name,
            args: JSON.stringify(part.functionCall.args ?? {}),
            signature: part.thoughtSignature,
          }
          calls.push(call)
          yield {
            type: 'response.output_item.added',
            item: {
              type: 'function_call',
              id: call.id,
              call_id: call.id,
              name: call.name,
              arguments: call.args,
            },
          }
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: call.id,
            delta: call.args,
          }
        } else if (part.text !== undefined && part.text !== '') {
          if (!isMessageOpen) {
            isMessageOpen = true
            yield {
              type: 'response.output_item.added',
              item: { type: 'message', id: GEMINI_MESSAGE_ID, role: 'assistant', content: [] },
            }
          }
          text += part.text
          yield { type: 'response.output_text.delta', item_id: GEMINI_MESSAGE_ID, delta: part.text }
        }
      }
    }
  }
  if (!isSeenFrame || responseId === undefined) {
    throw new ModelApiError('Gemini returned an empty stream', 0, undefined, undefined)
  }
  if (isMessageOpen) {
    yield {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        id: GEMINI_MESSAGE_ID,
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    }
  }
  if (isReasoningOpen) {
    yield {
      type: 'response.output_item.done',
      item: {
        type: 'reasoning',
        id: GEMINI_REASONING_ID,
        summary: [{ type: 'summary_text', text: thoughtText }],
      },
    }
  }
  for (const call of calls) {
    yield {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        id: call.id,
        call_id: call.id,
        name: call.name,
        arguments: call.args,
      },
    }
  }
  yield terminalEvent(responseId, model, text, thoughtText, calls, finishReason, usage)
}

// --- errors and the models list --------------------------------------------------

/**
 * The `{"error": {"code", "message", "status"}}` envelope to `ModelApiError`.
 * The transport reads a 4xx/5xx body by its content, not its content type: a
 * Gemini error arrives as JSON under `text/event-stream` (captures § Gemini).
 * 429 and 402 both mean `RESOURCE_EXHAUSTED` (research §1.6); the status and
 * message keep the host's `HTTP 429:` retry legible.
 */
export function parseGeminiError(status: number, body: unknown): ModelApiError {
  const parsed = geminiErrorSchema.safeParse(body)
  if (!parsed.success) {
    return new ModelApiError(`HTTP ${String(status)}`, status, undefined, undefined)
  }
  const { code, message, status: statusName } = parsed.data.error
  return new ModelApiError(
    message ?? `HTTP ${String(status)}`,
    status,
    statusName,
    code === undefined ? undefined : String(code),
  )
}

/** One `models.list` entry the preset keeps: the id with its window, when listed. */
export interface GeminiListedModel {
  readonly native?: NativeModelMetadata
  readonly id: string
  readonly inputTokenLimit: number | undefined
  readonly outputTokenLimit: number | undefined
}

/**
 * The models list to keepable entries: only methods that serve
 * `generateContent` (the capture lists `generateContent`, `countTokens`,
 * `createCachedContent` and `batchGenerateContent` per model), ids without
 * the `models/` prefix.
 */
export function parseGeminiModelsList(body: unknown): readonly GeminiListedModel[] {
  const parsed = geminiModelsListSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('Gemini codec: models list had no models')
  }
  const models: GeminiListedModel[] = []
  for (const entry of parsed.data.models) {
    if (!(entry.supportedGenerationMethods ?? []).includes('generateContent')) {
      continue
    }
    models.push({
      id: entry.name.startsWith('models/') ? entry.name.slice('models/'.length) : entry.name,
      inputTokenLimit: entry.inputTokenLimit,
      outputTokenLimit: entry.outputTokenLimit,
      native: nativeModelMetadataSchema.parse(entry),
    })
  }
  return models
}
