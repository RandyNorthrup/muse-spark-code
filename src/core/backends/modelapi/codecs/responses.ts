// M95 lane R: pure Responses encoding and capture-backed SSE decoding.
// Provider policy is injected by lane P; auth, retries and HTTP errors
// belong to lane T. The shared WireCodec has not landed on this branch, so
// ResponsesWireCodec is the explicit seam for its transport adapter.

import type { ModelCapabilities } from '../../../providers/capabilities'
import * as z from 'zod/mini'
import { CODEC_EMPTY_TOOL_OUTPUT, CODEC_IMAGE_WITHOUT_VISION } from '../../../../shared/constants'
export { parseNativeModelsList as parseResponsesModelsList } from '../../../providers/modelMetadata'
import {
  type CreateResponseBody,
  errorBodySchema,
  eventTypeSchema,
  type FunctionCallItem,
  type FunctionToolDefinition,
  functionCallItemSchema,
  type FunctionOutputPart,
  type InputContentPart,
  type InputItem,
  messageItemSchema,
  outputTextPartSchema,
  reasoningItemSchema,
  responseSchema,
  type StreamEvent,
  streamEventSchema,
  type Usage,
  usageSchema,
  webSearchCallItemSchema,
  withStrictTools,
  type WebSearchToolDefinition,
} from '../schemas'
import { parseSse } from '../sse'
import { cleanWireText, isBlankWireText } from './shared'

export type ResponsesCodecQuirks =
  | {
      readonly vision?: boolean | undefined
      readonly supportsStrictTools?: boolean | undefined
      readonly profile?: 'api'
      readonly sendPromptCacheRetention: boolean
      readonly sendPromptCacheKey: boolean
    }
  | {
      readonly profile: 'chatgpt'
      readonly vision?: boolean | undefined
      readonly supportsStrictTools?: boolean | undefined
      /** Stable across turns; supplied by the host, never derived from a token. */
      readonly toolNamespace: string
      /** The caller's namespace description, preserved as in the M95b capture. */
      readonly toolNamespaceDescription?: string
    }
/**
 * M101 lane P1 (BYO item 2): per-request replay provenance. Replayed call
 * ids resolve only against the model that produced them (Pi
 * `openai-responses-shared.ts`): `replayOrigins` names that model per
 * `call_id`, defaulting to the request's own model. Lane I fills it from
 * each replay entry's provider and model; until it does, every replay reads
 * as same-model.
 */
export interface ResponsesEncodeOptions {
  readonly model?: string | undefined
  readonly replayOrigins?: Readonly<Record<string, string>> | undefined
}

/** Technical diagnostics contain no provider-controlled text or schema errors. */
export class ResponsesDecodeError extends Error {
  public constructor(
    reason: string,
    public readonly frameLength: number,
  ) {
    super(`ResponsesDecodeError: ${reason}`)
    this.name = 'ResponsesDecodeError'
  }
}

const CHATGPT_PLAN_LIMIT_CODE = 'subscription_sharing_usage_limit_exceeded'

/** The plan endpoint reports this in an HTTP 200 SSE stream (M95b capture). */
export class ChatgptPlanLimitError extends Error {
  public readonly code = CHATGPT_PLAN_LIMIT_CODE

  public constructor(message: string) {
    super(message)
    this.name = 'ChatgptPlanLimitError'
  }
}

/** Cancellation is local; no output-cap parameter is sent to the plan endpoint. */
export class ResponsesOutputCapError extends Error {
  public constructor(
    public readonly maxOutputTokens: number,
    public readonly outputTokens: number,
    /** Validated report for canonical failure settlement; never rejected output. */
    public readonly usage?: Usage,
  ) {
    super('ResponsesOutputCapError: client output cap exceeded')
    this.name = 'ResponsesOutputCapError'
  }
}

