import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { ApiKeyAuthSource } from '../../src/core/backends/modelapi/authSource'
import {
  CodecClient,
  type CodecClientDeps,
  type ProviderModel,
  type WireCodec,
} from '../../src/core/backends/modelapi/providerClient'
import {
  ModelApiError,
  RequestTransport,
  readBoundedText,
  isModelApiError,
  type TransportDeps,
  type ResponseObservation,
} from '../../src/core/backends/modelapi/transport'
import { parseSse } from '../../src/core/backends/modelapi/sse'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  streamEventSchema,
  isMessageItem,
  type StreamEvent,
} from '../../src/core/backends/modelapi/schemas'
import { redactSecrets } from '../../src/core/redact'
import { CREDENTIAL_RECORD_VERSION, PROVIDER_HTTP_BODY_MAX_BYTES } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { metaGoldenBodies } from './helpers/m95MetaBodies'

const body = metaGoldenBodies()[0]?.body
if (body === undefined) {
  throw new Error('Missing fixture body')
}
const ORIGIN = 'https://provider.example.test'
const KEY = 'opaque-"quoted"-canary'
const model: ProviderModel = {
  id: 'native-model',
  capabilities: { toolCalling: true, vision: false, reasoning: true, parallelToolCalls: false },
  contextWindow: 100,
  maxOutputTokens: 100,
}
const errorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.optional(z.string()),
    type: z.optional(z.string()),
  }),
})

function deps(overrides: Partial<TransportDeps> = {}): TransportDeps {
  return {
    baseUrl: ORIGIN,
    apiKey: () => Promise.resolve(KEY),
    fetch: () => Promise.resolve(new Response('{}')),
    sleep: () => Promise.resolve(),
    now: () => 0,
    random: () => 0,
    log: new FakeLogOutputChannel(),
    ...overrides,
  }
}
function codec(): WireCodec {
  return {
    format: 'chat',
    encode: (canonical) => ({ path: '/v1/chat/completions', body: canonical }),
    decode: async function* (response) {
      if (response.body === null) {
        throw new Error('No stream body')
      }
      for await (const frame of parseSse(response.body)) {
        yield streamEventSchema.parse(JSON.parse(frame.data))
      }
    },
    parseError: (status, value) => {
      const parsed = z.parse(errorSchema, value)
      return new ModelApiError(parsed.error.message, status, parsed.error.type, parsed.error.code)
    },
    models: {
      path: '/v1/models',
      parse: (value) => {
        z.parse(z.object({ data: z.array(z.object({ id: z.string() })) }), value)
        return [model]
      },
    },
    countTokens: {
      encode: (canonical) => ({ path: '/count', body: canonical }),
      parse: (value) => z.parse(z.object({ count: z.number() }), value).count,
    },
  }
}
function codecDeps(overrides: Partial<CodecClientDeps> = {}): CodecClientDeps {
  return {
    provider: {
      id: 'custom',
      label: 'Fixture provider',
      origin: ORIGIN,
      format: 'chat',
      auth: 'apiKey',
      isLocal: false,
    },
    baseUrl: ORIGIN,
    codec: codec(),
    auth: new ApiKeyAuthSource(
      () =>
        Promise.resolve({
          record: { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: ORIGIN },
          key: KEY,
        }),
      'bearer',
    ),
    modelFor: () => model,
    verifyEndpoint: () => Promise.resolve(),
    transport: deps(),
    ...overrides,
  }
}

