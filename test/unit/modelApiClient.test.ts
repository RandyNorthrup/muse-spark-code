import { Usd, type UsdAmount } from '../../src/shared/usd'
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'
import {
  MissingApiKeyError,
  ModelApiClient,
  ModelApiError,
  type ModelApiClientDeps,
  type RetryNotice,
  retryAfterMs,
  type ResponseAttemptGuard,
} from '../../src/core/backends/modelapi/client'
import {
  ModelApiPacing,
  metaPacingLimits,
  type RequestPacer,
} from '../../src/core/backends/modelapi/pacing'
import {
  type CreateResponseBody,
  type StreamEvent,
  errorBodySchema,
} from '../../src/core/backends/modelapi/schemas'
import {
  MODEL_API_MAX_RETRIES,
  MODEL_API_STREAM_IDLE_MS,
  PACING_ADMISSION_TIMEOUT_MS,
  PACING_WINDOW_MS,
  PROVIDER_HTTP_BODY_MAX_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, streamFor } from './helpers/fakeModelApi'
import { readRateCaptures } from './helpers/modelApiRateCapture'

it('parses the captured U9 strict-schema 400 without retrying or inferring a missing code (M106)', async () => {
  const capture = z
    .object({ status: z.literal(400), response: errorBodySchema })
    .parse(
      JSON.parse(
        readFileSync(new URL('../fixtures/m106/u9-strict-refusal.json', import.meta.url), 'utf8'),
      ),
    )
  const attempts = vi.fn(() =>
    Promise.resolve(Response.json(capture.response, { status: capture.status })),
  )
  const { client, sleeps } = setup(undefined, attempts)
  const events = Array.fromAsync(client.streamResponse(body, new AbortController().signal))
  await expect(events).rejects.toBeInstanceOf(ModelApiError)
  await expect(events).rejects.toMatchObject({
    status: 400,
    message: "'additionalProperties' is required to be supplied and to be false.",
    kind: 'invalid_request_error',
    code: undefined,
  })
  expect(attempts).toHaveBeenCalledTimes(1)
  expect(sleeps).toEqual([])
})

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
  overrides: Partial<ModelApiClientDeps> = {},
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
    ...overrides,
  })
  return { api, client, sleeps, log }
}

function observedPacer(): RequestPacer {
  return {
    acquire: vi.fn(() => Promise.resolve()),
    snapshot: vi.fn(() => ({ requests: 0, tokens: 0 })),
    observe: vi.fn(),
  }
}

async function expectResponseFailure(client: ModelApiClient, status: number): Promise<void> {
  await expect(
    collect(client.streamResponse(body, new AbortController().signal)),
  ).rejects.toMatchObject({ status })
}

/** A partial wire body whose teardown also works when a deliberately broken guard hangs. */
function heldResponse(text: string, status = 200) {
  let source: ReadableStreamDefaultController<Uint8Array> | undefined
  const cancel = vi.fn(() => {
    source = undefined
  })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller
      controller.enqueue(new TextEncoder().encode(text))
    },
    cancel,
  })
  return {
    response: new Response(stream, { status }),
    cancel,
    close: () => {
      source?.close()
      source = undefined
    },
  }
}

async function recordOutcome(work: Promise<unknown>, outcomes: unknown[]): Promise<void> {
  try {
    outcomes.push(await work)
  } catch (error: unknown) {
    outcomes.push(error)
  }
}

