import { Usd, type UsdAmount } from '../../src/shared/usd'
import { sumUsd } from '../../src/shared/usd'
import type { PaidUseDecision } from '../../src/shared/paid'
import { mkdtemp, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiClient, type ModelApiClientDeps } from '../../src/core/backends/modelapi/client'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { responseSchema, type CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import { estimateCostUsd, formatUsd } from '../../src/core/usage/insights'
import { PaidUsage, webSearchPriceUsd } from '../../src/core/paid/paidFeatures'
import { PaidAuthority } from '../../src/core/paid/paidAuthority'
import {
  PaidUseConsent,
  paidUseQuestion,
  type PaidUseAnswer,
} from '../../src/core/paid/paidConsent'
import { paidCostUsd, paidTallySchema } from '../../src/shared/paid'
import { parseExec } from '../../src/runtime/exec/execArgs'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { watchSessionTurns } from './helpers/sessionTurns'
import { removeFolder } from './helpers/temporaryFolders'

const settlementPricingFailure: NonNullable<ModelApiClientDeps['searchTokenCostUsd']> = (usage) =>
  usage.inputTokens === 100 ? undefined : Usd.from('0.0001').toAmount()

const PRICE = 0.0025
const BODY: CreateResponseBody = {
  model: 'muse-spark-1.3-contributor',
  input: [],
  instructions: 'Be brief',
  tools: [{ type: 'web_search' }],
  tool_choice: 'auto',
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  max_output_tokens: 100,
  max_tool_calls: 1,
  reasoning: { effort: 'low', summary: 'auto' },
  prompt_cache_key: 'stable',
  prompt_cache_retention: 'in_memory',
}
// Synthetic record for harness tests; the production port consumes M95's evidence-bearing record.
const CAPABILITIES: ReturnType<NonNullable<ModelApiHostDeps['modelCapabilities']>> = {
  hosted: {
    webSearch: { state: 'yes', value: { tool: 'web_search' } },
    maxToolCalls: { state: 'yes', value: true },
  },
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose()
  vi.restoreAllMocks()
})

function client(
  reservePaidRequest?: ModelApiClientDeps['reservePaidRequest'],
  pricing: Partial<
    Pick<
      ModelApiClientDeps,
      'webSearchPriceUsd' | 'searchTokenCostUsd' | 'apiKey' | 'paidAuthority'
    >
  > = {},
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const instance = new ModelApiClient({
    fetch: api.fetch,
    ...fakeModelApiClientSettings(log),
    ...(reservePaidRequest !== undefined && { reservePaidRequest }),
    ...pricing,
  })
  return { api, log, instance }
}

function claims() {
  const amounts: number[] = []
  const exactAmounts: (number | string)[] = []
  const settled: number[] = []
  const exactSettled: (number | string)[] = []
  const check = vi.fn()
  const reserve: NonNullable<ModelApiClientDeps['reservePaidRequest']> = (
    _body,
    _feature,
    _input,
    _signal,
    amount,
  ) => {
    if (amount === undefined) throw new Error('Expected search reservation')
    exactAmounts.push(amount)
    amounts.push(Number(amount))
    return Promise.resolve({
      reservedUsd: amount,
      check,
      settle: (costUsd) => {
        exactSettled.push(costUsd)
        settled.push(Number(costUsd))
        return Promise.resolve()
      },
    })
  }
  return { amounts, settled, exactAmounts, exactSettled, check, reserve }
}

async function cappedOneSearchHost() {
  return await host({
    capUsd: Usd.from('0.1').toAmount(),
    capabilities: () => CAPABILITIES,
    maxCalls: () => 1,
  })
}

