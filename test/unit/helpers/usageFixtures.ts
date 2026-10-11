import type { UsagePageState, UsageTotals } from '../../../src/shared/usagePage'
import type { UsageCertainty } from '../../../src/shared/usageJournal'

export const USAGE_SCENARIOS = [
  'empty',
  'history-off',
  'one-provider',
  'nine-providers',
  'plan-only',
  'local-only',
  'stale',
  'over-limit',
  'newer-version',
  'long-german',
  'long-russian',
] as const

export function usageTotals(certainty: UsageCertainty = 'reported', index = 1): UsageTotals {
  return {
    records: 2,
    tokens: {
      input: index * 1000,
      output: index * 100,
      cached: index * 200,
      reasoning: index * 30,
    },
    units: {},
    costs: [
      {
        certainty,
        records: 2,
        ...(certainty === 'plan' && { apiEquivalentUsd: index / 10 }),
        ...(certainty !== 'plan' &&
          certainty !== 'unpriced' && {
            usd: certainty === 'local' ? 0 : index / 10,
          }),
      },
    ],
    durationMs: index * 10_000,
    firstTokenMs: 500,
    p50Ms: 5000,
    p95Ms: 7500,
    retries: 1,
    rateLimited: 1,
    cacheHitPercent: 20,
    tokensPerSecond: 10,
    packedAvoided: 50,
  }
}
export function emptyUsageTotals(): UsageTotals {
  return { records: 0, tokens: {}, units: {}, costs: [], retries: 0, rateLimited: 0 }
}
export function usageStateFor(scenario = 'one-provider', now = Date.now()): UsagePageState {
  const day = '2026-10-05'
  const providers = [
    'meta',
    'openai',
    'anthropic',
    'gemini',
    'xai',
    'openrouter',
    'ollama',
    'custom',
    'museCode',
  ]
  let certainty: UsageCertainty = 'reported'
  if (scenario === 'plan-only') certainty = 'plan'
  else if (scenario === 'local-only') certainty = 'local'
  const isEmpty = scenario === 'empty' || scenario === 'history-off'
  const selectedProviders = scenario === 'nine-providers' ? providers : [providers[0]!]
  const longLabels: Readonly<Record<string, string>> = {
    'long-german':
      'Anbieterübergreifende Modellverbrauchsübersicht für Entwicklungsumgebungen mit ausführlichen Bezeichnungen',
    'long-russian':
      'Подробная сводка использования моделей во всех редакторах и средах разработки с длинными названиями',
  }
  const rows = (isEmpty ? [] : selectedProviders).map((provider, index) => ({
    id: provider,
    provider,
    model: `model-${String(index)}`,
    label: longLabels[scenario] ?? provider,
    totals: usageTotals(certainty, index + 1),
  }))
  const weight = rows.reduce((sum, _, index) => sum + index + 1, 0)
  const totals = isEmpty
    ? emptyUsageTotals()
    : {
        ...usageTotals(certainty, weight),
        records: rows.length * 2,
        costs: [{ ...usageTotals(certainty, weight).costs[0]!, records: rows.length * 2 }],
        retries: rows.length,
        rateLimited: rows.length,
      }
  const observedAt = scenario === 'stale' ? now - 16 * 60 * 1000 : now
  return {
    v: 1,
    query: { range: 'today', groupBy: 'provider', metric: 'cost' },
    generatedAt: now,
    history: {
      enabled: scenario !== 'history-off',
      host: 'win11 · remote workspace',
      detailDays: 30,
      historyDays: 365,
      recordCount: totals.records,
      newerVersionRecords: scenario === 'newer-version' ? 7 : 0,
      tornLines: scenario === 'newer-version' ? 1 : 0,
      since: day,
    },
    totals,
    previousTotals: emptyUsageTotals(),
    buckets: isEmpty ? [] : [{ at: now, day, totals, groups: rows }],
    breakdown: rows,
    features: isEmpty ? [] : [{ kind: 'turn', totals }],
    limits: [
      {
        type: 'limit',
        v: 1,
        id: 'limit-1',
        at: observedAt,
        day,
        timezoneOffsetMins: 0,
        client: 'cli',
        backend: 'museCode',
        provider: 'museCode',
        source: 'museCode',
        observedAt,
        windows: [
          {
            id: 'five-hour',
            usedPercent: scenario === 'over-limit' ? 130 : 62,
            resetsAt: now + 2 * 60 * 60 * 1000 + 5 * 60 * 1000,
            windowMins: 300,
          },
          { id: 'weekly', usedPercent: 90, resetsAt: now + 3 * 24 * 60 * 60 * 1000 },
        ],
      },
      {
        type: 'limit',
        v: 1,
        id: 'headers-1',
        at: now,
        day,
        timezoneOffsetMins: 0,
        client: 'cli',
        backend: 'modelApi',
        provider: 'openai',
        source: 'headers',
        observedAt: now,
        windows: [],
        raw: { 'x-ratelimit-remaining-requests': '27', 'retry-after': '6m0s' },
      },
    ],
    budgets: [
      {
        id: 'paid',
        kind: 'paidDaily',
        spentUsd: scenario === 'over-limit' ? 6 : 1.2,
        capUsd: 5,
        uncertainUsd: 0.1,
        stopped: scenario === 'over-limit',
        raisedToday: scenario === 'over-limit',
        projectedUsd: 2.5,
        resetsAt: now + 10 * 60 * 60 * 1000,
      },
    ],
    unreportedLimits: [{ provider: 'gemini', consoleUrl: 'https://aistudio.google.com/' }],
    attempts: isEmpty
      ? []
      : [
          { day, origin: 'turn', attempts: 1 },
          { day, origin: 'reminder', attempts: 30 },
          { day, origin: 'subagent', attempts: 4 },
        ],
    savings: isEmpty
      ? {}
      : { cachedTokens: totals.tokens.cached, cacheUsd: 0.2, packedAvoided: 500 },
  }
}
