import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimePaidRequestAdmission } from '../../../src/runtime/features/paidRequest'
import { createRuntimePaidBudget } from '../../../src/runtime/features/paidBudget'
import {
  ModelApiClient,
  type ResponseAttemptGuard,
} from '../../../src/core/backends/modelapi/client'
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'
import { PaidUsage } from '../../../src/core/paid/paidFeatures'
import { UI_TEXT, MODEL_API_IMAGE_MODEL } from '../../../src/shared/constants'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_KEY,
} from '../../unit/helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { Usd, type UsdAmount } from '../../../src/shared/usd'

// 0.17 keeps money as exact decimal strings (CAPS017).
const usd = (value: number): UsdAmount => Usd.from(value).toAmount()

const roots: string[] = []
const budgets: ReturnType<typeof createRuntimePaidBudget>[] = []
const responseBody: CreateResponseBody = {
  model: 'muse-spark-1.3',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }],
  instructions: 'fixture',
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'high', summary: 'auto' },
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  max_output_tokens: 100,
  prompt_cache_key: 'fixture',
  prompt_cache_retention: '24h',
}
const paidGuard: ResponseAttemptGuard = Object.assign(() => undefined, {
  paidFeature: 'subagents' as const,
})
async function responseFrames(client: ModelApiClient) {
  const types: string[] = []
  const frames = client.streamResponse(
    responseBody,
    new AbortController().signal,
    undefined,
    undefined,
    paidGuard,
  )
  for await (const frame of frames) types.push(frame.type)
  return types
}
afterEach(async () => {
  await Promise.all(budgets.splice(0).map((budget) => budget.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'm104-pb-request-'))
  roots.push(directory)
  const budget = createRuntimePaidBudget(
    {
      directory,
      now: Date.now,
      capUsd: () => usd(0.5),
      sleep: () => Promise.resolve(),
      assertCurrent: () => undefined,
      isLocalStorage: () => true,
    },
    UI_TEXT,
    'en',
  )
  budgets.push(budget)
  const state = { isOn: true, isCurrent: true, isPriced: true }
  const price = vi.fn(() =>
    state.isPriced ? { costUsd: usd(0.4), isCurrent: () => state.isCurrent } : undefined,
  )
  const reserve = runtimePaidRequestAdmission({ budget, isOn: () => state.isOn, price })
  const api = fakeModelApi()
  const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
  const client = new ModelApiClient({ ...settings, fetch: api.fetch, reservePaidRequest: reserve })
  const body = {
    model: MODEL_API_IMAGE_MODEL,
    prompt: 'fixture',
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
    output_format: 'png',
  } as const
  return { budget, state, price, reserve, api, client, settings, body }
}

describe('priced portable request admission', () => {
  it('settles the original verified request tariff after the selected model changes', async () => {
    const { budget, settings, api, state } = await setup()
    const receipt = vi.fn(() => 0.25)
    const admission = runtimePaidRequestAdmission({
      budget,
      isOn: () => true,
      price: () => ({ costUsd: usd(0.4), isCurrent: () => state.isCurrent, receiptCost: receipt }),
    })
    const client = new ModelApiClient({
      ...settings,
      fetch: api.fetch,
      reservePaidRequest: admission,
      paidResponseCost: admission.responseCost,
    })
    api.script({
      text: 'done',
      onRequest: () => {
        state.isCurrent = false
      },
    })
    await expect(responseFrames(client)).resolves.toContain('response.completed')
    expect(receipt).toHaveBeenCalledOnce()
    expect(receipt).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5, cachedTokens: 0 })
    await expect(budget.latestDay()).resolves.toMatchObject({ spentUsd: usd(0.25) })
  })
  it('retains liability for an unpriced response receipt instead of substituting Meta rates', async () => {
    const { budget, settings, api, reserve } = await setup()
    const client = new ModelApiClient({
      ...settings,
      fetch: api.fetch,
      reservePaidRequest: reserve,
      paidResponseCost: reserve.responseCost,
    })
    api.script({ text: 'done' })
    await expect(responseFrames(client)).resolves.toContain('response.completed')
    await expect(budget.latestDay()).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
  })
  it.each([NaN, Infinity, -1])(
    'retains liability for an invalid verified receipt cost (%s)',
    async (costUsd) => {
      const { budget, settings, api } = await setup()
      const admission = runtimePaidRequestAdmission({
        budget,
        isOn: () => true,
        price: () => ({ costUsd: usd(0.4), isCurrent: () => true, receiptCost: () => costUsd }),
      })
      const client = new ModelApiClient({
        ...settings,
        fetch: api.fetch,
        reservePaidRequest: admission,
        paidResponseCost: admission.responseCost,
      })
      api.script({ text: 'done' })
      await expect(responseFrames(client)).resolves.toContain('response.completed')
      await expect(budget.latestDay()).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    },
  )
  it('reserves before the actual fake image transport and refuses its unaffordable next request', async () => {
    const { client, body, api, budget } = await setup()
    const image = await client.createImage(body, new AbortController().signal)
    expect(image.data).toHaveLength(1)
    expect(api.imageBodies()).toHaveLength(1)
    expect(await budget.latestDay()).toMatchObject({ spentUsd: usd(0.4) })
    await expect(client.createImage(body, new AbortController().signal)).rejects.toThrow()
    expect(api.imageBodies()).toHaveLength(1)
    expect(await budget.latestDay()).toMatchObject({ spentUsd: usd(0.4) })
  })

  it.each(['off', 'unpriced', 'replaced'])(
    'dispatches nothing with %s admission',
    async (denied) => {
      const { client, body, api, state } = await setup()
      switch (denied) {
        case 'off': {
          state.isOn = false
          break
        }
        case 'unpriced': {
          state.isPriced = false
          break
        }
        case 'replaced': {
          {
            state.isCurrent = false
            // No default
          }
          break
        }
      }
      await expect(client.createImage(body, new AbortController().signal)).rejects.toThrow()
      expect(api.requests).toEqual([])
    },
  )

  it('rechecks selected capability/model after credential retrieval and refunds a known nonsent claim', async () => {
    const { body, api, state, settings, reserve, budget } = await setup()
    const reached = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const client = new ModelApiClient({
      ...settings,
      fetch: api.fetch,
      reservePaidRequest: reserve,
      apiKey: async () => {
        reached.resolve(undefined)
        await held.promise
        return FAKE_MODEL_API_KEY
      },
    })
    const requesting = client.createImage(body, new AbortController().signal)
    await reached.promise
    state.isCurrent = false
    held.resolve(undefined)
    await expect(requesting).rejects.toThrow('MHP_PAID_REQUEST_UNAVAILABLE')
    expect(api.requests).toEqual([])
    expect(await budget.latestDay()).toMatchObject({ spentUsd: usd(0) })
  })

  it.each(['openai', 'anthropic', 'gemini', 'xai', 'openrouter', 'ollama', 'custom'])(
    'accounts verified %s tariffs without a Meta fallback',
    (provider) => {
      const cost = vi.fn((model: string) => (model === `${provider}/model` ? 0.25 : undefined))
      const usage = new PaidUsage(new FakeLogOutputChannel(), undefined, cost)
      usage.add('subagents', 1)
      expect(() => {
        usage.addSubagentUsage(`${provider}/model`, {
          inputTokens: 100,
          outputTokens: 2,
          cachedTokens: 0,
        })
      }).not.toThrow()
      expect(usage.current).toMatchObject({
        subagentUnknownRequests: 0,
        subagentCostUsd: usd(0.25),
        subagentTokens: 102,
      })
      usage.add('subagents', 1)
      expect(() => {
        usage.addSubagentUsage('unknown', { inputTokens: 1, outputTokens: 1, cachedTokens: 0 })
      }).toThrow()
      expect(usage.current.subagentUnknownRequests).toBe(1)
    },
  )
})