async function host(
  options: {
    readonly daily?: ModelApiClientDeps['reservePaidRequest']
    readonly subagents?: boolean
    readonly isRemembered?: ModelApiHostDeps['isPaidUseRemembered']
    readonly capabilities?: ModelApiHostDeps['modelCapabilities']
    readonly capUsd?: UsdAmount
    readonly maxCalls?: () => number
    readonly consent?: ModelApiHostDeps['allowsPaidUse']
    readonly isOn?: () => boolean
    readonly journal?: SessionStore['budget']
    readonly pricing?: Partial<
      Pick<
        ModelApiClientDeps,
        'webSearchPriceUsd' | 'searchTokenCostUsd' | 'apiKey' | 'paidAuthority'
      >
    >
    readonly modelId?: string
    readonly notePaidUse?: ModelApiHostDeps['notePaidUse']
  } = {},
) {
  const t = client(options.daily, options.pricing)
  const store = {
    ...memorySessionStore(),
    ...(options.journal !== undefined && { budget: options.journal }),
  }
  const consent = vi.fn(
    options.consent ??
      ((request) => Promise.resolve(request.feature !== 'webSearch' || request.quote)),
  )
  const paidUses = vi.fn<ModelApiHostDeps['notePaidUse']>(options.notePaidUse)
  const engine = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: t.instance,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log: t.log,
    }),
    store,
    isPaidFeatureOn: (feature) =>
      (feature === 'webSearch' && (options.isOn?.() ?? true)) ||
      (feature === 'subagents' && options.subagents === true),
    isPaidUseRemembered: options.isRemembered ?? (() => false),
    sessionBudgetUsd: () => Usd.from(options.capUsd ?? 0).toAmount(),
    allowsPaidUse: consent,
    notePaidUse: paidUses,
    ...(options.capabilities !== undefined && { modelCapabilities: options.capabilities }),
    ...(options.maxCalls !== undefined && { webSearchMaxPerRequest: options.maxCalls }),
  })
  cleanup.push(() => engine.close())
  const session = await engine.startSession({
    workspaceRoot: '/ws',
    modelId: options.modelId ?? 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(session instanceof ModelApiSession)) throw new Error('expected Model API session')
  const watched = watchSessionTurns(session)
  const turn = async () => {
    await session.sendTurn([{ type: 'text', text: 'Find it' }])
    await watched.turnDone()
  }
  return { ...t, engine, session, store, consent, paidUses, turn, events: watched.events }
}

async function expectSearchUnavailable(t: Awaited<ReturnType<typeof host>>): Promise<void> {
  await t.turn()
  expect(t.consent).not.toHaveBeenCalled()
  expect(t.api.responseBodies()[0]?.['tools']).not.toContainEqual({ type: 'web_search' })
  expect(t.api.responseBodies()[0]).not.toHaveProperty('max_tool_calls')
}

async function dailyJournal() {
  const directory = await mkdtemp(path.join(tmpdir(), 'm106-search-'))
  cleanup.push(() => removeFolder(directory))
  return () =>
    createPaidDailyBudget({
      directory,
      now: () => new Date(2026, 9, 6, 12).getTime(),
      capUsd: () => Usd.from(0.5).toAmount(),
      isModelApi: () => true,
      sleep: () => Promise.resolve(),
    })
}

