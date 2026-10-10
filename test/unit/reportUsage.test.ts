// M113 C-M113-2: the usage report reads M102's journal through aggregate.ts.
import { describe, expect, it } from 'vitest'
import { codeUnitCompare, LocalSourceError } from '../../src/core/reporting/sources/local'
import { UI_TEXT } from '../../src/shared/constants'
import { aggregateUsage } from '../../src/core/usage/aggregate'
import {
  sessionTurnCount,
  sessionUsageFacts,
  usageReportFacts,
  usageReportQuery,
  type UsageReportJournal,
} from '../../src/core/usage/reportUsage'
import {
  usageRecordSchema,
  type UsageLimitSnapshot,
  type UsageRecord,
} from '../../src/shared/usageJournal'
import { shiftUsageDay, usageLocalDay } from '../../src/core/usage/aggregate'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const TODAY = usageLocalDay(NOW)
const AS_OF = new Date(NOW).toISOString()

function record(overrides: Partial<UsageRecord> & { day: string }): UsageRecord {
  return usageRecordSchema.parse({
    v: 1,
    type: 'usage',
    id: [
      'rec',
      overrides.day,
      overrides.provider ?? 'meta',
      overrides.model ?? 'muse-spark',
      overrides.session ?? 'nosession',
      overrides.client ?? 'vscode',
    ].join('.'),
    at: NOW,
    timezoneOffsetMins: new Date(NOW).getTimezoneOffset(),
    client: 'vscode',
    backend: 'modelApi',
    provider: 'meta',
    model: 'muse-spark',
    kind: 'turn',
    tokens: { input: 100, output: 20 },
    cost: { usd: 0.25, certainty: 'reported' },
    outcome: 'completed',
    startedAt: NOW,
    ...overrides,
  })
}

function journal(overrides?: Partial<UsageReportJournal>): UsageReportJournal {
  return { records: [], rollups: [], limits: [], ...overrides }
}

const limitWindow = (
  provider: string,
  id: string,
  usedPercent: number,
  observedAt: number,
): UsageLimitSnapshot => ({
  v: 1,
  id: `lim-${provider}-${id}`,
  at: observedAt,
  day: usageLocalDay(observedAt),
  timezoneOffsetMins: 0,
  client: 'vscode',
  backend: 'modelApi',
  provider,
  type: 'limit',
  source: 'headers',
  observedAt,
  windows: [{ id, usedPercent, resetsAt: observedAt + 3_600_000 }],
})

