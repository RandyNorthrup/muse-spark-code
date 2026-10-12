// PROVSPEND (2026-10-12): provider-reported spend. Fakes only: every wire
// body below is built from the documented shapes in the lane brief, and
// every case the brief names is covered (request goldens, pagination bound,
// failure kinds, exact money, key separation both ways, the floor, cap
// independence, the difference sentence at/below/above rounding).
// UNVERIFIED: field names await the lead's live capture.

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PRESETS, presetById } from '../../src/core/providers/presets'
import {
  SPEND_PAGE_BOUND,
  SPEND_POLL_FLOOR_MS,
  anthropicSpendRequests,
  deepSeekSpendRequest,
  fetchAdminSpendReport,
  fetchBalanceSpendReport,
  fetchKeyUsageSpendReport,
  openAiSpendRequests,
  openRouterSpendRequest,
  parseAnthropicCostPage,
  parseAnthropicUsagePage,
  parseDeepSeekBalance,
  parseOpenAiCostPage,
  parseOpenAiUsagePage,
  spendFailureText,
  spendHttpFailure,
  spendKeyKindFor,
  spendReportLines,
  SpendThrottle,
  type ProviderSpendReport,
  type SpendFetcher,
  type SpendKeyKind,
} from '../../src/core/providers/providerSpend'

const AS_OF = '2026-10-10T12:00:00.000Z'

function anthropicUsageBody(rows: readonly unknown[] = []) {
  return {
    data:
      rows.length === 0
        ? [
            {
              model: 'claude-opus-4-1',
              starting_at: '2026-10-01T00:00:00Z',
              ending_at: '2026-10-02T00:00:00Z',
              uncached_input_tokens: 1000,
              cache_read_input_tokens: 200,
              cache_creation_input_tokens: 50,
              output_tokens: 500,
            },
          ]
        : rows,
    has_more: false,
  }
}

function anthropicCostBody() {
  return {
    data: [
      { starting_at: '2026-10-01T00:00:00Z', amount: '105', currency: 'USD' },
      { starting_at: '2026-10-02T00:00:00Z', amount: '7', currency: 'USD' },
    ],
    has_more: false,
  }
}

function openAiUsageBody() {
  return {
    data: [
      {
        model: 'gpt-5',
        start_time: '2026-10-01T00:00:00Z',
        end_time: '2026-10-02T00:00:00Z',
        input_tokens: 2000,
        output_tokens: 1000,
        num_model_requests: 3,
      },
    ],
    has_more: false,
  }
}

function openAiCostBody() {
  return {
    results: [
      {
        line_item: '2026-10-01',
        project_id: 'proj-x',
        amount: { value: '1.10', currency: 'usd' },
      },
    ],
    has_more: false,
  }
}

function adminReport(
  overrides: Partial<Extract<ProviderSpendReport, { capability: 'admin-report' }>> = {},
): Extract<ProviderSpendReport, { capability: 'admin-report' }> {
  return {
    capability: 'admin-report',
    provider: 'anthropic',
    asOf: AS_OF,
    tokensByModel: [{ model: 'claude-opus-4-1', inputTokens: 1250, outputTokens: 500 }],
    dollarsByDay: [{ day: '2026-10-01T00:00:00Z', usd: '1.05' }],
    totalUsd: '1.05',
    ...overrides,
  }
}

describe('spend capability per preset', () => {
  it('declares one capability on every preset', () => {
    expect(presetById('openrouter')?.spend).toBe('key-usage')
    expect(presetById('deepseek')?.spend).toBe('balance')
    expect(presetById('anthropic')?.spend).toBe('admin-report')
    expect(presetById('openai')?.spend).toBe('admin-report')
    for (const preset of PRESETS) {
      if (['openrouter', 'deepseek', 'anthropic', 'openai'].includes(preset.id)) continue
      expect(`${preset.id}=${preset.spend}`).toBe(`${preset.id}=none`)
    }
  })

  it('routes admin reports to the admin key and the rest to the inference key', () => {
    expect(spendKeyKindFor('admin-report')).toBe('admin')
    expect(spendKeyKindFor('key-usage')).toBe('inference')
    expect(spendKeyKindFor('balance')).toBe('inference')
    expect(spendKeyKindFor('none')).toBe('inference')
  })
})

