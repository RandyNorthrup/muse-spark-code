// An in-process Meta Model API for unit tests: a `fetch` that answers
// `GET /models`, `POST /responses/input_tokens` and the streamed
// `POST /responses` from a script of replies, recording every request.
// Streams are real `ReadableStream` bodies in the documented SSE framing
// (dev.meta.ai/docs/protocols/responses), so the parser and the client run
// exactly as they do against the service.

import { ModelApiClient, type ModelApiClientDeps } from '../../../src/core/backends/modelapi/client'
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { CoreLogger } from '../../../src/core/logging'

export interface ScriptedCall {
  readonly name: string
  readonly arguments: string
  readonly callId?: string
}

/** One hosted web search in a reply (M33), streamed before the text. */
export interface ScriptedSearch {
  readonly queries?: readonly string[]
  readonly status?: 'completed' | 'failed'
  readonly results?: readonly {
    readonly title?: string
    readonly url: string
    readonly snippet?: string
  }[]
  /** The action instead of a search's (`open_page`, `find_in_page`). */
  readonly action?: Record<string, unknown>
  /** `output_item.done` carries only id, type and status, as Meta's guide shows it. */
  readonly isBareDone?: boolean
  /** No `output_item.done` at all: the item is only in the completed response. */
  readonly isDoneOmitted?: boolean
}

/** One model reply: streamed as reasoning + searches + text + function calls. */
export interface ScriptedReply {
  /** Hold this response while concurrent sessions run (M48 capacity tests). */
  readonly hold?: Promise<unknown>
  readonly text?: string
  readonly searches?: readonly ScriptedSearch[]
  /** The text's `url_citation` annotations (M33). */
  readonly citations?: readonly { readonly url: string; readonly title: string }[]
  /** The citations appear in the completed response only, not in the item's done event. */
  readonly areCitationsLate?: boolean
  /** The text's `phase`: `commentary` for text before a tool call. */
  readonly phase?: 'commentary'
  /** The reasoning item comes without a `summary` field at all. */
  readonly isSummaryMissing?: boolean
  readonly reasoning?: string
  readonly calls?: readonly ScriptedCall[]
  readonly usage?: { readonly input: number; readonly output: number; readonly cached?: number }
  /** Serve this HTTP failure instead of a stream (before any event). */
  readonly httpError?: {
    readonly status: number
    readonly body?: unknown
    readonly retryAfter?: string
  }
  /** Cut the stream with a terminal `error` event after the text. */
  readonly streamError?: { readonly code: string; readonly message: string }
  /** End the stream with `response.failed` instead of `response.completed`. */
  readonly failed?: { readonly code: string; readonly message: string }
  /** End with a partial response carrying usage, as the API can during compaction. */
  readonly incomplete?: { readonly reason: string }
  /** Serve frames that are not JSON. */
  readonly garbage?: boolean
  /** Fail the fetch itself (network error) instead of answering. */
  readonly networkError?: string
  /** The socket code under that error, as Node's fetch keeps it in `cause` (M56). */
  readonly networkErrorCode?: string
  /** A keep-alive with empty data mid-stream and the OpenAI-style `data: [DONE]` at the end. */
  readonly doneSentinel?: boolean
}

