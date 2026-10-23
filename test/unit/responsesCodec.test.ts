import { Usd, type UsdAmount } from '../../src/shared/usd'
// M95 lane R: live captures are the positive wire fixtures; mutations below
// exercise malformed/provider-additive frames without making a model call.
import { readFileSync } from 'node:fs'
import { CONSERVATIVE_CAPABILITIES } from '../../src/core/providers/capabilities'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { customQuirksFor, PRESETS, quirksOf } from '../../src/core/providers/presets'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'
import { mcpFunctionDefinition } from '../../src/core/backends/modelapi/mcp/functions'
import {
  createResponsesCodec,
  ResponsesDecodeError,
  type ResponsesCodecQuirks,
} from '../../src/core/backends/modelapi/codecs/responses'
import {
  type CreateResponseBody,
  functionCallItemSchema,
  reasoningItemSchema,
  restoredToolText,
  type StreamEvent,
} from '../../src/core/backends/modelapi/schemas'
import { makeTurnBody } from './helpers/turnBodies'

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
  costs: UsdAmount[] = [],
): Promise<StreamEvent[]> {
  return Array.fromAsync(
    createResponsesCodec(withRetention).decodeStream(chunks, {
      settledCostUsd: (costUsd) => {
        costs.push(costUsd)
      },
    }),
  )
}

