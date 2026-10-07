import { describe, expect, it, vi } from 'vitest'
import { createRuntimeTab } from '../../../src/runtime/features/tab'
import type { TabEngineRequest } from '../../../src/core/tab/tabEngine'
import { PaidUsage } from '../../../src/core/paid/paidFeatures'
import { ModelApiClient, type ModelApiClientDeps } from '../../../src/core/backends/modelapi/client'
import { UI_TEXT, TAB_REPLY_OPEN_TAG, TAB_REPLY_CLOSE_TAG } from '../../../src/shared/constants'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_KEY,
} from '../../unit/helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { engineFixtures } from './fixtures'
import { enginePaidBudget } from './paidHarness'

const fixtures = engineFixtures()
const request: TabEngineRequest = {
  model: 'muse-spark-1.3',
  absolutePath: '/fixture/file.ts',
  relativePath: 'file.ts',
  languageId: 'typescript',
  prefix: 'const x = ',
  suffix: '',
  snippets: '',
  mode: 'fast',
  isInvoke: true,
  cursorLineBefore: 'const x = ',
  lineAbove: '',
  linesBelow: [],
  isCancelled: () => false,
}
async function setup(apiKey?: ModelApiClientDeps['apiKey']) {
  const directory = await fixtures.folder('m104-pb-tab-')
  const budget = enginePaidBudget(directory)
  const api = fakeModelApi()
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
    fetch: api.fetch,
    ...(apiKey !== undefined && { apiKey }),
  })
  const state = {
    isOn: true,
    canComplete: true,
    isCurrent: true,
    isPriced: true,
    isTariffCurrent: true,
  }
  const allows = vi.fn(() => Promise.resolve(true))
  const tariff = vi.fn(() => 0.25)
  const usage = new PaidUsage(new FakeLogOutputChannel(), () => {
    throw new Error('new selection tariff must never be used')
  })
  const service = createRuntimeTab(
    {
      stream: (body, signal, retries, beforeRun) =>
        client.streamResponse(body, signal, undefined, retries, beforeRun),
      budget,
      isOn: () => state.isOn,
      canComplete: () => state.canComplete,
      price: () =>
        state.isPriced
          ? { costUsd: 0.4, isCurrent: () => state.isTariffCurrent, receiptCost: tariff }
          : undefined,
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('retired')
      },
      allows,
      cancelPrompts: () => undefined,
      onSent: () => {
        usage.addTabRequest()
      },
      onUsage: (model, tokens, cost) => {
        usage.addTabUsage(model, tokens, cost)
      },
    },
    UI_TEXT,
    'en',
  )
  fixtures.own({
    dispose: async () => {
      await service.dispose()
      await budget.dispose()
    },
  })
  return { service, api, state, allows, budget, usage, tariff }
}

describe('F42 portable paid Tab', () => {
  it.each(['off', 'unsupported', 'unpriced', 'deny'] as const)(
    'refuses %s before any HTTP request or paid tally',
    async (reason) => {
      const rig = await setup()
      switch (reason) {
        case 'off': {
          rig.state.isOn = false
          break
        }
        case 'unsupported': {
          rig.state.canComplete = false
          break
        }
        case 'unpriced': {
          rig.state.isPriced = false
          break
        }
        default: {
          rig.allows.mockResolvedValue(false)
        }
      }
      await expect(rig.service.complete(request)).rejects.toThrow()
      expect(rig.api.responseBodies()).toHaveLength(0)
      expect(rig.usage.current.tabRequests ?? 0).toBe(0)
      if (reason !== 'deny') expect(rig.allows).not.toHaveBeenCalled()
      await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: 0 })
    },
  )
  it('publishes a suggestion early, then drains and settles its original tariff after owner release', async () => {
    const rig = await setup()
    const eof = Promise.withResolvers<undefined>()
    rig.api.script({ text: `${TAB_REPLY_OPEN_TAG}42${TAB_REPLY_CLOSE_TAG}`, holdEof: eof.promise })
    const answer = await rig.service.complete(request)
    expect(answer.completion).toBe('42')
    expect(rig.api.responseBodies()).toHaveLength(1)
    rig.state.isCurrent = false
    rig.state.isTariffCurrent = false
    const closing = rig.service.dispose()
    eof.resolve(undefined)
    await closing
    await answer.usage
    expect(rig.tariff).toHaveBeenCalledOnce()
    expect(rig.usage.current).toMatchObject({
      tabRequests: 1,
      tabUnknownRequests: 0,
      tabCostUsd: 0.25,
    })
    await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: 0.25 })
  })
  it('retains an uncertain claim when a sent stream has no usage', async () => {
    const rig = await setup()
    rig.api.script({ text: `${TAB_REPLY_OPEN_TAG}42${TAB_REPLY_CLOSE_TAG}`, omitUsage: true })
    const answer = await rig.service.complete(request)
    await expect(answer.usage).rejects.toThrow()
    await expect(rig.budget.latestDay()).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    expect(rig.usage.current).toMatchObject({ tabRequests: 1, tabUnknownRequests: 1 })
  })
  it('refunds an unsent claim when the key is absent without counting a paid request', async () => {
    const rig = await setup(() => Promise.resolve(undefined))
    await expect(rig.service.complete(request)).rejects.toThrow()
    expect(rig.api.responseBodies()).toHaveLength(0)
    expect(rig.usage.current.tabRequests ?? 0).toBe(0)
    await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: 0 })
  })
  it('rechecks the profile at the real client POST after an awaited key read', async () => {
    const reading = Promise.withResolvers<undefined>()
    const key = Promise.withResolvers<string | undefined>()
    const rig = await setup(() => {
      reading.resolve(undefined)
      return key.promise
    })
    const pending = rig.service.complete(request)
    const refused = expect(pending).rejects.toThrow('retired')
    await reading.promise
    rig.state.isCurrent = false
    key.resolve(FAKE_MODEL_API_KEY)
    await refused
    expect(rig.api.responseBodies()).toHaveLength(0)
    await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: 0 })
  })
  it.each([NaN, Infinity, -1])('refuses invalid immutable receipt costs (%s)', async (cost) => {
    const rig = await setup()
    rig.usage.addTabRequest()
    expect(() => {
      rig.usage.addTabUsage(
        request.model,
        { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
        cost,
      )
    }).toThrow()
    expect(rig.usage.current.tabUnknownRequests).toBe(1)
  })
  it('refuses a trigger cancelled during consent and refunds without dispatch', async () => {
    const rig = await setup()
    const state = { isCancelled: false }
    rig.allows.mockImplementation(() => {
      state.isCancelled = true
      return Promise.resolve(true)
    })
    await expect(
      rig.service.complete({ ...request, isCancelled: () => state.isCancelled }),
    ).rejects.toThrow()
    expect(rig.api.responseBodies()).toHaveLength(0)
    await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: 0 })
  })
  it('redacts document context before the actual parsed client request', async () => {
    const rig = await setup()
    rig.api.script({ text: `${TAB_REPLY_OPEN_TAG}42${TAB_REPLY_CLOSE_TAG}` })
    const answer = await rig.service.complete({
      ...request,
      prefix: `const key = "${FAKE_MODEL_API_KEY}"\nconst x = `,
    })
    await answer.usage
    expect(JSON.stringify(rig.api.responseBodies())).not.toContain(FAKE_MODEL_API_KEY)
  })
})