export interface RecordedRequest {
  readonly path: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

/** A 1×1 PNG, as `b64_json`. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** One answer of `POST /images/generations` (M34). */
export interface ScriptedImage {
  /** The image, base64; a 1×1 PNG when absent. */
  readonly b64?: string
  readonly revisedPrompt?: string
  /** No image in `data` at all. */
  readonly isEmpty?: boolean
  readonly httpError?: { readonly status: number; readonly message: string }
  /** The connection fails before any answer (the request may have been done). */
  readonly networkError?: string
}

export interface FakeModelApi {
  readonly fetch: typeof fetch
  readonly requests: RecordedRequest[]
  /** Replies are consumed in order; the last one repeats when exhausted. */
  script(...replies: readonly ScriptedReply[]): void
  models: string[]
  inputTokens: number
  /** The bodies of every `POST /responses` seen, parsed. */
  readonly responseBodies: () => readonly Record<string, unknown>[]
  /** Answers for `POST /images/generations` and `/images/edits`, in order; a PNG once they run out. */
  readonly images: ScriptedImage[]
  /** The bodies of every `POST /images/generations` seen, parsed. */
  readonly imageBodies: () => readonly Record<string, unknown>[]
  /** The bodies of every `POST /images/edits` seen, parsed (M44). */
  readonly editBodies: () => readonly Record<string, unknown>[]
}

const encoder = new TextEncoder()

function frame(event: Record<string, unknown>): string {
  return `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`
}

const ids = { counter: 0 }
function nextId(prefix: string): string {
  ids.counter += 1
  return `${prefix}_${String(ids.counter)}`
}

/** The SSE text for one scripted reply, in the documented event order. */
export function streamFor(reply: ScriptedReply, responseId: string): string {
  const output: Record<string, unknown>[] = []
  let text = frame({
    type: 'response.created',
    response: { id: responseId, status: 'in_progress', output: [] },
  })
  let index = 0
  if (reply.reasoning !== undefined) {
    const id = nextId('rs')
    const item = { type: 'reasoning', id, summary: [], status: 'in_progress' }
    text += frame({ type: 'response.output_item.added', output_index: index, item })
    const reasoningPieces = reply.reasoning.match(/.{1,6}/g) ?? []
    for (const piece of reasoningPieces) {
      text += frame({
        type: 'response.reasoning_summary_text.delta',
        item_id: id,
        summary_index: 0,
        delta: piece,
      })
    }
    const done = {
      type: 'reasoning',
      id,
      ...(reply.isSummaryMissing !== true && {
        summary: [{ type: 'summary_text', text: reply.reasoning }],
      }),
      encrypted_content: `enc:${id}`,
      status: 'completed',
    }
    text += frame({ type: 'response.output_item.done', output_index: index, item: done })
    output.push(done)
    index += 1
  }
  const searches = reply.searches ?? []
  for (const search of searches) {
    const id = nextId('ws')
    text += frame({
      type: 'response.output_item.added',
      output_index: index,
      item: { type: 'web_search_call', id, status: 'in_progress' },
    })
    text += frame({ type: 'response.web_search_call.searching', output_index: index, item_id: id })
    const status = search.status ?? 'completed'
    const full = {
      type: 'web_search_call',
      id,
      status,
      action: search.action ?? { type: 'search', queries: search.queries ?? ['query'] },
      results: (search.results ?? []).map((result) => ({ type: 'text_result', ...result })),
    }
    if (search.isDoneOmitted !== true) {
      text += frame({
        type: 'response.output_item.done',
        output_index: index,
        item: search.isBareDone === true ? { type: 'web_search_call', id, status } : full,
      })
    }
    output.push(full)
    index += 1
  }
  if (reply.text !== undefined) {
    const id = nextId('msg')
    text += frame({
      type: 'response.output_item.added',
      output_index: index,
      item: { type: 'message', id, role: 'assistant', content: [], status: 'in_progress' },
    })
    const textPieces = reply.text.match(/.{1,5}/g) ?? []
    for (const piece of textPieces) {
      text += frame({ type: 'response.output_text.delta', item_id: id, delta: piece })
    }
    if (reply.streamError !== undefined) {
      text += frame({
        type: 'error',
        code: reply.streamError.code,
        message: reply.streamError.message,
      })
      return text
    }
    const annotations = (reply.citations ?? []).map((citation) => ({
      type: 'url_citation',
      url: citation.url,
      title: citation.title,
      start_index: 0,
      end_index: reply.text?.length ?? 0,
    }))
    const messageWith = (cited: readonly unknown[]) => ({
      type: 'message',
      id,
      role: 'assistant',
      ...(reply.phase !== undefined && { phase: reply.phase }),
      content: [{ type: 'output_text', text: reply.text, annotations: cited }],
      status: 'completed',
    })
    const done = messageWith(reply.areCitationsLate === true ? [] : annotations)
    text += frame({ type: 'response.output_item.done', output_index: index, item: done })
    output.push(messageWith(annotations))
    index += 1
  }
  const calls = reply.calls ?? []
  for (const call of calls) {
    const id = nextId('fc')
    const callId = call.callId ?? nextId('call')
    text += frame({
      type: 'response.output_item.added',
      output_index: index,
      item: {
        type: 'function_call',
        id,
        call_id: callId,
        name: call.name,
        arguments: '',
        status: 'in_progress',
      },
    })
    text += frame({
      type: 'response.function_call_arguments.delta',
      item_id: id,
      delta: call.arguments,
    })
    text += frame({
      type: 'response.function_call_arguments.done',
      item_id: id,
      arguments: call.arguments,
    })
    const done = {
      type: 'function_call',
      id,
      call_id: callId,
      name: call.name,
      arguments: call.arguments,
      status: 'completed',
    }
    text += frame({ type: 'response.output_item.done', output_index: index, item: done })
    output.push(done)
    index += 1
  }
  // An event type this client does not know: skipped, never fatal.
  text += frame({ type: 'response.something_new', detail: 1 })
  if (reply.doneSentinel === true) {
    text += 'data:\n\n'
  }
  const usage = reply.usage ?? { input: 10, output: 5 }
  const usagePayload = {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.input + usage.output,
    input_tokens_details: { cached_tokens: usage.cached ?? 0 },
    output_tokens_details: { reasoning_tokens: 1 },
  }
  if (reply.failed !== undefined) {
    return `${text}${frame({
      type: 'response.failed',
      response: {
        id: responseId,
        status: 'failed',
        output,
        error: reply.failed,
        ...(reply.usage !== undefined && { usage: usagePayload }),
      },
    })}`
  }
  const response = {
    id: responseId,
    model: 'muse-spark-1.3',
    output,
    usage: usagePayload,
  }
  if (reply.incomplete !== undefined) {
    return `${text}${frame({
      type: 'response.incomplete',
      response: {
        ...response,
        status: 'incomplete',
        incomplete_details: reply.incomplete,
      },
    })}`
  }
  return `${text}${frame({
    type: 'response.completed',
    response: {
      ...response,
      status: 'completed',
    },
  })}${reply.doneSentinel === true ? 'data: [DONE]\n\n' : ''}`
}

function bodyStream(text: string): ReadableStream<Uint8Array> {
  // Two chunks split mid-frame: the parser must buffer across chunks.
  const bytes = encoder.encode(text)
  const cut = Math.floor(bytes.length / 2)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, cut))
      controller.enqueue(bytes.subarray(cut))
      controller.close()
    },
  })
}

