// The M75 trace (PLAN.md D49): every request an evaluation run makes to the
// Model API goes through this `fetch` and is recorded with its method, path,
// model, status and the usage Meta returned. Attempts, tokens and cost are
// counted from this record, what was sent, so a retry, a compaction call or
// any request a mechanism adds is counted too.
//
// It refuses, without sending anything, a model call that names another
// model than the contributor model, a request to any other host, and every
// request once the run's budget is spent. A refusal is answered as Meta
// refuses a request, an HTTP 400 with an error body, so the client reports
// it and does not retry.

import * as z from 'zod/mini'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../shared/constants'
import { parseSse } from '../backends/modelapi/sse'
import { usageSchema, type Usage } from '../backends/modelapi/schemas'
import { estimateCostUsd } from '../usage/insights'

const HTTP_BAD_REQUEST = 400
const RESPONSES_SEGMENT = '/responses'
const POST = 'POST'

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
  spentUsd: number
}

export interface EvalWire {
  readonly fetch: typeof fetch
  /** The requests sent, in order. */
  readonly calls: readonly EvalWireCall[]
  /** The requests refused before sending, by reason. */
  readonly refusals: readonly string[]
  /** What could not be read back: a reply stream that ended early. */
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
  readonly costUsd: number
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

function urlOf(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input)
}

/** The model a request body names; undefined without a body or a model. */
function modelOf(body: RequestInit['body']): string | undefined {
  const parsed = modelBodySchema.safeParse(typeof body === 'string' ? parseJson(body) : undefined)
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

function callCost(call: EvalWireCall): number {
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

export interface EvalWireDeps {
  /** The network: the live `fetch`, or the fake Model API's. */
  readonly fetch: typeof fetch
  readonly baseUrl: string
  readonly budget: EvalBudget
}

export function createEvalWire(deps: EvalWireDeps): EvalWire {
  const base = new URL(deps.baseUrl)
  const responsesPath = `${base.pathname}${RESPONSES_SEGMENT}`
  const calls: EvalWireCall[] = []
  const refusals: string[] = []
  const problems: string[] = []
  const reads: Promise<void>[] = []

  const refuse = (reason: string): Response => {
    refusals.push(reason)
    return refusal(reason)
  }

  /** The usage of a streamed reply, read from a copy of its stream. */
  const readUsage = async (stream: ReadableStream<Uint8Array>, call: EvalWireCall) => {
    try {
      for await (const frame of parseSse(stream)) {
        const parsed = terminalFrameSchema.safeParse(parseJson(frame.data))
        if (parsed.success && parsed.data.response.usage != null) {
          addUsage(call, parsed.data.response.usage)
        }
      }
    } catch (error: unknown) {
      problems.push(`a reply stream ended early: ${describe(error)}`)
    }
    deps.budget.spentUsd += callCost(call)
  }

  const wiredFetch: typeof fetch = async (input, init) => {
    const url = urlOf(input)
    if (url.host !== base.host) {
      return refuse(`the evaluation sends nothing to ${url.host}`)
    }
    if (deps.budget.spentUsd >= EVAL_BUDGET_USD) {
      return refuse(`the evaluation's budget of $${EVAL_BUDGET_USD.toFixed(2)} is spent`)
    }
    const method = init?.method ?? 'GET'
    const model = modelOf(init?.body)
    const isModelCall = method === POST && url.pathname === responsesPath
    if (isModelCall && model !== EVAL_MODEL_ID) {
      return refuse(`the evaluation runs on ${EVAL_MODEL_ID} only, not ${String(model)}`)
    }
    const call: EvalWireCall = {
      method,
      path: url.pathname,
      model,
      isModelCall,
      status: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    }
    calls.push(call)
    const response = await deps.fetch(input, init)
    call.status = response.status
    if (!isModelCall || !response.ok || response.body === null) {
      return response
    }
    const [mine, theirs] = response.body.tee()
    reads.push(readUsage(mine, call))
    return new Response(theirs, {
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
  const totals = { attempts: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 }
  for (const call of wire.calls) {
    totals.attempts += call.isModelCall ? 1 : 0
    totals.inputTokens += call.inputTokens
    totals.cachedTokens += call.cachedTokens
    totals.outputTokens += call.outputTokens
    totals.costUsd += callCost(call)
  }
  return { ...totals, requests: wire.calls.length }
}
