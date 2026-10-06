// M95 lane R: live captures are the positive wire fixtures; mutations below
// exercise malformed/provider-additive frames without making a model call.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { customQuirksFor, PRESETS, quirksOf } from '../../src/core/providers/presets'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'
import {
  createResponsesCodec,
  ResponsesDecodeError,
  type ResponsesCodecQuirks,
  type ResponsesWireCodec,
} from '../../src/core/backends/modelapi/codecs/responses'
import {
  type CreateResponseBody,
  functionCallItemSchema,
  reasoningItemSchema,
  type StreamEvent,
} from '../../src/core/backends/modelapi/schemas'

const encoder = new TextEncoder()
const withRetention: ResponsesCodecQuirks = {
  sendPromptCacheRetention: true,
  sendPromptCacheKey: true,
}
const withoutRetention: ResponsesCodecQuirks = {
  sendPromptCacheRetention: false,
  sendPromptCacheKey: true,
}
const captureSchema = z.object({
  response: z.object({
    events: z.array(z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) })),
  }),
})

function capture(provider: string, file: string) {
  const bytes = readFileSync(
    new URL(`../../docs/certification/m95-captures/${provider}/${file}.json`, import.meta.url),
    'utf8',
  )
  return captureSchema.parse(JSON.parse(bytes)).response.events.map((event) => event.data)
}

const openaiTool = capture('openai', '02-tool-call-stream')
const openaiText = capture('openai', '03-tool-result-stream')
const xaiTool = capture('xai', '03-tool-call-stream')
const xaiText = capture('xai', '04-tool-result-stream')

function frame(event: Record<string, unknown>): string {
  return `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`
}

function stream(...parts: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

function collect(
  chunks: AsyncIterable<Uint8Array>,
  costs: number[] = [],
  codec: ResponsesWireCodec = createResponsesCodec(withRetention),
): Promise<StreamEvent[]> {
  return Array.fromAsync(
    codec.decodeStream(chunks, {
      settledCostUsd: (costUsd) => {
        costs.push(costUsd)
      },
    }),
  )
}

function firstTurnBody(model = 'gpt-5.6-luna'): CreateResponseBody {
  return {
    model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Fix the typo in README.' }],
      },
    ],
    instructions: 'You are a coding agent.',
    tools: [
      {
        type: 'function',
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'medium', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 8192,
    prompt_cache_key: 'prefix-1',
    prompt_cache_retention: 'in_memory',
  }
}

function scenarioBody(scenario: string, model: string): CreateResponseBody {
  const body = firstTurnBody(model)
  if (scenario === 'first-turn') return body
  if (scenario === 'image')
    return {
      ...body,
      input: [
        ...body.input,
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Read this diagram.' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,iVBORw0KGgo=',
              detail: 'auto',
            },
          ],
        },
      ],
    }
  const input: CreateResponseBody['input'] = [
    ...body.input,
    {
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: 'Check spelling.' }],
      encrypted_content: 'opaque-reasoning',
      status: 'completed',
    },
    {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text: 'Reading the file.' }],
    },
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'read',
      arguments: '{"path":"README.md"}',
      status: 'completed',
    },
    {
      type: 'function_call_output',
      call_id: 'call_1',
      output: scenario === 'packed-output' ? '[packed:27 words kept]' : 'A typo.',
    },
  ]
  return { ...body, input, ...(scenario === 'compaction' && { max_output_tokens: 512 }) }
}

function golden(name: string): string {
  const bytes = readFileSync(
    new URL(`../fixtures/responses-codec/${name}.json`, import.meta.url),
    'utf8',
  )
  const data: unknown = JSON.parse(bytes)
  return JSON.stringify(data)
}