async function afterGate(
  gate: Promise<unknown>,
  response: Response,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (signal?.aborted === true) {
    throw new DOMException('aborted', 'AbortError')
  }
  // Not `Promise.withResolvers`: the integration tests load this helper in
  // VS Code 1.99, whose Node 20.18 lacks it (PLAN.md M62).
  const listening = new AbortController()
  const aborted = new Promise<never>((_resolve, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true, signal: listening.signal },
    )
  })
  try {
    await Promise.race([gate, aborted])
    return response
  } finally {
    listening.abort()
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function urlOf(input: string | URL | Request): URL {
  if (typeof input === 'string') {
    return new URL(input)
  }
  return input instanceof URL ? input : new URL(input.url)
}

/** A client on the fake API with no waits and a fixed clock. */
export const FAKE_MODEL_API_KEY = 'LLM|1|secret'
export const FAKE_MODEL_API_ACCOUNT_ID = createHash('sha256')
  .update(FAKE_MODEL_API_KEY)
  .digest('hex')

export const FAKE_MODEL_API_BASE_URL = 'https://api.example.test/v1'

/** Everything a client on the fake API needs but its `fetch` (M75 wraps that in its trace). */
export function fakeModelApiClientSettings(log: CoreLogger): Omit<ModelApiClientDeps, 'fetch'> {
  return {
    baseUrl: FAKE_MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(FAKE_MODEL_API_KEY),
    sleep: () => Promise.resolve(),
    now: () => 0,
    random: () => 0,
    log,
  }
}

export function fakeModelApiClient(api: FakeModelApi, log: CoreLogger): ModelApiClient {
  return new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
}

const responseOutputSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.optional(z.string()),
  output: z.string(),
})

/** The string tool outputs the `index`th `POST /responses` carried, by call id. */
export function responseOutputsByCall(api: FakeModelApi, index: number): Map<string, string> {
  const input = api.responseBodies()[index]?.['input']
  const found = new Map<string, string>()
  if (!Array.isArray(input)) {
    return found
  }
  for (const item of input) {
    const parsed = responseOutputSchema.safeParse(item)
    if (parsed.success && parsed.data.call_id !== undefined) {
      found.set(parsed.data.call_id, parsed.data.output)
    }
  }
  return found
}

