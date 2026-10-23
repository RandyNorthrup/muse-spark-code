// PROVSPEND (2026-10-12): terminal `providers usage` and `auth --admin`.
// Real code only: the command parsing, the refusal paths that never reach
// the network (with the real fetch passed but never called), the report
// path pins, the journal estimate and the admin credential separation.
// Report reads that need provider answers have no suite: answering for
// the provider would be a stand-in, and only a live call proves them.

import { describe, expect, it } from 'vitest'
// The static import warms the lazily loaded providers bundle at
// collection time, so the first report read runs inside the repository's
// own per-test timeout.
import '../../src/host/backend/providersEntry'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import {
  providersUsage,
  spendAllowedPaths,
  spendEstimateFromBreakdown,
} from '../../src/runtime/providersSpend'
import type { ProvidersDeps } from '../../src/runtime/providersCommands'
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

function spendPathsForTest(id: string): readonly string[] {
  const paths: string[] = []
  for (const rule of spendAllowedPaths(id)) {
    if (rule.kind === 'exact') paths.push(rule.path)
  }
  return paths
}

function envelope(key: string): string {
  return formatStoredProviderSecret(
    { v: 1, auth: 'apiKey', origin: 'https://api.anthropic.com' },
    key,
  )
}

function fakeSecretStore(secrets: Map<string, string>) {
  return {
    get: (key: string) => Promise.resolve(secrets.get(key)),
    store: (key: string, value: string) => {
      secrets.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      secrets.delete(key)
      return Promise.resolve()
    },
  }
}

function depsWith(
  file: ProvidersFile,
  secrets: Map<string, string>,
  fetch: typeof globalThis.fetch,
): ProvidersDeps & { readonly printed: string[]; readonly errors: string[] } {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    readUserFile: () => Promise.resolve({ ok: true as const, file }),
    writeUserFile: () => Promise.resolve(true),
    secrets: fakeSecretStore(secrets),
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
    secrets: fakeSecretStore(secrets),
    storeName: 'test store',
    readSecret: () => Promise.resolve(secret),
    confirmKeyUse: () => Promise.reject(new Error('provider-spend-terminal asks no key question')),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
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

  it('takes any whole number of days from 1 up (D121: no ceiling of ours)', () => {
    expect(parseCommandLine(['providers', 'usage', 'anthropic', '--days', '367'])).toMatchObject({
      command: 'providersUsage',
      provider: 'anthropic',
      days: 367,
    })
  })

  it('refuses bad periods, outputs, providers and foreign flags', () => {
    for (const argv of [
      ['providers', 'usage', 'anthropic', '--days', '0'],
      ['providers', 'usage', 'anthropic', '--days', 'many'],
      ['providers', 'usage', 'anthropic', '--output', 'yaml'],
      ['providers', 'usage', 'meta'],
      ['providers', 'usage', 'anthropic', 'openai'],
      ['providers', 'usage', 'anthropic', '--preset', 'anthropic'],
      ['providers', 'usage', 'anthropic', '--admin'],
    ]) {
      expect(parseCommandLine(argv).command).toBe('invalid')
    }
    // Bare `providers usage` is the key-usage command (it names the
    // missing id and lists the configured ones), not the spend report.
    expect(parseCommandLine(['providers', 'usage'])).toEqual({ command: 'providerKeyUsage' })
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
  // These paths refuse before any request: the real fetch rides along but
  // is never called.
  it('refuses unknown providers and providers with no report API', async () => {
    const missing = depsWith(fileWith([]), new Map(), fetch)
    expect(await providersUsage(missing, { provider: 'groq', days: 30, json: false })).toBe(1)
    const none = depsWith(fileWith(['groq']), new Map(), fetch)
    expect(await providersUsage(none, { provider: 'groq', days: 30, json: false })).toBe(1)
    expect(none.printed.join('\n')).toContain('no spend report')
  })

  it('asks for the admin key when none is stored', async () => {
    const deps = depsWith(fileWith(['anthropic']), new Map(), fetch)
    expect(await providersUsage(deps, { provider: 'anthropic', days: 30, json: false })).toBe(1)
    expect(deps.printed.join('\n')).toContain('No admin')
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
    const secrets = secretStore([['museSpark.provider.anthropic', envelope('TEST-INFERENCE-KEY')]])
    const absent = authDepsWith(secrets, '')
    expect(await authStatusProvider(absent, 'anthropic', { admin: true })).toBe(1)
    expect(absent.printed.join('\n')).toContain('No admin')
    const both = secretStore([
      ['museSpark.provider.anthropic', envelope('TEST-INFERENCE-KEY')],
      ['museSpark.providerAdmin.anthropic', envelope('TEST-ADMIN-KEY')],
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