describe('spend request goldens', () => {
  it('builds the Anthropic usage and cost requests from the documented shape', () => {
    const [usage, cost] = anthropicSpendRequests({
      origin: 'https://api.anthropic.com',
      key: 'TEST-ADMIN-KEY',
      startingAt: '2026-10-01T00:00:00Z',
      endingAt: '2026-10-08T00:00:00Z',
    })
    for (const request of [usage, cost]) {
      expect(request?.method).toBe('GET')
      expect(request?.origin).toBe('https://api.anthropic.com')
      expect(request?.url.startsWith('https://api.anthropic.com/')).toBe(true)
      expect(request?.headers['anthropic-version']).toBe('2023-06-01')
      expect(request?.headers['x-api-key']).toBe('TEST-ADMIN-KEY')
      const query = new URL(request?.url ?? '').searchParams
      expect(query.get('starting_at')).toBe('2026-10-01T00:00:00Z')
      expect(query.get('ending_at')).toBe('2026-10-08T00:00:00Z')
      expect(query.get('bucket_width')).toBe('1d')
    }
    expect(usage?.url).toContain('/v1/organizations/usage_report/messages')
    expect(cost?.url).toContain('/v1/organizations/cost_report')
  })

  it('carries the Anthropic page cursor when paginating', () => {
    const [usage] = anthropicSpendRequests({
      origin: 'https://api.anthropic.com',
      key: 'k',
      startingAt: '2026-10-01T00:00:00Z',
      endingAt: '2026-10-02T00:00:00Z',
      page: 'cursor-9',
    })
    expect(new URL(usage?.url ?? '').searchParams.get('page')).toBe('cursor-9')
  })

  it('builds the OpenAI usage and cost requests with a bearer admin key', () => {
    const [usage, cost] = openAiSpendRequests({
      origin: 'https://api.openai.com',
      key: 'TEST-ADMIN-KEY',
      startTime: '2026-10-01T00:00:00Z',
      endTime: '2026-10-02T00:00:00Z',
    })
    expect(usage?.url).toContain('/v1/organization/usage/completions')
    expect(cost?.url).toContain('/v1/organization/costs')
    for (const request of [usage, cost]) {
      expect(request?.headers.Authorization).toBe('Bearer TEST-ADMIN-KEY')
    }
    expect(new URL(cost?.url ?? '').searchParams.get('bucket_width')).toBe('1d')
  })

  it('builds the OpenRouter key request and the DeepSeek balance request', () => {
    const key = openRouterSpendRequest({ origin: 'https://openrouter.ai', key: 'TEST-KEY' })
    expect(key.url).toBe('https://openrouter.ai/api/v1/key')
    expect(key.headers.Authorization).toBe('Bearer TEST-KEY')
    const balance = deepSeekSpendRequest({ origin: 'https://api.deepseek.com', key: 'TEST-KEY' })
    expect(balance.url).toBe('https://api.deepseek.com/user/balance')
    expect(balance.headers.Authorization).toBe('Bearer TEST-KEY')
  })
})

