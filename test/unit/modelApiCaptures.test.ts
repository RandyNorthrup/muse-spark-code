import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  errorBodySchema,
  inputTokensSchema,
  isMessageItem,
  isWebSearchCallItem,
  messageItemSchema,
  messageText,
  modelApiStatusSchema,
  modelListSchema,
  responseSchema,
  streamEventSchema,
} from '../../src/core/backends/modelapi/schemas'
import type { JsonSchemaTextFormat } from '../../src/core/backends/modelapi/schemas'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/m106/${name}`, import.meta.url), 'utf8'))
}

const capturedResponse = z.object({ response: responseSchema })
const strictTool = z.object({
  type: z.literal('function'),
  strict: z.literal(true),
  parameters: z.object({ additionalProperties: z.literal(false), required: z.array(z.string()) }),
})

describe('M106 captured Meta wire contracts', () => {
  it('U8 returns one hosted search for max_tool_calls 1, with counted usage', () => {
    const capture = capturedResponse
      .extend({
        request: z.object({
          max_tool_calls: z.number(),
          tools: z.array(z.object({ type: z.string() })),
        }),
      })
      .parse(fixture('u8-hosted-bound.json'))
    expect(capture.request.max_tool_calls).toBe(1)
    expect(capture.request.tools).toEqual([{ type: 'web_search' }])
    const searches = capture.response.output.filter(isWebSearchCallItem)
    expect(searches).toHaveLength(capture.request.max_tool_calls)
    expect(searches[0]?.action?.query).toBe('current population Reykjavik Iceland 2026')
    expect(capture.response.usage?.input_tokens).toBeGreaterThan(0)
    expect(capture.response.usage?.output_tokens).toBeGreaterThan(0)
  })

  it('U9 validates complete captured SSE frames and distinguishes summaries from missing deltas', () => {
    const capture = z
      .object({
        request: z.object({ stream: z.literal(true), tools: z.array(strictTool) }),
        events: z.array(streamEventSchema),
        streamSummary: z.object({
          function_call_arguments_delta_events: z.number(),
          function_call_arguments_done: z.array(
            z.object({ name: z.string(), arguments: z.string() }),
          ),
          final_seen: z.boolean(),
        }),
        rawArgumentFramesAvailable: z.literal(false),
      })
      .parse(fixture('u9-strict-stream.json'))
    expect(capture.request.tools[0]?.parameters.required).toEqual(['city', 'unit'])
    expect(capture.events.map((event) => event.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.output_item.added',
      'response.output_text.delta',
    ])
    expect(capture.streamSummary.function_call_arguments_delta_events).toBe(2)
    expect(capture.streamSummary.function_call_arguments_done).toEqual([
      { name: 'get_weather', arguments: '{"city":"Oslo","unit":"celsius"}' },
    ])
    expect(capture.streamSummary.final_seen).toBe(true)
  })

  it('U9 preserves the exact strict-schema refusal without guessing its shape', () => {
    const capture = z
      .object({ status: z.number(), response: errorBodySchema })
      .parse(fixture('u9-strict-refusal.json'))
    expect(capture.status).toBe(400)
    expect(capture.response.error).toEqual({
      message: "'additionalProperties' is required to be supplied and to be false.",
      type: 'invalid_request_error',
      param: 'parameters',
      code: null,
    })
  })

  it('U10 accepts strict structured output alongside a strict function tool at minimal effort', () => {
    const capture = capturedResponse
      .extend({
        request: z.object({
          tools: z.array(strictTool),
          reasoning: z.object({ effort: z.string() }),
          text: z.object({
            format: z.object({
              type: z.literal('json_schema'),
              name: z.string(),
              strict: z.boolean(),
              schema: z.record(z.string(), z.unknown()),
            }),
          }),
        }),
      })
      .parse(fixture('u10-structured-output.json'))
    const format: JsonSchemaTextFormat = capture.request.text.format
    expect(format.name).toBe('capital_answer')
    expect(format.strict).toBe(true)
    expect(format.schema['required']).toEqual(['country', 'capital'])
    expect(format.schema['additionalProperties']).toBe(false)
    expect(capture.request.reasoning.effort).toBe('minimal')
    const text = capture.response.output
      .filter(isMessageItem)
      .map((item) => messageText(item))
      .join('')
    const answer: unknown = JSON.parse(text)
    expect(z.strictObject({ country: z.string(), capital: z.string() }).parse(answer)).toEqual({
      country: 'France',
      capital: 'Paris',
    })
  })

  it('U11 records the threshold refusal and no compaction item without enabling server compaction', () => {
    const capture = z
      .object({
        thresholdRefusal: z.object({ response: errorBodySchema }),
        inputCount: z.object({ response: inputTokensSchema }),
        attempt: capturedResponse.extend({ request: z.object({ store: z.literal(false) }) }),
      })
      .parse(fixture('u11-compaction.json'))
    expect(capture.thresholdRefusal.response.error.param).toBe(
      'context_management[0].compact_threshold',
    )
    expect(capture.inputCount.response.input_tokens).toBe(6399)
    expect(capture.attempt.response.output.map((item) => item.type)).toEqual(['message'])
    expect(capture.attempt.response.usage?.input_tokens).toBe(6242)
  })

  it('U12 retains distinct live remaining counts for streamed and ordinary responses, without reset headers', () => {
    const captures = z
      .array(z.object({ stream: z.boolean(), headers: z.record(z.string(), z.string()) }))
      .parse(fixture('u12-rate-headers.json'))
    expect(captures.some((capture) => capture.stream)).toBe(true)
    expect(captures.some((capture) => !capture.stream)).toBe(true)
    for (const capture of captures) {
      expect(Object.keys(capture.headers).toSorted((a, b) => a.localeCompare(b))).toEqual([
        'x-ratelimit-limit-requests',
        'x-ratelimit-limit-tokens',
        'x-ratelimit-remaining-requests',
        'x-ratelimit-remaining-tokens',
      ])
      expect(capture.headers['x-ratelimit-limit-requests']).toBe('150')
      expect(capture.headers['x-ratelimit-limit-tokens']).toBe('3000000')
    }
    expect(
      new Set(captures.map((capture) => capture.headers['x-ratelimit-remaining-requests'])).size,
    ).toBeGreaterThan(1)
  })

  it('U13 retains commentary and absent phases exactly as captured', () => {
    const captures = z
      .array(z.object({ messages: z.array(messageItemSchema) }))
      .parse(fixture('u13-phases.json'))
    const messages = captures.flatMap((capture) => capture.messages)
    expect(messages.map((message) => message.phase)).toEqual([
      'commentary',
      undefined,
      undefined,
      undefined,
    ])
    for (const message of messages) {
      if (message.phase === undefined) expect(Object.hasOwn(message, 'phase')).toBe(false)
    }
  })

  it('status accepts both authentication lanes and rejects malformed consumed fields', () => {
    const capture = z
      .object({
        responses: z.array(
          z.object({
            label: z.string(),
            status: z.number(),
            response: modelApiStatusSchema,
          }),
        ),
      })
      .parse(fixture('status.json'))
    expect(capture.responses.map((response) => response.label)).toEqual(['with key', 'without key'])
    for (const response of capture.responses) {
      expect(response.status).toBe(200)
      expect(response.response).toEqual({
        is_alive: true,
        service_status: 'operational',
        service_message: '',
        updated_at: '',
        model_statuses: [],
      })
      for (const field of Object.keys(response.response)) {
        const incomplete = Object.fromEntries(
          Object.entries(response.response).filter(([key]) => key !== field),
        )
        expect(modelApiStatusSchema.safeParse(incomplete).success).toBe(false)
        expect(
          modelApiStatusSchema.safeParse({ ...response.response, [field]: null }).success,
        ).toBe(false)
      }
    }
  })

  it('U14 has the same model list for no client, Muse Code and VS Code', () => {
    const capture = z
      .object({ responses: z.array(z.object({ client: z.string(), response: modelListSchema })) })
      .parse(fixture('u14-models.json'))
    expect(capture.responses.map((response) => response.client)).toEqual([
      'plain',
      'muse-code',
      'vscode',
    ])
    for (const response of capture.responses)
      expect(response.response).toEqual(capture.responses[0]?.response)
  })
})
