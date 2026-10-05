// The Gemini codec's tests (PLAN.md D74, M95 lane G): goldens and capture
// drives. Decode feeds the recorded 2026-10-04 frames in
// `docs/certification/m95-captures/gemini/` as SSE, so every wire claim is
// the capture's, never a guess (AGENTS.md rule 13); encode pins the exact
// native request per canonical body, including the prefix rule (a growing
// session keeps its earlier native bytes) and the thought-signature replay.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  decodeGeminiStream,
  encodeGeminiRequest,
  GEMINI_MODELS_PATH,
  GEMINI_SKIP_THOUGHT_SIGNATURE,
  GEMINI_THINKING_LEVELS,
  geminiGeneration,
  geminiStreamPath,
  geminiThinkingLevelForEffort,
  parseGeminiError,
  parseGeminiModelsList,
  toGeminiFullSchema,
  toGeminiSchemaSubset,
} from '../../src/core/backends/modelapi/codecs/gemini'
import { ModelApiError } from '../../src/core/backends/modelapi/client'
import { MODEL_API_MODEL_TEXT, OBS_PACK_WHOLE_SENDS } from '../../src/shared/constants'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPack'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'
import {
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  type CreateResponseBody,
  type FunctionCallItem,
  type InputMessageItem,
  type ReasoningItem,
  type StreamEvent,
} from '../../src/core/backends/modelapi/schemas'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CAPTURES = path.join(ROOT, 'docs', 'certification', 'm95-captures', 'gemini')

interface CaptureFile {
  request: { body: unknown }
  response: { events?: { data: unknown }[]; body?: unknown; bodySummary?: unknown }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function capture(name: string): CaptureFile {
  const parsed: unknown = JSON.parse(readFileSync(path.join(CAPTURES, name), 'utf8'))
  if (!isRecord(parsed) || !isRecord(parsed['request']) || !isRecord(parsed['response'])) {
    throw new Error(`capture ${name} has no request and response`)
  }
  const response = parsed['response']
  const rawEvents: unknown = response['events']
  const events = Array.isArray(rawEvents)
    ? rawEvents.filter((event): event is { data: unknown } => isRecord(event) && 'data' in event)
    : undefined
  const bodySummary: unknown = response['bodySummary']
  return {
    request: { body: parsed['request']['body'] },
    response: {
      ...(events !== undefined && { events }),
      body: response['body'],
      ...(bodySummary !== undefined && { bodySummary }),
    },
  }
}

/** Exact UTF-8 HTTP request bodies, intentionally compact with no trailing LF. */
function requestBytes(name: string): string {
  return readFileSync(path.join(ROOT, 'test', 'fixtures', 'gemini', `${name}.request.txt`), 'utf8')
}

/**
 * Recorded response payloads as one SSE stream (`data: …` frames). The await
 * lets the decoder run between frames, as a network stream would.
 */
async function* sseOf(payloads: readonly unknown[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder()
  for (const payload of payloads) {
    await Promise.resolve()
    yield encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
  }
}

async function collect(
  chunks: AsyncIterable<Uint8Array>,
  model = 'gemini/gemini-3.5-flash-lite',
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = await Array.fromAsync(decodeGeminiStream(chunks, model))
  return events
}

/** One native chunk: whole candidate parts, usage and the response id, as captured. */
function chunk(parts: unknown[], finishReason?: string): unknown {
  return {
    candidates: [
      {
        content: { parts, role: 'model' },
        ...(finishReason !== undefined && { finishReason }),
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    modelVersion: 'gemini-3.5-flash-lite',
    responseId: 'resp_1',
  }
}

function payloadsOf(name: string): unknown[] {
  const events = capture(name).response.events ?? []
  return events.map((event) => event.data)
}

/** The harness properties the schema-subset tests share. */
const SUBSET_PROPERTIES = {
  timezone: { type: 'string', description: 'An IANA time zone.' },
  count: { type: 'integer', minimum: 1 },
  mode: { type: 'string', enum: ['a', 'b'] },
}

const TOOL_BODY: CreateResponseBody = {
  model: 'gemini/gemini-3.5-flash-lite',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'What time is it in UTC right now?' }],
    },
  ],
  instructions: 'be brief',
  tools: [
    {
      type: 'function',
      name: 'get_time',
      description: 'Returns the current time in the given IANA time zone.',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'An IANA time zone such as UTC.' },
        },
        required: ['timezone'],
        additionalProperties: false,
        $schema: 'https://json-schema.org/draft-07/schema#',
      },
      strict: false,
    },
  ],
  tool_choice: 'auto',
  reasoning: { effort: 'low', summary: 'auto' },
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  max_output_tokens: 1024,
  prompt_cache_key: 's1',
  prompt_cache_retention: '24h',
}

