// M95b lane C: the owner's 2026-10-05 capture findings describe the plan
// request and nested SSE limit error. No sign-in or model calls run here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createResponsesCodec,
  ResponsesDecodeError,
} from '../../src/core/backends/modelapi/codecs/responses'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'

const encoder = new TextEncoder()
const codec = createResponsesCodec({ profile: 'chatgpt', toolNamespace: 'functions' })
const limitMessage =
  'The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.'
const limitError = {
  type: 'invalid_request_error',
  code: 'subscription_sharing_usage_limit_exceeded',
  message: limitMessage,
}

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
      Array.fromAsync(codec.decodeStream(stream(frame({ type: 'error', error: limitError })))),
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
      const events = await Array.fromAsync(codec.decodeStream(response.body))
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
      await expect(Array.fromAsync(codec.decodeStream(response.body))).rejects.toMatchObject({
        name: 'ChatgptPlanLimitError',
        code: limitError.code,
        message: limitMessage,
      })
    },
  )

  it('also recognises a response.failed plan limit when no preceding error event arrives', async () => {
    await expect(
      Array.fromAsync(codec.decodeStream(stream(frame(failed())))),
    ).rejects.toMatchObject({
      name: 'ChatgptPlanLimitError',
      code: limitError.code,
      message: limitMessage,
    })
  })

  it('translates other nested errors without misclassifying them as a plan limit', async () => {
    const error = { ...limitError, code: 'other_error', message: 'Other error' }
    expect(
      await Array.fromAsync(codec.decodeStream(stream(frame({ type: 'error', error })))),
    ).toEqual([{ type: 'error', code: 'other_error', message: 'Other error' }])
  })

  it('rejects malformed nested errors without exposing their contents', async () => {
    await expect(
      Array.fromAsync(
        codec.decodeStream(
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