describe('strict parsing and exact money', () => {
  it('reads Anthropic usage rows and converts cents strings exactly', () => {
    const usage = parseAnthropicUsagePage(anthropicUsageBody())
    expect(usage).toEqual({
      rows: [{ model: 'claude-opus-4-1', inputTokens: 1250, outputTokens: 500 }],
      nextPage: undefined,
    })
    const cost = parseAnthropicCostPage(anthropicCostBody())
    expect(cost).toEqual({
      days: [
        { day: '2026-10-01T00:00:00Z', usd: '1.05' },
        { day: '2026-10-02T00:00:00Z', usd: '0.07' },
      ],
      totalUsd: '1.12',
      nextPage: undefined,
    })
  })

  it('reads OpenAI rows and value-plus-currency costs without float math', () => {
    const usage = parseOpenAiUsagePage(openAiUsageBody())
    expect(usage).toEqual({
      rows: [{ model: 'gpt-5', inputTokens: 2000, outputTokens: 1000 }],
      nextPage: undefined,
    })
    const cost = parseOpenAiCostPage(openAiCostBody())
    expect(cost).toEqual({
      days: [{ day: '2026-10-01', usd: '1.1' }],
      totalUsd: '1.1',
      nextPage: undefined,
    })
  })

  it('reads DeepSeek balances as exact decimal strings', () => {
    const parsed = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        {
          currency: 'USD',
          total_balance: '12.34',
          granted_balance: '2.00',
          topped_up_balance: '10.34',
        },
      ],
    })
    expect(parsed).toEqual({
      isAvailable: true,
      balances: [{ currency: 'USD', total: '12.34', granted: '2', toppedUp: '10.34' }],
    })
  })

  it('ignores unknown fields but refuses missing required ones, never a zero', () => {
    expect(
      parseAnthropicUsagePage({ data: [{ starting_at: '2026-10-01T00:00:00Z' }], extra: 1 }),
    ).toEqual({ kind: 'unreadable' })
    expect(parseAnthropicCostPage({ data: [{ starting_at: 'x', amount: '1.5' }] })).toEqual({
      kind: 'unreadable',
    })
    expect(parseOpenAiCostPage({ results: [{ amount: { value: '1', currency: 'eur' } }] })).toEqual(
      { kind: 'unreadable' },
    )
    expect(
      parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: 'USD' }] }),
    ).toEqual({ kind: 'unreadable' })
    expect(parseOpenAiUsagePage({ data: 'nope' })).toEqual({ kind: 'unreadable' })
  })
})