describe('gemini paths and thinking levels', () => {
  it('addresses the v1beta SSE stream per native model id', () => {
    expect(geminiStreamPath('gemini-3.5-flash-lite')).toBe(
      '/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse',
    )
    expect(GEMINI_MODELS_PATH).toBe('/v1beta/models?pageSize=1000')
  })

  it('maps effort tiers to thinking levels, clamping above high', () => {
    expect(GEMINI_THINKING_LEVELS).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(geminiThinkingLevelForEffort('minimal')).toBe('minimal')
    expect(geminiThinkingLevelForEffort('low')).toBe('low')
    expect(geminiThinkingLevelForEffort('medium')).toBe('medium')
    expect(geminiThinkingLevelForEffort('high')).toBe('high')
    expect(geminiThinkingLevelForEffort('xhigh')).toBe('high')
    expect(geminiThinkingLevelForEffort('max')).toBe('high')
  })

  it('sends no level while Thinking is off or the tier is unknown', () => {
    expect(geminiThinkingLevelForEffort('none')).toBeUndefined()
    expect(geminiThinkingLevelForEffort('turbo')).toBeUndefined()
  })
})

describe('encodeGeminiRequest goldens', () => {
  it('encodes a first tool turn byte for byte', () => {
    const request = encodeGeminiRequest(TOOL_BODY, 'gemini-3.5-flash-lite')
    expect(request.path).toBe('/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse')
    expect(JSON.stringify(request.body)).toBe(requestBytes('first-turn'))
  })

  it('is deterministic: the same body always encodes to the same bytes', () => {
    const first = encodeGeminiRequest(TOOL_BODY, 'gemini-3.5-flash-lite')
    const second = encodeGeminiRequest(TOOL_BODY, 'gemini-3.5-flash-lite')
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('omits instructions, tools and thinking when there are none', () => {
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        instructions: '',
        tools: [],
        reasoning: { effort: 'none', summary: 'auto' },
      },
      'gemini-3.5-flash-lite',
    )
    expect(request.body).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'What time is it in UTC right now?' }],
        },
      ],
      generationConfig: { maxOutputTokens: 1024 },
    })
  })

  it('never declares web search to the model', () => {
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        tools: [...TOOL_BODY.tools, { type: 'web_search' }],
        input: [...TOOL_BODY.input, { type: 'web_search_call', status: 'completed' }],
      },
      'gemini-3.5-flash-lite',
    )
    const contents: unknown = request.body['contents']
    expect(Array.isArray(contents) ? contents.length : -1).toBe(1)
    expect(JSON.stringify(request.body)).not.toContain('web_search')
  })
})