describe('responsesCodec encodeRequest', () => {
  it('binds strict request schemas only to the injected supportsStrictTools gate (F4)', () => {
    const body = { ...firstTurnBody(), tools: toolDefinitions('linux') }
    for (const preset of PRESETS) {
      if (preset.format !== 'responses') continue
      const shouldUseStrictTools = quirksOf(preset).supportsStrictTools
      const codec = createResponsesCodec({
        ...withRetention,
        supportsStrictTools: shouldUseStrictTools,
      })
      const tools = z
        .array(z.object({ strict: z.boolean(), parameters: z.record(z.string(), z.unknown()) }))
        .parse(codec.encodeRequest(body)['tools'])
      expect(tools.every((tool) => tool.strict)).toBe(shouldUseStrictTools)
      if (shouldUseStrictTools) {
        expect(tools[0]?.parameters['required']).toEqual(['path', 'offset', 'limit'])
      } else {
        expect(JSON.stringify(codec.encodeRequest(body))).toBe(
          JSON.stringify(createResponsesCodec(withRetention).encodeRequest(body)),
        )
      }
    }
    const custom = customQuirksFor('responses', { supportsStrictTools: true })
    expect(
      createResponsesCodec({
        ...withRetention,
        supportsStrictTools: custom.supportsStrictTools,
      }).encodeRequest(body),
    ).toHaveProperty('tools.0.strict', true)
    const off = createResponsesCodec({ ...withRetention, supportsStrictTools: false })
    expect(JSON.stringify(off.encodeRequest(firstTurnBody()))).toBe(golden('openai-first-turn'))
  })

  for (const { provider, model } of [
    { provider: 'openai', model: 'gpt-5.6-luna' },
    { provider: 'xai', model: 'grok-4.3' },
  ]) {
    it.each(['first-turn', 'tool-loop', 'image', 'packed-output', 'compaction'])(
      `encodes ${provider} %s byte-exact (golden)`,
      (scenario) => {
        expect(
          JSON.stringify(
            createResponsesCodec(withRetention).encodeRequest(scenarioBody(scenario, model)),
          ),
        ).toBe(golden(`${provider}-${scenario}`))
      },
    )
  }

  it('obeys the injected retention policy and preserves a deployment name', () => {
    const encoded = createResponsesCodec(withoutRetention).encodeRequest(
      firstTurnBody('my-deployment'),
    )
    expect(encoded['model']).toBe('my-deployment')
    expect('prompt_cache_retention' in encoded).toBe(false)
    expect(encoded['prompt_cache_key']).toBe('prefix-1')
  })

  it('obeys the injected cache-key policy', () => {
    const encoded = createResponsesCodec({
      ...withoutRetention,
      sendPromptCacheKey: false,
    }).encodeRequest(firstTurnBody())
    expect('prompt_cache_key' in encoded).toBe(false)
  })

  it('is pure, leaves the input untouched and keeps all earlier native bytes', () => {
    const codec = createResponsesCodec(withRetention)
    const original = scenarioBody('tool-loop', 'gpt-5.6-luna')
    const body: CreateResponseBody = {
      ...original,
      tools: [
        {
          type: 'function',
          name: 'z_tool',
          description: 'Another tool',
          parameters: {},
          strict: false,
        },
        ...original.tools,
      ],
    }
    const before = JSON.stringify(body)
    const first = codec.encodeRequest(body)
    const growing = {
      ...body,
      input: [
        ...body.input,
        {
          type: 'message' as const,
          role: 'user' as const,
          content: [{ type: 'input_text' as const, text: 'Now the changelog.' }],
        },
      ],
    }
    const second = codec.encodeRequest(growing)
    expect(JSON.stringify(codec.encodeRequest(body))).toBe(JSON.stringify(first))
    expect(JSON.stringify(body)).toBe(before)
    const earlier = z.array(z.unknown()).parse(second['input']).slice(0, body.input.length)
    expect(JSON.stringify(earlier)).toBe(JSON.stringify(first['input']))
    for (const [key, value] of Object.entries(first)) {
      if (key === 'input') continue
      expect(JSON.stringify(second[key])).toBe(JSON.stringify(value))
    }
  })

  it('replays captured xAI reasoning and tool calls unchanged', async () => {
    const events = await collect(stream(...xaiTool.map((event) => frame(event))))
    const completed = events.find((event) => event.type === 'response.completed')
    if (completed?.type !== 'response.completed') throw new Error('Missing captured completion')
    const reasoning = reasoningItemSchema.parse(completed.response.output[0])
    const tool = functionCallItemSchema.parse(completed.response.output[1])
    const body: CreateResponseBody = {
      ...firstTurnBody('grok-4.3'),
      input: [
        ...firstTurnBody().input,
        reasoning,
        tool,
        { type: 'function_call_output', call_id: tool.call_id, output: '12:00 UTC' },
      ],
    }
    expect(JSON.stringify(createResponsesCodec(withRetention).encodeRequest(body)['input'])).toBe(
      JSON.stringify(body.input),
    )
    expect(reasoning.encrypted_content).toBe(
      z
        .object({ response: z.object({ output: z.array(z.record(z.string(), z.unknown())) }) })
        .parse(xaiTool.at(-1)).response.output[0]!['encrypted_content'],
    )
  })
})

