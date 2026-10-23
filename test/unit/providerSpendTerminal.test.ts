// PROVSPEND (2026-10-12): terminal `providers usage` and `auth --admin`.
// Fakes only: the fetch below stands in for the pinned transport (the pin
// itself is covered by providerExec tests), and loopback-dependent transport
// tests are marked for the lead in the certification.

import { describe, expect, it } from 'vitest'
// The static imports warm the lazily loaded providers, transport and auth
// bundles at collection time, so the first report read runs inside the
// repository's own per-test timeout.
import '../../src/host/backend/providersEntry'
import '../../src/host/backend/modelApiEntry'
import '../../src/host/backend/configuredProvidersEntry'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  formatStoredProviderSecret,
  providerAdminSecretAccount,
  providerSecretAccount,
} from '../../src/runtime/keyStore'
import {
  providersUsage,
  spendAllowedPaths,
  spendEstimateFromBreakdown,
} from '../../src/runtime/providersSpend'
import type { ProvidersDeps } from '../../src/runtime/providersCommands'
import { mapSecretsBacked } from './helpers/mapSecrets'
import type { SpendEstimate } from '../../src/core/providers/providerSpend'
import {
  authClearProvider,
  authSetProvider,
  authStatusProvider,
  type AuthCommandDeps,
} from '../../src/runtime/authCommands'
import type { ProvidersFile } from '../../src/core/providers/providersFile'

const NOW = Date.parse('2026-10-10T12:00:00.000Z')

const SPEND_TEST_ORIGINS: Record<string, string> = {
  openrouter: 'https://openrouter.ai',
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
}

function fileWith(ids: readonly string[]): ProvidersFile {
  return {
    v: 1,
    providers: ids.map((id) => ({
      id,
      preset: id,
      address: SPEND_TEST_ORIGINS[id] ?? `https://${id}.example.com`,
      auth: 'apiKey' as const,
      models: [],
    })),
  }
}

function secretStore(entries: readonly (readonly [string, string])[]): Map<string, string> {
  return new Map<string, string>(entries)
}

function anthropicReportDeps(estimate: SpendEstimate | undefined) {
  return depsWith(
    fileWith(['anthropic']),
    secretStore([
      [
        providerAdminSecretAccount('anthropic') ?? '',
        envelope('https://api.anthropic.com', 'TEST-ADMIN-KEY'),
      ],
    ]),
    scriptedFetch({ usage_report: ANTHROPIC_USAGE, cost_report: ANTHROPIC_COST }),
    { readSpendEstimate: () => Promise.resolve(estimate) },
  )
}

function spendPathsForTest(id: string): readonly string[] {
  const paths: string[] = []
  for (const rule of spendAllowedPaths(id)) {
    if (rule.kind === 'exact') paths.push(rule.path)
  }
  return paths
}

function envelope(origin: string, key: string): string {
  return formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin }, key)
}

function depsWith(
  file: ProvidersFile,
  secrets: Map<string, string>,
  fetch: typeof globalThis.fetch,
  overrides: Partial<ProvidersDeps> = {},
): ProvidersDeps & { readonly printed: string[]; readonly errors: string[] } {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    readUserFile: () => Promise.resolve({ ok: true as const, file }),
    writeUserFile: () => Promise.resolve(true),
    secrets: mapSecretsBacked(secrets),
    resolveHost: () => Promise.resolve(['93.184.216.34']),
    fetch,
    readSecret: () => Promise.resolve(''),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
    now: () => NOW,
    ...overrides,
  }
}

function authDepsWith(
  secrets: Map<string, string>,
  secret: string,
): AuthCommandDeps & { readonly printed: string[]; readonly errors: string[] } {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    secrets: mapSecretsBacked(secrets),
    storeName: 'test store',
    confirmKeyUse: () => Promise.reject(new Error('spend terminal test asks no key-use question')),
    readSecret: () => Promise.resolve(secret),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
}

const ANTHROPIC_USAGE = {
  data: [
    {
      model: 'claude-opus-4-1',
      starting_at: '2026-10-01T00:00:00Z',
      ending_at: '2026-10-02T00:00:00Z',
      uncached_input_tokens: 1000,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50,
      output_tokens: 500,
    },
  ],
  has_more: false,
}
const ANTHROPIC_COST = {
  data: [{ starting_at: '2026-10-01T00:00:00Z', amount: '105', currency: 'USD' }],
  has_more: false,
}

function requestUrlText(url: string | URL | Request): string {
  if (typeof url === 'string') return url
  return url instanceof URL ? url.href : url.url
}

