import { describe, expect, it, vi } from 'vitest'
import { createUsageService } from '../../src/core/usage/usageService'
import { usageServiceToPageMessageSchema } from '../../src/shared/usagePage'
import { serveUsageStdio } from '../../src/runtime/usage/usageServiceEntry'
import { usageFixtureDeps, usageFixtureRecord, usageNow } from './helpers/usageFixture'
import { aggregateUsage, usageLocalDay } from '../../src/core/usage/aggregate'

async function* nativeUsageRequests() {
  await Promise.resolve()
  yield JSON.stringify({ type: 'usage/ready' })
  yield 'private invalid JSON canary'
  yield JSON.stringify({ type: 'usage/refresh' }) + ' '.repeat(4096)
}

describe('shared usage service', () => {
  it('validates both directions and ready delivers a table and equivalent page totals', async () => {
    const deps = usageFixtureDeps()
    const service = createUsageService(deps)
    const replies = await service.handle({ type: 'usage/ready' })
    expect(replies.map((reply) => usageServiceToPageMessageSchema.parse(reply).type)).toEqual([
      'usage/table',
      'usage/state',
    ])
    const state = await service.snapshot()
    expect(state.totals.tokens.input).toBe(100)
    expect(state.breakdown[0]?.totals).toEqual(state.totals)
    expect(state.budgets[0]?.projectedUsd).toBe(4)
    expect(state.attempts).toEqual([{ day: usageLocalDay(usageNow), origin: 'turn', attempts: 31 }])
    expect(state.unreportedLimits).toEqual([
      { provider: 'openai', consoleUrl: 'https://platform.openai.com/usage' },
    ])
    expect(state.history.newerVersionRecords).toBe(2)
    expect(state.history.tornLines).toBe(1)
    expect(
      await service.handle({
        type: 'usage/deleteHistory',
        requestId: 'delete',
        path: '../paid-daily',
        approved: true,
      }),
    ).toEqual([{ type: 'usage/error', code: 'invalidMessage' }])
    expect(
      await service.handle({
        type: 'usage/query',
        query: {
          range: 'custom',
          from: '2026-10-05',
          to: '2026-10-01',
          groupBy: 'provider',
          metric: 'cost',
        },
      }),
    ).toEqual([{ type: 'usage/error', code: 'invalidMessage' }])
    expect(deps.journal.deleteHistory).not.toHaveBeenCalled()
  })
  it('names the actual record count before deletion and preserves budget sources and grants', async () => {
    const deps = usageFixtureDeps([usageFixtureRecord(), usageFixtureRecord({ id: 'second' })])
    const beforeBudgets = await deps.readBudgets()
    const service = createUsageService(deps)
    expect(await service.handle({ type: 'usage/deleteHistory', requestId: 'delete' })).toEqual([
      { type: 'usage/result', requestId: 'delete', action: 'deleteHistory', outcome: 'cancelled' },
    ])
    expect(deps.confirmDelete).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, detail: expect.stringContaining('2 usage records') }),
    )
    expect(deps.journal.deleteHistory).not.toHaveBeenCalled()
    deps.confirmDelete.mockResolvedValue(true)
    const replies = await service.handle({ type: 'usage/deleteHistory', requestId: 'delete' })
    expect(replies[0]).toEqual({
      type: 'usage/result',
      requestId: 'delete',
      action: 'deleteHistory',
      outcome: 'completed',
    })
    expect(deps.journal.deleteHistory).toHaveBeenCalledExactlyOnceWith()
    expect(await service.snapshot()).toHaveProperty('totals.records', 0)
    expect(await deps.readBudgets()).toEqual(beforeBudgets)
    expect(deps.setHistory).not.toHaveBeenCalled()
  })
  it('keeps live subscription and budget sources when history is off and performs no network call', async () => {
    const fetch = vi.fn(() => {
      throw new Error('network is forbidden')
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const deps = usageFixtureDeps([])
      const service = createUsageService(deps)
      await service.handle({ type: 'usage/setHistory', enabled: false })
      const state = await service.snapshot()
      expect(state.history.enabled).toBe(false)
      expect(state.limits).toHaveLength(1)
      expect(state.budgets).toHaveLength(1)
      expect(deps.journal.deleteHistory).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('exports exactly the selected aggregate through the save port and rejects detail outside retention', async () => {
    const deps = usageFixtureDeps()
    const service = createUsageService(deps)
    const query = { range: 'today', groupBy: 'provider', metric: 'tokens' } as const
    expect(
      await service.handle({ type: 'usage/export', requestId: 'export', query, format: 'json' }),
    ).toEqual([
      { type: 'usage/result', requestId: 'export', action: 'export', outcome: 'completed' },
    ])
    const exportState = await service.snapshot(query)
    expect(deps.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ content: JSON.stringify(exportState.totals) }),
    )
    deps.saveFile.mockResolvedValue(false)
    expect(
      await service.handle({
        type: 'usage/export',
        requestId: 'export',
        query,
        format: 'summaryCsv',
      }),
    ).toEqual([expect.objectContaining({ outcome: 'cancelled' })])
    expect(
      await service.handle({
        type: 'usage/export',
        requestId: 'old',
        query: { ...query, range: '90d' },
        format: 'callsCsv',
      }),
    ).toEqual([{ type: 'usage/error', requestId: 'old', code: 'exportRange' }])
    expect(deps.exportFile).toHaveBeenCalledTimes(2)
  })
  it('routes optional host actions and refuses unsupported or unsafe schemes', async () => {
    const deps = usageFixtureDeps()
    const service = createUsageService(deps)
    for (const input of [
      { type: 'usage/openSettings' },
      { type: 'usage/revealFolder' },
      { type: 'usage/openModels', provider: 'openai', model: 'model' },
      { type: 'usage/openExternal', url: 'https://platform.openai.com/usage' },
    ])
      expect(await service.handle(input)).toEqual([])
    expect(deps.openModels).toHaveBeenCalledWith('openai', 'model')
    expect(
      await service.handle({ type: 'usage/openExternal', url: 'file:///private/canary' }),
    ).toEqual([{ type: 'usage/error', code: 'unsupported' }])
    const { openSettings: _settings, openExternal: _external, ...limited } = deps
    const unsupported = createUsageService(limited)
    expect(await unsupported.handle({ type: 'usage/openSettings' })).toEqual([
      { type: 'usage/error', code: 'unsupported' },
    ])
  })
  it('passes the same cent-exact settlements to page buckets, tables and every export format', async () => {
    const records = [0.005, 0.005, 0.005, 0.003, 0.002, 0.003, 0.001, 0.001].map((usd, index) =>
      usageFixtureRecord({ id: `call-${String(index)}`, cost: { certainty: 'computed', usd } }),
    )
    const deps = usageFixtureDeps(records)
    const service = createUsageService(deps)
    const query = { range: 'today', groupBy: 'provider', metric: 'cost' } as const
    const state = await service.snapshot(query)
    expect(state.totals.costs[0]?.usd).toBe(0.025)
    expect(state.buckets[0]?.totals.costs).toEqual(state.totals.costs)
    expect(state.breakdown[0]?.totals.costs).toEqual(state.totals.costs)
    for (const format of ['callsCsv', 'summaryCsv', 'json'] as const) {
      expect(
        await service.handle({ type: 'usage/export', requestId: 'exact', format, query }),
      ).toEqual([
        { type: 'usage/result', requestId: 'exact', action: 'export', outcome: 'completed' },
      ])
      expect(deps.exportFile).toHaveBeenLastCalledWith(
        format,
        expect.objectContaining({ records }),
        state,
      )
      expect(deps.saveFile).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: JSON.stringify(state.totals) }),
      )
    }
  })
  it('sends paired rates through the checked page protocol without borrowing counters from other calls', async () => {
    const deps = usageFixtureDeps([
      usageFixtureRecord({ tokens: { input: 1000, output: 100 }, durationMs: undefined }),
      usageFixtureRecord({ id: 'cached', tokens: { input: 100, cached: 100 }, durationMs: 1000 }),
    ])
    const service = createUsageService(deps)
    const replies = await service.handle({ type: 'usage/refresh' })
    expect(replies[0]).toMatchObject({
      type: 'usage/state',
      state: { totals: { cacheHitPercent: 100, tokens: { input: 1100, output: 100 } } },
    })
    const state = await service.snapshot()
    expect(state.totals.tokensPerSecond).toBeUndefined()
    expect(state.buckets[0]?.totals.tokensPerSecond).toBeUndefined()
    expect(state.breakdown[0]?.totals.cacheHitPercent).toBe(100)
  })
  it('model detail respects provider identity and stored settlements remain unchanged', async () => {
    const records = [
      usageFixtureRecord(),
      usageFixtureRecord({
        id: 'second',
        provider: 'openrouter',
        cost: { certainty: 'reported', usd: 2 },
      }),
    ]
    const before = JSON.stringify(records)
    const service = createUsageService(usageFixtureDeps(records))
    const replies = await service.handle({
      type: 'usage/modelDetail',
      provider: 'openai',
      model: 'model',
    })
    expect(replies[0]?.type).toBe('usage/state')
    expect(await service.snapshot()).toHaveProperty('modelDetail.totals.records', 1)
    expect(JSON.stringify(records)).toBe(before)
    await service.handle({
      type: 'usage/query',
      query: { range: '7d', groupBy: 'model', metric: 'time' },
    })
    expect(await service.snapshot()).not.toHaveProperty('modelDetail')
  })
  it('sanitizes read, write and confirmation failures', async () => {
    const deps = usageFixtureDeps()
    const service = createUsageService(deps)
    deps.journal.read.mockRejectedValueOnce(new Error('/private/path credential canary'))
    expect(await service.handle({ type: 'usage/refresh' })).toEqual([
      { type: 'usage/error', code: 'readFailed' },
    ])
    deps.confirmDelete.mockRejectedValueOnce(new Error('private canary'))
    expect(await service.handle({ type: 'usage/deleteHistory', requestId: 'delete' })).toEqual([
      { type: 'usage/error', requestId: 'delete', code: 'writeFailed' },
    ])
    expect(deps.journal.deleteHistory).not.toHaveBeenCalled()
  })
  it('holds the second action until the first finishes and returns each ordered history state', async () => {
    const deps = usageFixtureDeps()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const setHistory = deps.setHistory.getMockImplementation()!
    deps.setHistory.mockImplementation(async (isEnabled) => {
      if (!isEnabled) {
        entered.resolve(undefined)
        await release.promise
      }
      await setHistory(isEnabled)
    })
    const service = createUsageService(deps)
    const first = service.handle({ type: 'usage/setHistory', enabled: false })
    await entered.promise
    const second = service.handle({ type: 'usage/setHistory', enabled: true })
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(deps.setHistory).toHaveBeenCalledExactlyOnceWith(false)
      expect(deps.journal.read).not.toHaveBeenCalled()
    } finally {
      release.resolve(undefined)
    }
    const replies = await Promise.all([first, second])
    expect(replies[0][0]).toMatchObject({
      type: 'usage/state',
      state: { history: { enabled: false } },
    })
    expect(replies[1][0]).toMatchObject({
      type: 'usage/state',
      state: { history: { enabled: true } },
    })
    expect(deps.setHistory.mock.calls).toEqual([[false], [true]])
    expect(await service.snapshot()).toHaveProperty('history.enabled', true)
  })
  it('retains range limit history for step charts and deduplicates identical live snapshots', async () => {
    const deps = usageFixtureDeps()
    const live = await deps.readLiveLimits()
    const journal = await deps.journal.read()
    const limit = live[0]!
    const older = { ...limit, id: 'earlier', observedAt: limit.observedAt - 1000 }
    const service = createUsageService({
      ...deps,
      journal: {
        ...deps.journal,
        read: () => Promise.resolve({ ...journal, limits: [older, limit] }),
      },
    })
    const state = await service.snapshot()
    expect(state.limits.map((entry) => entry.observedAt)).toEqual([
      older.observedAt,
      limit.observedAt,
    ])
  })
  it('labels a view-only later price and keeps original journal, page totals and trend settlements untouched', async () => {
    const records = [usageFixtureRecord({ cost: { certainty: 'unpriced' } })]
    const before = JSON.stringify(records)
    const laterRecord = usageFixtureRecord({ cost: { certainty: 'computed', usd: 3 } })
    const later = aggregateUsage(
      [laterRecord],
      [],
      { range: 'today', groupBy: 'provider', metric: 'cost' },
      usageNow,
    )
    const priceUnpriced = vi.fn(() =>
      Promise.resolve({ totals: later.totals, trend: later.buckets }),
    )
    const service = createUsageService({
      ...usageFixtureDeps(records),
      readModelPrice: () =>
        Promise.resolve({
          inputPerMillion: 1,
          outputPerMillion: 2,
          source: 'user',
          date: '2026-10-05',
        }),
      priceUnpriced,
    })
    const replies = await service.handle({
      type: 'usage/modelDetail',
      provider: 'openai',
      model: 'model',
    })
    expect(replies[0]).toMatchObject({
      type: 'usage/state',
      state: { modelDetail: { pricedLater: true, totals: later.totals, trend: later.buckets } },
    })
    expect(JSON.stringify(records)).toBe(before)
    expect(await service.snapshot()).toHaveProperty('totals.costs', [
      { certainty: 'unpriced', records: 1 },
    ])
    expect(priceUnpriced).toHaveBeenCalled()
  })
  it('checks NDJSON requests and replies for native JCEF, WebView2 and SWT transports', async () => {
    const service = createUsageService(usageFixtureDeps())
    const sent: string[] = []
    await serveUsageStdio(service, {
      requests: nativeUsageRequests(),
      sendLine: (line) => {
        sent.push(line)
        return Promise.resolve()
      },
    })
    const replies = sent.map((line) => {
      const raw: unknown = JSON.parse(line)
      return usageServiceToPageMessageSchema.parse(raw)
    })
    expect(replies.map((reply) => reply.type)).toEqual([
      'usage/table',
      'usage/state',
      'usage/error',
      'usage/error',
    ])
    expect(sent.join('')).not.toContain('canary')
    expect(replies[3]).toEqual({ type: 'usage/error', code: 'invalidMessage' })
  })
})
