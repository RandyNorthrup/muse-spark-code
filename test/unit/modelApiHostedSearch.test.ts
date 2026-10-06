import { mkdtemp, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiClient, type ModelApiClientDeps } from '../../src/core/backends/modelapi/client'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { responseSchema, type CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import { estimateCostUsd, formatUsd } from '../../src/core/usage/insights'
import { webSearchPriceUsd } from '../../src/core/paid/paidFeatures'
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

function client(reservePaidRequest?: ModelApiClientDeps['reservePaidRequest']) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const instance = new ModelApiClient({
    fetch: api.fetch,
    ...fakeModelApiClientSettings(log),
    ...(reservePaidRequest !== undefined && { reservePaidRequest }),
  })
  return { api, log, instance }
}

function claims() {
  const amounts: number[] = []
  const settled: number[] = []
  const check = vi.fn()
  const reserve: NonNullable<ModelApiClientDeps['reservePaidRequest']> = (
    _body,
    _feature,
    _input,
    _signal,
    amount,
  ) => {
    if (amount === undefined) throw new Error('Expected search reservation')
    amounts.push(amount)
    return Promise.resolve({
      reservedUsd: amount,
      check,
      settle: (costUsd) => {
        settled.push(costUsd)
        return Promise.resolve()
      },
    })
  }
  return { amounts, settled, check, reserve }
}

async function host(
  options: {
    readonly daily?: ModelApiClientDeps['reservePaidRequest']
    readonly capabilities?: ModelApiHostDeps['modelCapabilities']
    readonly capUsd?: number
    readonly maxCalls?: () => number
    readonly consent?: ModelApiHostDeps['allowsPaidUse']
    readonly isOn?: () => boolean
    readonly journal?: SessionStore['budget']
  } = {},
) {
  const t = client(options.daily)
  const store = {
    ...memorySessionStore(),
    ...(options.journal !== undefined && { budget: options.journal }),
  }
  const consent = vi.fn(options.consent ?? (() => Promise.resolve(true)))
  const paidUses = vi.fn<ModelApiHostDeps['notePaidUse']>()
  const engine = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: t.instance,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log: t.log,
    }),
    store,
    isPaidFeatureOn: (feature) => feature === 'webSearch' && (options.isOn?.() ?? true),
    sessionBudgetUsd: () => options.capUsd ?? 0,
    allowsPaidUse: consent,
    notePaidUse: paidUses,
    ...(options.capabilities !== undefined && { modelCapabilities: options.capabilities }),
    ...(options.maxCalls !== undefined && { webSearchMaxPerRequest: options.maxCalls }),
  })
  cleanup.push(() => engine.close())
  const session = await engine.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
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

