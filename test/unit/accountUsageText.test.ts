import { afterEach, describe, expect, it } from 'vitest'
import { readAccountUsage } from '../../src/core/usage/accountUsage'
import {
  accountUsageEventText,
  accountUsageMeterText,
  accountUsageRowText,
  accountUsageText,
} from '../../src/core/usage/usageText'
import { EN } from '../../src/shared/l10n/en'
import { formatPercent, setUiText } from '../../src/shared/l10n/text'
import {
  USAGE_NOW,
  usageAccount,
  usageEvents,
  usageFixture,
  usageRecord,
} from './helpers/accounts/usage'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('M108 J account text', () => {
  it('preserves fractional and scientific percentages while keeping the shared whole-percent default', () => {
    const meter = {
      metric: 'planWindow',
      window: 'five-hour',
      unit: 'percent',
      value: '28.1234567891',
      threshold: '28.1234567892',
      progress: 99,
      isReached: false,
      resetAt: null,
    } as const
    expect(accountUsageMeterText(meter).value).toBe('28.1234567891% / 28.1234567892%')
    expect(accountUsageMeterText({ ...meter, value: '1e-8' }).value).toBe(
      '0.00000001% / 28.1234567892%',
    )
    expect(formatPercent(42.5)).toBe('43%')
    expect(formatPercent(42.5, 2)).toBe('42.5%')
    expect(formatPercent(42.5)).toBe('43%')
  })

  it('shows settled spend, separate liability and tokens without binary dollar artifacts or rounding down', () => {
    const f = usageFixture()
    const report = f.report()
    const text = accountUsageText(report)
    expect(text).toContain('Meta · Work label canary: 1 request; $0.1000 spent.')
    expect(text).toContain('Reserved $0.2000; uncertain $0.000000001.')
    expect(text).toContain('Input tokens: 10')
    expect(text).toContain('Output tokens: 2')
    expect(text).toContain('$0.3001 / $0.3000')
    expect(text).toContain('Threshold reached')
    expect(text).not.toContain('00000000004')
    expect(text).not.toMatch(/\{\w+\}/)
    expect(text).not.toContain('Account events')
  })

  it('explains every swap, spread and stop, including cold-cache cost and known or unknown reset', () => {
    const f = usageFixture()
    f.events.push(...usageEvents())
    const report = f.report()
    const lines = report.events.map((event) => accountUsageEventText(event, report))
    expect(lines[0]).toContain(
      'Now on Meta · Personal label canary: Work label canary reached Spend in USD limit for Day: $0.3000.',
    )
    expect(lines[0]).toContain('Estimated context re-read cost: $0.000000001.')
    expect(lines[1]).toContain('worker worker-1 assigned.')
    expect(lines[2]).toContain('stopped at Vendor limit (rateLimited). Reset time is unknown.')
    expect(accountUsageText(report)).toContain('Account events')
    for (const line of lines) expect(accountUsageText(report)).toContain(line)
    const swap = report.events[0]!
    if (swap.type !== 'swap') throw new Error('Fixture needs a swap')
    expect(accountUsageEventText({ ...swap, type: 'stop' }, report)).toContain('Resets ')
    expect(
      accountUsageEventText(
        { ...swap, provider: 'deleted-provider', previousAccount: 'removed' },
        report,
      ),
    ).toContain('removed reached')
    expect(accountUsageEventText({ ...swap, provider: 'deleted-provider' }, report)).toContain(
      'deleted-provider · personal',
    )
  })

  it('shows carried reservations and uncertain liability after a reset while settled spend stays in its period', () => {
    const f = usageFixture()
    f.records.splice(
      0,
      f.records.length,
      usageRecord({
        time: new Date(2026, 8, 30, 23, 59).toISOString(),
        settledUsd: '9',
        reservedUsd: '1',
        uncertainUsd: '2',
      }),
    )
    const text = accountUsageText(f.report())
    expect(text).toContain('Meta · Work label canary: 0 requests; $0.0000 spent.')
    expect(text).toContain('Reserved $1.00; uncertain $2.00.')
    expect(text).toContain('$3.00 / $0.3000')
    expect(text).toContain('Threshold reached')
  })

  it('reads installed strings, plurals, USD, percentages and dates at render time', () => {
    const f = usageFixture()
    f.events.push(...usageEvents())
    const report = f.report()
    setUiText(
      {
        ...EN,
        accounts: {
          ...EN.accounts,
          title: 'Konten',
          summary: '{provider} · {account}: {requests}; {cost} ausgegeben.',
          usageLiability: 'Reserviert {reserved}; ungewiss {uncertain}.',
          usageReset: 'Zurückgesetzt {reset}.',
          usageRateTokens: 'Tokenanzahl',
        },
      },
      'de',
    )
    const text = accountUsageText(report)
    expect(text).toMatch(/^Konten\n/)
    expect(text).toContain('0,10')
    expect(text).toContain('Reserviert')
    expect(text).toContain('Zurückgesetzt')
    expect(
      accountUsageMeterText({
        metric: 'rateHeadroom',
        window: 'tokens',
        unit: 'percent',
        value: '28.5',
        threshold: '28.75',
        progress: 28,
        isReached: false,
        resetAt: null,
      }),
    ).toMatchObject({ label: 'Rate-limit headroom (Tokenanzahl)', value: '28,5 % / 28,75 %' })
    expect(
      accountUsageRowText({
        ...report.accounts[0]!,
        totals: { ...report.accounts[0]!.totals, requests: 2 },
      })[0],
    ).toContain('2 requests')
  })

  it('names every metric, local period and live window and keeps unavailable data distinct from zero', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      inputTokens: { day: 10 },
      outputTokens: { week: 2 },
      requests: { month: 1 },
      planWindowPercent: { 'five-hour': 80 },
      rateLimitHeadroomPercent: { requests: 28 },
    })
    const absent = f.report()
    const text = accountUsageText(absent)
    for (const label of [
      'Input tokens (Day)',
      'Output tokens (Week)',
      'Requests (Month)',
      'Plan-window usage (five-hour)',
      'Rate-limit headroom (Requests)',
    ])
      expect(text).toContain(label)
    expect(text).toContain('No current usage snapshot.')
    expect(text).not.toContain('0% / 80%')
    const active = readAccountUsage({
      source: f.source,
      catalog: f.catalog,
      period: 'day',
      now: USAGE_NOW,
      limits: {
        read: () => ({
          planWindows: { 'five-hour': { usedPercent: 80, resetAt: null } },
          rateLimits: {
            requests: {
              limit: 25,
              remaining: 7,
              resetAt: new Date(USAGE_NOW + 1000).toISOString(),
            },
          },
        }),
      },
    })
    expect(accountUsageText(active)).toContain('80% / 80%')
    expect(
      active.accounts[0]?.meters
        .filter((meter) => meter.unit === 'percent')
        .every((meter) => meter.isReached),
    ).toBe(true)
  })
})
