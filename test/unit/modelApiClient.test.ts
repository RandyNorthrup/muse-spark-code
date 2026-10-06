import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  MissingApiKeyError,
  ModelApiClient,
  ModelApiError,
  type ModelApiClientDeps,
  type RetryNotice,
  retryAfterMs,
} from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_MAX_RETRIES, UI_TEXT } from '../../src/shared/constants'
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
  prompt_cache_retention: '24h',
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
  reservePaidRequest?: ModelApiClientDeps['reservePaidRequest'],
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
    ...(reservePaidRequest !== undefined && { reservePaidRequest }),
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

describe('Meta transport regression boundaries', () => {
  it.each([400, 429, 500])(
    'preserves merged paid admission and refusal settlement on HTTP %s',
    async (status) => {
      for (const isImage of [true, false]) {
        const total = { spentUsd: 1, hasUnknownHistoricalFees: false }
        const claim = {
          claimId: 'fixture',
          reservedUsd: 1,
          check: vi.fn(() => total),
          settle: vi.fn(() => Promise.resolve(total)),
        }
        const reserve = vi.fn(() => Promise.resolve(claim))
        const fetch = vi.fn(() =>
          Promise.resolve(Response.json({ error: { message: 'fixture refusal' } }, { status })),
        )
        const { client } = setup('plain', fetch, undefined, reserve)
        const run = isImage
          ? client.createImage(
              {
                model: 'image',
                prompt: 'fixture',
                n: 1,
                size: '1024x1024',
                response_format: 'b64_json',
                output_format: 'png',
              },
              new AbortController().signal,
            )
          : collect(
              client.streamResponse(
                { ...body, tools: [{ type: 'web_search' }] },
                new AbortController().signal,
              ),
            )
        await expect(run).rejects.toMatchObject({ status })
        expect(client.hasPaidDailyBudget).toBe(true)
        expect(reserve).toHaveBeenCalledOnce()
        expect(claim.check).toHaveBeenCalledTimes(fetch.mock.calls.length)
        if (status === 500) {
          expect(fetch).toHaveBeenCalledOnce()
          expect(claim.settle).not.toHaveBeenCalled()
        } else {
          expect(claim.settle).toHaveBeenCalledWith(0)
        }
      }
    },
  )

  it('settles merged paid stream usage after canonical parsing', async () => {
    const total = { spentUsd: 1, hasUnknownHistoricalFees: false }
    const claim = {
      claimId: 'fixture',
      reservedUsd: 1,
      check: vi.fn(() => total),
      settle: vi.fn((_actualUsd: number) => Promise.resolve(total)),
    }
    const reserve = vi.fn(() => Promise.resolve(claim))
    const wire =
      'data: {"type":"response.completed","response":{"id":"r","status":"completed","output":[],"usage":{"input_tokens":100,"output_tokens":100}}}\n\n'
    const { client } = setup('plain', () => Promise.resolve(new Response(wire)), undefined, reserve)
    const paidBody: CreateResponseBody = { ...body, tools: [{ type: 'web_search' }] }
    await collect(client.streamResponse(paidBody, new AbortController().signal))
    expect(reserve).toHaveBeenCalledWith(paidBody, 'webSearch', undefined, expect.any(AbortSignal))
    expect(claim.settle).toHaveBeenCalledOnce()
    expect(claim.settle.mock.calls[0]?.[0]).toBeGreaterThan(0)
    expect(claim.settle.mock.calls[0]?.[0]).toBeLessThan(claim.reservedUsd)
  })
  it('uses body-free diagnostics on every successful-HTTP JSON endpoint', async () => {
    const { client } = setup('opaque95', () => Promise.resolve(new Response('opaque95')))
    const image = {
      model: 'image',
      prompt: 'fixture',
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
      output_format: 'png',
    } as const
    for (const run of [
      () => client.listModels(),
      () => client.countInputTokens(body),
      () => client.createImage(image, new AbortController().signal),
      () => client.editImage({ ...image, images: [] }, new AbortController().signal),
    ]) {
      await expect(run()).rejects.toMatchObject({ kind: 'malformed_json' })
      await expect(run()).rejects.not.toThrow('opaque95')
    }
  })

  it('redacts failure fields on every response discriminator under HTTP 200', async () => {
    const key = 'opaque95'
    const events = [
      'response.created',
      'response.in_progress',
      'response.completed',
      'response.failed',
      'response.incomplete',
    ].map((type) => ({
      type,
      response: {
        id: 'r',
        status: 'incomplete',
        output: [],
        error: { message: key, code: key },
        incomplete_details: { reason: key },
      },
    }))
    const wire = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
    const { client } = setup(key, () => Promise.resolve(new Response(wire)))
    const result = await collect(client.streamResponse(body, new AbortController().signal))
    expect(result).toHaveLength(events.length)
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).toContain('[redacted]')
  })
})

