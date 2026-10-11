import { describe, expect, it } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { USAGE_HISTOGRAM_EDGES_MS } from '../../src/shared/constants'
import {
  USAGE_CERTAINTIES,
  USAGE_CLI_CLIENT_ID,
  type UsageKind,
  type UsageCertainty,
  type UsageHeaders,
  type UsageTokens,
  type UsageCost,
  type UsageRecord,
  type UsageLimitSnapshot,
  type UsageJournalEntry,
  USAGE_HEADER_ALLOW_LIST,
  USAGE_KINDS,
  usageJournalEntrySchema,
  usageRecordSchema,
  usageLimitSnapshotSchema,
  usageHeadersSchema,
  usageCostSchema,
} from '../../src/shared/usageJournal'
import {
  type UsageQuery,
  type UsageTotals,
  type UsagePageState,
  parseUsagePageToServiceMessage,
  parseUsageServiceToPageMessage,
  usageQuerySchema,
  usagePageStateSchema,
} from '../../src/shared/usagePage'
import { parseWebviewToHostMessage } from '../../src/shared/protocol'

const identity: Pick<
  UsageRecord,
  'v' | 'id' | 'at' | 'day' | 'timezoneOffsetMins' | 'client' | 'backend' | 'provider'
> = {
  v: 1,
  id: 'record-1',
  at: 1_791_234_567_890,
  day: '2026-10-05',
  timezoneOffsetMins: 420,
  client: 'Zed',
  backend: 'modelApi',
  provider: 'openai',
}
const cost: UsageCost = { certainty: 'unpriced' }
const record: UsageRecord = {
  ...identity,
  type: 'usage',
  startedAt: 1_791_234_567_800,
  model: 'gpt-example',
  kind: 'turn',
  tokens: {},
  cost,
  outcome: 'completed',
}
const query: UsageQuery = { range: 'today', groupBy: 'provider', metric: 'cost' }
const totals: UsageTotals = {
  records: 0,
  tokens: {},
  units: {},
  costs: [],
  retries: 0,
  rateLimited: 0,
}
const state: UsagePageState = {
  v: 1,
  query,
  generatedAt: 1_791_234_567_890,
  history: {
    enabled: true,
    host: 'remote host',
    detailDays: 30,
    historyDays: 365,
    recordCount: 0,
    newerVersionRecords: 1,
    tornLines: 0,
  },
  totals,
  previousTotals: totals,
  buckets: [],
  breakdown: [],
  features: [],
  limits: [],
  budgets: [],
  unreportedLimits: [],
  attempts: [],
  savings: {},
}

