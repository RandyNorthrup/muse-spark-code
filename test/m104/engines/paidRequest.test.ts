import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimePaidRequestAdmission } from '../../../src/runtime/features/paidRequest'
import { createRuntimePaidBudget } from '../../../src/runtime/features/paidBudget'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import { PaidUsage } from '../../../src/core/paid/paidFeatures'
import { UI_TEXT, MODEL_API_IMAGE_MODEL } from '../../../src/shared/constants'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_KEY,
} from '../../unit/helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'

const roots: string[] = []
const budgets: ReturnType<typeof createRuntimePaidBudget>[] = []
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
      capUsd: () => 0.5,
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
    state.isPriced ? { costUsd: 0.4, isCurrent: () => state.isCurrent } : undefined,
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
  it('reserves before the actual fake image transport and refuses its unaffordable next request', async () => {
    const { client, body, api, budget } = await setup()
    const image = await client.createImage(body, new AbortController().signal)
    expect(image.data).toHaveLength(1)
    expect(api.imageBodies()).toHaveLength(1)
    expect(await budget.latestDay()).toMatchObject({ spentUsd: 0.4 })
    await expect(client.createImage(body, new AbortController().signal)).rejects.toThrow()
    expect(api.imageBodies()).toHaveLength(1)
    expect(await budget.latestDay()).toMatchObject({ spentUsd: 0.4 })
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
    expect(await budget.latestDay()).toMatchObject({ spentUsd: 0 })
  })

  it.each(['openai', 'anthropic', 'gemini', 'xai', 'openrouter', 'ollama', 'custom'])(
    'accounts verified %s tariffs without a Meta fallback',
    (provider) => {
      const cost = vi.fn((model: string) => (model === `${provider}/model` ? 0.25 : undefined))
      const usage = new PaidUsage(new FakeLogOutputChannel(), cost)
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
        subagentCostUsd: 0.25,
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
