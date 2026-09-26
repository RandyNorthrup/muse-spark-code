import { describe, expect, it, vi } from 'vitest'
import {
  MissingApiKeyError,
  ModelApiClient,
  ModelApiError,
  type RetryNotice,
  retryAfterMs,
} from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'

const body: CreateResponseBody = {
  model: 'muse-spark-1.3',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  instructions: 'be brief',
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'high', summary: 'auto' },
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  max_output_tokens: 100,
  prompt_cache_key: 's1',
}

const NOW = Date.parse('2026-09-23T12:00:00Z')

/**
 * `null` means no key is stored; `rawFetch` answers instead of the fake API;
 * `streamIdleMs` shortens the stall limit (M39).
 */
function setup(
  key: string | null = 'LLM|1|secret',
  rawFetch?: typeof fetch,
  streamIdleMs?: number,
) {
  const api = fakeModelApi()
  const sleeps: number[] = []
  const log = new FakeLogOutputChannel()
  const client = new ModelApiClient({
    fetch: rawFetch ?? api.fetch,
    baseUrl: 'https://api.example.test/v1',
    apiKey: () => Promise.resolve(key ?? undefined),
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
    now: () => NOW,
    random: () => 0.5,
    log,
    ...(streamIdleMs !== undefined && { streamIdleMs }),
  })
  return { api, client, sleeps, log }
}

/** A response body that sends `text` and then nothing, reporting its cancellation. */
function bodyOf(text: string, cancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
    },
    cancel,
  })
}

function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  return Array.fromAsync(stream)
}