describe('key separation both ways', () => {
  it('refuses an inference key at admin endpoints before any request', async () => {
    const fetch: SpendFetcher = vi.fn(() =>
      Promise.resolve({ status: 200, body: anthropicUsageBody() }),
    )
    const kinds: readonly SpendKeyKind[] = ['inference']
    for (const keyKind of kinds) {
      const result = await fetchAdminSpendReport({
        fetch,
        provider: 'anthropic',
        origin: 'https://api.anthropic.com',
        key: 'sk-ant-inference',
        keyKind,
        startingAt: '2026-10-01T00:00:00Z',
        endingAt: '2026-10-02T00:00:00Z',
        asOf: AS_OF,
      })
      expect(result).toEqual({ kind: 'wrong-key-kind' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses an admin key at key-usage and balance endpoints before any request', async () => {
    const read = vi.fn(() => Promise.resolve({ usedToday: 1, usedThisWeek: 2, usedThisMonth: 3 }))
    await expect(
      fetchKeyUsageSpendReport({ read, key: 'sk-ant-admin01-x', keyKind: 'admin', asOf: AS_OF }),
    ).resolves.toEqual({ kind: 'wrong-key-kind' })
    expect(read).not.toHaveBeenCalled()
    const fetch: SpendFetcher = vi.fn(() => Promise.resolve({ status: 200, body: {} }))
    await expect(
      fetchBalanceSpendReport({
        fetch,
        origin: 'https://api.deepseek.com',
        key: 'admin-key',
        keyKind: 'admin',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'wrong-key-kind' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

function endlessPages(kind: 'anthropic' | 'openai'): SpendFetcher {
  return vi.fn((request: { readonly url: string }) => {
    const page = new URL(request.url).searchParams.get('page') ?? 'p0'
    const next = `p${String(Number(page.slice(1)) + 1)}`
    if (request.url.includes('cost')) {
      return Promise.resolve({
        status: 200,
        body:
          kind === 'anthropic'
            ? { data: [], has_more: true, next_page: next }
            : { results: [], has_more: true, next_page: next },
      })
    }
    return Promise.resolve({
      status: 200,
      body:
        kind === 'anthropic'
          ? { ...anthropicUsageBody(), has_more: true, next_page: next }
          : { ...openAiUsageBody(), has_more: true, next_page: next },
    })
  })
}

const refusedFetch: SpendFetcher = () => Promise.resolve({ status: 401, body: { error: 'x' } })
const planFetch: SpendFetcher = () =>
  Promise.resolve({ status: 403, body: { error: 'unavailable for individual accounts' } })
const forbiddenFetch: SpendFetcher = () => Promise.resolve({ status: 403, body: { error: 'nope' } })
const brokenFetch: SpendFetcher = () => Promise.resolve({ status: 200, body: { nonsense: true } })
const downFetch: SpendFetcher = () => Promise.reject(new Error('socket hang up'))

describe('pagination, failures and the polling floor', () => {
  it('stops at the stated page bound instead of looping', async () => {
    for (const provider of ['anthropic', 'openai'] as const) {
      const fetch = endlessPages(provider)
      const result = await fetchAdminSpendReport({
        fetch,
        provider,
        origin: 'https://example.com',
        key: 'k',
        keyKind: 'admin',
        startingAt: '2026-10-01T00:00:00Z',
        endingAt: '2026-10-02T00:00:00Z',
        asOf: AS_OF,
      })
      expect(result).not.toHaveProperty('kind')
      // Usage pages plus cost pages, each bounded.
      expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(2 * SPEND_PAGE_BOUND)
      const urls = vi.mocked(fetch).mock.calls.map(([request]) => request.url)
      expect(urls.filter((url) => url.includes('page=')).length).toBeGreaterThan(0)
    }
  })

  it('maps each failure kind without leaking the response', async () => {
    await expect(
      fetchAdminSpendReport({
        fetch: refusedFetch,
        provider: 'openai',
        origin: 'https://api.openai.com',
        key: 'k',
        keyKind: 'admin',
        startingAt: '2026-10-01T00:00:00Z',
        endingAt: '2026-10-02T00:00:00Z',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'refused' })
    await expect(
      fetchAdminSpendReport({
        fetch: planFetch,
        provider: 'anthropic',
        origin: 'https://api.anthropic.com',
        key: 'k',
        keyKind: 'admin',
        startingAt: '2026-10-01T00:00:00Z',
        endingAt: '2026-10-02T00:00:00Z',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'plan-unavailable' })
    await expect(
      fetchBalanceSpendReport({
        fetch: forbiddenFetch,
        origin: 'https://api.deepseek.com',
        key: 'k',
        keyKind: 'inference',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'refused' })
    await expect(
      fetchBalanceSpendReport({
        fetch: brokenFetch,
        origin: 'https://api.deepseek.com',
        key: 'k',
        keyKind: 'inference',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'unreadable' })
    await expect(
      fetchBalanceSpendReport({
        fetch: downFetch,
        origin: 'https://api.deepseek.com',
        key: 'k',
        keyKind: 'inference',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'unreachable' })
  })

  it('renders every failure as a fixed sentence', () => {
    expect(spendFailureText({ kind: 'refused' }, 'Anthropic')).toContain('refused')
    expect(spendFailureText({ kind: 'plan-unavailable' }, 'Anthropic')).toContain('plan')
    expect(spendFailureText({ kind: 'unreadable' }, 'Anthropic')).toContain('could not be read')
    expect(spendFailureText({ kind: 'unreachable' }, 'Anthropic')).toContain('reached')
    expect(spendFailureText({ kind: 'wrong-key-kind' }, 'Anthropic')).toContain('No admin')
  })

  it('maps non-200 answers without a plan signal to refused', () => {
    expect(spendHttpFailure(401, {})).toEqual({ kind: 'refused' })
    expect(spendHttpFailure(403, { error: 'forbidden' })).toEqual({ kind: 'refused' })
    expect(spendHttpFailure(403, 'individual accounts only')).toEqual({ kind: 'plan-unavailable' })
    expect(spendHttpFailure(429, {})).toEqual({ kind: 'refused' })
  })

  it('allows one fetch a minute per account', () => {
    expect(SPEND_POLL_FLOOR_MS).toBe(60_000)
    let now = 1_000_000
    const throttle = new SpendThrottle(() => now)
    expect(throttle.take('anthropic')).toBe(true)
    expect(throttle.take('anthropic')).toBe(false)
    expect(throttle.take('openai')).toBe(true)
    now += 59_999
    expect(throttle.take('anthropic')).toBe(false)
    now += 1
    expect(throttle.take('anthropic')).toBe(true)
  })
})

describe('reconciliation text', () => {
  const label = { providerLabel: 'Anthropic', catalogueDate: '2026-10-05' }

  it('labels the reporter and the time, then tokens by model and dollars by day', () => {
    const lines = spendReportLines(adminReport(), undefined, label)
    expect(lines.join('\n')).toContain('Anthropic')
    expect(lines.join('\n')).toContain('claude-opus-4-1')
    expect(lines.join('\n')).toContain('2026-10-01T00:00:00Z')
  })

  it('stays silent on the difference at and below rounding', () => {
    const exact = spendReportLines(
      adminReport(),
      { usd: '1.05', inputTokens: 1250, outputTokens: 500 },
      label,
    )
    expect(exact.join('\n')).toContain('matches our estimate within rounding')
    const below = spendReportLines(
      adminReport(),
      { usd: '1.054', inputTokens: 1250, outputTokens: 500 },
      label,
    )
    expect(below.join('\n')).toContain('matches our estimate within rounding')
  })

  it('names the gap and the honest reasons above rounding', () => {
    const lines = spendReportLines(
      adminReport(),
      { usd: '0.50', inputTokens: 1250, outputTokens: 500 },
      label,
    )
    const text = lines.join('\n')
    expect(text).toContain('difference of')
    expect(text).toContain('other tools')
    expect(text).toContain('2026-10-05')
    expect(text).toContain('Priority Tier')
    const openai = spendReportLines(
      adminReport({ provider: 'openai' }),
      { usd: '0.50', inputTokens: 1250, outputTokens: 500 },
      { providerLabel: 'OpenAI', catalogueDate: '2026-10-05' },
    )
    expect(openai.join('\n')).not.toContain('Priority Tier')
  })

  it('differs on tokens alone, with no invented reason', () => {
    const lines = spendReportLines(
      adminReport(),
      { usd: '1.05', inputTokens: 999, outputTokens: 500 },
      label,
    )
    expect(lines.join('\n')).toContain('difference of')
  })

  it('shows a balance with no comparison', () => {
    const lines = spendReportLines(
      {
        capability: 'balance',
        provider: 'deepseek',
        asOf: AS_OF,
        balances: [{ currency: 'USD', total: '12.34', granted: '2', toppedUp: '10.34' }],
      },
      { usd: '1.00', inputTokens: 1, outputTokens: 1 },
      { providerLabel: 'DeepSeek', catalogueDate: '2026-10-05' },
    )
    expect(lines.join('\n')).toContain('Balance')
    expect(lines.join('\n')).not.toContain('differs')
  })

  it('shows key usage with no per-day dollars', () => {
    const lines = spendReportLines(
      {
        capability: 'key-usage',
        provider: 'openrouter',
        asOf: AS_OF,
        usedTodayUsd: '1.5',
        usedThisWeekUsd: '2.5',
        usedThisMonthUsd: '3.5',
        limitUsd: '10',
        remainingUsd: '6.5',
      },
      undefined,
      { providerLabel: 'OpenRouter', catalogueDate: '2026-10-05' },
    )
    expect(lines.join('\n')).toContain('OpenRouter')
  })
})

describe('cap independence', () => {
  const source = readFileSync(
    new URL('../../src/core/providers/providerSpend.ts', import.meta.url),
    'utf8',
  )

  it('carries no threshold or budget field a budget decision could read', () => {
    // Field-shaped patterns only: the prose above names the guarantee.
    for (const field of ['accounts/', '/paid/', 'spendUsd', 'thresholds', 'policyGate']) {
      expect(source).not.toContain(field)
    }
    const report: ProviderSpendReport = adminReport()
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'capability',
        'provider',
        'asOf',
        'tokensByModel',
        'dollarsByDay',
        'totalUsd',
      ]),
    )
  })

  it('is never imported by a budget decision', () => {
    for (const file of [
      '../../src/core/accounts/policyGate.ts',
      '../../src/core/accounts/thresholds.ts',
      '../../src/core/accounts/pool.ts',
      '../../src/core/paid/paidFeatures.ts',
      '../../src/core/paid/paidConsent.ts',
    ]) {
      const body = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(body).not.toContain('providerSpend')
    }
  })
})