function firstTurnBody(model = 'gpt-5.6-luna'): CreateResponseBody {
  return makeTurnBody({
    model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Fix the typo in README.' }],
      },
    ],
    instructions: 'You are a coding agent.',
    toolName: 'read',
    effort: 'medium',
    include: ['reasoning.encrypted_content'],
    maxOutputTokens: 8192,
    promptCacheKey: 'prefix-1',
  })
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
      output: restoredToolText(scenario === 'packed-output' ? '[packed:27 words kept]' : 'A typo.'),
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
  it('omits the reasoning field where the record has no effort levels, and passes mode and context through', () => {
    // Lane REASONSHAPESR2: grok-build-0.1 answers 400 to the `reasoning`
    // parameter itself, so the wire omits it (the xAI-first defect);
    // OPENAI-G08/G07 byte paths ride `mode` and `context` through
    // (UNVERIFIED until OPENAI-PRO and OPENAI-CONTEXT answer).
    const codec = createResponsesCodec(withRetention)
    const omitted = codec.encodeRequest({ ...firstTurnBody(), reasoning: undefined })
    expect(omitted).not.toHaveProperty('reasoning')
    const sent = codec.encodeRequest(firstTurnBody())
    expect(sent).toMatchObject({ reasoning: { effort: 'medium', summary: 'auto' } })
    const pro = codec.encodeRequest({
      ...firstTurnBody(),
      reasoning: { effort: 'low', summary: 'auto', mode: 'pro', context: 'all_turns' },
    })
    expect(pro).toMatchObject({
      reasoning: { effort: 'low', summary: 'auto', mode: 'pro', context: 'all_turns' },
    })
  })

  it('sends safety_identifier where the entry set one, and omits it elsewhere', () => {
    // The entry's end-user id rides as `safety_identifier` (xAI's
    // replacement for the legacy `user` field); without one the wire
    // carries no such field.
    const codec = createResponsesCodec(withRetention)
    const sent = codec.encodeRequest(firstTurnBody(), { safetyIdentifier: 'coder-7' })
    expect(sent).toMatchObject({ safety_identifier: 'coder-7' })
    const omitted = codec.encodeRequest(firstTurnBody())
    expect(omitted).not.toHaveProperty('safety_identifier')
  })

  it.each([
    { model: 'gpt-5.6-luna', sends: true },
    { model: 'gpt-5.6', sends: true },
    { model: 'gpt-6-astra', sends: true },
    { model: 'gpt-6.1-sol', sends: true },
    { model: 'gpt-5.5', sends: false },
    { model: 'gpt-5.4', sends: false },
    { model: 'gpt-5', sends: false },
    { model: 'gpt-5-mini', sends: false },
    { model: 'gpt-4.1', sends: false },
    { model: 'gpt-4o', sends: false },
    { model: 'o1', sends: false },
    { model: 'grok-4.7', sends: false },
    // An Azure-style deployment name never parses as a GPT version, so the
    // choice is withheld rather than risked on an unknown backend.
    { model: 'prod-gpt56', sends: false },
  ])('sends the picked ttl only on GPT-5.6 and later ($model)', ({ model, sends }) => {
    // Every id but the deployment name is a sealed snapshot row. The
    // picked lifetime rides as `prompt_cache_options.ttl` where the API
    // takes it; anywhere else the choice stays home (an unsupported value
    // answers `400 invalid_request_error`).
    const codec = createResponsesCodec(withRetention)
    const wire = codec.encodeRequest(firstTurnBody(model), { cacheTtl: '12h' })
    if (sends) {
      expect(wire).toMatchObject({ prompt_cache_options: { ttl: '12h' } })
    } else {
      expect(wire).not.toHaveProperty('prompt_cache_options')
    }
  })

  it('omits prompt_cache_options for the provider default, and on the plan route (RLPROVSYNC)', () => {
    const codec = createResponsesCodec(withRetention)
    // `default` and absent alike send nothing: the default stays the
    // provider's to keep, even on a model that would take the option.
    for (const options of [{ cacheTtl: 'default' } as const, {}]) {
      expect(codec.encodeRequest(firstTurnBody(), options)).not.toHaveProperty(
        'prompt_cache_options',
      )
    }
    // The ChatGPT plan proxy is undocumented for cache options, so the
    // choice never rides it, as `prompt_cache_retention` never does.
    const plan = createResponsesCodec({
      profile: 'chatgpt',
      toolNamespace: 'functions',
      toolNamespaceDescription: 'test',
    })
    expect(plan.encodeRequest(firstTurnBody(), { cacheTtl: '12h' })).not.toHaveProperty(
      'prompt_cache_options',
    )
  })

  it('keeps prompt_cache_retention alongside the picked ttl (RLPROVSYNC)', () => {
    // The ttl settings do not change the older-model `prompt_cache_retention`
    // parameter (prompt-caching guide): where the record accepts retention
    // it still rides, beside the ttl.
    const wire = createResponsesCodec(withRetention).encodeRequest(firstTurnBody(), {
      cacheTtl: '12h',
    })
    expect(wire).toMatchObject({
      prompt_cache_retention: 'in_memory',
      prompt_cache_options: { ttl: '12h' },
    })
  })

  it('emits the captured U9 strict declaration without changing its schema (M106)', () => {
    const captured = z
      .object({
        request: z.object({
          tools: z.array(
            z.object({
              type: z.literal('function'),
              name: z.string(),
              description: z.string(),
              strict: z.literal(true),
              parameters: z.record(z.string(), z.unknown()),
            }),
          ),
        }),
      })
      .parse(
        JSON.parse(
          readFileSync(new URL('../fixtures/m106/u9-strict-stream.json', import.meta.url), 'utf8'),
        ),
      )
    const tools = captured.request.tools.map(
      (tool) =>
        mcpFunctionDefinition(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        }).definition,
    )
    const codec = createResponsesCodec({ ...withRetention, supportsStrictTools: true })
    // Compare the JSON wire: private conversion symbols are not request fields.
    const serialized = JSON.stringify(codec.encodeRequest({ ...firstTurnBody(), tools })['tools'])
    const wireTools: unknown = JSON.parse(serialized)
    expect(wireTools).toEqual(captured.request.tools)
  })

  it('keeps explicit strict-off bytes with a capable model and gates strict-on by its record (M106)', () => {
    const body = { ...firstTurnBody(), tools: toolDefinitions('linux') }
    const before = JSON.stringify(body)
    for (const supported of [true, false, undefined]) {
      const codec = createResponsesCodec({ ...withRetention, supportsStrictTools: true }, () => ({
        ...CONSERVATIVE_CAPABILITIES,
        supportsStrictTools: supported,
      }))
      const off = codec.encodeRequest(body, { shouldUseStrictTools: false })
      expect(JSON.stringify(off)).toBe(
        JSON.stringify(
          createResponsesCodec({ ...withRetention, vision: false }).encodeRequest(body),
        ),
      )
      const on = codec.encodeRequest(body, { shouldUseStrictTools: true })
      const tools = z.array(z.object({ strict: z.boolean() })).parse(on['tools'])
      expect(tools.every((tool) => tool.strict === (supported === true))).toBe(true)
      expect({ ...on, tools: off['tools'] }).toEqual(off)
      expect(JSON.stringify(body)).toBe(before)
    }
  })

  it.each([
    { modes: undefined, want: 'auto' },
    { modes: ['auto'], want: 'auto' },
    { modes: ['auto', 'none'], want: 'none' },
  ] as const)(
    'sends only a listed tool choice, auto when the record is unknown ($want)',
    ({ modes, want }) => {
      // Measured 2026-10-12 (toolrounds-captures/): Sonnet 5.5 refuses a
      // forced choice, DeepSeek thinking refuses `required`, Meta takes
      // `auto` only — so unknown means auto only.
      const body = { ...firstTurnBody(), tool_choice: 'none' as const }
      const codec = createResponsesCodec(withRetention, () => ({
        ...CONSERVATIVE_CAPABILITIES,
        ...(modes !== undefined && { toolChoiceModes: modes }),
      }))
      expect(codec.encodeRequest(body)['tool_choice']).toBe(want)
      expect(JSON.stringify(body)).toContain('"tool_choice":"none"')
    },
  )

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
        // Strict mode requires every property; read_file's byte-range fields
        // (RLLIMITS) ride beside its line window.
        expect(tools[0]?.parameters['required']).toEqual([
          'path',
          'offset',
          'limit',
          'byteOffset',
          'byteLength',
        ])
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
        {
          type: 'function_call_output',
          call_id: tool.call_id,
          output: restoredToolText('12:00 UTC'),
        },
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

