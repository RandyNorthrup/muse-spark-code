import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../../src/shared/constants'
import { estimateCostUsd } from '../../../src/core/usage/insights'
import { createEvalWire, wireTotals, type EvalBudget } from '../../../src/core/eval/wire'
import { FAKE_MODEL_API_BASE_URL, fakeModelApi } from '../helpers/fakeModelApi'

const RESPONSES_URL = `${FAKE_MODEL_API_BASE_URL}/responses`
const HEADERS = { Authorization: 'Bearer LLM|1|secret', 'content-type': 'application/json' }

const refusalSchema = z.object({ error: z.object({ message: z.string(), code: z.string() }) })

/** A model call's request; `null` names no model at all. */
function modelCall(model: string | null = EVAL_MODEL_ID): RequestInit {
  return {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ ...(model !== null && { model }), stream: true, input: [] }),
  }
}

function wireOn(fetch: typeof globalThis.fetch, budget?: EvalBudget) {
  return createEvalWire({
    fetch,
    baseUrl: FAKE_MODEL_API_BASE_URL,
    budget: budget ?? { spentUsd: 0 },
  })
}

/** A reply whose stream breaks before its first byte. */
const brokenStream: typeof fetch = () =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('the connection was reset'))
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ),
  )

async function refusalOf(response: Response): Promise<string> {
  expect(response.status).toBe(400)
  const body = refusalSchema.parse(await response.json())
  expect(body.error.code).toBe('eval_refused')
  return body.error.message
}

describe('eval wire', () => {
  it('counts a model call and the usage Meta returned, and charges the budget', async () => {
    const api = fakeModelApi()
    api.script({ text: 'ok', usage: { input: 1000, output: 100, cached: 400 } })
    const budget = { spentUsd: 0 }
    const wire = wireOn(api.fetch, budget)
    const response = await wire.fetch(RESPONSES_URL, modelCall())
    await response.text()
    await wire.settle()
    const cost = estimateCostUsd(
      { inputTokens: 1000, cachedTokens: 400, outputTokens: 100 },
      EVAL_MODEL_ID,
    )
    expect(wireTotals(wire)).toEqual({
      attempts: 1,
      requests: 1,
      inputTokens: 1000,
      cachedTokens: 400,
      outputTokens: 100,
      costUsd: cost,
    })
    expect(wire.calls[0]).toMatchObject({ model: EVAL_MODEL_ID, status: 200, isModelCall: true })
    expect(budget.spentUsd).toBe(cost)
    expect(wire.refusals).toEqual([])
    expect(wire.problems).toEqual([])
  })

  it('counts a request that is not a model call as a request only', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch)
    const response = await wire.fetch(`${FAKE_MODEL_API_BASE_URL}/models`, { headers: HEADERS })
    await response.json()
    await wire.settle()
    expect(wireTotals(wire)).toMatchObject({ attempts: 0, requests: 1, costUsd: 0 })
  })

  it('counts a refused and a failed model call as attempts, with no usage', async () => {
    const api = fakeModelApi()
    api.script({ httpError: { status: 500 } }, { networkError: 'the network is down' })
    const wire = wireOn(api.fetch)
    const refused = await wire.fetch(RESPONSES_URL, modelCall())
    expect(refused.status).toBe(500)
    await expect(wire.fetch(RESPONSES_URL, modelCall())).rejects.toThrow('the network is down')
    await wire.settle()
    expect(wire.calls.map((call) => call.status)).toEqual([500, 0])
    expect(wireTotals(wire)).toMatchObject({ attempts: 2, requests: 2, inputTokens: 0 })
  })

  it('refuses another model, or none, without sending', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch)
    expect(await refusalOf(await wire.fetch(RESPONSES_URL, modelCall('muse-spark-1.3')))).toBe(
      `the evaluation runs on ${EVAL_MODEL_ID} only, not muse-spark-1.3`,
    )
    expect(await refusalOf(await wire.fetch(RESPONSES_URL, modelCall(null)))).toContain(
      'not undefined',
    )
    const unparsed = await wire.fetch(RESPONSES_URL, { method: 'POST', body: 'not json' })
    expect(await refusalOf(unparsed)).toContain('not undefined')
    expect(api.requests).toEqual([])
    expect(wire.calls).toEqual([])
    expect(wire.refusals).toHaveLength(3)
  })

  it('refuses any other host without sending', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch)
    const request = new Request('https://elsewhere.example.test/v1/responses')
    expect(await refusalOf(await wire.fetch(request, modelCall()))).toBe(
      'the evaluation sends nothing to elsewhere.example.test',
    )
    expect(api.requests).toEqual([])
  })

  it('refuses everything once the budget is spent', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch, { spentUsd: EVAL_BUDGET_USD })
    expect(await refusalOf(await wire.fetch(RESPONSES_URL, modelCall()))).toBe(
      `the evaluation's budget of $${EVAL_BUDGET_USD.toFixed(2)} is spent`,
    )
    expect(api.requests).toEqual([])
  })

  it('notes a reply stream that ends early', async () => {
    const wire = wireOn(brokenStream)
    const response = await wire.fetch(RESPONSES_URL, modelCall())
    await expect(response.text()).rejects.toThrow()
    await wire.settle()
    expect(wire.problems).toEqual(['a reply stream ended early: the connection was reset'])
    expect(wireTotals(wire).attempts).toBe(1)
  })
})