describe('usage journal v1', () => {
  it('preserves unknown counters and cost as absent for every editor and certainty', () => {
    const parsed = usageRecordSchema.parse(record)
    expect(parsed.tokens).toEqual({})
    expect(parsed.cost).toEqual({ certainty: 'unpriced' })
    const certainties: readonly UsageCertainty[] = USAGE_CERTAINTIES
    for (const certainty of certainties) {
      expect(usageCostSchema.parse({ certainty })).toEqual({ certainty })
    }
    for (const client of [
      'Visual Studio Code',
      'JetBrains',
      'Eclipse',
      USAGE_CLI_CLIENT_ID,
      'custom editor',
    ]) {
      expect(usageRecordSchema.parse({ ...record, client }).client).toBe(client)
    }
    const kinds: readonly UsageKind[] = USAGE_KINDS
    for (const kind of kinds) {
      expect(usageRecordSchema.parse({ ...record, kind }).kind).toBe(kind)
    }
  })

  it('keeps optional canonical counters, timing, retries and reported zeroes', () => {
    const tokens: UsageTokens = {
      input: 100,
      cached: 20,
      cacheWrite: 15,
      cacheWrite5m: 5,
      cacheWrite1h: 10,
      output: 30,
      reasoning: 12,
      estimated: true,
    }
    const full = {
      ...record,
      tokens,
      units: { images: 0, searches: 2, audioSeconds: 1.5 },
      cost: { usd: 0, certainty: 'local' },
      durationMs: 90,
      firstTokenMs: 10,
      retries: 2,
      rateLimited: true,
      retryDelayMs: 500,
      packedAvoided: 8,
      served: 'upstream/model',
      session: 'session-1',
    }
    expect(usageRecordSchema.parse(full)).toEqual(full)
  })

  it('rejects smuggled content, paths, keys, digests and tool arguments at every nesting level', () => {
    for (const key of [
      'prompt',
      'reply',
      'path',
      'workspace',
      'apiKey',
      'keyDigest',
      'toolArguments',
    ]) {
      expect(usageRecordSchema.safeParse({ ...record, [key]: 'canary' }).success).toBe(false)
      expect(usageRecordSchema.safeParse({ ...record, tokens: { [key]: 'canary' } }).success).toBe(
        false,
      )
      expect(
        usageRecordSchema.safeParse({ ...record, cost: { certainty: 'computed', [key]: 'canary' } })
          .success,
      ).toBe(false)
    }
  })

  it('rejects invalid versions, dates, ids and counters and strips control characters', () => {
    for (const change of [
      { v: 2 },
      { day: '2026-02-30' },
      { id: '../outside' },
      { session: '/private/file' },
      { tokens: { input: -1 } },
      { tokens: { output: 1.5 } },
      { cost: { certainty: 'computed', usd: NaN } },
      { provider: 'x'.repeat(257) },
      { durationMs: Infinity },
    ])
      expect(usageRecordSchema.safeParse({ ...record, ...change }).success).toBe(false)
    expect(usageRecordSchema.parse({ ...record, client: 'Z\ned\u{7F}' }).client).toBe('Zed')
    expect(usageRecordSchema.safeParse({ ...record, client: '\n' }).success).toBe(false)
  })

  it('only stores explicit rate-limit headers with at most 64 printable ASCII characters', () => {
    for (const header of USAGE_HEADER_ALLOW_LIST) {
      expect(usageHeadersSchema.parse({ [header]: 'a'.repeat(64) })).toEqual({
        [header]: 'a'.repeat(64),
      })
    }
    for (const header of [
      'authorization',
      'x-api-key',
      'openai-project',
      'x-ratelimit-api-key',
      'x-codex-account-id',
    ]) {
      expect(usageHeadersSchema.safeParse({ [header]: 'canary' }).success).toBe(false)
    }
    for (const value of ['a'.repeat(65), '10\r\nsecret', 'é']) {
      expect(usageHeadersSchema.safeParse({ 'retry-after': value }).success).toBe(false)
    }
  })

  it('caps the encoded UTF-8 record below 4 KiB, including headers', () => {
    const headers: UsageHeaders = Object.fromEntries(
      USAGE_HEADER_ALLOW_LIST.map((name) => [name, 'x'.repeat(64)]),
    )
    const large = {
      ...record,
      client: '漢'.repeat(256),
      provider: '漢'.repeat(256),
      model: '漢'.repeat(256),
      served: '漢'.repeat(256),
      headers,
    }
    expect(usageRecordSchema.safeParse(large).success).toBe(false)
    expect(
      usageLimitSnapshotSchema.safeParse({
        ...identity,
        type: 'limit',
        source: 'headers',
        observedAt: identity.at,
        windows: Array.from({ length: 100 }, () => ({
          id: 'weekly',
          label: 'x'.repeat(256),
          usedPercent: 1,
        })),
      }).success,
    ).toBe(false)
  })

  it('keeps reported limit percentages and unknown durations, but rejects arbitrary raw payloads', () => {
    const snapshot: UsageLimitSnapshot = {
      ...identity,
      type: 'limit',
      source: 'museCode',
      observedAt: identity.at,
      windows: [{ id: 'weekly', usedPercent: 125, resetsAt: identity.at }],
      account: { period: 'daily', remainingUsd: 0 },
      raw: { 'retry-after': '10' },
    }
    expect(usageLimitSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(usageJournalEntrySchema.parse(snapshot)).toEqual(snapshot)
    const entry: UsageJournalEntry = usageJournalEntrySchema.parse(record)
    expect(entry).toEqual(record)
    expect(
      usageLimitSnapshotSchema.safeParse({ ...snapshot, raw: { apiKey: 'canary' } }).success,
    ).toBe(false)
    expect(USAGE_HISTOGRAM_EDGES_MS).toHaveLength(11)
    expect(
      USAGE_HISTOGRAM_EDGES_MS.every((edge, i, edges) => i === 0 || edge > edges[i - 1]!),
    ).toBe(true)
  })
})

describe('usage page boundary', () => {
  it('allows only credential-free HTTPS provider console links', () => {
    for (const consoleUrl of [
      'not a URL',
      'javascript:alert(1)',
      'file:///private',
      'https://example.com'.replace('https:', 'http:'),
      'https://user:password@example.com',
    ])
      expect(
        usagePageStateSchema.safeParse({
          ...state,
          unreportedLimits: [{ provider: 'provider', consoleUrl }],
        }).success,
      ).toBe(false)
    expect(
      usagePageStateSchema.safeParse({
        ...state,
        unreportedLimits: [{ provider: 'provider', consoleUrl: 'https://example.com' }],
      }).success,
    ).toBe(true)
  })
  it('accepts all service requests without permitting paths or supplied delete grants', () => {
    const messages = [
      { type: 'usage/ready' },
      { type: 'usage/query', query },
      { type: 'usage/refresh' },
      { type: 'usage/export', requestId: 'export-1', query, format: 'summaryCsv' },
      { type: 'usage/deleteHistory', requestId: 'delete-1' },
      { type: 'usage/setHistory', enabled: false },
      { type: 'usage/openSettings' },
      { type: 'usage/revealFolder' },
      { type: 'usage/openModels', provider: 'openai', model: 'model' },
      { type: 'usage/openExternal', url: 'https://example.com' },
      { type: 'usage/modelDetail', provider: 'openai', model: 'model' },
    ]
    for (const message of messages) {
      expect(parseUsagePageToServiceMessage(message)).toEqual({ ok: true, message })
      expect(parseUsagePageToServiceMessage({ ...message, apiKey: 'canary' }).ok).toBe(false)
    }
    expect(
      parseUsagePageToServiceMessage({
        type: 'usage/deleteHistory',
        requestId: 'd',
        confirmed: true,
        path: '/budget-journal',
      }).ok,
    ).toBe(false)
  })

  it('validates range order and preserves unknown aggregate values in both directions', () => {
    expect(usageQuerySchema.safeParse({ ...query, range: 'custom' }).success).toBe(false)
    expect(
      usageQuerySchema.safeParse({
        ...query,
        range: 'custom',
        from: '2026-10-05',
        to: '2026-10-04',
      }).success,
    ).toBe(false)
    expect(
      usageQuerySchema.parse({ ...query, range: 'custom', from: '2026-10-05', to: '2026-10-05' })
        .range,
    ).toBe('custom')
    expect(usagePageStateSchema.parse(state)).toEqual(state)
    expect(parseUsageServiceToPageMessage({ type: 'usage/state', state }).ok).toBe(true)
    for (const message of [
      { type: 'usage/result', requestId: 'e', action: 'export', outcome: 'cancelled' },
      { type: 'usage/error', code: 'readFailed' },
    ]) {
      expect(parseUsageServiceToPageMessage(message).ok).toBe(true)
      expect(parseUsageServiceToPageMessage({ ...message, apiKey: 'canary' }).ok).toBe(false)
    }
    expect(
      parseUsageServiceToPageMessage({
        type: 'usage/state',
        state: { ...state, totals: { ...totals, prompt: 'canary' } },
      }).ok,
    ).toBe(false)
    expect(parseUsageServiceToPageMessage({ type: 'unknown' }).ok).toBe(false)
  })

  it('validates a delivered localization table rather than allowing arbitrary payloads', () => {
    expect(
      parseUsageServiceToPageMessage({ type: 'usage/table', locale: 'en', table: USAGE_EN }).ok,
    ).toBe(true)
    expect(
      parseUsageServiceToPageMessage({
        type: 'usage/table',
        locale: 'en',
        table: { apiKey: 'canary' },
      }).ok,
    ).toBe(false)
  })

  it('allows the existing chat to open the shared usage page', () => {
    expect(parseWebviewToHostMessage({ type: 'openUsagePage' }).ok).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'hostAction', action: 'openUsagePage' }).ok).toBe(true)
  })
})
