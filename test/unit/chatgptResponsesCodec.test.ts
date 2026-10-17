// M95b lane C: the owner's 2026-10-05 capture findings describe the plan
// request and nested SSE limit error. No sign-in or model calls run here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  createResponsesCodec,
  ResponsesDecodeError,
  type ResponsesDecodeSink,
} from '../../src/core/backends/modelapi/codecs/responses'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'

const encoder = new TextEncoder()
const codec = createResponsesCodec({ profile: 'chatgpt', toolNamespace: 'functions' })
// The error/created fixtures produce no output tokens.
const sink: ResponsesDecodeSink = {
  outputCap: { maxOutputTokens: 512, countOutputTokens: () => 0, abort: () => undefined },
}
function decode(chunks: AsyncIterable<Uint8Array>) {
  return codec.decodeStream(chunks, sink)
}
const limitMessage =
  'The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.'
const limitError = {
  type: 'invalid_request_error',
  code: 'subscription_sharing_usage_limit_exceeded',
  message: limitMessage,
}

// Request fields from the supplied scrubbed responses-namespace frame;
// loose objects retain additions so the comparison cannot silently omit them.
const captureSchema = z.object({
  request: z.object({
    body: z.looseObject({
      model: z.string(),
      input: z.array(z.looseObject({ role: z.literal('user'), content: z.string() })),
      tools: z.array(
        z.looseObject({
          type: z.literal('namespace'),
          name: z.string(),
          description: z.string(),
          tools: z.array(
            z.looseObject({
              type: z.literal('function'),
              name: z.string(),
              description: z.string(),
              parameters: z.record(z.string(), z.unknown()),
              strict: z.boolean(),
            }),
          ),
        }),
      ),
      store: z.literal(false),
      stream: z.literal(true),
      reasoning: z.looseObject({ effort: z.string() }),
      include: z.array(z.literal('reasoning.encrypted_content')),
      prompt_cache_key: z.string(),
    }),
  }),
})

function body(): CreateResponseBody {
  return {
    model: 'gpt-6-astra',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'What time is it?' }],
      },
    ],
    instructions: 'Use the time tool.',
    tools: [
      {
        type: 'function',
        name: 'get_time',
        description: 'Get the time in a timezone.',
        parameters: {
          type: 'object',
          properties: { timezone: { type: 'string' } },
          required: ['timezone'],
          additionalProperties: false,
        },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 512,
    prompt_cache_key: 'm95b-capture',
    prompt_cache_retention: 'in_memory',
  }
}

function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function stream(...frames: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of frames) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

function failed(error: unknown = limitError) {
  return {
    type: 'response.failed',
    response: { id: 'resp_scrubbed', status: 'failed', output: [], error, usage: null },
  }
}

describe('chatgpt Responses request profile', () => {
  it('matches the preview-rule namespace golden without changing the canonical body', () => {
    const original = body()
    const before = JSON.stringify(original)
    const golden: unknown = JSON.parse(
      readFileSync(
        new URL('../fixtures/responses-codec/chatgpt-first-turn.json', import.meta.url),
        'utf8',
      ),
    )
    expect(JSON.stringify(codec.encodeRequest(original))).toBe(JSON.stringify(golden))
    expect(JSON.stringify(original)).toBe(before)
    expect(JSON.stringify(codec.encodeRequest(original))).toBe(JSON.stringify(golden))
  })

  it('matches the scrubbed captured request with only documented harness adaptations', () => {
    // Run 577bc807-780d-4d99-9c09-e4d43a9d8538, seq 5, 2026-10-05:
    // one counted plan attempt in the owner's empty capture workspace.
    const capture = captureSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../fixtures/responses-codec/chatgpt-responses-capture.json', import.meta.url),
          'utf8',
        ),
      ),
    ).request.body
    const namespace = capture.tools[0]
    if (namespace === undefined) throw new Error('Missing captured namespace')
    const input: CreateResponseBody['input'] = capture.input.map((message) => ({
      type: 'message',
      role: message.role,
      content: [{ type: 'input_text', text: message.content }],
    }))
    const original = {
      ...body(),
      instructions: 'Use the ping tool.',
      model: capture.model,
      input,
      tools: namespace.tools,
      reasoning: { ...body().reasoning, effort: capture.reasoning.effort },
      include: capture.include,
      store: capture.store,
      stream: capture.stream,
      prompt_cache_key: capture.prompt_cache_key,
    }
    const capturedCodec = createResponsesCodec({
      profile: 'chatgpt',
      toolNamespace: namespace.name,
      toolNamespaceDescription: namespace.description,
    })
    const before = JSON.stringify(original)
    // Exhaustive intentional differences from the captured request:
    // /input/0/type: the canonical replay names its message item explicitly.
    // /input/0/content: the harness uses typed input_text parts, not shorthand.
    // /instructions: the harness supplies its system/tool instructions.
    // /tool_choice: explicit auto retains the harness's tool-loop contract.
    // /reasoning/summary: auto supplies the harness's visible thought summaries.
    // The canonical cap and retention are deliberately omitted as in the
    // capture; namespace description and each tool's strictness are unchanged.
    expect(capture.tools[0]?.tools[0]?.strict).toBe(true)
    expect(capturedCodec.encodeRequest(original)).toEqual({
      ...capture,
      input,
      instructions: original.instructions,
      tool_choice: original.tool_choice,
      reasoning: { ...capture.reasoning, summary: original.reasoning.summary },
    })
    expect(JSON.stringify(original)).toBe(before)
  })

  it('keeps full earlier history and tool schemas byte-exact as a conversation grows', () => {
    const original = body()
    const history: CreateResponseBody = {
      ...original,
      input: [
        ...original.input,
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'get_time',
          arguments: '{"timezone":"UTC"}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: '12:00 UTC' },
      ],
    }
    const before = JSON.stringify(history)
    expect(codec.encodeRequest(history)['input']).toEqual(history.input)
    expect(codec.encodeRequest(history)['tools']).toEqual([
      { type: 'namespace', name: 'functions', tools: original.tools },
    ])
    expect(JSON.stringify(history)).toBe(before)
    const growing: CreateResponseBody = {
      ...history,
      input: [
        ...history.input,
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Again.' }] },
      ],
    }
    expect(JSON.stringify(codec.encodeRequest(growing)['input'])).toBe(
      JSON.stringify(growing.input),
    )
    expect(codec.encodeRequest(growing)['tools']).toEqual(codec.encodeRequest(history)['tools'])
  })

  it('does not offer unsupported hosted tools through a function namespace', () => {
    expect(() => codec.encodeRequest({ ...body(), tools: [{ type: 'web_search' }] })).toThrow(
      ResponsesDecodeError,
    )
  })
})

