// EXECPROVR3 D4/D5/D6/P2-1: global options ride before the command word,
// unknown options get our sentence, report help reaches the problem report,
// auth status names every credential, empty event lists print none, and a
// listed model no run can price warns at list/test time. Each test fails
// without its fix (old route, library sentence, bare id, silent list).

import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  providersList,
  providersTest,
  type ProvidersDeps,
} from '../../src/runtime/providersCommands'
import {
  authStatusAll,
  authStatusProvider,
  type AuthCommandDeps,
} from '../../src/runtime/authCommands'
import { isModelUnpriced, parseCatalogPresence } from '../../src/runtime/exec/providerExec'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'
import { formatStoredProviderSecret, providerSecretAccount } from '../../src/runtime/keyStore'
import { emptyProvidersFile, type ProvidersFile } from '../../src/core/providers/providersFile'
import { CREDENTIAL_RECORD_VERSION, SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { memorySecrets } from './helpers/fakes'
import { REPORT_FACTS } from './helpers/reportFacts'

const STORE = 'test store'

/** Every global option exec accepts, in lead and trail position. */
const GLOBAL_LEADS: readonly (readonly string[])[] = [
  ['--verbose'],
  ['--no-auto-compaction'],
  ['--trust-workspace'],
  ['--allow-contributor-models'],
  ['--allow-dangerously-skip-permissions'],
  ['--web-search'],
  ['--image-generation'],
  ['--account', 'work'],
  ['--backend', 'modelApi'],
  ['--muse-binary', 'muse'],
  ['--shell-sandbox', 'off'],
]

function authDeps(): { deps: AuthCommandDeps; printed: string[]; errors: string[] } {
  const printed: string[] = []
  const errors: string[] = []
  return {
    deps: {
      secrets: memorySecrets(),
      storeName: STORE,
      readSecret: () => Promise.resolve(''),
      print: (line) => {
        printed.push(line)
      },
      printError: (line) => {
        errors.push(line)
      },
    },
    printed,
    errors,
  }
}

function providersDeps(
  file: ProvidersFile | undefined,
  options: {
    readonly secrets?: Record<string, string>
    readonly readCatalog?: () => Promise<unknown>
  } = {},
): { deps: ProvidersDeps; printed: string[] } {
  const printed: string[] = []
  const errors: string[] = []
  const secrets = memorySecrets()
  const stored = Object.entries(options.secrets ?? {})
  for (const [account, value] of stored) void secrets.store(account, value)
  return {
    deps: {
      readUserFile: () =>
        Promise.resolve(
          file === undefined
            ? { ok: false as const, reason: 'missing' as const, detail: 'no file' }
            : { ok: true as const, file },
        ),
      writeUserFile: () => Promise.resolve(true),
      secrets,
      resolveHost: () => Promise.resolve(['93.184.216.34']),
      fetch: () => Promise.resolve(Response.json({ data: [{ id: 'm1' }, { id: 'm2' }] })),
      readSecret: () => Promise.resolve(''),
      print: (line) => {
        printed.push(line)
      },
      printError: (line) => {
        errors.push(line)
      },
      ...(options.readCatalog !== undefined && { readCatalog: options.readCatalog }),
    },
    printed,
  }
}

function groqFile(): ProvidersFile {
  return {
    ...emptyProvidersFile(),
    providers: [
      {
        id: 'groq',
        preset: 'groq',
        address: 'https://api.groq.com',
        auth: 'apiKey',
        models: ['m1'],
      },
    ],
  }
}

function readGroqFile() {
  return Promise.resolve({ ok: true as const, file: groqFile() })
}

function groqSecrets(origin: string): Record<string, string> {
  const account = providerSecretAccount('groq') ?? ''
  return {
    [account]: formatStoredProviderSecret(
      { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin },
      'test-owned-key',
    ),
  }
}

describe('global options ride before the command word (D5)', () => {
  it.each(GLOBAL_LEADS)('parses %s before exec like after it', (...lead) => {
    const before = parseCommandLine([
      ...lead,
      'exec',
      '--backend',
      'modelApi',
      '--max-budget-usd',
      '1',
      '--max-requests',
      '2',
      'task',
    ])
    const after = parseCommandLine([
      'exec',
      ...lead,
      '--backend',
      'modelApi',
      '--max-budget-usd',
      '1',
      '--max-requests',
      '2',
      'task',
    ])
    expect(before).toEqual(after)
    // Flags exec accepts outright reach exec from either side.
    if (after.command === 'exec') expect(before.command).toBe('exec')
  })

  it('reaches exec from either side for the cited --verbose case', () => {
    const task = ['--backend', 'modelApi', '--max-budget-usd', '1', 'task']
    expect(parseCommandLine(['--verbose', 'exec', ...task]).command).toBe('exec')
    expect(parseCommandLine(['exec', '--verbose', ...task]).command).toBe('exec')
  })

  it('leaves other command words where they are', () => {
    // The hoist is exec/scan-secrets only: serve keeps its old shape.
    expect(parseCommandLine(['--verbose', 'serve'])).toEqual(
      parseCommandLine(['serve', '--verbose']),
    )
  })

  it('replaces the library unknown-option sentence with ours', () => {
    const parsed = parseCommandLine(['exec', '--bogus-flag', 'task'])
    expect(parsed).toMatchObject({
      command: 'invalid',
      reason: fill(UI_TEXT.acpUnknownArgument, { argument: '--bogus-flag' }),
    })
    if (parsed.command !== 'invalid') throw new Error('not invalid')
    expect(parsed.reason).not.toContain('positional argument')
  })
})

describe('report help reaches the problem report (P2-1)', () => {
  it.each([
    ['report --help', ['report', '--help']],
    ['report problem --help', ['report', 'problem', '--help']],
    // A value flag's value is never a subcommand word.
    ['report --description foo --help', ['report', '--description', 'foo', '--help']],
  ])('%s routes to the problem report', (_label, argv) => {
    expect(parseCommandLine(argv)).toEqual({ command: 'help', route: 'report' })
  })
})

function missingUserFile() {
  return Promise.resolve({
    ok: false as const,
    reason: 'missing' as const,
    detail: 'first run',
  })
}

describe('auth status answers every credential (D6)', () => {
  it('exits 1 with no key anywhere, 0 with only a provider key', async () => {
    const none = authDeps()
    expect(await authStatusAll(none.deps, missingUserFile)).toBe(1)
    expect(none.printed).toContain(UI_TEXT.acpKeyAbsent)

    const provider = authDeps()
    await provider.deps.secrets.store(
      providerSecretAccount('groq') ?? '',
      formatStoredProviderSecret(
        { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: 'https://api.groq.com' },
        'test-owned-key',
      ),
    )
    expect(
      await authStatusAll(provider.deps, () => Promise.resolve({ ok: true, file: groqFile() })),
    ).toBe(0)
    expect(provider.printed.some((line) => line.includes('Groq'))).toBe(true)
  })

  it('exits 0 with only the Meta key, 1 when the store is unreadable', async () => {
    const meta = authDeps()
    await meta.deps.secrets.store(SECRET_KEYS.modelApiKey, 'meta-key')
    expect(await authStatusAll(meta.deps, missingUserFile)).toBe(0)

    const broken = authDeps()
    broken.deps.secrets.get = () => Promise.reject(new Error('locked'))
    expect(await authStatusAll(broken.deps, missingUserFile)).toBe(1)
  })

  it('names the provider label, never the bare id', async () => {
    const stored = authDeps()
    await stored.deps.secrets.store(
      providerSecretAccount('groq') ?? '',
      formatStoredProviderSecret(
        { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: 'https://api.groq.com' },
        'test-owned-key',
      ),
    )
    expect(await authStatusProvider(stored.deps, 'groq', readGroqFile)).toBe(0)
    expect(stored.printed).toHaveLength(1)
    expect(stored.printed[0]).toContain('Groq')
    expect(stored.printed[0]).not.toContain('groq key')
    expect(stored.printed[0]).not.toMatch(/^A[n]? /)

    const absent = authDeps()
    expect(await authStatusProvider(absent.deps, 'groq', readGroqFile)).toBe(1)
    expect(absent.printed).toEqual([fill(UI_TEXT.providerKeyAbsent, { provider: 'Groq' })])
  })
})

describe('an empty event list prints none (D6)', () => {
  it('ends the Recent events line with none instead of nothing', () => {
    const draft = buildProblemReportDraft({
      description: 'blank panel',
      includeFacts: false,
      includeEvents: true,
      facts: REPORT_FACTS,
      events: [],
      recordingUnavailable: false,
      nowMs: 1_769_000_000_000,
      scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
    })
    expect(draft.text).toContain('Recent events (0):\nnone')
  })
})

function pricedCatalog() {
  return Promise.resolve({ providers: { groq: { models: { m1: { input: 1 } } } } })
}

function unpricedCatalog() {
  return Promise.resolve({ providers: { groq: { models: { other: { input: 1 } } } } })
}

describe('a listed model no run can price warns at list and test time (D4)', () => {
  it('warns on providers list only for the model without a price card', async () => {
    const warned = providersDeps(groqFile(), {
      secrets: groqSecrets('https://api.groq.com'),
      readCatalog: unpricedCatalog,
    })
    expect(await providersList(warned.deps)).toBe(0)
    expect(
      warned.printed.some((line) =>
        line.includes(fill(UI_TEXT.providerModelNoPrice, { ref: 'groq/m1' })),
      ),
    ).toBe(true)

    const quiet = providersDeps(groqFile(), {
      secrets: groqSecrets('https://api.groq.com'),
      readCatalog: pricedCatalog,
    })
    expect(await providersList(quiet.deps)).toBe(0)
    expect(quiet.printed.some((line) => line.includes('price card'))).toBe(false)
  })

  // The first probe loads the Model API bundle entry (its transport and
  // auth sources) inside the test: a genuinely long one-off module load.
  it('warns on providers test for the same unpriced model', async () => {
    const warned = providersDeps(groqFile(), {
      secrets: groqSecrets('https://api.groq.com'),
      readCatalog: unpricedCatalog,
    })
    expect(await providersTest(warned.deps, 'groq')).toBe(0)
    expect(
      warned.printed.some((line) =>
        line.includes(fill(UI_TEXT.providerModelNoPrice, { ref: 'groq/m1' })),
      ),
    ).toBe(true)
  }, 30_000)

  it('never warns for custom, keyless or user-priced models', () => {
    const catalog = parseCatalogPresence({ providers: { groq: { models: {} } } })
    if (catalog === undefined) throw new Error('catalog must parse')
    const entry = {
      auth: 'apiKey' as const,
      prices: undefined,
    }
    expect(isModelUnpriced(catalog, 'custom', entry, 'm1')).toBe(false)
    expect(isModelUnpriced(catalog, 'groq', { ...entry, auth: 'none' }, 'm1')).toBe(false)
    expect(
      isModelUnpriced(
        catalog,
        'groq',
        { ...entry, prices: { m1: { input: 0.1, output: 0.2 } } },
        'm1',
      ),
    ).toBe(false)
    expect(isModelUnpriced(catalog, 'groq', entry, 'm1')).toBe(true)
  })
})