/** Per-request host dependencies, kept out of the pure request encoder. */
export interface ResponsesOutputCap {
  readonly maxOutputTokens: number
  /**
   * Cumulative tokens after this validated event, including tool arguments
   * and whole final items without double-counting earlier deltas. The host
   * supplies its model's counter; the codec never guesses chars per token.
   */
  readonly countOutputTokens: (event: StreamEvent) => number
  /** Abort only this request's active transport when the cap is crossed. */
  readonly abort: () => void
}

/** xAI's reported cost reaches settlement before canonical consumers read usage. */
export interface ResponsesDecodeSink {
  readonly settledCostUsd?: (costUsd: number) => void
  /** Mandatory for the ChatGPT profile, unused by the API-key profile. */
  readonly outputCap?: ResponsesOutputCap
}

// Meta's canonical tools declare strict:false. This wire seam also accepts
// strict:true declarations (the M95b capture) without changing those schemas.
type ResponsesRequestBody = Omit<CreateResponseBody, 'tools'> & {
  readonly tools: readonly (
    | WebSearchToolDefinition
    | (Omit<FunctionToolDefinition, 'strict'> & { readonly strict: boolean })
  )[]
}

export interface ResponsesWireCodec {
  readonly format: 'responses'
  encodeRequest(
    body: ResponsesRequestBody,
    options?: ResponsesEncodeOptions,
  ): Record<string, unknown>
  decodeStream(
    chunks: AsyncIterable<Uint8Array>,
    sink?: ResponsesDecodeSink,
  ): AsyncGenerator<StreamEvent>
}

/** A server-minted Responses call id; only these resolve on replay. */
const RESPONSES_CALL_ID_PREFIX = 'fc_'

/**
 * M101 lane P1 (BYO item 2): whether a replayed `function_call` keeps its
 * `id`. Only a server-minted `fc_…` id from the request's own model replays;
 * a foreign id (another format's, a synthetic one) or another model's id is
 * dropped while `call_id` still pairs the result (Pi #886).
 */
function shouldKeepReplayCallId(
  item: FunctionCallItem,
  model: string,
  origins: Readonly<Record<string, string>> | undefined,
): boolean {
  const id = item.id
  return id?.startsWith(RESPONSES_CALL_ID_PREFIX)
    ? (origins?.[item.call_id] ?? model) === model
    : false
}

function replayTextPart(text: string): { readonly text: string } | undefined {
  return isBlankWireText(text) ? undefined : { text: cleanWireText(text) }
}

/**
 * One message content part replayed (BYO items 1, 13): blank text drops
 * (as `undefined`), images ride as the image-omitted placeholder where the
 * model takes no images, and files ride with a cleaned name. Inputs
 * without any of these map back byte-identical.
 */
function replayContentPart(
  part: InputContentPart,
  quirks: ResponsesCodecQuirks,
): InputContentPart | undefined {
  switch (part.type) {
    case 'input_text':
    case 'output_text': {
      const text = replayTextPart(part.text)
      return text === undefined ? undefined : { ...part, text: text.text }
    }
    case 'input_image': {
      return quirks.vision === false
        ? { type: 'input_text', text: CODEC_IMAGE_WITHOUT_VISION }
        : part
    }
    case 'input_file': {
      return { ...part, filename: cleanWireText(part.filename) }
    }
  }
}

/**
 * M101 lane P1 (BYO items 1, 13): the replay-safe input. Blank text is
 * dropped (an item left with no content is dropped with it), empty results
 * ride as an explicit marker, lone surrogates are removed, and images ride
 * as the image-omitted placeholder where the model takes no images. Inputs
 * without any of these map back byte-identical (the copies below keep every
 * key in order).
 */