describe('encodeGeminiRequest history', () => {
  const signature =
    'EmAKXgFpFH0TGuyXxb3uCXeV/RHRG5MZVICRgzE69qJoT9QD93IDAu+m63eVEHTy12Q/rbKugb1KcfJ97Yr33LGe/R5qGF3Bvjb2/glpz3APrV/eJzMtcU/x3tWUTrRfXGA='
  const replay: CreateResponseBody = {
    ...TOOL_BODY,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'What time is it in UTC right now?' }],
      },
      { type: 'reasoning', encrypted_content: signature },
      {
        type: 'function_call',
        call_id: 'call_3117260',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_3117260',
        output: '{"timezone":"UTC","time":"2026-10-04T12:00:00Z"}',
      },
    ],
  }
  const completedAnswer: InputMessageItem = {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'It is noon UTC.' }],
  }

  it('replays the signature in its exact part, the call and the JSON result', () => {
    const request = encodeGeminiRequest(replay, 'gemini-3.5-flash-lite')
    expect(JSON.stringify(request.body)).toBe(requestBytes('tool-loop'))
  })

  it('keeps the earlier native bytes when the session grows', () => {
    const bodies: CreateResponseBody[] = [
      TOOL_BODY,
      replay,
      {
        ...replay,
        input: [
          ...replay.input,
          completedAnswer,
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'And tomorrow?' }],
          },
        ],
      },
    ]
    // Two declarations make a per-request tool re-sort observable.
    const requests = bodies.map((body) =>
      encodeGeminiRequest(
        {
          ...body,
          tools: [
            ...body.tools,
            {
              type: 'function',
              name: 'another_tool',
              description: 'A second fixture tool.',
              parameters: { type: 'object' },
              strict: false,
            },
          ],
        },
        'gemini-3.5-flash-lite',
      ),
    )
    for (const [index, previous] of requests.entries()) {
      const next = requests[index + 1]
      if (next === undefined) {
        continue
      }
      const before: unknown = previous.body['contents']
      const after: unknown = next.body['contents']
      if (!Array.isArray(before) || !Array.isArray(after)) {
        throw new TypeError('expected contents on both requests')
      }
      expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before))
      // Include every non-growing field and its key order, not only contents[0].
      const stable = (body: Record<string, unknown>) =>
        JSON.stringify(Object.entries(body).filter(([key]) => key !== 'contents'))
      expect(stable(next.body)).toBe(stable(previous.body))
      expect(next.path).toBe(previous.path)
    }
  })

  it('wraps a plain-text result as {result}', () => {
    const request = encodeGeminiRequest(
      {
        ...replay,
        input: replay.input.map((item) =>
          item.type === 'function_call_output' ? { ...item, output: 'noon' } : item,
        ),
      },
      'gemini-3.5-flash-lite',
    )
    expect(JSON.stringify(request.body)).toContain('{"result":"noon"}')
  })

  it.each([false, true])(
    'sends tool-result images as sibling inlineData on Gemini 3 (text: %s)',
    (hasText) => {
      const body: CreateResponseBody = {
        ...replay,
        input: replay.input.map((item) =>
          item.type === 'function_call_output'
            ? {
                ...item,
                output: [
                  ...(hasText
                    ? [{ type: 'input_text' as const, text: 'picture from view_image' }]
                    : []),
                  { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
                ],
              }
            : item,
        ),
      }
      const request = encodeGeminiRequest(body, 'gemini-3.5-flash-lite')
      const contents = JSON.stringify(request.body['contents'])
      expect(contents).toContain('"functionResponse":{"id":"call_3117260"')
      expect(contents).toContain('"inlineData":{"mimeType":"image/png","data":"iVBOR"}')
      expect(JSON.stringify(request.body)).not.toContain('gemini_tool_result_image_unsupported')
    },
  )

  it.each([false, true])(
    'still refuses tool-result images before Gemini 3 (text: %s)',
    (hasText) => {
      const body: CreateResponseBody = {
        ...replay,
        input: replay.input.map((item) =>
          item.type === 'function_call_output'
            ? {
                ...item,
                output: [
                  ...(hasText
                    ? [{ type: 'input_text' as const, text: 'picture from view_image' }]
                    : []),
                  { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
                ],
              }
            : item,
        ),
      }
      expect(() => encodeGeminiRequest(body, 'gemini-2.5-flash')).toThrow(
        expect.objectContaining({
          name: 'ModelApiError',
          kind: 'unsupported_content',
          code: 'gemini_tool_result_image_unsupported',
        }),
      )
    },
  )

  it('keeps all text parts in a supported tool result', () => {
    const body: CreateResponseBody = {
      ...replay,
      input: replay.input.map((item) =>
        item.type === 'function_call_output'
          ? {
              ...item,
              output: [
                { type: 'input_text', text: 'first' },
                { type: 'input_text', text: 'second' },
              ],
            }
          : item,
      ),
    }
    expect(JSON.stringify(encodeGeminiRequest(body, 'gemini-3.5-flash-lite').body)).toContain(
      JSON.stringify({ result: 'first\nsecond' }),
    )
  })

  it('pins packed-output request bytes using the real ObservationPack', () => {
    const output = Array.from(
      { length: 200 },
      (_, index) => `line ${String(index)} ${'x'.repeat(40)}`,
    ).join('\n')
    const input = replay.input.map((item) =>
      item.type === 'function_call_output' ? { ...item, output } : item,
    )
    const pack = new ObservationPack()
    for (let round = 0; round < OBS_PACK_WHOLE_SENDS; round += 1) {
      pack.noteSent(pack.project(input))
    }
    const packed = pack.project(input)
    expect(packed.some((item) => pack.isPlaceholder(item))).toBe(true)
    const request = encodeGeminiRequest({ ...replay, input: packed }, 'gemini-3.5-flash-lite')
    expect(JSON.stringify(request.body)).toBe(requestBytes('packed-output'))
  })

  it('pins compaction request bytes with the tools retained for BYO', () => {
    const body: CreateResponseBody = {
      ...replay,
      input: [
        ...replay.input,
        completedAnswer,
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: MODEL_API_MODEL_TEXT.compactionPrompt }],
        },
      ],
    }
    expect(JSON.stringify(encodeGeminiRequest(body, 'gemini-3.5-flash-lite').body)).toBe(
      requestBytes('compaction'),
    )
  })

  it('signs an unsigned call with the documented dummy, for foreign history', () => {
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_time',
            arguments: '{}',
          },
        ],
      },
      'gemini-3.5-flash-lite',
    )
    expect(JSON.stringify(request.body)).toContain(
      `"thoughtSignature":"${GEMINI_SKIP_THOUGHT_SIGNATURE}"`,
    )
  })

  it('refuses a result whose call is missing, and sends non-JSON arguments as {}', () => {
    expect(() =>
      encodeGeminiRequest(
        {
          ...TOOL_BODY,
          input: [
            {
              type: 'function_call_output',
              call_id: 'call_missing',
              output: '{}',
            },
          ],
        },
        'gemini-3.5-flash-lite',
      ),
    ).toThrow(/no function call 'call_missing'/)
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_time',
            arguments: 'not json',
          },
        ],
      },
      'gemini-3.5-flash-lite',
    )
    expect(JSON.stringify(request.body)).toContain(
      '"functionCall":{"name":"get_time","args":{},"id":"call_1"}',
    )
  })

  it('sends images as inlineData and refuses non-data URLs', () => {
    const image = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
            ],
          },
        ],
      },
      'gemini-3.5-flash-lite',
    )
    expect(JSON.stringify(image.body)).toBe(requestBytes('image'))
    expect(() =>
      encodeGeminiRequest(
        {
          ...TOOL_BODY,
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_image', image_url: 'https://example.com/a.png', detail: 'auto' },
              ],
            },
          ],
        },
        'gemini-3.5-flash-lite',
      ),
    ).toThrow(/data URLs/)
  })
})