describe('shared provider transport', () => {
  it.each(['meta', 'codec'])(
    'records headers, retries and first token once on %s',
    async (kind) => {
      let now = 0
      let attempts = 0
      const observations: ResponseObservation[] = []
      const guard = Object.assign(() => undefined, {
        observe: (value: ResponseObservation) => {
          observations.push(value)
        },
      })
      const transport = deps({
        now: () => now,
        fetch: () => {
          attempts += 1
          now = attempts * 100
          if (attempts === 1) return Promise.resolve(new Response('{}', { status: 429 }))
          return Promise.resolve(
            new Response(
              [
                { type: 'response.output_text.delta', item_id: 'm', delta: 'a' },
                { type: 'response.output_text.delta', item_id: 'm', delta: 'b' },
              ]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
              { headers: { 'x-ratelimit-remaining-requests': '2', 'x-secret-echo': KEY } },
            ),
          )
        },
      })
      const client =
        kind === 'meta'
          ? new ModelApiClient({ ...transport, apiKey: () => Promise.resolve(KEY) })
          : new CodecClient(codecDeps({ transport }))
      await Array.fromAsync(
        client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
      )
      expect(observations).toContainEqual(expect.objectContaining({ rateLimited: true }))
      expect(observations).toContainEqual(expect.objectContaining({ retries: 1 }))
      expect(observations).toContainEqual({ headers: { 'x-ratelimit-remaining-requests': '2' } })
      expect(observations.filter((value) => value.firstTokenMs !== undefined)).toEqual([
        { firstTokenMs: 200 },
      ])
      expect(JSON.stringify(observations)).not.toContain(KEY)
    },
  )
  it.each(['meta', 'codec'])('preserves executable and ordinary content on %s', async (kind) => {
    const argumentsText = JSON.stringify({ apiKey: 'literal placeholder', content: KEY })
    const events: StreamEvent[] = [
      { type: 'response.function_call_arguments.delta', item_id: 'f', delta: argumentsText },
      { type: 'response.function_call_arguments.done', item_id: 'f', arguments: argumentsText },
      { type: 'response.output_text.delta', item_id: 'm', delta: 'ordinary answer' },
    ]
    const fetch = () =>
      Promise.resolve(
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')),
      )
    const client =
      kind === 'meta'
        ? new ModelApiClient({ ...deps({ fetch }), apiKey: () => Promise.resolve(KEY) })
        : new CodecClient(codecDeps({ transport: deps({ fetch }) }))
    const expected = events.map((event) => {
      if (event.type === 'response.function_call_arguments.delta')
        return {
          ...event,
          delta: argumentsText.replace(JSON.stringify(KEY).slice(1, -1), '[redacted]'),
        }
      if (event.type === 'response.function_call_arguments.done')
        return {
          ...event,
          arguments: argumentsText.replace(JSON.stringify(KEY).slice(1, -1), '[redacted]'),
        }
      return event
    })
    expect(
      await Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    ).toEqual(expected)
  })
  it('requires an endpoint verifier for every injected auth source', () => {
    const auth = codecDeps().auth
    expect(() => new RequestTransport(deps({ auth }))).toThrow('endpoint_verifier_required')
  })
  it('names the actual provider on a network refusal and removes its echoed key', async () => {
    const auth = codecDeps().auth
    const reason = new Error(`failed ${KEY}`)
    const transport = new RequestTransport(
      deps({ auth, verifyEndpoint: () => Promise.resolve(), fetch: () => Promise.reject(reason) }),
    )
    let failure: unknown
    try {
      await transport.request('/models', { method: 'GET', accept: 'application/json' }, undefined)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ModelApiError)
    if (!(failure instanceof ModelApiError)) {
      throw new Error('Expected transport refusal')
    }
    expect(failure.message).toContain(ORIGIN)
    expect(failure.message).not.toContain('api.meta.ai')
    expect(failure.message).not.toContain('quoted')
  })
  it('recognizes errors from another bundle and redacts a parser throwing a header echo', async () => {
    class ForeignModelApiError extends Error {
      public readonly status = 429
      public readonly kind = undefined
      public readonly code = 'rate_limit'
      public constructor() {
        super('foreign')
        this.name = 'ModelApiError'
      }
    }
    const foreign = new ForeignModelApiError()
    expect(foreign).not.toBeInstanceOf(ModelApiError)
    expect(isModelApiError(foreign)).toBe(true)
    expect(isModelApiError(new Error('untyped'))).toBe(false)
    const transport = new RequestTransport(
      deps({
        fetch: () =>
          Promise.resolve(Response.json({}, { status: 401, headers: { 'x-echo': KEY } })),
        parseError: (_status, _body, headers) => {
          throw new Error(headers.get('x-echo') ?? '')
        },
      }),
    )
    await expect(
      transport.request('/models', { method: 'GET', accept: 'application/json' }, undefined),
    ).rejects.toMatchObject({ message: '[redacted]', status: 401 })
  })
  it.each([301, 307])(
    'sets redirect error on HTTP %s and never dispatches to Location',
    async (status) => {
      const sent: string[] = []
      const transport = new RequestTransport(
        deps({
          fetch: (url, init) => {
            sent.push(url instanceof Request ? url.url : url.toString())
            if (init?.redirect !== 'error') {
              sent.push('https://attacker.test/stolen')
            }
            return Promise.resolve(
              new Response('', { status, headers: { Location: 'https://attacker.test/stolen' } }),
            )
          },
        }),
      )
      await expect(
        transport.request('/models', { method: 'GET', accept: 'application/json' }, undefined),
      ).rejects.toMatchObject({ status })
      expect(sent).toEqual([`${ORIGIN}/models`])
    },
  )
  it('rejects an absolute codec path before credential access or fetch', async () => {
    const apiKey = vi.fn(() => Promise.resolve(KEY))
    const fetch = vi.fn(() => Promise.resolve(new Response('{}')))
    await expect(
      new RequestTransport(deps({ apiKey, fetch })).request(
        'https://other.test/path',
        { method: 'GET', accept: 'application/json' },
        undefined,
      ),
    ).rejects.toMatchObject({ kind: 'origin_mismatch' })
    expect(apiKey).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rechecks endpoint answers and rereads credentials on every retry', async () => {
    let key = KEY
    const apiKey = vi.fn(() => Promise.resolve(key))
    const verifyEndpoint = vi.fn(() => Promise.resolve())
    const sent: string[] = []
    const transport = new RequestTransport(
      deps({
        apiKey,
        verifyEndpoint,
        fetch: (_url, init) => {
          sent.push(new Headers(init?.headers).get('Authorization') ?? '')
          return Promise.resolve(new Response('{}', { status: sent.length === 1 ? 429 : 200 }))
        },
        sleep: () => {
          key = 'rotated-opaque'
          return Promise.resolve()
        },
      }),
    )
    await transport.request('/models', { method: 'GET', accept: 'application/json' }, undefined)
    expect(sent).toEqual([`Bearer ${KEY}`, 'Bearer rotated-opaque'])
    expect(apiKey).toHaveBeenCalledTimes(2)
    expect(verifyEndpoint).toHaveBeenCalledTimes(2)
  })
  it('refuses rebinding before admission or a second fetch', async () => {
    let checks = 0
    const admitted = vi.fn()
    const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 429 })))
    const transport = new RequestTransport(
      deps({
        fetch,
        verifyEndpoint: () => {
          checks += 1
          if (checks === 2) {
            throw new Error('rebinding refused')
          }
          return Promise.resolve()
        },
      }),
    )
    await expect(
      transport.request(
        '/models',
        { method: 'GET', accept: 'application/json' },
        undefined,
        undefined,
        undefined,
        admitted,
      ),
    ).rejects.toThrow('rebinding refused')
    expect(fetch).toHaveBeenCalledOnce()
    expect(admitted).toHaveBeenCalledOnce()
  })
  it('rechecks Stop and scheduled origin after deferred endpoint verification', async () => {
    for (const isStopped of [true, false]) {
      const stop = new AbortController()
      const fetch = vi.fn(() => Promise.resolve(new Response('{}')))
      const started = vi.fn()
      const admitted = vi.fn()
      const transport = new RequestTransport(
        deps({
          fetch,
          verifyEndpoint: () => {
            if (isStopped) {
              stop.abort()
            }
            return Promise.resolve()
          },
        }),
      )
      await expect(
        transport.request(
          '/models',
          { method: 'GET', accept: 'application/json' },
          stop.signal,
          undefined,
          undefined,
          admitted,
          {
            modelId: body.model,
            keyDigest: createHash('sha256').update(KEY).digest('hex'),
            origin: isStopped ? ORIGIN : 'https://wrong.test',
            isStillAllowed: () => true,
            onRequestStarted: started,
          },
        ),
      ).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
      expect(started).not.toHaveBeenCalled()
      expect(admitted).not.toHaveBeenCalled()
    }
  })
  it('redacts quoted opaque credentials from error envelopes, fields and retry notices', async () => {
    const log = new FakeLogOutputChannel()
    const retries: unknown[] = []
    const transport = new RequestTransport(
      deps({
        log,
        fetch: () =>
          Promise.resolve(
            Response.json(
              { error: { message: `echo ${KEY}`, type: KEY, code: KEY } },
              { status: 429 },
            ),
          ),
      }),
    )
    const result = transport.request(
      '/models',
      { method: 'GET', accept: 'application/json' },
      undefined,
      (notice) => {
        retries.push(notice)
      },
    )
    await expect(result).rejects.toMatchObject({
      message: 'echo [redacted]',
      kind: '[redacted]',
      code: '[redacted]',
    })
    expect(JSON.stringify({ log, retries })).not.toContain('quoted')
  })
  it('cancels oversized HTTP bodies before parsing them', async () => {
    const cancel = vi.fn()
    let isSent = false
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (isSent) {
            controller.close()
          } else {
            isSent = true
            controller.enqueue(new Uint8Array(PROVIDER_HTTP_BODY_MAX_BYTES + 1))
          }
        },
        cancel,
      },
      { highWaterMark: 0 },
    )
    await expect(readBoundedText(new Response(source))).rejects.toMatchObject({
      kind: 'body_limit',
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(source.locked).toBe(false)
  })

  it('keeps codec metadata from overriding auth or JSON headers through case variants', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe(`Bearer ${KEY}`)
      expect(headers.get('Content-Type')).toBe('application/json')
      expect(headers.get('Accept')).toBe('application/json')
      return Promise.resolve(new Response('{}'))
    })
    await new RequestTransport(deps({ fetch })).request(
      '/models',
      {
        method: 'GET',
        accept: 'application/json',
        headers: { authorization: 'wrong', 'content-type': 'wrong', accept: 'wrong' },
      },
      undefined,
    )
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('redacts credentials even when fetch throws a ModelApiError', async () => {
    const failure = new ModelApiError(`echo ${KEY}`, 0, KEY, KEY)
    const fetch = () => Promise.reject(failure)
    await expect(
      new RequestTransport(deps({ fetch })).request(
        '/models',
        { method: 'GET', accept: 'application/json' },
        undefined,
      ),
    ).rejects.toMatchObject({ message: 'echo [redacted]', kind: '[redacted]', code: '[redacted]' })
  })
})