describe('ModelApiClient', () => {
  it('sends the bearer key and lists the catalogue ids', async () => {
    const { api, client } = setup()
    await expect(client.listModels()).resolves.toEqual([
      'muse-spark-1.3',
      'muse-spark-1.3-contributor',
      'muse-spark-1.2',
      'muse-image-1.0',
    ])
    expect(api.requests[0]).toMatchObject({
      path: '/models',
      method: 'GET',
      headers: { Authorization: 'Bearer LLM|1|secret', Accept: 'application/json' },
    })
  })

  // M39: an event type the client does not use is logged once, not once a
  // frame, and each answer's time is traced.
  it('logs an ignored stream event type once and traces how long the answer took', async () => {
    const frames = ['response.queued', 'response.queued', 'response.heartbeat']
      .map((type) => `data: ${JSON.stringify({ type })}\n\n`)
      .join('')
    const { client, log } = setup('LLM|1|secret', () =>
      Promise.resolve(new Response(frames, { status: 200 })),
    )
    await collect(client.streamResponse(body, new AbortController().signal))
    const ignored = log.info.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('are ignored'))
    expect(ignored).toEqual([
      'Model API stream events of type response.queued are ignored',
      'Model API stream events of type response.heartbeat are ignored',
    ])
    expect(log.trace).toHaveBeenCalledWith('Model API POST /responses answered 200 in 0 ms')
  })

  // M39: a stalled stream would otherwise hold the turn until Stop.
  it('ends a reply stream that sends nothing for the idle time, and aborts its request', async () => {
    let requestSignal: AbortSignal | undefined
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.queued' })}\n\n`),
        )
      },
    })
    const { client } = setup(
      'LLM|1|secret',
      (_url, init) => {
        requestSignal = init?.signal ?? undefined
        return Promise.resolve(new Response(stalling, { status: 200 }))
      },
      50,
    )
    await expect(
      collect(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow(
      'The Model API sent nothing for 0 s, so the reply was ended; send the message again to retry',
    )
    expect(requestSignal?.aborted).toBe(true)
  })

  // The review of PR #20: an early end closes the parser, releasing the body.
  it('releases the response body when a frame is malformed or the caller stops reading', async () => {
    const malformedCancel = vi.fn()
    const malformed = setup('LLM|1|secret', () =>
      Promise.resolve(new Response(bodyOf('data: {not json\n\n', malformedCancel))),
    )
    await expect(
      collect(malformed.client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow('Malformed stream frame')
    await vi.waitFor(() => {
      expect(malformedCancel).toHaveBeenCalled()
    })
    const stoppedCancel = vi.fn()
    const created = `data: ${JSON.stringify({
      type: 'response.created',
      response: { id: 'r1', status: 'in_progress', output: [] },
    })}\n\n`
    const stopped = setup('LLM|1|secret', () =>
      Promise.resolve(new Response(bodyOf(created, stoppedCancel))),
    )
    const events = stopped.client.streamResponse(body, new AbortController().signal)
    for await (const event of events) {
      expect(event.type).toBe('response.created')
      break
    }
    await vi.waitFor(() => {
      expect(stoppedCancel).toHaveBeenCalled()
    })
  })

  it('ends a reply whose headers never come the same way', async () => {
    const { client } = setup(
      'LLM|1|secret',
      () =>
        new Promise<Response>(() => {
          // Never answers.
        }),
      50,
    )
    await expect(
      collect(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow(ModelApiError)
  })

  it('counts input tokens without the stream flag', async () => {
    const { api, client } = setup()
    const { stream: _stream, ...countable } = body
    await expect(client.countInputTokens(countable)).resolves.toBe(42)
    expect(api.requests[0]).toMatchObject({ path: '/responses/input_tokens', method: 'POST' })
    expect(api.requests[0]?.body).not.toHaveProperty('stream')
  })

  it('streams the documented events in order, skipping unknown types', async () => {
    const { api, client } = setup()
    api.script({
      reasoning: 'think',
      text: 'hello',
      calls: [{ name: 'read_file', arguments: '{}' }],
    })
    const events = await collect(client.streamResponse(body, new AbortController().signal))
    expect(events.map((event) => event.type)).toEqual([
      'response.created',
      'response.output_item.added',
      'response.reasoning_summary_text.delta',
      'response.output_item.done',
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_item.done',
      'response.output_item.added',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_item.done',
      'response.completed',
    ])
    expect(api.requests[0]).toMatchObject({
      path: '/responses',
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: { stream: true, store: false, include: ['reasoning.encrypted_content'] },
    })
  })

  it('retries 429 / 500 / 503 with backoff honouring Retry-After, then gives up', async () => {
    const { api, client, sleeps, log } = setup()
    api.script(
      {
        httpError: {
          status: 429,
          retryAfter: '2',
          body: {
            error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limit_exceeded' },
          },
        },
      },
      { httpError: { status: 503 } },
      { httpError: { status: 500 } },
      { text: 'finally' },
    )
    const events = await collect(client.streamResponse(body, new AbortController().signal))
    expect(events.at(-1)?.type).toBe('response.completed')
    // Retry-After 2 s + 500 ms jitter, then 2 s + jitter and 4 s + jitter of backoff.
    expect(sleeps).toEqual([2500, 2500, 4500])
    expect(log.warn).toHaveBeenCalledTimes(3)
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('429')
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('slow down')

    api.script({ httpError: { status: 503 } })
    await expect(
      collect(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toMatchObject({
      name: 'ModelApiError',
      status: 503,
    })
    expect(api.requests.filter((request) => request.path === '/responses')).toHaveLength(4 + 5)
  })

  it('checks a child grant after a fresh key read before every HTTP retry', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    let key = 'LLM|1|secret'
    const client = new ModelApiClient({
      fetch: api.fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => Promise.resolve(key),
      sleep: () => {
        key = 'LLM|1|changed'
        return Promise.resolve()
      },
      now: () => NOW,
      random: () => 0,
      log,
    })
    api.script({ httpError: { status: 429 } }, { text: 'must not run' })
    const keyDigests: (string | undefined)[] = []
    await expect(
      collect(
        client.streamResponse(
          body,
          new AbortController().signal,
          undefined,
          undefined,
          (digest) => {
            keyDigests.push(digest)
            if (keyDigests.length > 1) {
              throw new Error('child consent expired')
            }
          },
        ),
      ),
    ).rejects.toThrow('child consent expired')
    expect(keyDigests).toHaveLength(2)
    expect(keyDigests[0]).not.toBe(keyDigests[1])
    expect(api.responseBodies()).toHaveLength(1)
    expect(JSON.stringify(log)).not.toContain(key)
  })

  it('does not admit or send a stopped child after its key read completes', async () => {
    const keyRead = Promise.withResolvers<string>()
    const fetch = vi.fn<typeof globalThis.fetch>()
    const admitted = vi.fn()
    const client = new ModelApiClient({
      fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => keyRead.promise,
      sleep: () => Promise.resolve(),
      now: () => NOW,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    const stop = new AbortController()
    const pending = collect(
      client.streamResponse(body, stop.signal, undefined, undefined, admitted),
    )
    stop.abort()
    keyRead.resolve('LLM|1|secret')
    await expect(pending).rejects.toThrow()
    expect(admitted).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('announces each retry and stops waiting when the turn is stopped (D25)', async () => {
    const { api, client } = setup()
    api.script({ httpError: { status: 503 } }, { text: 'finally' })
    const notices: RetryNotice[] = []
    await collect(
      client.streamResponse(body, new AbortController().signal, (notice) => {
        notices.push(notice)
      }),
    )
    expect(notices).toEqual([
      { attempt: 1, maxAttempts: 5, delayMs: 1500, reason: 'HTTP 503: status 503' },
    ])
    // A retry delay that never ends on its own still ends with the Stop.
    const stuck = new ModelApiClient({
      fetch: api.fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => Promise.resolve('LLM|1|secret'),
      sleep: () => new Promise(() => undefined),
      now: () => NOW,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    api.script({ httpError: { status: 503 } })
    const stop = new AbortController()
    const pending = collect(stuck.streamResponse(body, stop.signal))
    setTimeout(() => {
      stop.abort()
    }, 20)
    await expect(pending).rejects.toMatchObject({ message: 'cancelled' })
  })

  it('reads Retry-After as seconds or as an HTTP date (D25)', () => {
    expect(retryAfterMs('3', NOW)).toBe(3000)
    expect(retryAfterMs(new Date(NOW + 5000).toUTCString(), NOW)).toBe(5000)
    expect(retryAfterMs(new Date(NOW - 5000).toUTCString(), NOW)).toBe(0)
    expect(retryAfterMs('-1', NOW)).toBeUndefined()
    expect(retryAfterMs('soon', NOW)).toBeUndefined()
    expect(retryAfterMs('', NOW)).toBeUndefined()
    expect(retryAfterMs(null, NOW)).toBeUndefined()
  })

  it('does not retry 400 / 401 and reports the envelope', async () => {
    const { api, client, sleeps } = setup()
    api.script({
      httpError: {
        status: 400,
        body: {
          error: {
            message: 'temperature out of range',
            type: 'invalid_request_error',
            param: 'temperature',
          },
        },
      },
    })
    let error: unknown
    try {
      await collect(client.streamResponse(body, new AbortController().signal))
    } catch (error_: unknown) {
      error = error_
    }
    expect(error).toBeInstanceOf(ModelApiError)
    expect(error).toMatchObject({
      status: 400,
      kind: 'invalid_request_error',
      code: undefined,
      message: 'temperature out of range',
    })
    expect(sleeps).toEqual([])
    const unauthorized = setup('LLM|bad')
    await expect(unauthorized.client.listModels()).rejects.toMatchObject({
      status: 401,
      code: 'invalid_api_key',
    })
  })

  it('retries a failed send, and stops when the caller aborted', async () => {
    const { api, client, sleeps } = setup()
    api.script({ networkError: 'ECONNRESET' }, { text: 'back' })
    const events = await collect(client.streamResponse(body, new AbortController().signal))
    expect(events.at(-1)?.type).toBe('response.completed')
    expect(sleeps).toEqual([1500])
    const controller = new AbortController()
    controller.abort()
    await expect(collect(client.streamResponse(body, controller.signal))).rejects.toMatchObject({
      status: 0,
    })
  })

  it('refuses without a key and fails on frames it cannot trust', async () => {
    const missing = setup(null)
    await expect(missing.client.listModels()).rejects.toBeInstanceOf(MissingApiKeyError)
    const { api, client } = setup()
    api.script({ garbage: true })
    await expect(
      collect(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Malformed stream frame'),
    })
  })

  it('reads past a keep-alive and the [DONE] sentinel (D26)', async () => {
    const { api, client } = setup()
    api.script({ text: 'hi', doneSentinel: true })
    const events = await collect(client.streamResponse(body, new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'response.completed' })
  })
})