describe('decodeGeminiStream from the captures', () => {
  it('decodes the captured tool call: signature, call, STOP, usage', async () => {
    const events = await collect(sseOf(payloadsOf('02-tool-call-stream.json')))
    expect(events[0]?.type).toBe('response.created')
    const last = events.at(-1)
    if (last?.type !== 'response.completed') {
      throw new Error('expected the stream to end completed')
    }
    expect(last.response.id).toBe('k9bCavvEFLbqqtsP-oGv8Aw')
    expect(last.response.model).toBe('gemini/gemini-3.5-flash-lite')
    const [reasoning, call] = last.response.output
    if (
      reasoning === undefined ||
      call === undefined ||
      !isReasoningItem(reasoning) ||
      !isFunctionCallItem(call)
    ) {
      throw new Error('expected a reasoning item and a function call')
    }
    expect(reasoning.encrypted_content).toBe(
      'EmAKXgFpFH0TGuyXxb3uCXeV/RHRG5MZVICRgzE69qJoT9QD93IDAu+m63eVEHTy12Q/rbKugb1KcfJ97Yr33LGe/R5qGF3Bvjb2/glpz3APrV/eJzMtcU/x3tWUTrRfXGA=',
    )
    expect(call.call_id).toBe('call_3117260')
    expect(call.name).toBe('get_time')
    expect(call.arguments).toBe('{"timezone":"UTC"}')
    // No message item: the turn's only text part was empty.
    expect(last.response.output.some((item) => isMessageItem(item))).toBe(false)
    expect(last.response.usage).toEqual({
      input_tokens: 1577,
      output_tokens: 16,
      total_tokens: 1593,
    })
  })

  it('streams the call as added, whole-arguments delta and done', async () => {
    const events = await collect(sseOf(payloadsOf('02-tool-call-stream.json')))
    const added = events.filter((event) => event.type === 'response.output_item.added')
    expect(added).toHaveLength(1)
    const delta = events.find((event) => event.type === 'response.function_call_arguments.delta')
    expect(delta).toEqual({
      type: 'response.function_call_arguments.delta',
      item_id: 'call_3117260',
      delta: '{"timezone":"UTC"}',
    })
  })

  it('decodes the captured answer: concatenated text, last usage wins', async () => {
    const events = await collect(sseOf(payloadsOf('03-tool-result-stream.json')))
    const last = events.at(-1)
    if (last?.type !== 'response.completed') {
      throw new Error('expected the stream to end completed')
    }
    const [message] = last.response.output
    if (message === undefined || !isMessageItem(message)) {
      throw new Error('expected a message')
    }
    expect(messageTextOf(message)).toBe(
      'The current time in UTC is 2026-10-04T12:00:00Z, as provided by the get_time tool.',
    )
    // BYO item 4: the final empty text part keeps its thought signature for
    // the replay, beside the merged answer text.
    expect(message.content).toEqual([
      {
        type: 'output_text',
        text: 'The current time in UTC is 2026-10-04T12:00:00Z, as provided by the get_time tool.',
      },
      {
        type: 'output_text',
        text: '',
        thoughtSignature:
          'EmAKXgFpFH0TjXKBkvWsF+yT7dzPeRi3mDUibOc9+LDdEMckPBsiwmNtFI6LJ1I46l9fGeuE2emYKshQx0aUSVs2d7eSJZURulMFR2P2aaaPXGrN34miwqR9eneZjPvHnD0=',
      },
    ])
    expect(last.response.output.some((item) => isReasoningItem(item))).toBe(false)
    expect(last.response.usage).toEqual({
      input_tokens: 1632,
      output_tokens: 37,
      total_tokens: 1669,
    })
    const deltas: string[] = []
    for (const event of events) {
      if (event.type === 'response.output_text.delta') {
        deltas.push(event.delta)
      }
    }
    expect(deltas).toEqual([
      'The current',
      ' time in UTC is 2026-10-04T12',
      ':00:00Z, as provided by the get_time tool.',
    ])
  })

  it('round-trips the captured turn: decode then encode keeps the native parts', async () => {
    const first = await collect(sseOf(payloadsOf('02-tool-call-stream.json')))
    const completed = first.at(-1)
    if (completed?.type !== 'response.completed') {
      throw new Error('expected the stream to end completed')
    }
    const replayable = completed.response.output.filter(
      (item): item is FunctionCallItem | ReasoningItem =>
        isFunctionCallItem(item) || isReasoningItem(item),
    )
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'What time is it in UTC right now?' }],
          },
          ...replayable,
          {
            type: 'function_call_output',
            call_id: 'call_3117260',
            output: '{"timezone":"UTC","time":"2026-10-04T12:00:00Z"}',
          },
        ],
      },
      'gemini-3.5-flash-lite',
    )
    // Against the captured follow-up request: the replayed model call and
    // the tool result match part for part (the scratchpad's own prompt text
    // and its trailing empty text part are construction, not the wire).
    const recorded = capture('03-tool-result-stream.json').request.body
    const recordedContents: unknown = isRecord(recorded) ? recorded['contents'] : undefined
    const contents: unknown = request.body['contents']
    if (!Array.isArray(contents) || !Array.isArray(recordedContents)) {
      throw new TypeError('expected contents on both requests')
    }
    expect(contents[1]).toEqual({
      role: 'model',
      parts: [recordedParts(recordedContents)[0]],
    })
    expect(contents[2]).toEqual(recordedContents[2])
  })
})