function callBody(callId: string, id: string | undefined): CreateResponseBody {
  return {
    ...firstTurnBody('gpt-5.6-luna'),
    input: [
      {
        type: 'function_call',
        ...(id !== undefined && { id }),
        call_id: callId,
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      { type: 'function_call_output', call_id: callId, output: restoredToolText('noon') },
    ],
  }
}

describe('M101 lane P1 history hardening (BYO items 1, 2, 13)', () => {
  const codec = createResponsesCodec({ sendPromptCacheRetention: false, sendPromptCacheKey: false })

  it('replays same-model fc_ ids and drops foreign or synthetic ones (BYO item 2)', () => {
    const same = codec.encodeRequest(callBody('call_same', 'fc_same'))['input']
    expect(JSON.stringify(same)).toContain('"id":"fc_same"')
    const synthetic = codec.encodeRequest(callBody('call_syn', 'chat-call-x-0'))['input']
    expect(JSON.stringify(synthetic)).not.toContain('"id"')
    expect(JSON.stringify(synthetic)).toContain('"call_id":"call_syn"')
    const switched = codec.encodeRequest(callBody('call_old', 'fc_old'), {
      model: 'gpt-5.6-luna',
      replayOrigins: { call_old: 'gpt-5.5-nano' },
    })['input']
    expect(JSON.stringify(switched)).not.toContain('"id":"fc_old"')
    expect(JSON.stringify(switched)).toContain('"call_id":"call_old"')
    const declared = codec.encodeRequest(callBody('call_new', 'fc_new'), {
      model: 'gpt-5.6-luna',
      replayOrigins: { call_new: 'gpt-5.6-luna' },
    })['input']
    expect(JSON.stringify(declared)).toContain('"id":"fc_new"')
  })

  it('drops blank text, marks empty results and cleans surrogates (BYO items 1, 13)', () => {
    const body: CreateResponseBody = {
      ...firstTurnBody('gpt-5.6-luna'),
      instructions: 'be brie\u{D800}f',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: ' '.repeat(3) },
            { type: 'input_text', text: 'hi' },
          ],
        },
        { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: restoredToolText('') },
      ],
    }
    const text = JSON.stringify(codec.encodeRequest(body)['input'])
    expect(text).not.toContain('"text":"   "')
    expect(text).toContain('"text":"hi"')
    expect(text).toContain('(no tool output)')
    expect(JSON.stringify(codec.encodeRequest(body)['instructions'])).toBe('"be brie�f"')
    expect(text).not.toContain(String.raw`\ud800`)
  })

  it('stands in for images without vision and refuses a fully dropped input', () => {
    const visioned = createResponsesCodec({
      sendPromptCacheRetention: false,
      sendPromptCacheKey: false,
      vision: false,
    })
    const body: CreateResponseBody = {
      ...firstTurnBody('gpt-5.6-luna'),
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
          ],
        },
      ],
    }
    expect(JSON.stringify(visioned.encodeRequest(body)['input'])).toContain(
      '[image omitted: this model takes no images]',
    )
    expect(() =>
      codec.encodeRequest({
        ...firstTurnBody('gpt-5.6-luna'),
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '  ' }] }],
      }),
    ).toThrow(/keeps no replayable input/)
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

  it('maps a reported per-TTL breakdown onto the flat 12-hour counter (RLPROVSYNC)', async () => {
    // The recorded 02-tool-call-stream completion (1,444 written), with
    // the docs-shaped `cache_write_tokens_details` the rig cannot capture
    // (it holds no key): disjoint parts summing to the recorded written
    // total, per the prompt-caching guide (read 2026-10-22).
    const terminal = openaiTool.find((event) => event['type'] === 'response.completed')
    if (terminal === undefined) throw new Error('Missing captured completion')
    const response = z.record(z.string(), z.unknown()).parse(terminal['response'])
    const usage = z.record(z.string(), z.unknown()).parse(response['usage'])
    const details = z.record(z.string(), z.unknown()).parse(usage['input_tokens_details'])
    const written = z.number().parse(details['cache_write_tokens'])
    expect(written).toBe(1444)
    const twelveHourTokens = 44
    const events = await collect(
      stream(
        frame({
          ...terminal,
          response: {
            ...response,
            usage: {
              ...usage,
              input_tokens_details: {
                ...details,
                cache_write_tokens_details: {
                  ttl_30m_tokens: written - twelveHourTokens,
                  ttl_12h_tokens: twelveHourTokens,
                },
              },
            },
          },
        }),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 1447,
          input_tokens_details: { cache_write_tokens: 1444, cache_write_tokens_12h: 44 },
        },
      },
    })
    // The carrier is dropped after the validated mapping.
    expect(events.at(-1)).not.toHaveProperty(
      'response.usage.input_tokens_details.cache_write_tokens_details',
    )
  })

  it('refuses a TTL breakdown that exceeds the written total (RLPROVSYNC)', async () => {
    const terminal = openaiTool.find((event) => event['type'] === 'response.completed')
    if (terminal === undefined) throw new Error('Missing captured completion')
    const response = z.record(z.string(), z.unknown()).parse(terminal['response'])
    const usage = z.record(z.string(), z.unknown()).parse(response['usage'])
    const details = z.record(z.string(), z.unknown()).parse(usage['input_tokens_details'])
    const written = z.number().parse(details['cache_write_tokens'])
    await expect(
      collect(
        stream(
          frame({
            ...terminal,
            response: {
              ...response,
              usage: {
                ...usage,
                input_tokens_details: {
                  ...details,
                  cache_write_tokens_details: {
                    ttl_30m_tokens: written,
                    ttl_12h_tokens: 1,
                  },
                },
              },
            },
          }),
        ),
      ),
    ).rejects.toThrow('invalid_cache_write_split')
  })

  it('accepts a breakdown below the written total for a later TTL (RLPROVSYNC)', async () => {
    // The known parts summing below the written total stays accepted: a
    // later TTL the guide adds may make up the rest. The 12-hour part
    // still maps exactly.
    const terminal = openaiTool.find((event) => event['type'] === 'response.completed')
    if (terminal === undefined) throw new Error('Missing captured completion')
    const response = z.record(z.string(), z.unknown()).parse(terminal['response'])
    const usage = z.record(z.string(), z.unknown()).parse(response['usage'])
    const details = z.record(z.string(), z.unknown()).parse(usage['input_tokens_details'])
    const written = z.number().parse(details['cache_write_tokens'])
    const events = await collect(
      stream(
        frame({
          ...terminal,
          response: {
            ...response,
            usage: {
              ...usage,
              input_tokens_details: {
                ...details,
                cache_write_tokens_details: {
                  ttl_30m_tokens: 1000,
                  ttl_12h_tokens: 44,
                },
              },
            },
          },
        }),
      ),
    )
    expect(written).toBe(1444)
    expect(events.at(-1)).toMatchObject({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens_details: { cache_write_tokens: 1444, cache_write_tokens_12h: 44 },
        },
      },
    })
  })

  it('leaves the 12-hour counter absent without reported details (RLPROVSYNC)', async () => {
    // The recorded completion as captured: no breakdown, so the canonical
    // counter stays absent — unknown, never a guessed zero.
    const terminal = openaiTool.find((event) => event['type'] === 'response.completed')
    if (terminal === undefined) throw new Error('Missing captured completion')
    const events = await collect(stream(frame(terminal)))
    expect(events.at(-1)).toMatchObject({ type: 'response.completed' })
    expect(events.at(-1)).not.toHaveProperty(
      'response.usage.input_tokens_details.cache_write_tokens_12h',
    )
  })

  it('decodes captured xAI single-delta tools, reasoning and settled cost', async () => {
    const costs: UsdAmount[] = []
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
    expect(costs).toEqual([Usd.from('0.0023184').toAmount()])
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
    const costs: UsdAmount[] = []
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
    const costs: UsdAmount[] = []
    await collect(stream(frame(xaiTool.at(-1)!), frame(xaiText.at(-1)!)), costs)
    expect(costs).toEqual([Usd.from('0.0023184').toAmount()])
  })

  it('reports cost only after a terminal event', async () => {
    const terminal = xaiTool.at(-1)!
    const costs: UsdAmount[] = []
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
      expect(costs).toEqual([Usd.from('0.0023184').toAmount()])
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
      const costs: UsdAmount[] = []
      await collect(
        stream(
          frame({
            ...terminal,
            response: { ...response, usage: { ...usage, cost_in_usd_ticks: ticks } },
          }),
        ),
        costs,
      )
      expect(costs).toEqual(ticks === 0 ? [Usd.from(0).toAmount()] : [])
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

it('binds strict schemas per selected model and lets explicit false override a strict preset', () => {
  const records = new Map([
    ['known', { ...CONSERVATIVE_CAPABILITIES, supportsStrictTools: true }],
    ['off', { ...CONSERVATIVE_CAPABILITIES, supportsStrictTools: false }],
  ])
  const codec = createResponsesCodec({ ...withRetention, supportsStrictTools: true }, (modelId) =>
    records.get(modelId),
  )
  const parse = z.object({ tools: z.array(z.object({ strict: z.boolean() })) })
  for (const model of ['known', 'off', 'unknown']) {
    const body = firstTurnBody(model)
    expect(
      parse
        .parse(codec.encodeRequest({ ...body, tools: toolDefinitions('linux') }))
        .tools.every((tool) => tool.strict === (model === 'known')),
    ).toBe(true)
  }
})