describe('usage report facts', () => {
  it('maps every documented period onto the page query range', () => {
    expect(usageReportQuery('', undefined, NOW)).toMatchObject({ range: 'today' })
    expect(usageReportQuery('today', undefined, NOW)).toMatchObject({ range: 'today' })
    expect(usageReportQuery('30d', 'provider', NOW)).toMatchObject({
      range: '30d',
      groupBy: 'provider',
    })
    expect(usageReportQuery('week', undefined, NOW)).toMatchObject({ range: 'custom' })
    const week = usageReportQuery('week', undefined, NOW)
    if (week.range !== 'custom') throw new Error('week must be custom')
    expect(week.to).toBe(TODAY)
    expect(usageReportQuery('month', undefined, NOW).range).toBe('custom')
    const month = `${TODAY.slice(0, 8)}15`
    const monthQuery = usageReportQuery(TODAY.slice(0, 7), undefined, NOW)
    expect(monthQuery.range).toBe('custom')
    const day = shiftUsageDay(TODAY, -2)
    expect(usageReportQuery(`${day}..${TODAY}`, undefined, NOW)).toMatchObject({
      range: 'custom',
      from: day,
      to: TODAY,
    })
    expect(month < TODAY || month >= TODAY).toBe(true)
  })

  it('rejects periods outside the documented grammar without guessing', () => {
    for (const scope of ['yesterday', '2026-13', `${TODAY}..${shiftUsageDay(TODAY, -1)}`, '7dd']) {
      expect(() => usageReportQuery(scope, undefined, NOW)).toThrow(LocalSourceError)
    }
  })

  it('reports the same totals as the usage page for the same range', () => {
    const records = [
      record({ day: TODAY }),
      record({
        day: TODAY,
        provider: 'openai',
        model: 'gpt',
        cost: { usd: 1, certainty: 'reported' },
      }),
      record({ day: shiftUsageDay(TODAY, -1) }),
    ]
    const facts = usageReportFacts({
      journal: journal({ records }),
      scope: '7d',
      by: 'provider',
      now: NOW,
      asOf: AS_OF,
    })
    const page = aggregateUsage(
      records,
      [],
      { range: '7d', groupBy: 'provider', metric: 'cost' },
      NOW,
    )
    expect(facts.usage.inputTokens).toBe(page.totals.tokens.input)
    expect(facts.usage.outputTokens).toBe(page.totals.tokens.output)
    expect(facts.usage.breakdown).toHaveLength(page.breakdown.length)
    expect(facts.usage.breakdown.map((row) => row.key).toSorted(codeUnitCompare)).toEqual([
      'meta',
      'openai',
    ])
    expect(facts.observedAt).toBe(AS_OF)
    expect(facts.partial).toBeUndefined()
    expect(facts.usage.period).toBe('7d')
  })

  it('carries certainty honestly: reported, estimated, then unknown', () => {
    const reported = usageReportFacts({
      journal: journal({ records: [record({ day: TODAY })] }),
      scope: 'today',
      by: undefined,
      now: NOW,
      asOf: AS_OF,
    })
    expect(reported.usage.certainty).toBe('reported')
    expect(reported.usage.costUsd).toBe('0.25')
    // Model rows carry their provider: two providers sharing a model stay distinct.
    expect(reported.usage.breakdown.map((row) => row.key)).toEqual(['meta/muse-spark'])
    const estimated = usageReportFacts({
      journal: journal({
        records: [record({ day: TODAY, cost: { certainty: 'estimated' } })],
      }),
      scope: 'today',
      by: undefined,
      now: NOW,
      asOf: AS_OF,
    })
    expect(estimated.usage.certainty).toBe('estimated')
    expect(estimated.usage.costUsd).toBeNull()
    const unknown = usageReportFacts({
      journal: journal({
        records: [record({ day: TODAY, cost: { certainty: 'unpriced' } })],
      }),
      scope: 'today',
      by: undefined,
      now: NOW,
      asOf: AS_OF,
    })
    expect(unknown.usage.certainty).toBe('unknown')
  })

  it('groups kept records by session and account, defaulting absent owners', () => {
    const records = [
      record({ day: TODAY, session: 's1', account: 'a1' }),
      record({ day: TODAY, session: 's1', account: 'a1' }),
      record({ day: TODAY }),
    ]
    const bySession = usageReportFacts({
      journal: journal({ records }),
      scope: 'today',
      by: 'session',
      now: NOW,
      asOf: AS_OF,
    })
    expect(bySession.usage.breakdown.map((row) => [row.key, row.inputTokens])).toEqual([
      ['s1', 200],
      ['unknown', 100],
    ])
    const byAccount = usageReportFacts({
      journal: journal({ records }),
      scope: 'today',
      by: 'account',
      now: NOW,
      asOf: AS_OF,
    })
    expect(byAccount.usage.breakdown.map((row) => [row.key, row.inputTokens])).toEqual([
      ['a1', 200],
      ['default', 100],
    ])
  })

  it('keeps per-tool breakdowns partial instead of inventing rows', () => {
    const facts = usageReportFacts({
      journal: journal({ records: [record({ day: TODAY })] }),
      scope: 'today',
      by: 'tool',
      now: NOW,
      asOf: AS_OF,
    })
    expect(facts.usage.breakdown).toEqual([])
    expect(facts.partial).toBe(UI_TEXT.reportDetailReasons.toolBreakdownUnavailable)
    expect(facts.usage.inputTokens).toBe(100)
  })

  it('names rolled-up days as totals-only in session and account breakdowns', () => {
    const records = [record({ day: TODAY, session: 's1' })]
    const rollups = [
      {
        day: TODAY,
        client: 'vscode',
        backend: 'modelApi',
        provider: 'meta',
        model: 'muse-spark',
        kind: 'turn',
        totals: {
          records: 2,
          tokens: { input: 50, output: 5 },
          units: {},
          costs: [{ certainty: 'reported', records: 2 }],
          retries: 0,
          rateLimited: 0,
        },
        histogram: [],
      },
    ] as UsageReportJournal['rollups']
    const facts = usageReportFacts({
      journal: journal({ records, rollups }),
      scope: 'today',
      by: 'session',
      now: NOW,
      asOf: AS_OF,
    })
    expect(facts.usage.breakdown).toEqual([
      { key: 's1', inputTokens: 100, outputTokens: 20, costUsd: '0.25', certainty: 'reported' },
    ])
    expect(facts.partial).toBe(UI_TEXT.reportDetailReasons.rolledUpBreakdownExcluded)
    expect(facts.usage.inputTokens).toBe(150)
  })

  it('maps limit windows to percent-scale limits, latest observation winning', () => {
    const facts = usageReportFacts({
      journal: journal({
        limits: [
          limitWindow('meta', 'weekly', 25, NOW - 3_600_000),
          limitWindow('meta', 'weekly', 50, NOW),
        ],
      }),
      scope: 'today',
      by: undefined,
      now: NOW,
      asOf: AS_OF,
    })
    expect(facts.usage.limits).toEqual([
      {
        key: 'meta/weekly',
        used: 50,
        limit: 100,
        resetsAt: new Date(NOW + 3_600_000).toISOString(),
      },
    ])
  })
})

describe('session report inputs', () => {
  it('counts distinct turns, with zero reserved for an observed empty history', () => {
    expect(sessionTurnCount([{ turnId: 'a' }, { turnId: 'a' }, { turnId: 'b' }])).toBe(2)
    expect(sessionTurnCount([])).toBe(0)
    expect(sessionTurnCount([{ turnId: undefined }])).toBeNull()
  })

  it('summarizes one session from kept records, unknown when nothing was kept', () => {
    const records = [
      record({ day: TODAY, session: 's1', provider: 'meta', model: 'm1' }),
      record({ day: TODAY, session: 's2', provider: 'meta', model: 'm1' }),
    ]
    const facts = sessionUsageFacts(records, 's1')
    expect(facts.period).toBe('session')
    expect(facts.inputTokens).toBe(100)
    expect(facts.breakdown).toEqual([
      {
        key: 'meta/m1',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: '0.25',
        certainty: 'reported',
      },
    ])
    const missing = sessionUsageFacts(records, 's9')
    expect(missing.inputTokens).toBe(0)
    expect(missing.costUsd).toBeNull()
    expect(missing.certainty).toBe('unknown')
    expect(missing.cachedTokens).toBeNull()
  })
})