function scriptedFetch(routes: Readonly<Record<string, unknown>>): typeof globalThis.fetch {
  const scripted: typeof globalThis.fetch = (url) => {
    const text = requestUrlText(url)
    for (const [part, body] of Object.entries(routes)) {
      if (text.includes(part)) return Promise.resolve(Response.json(body))
    }
    return Promise.resolve(Response.json({}, { status: 404 }))
  }
  return scripted
}

describe('providers usage parsing', () => {
  it('parses the defaults', () => {
    expect(parseCommandLine(['providers', 'usage', 'anthropic'])).toMatchObject({
      command: 'providersUsage',
      provider: 'anthropic',
      days: 30,
      json: false,
    })
  })

  it('parses days and json output', () => {
    expect(
      parseCommandLine(['providers', 'usage', 'openai', '--days', '7', '--output', 'json']),
    ).toMatchObject({ command: 'providersUsage', provider: 'openai', days: 7, json: true })
  })

  it('refuses bad periods, outputs, providers and foreign flags', () => {
    for (const argv of [
      ['providers', 'usage', 'anthropic', '--days', '0'],
      ['providers', 'usage', 'anthropic', '--days', '367'],
      ['providers', 'usage', 'anthropic', '--days', 'many'],
      ['providers', 'usage', 'anthropic', '--output', 'yaml'],
      ['providers', 'usage', 'meta'],
      ['providers', 'usage'],
      ['providers', 'usage', 'anthropic', 'openai'],
      ['providers', 'usage', 'anthropic', '--preset', 'anthropic'],
      ['providers', 'usage', 'anthropic', '--admin'],
    ]) {
      expect(parseCommandLine(argv).command).toBe('invalid')
    }
  })

  it('keeps serve and login free of spend flags', () => {
    expect(parseCommandLine(['serve', '--days', '7']).command).toBe('invalid')
    expect(parseCommandLine(['serve', '--admin']).command).toBe('invalid')
    expect(parseCommandLine(['serve', '--output', 'json']).command).toBe('invalid')
    expect(parseCommandLine(['login', '--days', '7']).command).toBe('invalid')
  })

  it('parses the admin credential commands', () => {
    expect(parseCommandLine(['auth', 'set', '--provider', 'anthropic', '--admin'])).toMatchObject({
      command: 'authSet',
      provider: 'anthropic',
      admin: true,
    })
    expect(
      parseCommandLine(['auth', 'status', '--provider', 'anthropic', '--admin']),
    ).toMatchObject({ command: 'authStatus', provider: 'anthropic', admin: true })
    expect(parseCommandLine(['auth', 'clear', '--provider', 'openai', '--admin'])).toMatchObject({
      command: 'authClear',
      provider: 'openai',
      admin: true,
    })
  })

  it('refuses admin without a provider, with an account, or with foreign flags', () => {
    expect(parseCommandLine(['auth', 'set', '--admin']).command).toBe('invalid')
    expect(
      parseCommandLine(['auth', 'set', '--provider', 'anthropic', '--account', 'x', '--admin'])
        .command,
    ).toBe('invalid')
    expect(
      parseCommandLine(['auth', 'set', '--provider', 'anthropic', '--days', '7']).command,
    ).toBe('invalid')
  })
})