function replayInput(
  input: readonly InputItem[],
  quirks: ResponsesCodecQuirks,
  model: string,
  origins: Readonly<Record<string, string>> | undefined,
): InputItem[] {
  const mapped: InputItem[] = []
  for (const item of input) {
    switch (item.type) {
      case 'message': {
        const content: InputContentPart[] = []
        for (const part of item.content) {
          const replayed = replayContentPart(part, quirks)
          if (replayed !== undefined) {
            content.push(replayed)
          }
        }
        if (content.length > 0) {
          mapped.push({ ...item, content })
        }
        continue
      }
      case 'function_call': {
        // M101 lane P1 (BYO item 2): the `id` replays only per
        // `shouldKeepReplayCallId`; `call_id` still pairs the result.
        const replayed: FunctionCallItem = { ...item, arguments: cleanWireText(item.arguments) }
        if (!shouldKeepReplayCallId(item, model, origins)) {
          delete replayed.id
        }
        mapped.push(replayed)
        continue
      }
      case 'function_call_output': {
        if (typeof item.output === 'string') {
          mapped.push(
            isBlankWireText(item.output)
              ? { ...item, output: CODEC_EMPTY_TOOL_OUTPUT }
              : { ...item, output: cleanWireText(item.output) },
          )
          continue
        }
        const output: FunctionOutputPart[] = []
        for (const part of item.output) {
          if (part.type === 'input_image') {
            output.push(
              quirks.vision === false
                ? { type: 'input_text', text: CODEC_IMAGE_WITHOUT_VISION }
                : part,
            )
          } else {
            const text = replayTextPart(part.text)
            if (text !== undefined) {
              output.push({ ...part, text: text.text })
            }
          }
        }
        mapped.push(
          output.length === 0 ? { ...item, output: CODEC_EMPTY_TOOL_OUTPUT } : { ...item, output },
        )
        continue
      }
      default: {
        mapped.push(item)
        continue
      }
    }
  }
  return mapped
}

const DONE_SENTINEL = '[DONE]'
/** Wire unit, not a tunable: xAI reports USD in 1e-10 ticks (D74). */
const USD_PER_COST_TICK = 1e-10
const KNOWN_EVENT_TYPES = new Set([
  'response.created',
  'response.in_progress',
  'response.completed',
  'response.failed',
  'response.incomplete',
  'response.output_item.added',
  'response.output_item.done',
  'response.output_text.delta',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.reasoning_summary_text.delta',
  'error',
])
const TERMINAL_WITH_USAGE = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
])

// Keep captured additions on replay items while refusing malformed known
// items: the canonical schema's catch-all must not swallow a broken tool call.
const KNOWN_ITEM_TYPES = new Set(['message', 'function_call', 'reasoning', 'web_search_call'])
const otherItemSchema = z.looseObject({
  type: z.string().check(z.refine((type) => !KNOWN_ITEM_TYPES.has(type))),
  id: z.optional(z.string()),
})
const nativePartSchema = z.union([
  z.looseObject(outputTextPartSchema.shape),
  z.looseObject({ type: z.literal('refusal'), refusal: z.string() }),
  z.looseObject({
    type: z.string().check(z.refine((type) => type !== 'output_text' && type !== 'refusal')),
  }),
])
const nativeItemSchema = z.union([
  z.looseObject({ ...messageItemSchema.shape, content: z.array(nativePartSchema) }),
  z.looseObject(functionCallItemSchema.shape),
  z.looseObject(reasoningItemSchema.shape),
  z.looseObject(webSearchCallItemSchema.shape),
  otherItemSchema,
])
const tokenCountSchema = z.number().check(z.nonnegative())
const nativeUsageSchema = z
  .looseObject({
    ...usageSchema.shape,
    input_tokens: tokenCountSchema,
    output_tokens: tokenCountSchema,
    total_tokens: z.optional(tokenCountSchema),
    input_tokens_details: z.optional(
      z.nullable(
        z.looseObject({
          cached_tokens: z.optional(tokenCountSchema),
          cache_write_tokens: z.optional(tokenCountSchema),
        }),
      ),
    ),
    output_tokens_details: z.optional(
      z.nullable(
        z.looseObject({
          reasoning_tokens: z.optional(tokenCountSchema),
        }),
      ),
    ),
  })
  .check(
    z.refine(
      (usage) =>
        (usage.input_tokens_details?.cached_tokens ?? 0) <= usage.input_tokens &&
        (usage.input_tokens_details?.cache_write_tokens ?? 0) <= usage.input_tokens,
    ),
  )