describe('chatgpt Responses stream profile', () => {
  it('surfaces the first nested plan-limit event before response.failed is available', async () => {
    await expect(
      Array.fromAsync(decode(stream(frame({ type: 'error', error: limitError })))),
    ).rejects.toMatchObject({
      name: 'ChatgptPlanLimitError',
      code: limitError.code,
      message: limitMessage,
    })
  })

  it.each([undefined, 'application/json', 'text/event-stream'])(
    'reads successful SSE regardless of Content-Type (%s) without using the echoed cache key',
    async (contentType) => {
      const response = new Response(
        stream(
          frame({
            type: 'response.created',
            response: {
              id: 'resp_scrubbed',
              status: 'in_progress',
              output: [],
              usage: null,
              prompt_cache_key: 'rewritten-uuid',
            },
          }),
        ),
        { status: 200, headers: contentType === undefined ? {} : { 'Content-Type': contentType } },
      )
      if (response.body === null) throw new Error('Missing test response body')
      const events = await Array.fromAsync(decode(response.body))
      expect(events).toMatchObject([{ type: 'response.created' }])
      expect(codec.encodeRequest(body())['prompt_cache_key']).toBe('m95b-capture')
    },
  )

  it.each([undefined, 'application/json', 'text/event-stream'])(
    'surfaces a typed plan-limit error inside HTTP 200 regardless of Content-Type (%s)',
    async (contentType) => {
      const response = new Response(
        stream(frame({ type: 'error', error: limitError }), frame(failed())),
        { status: 200, headers: contentType === undefined ? {} : { 'Content-Type': contentType } },
      )
      if (response.body === null) throw new Error('Missing test response body')
      await expect(Array.fromAsync(decode(response.body))).rejects.toMatchObject({
        name: 'ChatgptPlanLimitError',
        code: limitError.code,
        message: limitMessage,
      })
    },
  )

  it('also recognises a response.failed plan limit when no preceding error event arrives', async () => {
    await expect(Array.fromAsync(decode(stream(frame(failed()))))).rejects.toMatchObject({
      name: 'ChatgptPlanLimitError',
      code: limitError.code,
      message: limitMessage,
    })
  })

  it('translates other nested errors without misclassifying them as a plan limit', async () => {
    const error = { ...limitError, code: 'other_error', message: 'Other error' }
    expect(await Array.fromAsync(decode(stream(frame({ type: 'error', error }))))).toEqual([
      { type: 'error', code: 'other_error', message: 'Other error' },
    ])
  })

  it('rejects malformed nested errors without exposing their contents', async () => {
    await expect(
      Array.fromAsync(
        decode(
          stream(
            frame({
              type: 'error',
              error: { ...limitError, message: { private: 'private-value' } },
            }),
          ),
        ),
      ),
    ).rejects.toThrow(ResponsesDecodeError)
  })
})
