import { describe, expect, it } from 'vitest'
import {
  aggregateUsage,
  usageBurnProjection,
  usageLocalDay,
  usagePeriodDelta,
  usageSumUsd,
  usageWindowStatus,
  type UsageAggregateRow,
} from '../../src/core/usage/aggregate'
import {
  USAGE_BURN_MIN_MS,
  USAGE_HISTOGRAM_EDGES_MS,
  USAGE_STALE_MS,
  EXEC_USD_UNITS,
} from '../../src/shared/constants'
import {
  USAGE_CERTAINTIES,
  usageRecordSchema,
  type UsageRecord,
} from '../../src/shared/usageJournal'
import { usageTotalsSchema, usageQuerySchema, type UsageQuery } from '../../src/shared/usagePage'
import { formatUsd } from '../../src/shared/l10n/text'

const now = new Date(2026, 9, 5, 12).getTime()
const today = usageLocalDay(now)
const query: UsageQuery = { range: 'today', groupBy: 'provider', metric: 'cost' }
function record(extra: Partial<UsageRecord> = {}): UsageRecord {
  return usageRecordSchema.parse({
    v: 1,
    id: 'call',
    type: 'usage',
    at: now,
    startedAt: now - 1000,
    day: today,
    timezoneOffsetMins: new Date(now).getTimezoneOffset(),
    client: 'Zed',
    backend: 'modelApi',
    provider: 'meta',
    model: 'spark',
    kind: 'turn',
    tokens: { input: 100, cached: 20, output: 10, reasoning: 2 },
    cost: { certainty: 'computed', usd: 0.01 },
    outcome: 'completed',
    durationMs: 1000,
    firstTokenMs: 100,
    ...extra,
  })
}