describe('CodecClient injected seam', () => {
  it('never exposes body fragments from successful HTTP JSON parser failures', async () => {
    for (const text of ['opaque95', 'opaque95-with-a-long-truncated-parser-echo']) {
      const client = new CodecClient(
        codecDeps({ transport: deps({ fetch: () => Promise.resolve(new Response(text)) }) }),
      )
      for (const run of [() => client.listModels(), () => client.countInputTokens(body)]) {
        await expect(run()).rejects.toMatchObject({ kind: 'malformed_json' })
        await expect(run()).rejects.not.toThrow('opaque95')
      }
    }
  })

  it('redacts every successful-HTTP parser, codec, reader and canonical failure path', async () => {
    const account = 'account@fixture.test'
    const echo = `${KEY} ${account} Authorization: Bearer ${KEY}`
    const auth = {
      headers: async (url: string) => {
        const headers = await codecDeps().auth.headers(url)
        return { ...headers, redact: (text: string) => redactSecrets(text, [KEY, account]) }
      },
    }
    const failures = [
      new Error(echo),
      new ModelApiError(echo, 200, echo, echo),
      new SyntaxError('Unexpected token opaque-"quo'),
    ]
    for (const failure of failures) {
      const configuration = codecDeps({ auth })
      const broken: WireCodec = {
        ...configuration.codec,
        models: {
          path: '/models',
          parse: () => {
            throw failure
          },
        },
        countTokens: {
          encode: () => ({ path: '/count', body: {} }),
          parse: () => {
            throw failure
          },
        },
        decode: async function* () {
          await Promise.resolve()
          yield { type: 'response.output_text.delta', item_id: 'a', delta: 'first' }
          throw failure
        },
      }
      const client = new CodecClient({ ...configuration, codec: broken })
      for (const run of [
        () => client.listModels(),
        () => client.countInputTokens(body),
        () => Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
      ]) {
        let caught: unknown
        try {
          await run()
        } catch (error: unknown) {
          caught = error
        }
        expect(caught).toBeInstanceOf(ModelApiError)
        if (!(caught instanceof ModelApiError)) {
          throw new Error('Expected protected failure')
        }
        const surfaced = JSON.stringify({
          message: caught.message,
          kind: caught.kind,
          code: caught.code,
        })
        expect(surfaced).not.toContain('opaque-')
        expect(surfaced).not.toContain(account)
      }
    }
    const events: StreamEvent[] = [
      { type: 'error', message: echo, code: echo },
      ...(
        [
          'response.created',
          'response.in_progress',
          'response.completed',
          'response.failed',
          'response.incomplete',
        ] as const
      ).map((type) => ({
        type,
        response: {
          id: 'r',
          status: 'incomplete',
          output: [],
          error: { message: echo, code: echo },
          incomplete_details: { reason: echo },
        },
      })),
      { type: 'response.output_text.delta', item_id: 'a', delta: echo },
    ]
    const client = new CodecClient(
      codecDeps({
        auth,
        codec: {
          ...codec(),
          decode: async function* () {
            await Promise.resolve()
            yield* events
          },
        },
      }),
    )
    const surfaced = JSON.stringify(
      await Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    )
    expect(surfaced).not.toContain('quoted')
    expect(surfaced).not.toContain(account)
    expect(surfaced).toContain('[redacted]')
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(echo))
      },
    })
    const readerClient = new CodecClient(
      codecDeps({ auth, transport: deps({ fetch: () => Promise.resolve(new Response(source)) }) }),
    )
    await expect(
      Array.fromAsync(readerClient.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow('[redacted]')
  })

  it('yields parsed canonical items so malformed known fields cannot reach item guards', async () => {
    const captured: WireCodec = {
      ...codec(),
      decode: async function* () {
        await Promise.resolve()
        const item = { type: 'message', id: 'm', role: 'assistant', content: 'malformed' }
        yield { type: 'response.output_item.done', item }
      },
    }
    const events = await Array.fromAsync(
      new CodecClient(codecDeps({ codec: captured })).streamResponse(
        body,
        new AbortController().signal,
      ),
    )
    const event = events[0]
    expect(event).toEqual({ type: 'response.output_item.done', item: { type: 'message', id: 'm' } })
    if (event === undefined || !('item' in event)) {
      throw new Error('Expected parsed item')
    }
    expect(isMessageItem(event.item)).toBe(false)
  })

  it.each(['CodecClient', 'Meta'])(
    '%s stalls on comment bytes or partial frames without a parsed event',
    async (kind) => {
      vi.useFakeTimers()
      try {
        const fragments = [
          ':keepalive\n\n',
          kind === 'Meta' ? 'data: {"type":"future.event"}\n\n' : 'data: ',
        ]
        for (const fragment of fragments) {
          const cancel = vi.fn()
          let chunks = 0
          let timer: ReturnType<typeof setInterval>
          const source = new ReadableStream<Uint8Array>({
            start(controller) {
              timer = setInterval(() => {
                chunks += 1
                if (chunks === 20) {
                  clearInterval(timer)
                  controller.close()
                } else {
                  controller.enqueue(new TextEncoder().encode(fragment))
                }
              }, 5)
            },
            cancel() {
              clearInterval(timer)
              cancel()
            },
          })
          const fetch = () => Promise.resolve(new Response(source))
          const client =
            kind === 'Meta'
              ? new ModelApiClient({
                  ...deps(),
                  apiKey: () => Promise.resolve(KEY),
                  fetch,
                  streamIdleMs: 20,
                })
              : new CodecClient(
                  codecDeps({
                    streamIdleMs: 20,
                    transport: deps({ fetch }),
                  }),
                )
          const rejected = expect(
            Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
          ).rejects.toMatchObject({ status: 0 })
          await vi.advanceTimersByTimeAsync(110)
          await rejected
          expect(cancel).toHaveBeenCalledOnce()
          expect(chunks).toBeLessThan(20)
          expect(source.locked).toBe(false)
        }
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('renews the idle deadline after each parsed event despite prefetched bytes', async () => {
    vi.useFakeTimers()
    try {
      let timer: ReturnType<typeof setInterval>
      let chunks = 0
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          timer = setInterval(() => {
            chunks += 1
            if (chunks === 6) {
              clearInterval(timer)
              controller.close()
            } else {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"response.output_text.delta","item_id":"a","delta":"hi"}\n\n',
                ),
              )
            }
          }, 10)
        },
        cancel() {
          clearInterval(timer)
        },
      })
      const client = new CodecClient(
        codecDeps({
          streamIdleMs: 20,
          transport: deps({ fetch: () => Promise.resolve(new Response(source)) }),
        }),
      )
      const result = Array.fromAsync(client.streamResponse(body, new AbortController().signal))
      await vi.advanceTimersByTimeAsync(70)
      expect(await result).toHaveLength(5)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps additional codec usage fields but refuses invalid canonical usage', async () => {
    for (const input of [1, NaN]) {
      const usage = { input_tokens: input, output_tokens: 1, cost: 0.1 }
      const captured: WireCodec = {
        ...codec(),
        decode: async function* () {
          await Promise.resolve()
          yield {
            type: 'response.completed',
            response: { id: 'r', status: 'completed', output: [], usage },
          }
        },
      }
      const stream = Array.fromAsync(
        new CodecClient(codecDeps({ codec: captured })).streamResponse(
          body,
          new AbortController().signal,
        ),
      )
      if (Number.isNaN(input)) {
        await expect(stream).rejects.toBeInstanceOf(ModelApiError)
      } else {
        expect(await stream).toMatchObject([{ response: { usage: { cost: 0.1 } } }])
      }
    }
  })
  it('pins codec format and exact origin before construction', () => {
    expect(() => new CodecClient(codecDeps({ baseUrl: `${ORIGIN}:444` }))).toThrow(
      'provider_pin_mismatch',
    )
    expect(
      () => new CodecClient(codecDeps({ codec: { ...codec(), format: 'responses' } })),
    ).toThrow('provider_pin_mismatch')
  })
  it('uses the codec for streams, model lists and token counts with auth and admission', async () => {
    const paths: string[] = []
    const admitted = vi.fn()
    const verifyEndpoint = vi.fn(() => Promise.resolve())
    const client = new CodecClient(
      codecDeps({
        verifyEndpoint,
        transport: deps({
          fetch: (url, init) => {
            paths.push(url instanceof Request ? url.url : url.toString())
            expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${KEY}`)
            expect(init?.redirect).toBe('error')
            if ((url instanceof Request ? url.url : url.toString()).endsWith('/models')) {
              return Promise.resolve(Response.json({ data: [{ id: model.id }] }))
            }
            return Promise.resolve(
              (url instanceof Request ? url.url : url.toString()).endsWith('/count')
                ? Response.json({ count: 100 })
                : new Response(
                    'data: {"type":"response.output_text.delta","item_id":"a","delta":"hello"}\n\n',
                  ),
            )
          },
        }),
      }),
    )
    expect(await client.listModels()).toEqual([model.id])
    expect(await client.countInputTokens(body)).toBe(100)
    expect(
      await Array.fromAsync(
        client.streamResponse(body, new AbortController().signal, undefined, undefined, admitted),
      ),
    ).toMatchObject([{ type: 'response.output_text.delta', delta: 'hello' }])
    expect(paths).toEqual([
      `${ORIGIN}/v1/models`,
      `${ORIGIN}/count`,
      `${ORIGIN}/v1/chat/completions`,
    ])
    expect(admitted).toHaveBeenCalledOnce()
    expect(verifyEndpoint).toHaveBeenCalledTimes(3)
    expect(client.capabilities(body.model)).toEqual(model.capabilities)
    expect(await client.currentKeyDigest()).toBe(createHash('sha256').update(KEY).digest('hex'))
    expect(client.retryDelayMs(0)).toBeGreaterThan(0)
    await client.waitBeforeRetry(0, new AbortController().signal)
  })
  it.each(['1113', '1308'])(
    'does not retry Z.ai terminal business code %s under 429',
    async (code) => {
      const fetch = vi.fn(() =>
        Promise.resolve(
          Response.json({ error: { message: 'business refusal', code } }, { status: 429 }),
        ),
      )
      const configuration = codecDeps({ transport: deps({ fetch }) })
      const address = 'https://api.z.ai'
      const client = new CodecClient({
        ...configuration,
        baseUrl: address,
        provider: { ...configuration.provider, id: 'my-zai', origin: address },
        auth: new ApiKeyAuthSource(
          () =>
            Promise.resolve({
              record: { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: address },
              key: KEY,
            }),
          'bearer',
        ),
      })
      await expect(
        Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
      ).rejects.toMatchObject({ status: 429, code })
      expect(fetch).toHaveBeenCalledOnce()
    },
  )
  it('refuses unavailable or invalid token counts explicitly', async () => {
    const { countTokens: _counter, ...withoutCounter } = codec()
    await expect(
      new CodecClient(codecDeps({ codec: withoutCounter })).countInputTokens(body),
    ).rejects.toMatchObject({ kind: 'token_count_unavailable' })
    for (const count of [-1, 0.5, Infinity]) {
      const client = new CodecClient(
        codecDeps({
          codec: {
            ...codec(),
            countTokens: { encode: () => ({ path: '/count', body: {} }), parse: () => count },
          },
        }),
      )
      await expect(client.countInputTokens(body)).rejects.toMatchObject({
        kind: 'invalid_token_count',
      })
    }
  })
  it('binds scheduled consent to provider, origin and model before encoding', async () => {
    const configuration = codecDeps()
    const encode = vi.fn(configuration.codec.encode)
    const client = new CodecClient({ ...configuration, codec: { ...configuration.codec, encode } })
    await expect(
      Array.fromAsync(
        client.streamResponse(body, new AbortController().signal, undefined, undefined, undefined, {
          modelId: body.model,
          keyDigest: KEY,
          providerId: 'other',
          origin: ORIGIN,
          isStillAllowed: () => true,
          onRequestStarted: vi.fn(),
        }),
      ),
    ).rejects.toThrow()
    expect(encode).not.toHaveBeenCalled()
  })
  it('ends an idle stream, cancels its reader and redacts decoder failures', async () => {
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.output_text.delta","item_id":"a","delta":"hi"}\n\n',
          ),
        )
      },
      cancel,
    })
    const client = new CodecClient(
      codecDeps({
        streamIdleMs: 15,
        transport: deps({ fetch: () => Promise.resolve(new Response(source)) }),
      }),
    )
    await expect(
      Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toMatchObject({ status: 0 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(source.locked).toBe(false)
    const broken: WireCodec = {
      ...codec(),
      decode: async function* () {
        await Promise.resolve()
        yield { type: 'response.output_text.delta', item_id: 'a', delta: 'one' }
        throw new Error(`echo ${KEY}`)
      },
    }
    await expect(
      Array.fromAsync(
        new CodecClient(codecDeps({ codec: broken })).streamResponse(
          body,
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ message: 'echo [redacted]' })
  })

  it('rejects an empty stream and redacts HTTP-200 stream error fields', async () => {
    const empty = new CodecClient(
      codecDeps({ transport: deps({ fetch: () => Promise.resolve(new Response(null)) }) }),
    )
    await expect(
      Array.fromAsync(empty.streamResponse(body, new AbortController().signal)),
    ).rejects.toMatchObject({ kind: 'empty_body' })
    const client = new CodecClient(
      codecDeps({
        transport: deps({
          fetch: () =>
            Promise.resolve(
              new Response(
                `data: ${JSON.stringify({ type: 'error', message: `echo ${KEY}`, code: KEY })}\n\n`,
              ),
            ),
        }),
      }),
    )
    expect(
      await Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    ).toEqual([{ type: 'error', message: 'echo [redacted]', code: '[redacted]' }])
  })

  it('cancels and releases a live reader when Stop arrives during a pending read', async () => {
    const cancel = vi.fn()
    const stop = new AbortController()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.output_text.delta","item_id":"a","delta":"hi"}\n\n',
          ),
        )
      },
      cancel,
    })
    const client = new CodecClient(
      codecDeps({ transport: deps({ fetch: () => Promise.resolve(new Response(source)) }) }),
    )
    const frames = client.streamResponse(body, stop.signal)
    await frames.next()
    const pending = frames.next()
    const rejected = expect(pending).rejects.toMatchObject({ status: 0 })
    stop.abort()
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
    expect(source.locked).toBe(false)
  })
})