const responseFrameSchema = z.object({
  response: z.object({
    ...responseSchema.shape,
    output: z.array(nativeItemSchema),
    usage: z.optional(z.nullable(nativeUsageSchema)),
  }),
})
const itemFrameSchema = z.object({ item: nativeItemSchema })
const settledCostSchema = z.object({
  cost_in_usd_ticks: tokenCountSchema,
})
const nestedErrorEventSchema = z.object({ type: z.literal('error'), ...errorBodySchema.shape })

function settledCostOf(usage: unknown): number | undefined {
  const parsed = settledCostSchema.safeParse(usage)
  return parsed.success ? parsed.data.cost_in_usd_ticks * USD_PER_COST_TICK : undefined
}

function withinOutputCap(event: StreamEvent, cap: ResponsesOutputCap | undefined): StreamEvent {
  if (cap === undefined) return event
  const counted = cap.countOutputTokens(event)
  if (!Number.isSafeInteger(counted) || counted < 0) {
    throw new ResponsesDecodeError('invalid output counter', 0)
  }
  // Encrypted reasoning is not observable in deltas. Reported output usage
  // includes it; it can only stop the reply once that usage arrives.
  const reported = 'response' in event ? (event.response.usage?.output_tokens ?? 0) : 0
  const outputTokens = Math.max(counted, reported)
  if (outputTokens > cap.maxOutputTokens) {
    cap.abort()
    throw new ResponsesOutputCapError(
      cap.maxOutputTokens,
      outputTokens,
      'response' in event ? (event.response.usage ?? undefined) : undefined,
    )
  }
  return event
}