describe('M106 response read deadlines', () => {
  it.each([401, 504])(
    'times out a stalled HTTP %i error body at the repository idle deadline',
    async (status) => {
      vi.useFakeTimers()
      const stop = new AbortController()
      const wire = heldResponse('{"error":', status)
      try {
        let requestSignal: AbortSignal | undefined
        const fetch = vi.fn(
          (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
            requestSignal = init?.signal ?? undefined
            return Promise.resolve(wire.response)
          },
        )
        const t = setup(undefined, fetch)
        const outcomes: unknown[] = []
        const pending = recordOutcome(collect(t.client.streamResponse(body, stop.signal)), outcomes)
        await vi.advanceTimersByTimeAsync(MODEL_API_STREAM_IDLE_MS)
        expect(outcomes).toHaveLength(1)
        expect(outcomes[0]).toMatchObject({
          name: 'ModelApiError',
          status: 0,
          message: expect.stringContaining('sent nothing for 300 s'),
        })
        expect(requestSignal?.aborted).toBe(true)
        expect(wire.cancel).toHaveBeenCalledOnce()
        expect(fetch).toHaveBeenCalledOnce()
        expect(t.sleeps).toEqual([])
        await pending
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        stop.abort()
        wire.close()
        vi.useRealTimers()
      }
    },
  )

  it('stops a stalled error-body read immediately even when the transport ignores abort', async () => {
    vi.useFakeTimers()
    const stop = new AbortController()
    const wire = heldResponse('{"error":', 504)
    try {
      const t = setup(undefined, () => Promise.resolve(wire.response))
      const outcomes: unknown[] = []
      const pending = recordOutcome(collect(t.client.streamResponse(body, stop.signal)), outcomes)
      await vi.advanceTimersByTimeAsync(0)
      stop.abort()
      await vi.advanceTimersByTimeAsync(0)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]).toMatchObject({ status: 0, message: 'cancelled' })
      await pending
      expect(wire.cancel).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      wire.close()
      vi.useRealTimers()
    }
  })

  const image = {
    model: 'muse-image-1.0',
    prompt: 'a cat',
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
    output_format: 'png',
  } as const
  const { stream: _stream, ...countable } = body
  it.each([
    { path: 'models', read: (client: ModelApiClient) => client.listModels() },
    { path: 'input_tokens', read: (client: ModelApiClient) => client.countInputTokens(countable) },
    {
      path: 'images/generations',
      read: (client: ModelApiClient) => client.createImage(image, new AbortController().signal),
    },
    {
      path: 'images/edits',
      read: (client: ModelApiClient) =>
        client.editImage({ ...image, images: [] }, new AbortController().signal),
    },
    { path: 'status', read: (client: ModelApiClient) => client.readServiceStatus() },
  ])('bounds a stalled successful JSON read on $path', async ({ path, read }) => {
    vi.useFakeTimers()
    const wire = heldResponse('{')
    try {
      let requestSignal: AbortSignal | undefined
      const t = setup(
        undefined,
        (_input, init) => {
          requestSignal = init?.signal ?? undefined
          return Promise.resolve(wire.response)
        },
        50,
      )
      const outcomes: unknown[] = []
      const pending = recordOutcome(read(t.client), outcomes)
      await vi.advanceTimersByTimeAsync(50)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]).toMatchObject({
        name: 'ModelApiError',
        message:
          path === 'status'
            ? UI_TEXT.modelApiStatusUnavailable
            : expect.stringContaining('sent nothing'),
      })
      expect(requestSignal?.aborted).toBe(true)
      expect(wire.cancel).toHaveBeenCalledOnce()
      await pending
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      wire.close()
      vi.useRealTimers()
    }
  })

  it('cancels a rejected public status body without reading provider prose', async () => {
    const wire = heldResponse('{"error":', 504)
    try {
      const t = setup(undefined, () => Promise.resolve(wire.response))
      await expect(t.client.readServiceStatus()).rejects.toMatchObject({
        status: 504,
        message: UI_TEXT.modelApiStatusUnavailable,
      })
      expect(wire.cancel).toHaveBeenCalledOnce()
    } finally {
      wire.close()
    }
  })

  it('keeps successful SSE events unchanged while chunks arrive within each idle deadline', async () => {
    vi.useFakeTimers()
    try {
      const text = streamFor({ text: 'complete', reasoning: 'think', doneSentinel: true }, 'fixed')
      const baseline = setup(undefined, () => Promise.resolve(new Response(text)))
      const expected = await collect(
        baseline.client.streamResponse(body, new AbortController().signal),
      )
      const bytes = new TextEncoder().encode(text)
      let offset = 0
      const chunkSize = Math.ceil(bytes.length / 3)
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 40))
            controller.enqueue(bytes.subarray(offset, offset + chunkSize))
            offset += chunkSize
            if (offset >= bytes.length) controller.close()
          },
        },
        { highWaterMark: 0 },
      )
      const t = setup(undefined, () => Promise.resolve(new Response(stream)), 50)
      const pending = collect(t.client.streamResponse(body, new AbortController().signal))
      await vi.advanceTimersByTimeAsync(120)
      await expect(pending).resolves.toEqual(expected)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives each retry fresh network deadlines without timing the retry pause', async () => {
    vi.useFakeTimers()
    try {
      const api = fakeModelApi()
      api.script({ httpError: { status: 504 } }, { text: 'complete' })
      const t = setup(
        undefined,
        async (input, init) => {
          await new Promise((resolve) => setTimeout(resolve, 40))
          return await api.fetch(input, init)
        },
        50,
        { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random: () => 0 },
      )
      const pending = collect(t.client.streamResponse(body, new AbortController().signal))
      await vi.advanceTimersByTimeAsync(1080)
      const events = await pending
      expect(events.at(-1)?.type).toBe('response.completed')
      expect(api.responseBodies()).toHaveLength(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M106 client pacing and retry boundaries', () => {
  it('dispatches six one-RPM background requests after admission without starting provider idle timing in the queue', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const api = fakeModelApi()
      let isInitial = true
      const t = setup(undefined, undefined, undefined, {
        now: Date.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        fetch: async (input, init) => {
          const response = await api.fetch(input, init)
          if (!isInitial) return response
          isInitial = false
          return new Response(response.body, {
            headers: {
              'x-ratelimit-limit-requests': '1',
              'x-ratelimit-remaining-requests': '0',
              'x-ratelimit-limit-tokens': '3000000',
              'x-ratelimit-remaining-tokens': '3000000',
            },
          })
        },
      })
      await collect(t.client.streamResponse(body, new AbortController().signal))
      const notices: RetryNotice[] = []
      const guard = Object.assign(() => undefined, { pacingClass: 'team' as const })
      const pending = Promise.all(
        Array.from({ length: 6 }, () =>
          collect(
            t.client.streamResponse(
              body,
              new AbortController().signal,
              (notice) => {
                notices.push(notice)
              },
              undefined,
              guard,
            ),
          ),
        ),
      )
      const outcome = (async () => {
        try {
          return { results: await pending, error: undefined }
        } catch (error: unknown) {
          return { results: undefined, error }
        }
      })()
      await vi.advanceTimersByTimeAsync(6 * PACING_WINDOW_MS)
      const settled = await outcome
      expect(settled.error).toBeUndefined()
      expect(settled.results).toHaveLength(6)
      expect(api.responseBodies()).toHaveLength(7)
      expect(notices.length).toBeGreaterThan(0)
      expect(notices.every((notice) => notice.reason === UI_TEXT.modelApiPacingWaiting)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts the provider idle deadline at dispatch when response headers never arrive', async () => {
    vi.useFakeTimers()
    try {
      const dispatched = Promise.withResolvers<undefined>()
      let requestSignal: AbortSignal | undefined
      const t = setup(
        undefined,
        (_input, init) => {
          requestSignal = init?.signal ?? undefined
          dispatched.resolve(undefined)
          return new Promise<Response>(() => undefined)
        },
        50,
      )
      const outcome = (async () => {
        try {
          await collect(t.client.streamResponse(body, new AbortController().signal))
          return undefined
        } catch (error: unknown) {
          return error
        }
      })()
      await dispatched.promise
      await vi.advanceTimersByTimeAsync(50)
      expect(await outcome).toMatchObject({
        status: 0,
        message: expect.stringContaining('sent nothing'),
      })
      expect(requestSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds local admission with an honest rate-limit failure and cancels its queued work', async () => {
    vi.useFakeTimers()
    try {
      let queuedSignal: AbortSignal | undefined
      const pacing: RequestPacer = {
        acquire: (_account, _kind, _tokens, signal) => {
          queuedSignal = signal
          return new Promise<void>(() => undefined)
        },
        snapshot: () => ({ requests: 0, tokens: 0 }),
        observe: vi.fn(),
      }
      const t = setup(undefined, undefined, undefined, { pacing })
      const pending = expect(
        collect(t.client.streamResponse(body, new AbortController().signal)),
      ).rejects.toThrow(UI_TEXT.modelApiPacingExpired)
      await vi.advanceTimersByTimeAsync(PACING_ADMISSION_TIMEOUT_MS)
      await pending
      expect(queuedSignal?.aborted).toBe(true)
      expect(t.api.responseBodies()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows a foreground request immediately after a background burst without exhausting provider tokens', async () => {
    let remaining = 300
    const api = fakeModelApi()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      // This fake provider charges the same conservative estimate as the actual client.
      const requestBody = init?.body
      if (typeof requestBody !== 'string') throw new Error('Expected serialized request')
      const request = z
        .object({
          input: z.unknown(),
          instructions: z.unknown(),
          tools: z.unknown(),
          max_output_tokens: z.number(),
        })
        .parse(JSON.parse(requestBody))
      const cost =
        new TextEncoder().encode(
          JSON.stringify([request.input, request.instructions, request.tools]),
        ).length + request.max_output_tokens
      if (cost > remaining)
        return Response.json({ error: { message: 'token quota' } }, { status: 429 })
      remaining -= cost
      return await api.fetch(input, init)
    })
    const pacing = new ModelApiPacing({
      now: () => NOW,
      wait: () => {
        throw new Error('Foreground waited')
      },
    })
    const t = setup(undefined, fetch, undefined, { pacing })
    pacing.observe(`meta:https://api.example.test/v1:${await t.client.currentKeyDigest()}`, {
      requests: 10,
      remainingRequests: 10,
      tokens: 300,
      remainingTokens: 300,
    })
    const small = { ...body, input: [], instructions: '', max_output_tokens: 60 }
    const guard = Object.assign(() => undefined, { pacingClass: 'team' as const })
    await collect(
      t.client.streamResponse(small, new AbortController().signal, undefined, undefined, guard),
    )
    await collect(
      t.client.streamResponse(small, new AbortController().signal, undefined, undefined, guard),
    )
    // Another background admission would invade the reserved half of the window.
    await expect(
      collect(
        t.client.streamResponse(small, new AbortController().signal, undefined, undefined, guard),
      ),
    ).rejects.toThrow('Foreground waited')
    await collect(
      t.client.streamResponse({ ...small, max_output_tokens: 140 }, new AbortController().signal),
    )
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(t.sleeps).toEqual([])
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  it('scrubs service-status failures to fixed fields without provider marker, account or token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              message: 'PRIVATE_STATUS_MARKER',
              type: 'account-private-42',
              code: 'synthetic-token-private',
            },
          },
          { status: 504, headers: { 'retry-after': '8' } },
        ),
      ),
    )
    const t = setup(null, fetch)
    let failure: unknown
    try {
      await t.client.readServiceStatus()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toMatchObject({
      message: UI_TEXT.modelApiStatusUnavailable,
      status: 504,
      kind: 'service_status',
      code: undefined,
      retryAfterMs: 8000,
    })
    const text =
      failure instanceof Error
        ? `${failure.message}${failure.stack ?? ''}${JSON.stringify(failure)}`
        : JSON.stringify(failure)
    for (const privateValue of [
      'PRIVATE_STATUS_MARKER',
      'account-private-42',
      'synthetic-token-private',
    ])
      expect(text).not.toContain(privateValue)
  })

  it('Stop promptly ends an actual bucket wait before any request is dispatched', async () => {
    const joined = Promise.withResolvers<undefined>()
    const sleep = vi.fn(() => {
      joined.resolve(undefined)
      return new Promise<void>(() => undefined)
    })
    const pacing = new ModelApiPacing({
      now: () => NOW,
      wait: (ms, signal) => t.client.waitBeforeRetry(ms, signal),
    })
    const t = setup(undefined, undefined, undefined, { pacing, sleep })
    const account = `meta:https://api.example.test/v1:${await t.client.currentKeyDigest()}`
    pacing.observe(account, {
      requests: 150,
      remainingRequests: 0,
      tokens: 3_000_000,
      remainingTokens: 3_000_000,
    })
    const guard = Object.assign(vi.fn(), { paidFeature: 'subagents' as const })
    const stop = new AbortController()
    const pending = collect(t.client.streamResponse(body, stop.signal, undefined, undefined, guard))
    await joined.promise
    stop.abort()
    await expect(pending).rejects.toMatchObject({ status: 0 })
    expect(guard).not.toHaveBeenCalled()
    expect(t.api.responseBodies()).toEqual([])
  })

  it('reads the captured public status without retrieving or transmitting a credential', async () => {
    const capture = z
      .object({ responses: z.array(z.object({ response: z.unknown() })) })
      .parse(
        JSON.parse(readFileSync(new URL('../fixtures/m106/status.json', import.meta.url), 'utf8')),
      )
    const apiKey = vi.fn(() => Promise.resolve(undefined))
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(capture.responses[0]?.response)),
    )
    const t = setup(null, fetch, undefined, { apiKey })
    expect(await t.client.readServiceStatus()).toEqual(capture.responses[0]?.response)
    expect(apiKey).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('https://api.meta.ai/v1/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    })
  })

  it('refuses a malformed status envelope and an uncaptured provider status endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ service_status: 'operational' })),
    )
    const t = setup(null, fetch)
    await expect(t.client.readServiceStatus()).rejects.toThrow()
    const other = setup(null, fetch, undefined, {
      pacingProvider: () => ({ identity: { provider: 'openai' } }),
    })
    await expect(other.client.readServiceStatus()).rejects.toThrow(
      UI_TEXT.modelApiStatusUnavailable,
    )
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('refuses an oversized streamed status body at the cap without buffering it all', async () => {
    const chunkBytes = 1_048_576
    const offeredBytes = PROVIDER_HTTP_BODY_MAX_BYTES * 4
    let pulledBytes = 0
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulledBytes >= offeredBytes) {
            controller.close()
            return
          }
          pulledBytes += chunkBytes
          // JSON whitespace: only the size, never the syntax, can refuse it.
          controller.enqueue(new Uint8Array(chunkBytes).fill(0x20))
        },
        cancel,
      },
      { highWaterMark: 0 },
    )
    const t = setup(null, () => Promise.resolve(new Response(stream)))
    await expect(t.client.readServiceStatus()).rejects.toMatchObject({
      name: 'ModelApiError',
      message: UI_TEXT.modelApiStatusUnavailable,
      kind: 'service_status',
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(pulledBytes).toBeGreaterThan(PROVIDER_HTTP_BODY_MAX_BYTES)
    expect(pulledBytes).toBeLessThanOrEqual(PROVIDER_HTTP_BODY_MAX_BYTES + 2 * chunkBytes)
  })

  it('taps captured headers before reading streamed and token-count bodies', async () => {
    const captures = readRateCaptures()
    const api = fakeModelApi()
    let index = 0
    const pacing = new ModelApiPacing({ now: () => NOW, wait: () => Promise.resolve() })
    const seen: Headers[] = []
    const wire: unknown[] = []
    const selectedModels: (string | undefined)[] = []
    const t = setup(undefined, undefined, undefined, {
      pacing,
      pacingProvider: (modelId) => {
        selectedModels.push(modelId)
        return {
          identity: { provider: 'meta' },
          readLimits: (headers) => {
            seen.push(headers)
            return metaPacingLimits(headers)
          },
        }
      },
      fetch: async (input, init) => {
        wire.push(init?.body)
        const response = await api.fetch(input, init)
        const headers = captures[index]?.headers
        index += 1
        return new Response(response.body, {
          status: response.status,
          ...(headers !== undefined && { headers }),
        })
      },
    })
    await collect(t.client.streamResponse(body, new AbortController().signal))
    await t.client.countInputTokens(body)
    expect(seen).toHaveLength(2)
    expect(selectedModels).toEqual([body.model, body.model])
    expect(
      pacing.headroom(`meta:https://api.example.test/v1:${await t.client.currentKeyDigest()}`),
    ).toMatchObject({
      requests: 150,
      remainingRequests: 143,
      tokens: 3_000_000,
      remainingTokens: 2_993_903,
    })
    expect(api.responseBodies()).toEqual([body])
    expect(wire[0]).toBe(JSON.stringify(body))
  })

  it('leaves uncaptured vendors uninterpreted and lets their retry capability refuse 504', async () => {
    const pacing = observedPacer()
    const t = setup(undefined, undefined, undefined, {
      pacing,
      pacingProvider: () => ({ identity: { provider: 'custom' } }),
      isRetryableFailure: () => false,
    })
    t.api.script({ httpError: { status: 504 } })
    await expectResponseFailure(t.client, 504)
    expect(pacing.observe).toHaveBeenCalledWith(
      expect.stringContaining('custom:'),
      undefined,
      undefined,
      { requests: 0, tokens: 0 },
    )
    expect(t.api.responseBodies()).toHaveLength(1)
  })

  it.each([
    ['subagents', 'subagent'],
    ['bestOfN', 'bestOfN'],
    ['scheduledPrompts', 'schedule'],
    ['judge', 'judge'],
  ] as const)(
    'paces every %s request using its existing admission tag',
    async (paidFeature, kind) => {
      const pacing = observedPacer()
      const t = setup(undefined, undefined, undefined, { pacing })
      const guard = Object.assign(vi.fn(), { paidFeature, paidEstimatedInputTokens: 25 })
      await collect(
        t.client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
      )
      expect(pacing.acquire).toHaveBeenCalledWith(
        expect.any(String),
        kind,
        125,
        expect.any(AbortSignal),
        expect.any(Function),
      )
      expect(guard).toHaveBeenCalledOnce()
    },
  )

  it.each(['stop', 'key', 'consent'])(
    'rechecks %s after pacing without admitting a stale request',
    async (change) => {
      const waiting = Promise.withResolvers<undefined>()
      const joined = Promise.withResolvers<undefined>()
      const pacing: RequestPacer = {
        acquire: () => {
          joined.resolve(undefined)
          return waiting.promise
        },
        snapshot: () => ({ requests: 0, tokens: 0 }),
        observe: vi.fn(),
      }
      let key = 'LLM|1|secret'
      let isAllowed = true
      const guard: ResponseAttemptGuard = Object.assign(
        () => {
          if (!isAllowed) throw new Error('consent changed')
        },
        { pacingClass: 'team' as const },
      )
      const started = vi.fn()
      const t = setup(undefined, undefined, undefined, {
        pacing,
        apiKey: () => Promise.resolve(key),
      })
      const stop = new AbortController()
      const pending = collect(
        t.client.streamResponse(
          body,
          stop.signal,
          undefined,
          undefined,
          Object.assign(guard, { onRequestStarted: started }),
        ),
      )
      await joined.promise
      switch (change) {
        case 'stop': {
          stop.abort()
          break
        }
        case 'key': {
          key = 'LLM|1|changed'
          break
        }
        case 'consent': {
          isAllowed = false
          break
        }
      }
      waiting.resolve(undefined)
      await expect(pending).rejects.toThrow()
      expect(started).not.toHaveBeenCalled()
      expect(t.api.responseBodies()).toEqual([])
    },
  )

  it('sends a foreground request while a fan-out request remains queued', async () => {
    const waiting = Promise.withResolvers<undefined>()
    const joined = Promise.withResolvers<undefined>()
    const pacing: RequestPacer = {
      acquire: (_account, kind) => {
        if (kind === 'foreground') return Promise.resolve()
        joined.resolve(undefined)
        return waiting.promise
      },
      snapshot: () => ({ requests: 0, tokens: 0 }),
      observe: vi.fn(),
    }
    const t = setup(undefined, undefined, undefined, { pacing })
    const guard = Object.assign(() => undefined, { paidFeature: 'subagents' as const })
    const child = collect(
      t.client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
    )
    await joined.promise
    await collect(t.client.streamResponse(body, new AbortController().signal))
    expect(t.api.responseBodies()).toHaveLength(1)
    waiting.resolve(undefined)
    await child
    expect(t.api.responseBodies()).toEqual([body, body])
  })

  it('pauses the shared fan-out bucket on 429 even when no retry remains', async () => {
    const pacing = observedPacer()
    const t = setup(undefined, undefined, undefined, { pacing })
    t.api.script({ httpError: { status: 429, retryAfter: '8' } })
    await expect(
      collect(
        t.client.streamResponse(body, new AbortController().signal, undefined, {
          retriesUsed: MODEL_API_MAX_RETRIES,
        }),
      ),
    ).rejects.toMatchObject({ status: 429 })
    expect(pacing.observe).toHaveBeenCalledWith(expect.any(String), undefined, 8000, {
      requests: 0,
      tokens: 0,
    })
  })

  it('retries 504 with jitter, fresh admission and budget re-reservation before the next fetch', async () => {
    const t = setup()
    t.api.script({ httpError: { status: 504 } }, { text: 'complete' })
    const sequence: string[] = []
    const guard = Object.assign(
      () => {
        sequence.push('admit')
      },
      {
        onRequestStarted: () => {
          sequence.push('fetch')
        },
        prepareRetry: () => {
          sequence.push('reserve')
          return Promise.resolve()
        },
      },
    )
    const retries = { retriesUsed: 0 }
    await collect(
      t.client.streamResponse(body, new AbortController().signal, undefined, retries, guard),
    )
    expect(sequence).toEqual(['admit', 'fetch', 'reserve', 'admit', 'fetch'])
    expect(retries.retriesUsed).toBe(1)
    expect(t.sleeps).toEqual([1500])
    expect(t.api.responseBodies()).toEqual([body, body])
  })

  it('bounds 504 retries and exposes only a status code and the public health link', async () => {
    const onServiceFailure = vi.fn()
    const t = setup(undefined, undefined, undefined, { onServiceFailure })
    t.api.script({ httpError: { status: 504 } })
    await expectResponseFailure(t.client, 504)
    expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_RETRIES + 1)
    expect(onServiceFailure).toHaveBeenCalledWith(504, 'https://api.meta.ai/v1/status')
    expect(t.sleeps).toHaveLength(MODEL_API_MAX_RETRIES)
  })

  it('never retries an ambiguously billed paid 504 or releases its retained liability', async () => {
    const claim = paidClaimFixture()
    const t = setup(undefined, undefined, undefined, {
      reservePaidRequest: () => Promise.resolve(claim),
    })
    t.api.script({ httpError: { status: 504 } })
    const guard = Object.assign(() => undefined, { paidFeature: 'subagents' as const })
    await expect(
      collect(
        t.client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
      ),
    ).rejects.toMatchObject({ status: 504 })
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(t.sleeps).toEqual([])
    expect(claim.settle).not.toHaveBeenCalled()
  })

  it('refuses the next fetch when 504 re-reservation fails', async () => {
    const t = setup()
    t.api.script({ httpError: { status: 504 } }, { text: 'unaffordable' })
    const guard = Object.assign(() => undefined, {
      prepareRetry: () => Promise.reject(new Error('budget cannot reserve again')),
    })
    await expect(
      collect(
        t.client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
      ),
    ).rejects.toThrow('budget cannot reserve again')
    expect(t.api.responseBodies()).toHaveLength(1)
  })
})

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