/** A fetch behind a network that inspects HTTPS: Node's "fetch failed" and its cause (M56). */
function untrusted(): Promise<Response> {
  return Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('self-signed certificate in certificate chain'), {
        code: 'SELF_SIGNED_CERT_IN_CHAIN',
      }),
    }),
  )
}

describe('ModelApiClient', () => {
  it.each(['stop', 'confirmed'])(
    'observes no actual attempt when final %s refuses after preflight',
    async (refusal) => {
      const t = setup()
      const stop = new AbortController()
      let isConfirmed = true
      const started = vi.fn()
      const guard = Object.assign(
        () => {
          if (refusal === 'stop') {
            stop.abort()
          } else {
            isConfirmed = false
          }
        },
        { onRequestStarted: started },
      )
      await expect(
        collect(
          t.client.streamResponse(body, stop.signal, undefined, undefined, guard, {
            modelId: body.model,
            keyDigest: createHash('sha256').update('LLM|1|secret').digest('hex'),
            isStillAllowed: () => isConfirmed,
            onRequestStarted: vi.fn(),
          }),
        ),
      ).rejects.toThrow()
      expect(t.api.responseBodies()).toEqual([])
      expect(started).not.toHaveBeenCalled()
    },
  )

  it('observes no attempt when request initialization throws after successful preflight', async () => {
    const t = setup()
    const started = vi.fn()
    const admitted = vi.fn()
    const confirmedStarted = vi.fn()
    const guard = Object.assign(admitted, { onRequestStarted: started })
    const invalidInit = {
      ...body,
      toJSON: () => {
        throw new Error('request init refused')
      },
    }
    await expect(
      collect(
        t.client.streamResponse(
          invalidInit,
          new AbortController().signal,
          undefined,
          undefined,
          guard,
          {
            modelId: body.model,
            keyDigest: createHash('sha256').update('LLM|1|secret').digest('hex'),
            isStillAllowed: () => true,
            onRequestStarted: confirmedStarted,
          },
        ),
      ),
    ).rejects.toThrow('request init refused')
    expect(admitted).toHaveBeenCalledOnce()
    expect(started).not.toHaveBeenCalled()
    expect(confirmedStarted).not.toHaveBeenCalled()
    expect(t.api.responseBodies()).toEqual([])
  })

  it('observes every actual fetch and retry after one preflight and body build each', async () => {
    const api = fakeModelApi()
    api.script({ httpError: { status: 502 } }, { text: 'tail' })
    const sequence: string[] = []
    const t = setup('LLM|1|secret', (input, init) => {
      sequence.push('fetch')
      return api.fetch(input, init)
    })
    const guard = Object.assign(
      () => {
        sequence.push('guard')
      },
      {
        onRequestStarted: () => {
          sequence.push('started')
        },
      },
    )
    const countedInit = {
      ...body,
      toJSON: () => {
        sequence.push('init')
        return body
      },
    }
    await collect(
      t.client.streamResponse(
        countedInit,
        new AbortController().signal,
        undefined,
        undefined,
        guard,
      ),
    )
    expect(sequence).toEqual([
      'guard',
      'init',
      'started',
      'fetch',
      'guard',
      'init',
      'started',
      'fetch',
    ])
    expect(api.responseBodies()).toHaveLength(2)
  })

  it('rechecks a scheduled paid gate before retrying a request', async () => {
    const api = fakeModelApi()
    api.script({ httpError: { status: 429 } }, { text: 'should not run' })
    const key = 'LLM|1|secret'
    let isOn = true
    const onRequestStarted = vi.fn()
    const client = new ModelApiClient({
      fetch: api.fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => Promise.resolve(key),
      sleep: () => {
        isOn = false
        return Promise.resolve()
      },
      now: () => NOW,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    await expect(
      collect(
        client.streamResponse(body, new AbortController().signal, undefined, undefined, undefined, {
          modelId: body.model,
          keyDigest: createHash('sha256').update(key).digest('hex'),
          isStillAllowed: () => isOn,
          onRequestStarted,
        }),
      ),
    ).rejects.toThrow(UI_TEXT.scheduleConfirmationExpired)
    expect(api.responseBodies()).toHaveLength(1)
    expect(onRequestStarted).toHaveBeenCalledOnce()
  })

  it('rechecks the scheduled key before a paid attempt guard on HTTP retry', async () => {
    const api = fakeModelApi()
    api.script({ httpError: { status: 429 } }, { text: 'must not run' })
    const originalKey = 'LLM|1|secret'
    let currentKey = originalKey
    const admitted = vi.fn()
    const onRequestStarted = vi.fn()
    const client = new ModelApiClient({
      fetch: api.fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => Promise.resolve(currentKey),
      sleep: () => {
        currentKey = 'LLM|1|changed'
        return Promise.resolve()
      },
      now: () => NOW,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    const originalDigest = createHash('sha256').update(originalKey).digest('hex')
    await expect(
      collect(
        client.streamResponse(body, new AbortController().signal, undefined, undefined, admitted, {
          modelId: body.model,
          keyDigest: originalDigest,
          isStillAllowed: () => true,
          onRequestStarted,
        }),
      ),
    ).rejects.toThrow(UI_TEXT.scheduleConfirmationExpired)
    expect(api.responseBodies()).toHaveLength(1)
    expect(admitted).toHaveBeenCalledExactlyOnceWith(originalDigest)
    expect(onRequestStarted).toHaveBeenCalledOnce()
  })

  it('refuses a scheduled paid row when final admission aborts synchronously', async () => {
    const api = fakeModelApi()
    api.script({ text: 'must not run' })
    const fetch = vi.fn(api.fetch)
    const key = 'LLM|1|secret'
    const stop = new AbortController()
    const onRequestStarted = vi.fn()
    const client = new ModelApiClient({
      fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => Promise.resolve(key),
      sleep: () => Promise.resolve(),
      now: () => NOW,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    await expect(
      collect(
        client.streamResponse(
          body,
          stop.signal,
          undefined,
          undefined,
          () => {
            stop.abort()
          },
          {
            modelId: body.model,
            keyDigest: createHash('sha256').update(key).digest('hex'),
            isStillAllowed: () => true,
            onRequestStarted,
          },
        ),
      ),
    ).rejects.toMatchObject({ status: 0 })
    expect(onRequestStarted).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps a stopped scheduled run free while its SecretStorage key read settles', async () => {
    const api = fakeModelApi()
    const fetch = vi.fn(api.fetch)
    const key = 'LLM|1|secret'
    const keyStarted = Promise.withResolvers<undefined>()
    const keyResult = Promise.withResolvers<string>()
    const onRequestStarted = vi.fn()
    const admitted = vi.fn()
    const client = new ModelApiClient({
      fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => {
        keyStarted.resolve(undefined)
        return keyResult.promise
      },
      sleep: () => Promise.resolve(),
      now: () => NOW,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    const stop = new AbortController()
    const result = collect(
      client.streamResponse(body, stop.signal, undefined, undefined, admitted, {
        modelId: body.model,
        keyDigest: createHash('sha256').update(key).digest('hex'),
        isStillAllowed: () => true,
        onRequestStarted,
      }),
    )
    await keyStarted.promise
    stop.abort()
    keyResult.resolve(key)
    await expect(result).rejects.toMatchObject({ status: 0 })
    expect(onRequestStarted).not.toHaveBeenCalled()
    expect(admitted).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

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

  it('does not count a fetch when a final preflight refuses after key retrieval', async () => {
    const t = setup()
    const stop = new AbortController()
    const sent = vi.fn()
    const guard = Object.assign(
      () => {
        stop.abort()
      },
      { onRequestStarted: sent },
    )
    await expect(
      collect(t.client.streamResponse(body, stop.signal, undefined, undefined, guard)),
    ).rejects.toMatchObject({ status: 0 })
    expect(sent).not.toHaveBeenCalled()
    expect(t.api.responseBodies()).toEqual([])
  })

  it('observes every actual response fetch and retry once at the dispatch boundary', async () => {
    const t = setup()
    const admitted = vi.fn()
    const sent = vi.fn()
    t.api.script({ httpError: { status: 503 } }, { httpError: { status: 503 } }, { text: 'done' })
    await collect(
      t.client.streamResponse(
        body,
        new AbortController().signal,
        undefined,
        undefined,
        Object.assign(admitted, { onRequestStarted: sent }),
      ),
    )
    expect(admitted).toHaveBeenCalledTimes(3)
    expect(sent).toHaveBeenCalledTimes(3)
    expect(t.api.responseBodies()).toHaveLength(3)
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

  // M56 (PLAN.md D43): the causes under "fetch failed", as Node 24 throws them.
  it('says which certificate store to check when the request never reached Meta', async () => {
    const { client, sleeps, log } = setup('LLM|1|secret', untrusted)
    const notices: RetryNotice[] = []
    const failure = collect(
      client.streamResponse(body, new AbortController().signal, (notice) => {
        notices.push(notice)
      }),
    )
    await expect(failure).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining(UI_TEXT.networkUntrustedCertificate),
    })
    await expect(failure).rejects.toMatchObject({
      message: expect.stringContaining('(SELF_SIGNED_CERT_IN_CHAIN)'),
    })
    expect(sleeps).toHaveLength(MODEL_API_MAX_RETRIES)
    expect(notices[0]?.reason).toContain(UI_TEXT.networkUntrustedCertificate)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'failed to send (fetch failed: self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN))',
      ),
    )
    // A billed request is not sent again, and says the same (M34).
    const once = setup('LLM|1|secret', untrusted)
    await expect(
      once.client.createImage(
        {
          model: 'muse-image-1.0',
          prompt: 'a cat',
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
          output_format: 'png',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining(UI_TEXT.networkUntrustedCertificate),
    })
    expect(once.sleeps).toEqual([])
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
