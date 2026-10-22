import { describe, expect, it } from 'vitest'
import {
  ESTIMATE_FACT_TRANSLATORS,
  EstimateFactSourceError,
} from '../../src/core/estimator/limitFacts'
import { estimateLimitFactSchema, type EstimateAccountOwner } from '../../src/shared/estimateFacts'
import { USAGE_JOURNAL_VERSION } from '../../src/shared/constants'
import type { UsageLimitSnapshot } from '../../src/shared/usageJournal'
import { legacyUsdSchema, type UsdAmount } from '../../src/shared/usdSchema'
const usd = (value: number): UsdAmount => legacyUsdSchema.parse(value)
const observedAt = Date.parse('2026-10-06T12:00:00.000Z')
const owner: EstimateAccountOwner = {
  kind: 'account',
  id: 'private-id',
  providerId: 'openrouter',
  generation: 'sign-in-2',
}
function observation(source: UsageLimitSnapshot['source']): UsageLimitSnapshot {
  return {
    v: USAGE_JOURNAL_VERSION,
    type: 'limit',
    id: 'observation',
    at: observedAt,
    observedAt,
    day: '2026-10-06',
    timezoneOffsetMins: 0,
    client: 'test',
    backend: 'modelApi',
    provider: owner.providerId,
    source,
    windows: [],
    account: { usedUsd: usd(100), limitUsd: usd(100), remainingUsd: usd(0), period: 'month' },
  }
}
describe('owned estimator limit facts', () => {
  it.each(['museCode', 'openRouter', 'headers', 'chatgpt'] as const)(
    'retains a partial account balance from %s',
    (source) => {
      const snapshot = observation(source)
      const [row] = ESTIMATE_FACT_TRANSLATORS.observation({ owner, observedAt, snapshot })
      expect(row).toMatchObject({
        owner,
        metric: 'balance',
        unit: 'usd',
        used: '100',
        limit: '100',
        remaining: '0',
        window: { startsAt: null, resetsAt: null, periodSeconds: null, calendarPeriod: 'month' },
        observedAt: '2026-10-06T12:00:00.000Z',
        observedBy: source,
      })
      snapshot.account = { period: 'unknown', remainingUsd: usd(0) }
      expect(
        ESTIMATE_FACT_TRANSLATORS.observation({ owner, observedAt, snapshot })[0],
      ).toMatchObject({ used: null, limit: null, remaining: '0' })
    },
  )
  it('keeps known percentage allowance with an unknown period', () => {
    expect(
      ESTIMATE_FACT_TRANSLATORS.limits({
        owner,
        observedAt,
        snapshot: {
          planWindows: { weekly: { usedPercent: 90, resetAt: '2026-10-06T13:00:00.000Z' } },
        },
      })[0],
    ).toMatchObject({
      remaining: 10,
      window: { periodSeconds: null, resetsAt: '2026-10-06T13:00:00.000Z' },
    })
  })
  it('uses the same fact shape for machine thresholds with independently unknown fields', () => {
    const rows = ESTIMATE_FACT_TRANSLATORS.machine({
      id: 'local',
      observedAt,
      cpuMaxPercent: 85,
      memoryMaxPercent: 90,
    })
    expect(rows.map((row) => estimateLimitFactSchema.safeParse(row).success)).toEqual([true, true])
    expect(rows[0]).toMatchObject({
      owner: { kind: 'machine', id: 'local', providerId: null, generation: null },
      used: null,
      remaining: null,
      limit: 85,
    })
    expect(JSON.stringify(rows)).not.toContain('label')
  })
  it.each(['at', 'observedAt', 'resetsAt'] as const)(
    'refuses invalid %s in a changed observation by source',
    (field) => {
      const snapshot = observation('museCode')
      if (field === 'resetsAt')
        snapshot.windows = [{ id: 'weekly', usedPercent: 90, resetsAt: Number.MAX_SAFE_INTEGER }]
      else snapshot[field] = Number.MAX_SAFE_INTEGER
      expect(() => ESTIMATE_FACT_TRANSLATORS.observation({ owner, observedAt, snapshot })).toThrow(
        EstimateFactSourceError,
      )
      expect(() => ESTIMATE_FACT_TRANSLATORS.observation({ owner, observedAt, snapshot })).toThrow(
        'usage-changed',
      )
    },
  )
  it.each([NaN, -1, Number.MAX_SAFE_INTEGER])(
    'refuses invalid usage/read timestamps %s',
    (value) => {
      expect(() =>
        ESTIMATE_FACT_TRANSLATORS.usage({
          owner,
          observedAt,
          snapshot: {
            observedAtMs: observedAt,
            tier: 'captured',
            window: { usedPercent: 90, resetsAtMs: value, windowDurationMins: 300 },
            weekly: { usedPercent: 90, resetsAtMs: observedAt },
          },
        }),
      ).toThrow('usage-read')
    },
  )
  it('refuses invalid values and windows in every translator', () => {
    expect(() =>
      ESTIMATE_FACT_TRANSLATORS.machine({
        id: 'local',
        observedAt,
        cpuMaxPercent: 101,
        memoryMaxPercent: 90,
      }),
    ).toThrow('configuration')
    const snapshot = observation('headers')
    snapshot.windows = [{ id: 'window', usedPercent: 20, windowMins: 0 }]
    expect(() => ESTIMATE_FACT_TRANSLATORS.observation({ owner, observedAt, snapshot })).toThrow(
      'usage-changed',
    )
    expect(() =>
      ESTIMATE_FACT_TRANSLATORS.limits({
        owner,
        observedAt,
        snapshot: {
          rateLimits: { tokens: { limit: 1, remaining: 2, resetAt: '2026-10-06T13:00:00.000Z' } },
        },
      }),
    ).toThrow('account-limits')
  })
  it.each([
    { planWindows: { weekly: { usedPercent: 90, resetAt: 'not-a-date' } } },
    { blocked: { reason: 'quota' as const, resetAt: 'not-a-date' } },
    { rateLimits: { requests: { limit: 1, remaining: 1, resetAt: '99999-01-01T00:00:00.000Z' } } },
  ])('refuses invalid account-limits timestamps %p', (snapshot) => {
    expect(() => ESTIMATE_FACT_TRANSLATORS.limits({ owner, observedAt, snapshot })).toThrow(
      'account-limits',
    )
  })
  it('refuses invalid ownership even when the source reports no measurements', () => {
    for (const field of ['id', 'providerId', 'generation'] as const) {
      const corrupt = { ...owner, [field]: '' }
      expect(() =>
        ESTIMATE_FACT_TRANSLATORS.limits({ owner: corrupt, observedAt, snapshot: {} }),
      ).toThrow('account-limits')
      const snapshot = observation('headers')
      snapshot.windows = []
      delete snapshot.account
      expect(() =>
        ESTIMATE_FACT_TRANSLATORS.observation({ owner: corrupt, observedAt, snapshot }),
      ).toThrow('usage-changed')
    }
  })
})
