import { vi } from 'vitest'
import type { UsageAccess, UsagePagePorts } from '../../../src/runtime/usage/usageAdapter'
import type { UsagePageState } from '../../../src/shared/usagePage'

export function usageState(): UsagePageState {
  const totals = {
    records: 2,
    tokens: { input: 123 },
    units: {},
    costs: [
      { certainty: 'unpriced', records: 1 },
      { certainty: 'reported', records: 1, usd: 0.42 },
    ],
    retries: 0,
    rateLimited: 0,
  } satisfies UsagePageState['totals']
  return {
    v: 1,
    query: { range: '30d', groupBy: 'provider', metric: 'cost' },
    generatedAt: 1_791_187_200_000,
    history: {
      enabled: true,
      host: 'kubuntu',
      detailDays: 30,
      historyDays: 365,
      recordCount: 2,
      newerVersionRecords: 0,
      tornLines: 0,
    },
    totals,
    previousTotals: { records: 0, tokens: {}, units: {}, costs: [], retries: 0, rateLimited: 0 },
    buckets: [],
    breakdown: [],
    features: [],
    limits: [],
    budgets: [],
    unreportedLimits: [{ provider: 'custom' }],
    attempts: [],
    savings: {},
  }
}

export function fakeUsageAccess() {
  const connections: UsagePagePorts[] = []
  const receive = vi
    .fn<ReturnType<UsageAccess['connect']>['receive']>()
    .mockResolvedValue(undefined)
  const dispose = vi.fn()
  const usage = {
    connect: vi.fn<UsageAccess['connect']>((ports) => {
      connections.push(ports)
      return { receive, dispose }
    }),
    read: vi.fn<UsageAccess['read']>().mockResolvedValue(usageState()),
    usageText: vi
      .fn<UsageAccess['usageText']>()
      .mockReturnValue('Unpriced: unknown; reported: $0.42'),
    export: vi.fn<UsageAccess['export']>().mockResolvedValue('versioned export'),
  }
  return { usage, connections, receive, dispose }
}
