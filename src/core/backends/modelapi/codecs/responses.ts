// M95 lane R: pure Responses encoding and capture-backed SSE decoding.
// Provider policy is injected by lane P; auth, limits, retries and HTTP errors
// belong to lane T. The shared WireCodec has not landed on this branch, so
// ResponsesWireCodec is the explicit seam for its transport adapter.

import * as z from 'zod/mini'
import {
  type CreateResponseBody,
  eventTypeSchema,
  functionCallItemSchema,
  messageItemSchema,
  outputTextPartSchema,
  reasoningItemSchema,
  responseSchema,
  type StreamEvent,
  streamEventSchema,
  usageSchema,
  webSearchCallItemSchema,
  withStrictTools,
} from '../schemas'
import { parseSse } from '../sse'

export interface ResponsesCodecQuirks {
  readonly sendPromptCacheRetention: boolean
  readonly sendPromptCacheKey: boolean
  /** Selected model's effective supportsStrictTools; absent stays off. */
  readonly supportsStrictTools?: boolean | undefined
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

/** xAI's reported cost reaches settlement before canonical consumers read usage. */
export interface ResponsesDecodeSink {
  readonly settledCostUsd?: (costUsd: number) => void
}

export interface ResponsesWireCodec {
  readonly format: 'responses'
  encodeRequest(body: CreateResponseBody): Record<string, unknown>
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

function settledCostOf(usage: unknown): number | undefined {
  const parsed = settledCostSchema.safeParse(usage)
  return parsed.success ? parsed.data.cost_in_usd_ticks * USD_PER_COST_TICK : undefined
}

export function createResponsesCodec(quirks: ResponsesCodecQuirks): ResponsesWireCodec {
  return {
    format: 'responses',
    encodeRequest(body: CreateResponseBody): Record<string, unknown> {
      return {
        model: body.model,
        input: body.input,
        instructions: body.instructions,
        tools: withStrictTools(body.tools, quirks.supportsStrictTools === true),
        tool_choice: body.tool_choice,
        reasoning: body.reasoning,
        stream: body.stream,
        store: body.store,
        include: body.include,
        max_output_tokens: body.max_output_tokens,
        ...(quirks.sendPromptCacheKey && { prompt_cache_key: body.prompt_cache_key }),
        ...(quirks.sendPromptCacheRetention && {
          prompt_cache_retention: body.prompt_cache_retention,
        }),
      }
    },
    async *decodeStream(
      chunks: AsyncIterable<Uint8Array>,
      sink?: ResponsesDecodeSink,
    ): AsyncGenerator<StreamEvent> {
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
        const known = streamEventSchema.safeParse(json)
        if (!known.success) {
          throw new ResponsesDecodeError('invalid event', frame.data.length)
        }
        if ('response' in known.data) {
          const parsed = responseFrameSchema.safeParse(json)
          if (!parsed.success) {
            throw new ResponsesDecodeError('invalid response', frame.data.length)
          }
          if (!hasReportedCost && TERMINAL_WITH_USAGE.has(known.data.type)) {
            const costUsd = settledCostOf(parsed.data.response.usage)
            if (costUsd !== undefined) {
              hasReportedCost = true
              sink?.settledCostUsd?.(costUsd)
            }
          }
          yield { ...known.data, response: parsed.data.response }
        } else if ('item' in known.data) {
          const parsed = itemFrameSchema.safeParse(json)
          if (!parsed.success) {
            throw new ResponsesDecodeError('invalid item', frame.data.length)
          }
          yield { ...known.data, item: parsed.data.item }
        } else {
          yield known.data
        }
      }
    },
  }
}
