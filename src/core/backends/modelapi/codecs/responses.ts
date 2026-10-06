// M95 lane R: pure Responses encoding and capture-backed SSE decoding.
// Provider policy is injected by lane P; auth, retries and HTTP errors
// belong to lane T. The shared WireCodec has not landed on this branch, so
// ResponsesWireCodec is the explicit seam for its transport adapter.

import * as z from 'zod/mini'
export { parseNativeModelsList as parseResponsesModelsList } from '../../../providers/modelMetadata'
import {
  type CreateResponseBody,
  errorBodySchema,
  eventTypeSchema,
  type FunctionToolDefinition,
  functionCallItemSchema,
  messageItemSchema,
  outputTextPartSchema,
  reasoningItemSchema,
  responseSchema,
  type StreamEvent,
  streamEventSchema,
  type Usage,
  usageSchema,
  webSearchCallItemSchema,
  type WebSearchToolDefinition,
} from '../schemas'
import { parseSse } from '../sse'

export type ResponsesCodecQuirks =
  | {
      readonly profile?: 'api'
      readonly sendPromptCacheRetention: boolean
      readonly sendPromptCacheKey: boolean
    }
  | {
      readonly profile: 'chatgpt'
      /** Stable across turns; supplied by the host, never derived from a token. */
      readonly toolNamespace: string
      /** The caller's namespace description, preserved as in the M95b capture. */
      readonly toolNamespaceDescription?: string
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
  encodeRequest(body: ResponsesRequestBody): Record<string, unknown>
  decodeStream(
    chunks: AsyncIterable<Uint8Array>,
    sink?: ResponsesDecodeSink,
  ): AsyncGenerator<StreamEvent>
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

export function createResponsesCodec(quirks: ResponsesCodecQuirks): ResponsesWireCodec {
  return {
    format: 'responses',
    encodeRequest(body: ResponsesRequestBody): Record<string, unknown> {
      const isChatgpt = quirks.profile === 'chatgpt'
      if (isChatgpt && body.tools.some((tool) => tool.type !== 'function')) {
        throw new ResponsesDecodeError('unsupported ChatGPT hosted tool', 0)
      }
      return {
        model: body.model,
        input: body.input,
        instructions: body.instructions,
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
          : body.tools,
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
