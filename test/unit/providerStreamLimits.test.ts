// An inference stream has no limit on its total time (0.17.2). From 0.15.0
// to 0.17.1 the deadline of a bounded call, MODEL_API_REQUEST_TIMEOUT_MS
// (30 s), also wrapped the whole reply stream of every configured provider
// and of the ChatGPT plan route, so any answer that took longer was lost.
//
// A stream ends when it finishes, on the caller's signal, on a budget or
// request cap, or after the idle limit of silence (headers or frames).
// The inventory below fails when that constant gains a use that nobody
// classified; the ChatGPT route's limits are exercised through its real
// client with only `fetch` faked. The configured-provider route's are in
// configuredProviders.test.ts, through a loopback server.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { providersFileSchema } from '../../src/core/providers/providersFile'
import type { ChatGptSignIn } from '../../src/core/providers/subscriptions/chatgpt'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import { MODEL_API_REQUEST_TIMEOUT_MS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'

afterEach(() => {
  vi.restoreAllMocks()
})

const CONSTANT = 'MODEL_API_REQUEST_TIMEOUT_MS'

/**
 * Every use of the bounded-call deadline in src, in file order, with the
 * call it bounds. A use that wraps an inference stream does not belong
 * here: remove the wrapper instead (the idle limit is the stream's own).
 */
const BOUNDED_CALLS: readonly { file: string; text: string; call: string }[] = [
  {
    file: 'src/core/backends/modelapi/client.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'the model list',
  },
  {
    file: 'src/core/backends/modelapi/client.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'the status read',
  },
  {
    file: 'src/core/backends/modelapi/client.ts',
    text: 'const deadline = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)',
    call: 'one input token count',
  },
  {
    file: 'src/core/backends/modelapi/files.ts',
    text: 'const active = AbortSignal.any([signal, AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)])',
    call: 'one file upload',
  },
  {
    file: 'src/core/backends/modelapi/files.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'one file read',
  },
  {
    file: 'src/core/backends/modelapi/files.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'the file list',
  },
  {
    file: 'src/core/backends/modelapi/files.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'one file delete',
  },
  {
    file: 'src/core/backends/modelapi/providerClient.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'a provider model list',
  },
  {
    file: 'src/core/backends/modelapi/providerClient.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'one provider input token count',
  },
  {
    file: 'src/core/providers/configured.ts',
    text: 'const signal = init.signal ?? AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)',
    call: 'a pinned request made without a signal (the transport always passes one for inference)',
  },
  {
    file: 'src/core/providers/configured.ts',
    text: 'signal = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'a native model list scan',
  },
  {
    file: 'src/core/providers/configured.ts',
    text: 'AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'the free key test',
  },
  {
    file: 'src/core/providers/subscriptions/registry.ts',
    text: 'const token = await signIn.accessToken(MODELS_URL, MODEL_API_REQUEST_TIMEOUT_MS)',
    call: 'a token exchange for the ChatGPT catalogue',
  },
  {
    file: 'src/core/providers/subscriptions/registry.ts',
    text: 'signal: AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),',
    call: 'the ChatGPT catalogue read',
  },
  {
    file: 'src/core/providers/subscriptions/registry.ts',
    text: 'const token = await signIn.accessToken(RESPONSES_URL, MODEL_API_REQUEST_TIMEOUT_MS)',
    call: 'a token exchange before a ChatGPT reply (its minimum validity, not the reply)',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    text: 'const deadline = Date.now() + MODEL_API_REQUEST_TIMEOUT_MS',
    call: 'one Copilot input token count',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    text: 'Date.now() + MODEL_API_REQUEST_TIMEOUT_MS,',
    call: 'one Copilot output token count',
  },
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`
      if (entry.isDirectory()) return sourceFiles(file)
      return /\.tsx?$/.test(entry.name) ? [file] : []
    })
}

/** The uses of the constant: every line naming it but its import and its definition. */
function usesOfTheDeadline(): { file: string; text: string }[] {
  return sourceFiles('src').flatMap((file) =>
    readFileSync(path.resolve(file), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.includes(CONSTANT) &&
          line !== `${CONSTANT},` &&
          !line.startsWith('import ') &&
          !line.startsWith(`export const ${CONSTANT}`),
      )
      .map((text) => ({ file, text })),
  )
}

describe('the bounded-call deadline never bounds an inference stream', () => {
  it('has every use classified as a bounded call', () => {
    expect(usesOfTheDeadline()).toEqual(BOUNDED_CALLS.map(({ file, text }) => ({ file, text })))
    expect(BOUNDED_CALLS.every((use) => use.call !== '')).toBe(true)
  })
})

const MODEL = 'chatgpt/gpt-6-astra'
const IDLE_MS = 600
const stalled = fill(UI_TEXT.modelApiStalled, { seconds: 1 })

const request = (): CreateResponseBody => ({
  model: MODEL,
  instructions: 'Test',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello.' }] }],
  tools: [],
  tool_choice: 'auto',
  stream: true,
  store: false,
  max_output_tokens: 64,
  reasoning: { effort: 'none' },
  include: [],
  prompt_cache_key: 'test-prefix',
  prompt_cache_retention: '24h',
})

const frame = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
const CREATED = frame({
  type: 'response.created',
  response: { id: 'resp_1', status: 'in_progress', output: [] },
})
const COMPLETED = frame({
  type: 'response.completed',
  response: {
    id: 'resp_1',
    status: 'completed',
    output: [],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
})

/** A reply whose frames arrive `gapMs` apart; it ends early when the request is aborted. */
function reply(frames: readonly Uint8Array[], gapMs: number, init: RequestInit | undefined) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0
      const next = () => {
        const bytes = frames[index]
        index += 1
        if (bytes === undefined) {
          controller.close()
          return
        }
        controller.enqueue(bytes)
        timer = setTimeout(next, gapMs)
      }
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        controller.error(new Error('aborted'))
      })
      next()
    },
    cancel() {
      clearTimeout(timer)
    },
  })
  return new Response(body, { status: 200 })
}

function chatGpt(fetcher: typeof fetch, streamIdleMs?: number) {
  const signIn = { accessToken: () => Promise.resolve('token') } as unknown as ChatGptSignIn
  return createSubscriptionClient(fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel()), {
    fetch: fetcher,
    providers: () =>
      Promise.resolve(
        providersFileSchema.parse({
          v: 1,
          providers: [
            {
              id: 'chatgpt',
              preset: 'chatgpt',
              auth: 'subscription',
              address: 'https://api.openai.com',
              format: 'responses',
              models: ['gpt-6-astra'],
            },
          ],
        }),
      ),
    chatgpt: () => Promise.resolve(signIn),
    accountId: () => Promise.resolve('account'),
    ...(streamIdleMs !== undefined && { streamIdleMs }),
  })
}

describe('ChatGPT plan stream limits', () => {
  it('lets a reply run past the bounded-call deadline', async () => {
    // The 30 s deadline is 100 ms here; the reply takes about 600 ms.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
      realTimeout(ms === MODEL_API_REQUEST_TIMEOUT_MS ? 100 : ms),
    )
    const delta = frame({ type: 'response.output_text.delta', item_id: 'item_1', delta: 'a' })
    const client = chatGpt((_url, init) =>
      Promise.resolve(reply([CREATED, delta, delta, delta, delta, delta, COMPLETED], 100, init)),
    )
    const started = Date.now()
    const events = await Array.fromAsync(
      client.streamResponse(request(), new AbortController().signal),
    )
    expect(events).toContainEqual(expect.objectContaining({ type: 'response.completed' }))
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(Date.now() - started).toBeGreaterThan(400)
  })

  it('ends a reply that goes silent at the idle limit, with the idle sentence', async () => {
    const client = chatGpt((_url, init) => Promise.resolve(reply([CREATED], 60_000, init)), IDLE_MS)
    const started = Date.now()
    const events = await Array.fromAsync(
      client.streamResponse(request(), new AbortController().signal),
    )
    expect(events.at(-1)).toEqual({ type: 'error', code: 'request-failed', message: stalled })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('ends a reply whose headers never arrive at the idle limit, with the idle sentence', async () => {
    let wasAborted = false
    const client = chatGpt(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            wasAborted = true
            reject(new Error('aborted'))
          })
        }),
      IDLE_MS,
    )
    const events = await Array.fromAsync(
      client.streamResponse(request(), new AbortController().signal),
    )
    expect(events).toEqual([{ type: 'error', code: 'request-failed', message: stalled }])
    expect(wasAborted).toBe(true)
  })

  it('ends a reply at once when the caller stops it', async () => {
    const stop = new AbortController()
    const client = chatGpt((_url, init) => Promise.resolve(reply([CREATED], 60_000, init)))
    const started = Date.now()
    setTimeout(() => {
      stop.abort()
    }, 150)
    await expect(Array.fromAsync(client.streamResponse(request(), stop.signal))).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