describe('providers usage command', () => {
  it('refuses unknown providers and providers with no report API', async () => {
    const missing = depsWith(fileWith([]), new Map(), scriptedFetch({}))
    expect(await providersUsage(missing, { provider: 'groq', days: 30, json: false })).toBe(1)
    const none = depsWith(fileWith(['groq']), new Map(), scriptedFetch({}))
    expect(await providersUsage(none, { provider: 'groq', days: 30, json: false })).toBe(1)
    expect(none.printed.join('\n')).toContain('no spend report')
  })

  it('asks for the admin key when none is stored', async () => {
    const deps = depsWith(fileWith(['anthropic']), new Map(), scriptedFetch({}))
    expect(await providersUsage(deps, { provider: 'anthropic', days: 30, json: false })).toBe(1)
    expect(deps.printed.join('\n')).toContain('No admin')
  })

  it('shows the provider figures next to our estimate and the difference', async () => {
    const secrets = secretStore([
      [
        providerAdminSecretAccount('anthropic') ?? '',
        envelope('https://api.anthropic.com', 'TEST-ADMIN-KEY'),
      ],
      [
        providerSecretAccount('anthropic') ?? '',
        envelope('https://api.anthropic.com', 'TEST-INFERENCE-KEY'),
      ],
    ])
    const seen: string[] = []
    const recordingFetch: typeof globalThis.fetch = (url, init) => {
      seen.push(`${requestUrlText(url)} ${JSON.stringify(init?.headers ?? {})}`)
      return scriptedFetch({ usage_report: ANTHROPIC_USAGE, cost_report: ANTHROPIC_COST })(
        url,
        init,
      )
    }
    const deps = depsWith(fileWith(['anthropic']), secrets, recordingFetch, {
      readSpendEstimate: () =>
        Promise.resolve({ usd: '0.50', inputTokens: 1250, outputTokens: 500 }),
    })
    expect(await providersUsage(deps, { provider: 'anthropic', days: 9, json: false })).toBe(0)
    const text = deps.printed.join('\n')
    expect(text).toContain('Anthropic')
    expect(text).toContain('claude-opus-4-1')
    expect(text).toContain('2026-10-01T00:00:00Z')
    expect(text).toContain('Our estimate')
    expect(text).toContain('difference of')
    expect(text).toContain('Priority Tier')
    // The inference key never reaches an admin endpoint: only the stored
    // admin key travels through the auth source, and only to the report paths.
    expect(seen).toHaveLength(2)
    for (const line of seen) expect(line).toContain('TEST-ADMIN-KEY')
    expect(seen.join('\n')).not.toContain('TEST-INFERENCE-KEY')
  })

  it('emits machine-readable JSON on request', async () => {
    const deps = anthropicReportDeps({ usd: '1.05' })
    expect(await providersUsage(deps, { provider: 'anthropic', days: 30, json: true })).toBe(0)
    const parsed = JSON.parse(deps.printed.join('\n')) as {
      readonly provider: string
      readonly report: { readonly totalUsd: string }
      readonly estimate: { readonly usd: string }
    }
    expect(parsed.provider).toBe('anthropic')
    expect(parsed.report.totalUsd).toBe('1.05')
    expect(parsed.estimate.usd).toBe('1.05')
  })

  it('shows provider figures alone when the journal recorded nothing', async () => {
    const deps = anthropicReportDeps(undefined)
    expect(await providersUsage(deps, { provider: 'anthropic', days: 30, json: false })).toBe(0)
    const text = deps.printed.join('\n')
    expect(text).toContain('claude-opus-4-1')
    expect(text).not.toContain('Our estimate')
  })

  it('renders refusals as fixed sentences', async () => {
    const secrets = secretStore([
      [
        providerAdminSecretAccount('openai') ?? '',
        envelope('https://api.openai.com', 'TEST-ADMIN-KEY'),
      ],
    ])
    const deps = depsWith(fileWith(['openai']), secrets, scriptedFetch({}), {
      readSpendEstimate: () => Promise.resolve(undefined),
    })
    expect(await providersUsage(deps, { provider: 'openai', days: 30, json: false })).toBe(1)
    expect(deps.errors.join('\n')).toContain('refused')
  })

  it('shows the DeepSeek balance with no comparison', async () => {
    const secrets = secretStore([
      [providerSecretAccount('deepseek') ?? '', envelope('https://api.deepseek.com', 'TEST-KEY')],
    ])
    const deps = depsWith(
      fileWith(['deepseek']),
      secrets,
      scriptedFetch({
        '/user/balance': {
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '100.00',
              granted_balance: '0.00',
              topped_up_balance: '100.00',
            },
          ],
        },
      }),
      { readSpendEstimate: () => Promise.resolve({ usd: '1.00' }) },
    )
    expect(await providersUsage(deps, { provider: 'deepseek', days: 30, json: false })).toBe(0)
    const text = deps.printed.join('\n')
    expect(text).toContain('Balance')
    expect(text).toContain('CNY')
    expect(text).not.toContain('difference of')
  })

  it('shows OpenRouter key usage from the captured fields', async () => {
    const secrets = secretStore([
      [providerSecretAccount('openrouter') ?? '', envelope('https://openrouter.ai', 'TEST-KEY')],
    ])
    const deps = depsWith(
      fileWith(['openrouter']),
      secrets,
      scriptedFetch({
        '/api/v1/key': {
          data: {
            limit: 10,
            limit_remaining: 6.5,
            usage: 3.5,
            usage_daily: 1.5,
            usage_weekly: 2.5,
            usage_monthly: 3.5,
          },
        },
      }),
      { readSpendEstimate: () => Promise.resolve(undefined) },
    )
    expect(await providersUsage(deps, { provider: 'openrouter', days: 30, json: false })).toBe(0)
    expect(deps.printed.join('\n')).toContain('OpenRouter')
  })

  it('pins every report request to its documented path', () => {
    expect(spendPathsForTest('anthropic')).toEqual([
      '/v1/organizations/usage_report/messages',
      '/v1/organizations/cost_report',
    ])
    expect(spendPathsForTest('openai')).toEqual([
      '/v1/organization/usage/completions',
      '/v1/organization/costs',
    ])
    expect(spendPathsForTest('openrouter')).toEqual(['/api/v1/key'])
    expect(spendPathsForTest('deepseek')).toEqual(['/user/balance'])
    expect(spendPathsForTest('groq')).toEqual([])
  })
})

