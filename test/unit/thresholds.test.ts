import { describe, expect, it, vi } from 'vitest'
import {
  AccountThresholdExceededError,
  evaluateAccountThresholds,
  type AccountLimitsSnapshot,
} from '../../src/core/accounts/thresholds'
import type {
  AccountThresholds,
  AccountUsageQuery,
  AccountUsageTotals,
} from '../../src/shared/accounts'
import { accountTriggerSchema } from '../../src/shared/accounts'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeAccountClock, FakeAccountJournal } from './helpers/accounts/fakes'

const NOW = new Date(2026, 9, 6, 12).getTime()
const TOMORROW = new Date(2026, 9, 7).toISOString()
const EMPTY: AccountUsageTotals = {
  settledUsd: 0,
  reservedUsd: 0,
  uncertainUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  requests: 0,
}

function setup(thresholds: AccountThresholds = {}, snapshot?: AccountLimitsSnapshot) {
  const clock = new FakeAccountClock(NOW)
  const journal = new FakeAccountJournal()
  const read = vi.fn(() => snapshot ?? {})
  const evaluate = (account = 'work', provider = 'meta') =>
    evaluateAccountThresholds({
      provider,
      account: { id: account, thresholds },
      now: clock.now(),
      journal,
      ...(snapshot !== undefined && { limits: { read } }),
    })
  const append = (
    usage: Partial<AccountUsageTotals>,
    account = 'work',
    provider = 'meta',
    time = NOW,
  ) => {
    journal.append({ ...EMPTY, ...usage, account, provider, time: new Date(time).toISOString() })
  }
  return { clock, journal, read, evaluate, append }
}