export function createResponsesCodec(
  quirks: ResponsesCodecQuirks,
  capabilitiesForModel?: (modelId: string) => ModelCapabilities | undefined,
): ResponsesWireCodec {
  return {
    format: 'responses',
    encodeRequest(
      body: ResponsesRequestBody,
      options?: ResponsesEncodeOptions,
    ): Record<string, unknown> {
      const isChatgpt = quirks.profile === 'chatgpt'
      if (isChatgpt && body.tools.some((tool) => tool.type !== 'function')) {
        throw new ResponsesDecodeError('unsupported ChatGPT hosted tool', 0)
      }
      // M101 lane P1 (BYO items 1, 2, 13): the input replays replay-safe.
      // An input left with nothing after the mapping is refused outright
      // instead of sent as a guaranteed 400.
      const model = options?.model ?? body.model
      const capabilities = capabilitiesForModel?.(body.model)
      const effective =
        capabilitiesForModel === undefined
          ? quirks
          : {
              ...quirks,
              vision: capabilities?.vision === true,
              supportsStrictTools: capabilities?.supportsStrictTools === true,
            }
      const mapped = isChatgpt
        ? body.input
        : replayInput(body.input, effective, model, options?.replayOrigins)
      if (mapped.length === 0) {
        throw new Error('responses codec: the request keeps no replayable input')
      }
      return {
        model: body.model,
        input: isChatgpt ? body.input : mapped,
        instructions: isChatgpt ? body.instructions : cleanWireText(body.instructions),
        tools: isChatgpt
          ? [
              {
                type: 'namespace',
                name: quirks.toolNamespace,
                ...(quirks.toolNamespaceDescription !== undefined && {
                  description: quirks.toolNamespaceDescription,
                }),
                tools: body.tools,
              },
            ]
          : withStrictTools(body.tools, effective.supportsStrictTools === true),

        tool_choice: body.tool_choice,
        reasoning: body.reasoning,
        stream: body.stream,
        store: body.store,
        include: body.include,
        ...(!isChatgpt && { max_output_tokens: body.max_output_tokens }),
        ...((isChatgpt || quirks.sendPromptCacheKey) && {
          prompt_cache_key: body.prompt_cache_key,
        }),
        ...(!isChatgpt &&
          quirks.sendPromptCacheRetention && {
            prompt_cache_retention: body.prompt_cache_retention,
          }),
      }
    },
    async *decodeStream(
      chunks: AsyncIterable<Uint8Array>,
      sink?: ResponsesDecodeSink,
    ): AsyncGenerator<StreamEvent> {
      const outputCap = quirks.profile === 'chatgpt' ? sink?.outputCap : undefined
      if (outputCap === undefined && quirks.profile === 'chatgpt') {
        throw new ResponsesDecodeError('missing ChatGPT output cap', 0)
      }
      if (
        outputCap !== undefined &&
        (!Number.isSafeInteger(outputCap.maxOutputTokens) || outputCap.maxOutputTokens <= 0)
      ) {
        throw new ResponsesDecodeError('invalid output cap', 0)
      }
      let hasReportedCost = false
      for await (const frame of parseSse(chunks)) {
        if (frame.data.trim() === '' || frame.data === DONE_SENTINEL) {
          continue
        }
        let json: unknown
        try {
          json = JSON.parse(frame.data)
        } catch {
          throw new ResponsesDecodeError('invalid JSON', frame.data.length)
        }
        const typed = eventTypeSchema.safeParse(json)
        if (!typed.success) {
          throw new ResponsesDecodeError('missing type', frame.data.length)
        }
        // Additive events such as content_part.* and reasoning_summary_part.*
        // need no translation; the final item contains their complete content.
        if (!KNOWN_EVENT_TYPES.has(typed.data.type)) {
          continue
        }
        if (quirks.profile === 'chatgpt' && typed.data.type === 'error') {
          const nested = nestedErrorEventSchema.safeParse(json)
          if (!nested.success) {
            throw new ResponsesDecodeError('invalid nested error', frame.data.length)
          }
          const { code, message } = nested.data.error
          json = { type: 'error', code, message }
        }
        const known = streamEventSchema.safeParse(json)
        if (!known.success) {
          throw new ResponsesDecodeError('invalid event', frame.data.length)
        }
        if ('response' in known.data) {
          const parsed = responseFrameSchema.safeParse(json)
          if (!parsed.success) {
            throw new ResponsesDecodeError('invalid response', frame.data.length)
          }
          if (
            quirks.profile === 'chatgpt' &&
            known.data.type === 'response.failed' &&
            parsed.data.response.error?.code === CHATGPT_PLAN_LIMIT_CODE
          ) {
            throw new ChatgptPlanLimitError(parsed.data.response.error.message)
          }
          if (!hasReportedCost && TERMINAL_WITH_USAGE.has(known.data.type)) {
            const costUsd = settledCostOf(parsed.data.response.usage)
            if (costUsd !== undefined) {
              hasReportedCost = true
              sink?.settledCostUsd?.(costUsd)
            }
          }
          yield withinOutputCap({ ...known.data, response: parsed.data.response }, outputCap)
        } else if ('item' in known.data) {
          const parsed = itemFrameSchema.safeParse(json)
          if (!parsed.success) {
            throw new ResponsesDecodeError('invalid item', frame.data.length)
          }
          yield withinOutputCap({ ...known.data, item: parsed.data.item }, outputCap)
        } else {
          if (
            quirks.profile === 'chatgpt' &&
            known.data.type === 'error' &&
            known.data.code === CHATGPT_PLAN_LIMIT_CODE
          ) {
            throw new ChatgptPlanLimitError(known.data.message)
          }
          yield withinOutputCap(known.data, outputCap)
        }
      }
    },
  }
}