function messageTextOf(message: { content: { type: string }[] }): string {
  return message.content
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

function recordedParts(recordedContents: unknown[]): unknown[] {
  const model: unknown = recordedContents[1]
  if (!isRecord(model) || !Array.isArray(model['parts'])) {
    throw new Error('expected a model content with parts')
  }
  return model['parts']
}

describe('decodeGeminiStream turns', () => {
  it.each([
    ['04-cache-call-1.json', 146, 145, 5660],
    ['05-cache-call-2.json', 150, 148, 5664],
  ])(
    'counts billed thinking in canonical output for capture %s',
    async (file, output, reasoning, total) => {
      const events = await collect(sseOf(payloadsOf(file)))
      const last = events.at(-1)
      if (last?.type !== 'response.completed') {
        throw new Error('expected completed captured response')
      }
      expect(last.response.usage).toEqual({
        input_tokens: 5514,
        output_tokens: output,
        total_tokens: total,
        output_tokens_details: { reasoning_tokens: reasoning },
      })
    },
  )

  it.each([undefined, 'MAX_TOKENS', 'SAFETY'])(
    'requires STOP to complete even when calls arrived (%s)',
    async (reason) => {
      const events = await collect(
        sseOf([chunk([{ functionCall: { name: 'get_time', args: {}, id: 'call_1' } }], reason)]),
      )
      const last = events.at(-1)
      expect(last?.type).toBe(reason === 'SAFETY' ? 'response.failed' : 'response.incomplete')
      if (last?.type !== 'response.incomplete') {
        return
      }
      expect(last.response.status).toBe('incomplete')
      expect(last.response.incomplete_details?.reason).toBe(
        reason === 'MAX_TOKENS' ? 'max_output_tokens' : 'stream_ended_without_finish_reason',
      )
    },
  )

  it('marks EOF after text without a finish reason incomplete', async () => {
    const events = await collect(sseOf([chunk([{ text: 'half' }])]))
    const last = events.at(-1)
    expect(last?.type).toBe('response.incomplete')
  })

  it('retains one item id across added, delta, done and terminal output', async () => {
    const events = await collect(
      sseOf([
        chunk([{ text: 'thinking', thought: true }, { text: 'Hello' }]),
        chunk(
          [
            { text: ' more', thought: true },
            { text: ' world' },
            { functionCall: { name: 'get_time', args: {}, id: 'call_1' }, thoughtSignature: 'sig' },
          ],
          'STOP',
        ),
      ]),
    )
    const added = events.filter((event) => event.type === 'response.output_item.added')
    const done = events.filter((event) => event.type === 'response.output_item.done')
    expect(added.map((event) => event.item.id)).toEqual(['rs_1', 'msg_1', 'call_1'])
    expect(done.map((event) => event.item.id)).toEqual(['msg_1', 'rs_1', 'call_1'])
    for (const event of events) {
      if ('item_id' in event) {
        expect(added.some((opening) => opening.item.id === event.item_id)).toBe(true)
      }
    }
    const last = events.at(-1)
    if (last?.type !== 'response.completed') {
      throw new Error('expected completed response')
    }
    expect(last.response.output.map((item) => item.id)).toEqual([
      'rs_1',
      'msg_1',
      'rs_call_1',
      'call_1',
    ])
  })

  it('ModelApiHost completes exactly one live message and reasoning row per Gemini item', async () => {
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(fakeModelApi(), log)
    vi.spyOn(client, 'streamResponse').mockImplementation(() =>
      decodeGeminiStream(
        sseOf([
          chunk([{ text: 'thinking', thought: true }, { text: 'Hello' }]),
          chunk([{ text: ' more', thought: true }, { text: ' world' }], 'STOP'),
        ]),
        'gemini/gemini-3.5-flash-lite',
      ),
    )
    let ids = 0
    const host = new ModelApiHost({
      client,
      workspaceRoot: '/ws',
      platform: 'linux',
      io: memoryToolIo({}, '/ws'),
      contextIo: memoryContextIo(new Map()),
      newId: () => `id${String((ids += 1))}`,
      now: () => 0,
      log,
      personalSkillsRoot: undefined,
      personalAgentsRoot: undefined,
      isWorkspaceTrusted: () => true,
      isConfidentialWorkspace: () => false,
      confirmContributorModel: () => Promise.resolve(false),
      describeEnvironment: () => Promise.resolve({ git: undefined }),
      isPaidFeatureOn: () => false,
      notePaidUse: () => undefined,
      allowsPaidUse: () => Promise.resolve(false),
      isPaidUseRemembered: () => false,
      promptCacheRetention: () => 'in_memory',
      sessionBudgetUsd: () => 0,
      showReplyUsage: () => false,
      getAccountId: () => Promise.resolve('fake-account'),
      memory: undefined,
      noteSubagentUsage: () => undefined,
      noteReviewerUsage: () => undefined,
    })
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
    })
    try {
      const { events, turnDone } = watchSessionTurns(session)
      const completed = turnDone()
      await session.sendTurn([{ type: 'text', text: 'hello' }])
      await completed
      expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      for (const kind of ['agentMessage', 'reasoning']) {
        const started = events.filter(
          (event) => event.type === 'itemStarted' && event.item.kind === kind,
        )
        const done = events.filter(
          (event) => event.type === 'itemCompleted' && event.item.kind === kind,
        )
        expect(started).toHaveLength(1)
        expect(done).toHaveLength(1)
        expect(done[0]).toMatchObject({
          item: { itemId: started[0]?.type === 'itemStarted' ? started[0].item.itemId : undefined },
        })
      }
    } finally {
      session.dispose()
      vi.restoreAllMocks()
      await host.close()
    }
  })

  it('marks pre-call text commentary and surfaces thought parts as reasoning', async () => {
    const events = await collect(
      sseOf([
        chunk([{ text: 'Checking', thoughtSignature: 'sig-text' }]),
        chunk([{ text: 'working', thought: true }]),
        chunk(
          [
            {
              functionCall: { name: 'get_time', args: { timezone: 'UTC' }, id: 'call_1' },
              thoughtSignature: 'sig-call',
            },
          ],
          'STOP',
        ),
      ]),
    )
    const last = events.at(-1)
    if (last?.type !== 'response.completed') {
      throw new Error('expected the stream to end completed')
    }
    const [summary, message, signed, call] = last.response.output
    if (
      summary === undefined ||
      message === undefined ||
      signed === undefined ||
      call === undefined ||
      !isReasoningItem(summary) ||
      !isMessageItem(message) ||
      !isReasoningItem(signed) ||
      !isFunctionCallItem(call)
    ) {
      throw new Error('expected summary, commentary, signature and call')
    }
    expect(summary.summary).toEqual([{ type: 'summary_text', text: 'working' }])
    expect(message.phase).toBe('commentary')
    // BYO item 4: the signed non-empty text part keeps its own signature.
    expect(message.content).toEqual([
      { type: 'output_text', text: 'Checking', thoughtSignature: 'sig-text' },
    ])
    expect(signed.encrypted_content).toBe('sig-call')
    expect(call.call_id).toBe('call_1')
  })

  it('replays a signed text part with its thought signature (BYO item 4)', () => {
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        input: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Checking', thoughtSignature: 'sig-text' },
              { type: 'output_text', text: '' },
            ],
          },
        ],
      },
      'gemini-3.5-flash-lite',
    )
    expect(JSON.stringify(request.body)).toContain(
      '"parts":[{"text":"Checking","thoughtSignature":"sig-text"}]',
    )
  })

  it('ends MAX_TOKENS incomplete and other reasons failed', async () => {
    const cut = await collect(sseOf([chunk([{ text: 'half' }], 'MAX_TOKENS')]))
    const cutLast = cut.at(-1)
    expect(cutLast?.type).toBe('response.incomplete')
    if (cutLast?.type === 'response.incomplete') {
      expect(cutLast.response.incomplete_details).toEqual({ reason: 'max_output_tokens' })
    }
    const blocked = await collect(sseOf([chunk([{ text: '' }], 'SAFETY')]))
    const blockedLast = blocked.at(-1)
    expect(blockedLast?.type).toBe('response.failed')
    if (blockedLast?.type === 'response.failed') {
      expect(blockedLast.response.error?.message).toBe('Gemini stopped the turn: SAFETY')
    }
  })

  it('throws on a non-JSON frame, a frameless chunk and an empty stream', async () => {
    const encoder = new TextEncoder()
    async function* raw(text: string): AsyncGenerator<Uint8Array> {
      await Promise.resolve()
      yield encoder.encode(text)
    }
    await expect(collect(raw('data: {oops}\n\n'))).rejects.toThrow(ModelApiError)
    await expect(collect(raw('data: {"unrelated":true}\n\n'))).rejects.toThrow(/no candidates/)
    await expect(collect(sseOf([]))).rejects.toThrow(/empty stream/)
  })
})

