import { Usd, sumUsd, type UsdAmount } from '../../shared/usd'
// The M75 trace (PLAN.md D49): every request an evaluation run makes to the
// Model API goes through this `fetch` and is recorded with its method, path,
// model, status and the usage Meta returned. Attempts, tokens and cost are
// counted from this record, what was sent, so a retry, a compaction call or
// any request a mechanism adds is counted too.
//
// It refuses, without sending anything, every request but the three the
// harness makes without a paid feature (`GET /models`,
// `POST /responses/input_tokens`, `POST /responses`), any other origin, a
// request that names another model than the contributor model, and every
// request once the run's budget is spent. A refusal is answered as Meta
// refuses a request, an HTTP 400 with an error body, so the client reports
// it and does not retry. The request is read as `fetch` itself would read
// it (a `Request` built from the arguments), so its shape cannot slip past.

import * as z from 'zod/mini'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../shared/constants'
import { parseSse } from '../backends/modelapi/sse'
import { usageSchema, type Usage } from '../backends/modelapi/schemas'
import { estimateCostUsd } from '../usage/insights'

const HTTP_BAD_REQUEST = 400
const HTTP_RATE_LIMIT = 429
const MODEL_CALL = 'POST /responses'
/** The requests the harness makes with no paid feature on. */
const ALLOWED_REQUESTS: ReadonlySet<string> = new Set([
  'GET /models',
  'POST /responses/input_tokens',
  MODEL_CALL,
])
const TRAILING_SLASHES = /\/+$/u

export interface EvalWireCall {
  readonly method: string
  readonly path: string
  /** The model the request named, if it named one. */
  readonly model: string | undefined
  /** A model call, `POST /responses`: what the trace counts as an attempt. */
  readonly isModelCall: boolean
  /** The HTTP status; 0 while none came, or when the request failed on the way. */
  status: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
}

/** The run's spend so far, shared by every task's wire. */
export interface EvalBudget {
  spentUsd: UsdAmount
  /** A sent model call whose bill cannot be measured stops every remaining arm. */
  hasUnknownUsage?: boolean
}

export interface EvalWire {
  readonly fetch: typeof fetch
  /** The requests sent, in order. */
  readonly calls: readonly EvalWireCall[]
  /** The requests refused before sending, by reason. */
  readonly refusals: readonly string[]
  /** What could not be read back: a reply whose usage never arrived. */
  readonly problems: readonly string[]
  /** Waits until the usage of every reply streamed so far has been read. */
  settle(): Promise<void>
}

export interface EvalWireTotals {
  /** Model calls sent (`POST /responses`), retries included. */
  readonly attempts: number
  /** Every request sent, the model calls included. */
  readonly requests: number
  readonly inputTokens: number
  readonly cachedTokens: number
  readonly outputTokens: number
  readonly costUsd: UsdAmount
}

const modelBodySchema = z.object({ model: z.optional(z.string()) })

const terminalFrameSchema = z.object({
  type: z.enum(['response.completed', 'response.incomplete', 'response.failed']),
  response: z.object({ usage: z.optional(z.nullable(usageSchema)) }),
})

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The model a request body names; undefined without a body or a model. */
function modelOf(body: string): string | undefined {
  const parsed = modelBodySchema.safeParse(parseJson(body))
  return parsed.success ? parsed.data.model : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function refusal(message: string): Response {
  return Response.json(
    { error: { message, type: 'invalid_request_error', code: 'eval_refused' } },
    { status: HTTP_BAD_REQUEST },
  )
}

function callCost(call: EvalWireCall): UsdAmount {
  return estimateCostUsd(
    {
      inputTokens: call.inputTokens,
      cachedTokens: call.cachedTokens,
      outputTokens: call.outputTokens,
    },
    call.model ?? EVAL_MODEL_ID,
  )
}

function addUsage(call: EvalWireCall, usage: Usage): void {
  call.inputTokens += usage.input_tokens
  call.cachedTokens += usage.input_tokens_details?.cached_tokens ?? 0
  call.outputTokens += usage.output_tokens
}

function isValidUsage(usage: Usage): boolean {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0
  return (
    [usage.input_tokens, usage.output_tokens, cached].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) && cached <= usage.input_tokens
  )
}

/**
 * The reply passed on as the client reads it, each chunk also given to
 * `copy`. The copy ends when the reply ends, fails or is cancelled by the
 * client, so reading it never outlasts the client's own reading.
 */
function metered(
  body: ReadableStream<Uint8Array>,
): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  const reader = body.getReader()
  const copy = {
    isOpen: true,
    controller: undefined as ReadableStreamDefaultController | undefined,
  }
  const end = (error?: unknown): void => {
    if (!copy.isOpen) {
      return
    }
    copy.isOpen = false
    if (error === undefined) {
      copy.controller?.close()
    } else {
      copy.controller?.error(error)
    }
  }
  const copied = new ReadableStream<Uint8Array>({
    start(controller) {
      copy.controller = controller
    },
  })
  const passed = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          end()
          controller.close()
          return
        }
        copy.controller?.enqueue(chunk.value)
        controller.enqueue(chunk.value)
      } catch (error: unknown) {
        end(error)
        throw error
      }
    },
    async cancel(reason) {
      end()
      await reader.cancel(reason)
    },
  })
  return [passed, copied]
}