describe('usage aggregation', () => {
  it('settles the cent boundary exactly in every monetary sum and grouping order', () => {
    const records = [0.005, 0.005, 0.005, 0.003, 0.002, 0.003, 0.001, 0.001].map((usd, index) =>
      record({ provider: index % 2 === 0 ? 'a' : 'b', cost: { certainty: 'computed', usd } }),
    )
    for (const calls of [records, records.toReversed()]) {
      const result = aggregateUsage(calls, [], query, now)
      expect(result.totals.costs[0]?.usd).toBe(0.025)
      for (const rows of [result.breakdown, result.buckets, result.features]) {
        const sum = usageSumUsd(rows.flatMap((row) => row.totals.costs.map((cost) => cost.usd)))
        expect(sum).toBe(0.025)
        expect(formatUsd(sum ?? 0, 2)).toBe('$0.03')
      }
    }
    expect(usageSumUsd([undefined, undefined])).toBeUndefined()
    expect(usageSumUsd([0, undefined])).toBe(0)
  })
  it('keeps randomized fixed-point settlements identical across orders, buckets, groups and serialized rollups', () => {
    let seed = 102
    const random = (max: number): number => {
      seed = (seed * 16_807) % 2_147_483_647
      return seed % max
    }
    const selected: UsageQuery = { ...query, range: '7d' }
    for (let trial = 0; trial < 24; trial += 1) {
      const records = Array.from({ length: 80 }, (_, index) => {
        const tag = random(6)
        return record({
          id: `call-${String(index)}`,
          provider: `provider-${String(tag % 2)}`,
          model: `model-${String(tag % 3)}`,
          kind: tag % 2 === 0 ? 'turn' : 'subagent',
          client: tag % 2 === 0 ? 'Zed' : 'cli',
          day: tag % 2 === 0 ? today : '2026-10-04',
          at: now - random(8) * 3_600_000,
          cost: {
            certainty: USAGE_CERTAINTIES[random(USAGE_CERTAINTIES.length)]!,
            usd: random(20_000) / EXEC_USD_UNITS,
            apiEquivalentUsd: random(20_000) / EXEC_USD_UNITS,
          },
        })
      })
      const rollups: UsageAggregateRow[] = []
      for (const provider of ['provider-0', 'provider-1']) {
        for (const model of ['model-0', 'model-1', 'model-2']) {
          const calls = records.filter((call) => call.provider === provider && call.model === model)
          const first = calls[0]
          if (first === undefined) continue
          const serialized = JSON.stringify(aggregateUsage(calls, [], selected, now).totals)
          const parsed: unknown = JSON.parse(serialized)
          rollups.push({
            ...first,
            totals: usageTotalsSchema.parse(parsed),
            histogram: Array.from({ length: USAGE_HISTOGRAM_EDGES_MS.length + 1 }, () => 0),
          })
        }
      }
      const shuffled = records
        .map((call) => ({ call, order: random(10_000) }))
        .toSorted((a, b) => a.order - b.order)
        .map(({ call }) => call)
      for (const groupBy of ['provider', 'model', 'kind', 'client'] as const) {
        for (const interval of ['hour', 'day', 'week'] as const) {
          for (const [calls, rows] of [
            [records, []],
            [shuffled, []],
            [[], rollups],
          ] as const) {
            const result = aggregateUsage(calls, rows, { ...selected, groupBy }, now, interval)
            for (const certainty of USAGE_CERTAINTIES) {
              for (const key of ['usd', 'apiEquivalentUsd'] as const) {
                const amounts = records
                  .filter((call) => call.cost.certainty === certainty)
                  .map((call) => Math.round((call.cost[key] ?? 0) * EXEC_USD_UNITS))
                const expected =
                  amounts.length === 0
                    ? undefined
                    : amounts.reduce((sum, units) => sum + units, 0) / EXEC_USD_UNITS
                const amount = result.totals.costs.find((cost) => cost.certainty === certainty)?.[
                  key
                ]
                expect(amount).toBe(expected)
                for (const groups of [result.breakdown, result.buckets, result.features]) {
                  const sum = usageSumUsd(
                    groups.map(
                      (row) => row.totals.costs.find((cost) => cost.certainty === certainty)?.[key],
                    ),
                  )
                  expect(sum).toBe(expected)
                  expect(sum === undefined ? undefined : formatUsd(sum, 2)).toBe(
                    amount === undefined ? undefined : formatUsd(amount, 2),
                  )
                }
              }
            }
          }
        }
      }
    }
  })
  it('refuses amounts and sums outside safe fixed-point precision', () => {
    expect(() => usageSumUsd([Number.MAX_SAFE_INTEGER])).toThrow('unsafe usage amount')
    const safe = Math.floor(Number.MAX_SAFE_INTEGER / EXEC_USD_UNITS)
    expect(() => usageSumUsd([safe, safe])).toThrow('unsafe usage sum')
    expect(() =>
      aggregateUsage(
        [
          record({ cost: { certainty: 'reported', usd: safe } }),
          record({ cost: { certainty: 'reported', usd: safe } }),
        ],
        [],
        query,
        now,
      ),
    ).toThrow('unsafe usage sum')
  })
  it('preserves unknown counters and separates every certainty, including plan equivalents and local zero', () => {
    const records = [
      record({
        tokens: {},
        cost: { certainty: 'unpriced' },
        durationMs: undefined,
        firstTokenMs: undefined,
      }),
      record({
        provider: 'ollama',
        tokens: {},
        cost: { certainty: 'local', usd: 0 },
        durationMs: undefined,
        firstTokenMs: undefined,
      }),
      record({ cost: { certainty: 'plan', apiEquivalentUsd: 2 }, tokens: {} }),
      record({ cost: { certainty: 'uncertain', usd: 3 }, tokens: {} }),
      record({ cost: { certainty: 'reported', usd: 1 }, tokens: {} }),
      record({ cost: { certainty: 'estimated', usd: 4 }, tokens: {} }),
    ]
    const result = aggregateUsage(records, [], query, now)
    expect(result.totals.records).toBe(6)
    expect(result.totals.tokens).toEqual({})
    expect(result.totals.cacheHitPercent).toBeUndefined()
    expect(result.totals.costs).toEqual(
      expect.arrayContaining([
        { certainty: 'unpriced', records: 1 },
        { certainty: 'local', records: 1, usd: 0 },
        { certainty: 'plan', records: 1, apiEquivalentUsd: 2 },
        { certainty: 'uncertain', records: 1, usd: 3 },
      ]),
    )
    expect(aggregateUsage([], [], query, now).totals.durationMs).toBeUndefined()
  })
  it('agrees across buckets, tables, features and metrics without charging cached or reasoning twice', () => {
    const records = Array.from({ length: 1000 }, (_, index) =>
      record({
        id: `call-${String(index)}`,
        provider: `provider-${String(index % 9)}`,
        kind: index % 2 === 0 ? 'turn' : 'subagent',
        client: index % 2 === 0 ? 'Zed' : 'cli',
        tokens: {
          input: index,
          cached: index / 2 === Math.floor(index / 2) ? index / 2 : 0,
          output: 10,
          reasoning: 2,
        },
        retries: index % 3,
        rateLimited: index % 3 === 0,
      }),
    )
    for (const groupBy of ['provider', 'model', 'kind', 'client'] as const) {
      for (const metric of ['cost', 'tokens', 'requests', 'time'] as const) {
        const result = aggregateUsage(records, [], { ...query, groupBy, metric }, now)
        for (const rows of [result.breakdown, result.buckets, result.features]) {
          expect(rows.reduce((sum, row) => sum + row.totals.records, 0)).toBe(1000)
          expect(rows.reduce((sum, row) => sum + (row.totals.tokens.input ?? 0), 0)).toBe(499_500)
          expect(rows.reduce((sum, row) => sum + (row.totals.tokens.output ?? 0), 0)).toBe(10_000)
          expect(usageSumUsd(rows.flatMap((row) => row.totals.costs.map((cost) => cost.usd)))).toBe(
            10,
          )
        }
        expect(result.totals.cacheHitPercent).toBeCloseTo((124_750 / 499_500) * 100)
        expect(result.totals.tokensPerSecond).toBe(10)
        expect(result.totals.retries).toBe(999)
        expect(result.totals.rateLimited).toBe(334)
      }
    }
  })
  it('keeps model identities separate across providers and records retain their original local day and offset', () => {
    const records = [
      record({ provider: 'openai' }),
      record({ provider: 'openrouter' }),
      record({ day: '2026-10-04', at: now }),
    ]
    const result = aggregateUsage(records, [], { ...query, groupBy: 'model' }, now)
    expect(result.breakdown).toHaveLength(2)
    expect(result.previousTotals.records).toBe(1)
    const dst = [
      record({
        day: '2026-11-01',
        at: Date.parse('2026-11-01T08:30:00Z'),
        timezoneOffsetMins: 420,
      }),
      record({
        day: '2026-11-01',
        at: Date.parse('2026-11-01T09:30:00Z'),
        timezoneOffsetMins: 480,
      }),
    ]
    const custom: UsageQuery = { ...query, range: 'custom', from: '2026-11-01', to: '2026-11-01' }
    expect(aggregateUsage(dst, [], custom, now, 'hour').buckets.map((row) => row.at)).toEqual([
      Date.parse('2026-11-01T08:00:00Z'),
      Date.parse('2026-11-01T09:00:00Z'),
    ])
    expect(aggregateUsage(dst, [], custom, now, 'week').buckets[0]?.day).toBe('2026-10-26')
  })
  it('uses recorded half-hour offsets and bounded stable model identifiers', () => {
    const at = Date.parse('2026-10-05T00:10:00Z')
    const call = record({
      at,
      timezoneOffsetMins: -330,
      model: 'm'.repeat(256),
      provider: 'p'.repeat(256),
    })
    const result = aggregateUsage([call], [], { ...query, groupBy: 'model' }, now)
    expect(result.buckets[0]?.at).toBe(Date.parse('2026-10-04T23:30:00Z'))
    expect(result.breakdown[0]?.id).toHaveLength(64)
    expect(result.buckets[0]?.groups[0]?.id).toBe(result.breakdown[0]?.id)
    expect(usageTotalsSchema.safeParse(result.totals).success).toBe(true)
  })
  it('compares equal calendar periods for every preset and custom range', () => {
    for (const range of ['today', '7d', '30d', '90d', 'custom'] as const) {
      const q = usageQuerySchema.parse({
        ...query,
        range,
        ...(range === 'custom' && { from: '2026-09-30', to: '2026-10-05' }),
      })
      const result = aggregateUsage([], [], q, now)
      expect(Date.parse(result.to) - Date.parse(result.from)).toBe(
        Date.parse(result.previousTo) - Date.parse(result.previousFrom),
      )
      expect(Date.parse(result.from) - Date.parse(result.previousTo)).toBe(86_400_000)
    }
    expect(usagePeriodDelta(3, 2)).toBe(50)
    expect(usagePeriodDelta(1, 0)).toBeUndefined()
    expect(usagePeriodDelta(undefined, 1)).toBeUndefined()
  })
  it('merges raw and rolled-up histogram counts with p50/p95 in the same containing buckets', () => {
    const durations = [
      100, 200, 400, 900, 1800, 3500, 7000, 14_000, 28_000, 56_000, 120_000, 200_000,
    ]
    const raw = aggregateUsage(
      durations.map((durationMs) => record({ durationMs })),
      [],
      query,
      now,
    )
    const histogram = Array.from({ length: USAGE_HISTOGRAM_EDGES_MS.length + 1 }, () => 1)
    const rollup: UsageAggregateRow = {
      day: today,
      provider: 'meta',
      model: 'spark',
      kind: 'turn',
      client: 'Zed',
      backend: 'modelApi',
      totals: raw.totals,
      histogram,
    }
    const rolled = aggregateUsage([], [rollup], query, now)
    expect(rolled.totals).toEqual(raw.totals)
    expect(rolled.totals.p50Ms).toBe(4000)
    expect(rolled.totals.p95Ms).toBe(128_000)
    expect(
      aggregateUsage([record({ durationMs: undefined })], [], query, now).totals.p50Ms,
    ).toBeUndefined()
  })
  it('shows pace only for fresh windows with reported duration, never infers weekly duration', () => {
    const window = { id: 'window', usedPercent: 60, resetsAt: now + 150 * 60_000, windowMins: 300 }
    expect(usageWindowStatus(window, now, now)).toEqual({ freshness: 'fresh', pace: 'ahead' })
    expect(usageWindowStatus({ ...window, usedPercent: 55 }, now, now).pace).toBe('even')
    expect(usageWindowStatus({ ...window, usedPercent: 44 }, now, now).pace).toBe('under')
    expect(
      usageWindowStatus({ id: 'weekly', usedPercent: 60, resetsAt: now + 86_400_000 }, now, now),
    ).toEqual({ freshness: 'fresh' })
    expect(usageWindowStatus(window, now - USAGE_STALE_MS, now)).toEqual({ freshness: 'stale' })
    expect(usageWindowStatus({ ...window, resetsAt: now }, now, now)).toEqual({
      freshness: 'awaiting',
    })
  })
  it('projects only after thirty minutes of spend and never after reset', () => {
    expect(usageBurnProjection(2, now - USAGE_BURN_MIN_MS, now, now + USAGE_BURN_MIN_MS)).toBe(4)
    expect(usageBurnProjection(2, now - USAGE_BURN_MIN_MS + 1, now, now + 1)).toBeUndefined()
    expect(usageBurnProjection(2, undefined, now, now + 1)).toBeUndefined()
    expect(usageBurnProjection(2, now - USAGE_BURN_MIN_MS, now, now)).toBeUndefined()
  })
})
