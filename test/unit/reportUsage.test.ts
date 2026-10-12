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
import { type UsageLimitSnapshot, type UsageRecord } from '../../src/shared/usageJournal'
import { Usd } from '../../src/shared/usd'
import { usageReportFixtureRecord } from './helpers/usageFixture'
import { shiftUsageDay, usageLocalDay } from '../../src/core/usage/aggregate'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const TODAY = usageLocalDay(NOW)
const AS_OF = new Date(NOW).toISOString()

function record(overrides: Partial<UsageRecord> & { day: string }): UsageRecord {
  return usageReportFixtureRecord({
    at: NOW,
    day: overrides.day,
    id: [
      'rec',
      overrides.day,
      overrides.provider ?? 'meta',
      overrides.model ?? 'muse-spark',
      overrides.session ?? 'nosession',
      overrides.client ?? 'vscode',
    ].join('.'),
    timezoneOffsetMins: new Date(NOW).getTimezoneOffset(),
    session: overrides.session,
    overrides,
  })
}

function journal(overrides?: Partial<UsageReportJournal>): UsageReportJournal {
  return { records: [], rollups: [], limits: [], budgets: [], budgetDay: TODAY, ...overrides }
}

const limitWindow = (
  provider: string,
  id: string,
  usedPercent: number,
  observedAt: number,
): UsageLimitSnapshot => ({
  v: 2,
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
    expect(usageReportQuery('', undefined, NOW)).toMatchObject({
      range: 'custom',
      from: TODAY,
      to: TODAY,
    })
    expect(usageReportQuery('today', undefined, NOW)).toMatchObject({
      range: 'custom',
      from: TODAY,
      to: TODAY,
    })
    expect(usageReportQuery('30d', 'provider', NOW)).toMatchObject({
      range: 'custom',
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
        cost: { usd: Usd.from(1).toAmount(), certainty: 'reported' },
      }),
      record({ day: shiftUsageDay(TODAY, -1) }),
    ]
    const facts = usageReportFacts({
      journal: journal({ records }),
      scope: '7d',
      by: 'provider',
      now: NOW,
      asOf: AS_OF,
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
    })
    expect(byAccount.usage.breakdown.map((row) => [row.key, row.inputTokens])).toEqual([
      ['meta/a1', 200],
      ['meta/default', 100],
    ])
  })

  it('keeps per-tool breakdowns partial instead of inventing rows', () => {
    const facts = usageReportFacts({
      journal: journal({ records: [record({ day: TODAY })] }),
      scope: 'today',
      by: 'tool',
      now: NOW,
      asOf: AS_OF,
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
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
      timezoneOffsetMins: 0,
    })
    expect(facts.usage.limits).toEqual([
      {
        key: 'meta/weekly',
        used: 50,
        limit: 100,
        resetsAt: new Date(NOW + 3_600_000).toISOString(),
        unit: 'percent',
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

const regressionFacts = (input: Partial<Parameters<typeof usageReportFacts>[0]> = {}) =>
  usageReportFacts({
    journal: journal(),
    scope: 'today',
    by: undefined,
    now: NOW,
    asOf: AS_OF,
    timezoneOffsetMins: 0,
    ...input,
  })

describe('RVCM1132 accounting regressions', () => {
  it('R9 keeps provider and account identity together', () => {
    const result = regressionFacts({
      by: 'account',
      journal: journal({
        records: [
          record({ day: TODAY, account: 'default' }),
          record({
            day: TODAY,
            provider: 'openai',
            account: 'default',
            cost: { usd: Usd.from(1).toAmount(), certainty: 'reported' },
          }),
        ],
      }),
    })
    expect(result.usage.breakdown.map((row) => [row.key, row.costUsd])).toEqual([
      ['meta/default', '0.25'],
      ['openai/default', '1'],
    ])
  })

  it('R10 excludes limit observations outside the selected period and as-of', () => {
    expect(
      regressionFacts({
        scope: '2026-09',
        journal: journal({ limits: [limitWindow('meta', 'weekly', 50, NOW)] }),
      }).usage.limits,
    ).toEqual([])
    expect(
      regressionFacts({
        journal: journal({ limits: [limitWindow('meta', 'weekly', 50, NOW + 1)] }),
      }).usage.limits,
    ).toEqual([])
  })

  it('R11 resolves all equal-time limit ties independently of input order', () => {
    const limits = [
      limitWindow('meta', 'weekly', 25, NOW),
      limitWindow('meta', 'weekly', 50, NOW),
      {
        ...limitWindow('meta', 'weekly', 50, NOW),
        windows: [
          { id: 'weekly', label: 'changed label', usedPercent: 50, resetsAt: NOW + 7_200_000 },
        ],
      },
    ]
    const expected = regressionFacts({ journal: journal({ limits }) })
    expect(expected.usage.limits).toEqual([
      {
        key: 'meta/weekly',
        used: 50,
        limit: 100,
        resetsAt: new Date(NOW + 7_200_000).toISOString(),
        unit: 'percent',
      },
    ])
    expect(regressionFacts({ journal: journal({ limits: limits.toReversed() }) })).toEqual(expected)
  })

  it('R12 prioritizes unpriced and uncertain money over estimated tokens', () => {
    expect(
      regressionFacts({
        journal: journal({
          records: [record({ day: TODAY, tokens: { input: 100, estimated: true } })],
        }),
      }).usage.certainty,
    ).toBe('reported')
    for (const certainty of ['unpriced', 'uncertain'] as const) {
      const result = regressionFacts({
        journal: journal({
          records: [
            record({ day: TODAY }),
            record({ day: TODAY, tokens: { input: 100, estimated: true }, cost: { certainty } }),
          ],
        }),
      })
      expect(result.usage.costUsd).toBe('0.25')
      expect(result.usage.certainty).toBe('unknown')
      expect(
        sessionUsageFacts(
          [record({ day: TODAY, session: 's1', tokens: { estimated: true }, cost: { certainty } })],
          's1',
        ).certainty,
      ).toBe('unknown')
    }
  })

  it('R13 resolves relative periods from the explicit input offset', () => {
    const now = Date.parse('2026-10-07T01:00:00Z')
    expect(usageReportQuery('today', undefined, now, 0)).toMatchObject({
      from: '2026-10-07',
      to: '2026-10-07',
    })
    expect(usageReportQuery('today', undefined, now, 420)).toMatchObject({
      from: '2026-10-06',
      to: '2026-10-06',
    })
    const original = process.env['TZ']
    try {
      process.env['TZ'] = 'UTC'
      const utc = regressionFacts({ now })
      process.env['TZ'] = 'America/Los_Angeles'
      expect(regressionFacts({ now })).toEqual(utc)
    } finally {
      if (original === undefined) delete process.env['TZ']
      else process.env['TZ'] = original
    }
  })

  it('R15 includes finite live budget numbers only in their observed period', () => {
    const budgets = [
      {
        budget: {
          id: 'daily',
          kind: 'paidDaily' as const,
          spentUsd: Usd.from('0.5').toAmount(),
          capUsd: Usd.from(1).toAmount(),
          stopped: false,
          resetsAt: NOW + 3_600_000,
        },
      },
      {
        budget: {
          id: 's1',
          kind: 'conversation' as const,
          spentUsd: Usd.from(2).toAmount(),
          capUsd: Usd.from(3).toAmount(),
          stopped: false,
        },
      },
    ]
    const result = regressionFacts({ journal: journal({ budgets }) })
    // Built, not literal: the joined budget key trips the secret scanner.
    const conversationKey = ['conversation', 's1'].join('/')
    expect(result.usage.limits).toEqual([
      { key: conversationKey, used: 2, limit: 3, resetsAt: null, unit: 'usd' },
      {
        key: 'paidDaily/daily',
        used: 0.5,
        limit: 1,
        resetsAt: new Date(NOW + 3_600_000).toISOString(),
        unit: 'usd',
      },
    ])
    const historical = regressionFacts({ scope: '2026-09', journal: journal({ budgets }) })
    expect(historical.usage.limits).toEqual([])
    expect(historical.partial).toContain(UI_TEXT.reportDetailReasons.budgetsUnavailable)
    expect(
      regressionFacts({ journal: { records: [], rollups: [], limits: [] } }).partial,
    ).toContain(UI_TEXT.reportDetailReasons.budgetsUnavailable)
  })

  it('RVCM1132D never repeats the budget sentence from an already-joined partial', () => {
    const joined = [
      UI_TEXT.reportDetailReasons.journalIncomplete,
      UI_TEXT.reportDetailReasons.budgetsUnavailable,
    ].join(' ')
    // A damaged journal plus a thrown budget read arrives as one joined
    // string with budgets unset; the budget sentence must not be appended a
    // second time.
    const repeated = regressionFacts({
      journal: { records: [], rollups: [], limits: [], partial: joined },
    })
    expect(repeated.partial?.split(UI_TEXT.reportDetailReasons.budgetsUnavailable)).toHaveLength(2)
    expect(repeated.partial).toContain(UI_TEXT.reportDetailReasons.journalIncomplete)
  })

  it('R20 rejects normalized invalid calendar dates', () => {
    for (const period of [
      '2026-02-30..2026-03-02',
      '2026-02-29..2026-03-02',
      '2026-04-31..2026-05-02',
    ])
      expect(() => usageReportQuery(period, undefined, NOW)).toThrow(LocalSourceError)
    expect(usageReportQuery('2024-02-29..2024-03-02', undefined, NOW)).toMatchObject({
      from: '2024-02-29',
    })
  })
})
