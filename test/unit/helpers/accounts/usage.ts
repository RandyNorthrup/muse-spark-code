import { usdInputSchema } from '../../../../src/shared/usdSchema'
import type { Account, AccountEvent, AccountThresholds } from '../../../../src/shared/accounts'
import {
  readAccountUsage,
  type AccountUsageCatalog,
  type AccountUsageSource,
} from '../../../../src/core/usage/accountUsage'

export const USAGE_NOW = new Date(2026, 9, 6, 12).getTime()
export function usageAccount(id: string, thresholds: AccountThresholds = {}, order = 0): Account {
  return {
    id,
    label: id === 'default' ? 'Work label canary' : 'Personal label canary',
    order,
    thresholds,
  }
}
export function usageRecord(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    provider: 'meta',
    account: 'default',
    time: new Date(2026, 9, 6, 10).toISOString(),
    settledUsd: '0.1',
    reservedUsd: '0.2',
    uncertainUsd: '0.000000001',
    inputTokens: 10,
    outputTokens: 2,
    requests: 1,
    ...overrides,
  }
}
export function usageFixture() {
  const records: unknown[] = [
    usageRecord(),
    usageRecord({ account: 'personal', settledUsd: '0.2' }),
  ]
  const events: unknown[] = []
  const catalog: AccountUsageCatalog[] = [
    {
      provider: 'meta',
      label: 'Meta',
      accounts: [
        usageAccount('default', { spendUsd: { day: usdInputSchema.parse('0.3') } }),
        usageAccount('personal', {}, 1),
      ],
    },
  ]
  const source: AccountUsageSource = { records: () => records, events: () => events }
  return {
    records,
    events,
    catalog,
    source,
    report: () => readAccountUsage({ source, catalog, now: USAGE_NOW, period: 'day' }),
  }
}
export function usageEvents(): readonly AccountEvent[] {
  const userCap = {
    kind: 'userCap',
    metric: 'spendUsd',
    period: 'day',
    value: usdInputSchema.parse('0.3'),
    threshold: usdInputSchema.parse('0.3'),
    resetAt: new Date(2026, 9, 7).toISOString(),
  } as const
  return [
    {
      type: 'stop',
      provider: 'meta',
      account: 'personal',
      time: new Date(2026, 9, 6, 11).toISOString(),
      trigger: { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null },
    },
    {
      type: 'swap',
      provider: 'meta',
      account: 'personal',
      previousAccount: 'default',
      time: new Date(2026, 9, 6, 10).toISOString(),
      trigger: userCap,
      coldCacheUsd: usdInputSchema.parse('0.000000001'),
    },
    {
      type: 'spread',
      provider: 'meta',
      account: 'personal',
      time: new Date(2026, 9, 6, 10, 30).toISOString(),
      workerId: 'worker-1',
    },
  ]
}