describe('parseGeminiError', () => {
  it('keeps the captured 404 envelope: message, NOT_FOUND, code', () => {
    const body = capture('06-error-invalid-model.json').response.body
    const error = parseGeminiError(404, body)
    expect(error).toBeInstanceOf(ModelApiError)
    expect(error.status).toBe(404)
    expect(error.kind).toBe('NOT_FOUND')
    expect(error.code).toBe('404')
    expect(error.message).toBe(
      'models/no-such-model-m95 is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.',
    )
  })

  it('maps RESOURCE_EXHAUSTED with its status so the 429 retry stays legible', () => {
    const error = parseGeminiError(429, {
      error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' },
    })
    expect(error.status).toBe(429)
    expect(error.kind).toBe('RESOURCE_EXHAUSTED')
    expect(error.message).toBe('Quota exceeded.')
  })

  it('falls back to the HTTP status when the body is no envelope', () => {
    expect(parseGeminiError(503, '<html>down</html>').message).toBe('HTTP 503')
  })
})

describe('parseGeminiModelsList', () => {
  it('keeps generateContent models with their windows, ids unprefixed', () => {
    const models = parseGeminiModelsList({
      models: [
        {
          name: 'models/gemini-3.5-flash-lite',
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'bare-id' },
      ],
    })
    expect(models).toEqual([
      { id: 'gemini-3.5-flash-lite', inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 },
    ])
  })

  it('parses the captured list entries, extra keys and all', () => {
    // The captured list is stored trimmed (count, keys, samples); the three
    // sample entries below are verbatim from `01-models-list.json`.
    const summary: unknown = capture('01-models-list.json').response.bodySummary
    const entries: unknown =
      isRecord(summary) && 'sample' in summary ? summary['sample'] : undefined
    expect(parseGeminiModelsList({ models: entries })).toEqual([
      { id: 'gemini-2.5-flash', inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 },
      { id: 'gemini-2.5-pro', inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 },
      { id: 'gemini-3.5-flash-lite', inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 },
    ])
  })

  it('throws when the list has no models', () => {
    expect(() => parseGeminiModelsList({})).toThrow(/no models/)
  })
})