describe('M108 T account thresholds', () => {
  it.each(['spendUsd', 'inputTokens', 'outputTokens', 'requests'] as const)(
    'trips %s at its exact day, week and month value, from generated journals',
    (metric) => {
      for (const period of ['day', 'week', 'month'] as const) {
        for (let threshold = 1; threshold <= 20; threshold++) {
          const subject = setup({ [metric]: { [period]: threshold } })
          const usageMetric = metric === 'spendUsd' ? 'settledUsd' : metric
          for (let value = 0; value < threshold; value++) subject.append({ [usageMetric]: 1 })
          expect(subject.evaluate()).toHaveLength(1)
          const trigger = subject.evaluate()[0]
          expect(trigger).toMatchObject({
            kind: 'userCap',
            metric,
            period,
            value: threshold,
            threshold,
          })
          expect(accountTriggerSchema.safeParse(trigger).success).toBe(true)
          const below = setup({ [metric]: { [period]: threshold } })
          below.append({ [usageMetric]: threshold - 1 })
          expect(below.evaluate()).toEqual([])
        }
      }
    },
  )

  it('keeps provider and account spend isolated, including outstanding and uncertain liability', () => {
    const subject = setup({ spendUsd: { day: 6 } })
    subject.append({ settledUsd: 1, reservedUsd: 2, uncertainUsd: 3 })
    subject.append({ settledUsd: 100 }, 'work', 'openai')
    subject.append({ settledUsd: 100 }, 'personal')
    expect(subject.evaluate()[0]).toMatchObject({ value: 6, threshold: 6 })
    expect(subject.evaluate('unused')).toEqual([])
    expect(subject.evaluate('work', 'other')).toEqual([])
    expect(subject.evaluate()[0]).toMatchObject({ value: 6 })
  })

  it('queries each configured period once, with local half-open calendar boundaries', () => {
    const queries: AccountUsageQuery[] = []
    const current = new Date(2027, 0, 3, 12).getTime() // Sunday across the year boundary.
    const result = evaluateAccountThresholds({
      provider: 'meta',
      account: {
        id: 'work',
        thresholds: {
          spendUsd: { day: 0, week: 0, month: 0 },
          inputTokens: { day: 0 },
        },
      },
      now: current,
      journal: {
        read: (query) => {
          queries.push(query)
          return EMPTY
        },
      },
    })
    expect(queries.map(({ start, end }) => [start, end])).toEqual([
      [new Date(2027, 0, 3).toISOString(), new Date(2027, 0, 4).toISOString()],
      [new Date(2026, 11, 28).toISOString(), new Date(2027, 0, 4).toISOString()],
      [new Date(2027, 0, 1).toISOString(), new Date(2027, 1, 1).toISOString()],
    ])
    expect(result).toHaveLength(4)
    const subject = setup({ requests: { day: 2 } })
    subject.append({ requests: 1 }, 'work', 'meta', new Date(2026, 9, 6).getTime() - 1)
    subject.append({ requests: 1 }, 'work', 'meta', new Date(2026, 9, 6).getTime())
    subject.append({ requests: 1 }, 'work', 'meta', new Date(2026, 9, 7).getTime())
    expect(subject.evaluate()).toEqual([])
    subject.clock.advance(new Date(2026, 9, 7, 12).getTime() - NOW)
    expect(subject.evaluate()).toEqual([])
  })

  it('uses calendar dates for DST transitions and leap-month resets', () => {
    for (const now of [
      new Date(2026, 2, 8, 12),
      new Date(2026, 10, 1, 12),
      new Date(2028, 1, 29, 12),
    ]) {
      const read = vi.fn(() => EMPTY)
      evaluateAccountThresholds({
        provider: 'meta',
        account: {
          id: 'work',
          thresholds: {
            requests: { day: 1, month: 1 },
          },
        },
        now: now.getTime(),
        journal: { read },
      })
      expect(read.mock.calls).toHaveLength(2)
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      const next = new Date(start)
      next.setDate(next.getDate() + 1)
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ start: start.toISOString(), end: next.toISOString() }),
      )
      const month = new Date(start)
      month.setDate(1)
      month.setMonth(month.getMonth() + 1)
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ end: month.toISOString() }))
    }
  })

  it('trips captured plan-window percentages at equality, including zero and 100', () => {
    for (const threshold of [0, 25, 100]) {
      const subject = setup(
        { planWindowPercent: { 'five-hour': threshold } },
        {
          planWindows: { 'five-hour': { usedPercent: threshold, resetAt: TOMORROW } },
        },
      )
      expect(subject.evaluate()).toEqual([
        { kind: 'vendorLimit', reason: 'planWindow', resetAt: TOMORROW },
      ])
      expect(subject.read).toHaveBeenCalledWith('meta', 'work')
    }
    expect(
      setup(
        { planWindowPercent: { weekly: 50 } },
        {
          planWindows: { weekly: { usedPercent: 49, resetAt: null } },
        },
      ).evaluate(),
    ).toEqual([])
  })

  it.each(['requests', 'tokens'] as const)(
    'uses the live %s limit for headroom and trips at equality',
    (metric) => {
      for (const limit of [100, 150, 100_000]) {
        const subject = setup(
          { rateLimitHeadroomPercent: { [metric]: 20 } },
          {
            rateLimits: { [metric]: { limit, remaining: limit / 5, resetAt: TOMORROW } },
          },
        )
        expect(subject.evaluate()).toEqual([
          { kind: 'vendorLimit', reason: 'rateLimitHeadroom', resetAt: TOMORROW },
        ])
        expect(
          setup(
            { rateLimitHeadroomPercent: { [metric]: 20 } },
            {
              rateLimits: { [metric]: { limit, remaining: limit / 5 + 1, resetAt: TOMORROW } },
            },
          ).evaluate(),
        ).toEqual([])
      }
      expect(
        setup(
          { rateLimitHeadroomPercent: { [metric]: 0 } },
          {
            rateLimits: { [metric]: { limit: 100, remaining: 0, resetAt: TOMORROW } },
          },
        ).evaluate(),
      ).toHaveLength(1)
    },
  )

  it.each(['rateLimited', 'quota', 'usageLimit'] as const)(
    'keeps %s and Retry-After ahead of a simultaneous user cap',
    (reason) => {
      const subject = setup({ requests: { day: 0 } }, { blocked: { reason, resetAt: TOMORROW } })
      expect(subject.evaluate().map((trigger) => trigger.kind)).toEqual(['vendorLimit', 'userCap'])
      expect(subject.evaluate()[0]).toEqual({ kind: 'vendorLimit', reason, resetAt: TOMORROW })
      subject.clock.advance(Date.parse(TOMORROW) - NOW)
      expect(subject.evaluate().map((trigger) => trigger.kind)).toEqual(['userCap'])
      expect(setup({}, { blocked: { reason, resetAt: null } }).evaluate()).toHaveLength(1)
    },
  )

  it('does not reuse an expired vendor window or bucket and reads each new snapshot', () => {
    const snapshot: AccountLimitsSnapshot = {
      planWindows: { weekly: { usedPercent: 50, resetAt: TOMORROW } },
      rateLimits: { requests: { limit: 150, remaining: 30, resetAt: TOMORROW } },
    }
    const subject = setup(
      { planWindowPercent: { weekly: 50 }, rateLimitHeadroomPercent: { requests: 20 } },
      snapshot,
    )
    expect(subject.evaluate()).toHaveLength(2)
    subject.clock.advance(Date.parse(TOMORROW) - NOW)
    expect(subject.evaluate()).toEqual([])
    expect(subject.read).toHaveBeenCalledTimes(2)
  })

  it('does no journal or limit read for unconfigured thresholds', () => {
    const read = vi.fn(() => EMPTY)
    expect(
      evaluateAccountThresholds({
        provider: 'meta',
        account: { id: 'default', thresholds: {} },
        now: NOW,
        journal: { read },
      }),
    ).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('admits the last affordable request but refuses a projected breach or a reached cap', () => {
    for (const metric of ['spendUsd', 'inputTokens', 'outputTokens', 'requests'] as const) {
      const field = metric === 'spendUsd' ? 'reservedUsd' : metric
      const current = { ...EMPTY, [field]: 8 }
      const base = {
        provider: 'meta',
        account: { id: 'work', thresholds: { [metric]: { day: 10 } } },
        now: NOW,
        journal: { read: () => current },
      }
      expect(evaluateAccountThresholds({ ...base, request: { ...EMPTY, [field]: 2 } })).toEqual([])
      expect(
        evaluateAccountThresholds({ ...base, request: { ...EMPTY, [field]: 3 } })[0],
      ).toMatchObject({ value: 11, threshold: 10 })
      expect(
        evaluateAccountThresholds({
          ...base,
          journal: { read: () => ({ ...EMPTY, [field]: 10 }) },
        })[0],
      ).toMatchObject({ value: 10 })
      expect(() =>
        evaluateAccountThresholds({ ...base, request: { ...EMPTY, [field]: -1 } }),
      ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    expect(() =>
      evaluateAccountThresholds({
        provider: 'meta',
        account: { id: 'work', thresholds: { requests: { day: Number.MAX_SAFE_INTEGER } } },
        now: NOW,
        journal: { read: () => ({ ...EMPTY, requests: Number.MAX_SAFE_INTEGER }) },
        request: { ...EMPTY, requests: 1 },
      }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })

  it('refuses missing configured live data and malformed snapshots', () => {
    for (const thresholds of [
      { planWindowPercent: { weekly: 50 } },
      { rateLimitHeadroomPercent: { tokens: 20 } },
    ]) {
      expect(() => setup(thresholds).evaluate()).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
      expect(() => setup(thresholds, {}).evaluate()).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    for (const bucket of [
      { limit: 0, remaining: 0, resetAt: TOMORROW },
      { limit: 100, remaining: 101, resetAt: TOMORROW },
      { limit: 100, remaining: -1, resetAt: TOMORROW },
      { limit: 100, remaining: NaN, resetAt: TOMORROW },
      { limit: 100, remaining: 0, resetAt: 'invalid' },
    ])
      expect(() =>
        setup(
          { rateLimitHeadroomPercent: { requests: 20 } },
          { rateLimits: { requests: bucket } },
        ).evaluate(),
      ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() =>
      setup(
        { planWindowPercent: { weekly: 50 } },
        {
          planWindows: { weekly: { usedPercent: 101, resetAt: TOMORROW } },
        },
      ).evaluate(),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })

  it('refuses invalid identities, clocks, thresholds and invalid journal totals', () => {
    const read = vi.fn(() => EMPTY)
    const base = {
      provider: 'meta',
      account: { id: 'work', thresholds: {} },
      now: NOW,
      journal: { read },
    }
    for (const update of [
      { provider: '../meta' },
      { account: { id: 'Bad', thresholds: {} } },
      { now: NaN },
      { now: Number.MAX_VALUE },
      { account: { id: 'work', thresholds: { requests: { day: -1 } } } },
    ])
      expect(() => evaluateAccountThresholds({ ...base, ...update })).toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
    expect(read).not.toHaveBeenCalled()
    for (const update of [
      { settledUsd: -1 },
      { reservedUsd: NaN },
      { uncertainUsd: Infinity },
      { inputTokens: 0.5 },
      { outputTokens: -1 },
      { requests: Number.MAX_SAFE_INTEGER + 1 },
      { settledUsd: Number.MAX_VALUE, reservedUsd: Number.MAX_VALUE },
    ])
      expect(() =>
        evaluateAccountThresholds({
          ...base,
          account: { id: 'work', thresholds: { spendUsd: { day: 1 } } },
          journal: { read: () => ({ ...EMPTY, ...update }) },
        }),
      ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    const failure = new Error('Journal read failed')
    expect(() =>
      evaluateAccountThresholds({
        ...base,
        account: { id: 'work', thresholds: { requests: { day: 1 } } },
        journal: {
          read: () => {
            throw failure
          },
        },
      }),
    ).toThrow(failure)
  })

  it('carries the structured trigger with translated user-cap and vendor-limit errors', () => {
    const triggers = setup(
      { requests: { day: 0 } },
      { blocked: { reason: 'quota', resetAt: null } },
    ).evaluate()
    for (const trigger of triggers) {
      const error = new AccountThresholdExceededError(trigger)
      expect(error.trigger).toBe(trigger)
      expect(error.name).toBe('AccountThresholdExceededError')
      expect(error.message).toBe(
        trigger.kind === 'userCap' ? UI_TEXT.accounts.userCap : UI_TEXT.accounts.vendorLimit,
      )
    }
  })
})