/** The scripted failures, then success: the stream completes after exactly `expectedSleeps`. */
async function streamRetryThenSucceed(
  client: ModelApiClient,
  sleeps: number[],
  expectedSleeps: readonly number[],
): Promise<void> {
  const events = await collect(client.streamResponse(body, new AbortController().signal))
  expect(events.at(-1)?.type).toBe('response.completed')
  expect(sleeps).toEqual(expectedSleeps)
}
describe('Meta transport regression boundaries', () => {
  it.each([400, 429, 500])(
    'preserves merged paid admission and refusal settlement on HTTP %s',
    async (status) => {
      for (const isImage of [true, false]) {
        const claim = paidClaimFixture()
        const reserve = vi.fn(() => Promise.resolve(claim))
        const fetch = vi.fn(() =>
          Promise.resolve(Response.json({ error: { message: 'fixture refusal' } }, { status })),
        )
        const { client } = setup('plain', fetch, undefined, { reservePaidRequest: reserve })
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
                { ...body, max_tool_calls: 1, tools: [{ type: 'web_search' }] },
                new AbortController().signal,
              ),
            )
        await expect(run).rejects.toMatchObject({ status })
        expect(client.hasPaidDailyBudget).toBe(true)
        expect(reserve).toHaveBeenCalledOnce()
        expect(claim.check).toHaveBeenCalledTimes(fetch.mock.calls.length)
        if (status === 500) {
          expect(fetch).toHaveBeenCalledOnce()
          if (isImage) expect(claim.settle).not.toHaveBeenCalled()
          else expect(claim.settle).toHaveBeenCalledWith(claim.reservedUsd, true)
        } else {
          expect(claim.settle).toHaveBeenCalledWith(Usd.from(0).toAmount())
        }
      }
    },
  )

  it('settles merged paid stream usage after canonical parsing', async () => {
    const claim = paidClaimFixture()
    const reserve = vi.fn(() => Promise.resolve(claim))
    const wire =
      'data: {"type":"response.completed","response":{"id":"r","status":"completed","output":[],"usage":{"input_tokens":100,"output_tokens":100}}}\n\n'
    const { client } = setup('plain', () => Promise.resolve(new Response(wire)), undefined, {
      reservePaidRequest: reserve,
    })
    const paidBody: CreateResponseBody = {
      ...body,
      max_tool_calls: 1,
      tools: [{ type: 'web_search' }],
    }
    await collect(client.streamResponse(paidBody, new AbortController().signal))
    expect(reserve).toHaveBeenCalledWith(
      paidBody,
      'webSearch',
      undefined,
      expect.any(AbortSignal),
      expect.any(String),
    )
    expect(claim.settle).toHaveBeenCalledOnce()
    expect(Number(claim.settle.mock.calls[0]?.[0])).toBeGreaterThan(0)
    expect(Number(claim.settle.mock.calls[0]?.[0])).toBeLessThan(Number(claim.reservedUsd))
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

  it('aborts a token recount with its owning turn signal', async () => {
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<Response>()
    let requestSignal: AbortSignal | null | undefined
    const { client } = setup('LLM|1|secret', (_url, init) => {
      requestSignal = init?.signal
      entered.resolve(undefined)
      requestSignal?.addEventListener(
        'abort',
        () => {
          held.reject(new Error('cancelled'))
        },
        {
          once: true,
        },
      )
      return held.promise
    })
    const stop = new AbortController()
    const { stream: _stream, ...countable } = body
    const counted = client.countInputTokens(countable, stop.signal)
    const result = expect(counted).rejects.toMatchObject({ message: 'cancelled' })
    try {
      await entered.promise
      stop.abort()
      expect(requestSignal?.aborted).toBe(true)
    } finally {
      held.reject(new Error('cancelled'))
      await result
    }
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
    // Retry-After 2 s + 500 ms jitter, then 2 s + jitter and 4 s + jitter of backoff.
    await streamRetryThenSucceed(client, sleeps, [2500, 2500, 4500])
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

  it('never retries quota errors, whatever the status (M101 BYO 5)', async () => {
    const { api, client, sleeps } = setup()
    api.script({
      httpError: {
        status: 429,
        body: {
          error: {
            message: 'You exceeded your current quota, please check your plan and billing details.',
            type: 'rate_limit_error',
            code: 'insufficient_quota',
          },
        },
      },
    })
    await expect(
      collect(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toMatchObject({
      name: 'ModelApiError',
      status: 429,
      code: 'insufficient_quota',
    })
    expect(api.requests.filter((request) => request.path === '/responses')).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('fails at once on a Retry-After past the cap, naming the wait (M101 BYO 5)', async () => {
    const { api, client, sleeps } = setup()
    api.script({
      httpError: {
        status: 429,
        retryAfter: '120',
        body: { error: { message: 'slow down', type: 'rate_limit_error' } },
      },
    })
    await expect(
      collect(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow('wait 120 s before retrying, past the 60 s limit')
    expect(api.requests.filter((request) => request.path === '/responses')).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('still retries at exactly the Retry-After cap (M101 BYO 5)', async () => {
    const { api, client, sleeps } = setup()
    api.script(
      {
        httpError: {
          status: 429,
          retryAfter: '60',
          body: { error: { message: 'slow down', type: 'rate_limit_error' } },
        },
      },
      { text: 'finally' },
    )
    await streamRetryThenSucceed(client, sleeps, [60_000])
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

it('shares admission across clients created for the same window/runtime owner', async () => {
  const owner = {}
  const pacing = observedPacer()
  const foreground = setup(undefined, undefined, undefined, { pacingOwner: owner, pacing })
  const attempt = setup(undefined, undefined, undefined, { pacingOwner: owner })
  foreground.api.script({ text: 'foreground' })
  attempt.api.script({ text: 'attempt' })
  await Array.fromAsync(foreground.client.streamResponse(body, new AbortController().signal))
  await Array.fromAsync(attempt.client.streamResponse(body, new AbortController().signal))
  expect(pacing.acquire).toHaveBeenCalledTimes(2)
  expect(pacing.snapshot).toHaveBeenCalledTimes(2)
  expect(foreground.api.responseBodies()).toHaveLength(1)
  expect(attempt.api.responseBodies()).toHaveLength(1)
})

it('retains the original final HTTP failure when the status observer throws', async () => {
  const t = setup(undefined, undefined, undefined, {
    onServiceFailure: () => {
      throw new Error('private observer detail')
    },
  })
  t.api.script(
    ...Array.from({ length: MODEL_API_MAX_RETRIES + 1 }, () => ({ httpError: { status: 503 } })),
  )
  await expect(
    Array.fromAsync(t.client.streamResponse(body, new AbortController().signal)),
  ).rejects.toMatchObject({ status: 503 })
  expect(t.log.error).toHaveBeenCalledExactlyOnceWith(
    'Backend notification listener failed: modelApi.serviceFailure',
  )
})

function paidClaimFixture() {
  const total = { spentUsd: Usd.from(1).toAmount(), hasUnknownHistoricalFees: false }
  return {
    claimId: 'fixture',
    reservedUsd: Usd.from(1).toAmount(),
    check: vi.fn(() => total),
    settle: vi.fn((_actualUsd: UsdAmount) => Promise.resolve(total)),
  }
}