describe('responsesCodec decodeStream', () => {
  it('decodes captured fragmented OpenAI tool arguments without duplication', async () => {
    const events = await collect(stream(...openaiTool.map((event) => frame(event))))
    const deltas = events.filter((event) => event.type === 'response.function_call_arguments.delta')
    expect(deltas).toHaveLength(5)
    expect(deltas.map((event) => event.delta).join('')).toBe('{"timezone":"UTC"}')
    expect(
      events.filter((event) => event.type === 'response.function_call_arguments.done'),
    ).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 1447,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1444 },
        },
      },
    })
  })

  it('decodes captured xAI single-delta tools, reasoning and settled cost', async () => {
    const costs: number[] = []
    const events = await collect(stream(...xaiTool.map((event) => frame(event))), costs)
    const deltas = events.filter((event) => event.type === 'response.function_call_arguments.delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.delta).toBe('{"timezone":"UTC"}')
    expect(
      events
        .filter((event) => event.type === 'response.reasoning_summary_text.delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe('Fetching the current UTC time.')
    expect(events.at(-1)).toMatchObject({
      response: {
        usage: {
          input_tokens: 1674,
          output_tokens: 171,
          output_tokens_details: { reasoning_tokens: 161 },
          cost_in_usd_ticks: 23_184_000,
        },
      },
    })
    expect(costs).toEqual([0.0023184])
  })

  it.each([
    ['OpenAI', openaiText, 'It is 12:00 UTC.'],
    ['xAI', xaiText, 'It is 2026-10-04T12:00:00Z in UTC.'],
  ])(
    'decodes captured %s text and ignores additive events and keep-alives',
    async (_name, frames, text) => {
      const bytes = frames.map((event) => frame(event)).join('')
      const events = await collect(
        stream(
          ': keep-alive\n\ndata: \n\n',
          frame({ type: 'response.queued' }),
          bytes.slice(0, 400),
          bytes.slice(400),
          'data: [DONE]\n\n',
        ),
      )
      const deltas = events.filter((event) => event.type === 'response.output_text.delta')
      expect(deltas.map((event) => event.delta).join('')).toBe(text)
      expect(events.at(-1)?.type).toBe('response.completed')
      expect(events.length).toBe(
        frames.filter(
          (event) =>
            ![
              'response.content_part.added',
              'response.content_part.done',
              'response.output_text.done',
            ].includes(String(event['type'])),
        ).length,
      )
    },
  )

  it.each(['04-cache-call-1', '05-cache-call-2'])(
    'preserves OpenAI cache writes and reads from %s',
    async (file) => {
      const events = await collect(stream(...capture('openai', file).map((event) => frame(event))))
      expect(events.at(-1)).toMatchObject({
        response: {
          usage: {
            input_tokens_details: file.includes('-1')
              ? { cached_tokens: 0, cache_write_tokens: 1574 }
              : { cached_tokens: 1574, cache_write_tokens: 0 },
          },
        },
      })
    },
  )

  it('preserves interleaved parallel calls and fractional output indexes', async () => {
    const added = openaiTool.find((event) => event['type'] === 'response.output_item.added')!
    const delta = openaiTool.find(
      (event) => event['type'] === 'response.function_call_arguments.delta',
    )!
    const done = openaiTool.find((event) => event['type'] === 'response.output_item.done')!
    const item = functionCallItemSchema.parse(added['item'])
    const secondId = 'fc_parallel'
    const events = await collect(
      stream(
        frame(added),
        frame({
          ...added,
          output_index: 1.5,
          item: { ...item, id: secondId, call_id: 'call_parallel' },
        }),
        frame(delta),
        frame({ ...delta, item_id: secondId, output_index: 1.5, delta: '{"timezone":"PST"}' }),
        ...openaiTool
          .filter((event) => event['type'] === 'response.function_call_arguments.delta')
          .slice(1)
          .map((event) => frame(event)),
        frame(done),
        frame({
          ...done,
          output_index: 1.5,
          item: {
            ...item,
            id: secondId,
            call_id: 'call_parallel',
            arguments: '{"timezone":"PST"}',
            status: 'completed',
          },
        }),
      ),
    )
    expect(
      events
        .filter((event) => event.type === 'response.function_call_arguments.delta')
        .filter((event) => event.item_id === secondId),
    ).toMatchObject([{ delta: '{"timezone":"PST"}' }])
    expect(events.at(-1)).toMatchObject({
      type: 'response.output_item.done',
      output_index: 1.5,
      item: { id: secondId, call_id: 'call_parallel' },
    })
  })

  it.each([
    { type: 'error', code: 'server_error', message: 'Synthetic fault' },
    { ...openaiTool.at(-1), type: 'response.failed' },
    { ...openaiTool.at(-1), type: 'response.incomplete' },
  ])('yields $type for the host to fail the turn', async (event) => {
    const events = await collect(stream(frame(event)))
    expect(events.at(-1)?.type).toBe(event.type)
  })

  it('rejects non-JSON and type-less frames without leaking their bytes', async () => {
    for (const garbage of ['not JSON { private-value', '{"private-value":"missing type"}']) {
      try {
        await collect(stream(`data: ${garbage}\n\n`))
        expect.fail('Malformed frame accepted')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ResponsesDecodeError)
        if (!(error instanceof ResponsesDecodeError)) throw error
        expect(error.frameLength).toBe(garbage.length)
        expect(error.message).not.toContain('private-value')
      }
    }
  })

  it('rejects malformed known deltas and error events instead of skipping them', async () => {
    for (const event of [
      { type: 'response.output_text.delta', item_id: 'msg_1', delta: 1 },
      { type: 'error', message: { private: 'private-value' } },
    ]) {
      await expect(collect(stream(frame(event)))).rejects.toThrow(ResponsesDecodeError)
    }
  })

  it('rejects malformed known tool items in item and terminal events', async () => {
    const done = openaiTool.find((event) => event['type'] === 'response.output_item.done')!
    const item = { ...functionCallItemSchema.parse(done['item']), arguments: 1 }
    await expect(collect(stream(frame({ ...done, item })))).rejects.toThrow(ResponsesDecodeError)
    const terminal = openaiTool.at(-1)!
    const response = z.record(z.string(), z.unknown()).parse(terminal['response'])
    await expect(
      collect(stream(frame({ ...terminal, response: { ...response, output: [item] } }))),
    ).rejects.toThrow(ResponsesDecodeError)
  })

  it.each([
    { input_tokens: -1, output_tokens: 1 },
    { input_tokens: 1, output_tokens: -1 },
    { input_tokens: 1, output_tokens: 1, total_tokens: -1 },
    { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } },
    { input_tokens: 1, output_tokens: 1, input_tokens_details: { cache_write_tokens: 2 } },
    { input_tokens: 1, output_tokens: 1, input_tokens_details: { cache_write_tokens: -1 } },
    { input_tokens: 1, output_tokens: 1, output_tokens_details: { reasoning_tokens: -1 } },
    { input_tokens: null, output_tokens: 1 },
  ])('rejects invalid usage before reporting a cost: %j', async (usage) => {
    const terminal = xaiTool.at(-1)!
    const response = z.record(z.string(), z.unknown()).parse(terminal['response'])
    const costs: number[] = []
    await expect(
      collect(
        stream(
          frame({
            ...terminal,
            response: { ...response, usage: { ...usage, cost_in_usd_ticks: 1 } },
          }),
        ),
        costs,
      ),
    ).rejects.toThrow(ResponsesDecodeError)
    expect(costs).toEqual([])
  })

  it('reports a settled cost once even if terminal frames repeat', async () => {
    const costs: number[] = []
    await collect(stream(frame(xaiTool.at(-1)!), frame(xaiText.at(-1)!)), costs)
    expect(costs).toEqual([0.0023184])
  })

  it('reports cost only after a terminal event', async () => {
    const terminal = xaiTool.at(-1)!
    const costs: number[] = []
    const events = createResponsesCodec(withRetention).decodeStream(
      stream(frame({ ...terminal, type: 'response.in_progress' }), frame(terminal)),
      {
        settledCostUsd: (costUsd) => {
          costs.push(costUsd)
        },
      },
    )
    try {
      await events.next()
      expect(costs).toEqual([])
      await events.next()
      expect(costs).toEqual([0.0023184])
    } finally {
      await events.return(undefined)
    }
  })

  it.each([undefined, null, -1, 'cheap', 0])(
    'handles missing, malformed and zero settled cost (%s)',
    async (ticks) => {
      const terminal = xaiTool.at(-1)!
      const response = z.record(z.string(), z.unknown()).parse(terminal['response'])
      const usage = z.record(z.string(), z.unknown()).parse(response['usage'])
      const costs: number[] = []
      await collect(
        stream(
          frame({
            ...terminal,
            response: { ...response, usage: { ...usage, cost_in_usd_ticks: ticks } },
          }),
        ),
        costs,
      )
      expect(costs).toEqual(ticks === 0 ? [0] : [])
    },
  )

  it('keeps future fields on valid replay items', async () => {
    const done = openaiTool.find((event) => event['type'] === 'response.output_item.done')!
    const item = functionCallItemSchema.parse(done['item'])
    const events = await collect(
      stream(frame({ ...done, item: { ...item, future_field: 'kept' } })),
    )
    expect(events[0]).toMatchObject({ item: { future_field: 'kept' } })
  })

  it('rejects malformed known message parts rather than accepting the catch-all', async () => {
    const done = openaiText.find((event) => event['type'] === 'response.output_item.done')!
    const item = z.record(z.string(), z.unknown()).parse(done['item'])
    await expect(
      collect(
        stream(
          frame({
            ...done,
            item: {
              ...item,
              content: [{ type: 'output_text', text: 1 }],
            },
          }),
        ),
      ),
    ).rejects.toThrow(ResponsesDecodeError)
  })

  it('preserves captured text-part additions', async () => {
    const events = await collect(stream(...openaiText.map((event) => frame(event))))
    expect(events.at(-1)).toMatchObject({ response: { output: [{ content: [{ logprobs: [] }] }] } })
  })
})
