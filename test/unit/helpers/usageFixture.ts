import { vi } from 'vitest'
import { usageLocalDay } from '../../../src/core/usage/aggregate'
import type { UsageServiceDeps } from '../../../src/core/usage/usageService'
import { USAGE_EN } from '../../../src/shared/l10n/usageEn'
import { usageRecordSchema, type UsageRecord } from '../../../src/shared/usageJournal'

export const usageNow = new Date(2026, 9, 5, 12).getTime()
export function usageFixtureRecord(extra: Partial<UsageRecord> = {}): UsageRecord {
  return usageRecordSchema.parse({
    v: 1,
    type: 'usage',
    id: 'fixture',
    at: usageNow,
    startedAt: usageNow - 1000,
    day: usageLocalDay(usageNow),
    timezoneOffsetMins: new Date(usageNow).getTimezoneOffset(),
    client: 'Zed',
    backend: 'modelApi',
    provider: 'openai',
    model: 'model',
    kind: 'turn',
    tokens: { input: 100, cached: 20, output: 10 },
    durationMs: 1000,
    cost: { certainty: 'computed', usd: 0.01 },
    outcome: 'completed',
    ...extra,
  })
}
export function usageFixtureDeps(records: readonly UsageRecord[] = [usageFixtureRecord()]) {
  let isEnabled = true
  let calls = records
  const deps = {
    now: () => usageNow,
    host: 'fixture-host',
    table: { locale: 'en', table: USAGE_EN },
    journal: {
      read: vi.fn(() =>
        Promise.resolve({
          records: calls,
          rollups: [],
          limits: [],
          recordCount: calls.length,
          newerVersionRecords: 2,
          tornLines: 1,
          since: '2026-10-01',
        }),
      ),
      deleteHistory: vi.fn(() => {
        calls = []
        return Promise.resolve()
      }),
    },
    history: () => ({ enabled: isEnabled }),
    setHistory: vi.fn((isOn: boolean) => {
      isEnabled = isOn
      return Promise.resolve()
    }),
    readBudgets: vi.fn((): ReturnType<UsageServiceDeps['readBudgets']> =>
      Promise.resolve([
        {
          budget: {
            id: 'paid',
            kind: 'paidDaily',
            spentUsd: 2,
            capUsd: 5,
            uncertainUsd: 1,
            stopped: true,
            raisedToday: true,
            resetsAt: usageNow + 1_800_000,
          },
          firstSpendAt: usageNow - 1_800_000,
        },
      ]),
    ),
    readLiveLimits: vi.fn((): ReturnType<UsageServiceDeps['readLiveLimits']> =>
      Promise.resolve([
        {
          v: 1,
          id: 'limit',
          type: 'limit',
          at: usageNow,
          day: usageLocalDay(usageNow),
          timezoneOffsetMins: 420,
          client: 'Zed',
          backend: 'museCode',
          provider: 'museCode',
          source: 'museCode',
          observedAt: usageNow,
          windows: [
            { id: 'window', usedPercent: 62, resetsAt: usageNow + 9_000_000, windowMins: 300 },
            { id: 'weekly', usedPercent: 80, resetsAt: usageNow + 86_400_000 },
          ],
        },
      ]),
    ),
    readAttempts: vi.fn((): ReturnType<UsageServiceDeps['readAttempts']> =>
      Promise.resolve([
        { day: usageLocalDay(usageNow), origin: 'turn', attempts: 31 },
        { day: '2026-01-01', origin: 'reminder', attempts: 10 },
      ]),
    ),
    providerConsoles: () => [
      { provider: 'openai', consoleUrl: 'https://platform.openai.com/usage' },
      { provider: 'museCode' },
    ],
    exportFile: vi.fn(
      (
        _format: Parameters<UsageServiceDeps['exportFile']>[0],
        _journal: Parameters<UsageServiceDeps['exportFile']>[1],
        state: Parameters<UsageServiceDeps['exportFile']>[2],
      ) =>
        Promise.resolve({
          name: 'usage.json',
          mimeType: 'application/json',
          content: JSON.stringify(state.totals),
        }),
    ),
    saveFile: vi.fn(() => Promise.resolve(true)),
    confirmDelete: vi.fn(() => Promise.resolve(false)),
    openSettings: vi.fn(() => Promise.resolve()),
    revealFolder: vi.fn(() => Promise.resolve()),
    openModels: vi.fn(() => Promise.resolve()),
    openExternal: vi.fn(() => Promise.resolve()),
  } satisfies UsageServiceDeps
  return deps
}