describe('spend estimate from the journal', () => {
  const row = {
    id: 'anthropic',
    label: 'Anthropic',
    totals: {
      tokens: { input: 1250, output: 500 },
      costs: [{ usd: '0.40' }, { usd: '0.10' }],
    },
  }

  it('matches the provider id, label or row provider and sums exactly', () => {
    expect(spendEstimateFromBreakdown([row], ['anthropic'])).toEqual({
      usd: '0.5',
      inputTokens: 1250,
      outputTokens: 500,
    })
    expect(
      spendEstimateFromBreakdown([{ ...row, id: 'x', provider: 'anthropic' }], ['anthropic']),
    ).toEqual({ usd: '0.5', inputTokens: 1250, outputTokens: 500 })
  })

  it('returns no estimate without a row or without dollar lines', () => {
    expect(spendEstimateFromBreakdown([], ['anthropic'])).toBeUndefined()
    expect(spendEstimateFromBreakdown([row], ['openai'])).toBeUndefined()
    expect(
      spendEstimateFromBreakdown(
        [{ ...row, totals: { tokens: { input: 1, output: 2 }, costs: [{}] } }],
        ['anthropic'],
      ),
    ).toBeUndefined()
  })

  it('covers dollars only when the journal recorded no tokens', () => {
    expect(
      spendEstimateFromBreakdown(
        [{ ...row, totals: { tokens: {}, costs: [{ usd: '0.5' }] } }],
        ['anthropic'],
      ),
    ).toEqual({ usd: '0.5' })
  })
})

function spendTestUserFile() {
  return Promise.resolve({
    ok: true as const,
    file: fileWith(['anthropic', 'openrouter']),
  })
}

describe('admin credential commands', () => {
  const readFile = spendTestUserFile

  it('stores the inference key under its own name without --admin', async () => {
    const secrets = secretStore([])
    const deps = authDepsWith(secrets, 'sk-ant-test-inference-key')
    expect(await authSetProvider(deps, 'anthropic', readFile)).toBe(0)
    expect(secrets.has('museSpark.provider.anthropic')).toBe(true)
    expect(secrets.has('museSpark.providerAdmin.anthropic')).toBe(false)
  })

  it('stores the admin key under its own name after saying what it reads', async () => {
    const secrets = secretStore([])
    const deps = authDepsWith(secrets, ' sk-ant-admin01-test ')
    expect(await authSetProvider(deps, 'anthropic', readFile, { admin: true })).toBe(0)
    expect(deps.printed.join('\n')).toContain('whole organisation')
    const stored = secrets.get('museSpark.providerAdmin.anthropic') ?? ''
    expect(stored).toContain('sk-ant-admin01-test')
    expect(stored).not.toContain('museSpark.provider.anthropic')
    expect(secrets.has('museSpark.provider.anthropic')).toBe(false)
  })

  it('refuses admin keys where no report API exists, and empty input', async () => {
    const deps = authDepsWith(secretStore([]), 'some-key')
    expect(await authSetProvider(deps, 'openrouter', readFile, { admin: true })).toBe(1)
    expect(deps.errors.join('\n')).toContain('no spend report')
    const empty = authDepsWith(secretStore([]), ' '.repeat(3))
    expect(await authSetProvider(empty, 'anthropic', readFile, { admin: true })).toBe(1)
  })

  it('reports and clears the admin key without touching the inference key', async () => {
    const secrets = secretStore([
      ['museSpark.provider.anthropic', envelope('https://api.anthropic.com', 'TEST-INFERENCE-KEY')],
    ])
    const absent = authDepsWith(secrets, '')
    expect(await authStatusProvider(absent, 'anthropic', { admin: true })).toBe(1)
    expect(absent.printed.join('\n')).toContain('No admin')
    const both = secretStore([
      ['museSpark.provider.anthropic', envelope('https://api.anthropic.com', 'TEST-INFERENCE-KEY')],
      [
        'museSpark.providerAdmin.anthropic',
        envelope('https://api.anthropic.com', 'TEST-ADMIN-KEY'),
      ],
    ])
    const present = authDepsWith(both, '')
    expect(await authStatusProvider(present, 'anthropic', { admin: true })).toBe(0)
    const clearing = authDepsWith(both, '')
    expect(await authClearProvider(clearing, 'anthropic', { admin: true })).toBe(0)
    expect(clearing.printed.join('\n')).toContain('cleared')
    expect(both.has('museSpark.providerAdmin.anthropic')).toBe(false)
    expect(both.has('museSpark.provider.anthropic')).toBe(true)
  })
})
