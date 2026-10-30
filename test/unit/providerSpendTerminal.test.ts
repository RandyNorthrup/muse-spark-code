// PROVSPEND (2026-10-12): terminal `providers usage` and `auth --admin`
// over the real composition. The providers file lives in a temp folder
// behind the production file IO, the resolver and fetch are production's
// own, and the provider's address is an owned recording loopback, so the
// wire (paths, query windows, auth isolation) is observed for real. The
// secret store stays Map-backed (the OS store is unownable) and the key
// prompt tripwire-rejects unless the case arranges a person's answer. No
// fixed clock: report windows are asserted against real time. Report
// contents need live provider bytes and live in docs/real-life/unproven.md.

import path from 'node:path'
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
  parseStoredProviderSecret,
  providerAdminSecretAccount,
  providerSecretAccount,
} from '../../src/runtime/keyStore'
import {
  providersUsage,
  spendAllowedPaths,
  spendEstimateFromBreakdown,
} from '../../src/runtime/providersSpend'
import { userFileIo, type ProvidersDeps } from '../../src/runtime/providersCommands'
import { resolveEndpointHost } from '../../src/runtime/providerPaths'
import { mapSecretsBacked } from './helpers/mapSecrets'
import { recordingHttpEndpoint, type RecordingLoopbackEndpoint } from './helpers/loopbackServers'
import { usingTempDir } from './helpers/temporaryFolders'
import {
  authClearProvider,
  authSetProvider,
  authStatusProvider,
  type AuthCommandDeps,
} from '../../src/runtime/authCommands'
import {
  readProvidersFile,
  writeProvidersFileAtomic,
  type ProvidersFile,
  type ProvidersFileRead,
} from '../../src/core/providers/providersFile'
import { ACCOUNT_DAY_MS } from '../../src/shared/constants'

function fileWith(ids: readonly string[]): ProvidersFile {
  return {
    v: 1,
    providers: ids.map((id) => ({
      id,
      preset: id,
      auth: 'apiKey' as const,
      models: [],
    })),
  }
}

/** The provider aimed at the owned loopback, like a person pointing it at a gateway. */
function loopbackFile(id: string, origin: string): ProvidersFile {
  return {
    v: 1,
    providers: [{ id, preset: id, address: origin, auth: 'apiKey' as const, models: [] }],
  }
}

function secretStore(entries: readonly (readonly [string, string])[]): Map<string, string> {
  return new Map<string, string>(entries)
}

