import * as z from 'zod/mini'
import { imagesResponseSchema, streamEventSchema } from '../../core/backends/modelapi/schemas'
import { parseSse } from '../../core/backends/modelapi/sse'
import { readImageInfo } from '../../core/imageDimensions'
import { modelApiPaidTier } from '../../shared/paid'
import {
  EXEC_ENDPOINTS,
  EXEC_IMAGE_N,
  EXEC_MIN_OUTPUT_TOKENS,
  EXEC_OBSERVER_HIGH_WATER_BYTES,
  EXEC_RESPONSE_MAX_BYTES,
  EXEC_SSE_FRAME_MAX_BYTES,
  MODEL_API_BASE_URL,
  MODEL_API_IMAGE_MODEL,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_PRICES_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'
import type { ExecEventBody, LastResponse, Refusal } from './execProtocol'
import type { Lifecycle, StopCause } from './execLimits'
import type { ImageSettlement, ResponseSettlement, RunLedger } from './runLedger'

export interface ExecTransport {
  readonly fetch: typeof fetch
  whenSettled(): Promise<void>
  close(): void
}

const requestSchema = z.looseObject({
  model: z.string(),
  stream: z.literal(true),
  max_output_tokens: z
    .number()
    .check(z.int(), z.gte(EXEC_MIN_OUTPUT_TOKENS), z.lte(MODEL_API_MAX_OUTPUT_TOKENS)),
  tools: z.optional(z.array(z.looseObject({ type: z.literal('function') }))),
})
// This projects only fields already captured by the existing stream boundary;
// unknown usage stays unknown so malformed accounting cannot become "missing".
const terminalSchema = z.looseObject({
  type: z.enum(['response.completed', 'response.incomplete', 'response.failed']),
  response: z.looseObject({
    id: z.string(),
    status: z.string(),
    output: z.array(z.unknown()),
    usage: z.optional(z.unknown()),
    incomplete_details: z.optional(z.nullable(z.object({ reason: z.optional(z.string()) }))),
  }),
})
const imageRequestSchema = z.looseObject({
  n: z.literal(EXEC_IMAGE_N),
  model: z.literal(MODEL_API_IMAGE_MODEL),
})

export function execFetch(input: {
  fetch: typeof fetch
  ledger: RunLedger
  selectedModel: string
  imageGeneration: boolean
  lifecycle: Lifecycle
  onLatch: (cause: StopCause) => void
  emit: (event: ExecEventBody) => void
  onResponseStart: (n: number) => void
  onResponseSettled: (outcome: LastResponse) => void
}): ExecTransport {
  let barrier = Promise.resolve()
  let stopActive: (() => void) | undefined
  let isClosed = false
  const refuse = (reason: Refusal, isImage = false): never => {
    if (isImage)
      input.emit({
        type: 'paid_use',
        feature: 'imageGeneration',
        n: null,
        phase: 'refused',
        units: 1,
        usd: 0,
        reason,
      })
    if (reason !== 'closed') input.onLatch({ kind: reason })
    throw new Error(UI_TEXT.execRequestShape)
  }
  const transport: typeof fetch = async (url, init) => {
    if (typeof url !== 'string') return refuse('request_shape')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return refuse('request_shape')
    }
    const base = new URL(MODEL_API_BASE_URL)
    if (
      parsed.origin !== base.origin ||
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== '' ||
      parsed.search !== ''
    )
      return refuse('request_shape')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && parsed.pathname === EXEC_ENDPOINTS.models) {
      if (isClosed || input.lifecycle.signal.aborted) return refuse('closed')
      return await input.lifecycle.race(
        input.fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([
            input.lifecycle.signal,
            ...(init?.signal == null ? [] : [init.signal]),
          ]),
        }),
      )
    }
    const isResponse = parsed.pathname === EXEC_ENDPOINTS.responses
    const endpoint =
      parsed.pathname === EXEC_ENDPOINTS.imageGenerations ? 'images.generations' : 'images.edits'
    const isImage =
      parsed.pathname === EXEC_ENDPOINTS.imageGenerations ||
      parsed.pathname === EXEC_ENDPOINTS.imageEdits
    if (method !== 'POST' || (!isResponse && !isImage) || typeof init?.body !== 'string')
      return refuse('request_shape')
    const body = init.body
    let data: unknown
    try {
      data = JSON.parse(body)
    } catch {
      return refuse('request_shape')
    }
    const responseShape = requestSchema.safeParse(data)
    if (
      isResponse &&
      (!responseShape.success ||
        responseShape.data.model !== input.selectedModel ||
        'background' in responseShape.data ||
        'previous_response_id' in responseShape.data)
    )
      return refuse('request_shape')
    if (isImage && (!input.imageGeneration || !imageRequestSchema.safeParse(data).success))
      return refuse('request_shape', true)
    const tier = modelApiPaidTier(input.selectedModel)
    if (isResponse && tier === undefined) return refuse('unpriced')
    // Each caller captures the current tail synchronously. Rechecking after
    // this wait and reserving have no intervening await.
    const previous = barrier
    const release: { run?: () => void } = {}
    const slot = new Promise<void>((resolve) => {
      release.run = () => {
        resolve()
      }
    })
    barrier = (async () => {
      await previous
      await slot
    })()
    try {
      await input.lifecycle.race(previous)
    } catch (error: unknown) {
      release.run?.()
      throw error
    }
    if (isClosed || input.lifecycle.signal.aborted) {
      release.run?.()
      return refuse('closed')
    }
    const ticket =
      isResponse && tier !== undefined && responseShape.success
        ? input.ledger.admitResponse({
            model: input.selectedModel,
            maxOutputTokens: responseShape.data.max_output_tokens,
            price: MODEL_API_PRICES_PER_MILLION[tier],
          })
        : input.ledger.admitImage(endpoint)
    if ('refused' in ticket) {
      release.run?.()
      return refuse(ticket.refused, isImage)
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      input.lifecycle.signal,
      ...(init.signal == null ? [] : [init.signal]),
    ])
    let isSettled = false
    let terminal: string | null = null
    let incompleteReason: string | null = null
    let usage: unknown
    let isParseInvalid = false
    let why: Extract<ResponseSettlement, { kind: 'transport' }>['why'] = 'error'
    const metadata = () => ({ terminal, incompleteReason, usage })
    const settle = (outcome: ResponseSettlement | ImageSettlement) => {
      if (isSettled) return
      isSettled = true
      signal.removeEventListener('abort', aborted)
      let result
      if (ticket.kind === 'responses') {
        if (
          outcome.kind === 'returned' ||
          outcome.kind === 'unparsable' ||
          (outcome.kind === 'transport' && !('terminal' in outcome))
        )
          throw new Error(UI_TEXT.execRequestShape)
        result = input.ledger.settleResponse(ticket, outcome)
        const last = input.ledger.lastResponse
        if (last !== null) input.onResponseSettled(last)
      } else {
        if (outcome.kind === 'eof' || (outcome.kind === 'transport' && outcome.why === 'malformed'))
          throw new Error(UI_TEXT.execRequestShape)
        result = input.ledger.settleImage(
          ticket,
          outcome.kind === 'transport'
            ? { kind: 'transport', why: outcome.why === 'malformed' ? 'error' : outcome.why }
            : outcome,
        )
        const count =
          outcome.kind === 'returned' && typeof outcome.count === 'number' ? outcome.count : 0
        let phase: 'uncertain' | 'returned' | 'refunded' = 'uncertain'
        if (result.outcome === 'priced') phase = count === 0 ? 'refunded' : 'returned'
        input.emit({
          type: 'paid_use',
          feature: 'imageGeneration',
          n: ticket.n,
          phase,
          units: 1,
          usd: result.chargedUsd,
        })
      }
      input.emit({
        type: 'attempt',
        n: ticket.n,
        endpoint: ticket.kind === 'responses' ? 'responses' : ticket.endpoint,
        phase: 'settled',
        reservedUsd: ticket.reserveUsd,
        outcome: result.outcome,
        chargedUsd: result.chargedUsd,
        ...(ticket.kind === 'responses' && { terminal }),
        totals: input.ledger.totals(),
      })
      if (result.latch !== undefined) input.onLatch({ kind: result.latch })
      stopActive = undefined
      release.run?.()
    }
    const lost = () => {
      settle(
        ticket.kind === 'responses'
          ? { kind: 'transport', why, ...metadata() }
          : { kind: 'transport', why: why === 'malformed' ? 'error' : why },
      )
    }
    const aborted = () => {
      why = 'aborted'
      lost()
    }
    signal.addEventListener('abort', aborted, { once: true })
    stopActive = () => {
      why = 'aborted'
      lost()
      controller.abort()
    }
    if (ticket.kind === 'responses') input.onResponseStart(ticket.n)
    input.emit({
      type: 'attempt',
      n: ticket.n,
      endpoint: ticket.kind === 'responses' ? 'responses' : ticket.endpoint,
      phase: 'admitted',
      reservedUsd: ticket.reserveUsd,
      ...(ticket.kind === 'responses' && { maxOutputTokens: ticket.maxOutputTokens }),
      totals: input.ledger.totals(),
    })
    if (ticket.kind === 'image')
      input.emit({
        type: 'paid_use',
        feature: 'imageGeneration',
        n: ticket.n,
        phase: 'admitted',
        units: 1,
        usd: ticket.reserveUsd,
      })
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(new Error(UI_TEXT.execInterrupted))
        else
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error(UI_TEXT.execInterrupted))
            },
            { once: true },
          )
      })
      const pending = input.fetch(url, { ...init, body, redirect: 'error', signal })
      void (async () => {
        try {
          const late = await pending
          if (signal.aborted) await late.body?.cancel()
        } catch {
          /* The request/abort race below owns reporting and settlement. */
        }
      })()
      const response = await Promise.race([pending, interrupted])
      if (!response.ok) {
        settle({ kind: 'http', status: response.status })
        return response
      }
      if (response.body === null) {
        why = 'malformed'
        lost()
        throw new Error(UI_TEXT.execRequestShape)
      }
      if (ticket.kind === 'image') {
        const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          for (;;) {
            const part = await Promise.race([reader.read(), interrupted])
            if (part.done) break
            size += part.value.byteLength
            if (size > EXEC_RESPONSE_MAX_BYTES) {
              why = 'tooLarge'
              throw new Error(UI_TEXT.execFileTooLarge)
            }
            chunks.push(part.value)
          }
          const bytes = Buffer.concat(chunks, size)
          let count: unknown
          const parsedImage = imagesResponseSchema.safeParse(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          )
          if (parsedImage.success) {
            const images = parsedImage.data.data
            if (images.length === 0 || images.length > EXEC_IMAGE_N) count = images.length
            else {
              const encoded = images[0]?.b64_json
              if (
                typeof encoded === 'string' &&
                encoded.length > 0 &&
                /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
              ) {
                const png = Buffer.from(encoded, 'base64')
                const info = readImageInfo(png)
                if (info?.mediaType === 'image/png' && info.width > 0 && info.height > 0) count = 1
              }
            }
          }
          settle(count === undefined ? { kind: 'unparsable' } : { kind: 'returned', count })
          if (count === undefined || signal.aborted) throw new Error(UI_TEXT.execRequestShape)
          return new Response(bytes, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        } catch (error: unknown) {
          lost()
          controller.abort()
          void reader.cancel().catch(() => {
            /* Transport already failed; cancellation is best effort. */
          })
          throw error
        }
      }
      const decoder = new TextDecoder()
      let buffered = ''
      let frame: string[] = []
      let frameBytes = 0
      let seen = 0
      const inspect = async () => {
        const raw = frame.join('\n')
        frame = []
        frameBytes = 0
        const chunks = new ReadableStream<Uint8Array>({
          start(output) {
            output.enqueue(new TextEncoder().encode(raw))
            output.close()
          },
        })
        for await (const event of parseSse(chunks)) {
          if (event.data.trim() === '' || event.data.trim() === '[DONE]') continue
          let value: unknown
          try {
            value = JSON.parse(event.data)
          } catch {
            why = 'malformed'
            throw new Error(UI_TEXT.execRequestShape)
          }
          const boundary = z.looseObject({ type: z.string() }).safeParse(value)
          if (!boundary.success) {
            why = 'malformed'
            throw new Error(UI_TEXT.execRequestShape)
          }
          if (
            !['response.completed', 'response.incomplete', 'response.failed'].includes(
              boundary.data.type,
            )
          )
            continue
          const parsedTerminal = terminalSchema.safeParse(value)
          if (!parsedTerminal.success) {
            isParseInvalid = true
            continue
          }
          if (terminal !== null) isParseInvalid = true
          terminal = parsedTerminal.data.type.slice('response.'.length)
          if (parsedTerminal.data.response.status !== terminal) isParseInvalid = true
          incompleteReason = parsedTerminal.data.response.incomplete_details?.reason ?? null
          usage = parsedTerminal.data.response.usage
          if (!streamEventSchema.safeParse(value).success) isParseInvalid = true
        }
      }
      const observe = async (text: string, isEnd: boolean) => {
        buffered += text
        if (Buffer.byteLength(buffered) > EXEC_OBSERVER_HIGH_WATER_BYTES) {
          why = 'tooLarge'
          throw new Error(UI_TEXT.execFileTooLarge)
        }
        const isHeldCr = !isEnd && buffered.endsWith('\r')
        const lines = (isHeldCr ? buffered.slice(0, -1) : buffered).split(/\r\n|\r|\n/)
        buffered = isEnd ? '' : `${lines.pop() ?? ''}${isHeldCr ? '\r' : ''}`
        for (const line of lines) {
          frameBytes += Buffer.byteLength(line) + 1
          if (frameBytes > EXEC_SSE_FRAME_MAX_BYTES) {
            why = 'tooLarge'
            throw new Error(UI_TEXT.execFileTooLarge)
          }
          frame.push(line)
          if (line === '') await inspect()
        }
        if (frameBytes + Buffer.byteLength(buffered) > EXEC_SSE_FRAME_MAX_BYTES) {
          why = 'tooLarge'
          throw new Error(UI_TEXT.execFileTooLarge)
        }
        if (isEnd && frame.length > 0) await inspect()
      }
      const transform = new TransformStream<Uint8Array, Uint8Array>({
        async transform(chunk, output) {
          seen += chunk.byteLength
          if (seen > EXEC_RESPONSE_MAX_BYTES) {
            why = 'tooLarge'
            throw new Error(UI_TEXT.execFileTooLarge)
          }
          await observe(decoder.decode(chunk, { stream: true }), false)
          output.enqueue(chunk)
        },
        async flush() {
          await observe(decoder.decode(), true)
          settle({ kind: 'eof', ...metadata(), parseInvalid: isParseInvalid })
        },
      })
      void response.body.pipeTo(transform.writable, { signal }).catch(() => {
        lost()
        controller.abort()
      })
      const reader = transform.readable.getReader()
      const wrapped = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const next = await reader.read()
            if (next.done) output.close()
            else output.enqueue(next.value)
          } catch (error: unknown) {
            lost()
            output.error(error)
          }
        },
        cancel() {
          why = 'aborted'
          lost()
          controller.abort()
          void reader.cancel().catch(() => {
            /* The downstream cancellation has already settled liability. */
          })
        },
      })
      return new Response(wrapped, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } catch (error: unknown) {
      lost()
      controller.abort()
      throw error
    }
  }
  return {
    fetch: transport,
    whenSettled: () => barrier,
    close() {
      isClosed = true
      input.ledger.close()
      stopActive?.()
    },
  }
}