describe('toGeminiSchemaSubset', () => {
  it('drops what the subset cannot carry and keeps the rest', () => {
    expect(
      toGeminiSchemaSubset({
        type: 'object',
        properties: SUBSET_PROPERTIES,
        required: ['timezone'],
        additionalProperties: false,
        $schema: 'https://json-schema.org/draft-07/schema#',
        strict: true,
      }),
    ).toEqual({
      type: 'object',
      properties: SUBSET_PROPERTIES,
      required: ['timezone'],
    })
  })

  it('resolves internal $refs and refuses external and circular ones', () => {
    expect(
      toGeminiSchemaSubset({
        type: 'object',
        properties: { nested: { $ref: '#/$defs/nested' } },
        $defs: { nested: { type: 'string', additionalProperties: false } },
      }),
    ).toEqual({ type: 'object', properties: { nested: { type: 'string' } } })
    expect(() => toGeminiSchemaSubset({ $ref: 'https://example.com/s.json' })).toThrow(
      /external \$ref/,
    )
    expect(() =>
      toGeminiSchemaSubset({
        type: 'object',
        properties: { loop: { $ref: '#/properties/loop' } },
      }),
    ).toThrow(/circular \$ref/)
  })
})

function usageChunk(usage: unknown): unknown {
  return {
    candidates: [{ content: { parts: [], role: 'model' }, finishReason: 'STOP', index: 0 }],
    usageMetadata: usage,
    modelVersion: 'gemini-3.5-flash-lite',
    responseId: 'resp_2',
  }
}

function textOnlyChunk(text: string): unknown {
  return {
    candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0 }],
    modelVersion: 'gemini-3.5-flash-lite',
    responseId: 'resp_2',
  }
}