describe('M106 hosted-search bounds', () => {
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
      estimateCostUsd({ inputTokens: estimate, outputTokens: 100, cachedTokens: 0 }, BODY.model) +
        PRICE,
    ])
    expect(c.settled).toEqual([
      estimateCostUsd({ inputTokens: 2119, outputTokens: 689, cachedTokens: 0 }, BODY.model) +
        PRICE,
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
        estimateCostUsd({ inputTokens: 100, outputTokens: 20, cachedTokens: 0 }, BODY.model) +
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
      consent: () => answer.promise,
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
    const t = await host({ capUsd: 0.1, capabilities: () => CAPABILITIES, maxCalls: () => 1 })
    t.api.script({ searches: [{}, { status: 'failed' }], usage: { input: 10, output: 5 } })
    if (t.store.budget === undefined) throw new Error('Missing session journal')
    const reserved = vi.spyOn(t.store.budget, 'reserve')
    await t.turn()
    await t.engine.close()
    expect(t.api.responseBodies()[0]?.['max_tool_calls']).toBe(1)
    expect(reserved.mock.calls[0]?.[2]).toBeLessThanOrEqual(0.1)
    expect(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd).toBeCloseTo(
      0.00003375 + 2 * PRICE,
      12,
    )
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('2 calls above its bound of 1'))
  })

  it.each(['completed', 'failed'] as const)(
    'charges terminal-only calls in a %s response to the session and tally',
    async (status) => {
      const t = await host({ capUsd: 0.1, capabilities: () => CAPABILITIES, maxCalls: () => 1 })
      t.api.script({
        searches: [{ isDoneOmitted: true }, { isDoneOmitted: true }],
        usage: { input: 10, output: 5 },
        ...(status === 'failed' && { failed: { code: 'server_error', message: 'failed' } }),
      })
      await t.turn()
      await t.engine.close()
      expect(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd).toBeCloseTo(
        0.00003375 + 2 * PRICE,
        12,
      )
      expect(t.paidUses.mock.calls.reduce((total, [, units]) => total + units, 0)).toBe(2)
    },
  )

  it('keeps unknown token liability without counting observed search fees twice', async () => {
    const t = await host({ capUsd: 0.1, capabilities: () => CAPABILITIES, maxCalls: () => 1 })
    if (t.store.budget === undefined) throw new Error('Missing session journal')
    const reserved = vi.spyOn(t.store.budget, 'reserve')
    t.api.script({ searches: [{}, {}, {}], omitUsage: true })
    await t.turn()
    await t.engine.close()
    expect(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd).toBeCloseTo(
      (reserved.mock.calls[0]?.[2] ?? 0) + 2 * PRICE,
      12,
    )
  })

  it.each([false, true])(
    'releases unused session search allowance only with a terminal count (interrupted=%s)',
    async (interrupted) => {
      const c = claims()
      const t = await host({ daily: c.reserve, capUsd: 0.1, capabilities: () => CAPABILITIES })
      if (t.store.budget === undefined) throw new Error('Missing session journal')
      const reserved = vi.spyOn(t.store.budget, 'reserve')
      t.api.script({ omitUsage: true, omitTerminal: interrupted })
      await t.turn()
      await t.engine.close()
      const allowance = reserved.mock.calls[0]?.[2] ?? 0
      const expected = allowance - (interrupted ? 0 : 5 * PRICE)
      expect(t.store.saved.get(t.session.sessionId)?.budgetSpentUsd).toBeCloseTo(expected, 12)
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
        initialBudget: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
      })
    const journal = create()
    const reserve = vi.spyOn(journal, 'reserve')
    const t = await host({
      capUsd: 0.1,
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
    const t = await host({ capUsd: 0.001, capabilities: () => CAPABILITIES })
    await t.turn()
    expect(t.api.requests).toEqual([])
  })

  it.each(['unknown', 'no'] as const)(
    'does not offer search with a %s bound record',
    async (state) => {
      const t = await host({
        capUsd: 1,
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
        capUsd: 1,
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
      const t = await host({ capUsd: 1, capabilities: () => CAPABILITIES, maxCalls: () => bound })
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
    const directory = await mkdtemp(path.join(tmpdir(), 'm106-search-'))
    cleanup.push(() => removeFolder(directory))
    const create = () =>
      createPaidDailyBudget({
        directory,
        now: () => new Date(2026, 9, 6, 12).getTime(),
        capUsd: () => 0.5,
        isModelApi: () => true,
        sleep: () => Promise.resolve(),
      })
    const first = create()
    const seed = await first.judgeLedger.reserve(0.49)
    await seed.settle(0.49)
    const t = client((_body, _feature, _input, _signal, amount) => {
      if (amount === undefined) throw new Error('Missing allowance')
      return first.judgeLedger.reserve(amount)
    })
    t.api.script({ searches: [{}], usage: { input: 100, output: 20 } })
    await Array.fromAsync(t.instance.streamResponse(BODY, new AbortController().signal))
    const day = await create().latestDay()
    expect(day.spentUsd).toBeCloseTo(0.49 + PRICE + 0.000014, 12)
    await expect(create().judgeLedger.reserve(0.01)).rejects.toThrow()
  })

  it('has no unverified tariff for another provider', () => {
    expect(webSearchPriceUsd('custom-model')).toBeUndefined()
    expect(webSearchPriceUsd(BODY.model)).toBe(PRICE)
  })

  it('uses another provider through injected verified prices without a Meta model-id gate', async () => {
    const c = claims()
    const api = fakeModelApi()
    api.script({ searches: [{}], usage: { input: 100, output: 20 } })
    const instance = new ModelApiClient({
      fetch: api.fetch,
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      reservePaidRequest: c.reserve,
      webSearchPriceUsd: () => 0.01,
      searchTokenCostUsd: (usage) => (usage.inputTokens + usage.outputTokens) / 1_000_000,
    })
    await Array.fromAsync(
      instance.streamResponse(
        { ...BODY, model: 'other-provider-model' },
        new AbortController().signal,
      ),
    )
    expect(c.settled).toEqual([0.01012])
    expect(api.responseBodies()[0]?.['model']).toBe('other-provider-model')
  })

  it.each([undefined, -1, NaN, Infinity])(
    'refuses an unverified token cost of %s before spending',
    async (cost) => {
      const c = claims()
      const api = fakeModelApi()
      const instance = new ModelApiClient({
        fetch: api.fetch,
        ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
        reservePaidRequest: c.reserve,
        searchTokenCostUsd: () => cost,
      })
      await expect(
        Array.fromAsync(instance.streamResponse(BODY, new AbortController().signal)),
      ).rejects.toThrow(fill(UI_TEXT.sessionBudgetUnpriced, { model: BODY.model }))
      expect(c.amounts).toEqual([])
      expect(api.requests).toEqual([])
    },
  )

  it('retains all observed fees if verified token pricing fails during settlement', async () => {
    const c = claims()
    const api = fakeModelApi()
    api.script({ searches: [{}, {}, {}], usage: { input: 100, output: 20 } })
    const instance = new ModelApiClient({
      fetch: api.fetch,
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      reservePaidRequest: c.reserve,
      searchTokenCostUsd: (usage) => (usage.inputTokens === 100 ? undefined : 0.02),
    })
    await expect(
      Array.fromAsync(instance.streamResponse(BODY, new AbortController().signal)),
    ).rejects.toThrow(
      fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: formatUsd(0.02 + 3 * PRICE) }),
    )
    expect(c.settled).toEqual([(c.amounts[0] ?? 0) + 2 * PRICE])
  })

  it('shows the retained sub-cent liability of USD 0.0026 when settlement pricing fails', async () => {
    const c = claims()
    const api = fakeModelApi()
    api.script({ searches: [{}], usage: { input: 100, output: 20 } })
    const instance = new ModelApiClient({
      fetch: api.fetch,
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      reservePaidRequest: c.reserve,
      searchTokenCostUsd: (usage) => (usage.inputTokens === 100 ? undefined : 0.0001),
    })
    await expect(
      Array.fromAsync(instance.streamResponse(BODY, new AbortController().signal)),
    ).rejects.toThrow(fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: '$0.0026' }))
    expect(c.settled).toEqual([0.0026])
  })

  it('keeps hosted search refused in headless runs even with an explicit flag and hard budget', () => {
    expect(
      parseExec({ backend: 'modelApi', 'web-search': true, 'max-budget-usd': '1' }, ['Find it']),
    ).toEqual({ ok: false, reason: UI_TEXT.execWebSearchUnbounded })
  })
})