export interface EvalWireDeps {
  /** The network: the live `fetch`, or the fake Model API's. */
  readonly fetch: typeof fetch
  readonly baseUrl: string
  readonly budget: EvalBudget
}

export function createEvalWire(deps: EvalWireDeps): EvalWire {
  const base = new URL(deps.baseUrl)
  const basePath = base.pathname.replace(TRAILING_SLASHES, '')
  const calls: EvalWireCall[] = []
  const refusals: string[] = []
  const problems: string[] = []
  const reads: Promise<void>[] = []

  const refuse = (reason: string): Response => {
    refusals.push(reason)
    return refusal(reason)
  }

  const checkBudget = (): Response | undefined => {
    if (deps.budget.hasUnknownUsage === true) {
      return refuse('the evaluation stopped because a sent model call has unknown usage')
    }
    return Usd.from(deps.budget.spentUsd).compare(Usd.from(EVAL_BUDGET_USD)) >= 0
      ? refuse(`the evaluation's budget of $${EVAL_BUDGET_USD.toFixed(2)} is spent`)
      : undefined
  }

  /** The usage of a streamed reply, read from its copy. */
  const readUsage = async (stream: ReadableStream<Uint8Array>, call: EvalWireCall) => {
    let hasUsage = false
    try {
      for await (const frame of parseSse(stream)) {
        const usage = terminalFrameSchema.safeParse(parseJson(frame.data)).data?.response.usage
        if (usage == null) {
          continue
        }
        if (!isValidUsage(usage)) {
          deps.budget.hasUnknownUsage = true
          problems.push('a reply reported invalid token counts')
          continue
        }
        addUsage(call, usage)
        hasUsage = true
      }
    } catch (error: unknown) {
      problems.push(`a reply stream failed before its usage: ${describe(error)}`)
      return
    } finally {
      deps.budget.spentUsd = sumUsd(deps.budget.spentUsd, callCost(call))
      if (!hasUsage) {
        deps.budget.hasUnknownUsage = true
      }
    }
    if (!hasUsage) {
      problems.push('a reply ended without its usage')
    }
  }

  const wiredFetch: typeof fetch = async (input, init) => {
    // Read as `fetch` reads it: the method upper-cased, the URL resolved.
    let request: Request
    try {
      request = new Request(input, init)
    } catch (error: unknown) {
      return refuse(`the evaluation could not read a request: ${describe(error)}`)
    }
    const url = new URL(request.url)
    if (url.origin !== base.origin) {
      return refuse(`the evaluation sends nothing to ${url.origin}`)
    }
    const beforeBody = checkBudget()
    if (beforeBody !== undefined) {
      return beforeBody
    }
    const path = url.pathname.replace(TRAILING_SLASHES, '')
    const endpoint = `${request.method} ${path.startsWith(basePath) ? path.slice(basePath.length) : path}`
    if (!ALLOWED_REQUESTS.has(endpoint)) {
      return refuse(`the evaluation sends no ${endpoint}`)
    }
    const model = request.method === 'GET' ? undefined : modelOf(await request.clone().text())
    const isModelCall = endpoint === MODEL_CALL
    if (model !== EVAL_MODEL_ID && (isModelCall || model !== undefined)) {
      return refuse(`the evaluation runs on ${EVAL_MODEL_ID} only, not ${String(model)}`)
    }
    // Reading a streamed request body can yield while the prior reply settles.
    const afterBody = checkBudget()
    if (afterBody !== undefined) {
      return afterBody
    }
    const call: EvalWireCall = {
      method: request.method,
      path,
      model,
      isModelCall,
      status: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    }
    calls.push(call)
    // Send the validated snapshot, including a streamed body and copied headers.
    let response: Response
    try {
      response = await deps.fetch(request)
    } catch (error: unknown) {
      if (isModelCall) {
        deps.budget.hasUnknownUsage = true
      }
      throw error
    }
    call.status = response.status
    if (
      isModelCall &&
      !response.ok &&
      response.status !== HTTP_BAD_REQUEST &&
      response.status !== HTTP_RATE_LIMIT
    ) {
      deps.budget.hasUnknownUsage = true
      problems.push('a model call failed without measurable usage')
    }
    if (isModelCall && response.ok && response.body === null) {
      deps.budget.hasUnknownUsage = true
      problems.push('a reply ended without its usage')
    }
    if (!isModelCall || !response.ok || response.body === null) {
      return response
    }
    const [passed, copied] = metered(response.body)
    reads.push(readUsage(copied, call))
    return new Response(passed, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  return {
    fetch: wiredFetch,
    calls,
    refusals,
    problems,
    async settle() {
      await Promise.all(reads.splice(0))
    },
  }
}

/** What the trace counts for one task: attempts, requests, tokens and cost. */
export function wireTotals(wire: EvalWire): EvalWireTotals {
  const totals = {
    attempts: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    costUsd: Usd.from(0).toAmount(),
  }
  for (const call of wire.calls) {
    totals.attempts += call.isModelCall ? 1 : 0
    totals.inputTokens += call.inputTokens
    totals.cachedTokens += call.cachedTokens
    totals.outputTokens += call.outputTokens
    totals.costUsd = sumUsd(totals.costUsd, callCost(call))
  }
  return { ...totals, requests: wire.calls.length }
}