async function writeTestFile(filePath: string, file: ProvidersFile): Promise<void> {
  const written = await writeProvidersFileAtomic(filePath, file)
  expect(written.ok).toBe(true)
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

/** No usage path below asks the person for a key: one that does fails loudly. */
function tripwireReadSecret(): Promise<string> {
  return Promise.reject(new Error('spend terminal test asks no key-use question'))
}

type UsageCaseDeps = ProvidersDeps & {
  readonly printed: string[]
  readonly errors: string[]
}

function usageDeps(filePath: string, secrets: Map<string, string>): UsageCaseDeps {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    ...userFileIo(filePath),
    secrets: mapSecretsBacked(secrets),
    resolveHost: resolveEndpointHost,
    fetch: globalThis.fetch.bind(globalThis),
    readSecret: tripwireReadSecret,
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
}

/**
A usage case against the owned loopback: the temp providers file carries
the file the bound origin builds, the loopback refuses every report, and
the run observes the real wire.
*/
async function withLoopbackUsage<T>(
  file: (origin: string) => ProvidersFile,
  secrets: (origin: string) => Map<string, string>,
  run: (deps: UsageCaseDeps, endpoint: RecordingLoopbackEndpoint) => T | Promise<T>,
): Promise<T> {
  return await usingTempDir('spend-terminal-', async (dir) => {
    const endpoint = await recordingHttpEndpoint((response) => {
      response.writeHead(404).end()
    })
    try {
      const filePath = path.join(dir, 'providers.json')
      await writeTestFile(filePath, file(endpoint.url))
      return await run(usageDeps(filePath, secrets(endpoint.url)), endpoint)
    } finally {
      await endpoint.close()
    }
  })
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
      ['providers', 'usage', 'anthropic', 'openai'],
      ['providers', 'usage', 'anthropic', '--preset', 'anthropic'],
      ['providers', 'usage', 'anthropic', '--admin'],
    ]) {
      expect(parseCommandLine(argv).command).toBe('invalid')
    }
    // Bare `providers usage` names the missing id and lists the configured
    // ids instead (RLTESTDRIVE2 14).
    expect(parseCommandLine(['providers', 'usage']).command).toBe('providersUsageTargets')
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
    await usingTempDir('spend-terminal-', async (dir) => {
      const endpoint = await recordingHttpEndpoint((response) => {
        response.writeHead(404).end()
      })
      try {
        const filePath = path.join(dir, 'providers.json')
        await writeTestFile(filePath, fileWith([]))
        const missing = usageDeps(filePath, secretStore([]))
        expect(await providersUsage(missing, { provider: 'groq', days: 30, json: false })).toBe(1)
        expect(missing.errors.join('\n')).toContain('groq')
        await writeTestFile(filePath, loopbackFile('groq', endpoint.url))
        const none = usageDeps(filePath, secretStore([]))
        expect(await providersUsage(none, { provider: 'groq', days: 30, json: false })).toBe(1)
        expect(none.printed.join('\n')).toContain('no spend report')
        expect(endpoint.hits()).toBe(0)
      } finally {
        await endpoint.close()
      }
    })
  })

  it('asks for the admin key when none is stored', async () => {
    await withLoopbackUsage(
      (origin) => loopbackFile('anthropic', origin),
      () => secretStore([]),
      async (deps, endpoint) => {
        expect(await providersUsage(deps, { provider: 'anthropic', days: 30, json: false })).toBe(1)
        expect(deps.printed.join('\n')).toContain('No admin')
        expect(endpoint.hits()).toBe(0)
      },
    )
  })

  it('refuses a credential bound to another origin, naming both', async () => {
    await withLoopbackUsage(
      (origin) => loopbackFile('anthropic', origin),
      () =>
        secretStore([
          [
            providerAdminSecretAccount('anthropic') ?? '',
            envelope('https://api.anthropic.com', 'TEST-ADMIN-KEY'),
          ],
        ]),
      async (deps, endpoint) => {
        expect(await providersUsage(deps, { provider: 'anthropic', days: 30, json: false })).toBe(1)
        const errors = deps.errors.join('\n')
        expect(errors).toContain('https://api.anthropic.com')
        expect(errors).toContain(endpoint.url)
        expect(endpoint.hits()).toBe(0)
      },
    )
  })

  it('sends only the admin key to the report path and renders refusals as fixed sentences', async () => {
    // Both keys are stored; the loopback refuses. The wire must carry the
    // usage-report path with its real nine-day window and the admin key
    // alone, and the refusal reads as the fixed sentence.
    await withLoopbackUsage(
      (origin) => loopbackFile('anthropic', origin),
      (origin) =>
        secretStore([
          [providerAdminSecretAccount('anthropic') ?? '', envelope(origin, 'TEST-ADMIN-KEY')],
          [providerSecretAccount('anthropic') ?? '', envelope(origin, 'TEST-INFERENCE-KEY')],
        ]),
      async (deps, endpoint) => {
        const started = Date.now()
        expect(await providersUsage(deps, { provider: 'anthropic', days: 9, json: false })).toBe(1)
        const ended = Date.now()
        expect(deps.errors.join('\n')).toContain('refused')
        // The refusal stops the sequence: the cost report is never requested.
        expect(endpoint.hits()).toBe(1)
        const [seen] = endpoint.requests()
        expect(seen?.url.split('?', 1)[0]).toBe(spendPathsForTest('anthropic')[0])
        const query = new URL(seen?.url ?? '', endpoint.url).searchParams
        const startingAt = Date.parse(query.get('starting_at') ?? '')
        const endingAt = Date.parse(query.get('ending_at') ?? '')
        expect(startingAt).toBeGreaterThanOrEqual(started - 9 * ACCOUNT_DAY_MS)
        expect(startingAt).toBeLessThanOrEqual(ended - 9 * ACCOUNT_DAY_MS)
        expect(endingAt).toBeGreaterThanOrEqual(started)
        expect(endingAt).toBeLessThanOrEqual(ended)
        // Only the stored admin key travels, and only to the report path.
        const wire = Object.values(seen?.headers ?? {})
          .flat()
          .join('\n')
        expect(wire).toContain('TEST-ADMIN-KEY')
        expect(wire).not.toContain('TEST-INFERENCE-KEY')
      },
    )
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

async function withAuthFile<T>(
  run: (readFile: () => Promise<ProvidersFileRead>) => T | Promise<T>,
): Promise<T> {
  return await usingTempDir('spend-terminal-', async (dir) => {
    const filePath = path.join(dir, 'providers.json')
    await writeTestFile(filePath, fileWith(['anthropic', 'openrouter']))
    return await run(() => readProvidersFile(filePath))
  })
}

describe('admin credential commands', () => {
  it('stores the inference key under its own name without --admin', async () => {
    await withAuthFile(async (readFile) => {
      const secrets = secretStore([])
      const deps = authDepsWith(secrets, 'sk-ant-test-inference-key')
      expect(await authSetProvider(deps, 'anthropic', readFile)).toBe(0)
      expect(secrets.has('museSpark.provider.anthropic')).toBe(true)
      expect(secrets.has('museSpark.providerAdmin.anthropic')).toBe(false)
      // The address-less entry binds the key to the preset's fixed origin.
      const stored = parseStoredProviderSecret(
        JSON.parse(secrets.get('museSpark.provider.anthropic') ?? ''),
      )
      expect(stored?.record.origin).toBe('https://api.anthropic.com')
    })
  })

  it('stores the admin key under its own name after saying what it reads', async () => {
    await withAuthFile(async (readFile) => {
      const secrets = secretStore([])
      const deps = authDepsWith(secrets, ' sk-ant-admin01-test ')
      expect(await authSetProvider(deps, 'anthropic', readFile, { admin: true })).toBe(0)
      expect(deps.printed.join('\n')).toContain('whole organisation')
      const stored = secrets.get('museSpark.providerAdmin.anthropic') ?? ''
      expect(stored).toContain('sk-ant-admin01-test')
      expect(stored).not.toContain('museSpark.provider.anthropic')
      expect(secrets.has('museSpark.provider.anthropic')).toBe(false)
      expect(parseStoredProviderSecret(JSON.parse(stored))?.record.origin).toBe(
        'https://api.anthropic.com',
      )
    })
  })

  it('refuses admin keys where no report API exists, and empty input', async () => {
    await withAuthFile(async (readFile) => {
      const deps = authDepsWith(secretStore([]), 'some-key')
      expect(await authSetProvider(deps, 'openrouter', readFile, { admin: true })).toBe(1)
      expect(deps.errors.join('\n')).toContain('no spend report')
      const empty = authDepsWith(secretStore([]), ' '.repeat(3))
      expect(await authSetProvider(empty, 'anthropic', readFile, { admin: true })).toBe(1)
    })
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
