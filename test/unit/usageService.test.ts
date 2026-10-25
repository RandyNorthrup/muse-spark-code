// The usage page shows only the credential in use (M95 D74): a rotated or
// removed key's budgets disappear, while sources without a credential keep
// theirs. Legacy OpenRouter snapshots (recorded before credential IDs)
// belong to a previous key, so they drop out once the current key's
// identity is readable. All through the real service over real journal
// shapes.
import { describe, expect, it } from 'vitest'
import { usageLocalDay } from '../../src/core/usage/aggregate'
import { createUsageService, type UsageServiceDeps } from '../../src/core/usage/usageService'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { usageLimitSnapshotSchema, type UsageLimitSnapshot } from '../../src/shared/usageJournal'

const NOW = 1_800_000_000_000
const CURRENT = 'a'.repeat(64)
const PREVIOUS = 'b'.repeat(64)

function limit(
  overrides: Partial<UsageLimitSnapshot> & { source: UsageLimitSnapshot['source'] },
): UsageLimitSnapshot {
  return usageLimitSnapshotSchema.parse({
    v: 3,
    type: 'limit',
    id: `limit-${String(overrides.observedAt ?? 1)}`,
    at: NOW,
    day: usageLocalDay(NOW),
    timezoneOffsetMins: 0,
    client: 'test',
    backend: 'modelApi',
    provider: 'openrouter',
    observedAt: NOW,
    windows: [{ id: 'month', usedPercent: 10 }],
    ...overrides,
  })
}

function deps(
  limits: readonly UsageLimitSnapshot[],
  currentCredentialId?: UsageServiceDeps['currentCredentialId'],
): UsageServiceDeps {
  return {
    now: () => NOW,
    host: 'test',
    table: { locale: 'en', table: USAGE_EN },
    journal: {
      read: () =>
        Promise.resolve({
          records: [],
          rollups: [],
          limits,
          recordCount: 0,
          newerVersionRecords: 0,
          tornLines: 0,
        }),
      deleteHistory: () => Promise.resolve(),
    },
    history: () => ({ enabled: false }),
    setHistory: () => Promise.resolve(),
    readBudgets: () => Promise.resolve([]),
    readLiveLimits: () => Promise.resolve([]),
    ...(currentCredentialId !== undefined && { currentCredentialId }),
    readAttempts: () => Promise.resolve({ attempts: [], stale: false }),
    providerConsoles: () => [],
    exportFile: () =>
      Promise.resolve({ name: 'usage.json', mimeType: 'application/json', content: '{}' }),
    saveFile: () => Promise.resolve(true),
    confirmDelete: () => Promise.resolve(false),
  }
}

function providersOf(limits: readonly UsageLimitSnapshot[]): string[] {
  return limits.map((entry) => `${entry.provider}/${entry.source}/${entry.credentialId ?? 'none'}`)
}

describe('usageService credential selection', () => {
  it('drops a legacy OpenRouter snapshot once the current key is readable', async () => {
    const service = createUsageService(
      deps(
        [
          limit({ source: 'openRouter', observedAt: NOW }), // legacy: no credentialId
          limit({ source: 'openRouter', observedAt: NOW + 1, credentialId: CURRENT }),
          limit({ source: 'chatgpt', provider: 'chatgpt', observedAt: NOW + 2 }),
        ],
        () => Promise.resolve(CURRENT),
      ),
    )
    const state = await service.snapshot()
    expect(providersOf(state.limits)).toEqual([
      `openrouter/openRouter/${CURRENT}`,
      'chatgpt/chatgpt/none',
    ])
  })

  it('keeps every snapshot while no key identity is readable', async () => {
    const service = createUsageService(deps([limit({ source: 'openRouter', observedAt: NOW })]))
    const state = await service.snapshot()
    expect(providersOf(state.limits)).toEqual(['openrouter/openRouter/none'])
  })

  it('drops a previous key snapshot after rotation', async () => {
    const service = createUsageService(
      deps(
        [
          limit({ source: 'openRouter', observedAt: NOW, credentialId: PREVIOUS }),
          limit({ source: 'openRouter', observedAt: NOW + 1, credentialId: CURRENT }),
        ],
        () => Promise.resolve(CURRENT),
      ),
    )
    const state = await service.snapshot()
    expect(providersOf(state.limits)).toEqual([`openrouter/openRouter/${CURRENT}`])
  })
})