describe('M101 lane P1 history hardening (BYO items 1, 3, 7, 11, 13)', () => {
  it('reads the Gemini generation from the native model id (BYO item 11)', () => {
    expect(geminiGeneration('gemini-3.5-flash-lite')).toBe(3)
    expect(geminiGeneration('models/gemini-2.5-pro')).toBe(2)
    expect(geminiGeneration('gemini/gemini-3-pro-preview')).toBe(3)
    expect(geminiGeneration('something-else')).toBeUndefined()
  })

  it('sends full tool schemas on Gemini 3 and the subset before it (BYO item 11)', () => {
    const parameters = {
      type: 'object',
      properties: { timezone: { type: 'string' } },
      required: ['timezone'],
      additionalProperties: false,
      $schema: 'https://json-schema.org/draft-07/schema#',
    }
    expect(toGeminiFullSchema(parameters)).toEqual(parameters)
    expect(() => toGeminiFullSchema({ $ref: 'https://example.com/s.json' })).toThrow(
      /external \$ref/,
    )
    const timeTool = TOOL_BODY.tools[0]
    if (timeTool?.type !== 'function') {
      throw new Error('expected the function tool first')
    }
    const old = encodeGeminiRequest(
      { ...TOOL_BODY, tools: [{ ...timeTool, parameters }] },
      'gemini-2.5-flash',
    )
    expect(JSON.stringify(old.body)).not.toContain('additionalProperties')
    const current = encodeGeminiRequest(
      { ...TOOL_BODY, tools: [{ ...timeTool, parameters }] },
      'gemini-3.5-flash-lite',
    )
    expect(JSON.stringify(current.body)).toContain('"additionalProperties":false')
  })

  it('counts omitted usage as zero but keeps an empty usageMetadata silent (BYO item 7)', async () => {
    const partial = await collect(
      sseOf([chunk([{ text: 'hi' }]), usageChunk({ promptTokenCount: 12 }), usageChunk({})]),
    )
    const last = partial.at(-1)
    if (last?.type !== 'response.completed') {
      throw new Error('expected the stream to end completed')
    }
    expect(last.response.usage).toMatchObject({
      input_tokens: 12,
      output_tokens: 0,
      total_tokens: 12,
    })
    const silent = await collect(sseOf([textOnlyChunk('hi'), usageChunk({})]))
    const silentLast = silent.at(-1)
    if (silentLast?.type !== 'response.completed') {
      throw new Error('expected the stream to end completed')
    }
    expect(silentLast.response.usage).toBeUndefined()
  })

  it('names unnamed calls per response so two turns never share one (BYO item 3)', async () => {
    const first = await collect(
      sseOf([
        {
          candidates: [
            { content: { role: 'model', parts: [{ functionCall: { name: 'get_time' } }] } },
          ],
          responseId: 'resp_a',
        },
        chunk([], 'STOP'),
      ]),
    )
    const firstLast = first.at(-1)
    if (firstLast?.type !== 'response.completed') {
      throw new Error('expected the first stream to end completed')
    }
    const second = await collect(
      sseOf([
        {
          candidates: [
            { content: { role: 'model', parts: [{ functionCall: { name: 'get_time' } }] } },
          ],
          responseId: 'resp_b',
        },
        chunk([], 'STOP'),
      ]),
    )
    const secondLast = second.at(-1)
    if (secondLast?.type !== 'response.completed') {
      throw new Error('expected the second stream to end completed')
    }
    const firstCall = firstLast.response.output.find(isFunctionCallItem)
    const secondCall = secondLast.response.output.find(isFunctionCallItem)
    expect(firstCall?.call_id).toBe('call_resp_a_0')
    expect(secondCall?.call_id).toBe('call_resp_b_0')
    expect(firstCall?.call_id).not.toBe(secondCall?.call_id)
  })

  it('drops blank text, marks empty results and stands in for images without vision (BYO item 1)', () => {
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: ' '.repeat(3) },
              { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
            ],
          },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_time',
            arguments: '{"timezone":"UTC"}',
          },
          { type: 'function_call_output', call_id: 'call_1', output: '' },
        ],
      },
      'gemini-2.5-flash',
      { capabilities: { vision: false } },
    )
    const contents = JSON.stringify(request.body['contents'])
    expect(contents).not.toContain('"text":"   "')
    expect(contents).toContain('[image omitted: this model takes no images]')
    expect(contents).toContain('(no tool output)')
  })

  it('removes lone surrogates from instructions and arguments (BYO item 13)', () => {
    const request = encodeGeminiRequest(
      {
        ...TOOL_BODY,
        instructions: 'be brie\u{D800}f',
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_time',
            arguments: '{"timezone":"U\u{DC00}TC"}',
          },
        ],
      },
      'gemini-2.5-flash',
    )
    const text = JSON.stringify(request.body)
    expect(text).toContain('be brie�f')
    expect(text).toContain('U�TC')
    expect(text).not.toContain(String.raw`\ud800`)
    expect(text).not.toContain(String.raw`\udc00`)
  })
})