export function fakeModelApi(): FakeModelApi {
  const requests: RecordedRequest[] = []
  let replies: ScriptedReply[] = [{ text: 'ok' }]
  let consumed = 0
  const bodiesAt = (path: string) =>
    requests
      .filter((request) => request.path === path)
      .map((request) => request.body as Record<string, unknown>)
  const api: FakeModelApi = {
    requests,
    models: ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-spark-1.2', 'muse-image-1.0'],
    inputTokens: 42,
    script(...next) {
      replies = [...next]
      consumed = 0
    },
    responseBodies: () =>
      requests
        .filter((request) => request.path === '/responses')
        .map((request) => request.body as Record<string, unknown>),
    images: [],
    imageBodies: () => bodiesAt('/images/generations'),
    editBodies: () => bodiesAt('/images/edits'),
    fetch: (input, init) => {
      if (input instanceof Request) {
        // The eval wire sends its validated snapshot; read it as fetch does.
        // Keep the legacy non-Request path synchronous for held-call tests.
        const request = new Request(input, init)
        return (async () => {
          const text = await request.clone().text()
          return await api.fetch(request.url, {
            method: request.method,
            headers: Object.fromEntries(request.headers),
            ...(text !== '' && { body: text }),
            signal: request.signal,
          })
        })()
      }
      const url = urlOf(input)
      const method = init?.method ?? 'GET'
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      requests.push({ path: url.pathname.replace(/^\/v1/, ''), method, headers, body })
      if ((headers['Authorization'] ?? headers['authorization']) !== 'Bearer LLM|1|secret') {
        return Promise.resolve(
          json(
            {
              error: { message: 'bad key', type: 'authentication_error', code: 'invalid_api_key' },
            },
            401,
          ),
        )
      }
      if (url.pathname.endsWith('/models')) {
        return Promise.resolve(
          json({ object: 'list', data: api.models.map((id) => ({ id, object: 'model' })) }),
        )
      }
      if (url.pathname.endsWith('/images/generations') || url.pathname.endsWith('/images/edits')) {
        const image = api.images.shift() ?? {}
        if (image.networkError !== undefined) {
          return Promise.reject(new TypeError(image.networkError))
        }
        if (image.httpError !== undefined) {
          return Promise.resolve(
            json(
              { error: { message: image.httpError.message, type: 'invalid_request_error' } },
              image.httpError.status,
            ),
          )
        }
        return Promise.resolve(
          json({
            created: 1,
            data:
              image.isEmpty === true
                ? []
                : [
                    {
                      b64_json: image.b64 ?? TINY_PNG_BASE64,
                      ...(image.revisedPrompt !== undefined && {
                        revised_prompt: image.revisedPrompt,
                      }),
                    },
                  ],
            output_format: 'png',
          }),
        )
      }
      if (url.pathname.endsWith('/responses/input_tokens')) {
        return Promise.resolve(
          json({ object: 'response.input_tokens', input_tokens: api.inputTokens }),
        )
      }
      const reply = replies[Math.min(consumed, replies.length - 1)] ?? { text: 'ok' }
      consumed += 1
      if (reply.networkError !== undefined) {
        const code = reply.networkErrorCode
        return Promise.reject(
          code === undefined
            ? new TypeError(reply.networkError)
            : new TypeError(reply.networkError, {
                cause: Object.assign(new Error(`connect ${code}`), { code }),
              }),
        )
      }
      if (reply.httpError !== undefined) {
        return Promise.resolve(
          json(
            reply.httpError.body ?? {
              error: { message: `status ${String(reply.httpError.status)}`, type: 'server_error' },
            },
            reply.httpError.status,
            reply.httpError.retryAfter === undefined
              ? {}
              : { 'retry-after': reply.httpError.retryAfter },
          ),
        )
      }
      const text = reply.garbage === true ? 'data: {not json\n\n' : streamFor(reply, nextId('resp'))
      const signal = init?.signal
      if (signal?.aborted === true) {
        return Promise.reject(new DOMException('aborted', 'AbortError'))
      }
      const response = new Response(bodyStream(text), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
      return reply.hold === undefined
        ? Promise.resolve(response)
        : afterGate(reply.hold, response, signal)
    },
  }
  return api
}
