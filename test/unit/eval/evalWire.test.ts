import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../../src/shared/constants'
import { estimateCostUsd } from '../../../src/core/usage/insights'
import {
  createEvalWire,
  wireTotals,
  type EvalBudget,
  type EvalWire,
} from '../../../src/core/eval/wire'
import {
  FAKE_MODEL_API_BASE_URL,
  fakeModelApi,
  streamFor,
  type FakeModelApi,
} from '../helpers/fakeModelApi'

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

/** One frame, then silence: the stream never ends on its own. */
const quietStream: typeof fetch = () =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: not json\n\n'))
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

async function expectUnpricedUsage(wire: EvalWire, budget: EvalBudget, api: FakeModelApi) {
  await wire.settle()
  expect(budget).toEqual({ spentUsd: 0, hasUnknownUsage: true })
  expect(wireTotals(wire)).toMatchObject({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 })
  const sent = api.requests.length
  const later = wireOn(api.fetch, budget)
  expect(await refusalOf(await later.fetch(RESPONSES_URL, modelCall()))).toContain('unknown usage')
  expect(later.calls).toEqual([])
  expect(api.requests).toHaveLength(sent)
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
    api.script({ httpError: { status: 400 } }, { networkError: 'the network is down' })
    const wire = wireOn(api.fetch)
    const refused = await wire.fetch(RESPONSES_URL, modelCall())
    expect(refused.status).toBe(400)
    await expect(wire.fetch(RESPONSES_URL, modelCall())).rejects.toThrow('the network is down')
    await wire.settle()
    expect(wire.calls.map((call) => call.status)).toEqual([400, 0])
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

  it('refuses any other origin without sending, a changed scheme included', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch)
    const elsewhere = new Request('https://elsewhere.example.test/v1/responses')
    expect(await refusalOf(await wire.fetch(elsewhere, modelCall()))).toBe(
      'the evaluation sends nothing to https://elsewhere.example.test',
    )
    const plain = RESPONSES_URL.replace('https:', 'http:')
    expect(await refusalOf(await wire.fetch(plain, modelCall()))).toBe(
      // eslint-disable-next-line unicorn/prefer-https -- the refused address is plain http on purpose
      'the evaluation sends nothing to http://api.example.test',
    )
    expect(api.requests).toEqual([])
  })

  it('reads a request as fetch does, whatever its shape', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch)
    // A Request carrying everything, with no init: still a model call.
    const whole = new Request(RESPONSES_URL, modelCall('muse-spark-1.3'))
    expect(await refusalOf(await wire.fetch(whole))).toContain('not muse-spark-1.3')
    // A lower-case method, and a trailing slash on the path.
    const lower = await wire.fetch(`${RESPONSES_URL}/`, {
      ...modelCall('muse-spark-1.3'),
      method: 'post',
    })
    expect(await refusalOf(lower)).toContain('not muse-spark-1.3')
    // A body that is not a string.
    const bytes = await wire.fetch(RESPONSES_URL, {
      method: 'POST',
      body: new TextEncoder().encode(JSON.stringify({ model: 'muse-spark-1.3' })),
    })
    expect(await refusalOf(bytes)).toContain('not muse-spark-1.3')
    expect(api.requests).toEqual([])
  })

  it('sends a Request input with its body intact', async () => {
    const seen: string[] = []
    const recording: typeof fetch = async (input) => {
      seen.push(input instanceof Request ? await input.text() : 'not a request')
      return Response.json({ object: 'list', data: [] })
    }
    const wire = wireOn(recording)
    const request = new Request(`${FAKE_MODEL_API_BASE_URL}/responses/input_tokens`, {
      method: 'POST',
      body: JSON.stringify({ model: EVAL_MODEL_ID, input: [] }),
    })
    const response = await wire.fetch(request)
    expect(response.status).toBe(200)
    expect(seen).toEqual([JSON.stringify({ model: EVAL_MODEL_ID, input: [] })])
    // A token count is a request, not an attempt.
    expect(wireTotals(wire)).toMatchObject({ attempts: 0, requests: 1 })
  })

  it('sends the admitted streamed body from a non-Request input', async () => {
    const api = fakeModelApi()
    api.script({ text: 'ok' })
    const wire = wireOn(api.fetch)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ model: EVAL_MODEL_ID })))
        controller.close()
      },
    })
    const init = { ...modelCall(), body, duplex: 'half' }
    const response = await wire.fetch(RESPONSES_URL, init)
    await response.text()
    await wire.settle()
    expect(api.requests[0]).toMatchObject({ method: 'POST', body: { model: EVAL_MODEL_ID } })
    expect(wire.problems).toEqual([])
  })

  it('sends the validated snapshot when the original init changes during its body read', async () => {
    const api = fakeModelApi()
    api.script({ text: 'ok' })
    const wire = wireOn(api.fetch)
    const init = modelCall()
    const waiting = wire.fetch(RESPONSES_URL, init)
    init.method = 'DELETE'
    init.body = JSON.stringify({ model: 'another-model' })
    init.headers = { Authorization: 'a later header' }
    const response = await waiting
    await response.text()
    await wire.settle()
    expect(api.requests[0]).toMatchObject({
      method: 'POST',
      body: { model: EVAL_MODEL_ID },
      headers: { authorization: HEADERS.Authorization },
    })
    expect(wire.problems).toEqual([])
  })

  it('refuses every request the harness does not make without a paid feature', async () => {
    const api = fakeModelApi()
    const wire = wireOn(api.fetch)
    const image = await wire.fetch(`${FAKE_MODEL_API_BASE_URL}/images/generations`, modelCall())
    expect(await refusalOf(image)).toBe('the evaluation sends no POST /images/generations')
    const counted = await wire.fetch(`${FAKE_MODEL_API_BASE_URL}/responses/input_tokens`, {
      ...modelCall('muse-spark-1.3'),
    })
    expect(await refusalOf(counted)).toContain('not muse-spark-1.3')
    expect(api.requests).toEqual([])
  })

  it('stops reading a reply the client stopped reading', async () => {
    const wire = wireOn(quietStream)
    const response = await wire.fetch(RESPONSES_URL, modelCall())
    const reader = response.body?.getReader()
    await reader?.read()
    await reader?.cancel()
    await wire.settle()
    expect(wire.problems).toEqual(['a reply ended without its usage'])
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
    expect(wire.problems).toEqual([
      'a reply stream failed before its usage: the connection was reset',
    ])
    expect(wireTotals(wire).attempts).toBe(1)
  })

  it.each([
    { input: -1, output: 1, cached: 0 },
    { input: 1, output: -1, cached: 0 },
    { input: 1, output: 1, cached: -1 },
    { input: 1, output: 1, cached: 2 },
    { input: 0.5, output: 1, cached: 0 },
    { input: 1, output: 0.5, cached: 0 },
    { input: 1, output: 1, cached: 0.5 },
    { input: Number.MAX_SAFE_INTEGER + 1, output: 1, cached: 0 },
    { input: 1, output: Number.MAX_SAFE_INTEGER + 1, cached: 0 },
    {
      input: Number.MAX_SAFE_INTEGER + 1,
      output: 1,
      cached: Number.MAX_SAFE_INTEGER + 1,
    },
  ])('refuses later arms after invalid usage %j', async (usage) => {
    const api = fakeModelApi()
    api.script({ text: 'ok', usage }, { text: 'a later call must not be sent' })
    const budget: EvalBudget = { spentUsd: 0 }
    const first = wireOn(api.fetch, budget)
    const response = await first.fetch(RESPONSES_URL, modelCall())
    await response.text()
    await expectUnpricedUsage(first, budget, api)
    expect(first.problems).toContain('a reply reported invalid token counts')
    expect(api.requests).toHaveLength(1)
  })

  it.each(['NaN', 'Infinity', '1e999', '-1e999'])(
    'refuses later arms after raw nonfinite SSE usage %s',
    async (count) => {
      // Use the existing completed-response fixture; nonfinite JSON cannot
      // survive JSON.stringify (NaN/Infinity become null).
      const raw = streamFor({ text: 'ok', usage: { input: 1, output: 1 } }, 'nonfinite').replace(
        '"input_tokens":1',
        () => `"input_tokens":${count}`,
      )
      const send: typeof fetch = () =>
        Promise.resolve(new Response(raw, { headers: { 'content-type': 'text/event-stream' } }))
      const api = fakeModelApi()
      const budget: EvalBudget = { spentUsd: 0 }
      const first = wireOn(send, budget)
      const response = await first.fetch(RESPONSES_URL, modelCall())
      await response.text()
      await expectUnpricedUsage(first, budget, api)
      expect(first.problems).toContain('a reply ended without its usage')
    },
  )

  it.each(['stream', 'network', 'server', 'body'])(
    'stops the shared run after unknown %s usage',
    async (kind) => {
      const api = fakeModelApi()
      api.script({ networkError: 'the network is down' })
      const budget: EvalBudget = { spentUsd: 0 }
      const nonStreamSend =
        kind === 'network'
          ? api.fetch
          : () => Promise.resolve(new Response(null, { status: kind === 'server' ? 500 : 200 }))
      const send = kind === 'stream' ? brokenStream : nonStreamSend
      const first = wireOn(send, budget)
      if (kind === 'network') {
        await expect(first.fetch(RESPONSES_URL, modelCall())).rejects.toThrow('the network is down')
      } else {
        const response = await first.fetch(RESPONSES_URL, modelCall())
        if (kind === 'stream') {
          await expect(response.text()).rejects.toThrow('the connection was reset')
        } else {
          await response.text()
        }
      }
      await first.settle()
      expect(budget.hasUnknownUsage).toBe(true)
      const later = wireOn(api.fetch, budget)
      expect(await refusalOf(await later.fetch(RESPONSES_URL, modelCall()))).toContain(
        'unknown usage',
      )
      expect(later.calls).toEqual([])
      expect(api.requests).toHaveLength(kind === 'network' ? 1 : 0)
    },
  )

  it.each(['unknown', 'spent'])('rechecks %s budget after a held request body', async (kind) => {
    const api = fakeModelApi()
    api.script({ text: 'ok' })
    const budget: EvalBudget = { spentUsd: 0 }
    const wire = wireOn(api.fetch, budget)
    const held = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        entered.resolve(undefined)
        await held.promise
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ model: EVAL_MODEL_ID })))
        controller.close()
      },
    })
    const init = { ...modelCall(), body, duplex: 'half' }
    const waiting = wire.fetch(RESPONSES_URL, init)
    await entered.promise
    if (kind === 'unknown') {
      budget.hasUnknownUsage = true
    } else {
      budget.spentUsd = EVAL_BUDGET_USD
    }
    held.resolve(undefined)
    expect(await refusalOf(await waiting)).toContain(kind === 'unknown' ? 'unknown usage' : 'spent')
    expect(api.requests).toEqual([])
  })
})