describe('M106 hosted-search bounds', () => {
  it('invalidates held consent after setModel and asks with the new immutable quote', async () => {
    const held = Promise.withResolvers<PaidUseDecision>()
    let isFirst = true
    const usage = new PaidUsage(new FakeLogOutputChannel())
    const t = await host({
      capabilities: () => CAPABILITIES,
      pricing: {
        webSearchPriceUsd: (model) =>
          model === 'custom-model' ? Usd.from('0.01').toAmount() : Usd.from('0.0025').toAmount(),
      },
      consent: (request) => {
        if (isFirst) {
          isFirst = false
          return held.promise
        }
        return Promise.resolve(request.feature === 'webSearch' && request.quote)
      },
      notePaidUse: (feature, units, settlement) => {
        usage.add(feature, units, settlement)
      },
    })
    t.api.script({ searches: [{}] })
    const pending = t.turn()
    await vi.waitFor(() => {
      expect(t.consent).toHaveBeenCalledOnce()
    })
    const old = t.consent.mock.calls[0]?.[0]
    if (old?.feature !== 'webSearch' || old.quote === undefined) throw new Error('Missing quote')
    await t.session.setModel('custom-model')
    held.resolve(old.quote)
    await pending
    expect(t.consent).toHaveBeenCalledTimes(2)
    expect(t.consent.mock.calls[1]?.[0]).toMatchObject({
      quote: { model: 'custom-model', tariffUsd: Usd.from('0.01').toAmount() },
    })
    expect(t.api.responseBodies()[0]).toMatchObject({
      model: 'custom-model',
      tools: expect.arrayContaining([{ type: 'web_search' }]),
    })
    expect(paidCostUsd('webSearch', usage.current)).toBe(Usd.from('0.01').toAmount())
  })

  it.each(['0.0025', '0.02', undefined])(
    'settles returned searches at the dispatch quote after pricing refresh to %s',
    async (nextPrice) => {
      let price: UsdAmount | undefined = Usd.from('0.01').toAmount()
      const c = claims()
      const usage = new PaidUsage(new FakeLogOutputChannel())
      const t = await host({
        daily: c.reserve,
        capUsd: Usd.from(0.1).toAmount(),
        capabilities: () => CAPABILITIES,
        maxCalls: () => 1,
        pricing: { webSearchPriceUsd: () => price },
        notePaidUse: (feature, units, settlement) => {
          usage.add(feature, units, settlement)
        },
      })
      t.api.script({
        searches: [{ isDoneOmitted: true }],
        onRequest: () => {
          price = nextPrice === undefined ? undefined : Usd.from(nextPrice).toAmount()
        },
        usage: { input: 100, output: 20 },
      })
      await t.turn()
      const exactTotal = sumUsd(
        Usd.from('0.01').toAmount(),
        estimateCostUsd({ inputTokens: 100, outputTokens: 20, cachedTokens: 0 }, 'muse-spark-1.3'),
      )
      expect(c.exactSettled).toEqual([exactTotal])
      expect(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd).toBe(exactTotal)
      expect(paidCostUsd('webSearch', usage.current)).toBe(Usd.from('0.01').toAmount())
      expect(t.events).toContainEqual(expect.objectContaining({ type: 'turnCompleted' }))
    },
  )

  it('records terminal returned fees before a fallible paid-use observer', async () => {
    const c = claims()
    const t = await host({
      daily: c.reserve,
      capUsd: Usd.from(0.1).toAmount(),
      capabilities: () => CAPABILITIES,
      maxCalls: () => 2,
      notePaidUse: () => {
        throw new Error('observer failed')
      },
    })
    if (t.store.budget === undefined) throw new Error('Missing journal')
    const reserved = vi.spyOn(t.store.budget, 'reserve')
    t.api.script({ searches: [{ isDoneOmitted: true }] })
    await t.turn()
    const claim = reserved.mock.calls[0]?.[2]
    if (claim === undefined) throw new Error('Missing claim')
    expect(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd).toBe(
      sumUsd(claim, Usd.from('-0.0025').toAmount()),
    )
    expect(c.exactSettled).toEqual([
      sumUsd(Usd.from(c.exactAmounts[0] ?? 0).toAmount(), Usd.from('-0.0025').toAmount()),
    ])
  })

  it('asks again and refunds the stale quote when pricing changes during key retrieval', async () => {
    let price = '0.0025'
    let hasAsked = false
    let hasChanged = false
    const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
    const c = claims()
    const t = await host({
      daily: c.reserve,
      capUsd: Usd.from(0.1).toAmount(),
      capabilities: () => CAPABILITIES,
      pricing: {
        webSearchPriceUsd: () => Usd.from(price).toAmount(),
        apiKey: async () => {
          if (hasAsked && !hasChanged) {
            hasChanged = true
            price = '0.01'
          }
          return await settings.apiKey()
        },
      },
      consent: (request) => {
        hasAsked = true
        return Promise.resolve(request.feature === 'webSearch' && request.quote)
      },
    })
    t.api.script({ searches: [{}] })
    await t.turn()
    expect(t.consent).toHaveBeenCalledTimes(2)
    expect(t.consent.mock.calls[1]?.[0]).toMatchObject({
      quote: { tariffUsd: Usd.from('0.01').toAmount() },
    })
    expect(c.exactSettled[0]).toBe('0')
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(t.paidUses.mock.calls[0]?.[2]).toMatchObject({
      quote: { tariffUsd: Usd.from('0.01').toAmount() },
      costUsd: Usd.from('0.01').toAmount(),
    })
  })

  it('refuses a bare boolean as hosted-search authorization', async () => {
    const t = await host({ consent: () => Promise.resolve(true), capabilities: () => CAPABILITIES })
    await t.turn()
    expect(t.api.responseBodies()[0]?.['tools']).not.toContainEqual({ type: 'web_search' })
  })

  it('quotes and tallies a verified USD 0.01 per-call provider tariff end to end', async () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    const t = await host({
      modelId: 'custom-model',
      capabilities: () => CAPABILITIES,
      maxCalls: () => 1,
      pricing: {
        webSearchPriceUsd: () => Usd.from(0.01).toAmount(),
        searchTokenCostUsd: () => Usd.from(0).toAmount(),
      },
      notePaidUse: (feature, units, price) => {
        usage.add(feature, units, price)
      },
    })
    t.api.script({ searches: [{}] })
    await t.turn()
    const request = t.consent.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('Missing consent request')
    expect(request).toMatchObject({
      feature: 'webSearch',
      priceUsd: Usd.from('0.01').toAmount(),
      quote: { model: 'custom-model', tariffUsd: Usd.from('0.01').toAmount() },
    })
    expect(paidUseQuestion(request).detail).toContain('$10.00 per 1,000 searches')
    const tally = paidTallySchema.parse(usage.current)
    expect(tally.webSearchCharges).toEqual([{ units: 1, priceUsd: Usd.from('0.01').toAmount() }])
    expect(paidCostUsd('webSearch', tally)).toBe(Usd.from('0.01').toAmount())
  })

  it('reserves tokens plus the bound, then settles the captured U8 search call exactly', async () => {
    const c = claims()
    const log = new FakeLogOutputChannel()
    const capture: unknown = JSON.parse(
      readFileSync(path.join(__dirname, '../fixtures/m106/u8-hosted-bound.json'), 'utf8'),
    )
    if (typeof capture !== 'object' || capture === null || !('response' in capture))
      throw new Error('Missing U8 response')
    const response = responseSchema.parse(capture.response)
    const instance = new ModelApiClient({
      ...fakeModelApiClientSettings(log),
      reservePaidRequest: c.reserve,
      fetch: () =>
        Promise.resolve(
          new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`),
        ),
    })
    await Array.fromAsync(instance.streamResponse(BODY, new AbortController().signal))
    const estimate = estimateInput(requestParts(BODY), undefined).inputTokens
    expect(c.amounts).toEqual([
      Number(
        estimateCostUsd({ inputTokens: estimate, outputTokens: 100, cachedTokens: 0 }, BODY.model),
      ) + PRICE,
    ])
    expect(c.settled).toEqual([
      Number(
        estimateCostUsd({ inputTokens: 2119, outputTokens: 689, cachedTokens: 0 }, BODY.model),
      ) + PRICE,
    ])
  })

  it.each(['completed', 'incomplete', 'failed'] as const)(
    'settles every returned call in a %s response, including over-bound and failed calls',
    async (status) => {
      const c = claims()
      const t = client(c.reserve)
      t.api.script({
        text: 'Done',
        searches: [{ queries: ['one', 'two'] }, { status: 'failed' }, { isDoneOmitted: true }],
        usage: { input: 100, output: 20 },
        ...(status === 'incomplete' && { incomplete: { reason: 'max_output_tokens' } }),
        ...(status === 'failed' && { failed: { code: 'server_error', message: 'failed' } }),
      })
      await Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal))
      expect(c.settled).toEqual([
        Number(
          estimateCostUsd({ inputTokens: 100, outputTokens: 20, cachedTokens: 0 }, BODY.model),
        ) +
          3 * PRICE,
      ])
      expect(t.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('3 calls above its bound of 1'),
      )
    },
  )

  it('retains token liability and counts search exactly when terminal usage is absent', async () => {
    const c = claims()
    const t = client(c.reserve)
    t.api.script({ omitUsage: true, searches: [{}, {}] })
    await Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal))
    expect(c.settled).toEqual([(c.amounts[0] ?? 0) + PRICE])
  })

  it('retains the allowance and all observed over-bound fees when a stream is interrupted', async () => {
    const c = claims()
    const t = client(c.reserve)
    t.api.script({ omitTerminal: true, searches: [{}, {}, {}] })
    await Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal))
    expect(c.settled).toEqual([(c.amounts[0] ?? 0) + 2 * PRICE])
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('3 calls above its bound of 1'))
  })

  it('refuses unbounded daily search before reservation or fetch', async () => {
    const c = claims()
    const t = client(c.reserve)
    const { max_tool_calls: _bound, ...unbounded } = BODY
    await expect(
      Array.fromAsync(t.instance.streamResponse(unbounded, new AbortController().signal)),
    ).rejects.toThrow(UI_TEXT.sessionBudgetSearchUnavailable)
    expect(c.amounts).toEqual([])
    expect(t.api.requests).toEqual([])
  })

  it('refunds a final admission refusal and never fetches', async () => {
    const c = claims()
    c.check.mockImplementation(() => {
      throw new Error('cap changed')
    })
    const t = client(c.reserve)
    await expect(
      Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal)),
    ).rejects.toThrow('cap changed')
    expect(c.settled).toEqual([0])
    expect(t.api.requests).toEqual([])
  })

  it('offers bounded daily search after consent, even in Bypass, and fixes the session bound', async () => {
    const c = claims()
    const answer = Promise.withResolvers<boolean>()
    let maxCalls = 2
    const t = await host({
      daily: c.reserve,
      capabilities: () => CAPABILITIES,
      maxCalls: () => maxCalls,
      consent: async (request) =>
        (await answer.promise) && request.feature === 'webSearch' ? request.quote : undefined,
    })
    const pending = t.turn()
    await vi.waitFor(() => {
      expect(t.consent).toHaveBeenCalledOnce()
    })
    expect(t.api.requests).toEqual([])
    answer.resolve(true)
    await pending
    expect(t.api.responseBodies()[0]?.['max_tool_calls']).toBe(2)
    maxCalls = 7
    await t.turn()
    expect(t.api.responseBodies()[1]?.['max_tool_calls']).toBe(2)
    expect(c.amounts).toHaveLength(2)
  })

  it('admits capped search when the bound fits and settles the session in full', async () => {
    const t = await cappedOneSearchHost()
    t.api.script({ searches: [{}, { status: 'failed' }], usage: { input: 10, output: 5 } })
    if (t.store.budget === undefined) throw new Error('Missing session journal')
    const reserved = vi.spyOn(t.store.budget, 'reserve')
    await t.turn()
    await t.engine.close()
    expect(t.api.responseBodies()[0]?.['max_tool_calls']).toBe(1)
    expect(Number(reserved.mock.calls[0]?.[2])).toBeLessThanOrEqual(0.1)
    expect(Number(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd)).toBeCloseTo(
      0.00003375 + 2 * PRICE,
      12,
    )
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('2 calls above its bound of 1'))
  })

  it.each(['completed', 'failed'] as const)(
    'charges terminal-only calls in a %s response to the session and tally',
    async (status) => {
      const t = await cappedOneSearchHost()
      t.api.script({
        searches: [{ isDoneOmitted: true }, { isDoneOmitted: true }],
        usage: { input: 10, output: 5 },
        ...(status === 'failed' && { failed: { code: 'server_error', message: 'failed' } }),
      })
      await t.turn()
      await t.engine.close()
      expect(Number(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd)).toBeCloseTo(
        0.00003375 + 2 * PRICE,
        12,
      )
      expect(t.paidUses.mock.calls.reduce((total, [, units]) => total + units, 0)).toBe(2)
    },
  )

  it('keeps unknown token liability without counting observed search fees twice', async () => {
    const t = await cappedOneSearchHost()
    if (t.store.budget === undefined) throw new Error('Missing session journal')
    const reserved = vi.spyOn(t.store.budget, 'reserve')
    t.api.script({ searches: [{}, {}, {}], omitUsage: true })
    await t.turn()
    await t.engine.close()
    expect(Number(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd)).toBeCloseTo(
      Number(reserved.mock.calls[0]?.[2] ?? 0) + 2 * PRICE,
      12,
    )
  })

  it.each([false, true])(
    'releases unused session search allowance only with a terminal count (interrupted=%s)',
    async (interrupted) => {
      const c = claims()
      const t = await host({
        daily: c.reserve,
        capUsd: Usd.from(0.1).toAmount(),
        capabilities: () => CAPABILITIES,
      })
      if (t.store.budget === undefined) throw new Error('Missing session journal')
      const reserved = vi.spyOn(t.store.budget, 'reserve')
      t.api.script({ omitUsage: true, omitTerminal: interrupted })
      await t.turn()
      await t.engine.close()
      const allowance = Number(reserved.mock.calls[0]?.[2] ?? 0)
      const expected = allowance - (interrupted ? 0 : 5 * PRICE)
      expect(Number(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd)).toBeCloseTo(
        expected,
        12,
      )
      expect(c.settled[0]).toBeCloseTo((c.amounts[0] ?? 0) - (interrupted ? 0 : 5 * PRICE), 12)
      expect(t.events).toContainEqual(
        expect.objectContaining({
          type: 'backendNotice',
          text: fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: formatUsd(expected) }),
        }),
      )
    },
  )

  it('projects only the original reservation after a crash following one completed bounded search', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm106-search-crash-'))
    cleanup.push(() => removeFolder(directory))
    const create = () =>
      createSessionBudgetJournal({
        directory,
        sleep: () => Promise.resolve(),
        initialBudget: () =>
          Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
      })
    const journal = create()
    const reserve = vi.spyOn(journal, 'reserve')
    const t = await host({
      capUsd: Usd.from(0.1).toAmount(),
      capabilities: () => CAPABILITIES,
      maxCalls: () => 1,
      journal,
    })
    const release = Promise.withResolvers<boolean>()
    const held = Promise.withResolvers<boolean>()
    t.api.script({
      searches: [{}],
      omitTerminal: true,
      holdEof: release.promise,
      onEofHeld: () => {
        held.resolve(true)
      },
    })
    const turn = t.turn()
    try {
      await held.promise
      await vi.waitFor(() => {
        expect(t.paidUses).toHaveBeenCalledOnce()
      })
      const account = reserve.mock.calls[0]?.[1]
      if (account === undefined) throw new Error('Missing account')
      const projection = await create().read(t.session.sessionId, account)
      expect(projection.spentUsd).toBe(reserve.mock.calls[0]?.[2])
      expect(
        await readdir(
          path.join(directory, 'budget-journal', account, t.session.sessionId, 'claims'),
        ),
      ).toHaveLength(1)
    } finally {
      release.resolve(true)
      await turn
    }
  })

  it('sends nothing when a capped session cannot fit the search allowance', async () => {
    const t = await host({ capUsd: Usd.from(0.001).toAmount(), capabilities: () => CAPABILITIES })
    await t.turn()
    expect(t.api.requests).toEqual([])
  })

  it.each(['unknown', 'no'] as const)(
    'does not offer search with a %s bound record',
    async (state) => {
      const t = await host({
        capUsd: Usd.from(1).toAmount(),
        capabilities: () => ({
          hosted: {
            webSearch: { state: 'yes', value: { tool: 'web_search' } },
            maxToolCalls: { state },
          },
        }),
      })
      await expectSearchUnavailable(t)
    },
  )

  it.each(['unknown', 'no'] as const)(
    'does not offer search with a %s search record',
    async (state) => {
      const t = await host({
        capUsd: Usd.from(1).toAmount(),
        capabilities: () => ({
          hosted: {
            webSearch: { state },
            maxToolCalls: { state: 'yes', value: true },
          },
        }),
      })
      await expectSearchUnavailable(t)
    },
  )

  it.each([0, 21, 1.5])(
    'does not offer search with an invalid configured bound of %s',
    async (bound) => {
      const t = await host({
        capUsd: Usd.from(1).toAmount(),
        capabilities: () => CAPABILITIES,
        maxCalls: () => bound,
      })
      await expectSearchUnavailable(t)
    },
  )

  it('denied consent and an explicit off setting omit search and its bound', async () => {
    for (const isOn of [true, false]) {
      const c = claims()
      const t = await host({
        daily: c.reserve,
        capabilities: () => CAPABILITIES,
        isOn: () => isOn,
        consent: () => Promise.resolve(false),
      })
      await t.turn()
      expect(t.api.responseBodies()[0]?.['tools']).not.toContainEqual({ type: 'web_search' })
      expect(t.api.responseBodies()[0]).not.toHaveProperty('max_tool_calls')
      expect(c.amounts).toEqual([])
      expect(t.consent).toHaveBeenCalledTimes(isOn ? 1 : 0)
    }
  })

  it('adds only max_tool_calls to the baseline search request and keeps its prefix and key exact', async () => {
    const golden = z
      .object({ off: z.string(), on: z.string() })
      .parse(
        JSON.parse(
          readFileSync(path.join(__dirname, '../fixtures/m106/h-search-requests.json'), 'utf8'),
        ),
      )
    const off = await host()
    await off.turn()
    expect(JSON.stringify(off.api.responseBodies()[0])).toBe(golden.off)
    const on = await host({ capabilities: () => CAPABILITIES })
    await on.turn()
    const bound = on.api.responseBodies()[0]
    expect(JSON.stringify(bound)).toBe(golden.on)
    expect(bound?.['max_tool_calls']).toBe(5)
    if (bound === undefined) throw new Error('Missing request')
    const { max_tool_calls: _bound, ...withoutBound } = bound
    expect(JSON.stringify(withoutBound)).toBe(JSON.stringify(off.api.responseBodies()[0]))
  })

  it('uses the real shared daily journal and refuses another window at its cap', async () => {
    const create = await dailyJournal()
    const first = create()
    const seed = await first.judgeLedger.reserve(Usd.from(0.49).toAmount())
    await seed.settle(Usd.from(0.49).toAmount())
    const t = client((_body, _feature, _input, _signal, amount) => {
      if (amount === undefined) throw new Error('Missing allowance')
      return first.reserveExact(amount)
    })
    t.api.script({ searches: [{}], usage: { input: 100, output: 20 } })
    await Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal))
    const day = await create().latestDay()
    expect(Number(day.spentUsd)).toBeCloseTo(0.49 + PRICE + 0.000014, 12)
    await expect(create().judgeLedger.reserve(Usd.from(0.01).toAmount())).rejects.toThrow()
  })

  it('dispatches the affordable 200th search at exactly USD 0.50 with zero-priced provider tokens', async () => {
    const create = await dailyJournal()
    const daily = create()
    // The journal suite settles all 200 fees individually. Seed the first 199 here
    // to test actual dispatch at the cap without repeating its quadratic disk scans.
    const priorSearches = await daily.judgeLedger.reserve(Usd.from(0.4975).toAmount())
    await priorSearches.settle(Usd.from(0.4975).toAmount())
    const t = client(
      (_body, _feature, _input, _signal, amount) => {
        if (amount === undefined) throw new Error('Missing allowance')
        return daily.reserveExact(amount)
      },
      {
        searchTokenCostUsd: () => Usd.from(0).toAmount(),
        webSearchPriceUsd: () => Usd.from(PRICE).toAmount(),
      },
    )
    t.api.script({ searches: [{}] })
    await Array.fromAsync(
      t.instance.streamResponse(
        { ...BODY, model: 'zero-token-provider' },
        new AbortController().signal,
      ),
    )
    expect(t.api.responseBodies()).toHaveLength(1)
    const finalDay = await create().latestDay()
    expect(finalDay.spentUsd).toBe(Usd.from('0.5').toAmount())
    await expect(create().judgeLedger.reserve(Usd.from(PRICE).toAmount())).rejects.toThrow()
  })

  it('has no unverified tariff for another provider', () => {
    expect(webSearchPriceUsd('custom-model')).toBeUndefined()
    expect(webSearchPriceUsd(BODY.model)).toBe(Usd.from('0.0025').toAmount())
  })

  it('uses another provider through injected verified prices without a Meta model-id gate', async () => {
    const c = claims()
    const t = client(c.reserve, {
      webSearchPriceUsd: () => Usd.from(0.01).toAmount(),
      searchTokenCostUsd: (usage) =>
        Usd.from((usage.inputTokens + usage.outputTokens) / 1_000_000).toAmount(),
    })
    t.api.script({ searches: [{}], usage: { input: 100, output: 20 } })
    await Array.fromAsync(
      t.instance.streamResponse(
        { ...BODY, model: 'other-provider-model' },
        new AbortController().signal,
      ),
    )
    expect(c.settled).toEqual([0.01012])
    expect(t.api.responseBodies()[0]?.['model']).toBe('other-provider-model')
  })

  it.each([undefined, -1, NaN, Infinity])(
    'refuses an unverified token cost of %s before spending',
    async (cost) => {
      const c = claims()
      const t = client(c.reserve, {
        searchTokenCostUsd: () =>
          cost === undefined || !Number.isFinite(cost) ? undefined : Usd.from(cost).toAmount(),
      })
      await expect(
        Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal)),
      ).rejects.toThrow(fill(UI_TEXT.sessionBudgetUnpriced, { model: BODY.model }))
      expect(c.amounts).toEqual([])
      expect(t.api.requests).toEqual([])
    },
  )

  it('retains all observed fees if verified token pricing fails during settlement', async () => {
    const c = claims()
    const t = client(c.reserve, {
      searchTokenCostUsd: (usage) =>
        usage.inputTokens === 100 ? undefined : Usd.from(0.02).toAmount(),
    })
    t.api.script({ searches: [{}, {}, {}], usage: { input: 100, output: 20 } })
    await expect(
      Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal)),
    ).rejects.toThrow(
      fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: formatUsd(0.02 + 3 * PRICE) }),
    )
    expect(c.settled).toEqual([(c.amounts[0] ?? 0) + 2 * PRICE])
  })

  it('shows the retained sub-cent liability of USD 0.0026 when settlement pricing fails', async () => {
    const c = claims()
    const t = client(c.reserve, {
      searchTokenCostUsd: settlementPricingFailure,
    })
    t.api.script({ searches: [{}], usage: { input: 100, output: 20 } })
    await expect(
      Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal)),
    ).rejects.toThrow(fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: '$0.0026' }))
    expect(c.settled).toEqual([0.0026])
  })

  it('keeps hosted search refused in headless runs even with an explicit flag and hard budget', () => {
    expect(
      parseExec({ backend: 'modelApi', 'web-search': true, 'max-budget-usd': '1' }, ['Find it']),
    ).toEqual({ ok: false, reason: UI_TEXT.execWebSearchUnbounded })
  })

  it('releases unused terminal search allowance even when token pricing fails at settlement', async () => {
    const c = claims()
    const t = client(c.reserve, {
      searchTokenCostUsd: settlementPricingFailure,
    })
    t.api.script({ usage: { input: 100, output: 20 } })
    await expect(
      Array.fromAsync(
        t.instance.streamResponse({ ...BODY, max_tool_calls: 5 }, new AbortController().signal),
      ),
    ).rejects.toThrow(fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: '$0.00010' }))
    expect(c.amounts).toEqual([0.0126])
    expect(c.settled).toEqual([0.0001])
  })
})

function quotedConsent(authority: PaidAuthority, answer: PaidUseAnswer = 'once') {
  const ask = vi.fn(() => Promise.resolve(answer))
  const consent = new PaidUseConsent({
    authority,
    isOn: () => true,
    canRemember: () => true,
    readGrants: () => new Set(),
    writeGrants: () => Promise.resolve(),
    ask,
    log: new FakeLogOutputChannel(),
  })
  return { consent, ask }
}

it('R4 P2-3: two approved conversations both POST after an interleaved daily reservation', async () => {
  const authority = new PaidAuthority()
  const { consent, ask } = quotedConsent(authority)
  const held = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const budget = claims()
  let isFirst = true
  const t = await host({
    capabilities: () => CAPABILITIES,
    maxCalls: () => 1,
    pricing: { paidAuthority: authority },
    consent: (request) => consent.allows(request),
    daily: async (...args) => {
      if (isFirst) {
        isFirst = false
        held.resolve(undefined)
        await release.promise
      }
      return await budget.reserve(...args)
    },
  })
  t.api.script(
    { text: 'Second complete.', searches: [{}] },
    { text: 'First complete.', searches: [{}] },
  )
  const firstTurn = t.turn()
  await held.promise
  const second = await t.engine.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  const watched = watchSessionTurns(second)
  await second.sendTurn([{ type: 'text', text: 'Second search' }])
  await watched.turnDone()
  release.resolve(undefined)
  await firstTurn
  expect(ask).toHaveBeenCalledTimes(2)
  expect(t.api.responseBodies()).toHaveLength(2)
  expect(t.events).not.toContainEqual(
    expect.objectContaining({ type: 'turnCompleted', errorKind: 'modelApi' }),
  )
  expect(budget.exactSettled).toHaveLength(2)
})

it('R4 P2-4: a parent-authorized explorer and retried follow-up POST through the shared authority', async () => {
  const authority = new PaidAuthority()
  const { consent, ask } = quotedConsent(authority, 'always')
  const t = await host({
    capabilities: () => CAPABILITIES,
    maxCalls: () => 1,
    pricing: { paidAuthority: authority },
    consent: (request) => consent.allows(request),
    subagents: true,
    isRemembered: () => consent.isRemembered('webSearch'),
    daily: claims().reserve,
  })
  t.api.script(
    {
      calls: [
        {
          name: 'subagent_spawn',
          arguments: '{"role":"explorer","objective":"Research files"}',
          callId: 'spawn',
        },
      ],
    },
    { text: 'Complete.', searches: [{}] },
    { text: 'Complete.', searches: [{}] },
  )
  await t.session.sendTurn([{ type: 'text', text: 'Delegate research' }])
  await vi.waitFor(() => {
    expect(t.session.status).toBe('idle')
    expect(t.session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
      controlStatus: 'resultReady',
      result: { summary: 'Complete.' },
    })
  })
  expect(t.api.responseBodies()).toHaveLength(3)
  const child = t.session.history().items.find((item) => item.kind === 'subagent')
  if (child?.kind !== 'subagent' || child.subagentId === undefined) throw new Error('missing child')
  t.api.script({ httpError: { status: 429 } }, { text: 'Follow-up complete.', searches: [{}] })
  await t.session.messageSubagent(child.subagentId, 'Continue research', true)
  await vi.waitFor(() => {
    expect(t.session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
      result: { summary: 'Follow-up complete.' },
    })
  })
  expect(t.api.responseBodies()).toHaveLength(5)
  expect(t.api.responseBodies().every((body) => body['max_tool_calls'] === 1)).toBe(true)
  expect(ask.mock.calls).toHaveLength(3)
})
