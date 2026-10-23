// PROVSPEND (2026-10-12): provider-reported spend. Real code only: the
// request builders, the spend capability each preset declares, the
// failure mapping and the reconciliation text. Positive wire proofs need
// a recorded exchange, so only the OpenRouter key body is proved that
// way (the D74 capture, `docs/certification/m95-captures/openrouter/
// 02-key-usage.json`); every other endpoint's request line and field
// names are UNVERIFIED documentation research awaiting the lead's live
// capture, and the suite proves refusal strictness for them instead of
// invented bodies. Fetch-level tests are not here: answering for the
// provider would be a stand-in, and only a live call could prove more.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODELS_DEV_CATALOGUE_DATE } from '../../src/shared/constants'
import { PRESETS, presetById } from '../../src/core/providers/presets'
import {
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
  parseOpenRouterKeyBody,
  spendFailureText,
  spendHttpFailure,
  spendKeyKindFor,
  spendReportLines,
  type ProviderSpendReport,
  type SpendFetcher,
} from '../../src/core/providers/providerSpend'

const AS_OF = '2026-10-10T12:00:00.000Z'

/** The recorded `GET /api/v1/key` answer (2026-10-04, unbilled). */
function capturedOpenRouterKeyBody(): unknown {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/certification/m95-captures/openrouter/02-key-usage.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { readonly response: { readonly body: unknown } }
  return capture.response.body
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

describe('spend request builders', () => {
  it('builds the Anthropic usage and cost requests from the documented shape', () => {
    const [usage, cost] = anthropicSpendRequests({
      origin: 'https://api.anthropic.com',
      key: 'TEST-ADMIN-KEY',
      startingAt: '2026-10-01T00:00:00Z',
      endingAt: '2026-10-08T00:00:00Z',
    })
    for (const request of [usage, cost]) {
      expect(request.method).toBe('GET')
      expect(request.origin).toBe('https://api.anthropic.com')
      expect(request.url.startsWith('https://api.anthropic.com/')).toBe(true)
      expect(request.headers['anthropic-version']).toBe('2023-06-01')
      // The key rides the transport's auth source, never a caller header.
      expect(request.headers).not.toHaveProperty('x-api-key')
      expect(request.auth).toEqual({ scheme: 'x-api-key', key: 'TEST-ADMIN-KEY' })
      const query = new URL(request.url).searchParams
      expect(query.get('starting_at')).toBe('2026-10-01T00:00:00Z')
      expect(query.get('ending_at')).toBe('2026-10-08T00:00:00Z')
      expect(query.get('bucket_width')).toBe('1d')
    }
    expect(usage.url).toContain('/v1/organizations/usage_report/messages')
    expect(cost.url).toContain('/v1/organizations/cost_report')
  })

  it('carries the Anthropic page cursor when paginating', () => {
    const [usage] = anthropicSpendRequests({
      origin: 'https://api.anthropic.com',
      key: 'k',
      startingAt: '2026-10-01T00:00:00Z',
      endingAt: '2026-10-02T00:00:00Z',
      page: 'cursor-9',
    })
    expect(new URL(usage.url).searchParams.get('page')).toBe('cursor-9')
  })

  it('builds the OpenAI usage and cost requests with a Bearer [REDACTED] key', () => {
    const [usage, cost] = openAiSpendRequests({
      origin: 'https://api.openai.com',
      key: 'TEST-ADMIN-KEY',
      startTime: '2026-10-01T00:00:00Z',
      endTime: '2026-10-02T00:00:00Z',
    })
    expect(usage.url).toContain('/v1/organization/usage/completions')
    expect(cost.url).toContain('/v1/organization/costs')
    for (const request of [usage, cost]) {
      expect(request.headers).not.toHaveProperty('Authorization')
      expect(request.auth).toEqual({ scheme: 'bearer', key: 'TEST-ADMIN-KEY' })
    }
    expect(new URL(cost.url).searchParams.get('bucket_width')).toBe('1d')
  })

  it('builds the OpenRouter key request and the DeepSeek balance request', () => {
    const key = openRouterSpendRequest({ origin: 'https://openrouter.ai', key: 'TEST-KEY' })
    expect(key.url).toBe('https://openrouter.ai/api/v1/key')
    expect(key.auth).toEqual({ scheme: 'bearer', key: 'TEST-KEY' })
    const balance = deepSeekSpendRequest({ origin: 'https://api.deepseek.com', key: 'TEST-KEY' })
    expect(balance.url).toBe('https://api.deepseek.com/user/balance')
    expect(balance.auth).toEqual({ scheme: 'bearer', key: 'TEST-KEY' })
  })
})

describe('strict parsing', () => {
  it('reads the recorded OpenRouter key body', () => {
    expect(parseOpenRouterKeyBody(capturedOpenRouterKeyBody())).toEqual({
      usedToday: 0,
      usedThisWeek: 0,
      usedThisMonth: 0,
      limit: 2,
      remaining: 2,
    })
  })

  it('refuses an OpenRouter key body with a missing or negative amount', () => {
    expect(parseOpenRouterKeyBody({ data: { limit: 1 } })).toEqual({ kind: 'unreadable' })
    expect(
      parseOpenRouterKeyBody({
        data: {
          limit: 1,
          limit_remaining: 1,
          usage: 1,
          usage_daily: -1,
          usage_weekly: 1,
          usage_monthly: 1,
        },
      }),
    ).toEqual({ kind: 'unreadable' })
  })

  it('pins the catalogue date to the vendored snapshot', () => {
    const vendor = JSON.parse(
      readFileSync(new URL('../../vendor/models-dev/VENDOR.json', import.meta.url), 'utf8'),
    ) as { readonly fetchedAt: string }
    expect(MODELS_DEV_CATALOGUE_DATE).toBe(vendor.fetchedAt)
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
    let calls = 0
    const fetch: SpendFetcher = () => {
      calls += 1
      throw new Error('an admin fetch must not run on the wrong key kind')
    }
    const result = await fetchAdminSpendReport({
      fetch,
      provider: 'anthropic',
      origin: 'https://api.anthropic.com',
      key: '[REDACTED]',
      keyKind: 'inference',
      startingAt: '2026-10-01T00:00:00Z',
      endingAt: '2026-10-02T00:00:00Z',
      asOf: AS_OF,
    })
    expect(result).toEqual({ kind: 'wrong-key-kind' })
    expect(calls).toBe(0)
  })

  it('refuses an admin key at key-usage and balance endpoints before any request', async () => {
    let reads = 0
    await expect(
      fetchKeyUsageSpendReport({
        read: () => {
          reads += 1
          throw new Error('a key-usage read must not run on the wrong key kind')
        },
        key: '[REDACTED]',
        keyKind: 'admin',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'wrong-key-kind' })
    expect(reads).toBe(0)
    let calls = 0
    const fetch: SpendFetcher = () => {
      calls += 1
      throw new Error('a balance fetch must not run on the wrong key kind')
    }
    await expect(
      fetchBalanceSpendReport({
        fetch,
        origin: 'https://api.deepseek.com',
        key: 'admin-key',
        keyKind: 'admin',
        asOf: AS_OF,
      }),
    ).resolves.toEqual({ kind: 'wrong-key-kind' })
    expect(calls).toBe(0)
  })
})

describe('failures', () => {
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

  it('compares dollars only when the journal recorded no tokens', () => {
    const matching = spendReportLines(adminReport(), { usd: '1.05' }, label)
    expect(matching.join('\n')).toContain('matches our estimate within rounding')
    const differing = spendReportLines(adminReport(), { usd: '2.00' }, label)
    expect(differing.join('\n')).toContain('difference of')
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
