import { describe, expect, it, vi } from 'vitest'
import { readAccountUsage } from '../../src/core/usage/accountUsage'
import { evaluateAccountThresholds } from '../../src/core/accounts/thresholds'
import type { AccountUsageTotals } from '../../src/shared/accounts'
import { parseUsd, usdNumber } from '../../src/shared/usd'
import { UI_TEXT } from '../../src/shared/constants'
import {
  USAGE_NOW,
  usageAccount,
  usageEvents,
  usageFixture,
  usageRecord,
} from './helpers/accounts/usage'

describe('M108 J account aggregation', () => {
  it('isolates provider and account identities, resolves legacy default locally and never writes labels', () => {
    const f = usageFixture()
    f.records.push(
      usageRecord({ provider: 'other', account: 'personal', settledUsd: '0.3' }),
      usageRecord({ account: undefined, settledUsd: '0.2' }),
    )
    const before = JSON.stringify(f.records)
    for (const row of f.records) Object.freeze(row)
    const report = f.report()
    expect(
      report.accounts.map((row) => [row.provider, row.account, row.totals.settledUsd]),
    ).toEqual([
      ['meta', 'default', '0.3'],
      ['meta', 'personal', '0.2'],
      ['other', 'personal', '0.3'],
    ])
    expect(report.accounts[0]?.label).toBe('Work label canary')
    expect(report.accounts[2]?.label).toBe('personal')
    expect(JSON.stringify(f.records)).toBe(before)
    expect(before).not.toContain('label canary')
    expect(() => JSON.stringify(report)).not.toThrow()
  })

  it('keeps exact nano-USD liability and safe counts across settlement, reservation and uncertainty', () => {
    const f = usageFixture()
    f.records.splice(1)
    f.records.push(usageRecord({ settledUsd: 0.2, reservedUsd: 0, uncertainUsd: 0 }))
    const row = f.report().accounts[0]!
    expect(row.totals).toEqual({
      settledUsd: '0.3',
      reservedUsd: '0.2',
      uncertainUsd: '0.000000001',
      liabilityUsd: '0.500000001',
      inputTokens: 20,
      outputTokens: 4,
      requests: 2,
    })
    expect(row.meters[0]).toMatchObject({
      value: '0.500000001',
      threshold: '0.3',
      progress: 100,
      isReached: true,
    })
    f.records.length = 0
    f.records.push(usageRecord({ settledUsd: '0.3', reservedUsd: 0, uncertainUsd: 0 }))
    f.catalog[0]!.accounts[0] = usageAccount('default', { spendUsd: { day: 0.3000000009 } })
    expect(f.report().accounts[0]?.meters[0]).toMatchObject({ threshold: '0.3', isReached: true })
    f.records.push(usageRecord({ requests: Number.MAX_SAFE_INTEGER }))
    expect(f.report).toThrow('spend ledger')
  })

  it('includes configured idle accounts and removed event identities without inventing usage', () => {
    const f = usageFixture()
    f.records.length = 0
    f.catalog[0]!.accounts.push(usageAccount('idle', { requests: { day: 0 } }, 2))
    f.events.push({ ...usageEvents()[1], previousAccount: 'removed', account: 'new-account' })
    const report = f.report()
    expect(report.accounts.map((row) => row.account)).toEqual([
      'default',
      'personal',
      'idle',
      'new-account',
      'removed',
    ])
    expect(report.accounts.every((row) => row.totals.requests === 0)).toBe(true)
    expect(report.accounts[2]?.meters[0]).toMatchObject({ isReached: true, progress: 100 })
  })

  it('uses half-open local calendar periods for selected totals and each threshold meter', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      spendUsd: { day: 10, week: 10, month: 10 },
      inputTokens: { day: 100 },
      outputTokens: { month: 100 },
      requests: { week: 100 },
    })
    f.records.length = 0
    for (const [day, settledUsd] of [
      [1, '1'],
      [5, '2'],
      [6, '3'],
      [7, '4'],
    ] as const)
      f.records.push(
        usageRecord({
          time: new Date(2026, 9, day).toISOString(),
          settledUsd,
          reservedUsd: 0,
          uncertainUsd: 0,
        }),
      )
    f.records.push(
      usageRecord({
        time: new Date(2026, 8, 30, 23, 59).toISOString(),
        settledUsd: '9',
        reservedUsd: 0,
        uncertainUsd: 0,
      }),
    )
    const queries: { start: string; end: string }[] = []
    const source = {
      ...f.source,
      records: (query: { start: string; end: string }) => {
        queries.push(query)
        return f.records
      },
    }
    const report = readAccountUsage({ source, catalog: f.catalog, now: USAGE_NOW, period: 'day' })
    expect(report.accounts[0]?.totals.settledUsd).toBe('3')
    expect(
      report.accounts[0]?.meters
        .filter((meter) => meter.metric === 'spendUsd')
        .map((meter) => [meter.period, meter.value, meter.resetAt]),
    ).toEqual([
      ['day', '3', new Date(2026, 9, 7).toISOString()],
      ['week', '5', new Date(2026, 9, 12).toISOString()],
      ['month', '6', new Date(2026, 10, 1).toISOString()],
    ])
    expect(queries).toEqual([
      {
        start: new Date(2026, 9, 1).toISOString(),
        end: new Date(USAGE_NOW + 1).toISOString(),
        includeOutstanding: true,
      },
    ])
    for (const [period, expected] of [
      ['week', '5'],
      ['month', '6'],
    ] as const)
      expect(
        readAccountUsage({ source, catalog: f.catalog, now: USAGE_NOW, period }).accounts[0]?.totals
          .settledUsd,
      ).toBe(expected)
  })

  it('handles a week crossing a month, leap months and DST midnight normalization', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', { requests: { day: 1, week: 1, month: 1 } })
    for (const now of [
      new Date(2026, 1, 1, 12),
      new Date(2024, 1, 29, 12),
      new Date(2026, 8, 6, 12),
      new Date(2026, 2, 8, 12),
    ]) {
      const report = readAccountUsage({
        source: f.source,
        catalog: f.catalog,
        now: now.getTime(),
        period: 'week',
      })
      const monday = now.getDate() - ((now.getDay() + 6) % 7)
      expect(report.start).toBe(new Date(now.getFullYear(), now.getMonth(), monday).toISOString())
      const resets = report.accounts[0]!.meters.map((meter) => meter.resetAt)
      expect(resets).toEqual([
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
        new Date(now.getFullYear(), now.getMonth(), monday + 7).toISOString(),
        new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      ])
    }
  })

  it('carries outstanding liability across calendar resets and matches admission without counting old settlements or duplicating current claims', () => {
    for (const metric of ['reservedUsd', 'uncertainUsd'] as const)
      for (const [created, observed] of [
        [new Date(2026, 9, 5, 23, 59), new Date(2026, 9, 6, 0, 1)],
        [new Date(2026, 8, 30, 23, 59), new Date(2026, 10, 2, 0, 1)],
        [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 0, 1)],
      ] as const) {
        const f = usageFixture()
        const account = usageAccount('default', { spendUsd: { day: 1, week: 1, month: 1 } })
        f.catalog[0]!.accounts[0] = account
        const old = usageRecord({
          account: undefined,
          time: created.toISOString(),
          settledUsd: '9',
          reservedUsd: '0',
          uncertainUsd: '0',
          [metric]: '1',
        })
        const records = [
          old,
          usageRecord({ time: observed.toISOString() }),
          usageRecord({ ...old, account: 'personal', [metric]: '2' }),
          usageRecord({ ...old, provider: 'other', [metric]: '3' }),
          usageRecord({ ...old, account: 'removed', [metric]: '4' }),
          usageRecord({ ...old, account: 'closed', [metric]: '0' }),
          usageRecord({ time: new Date(observed.getTime() + 1).toISOString(), [metric]: '9' }),
        ]
        const recordsReader = vi.fn(
          (query: { start: string; end: string; includeOutstanding?: true }) =>
            records.filter(
              (row) =>
                Date.parse(row.time) < Date.parse(query.end) &&
                (Date.parse(row.time) >= Date.parse(query.start) ||
                  (query.includeOutstanding === true &&
                    (parseUsd(row.reservedUsd) > 0 || parseUsd(row.uncertainUsd) > 0))),
            ),
        )
        const source = { ...f.source, records: recordsReader }
        const reservedUsd = metric === 'reservedUsd' ? '1.2' : '0.2'
        const uncertainUsd = metric === 'uncertainUsd' ? '1.000000001' : '0.000000001'
        for (const period of ['day', 'week', 'month'] as const) {
          const report = readAccountUsage({
            source,
            catalog: f.catalog,
            now: observed.getTime(),
            period,
          })
          const row = report.accounts[0]!
          const isOldInPeriod = Date.parse(old.time) >= Date.parse(report.start)
          expect(row.totals).toEqual({
            settledUsd: isOldInPeriod ? '9.1' : '0.1',
            reservedUsd,
            uncertainUsd,
            liabilityUsd: isOldInPeriod ? '10.300000001' : '1.300000001',
            inputTokens: isOldInPeriod ? 20 : 10,
            outputTokens: isOldInPeriod ? 4 : 2,
            requests: isOldInPeriod ? 2 : 1,
          })
          const admission = evaluateAccountThresholds({
            provider: 'meta',
            account,
            now: observed.getTime(),
            journal: {
              read: (query) => ({
                settledUsd: Date.parse(old.time) >= Date.parse(query.start) ? 9.1 : 0.1,
                reservedUsd: Number(reservedUsd),
                uncertainUsd: Number(uncertainUsd),
                inputTokens: 0,
                outputTokens: 0,
                requests: 0,
              }),
            },
          })
          for (const meter of row.meters) {
            const trigger = admission.find(
              (entry) => entry.kind === 'userCap' && entry.period === meter.period,
            )
            expect(meter).toMatchObject({
              value: String(trigger?.kind === 'userCap' ? trigger.value : undefined),
              progress: 100,
              isReached: true,
            })
          }
          expect(
            report.accounts.find((entry) => entry.account === 'personal')?.totals[metric],
          ).toBe('2')
          expect(report.accounts.find((entry) => entry.provider === 'other')?.totals[metric]).toBe(
            '3',
          )
          expect(report.accounts.find((entry) => entry.account === 'removed')?.totals[metric]).toBe(
            '4',
          )
          if (Date.parse(old.time) < Date.parse(recordsReader.mock.lastCall![0].start))
            expect(report.accounts.some((entry) => entry.account === 'closed')).toBe(false)
        }
        expect(recordsReader.mock.calls.every(([query]) => query.includeOutstanding === true)).toBe(
          true,
        )
        old[metric] = '0'
        expect(
          readAccountUsage({ source, catalog: f.catalog, now: observed.getTime(), period: 'day' })
            .accounts[0]?.totals.liabilityUsd,
        ).toBe('0.300000001')
      }
  })

  it('lists canonical committed swaps, spreads and stops chronologically in the selected interval', () => {
    const f = usageFixture()
    const events = usageEvents()
    f.events.push(
      ...events,
      { ...events[0], time: new Date(2026, 9, 5, 23, 59).toISOString() },
      { ...events[0], time: new Date(USAGE_NOW + 1).toISOString() },
    )
    const original = JSON.stringify(f.events)
    const report = f.report()
    expect(report.events.map((event) => event.type)).toEqual(['swap', 'spread', 'stop'])
    expect(report.events[0]).toEqual(events[1])
    expect(JSON.stringify(f.events)).toBe(original)
  })

  it('includes reservations and committed events at the observation instant and excludes future data', () => {
    const f = usageFixture()
    f.records.length = 0
    f.records.push(
      usageRecord({ time: new Date(USAGE_NOW).toISOString() }),
      usageRecord({ time: new Date(USAGE_NOW + 1).toISOString(), settledUsd: '9' }),
    )
    f.events.push(
      { ...usageEvents()[0], time: new Date(USAGE_NOW).toISOString() },
      { ...usageEvents()[0], time: new Date(USAGE_NOW + 1).toISOString() },
    )
    const report = f.report()
    expect(report.accounts[0]?.totals).toMatchObject({ requests: 1, liabilityUsd: '0.300000001' })
    expect(report.accounts[0]?.meters[0]?.isReached).toBe(true)
    expect(report.events).toHaveLength(1)
    expect(report.events[0]?.time).toBe(new Date(USAGE_NOW).toISOString())
  })

  it('rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs', () => {
    const badRows = [
      usageRecord({ label: 'label canary' }),
      usageRecord({ apiKey: 'credential-canary' }),
      usageRecord({ account: 'Label with spaces' }),
      usageRecord({ settledUsd: '-1' }),
      usageRecord({ reservedUsd: 'NaN' }),
      usageRecord({ uncertainUsd: '1e999' }),
      usageRecord({ inputTokens: 0.5 }),
      usageRecord({ outputTokens: Number.MAX_SAFE_INTEGER + 1 }),
      usageRecord({ time: 'tomorrow' }),
      usageRecord({ time: new Date(2026, 8, 1).toISOString(), settledUsd: 'NaN' }),
    ]
    for (const row of badRows) {
      const f = usageFixture()
      f.records.splice(0, f.records.length, row)
      expect(f.report).toThrow()
    }
    const f = usageFixture()
    f.events.push({ ...usageEvents()[0], label: 'label canary' })
    expect(f.report).toThrow()
    f.events.length = 0
    expect(() =>
      readAccountUsage({ source: f.source, catalog: f.catalog, period: 'day', now: NaN }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() =>
      readAccountUsage({
        source: f.source,
        catalog: [...f.catalog, ...f.catalog],
        period: 'day',
        now: USAGE_NOW,
      }),
    ).toThrow()
    f.catalog[0]!.accounts.push(usageAccount('default'))
    expect(f.report).toThrow()
  })

  it('shows missing or expired live meters as unavailable, scoped by both identities', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      planWindowPercent: { 'five-hour': 80 },
      rateLimitHeadroomPercent: { requests: 28, tokens: 25 },
    })
    const absent = f.report().accounts[0]!.meters
    expect(absent).toHaveLength(3)
    expect(
      absent.every(
        (meter) => meter.value === null && meter.isReached === null && meter.progress === null,
      ),
    ).toBe(true)
    const read = vi.fn(() => ({
      planWindows: {
        'five-hour': { usedPercent: 90, resetAt: new Date(USAGE_NOW - 1).toISOString() },
      },
      rateLimits: {
        requests: { limit: 25, remaining: 7, resetAt: new Date(USAGE_NOW - 1).toISOString() },
      },
    }))
    const expired = readAccountUsage({
      source: f.source,
      catalog: f.catalog,
      period: 'day',
      now: USAGE_NOW,
      limits: { read },
    })
    expect(read).toHaveBeenCalledExactlyOnceWith('meta', 'default')
    expect(expired.accounts[0]!.meters.every((meter) => meter.value === null)).toBe(true)
  })

  it('uses exact headroom cross multiplication and rejects malformed normalized buckets', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      planWindowPercent: { 'five-hour': 80 },
      rateLimitHeadroomPercent: { requests: 28.5 },
    })
    for (const [limit, remaining, threshold, isReached] of [
      [25, 7, 28, true],
      [7, 2, 28.5, false],
      [7, 1, 28.5, true],
    ] as const) {
      f.catalog[0]!.accounts[0] = usageAccount('default', {
        rateLimitHeadroomPercent: { requests: threshold },
      })
      const limits = {
        read: () => ({
          rateLimits: {
            requests: { limit, remaining, resetAt: new Date(USAGE_NOW + 1000).toISOString() },
          },
        }),
      }
      const row = readAccountUsage({
        source: f.source,
        catalog: f.catalog,
        period: 'day',
        now: USAGE_NOW,
        limits,
      }).accounts[0]!
      expect(row.meters[0]?.isReached).toBe(isReached)
      expect(
        evaluateAccountThresholds({
          account: f.catalog[0]!.accounts[0],
          provider: 'meta',
          now: USAGE_NOW,
          journal: {
            read: () => {
              throw new Error('No configured journal cap')
            },
          },
          limits,
        }).length > 0,
      ).toBe(isReached)
    }
    for (const [limit, remaining] of [
      [0, 0],
      [2, 3],
      [1.5, 1],
      [3, 0.5],
      [3, Number.MAX_SAFE_INTEGER + 1],
      [Number.MAX_SAFE_INTEGER + 1, 1],
    ] as const)
      expect(() =>
        readAccountUsage({
          source: f.source,
          catalog: f.catalog,
          period: 'day',
          now: USAGE_NOW,
          limits: {
            read: () => ({
              rateLimits: {
                requests: { limit, remaining, resetAt: new Date(USAGE_NOW + 1000).toISOString() },
              },
            }),
          },
        }),
      ).toThrow()
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      rateLimitHeadroomPercent: { requests: 28.1234567891 },
    })
    expect(f.report).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })

  it('validates captured plan percentages and reset timestamps rather than displaying malformed snapshots', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', { planWindowPercent: { 'five-hour': 80 } })
    for (const live of [
      { usedPercent: -1, resetAt: null },
      { usedPercent: 101, resetAt: null },
      { usedPercent: NaN, resetAt: null },
      { usedPercent: 50, resetAt: 'tomorrow' },
    ]) {
      expect(() =>
        readAccountUsage({
          source: f.source,
          catalog: f.catalog,
          now: USAGE_NOW,
          period: 'day',
          limits: { read: () => ({ planWindows: { 'five-hour': live } }) },
        }),
      ).toThrow()
    }
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      rateLimitHeadroomPercent: { tokens: 25 },
    })
    expect(() =>
      readAccountUsage({
        source: f.source,
        catalog: f.catalog,
        now: USAGE_NOW,
        period: 'day',
        limits: {
          read: () => ({
            rateLimits: { tokens: { limit: 100, remaining: 50, resetAt: 'tomorrow' } },
          }),
        },
      }),
    ).toThrow()
  })

  it('preserves fractional plan percentages and matches admission without money quantization', () => {
    const f = usageFixture()
    const threshold = 28.1234567892
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      planWindowPercent: { 'five-hour': threshold },
    })
    for (const usedPercent of [28.1234567891, threshold, 28.1234567893, 0.00000001]) {
      const limits = {
        read: () => ({ planWindows: { 'five-hour': { usedPercent, resetAt: null } } }),
      }
      const report = readAccountUsage({
        source: f.source,
        catalog: f.catalog,
        period: 'day',
        now: USAGE_NOW,
        limits,
      })
      const meter = report.accounts[0]!.meters[0]!
      const triggers = evaluateAccountThresholds({
        account: f.catalog[0]!.accounts[0],
        provider: 'meta',
        now: USAGE_NOW,
        journal: {
          read: () => {
            throw new Error('No journal cap')
          },
        },
        limits,
      })
      expect(meter.value).toBe(String(usedPercent))
      expect(meter.threshold).toBe(String(threshold))
      expect(meter.isReached).toBe(triggers.length > 0)
      if (usedPercent < threshold) expect(meter.progress).toBeLessThan(100)
    }
  })

  it('matches independently generated journals and the admission evaluator for every account and user meter', () => {
    const f = usageFixture()
    f.records.length = 0
    for (const provider of ['meta', 'other'])
      f.catalog.push({
        provider: `${provider}-generated`,
        label: provider,
        accounts: [
          usageAccount('default', {
            spendUsd: { day: 0.3, week: 0.4, month: 1 },
            inputTokens: { day: 100, month: 1000 },
            outputTokens: { day: 20, month: 200 },
            requests: { day: 10 },
          }),
          usageAccount('personal', { spendUsd: { day: 0.3 } }),
        ],
      })
    let seed = 108
    const expected = new Map<string, { nano: bigint; tokens: number; requests: number }>()
    for (let index = 0; index < 160; index++) {
      seed = (seed * 48_271) % 2_147_483_647
      const provider = seed % 2 === 0 ? 'meta-generated' : 'other-generated'
      const account = seed % 3 === 0 ? 'personal' : 'default'
      const nano = BigInt(seed % 10_000_000)
      const tokens = seed % 100
      const key = `${provider}:${account}`
      const previous = expected.get(key) ?? { nano: 0n, tokens: 0, requests: 0 }
      expected.set(key, {
        nano: previous.nano + nano,
        tokens: previous.tokens + tokens,
        requests: previous.requests + 1,
      })
      f.records.push(
        usageRecord({
          provider,
          account,
          settledUsd: `0.${String(nano).padStart(9, '0')}`,
          reservedUsd: 0,
          uncertainUsd: 0,
          inputTokens: tokens,
          outputTokens: 0,
        }),
      )
    }
    const report = f.report()
    for (const row of report.accounts) {
      if (!row.provider.endsWith('-generated')) continue
      const truth = expected.get(`${row.provider}:${row.account}`)!
      expect(parseUsd(row.totals.settledUsd)).toBe(truth.nano)
      expect(row.totals.inputTokens).toBe(truth.tokens)
      expect(row.totals.requests).toBe(truth.requests)
      const account = f.catalog
        .find((entry) => entry.provider === row.provider)!
        .accounts.find((entry) => entry.id === row.account)!
      const totals: AccountUsageTotals = {
        settledUsd: usdNumber(truth.nano),
        reservedUsd: 0,
        uncertainUsd: 0,
        inputTokens: truth.tokens,
        outputTokens: 0,
        requests: truth.requests,
      }
      const triggers = evaluateAccountThresholds({
        account,
        provider: row.provider,
        now: USAGE_NOW,
        journal: { read: () => totals },
      })
      for (const meter of row.meters) {
        expect(meter.isReached).toBe(
          triggers.some(
            (trigger) =>
              trigger.kind === 'userCap' &&
              trigger.metric === meter.metric &&
              trigger.period === meter.period,
          ),
        )
        expect(meter.progress).toBeGreaterThanOrEqual(0)
        expect(meter.progress).toBeLessThanOrEqual(100)
      }
    }
  })
})
