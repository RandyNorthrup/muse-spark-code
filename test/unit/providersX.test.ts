// M95 lane X (PLAN.md D74): the ACP agent's provider commands. Every test
// below is written to fail: each guards an acceptance-14 behavior (the
// stdin-only key, the user-file-only resolution, the origin pin and the
// per-codec path allowlist).

import { describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { CREDENTIAL_RECORD_VERSION, UI_TEXT } from '../../src/shared/constants'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  isProviderCredentialVariable,
  takeCredentials,
  withoutCredentials,
} from '../../src/runtime/credentialVariables'
import {
  formatStoredProviderSecret,
  parseStoredProviderSecret,
  providerSecretAccount,
} from '../../src/runtime/keyStore'
import {
  keyTargetFor,
  providersAdd,
  providersList,
  providersRemove,
  providersTest,
  type ProvidersDeps,
} from '../../src/runtime/providersCommands'
import {
  allowedProviderPaths,
  isPathAllowed,
  pinProviderFetch,
  readProviderKey,
  resolveProvider,
} from '../../src/runtime/exec/providerExec'
import { emptyProvidersFile, type ProvidersFile } from '../../src/core/providers/providersFile'
import { presetById } from '../../src/core/providers/presets'
import { parseExec, qualifyProviderModel } from '../../src/runtime/exec/execArgs'
import {
  authClearProvider,
  authSetProvider,
  authStatusProvider,
  type AuthCommandDeps,
} from '../../src/runtime/authCommands'

const OPENROUTER_KEY = 'sk-or-test-key-00000000000001'
const GROQ_KEY = 'gsk_test-key-00000000000001'

function mapSecrets(initial: Record<string, string> = {}): {
  readonly store: Map<string, string>
  readonly secrets: SecretStore
} {
  const store = new Map(Object.entries(initial))
  return {
    store,
    secrets: {
      get: (key: string) => Promise.resolve(store.get(key)),
      store: (key: string, value: string) => {
        store.set(key, value)
        return Promise.resolve()
      },
      delete: (key: string) => {
        store.delete(key)
        return Promise.resolve()
      },
    },
  }
}

interface FakeProviders {
  readonly deps: ProvidersDeps
  readonly printed: string[]
  readonly errors: string[]
  readonly written: ProvidersFile[]
  readonly store: Map<string, string>
  readonly fetchCalls: { readonly url: string; readonly headers: Record<string, string> }[]
}

function fakeProviders(
  file: ProvidersFile | undefined,
  options: {
    readonly secrets?: Record<string, string>
    readonly secret?: string
    readonly resolve?: (hostname: string) => Promise<readonly string[]>
    readonly fetch?: typeof fetch
    readonly writeOk?: boolean
  } = {},
): FakeProviders {
  const printed: string[] = []
  const errors: string[] = []
  const written: ProvidersFile[] = []
  const { store, secrets } = mapSecrets(options.secrets)
  const fetchCalls: FakeProviders['fetchCalls'] = []
  const scripted: typeof globalThis.fetch = (url, init) => {
    fetchCalls.push({ url: urlText(url), headers: recordedHeaders(init) })
    return Promise.resolve(Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
  }
  const fetch: typeof globalThis.fetch = options.fetch ?? scripted
  const deps: ProvidersDeps = {
    readUserFile: () =>
      Promise.resolve(
        file === undefined
          ? { ok: false as const, reason: 'missing' as const, detail: 'no file' }
          : { ok: true as const, file },
      ),
    writeUserFile: (next) => {
      written.push(next)
      return Promise.resolve(options.writeOk ?? true)
    },
    secrets,
    resolveHost: options.resolve ?? (() => Promise.resolve(['93.184.216.34'])),
    fetch,
    readSecret: () => Promise.resolve(options.secret ?? ''),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
  return { deps, printed, errors, written, store, fetchCalls }
}

function authDeps(
  file: ProvidersFile | undefined,
  secret = '',
): {
  readonly deps: AuthCommandDeps
  readonly readUserFile: () => ReturnType<ProvidersDeps['readUserFile']>
  readonly printed: string[]
  readonly store: Map<string, string>
} {
  const printed: string[] = []
  const { store, secrets } = mapSecrets()
  const fake = fakeProviders(file, { secret })
  return {
    deps: {
      secrets,
      storeName: 'the test store',
      readSecret: fake.deps.readSecret,
      print: (line) => {
        printed.push(line)
      },
      printError: vi.fn(),
    },
    readUserFile: fake.deps.readUserFile,
    printed,
    store,
  }
}

describe('credential variables (D74 headless)', () => {
  it('strips the provider credential variables no *_API_KEY rule catches', () => {
    for (const name of [
      'AWS_BEARER_TOKEN_BEDROCK',
      'ANTHROPIC_AUTH_TOKEN',
      'HF_TOKEN',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ]) {
      expect(isProviderCredentialVariable(name)).toBe(true)
      expect(isProviderCredentialVariable(name.toLowerCase())).toBe(true)
    }
    const env = {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock',
      ANTHROPIC_AUTH_TOKEN: 'token',
      HF_TOKEN: 'hf',
      GOOGLE_APPLICATION_CREDENTIALS: '/keys/g.json',
      OPENAI_API_KEY: 'sk-x',
      PATH: '/bin',
    }
    const taken = takeCredentials(env)
    expect(taken.map((takenVar) => takenVar.name).toSorted(byName)).toEqual(
      [
        'ANTHROPIC_AUTH_TOKEN',
        'AWS_BEARER_TOKEN_BEDROCK',
        'GOOGLE_APPLICATION_CREDENTIALS',
        'HF_TOKEN',
        'OPENAI_API_KEY',
      ].toSorted(byName),
    )
    expect(env).toEqual({ PATH: '/bin' })
    expect(withoutCredentials({ HF_TOKEN: 'x', KEEP: 'y' })).toEqual({ KEEP: 'y' })
  })

  it('keeps ordinary variables', () => {
    expect(isProviderCredentialVariable('HF_TOKENS')).toBe(false)
    expect(isProviderCredentialVariable('MY_HF_TOKEN_X')).toBe(false)
    expect(isProviderCredentialVariable('PATH')).toBe(false)
  })
})

describe('provider secret accounts and envelopes', () => {
  it('names the secret after the provider id, never meta', () => {
    expect(providerSecretAccount('openrouter')).toBe('museSpark.provider.openrouter')
    expect(providerSecretAccount('meta')).toBe(undefined)
    expect(providerSecretAccount('Meta')).toBe(undefined)
    expect(providerSecretAccount('')).toBe(undefined)
    expect(providerSecretAccount('has space')).toBe(undefined)
  })

  it('round-trips the record plus the secret, and rejects anything else', () => {
    const record = {
      v: CREDENTIAL_RECORD_VERSION,
      auth: 'apiKey',
      origin: 'https://x.example',
    } as const
    const text = formatStoredProviderSecret(record, 'secret-key')
    expect(text).toContain('secret-key')
    expect(parseStoredProviderSecret(JSON.parse(text))).toEqual({ record, key: 'secret-key' })
    for (const bad of [
      undefined,
      null,
      42,
      'text',
      {},
      { v: 1, auth: 'apiKey', origin: 'https://x.example' },
      { v: 1, auth: 'apiKey', origin: 'https://x.example', key: '' },
      { v: 2, auth: 'apiKey', origin: 'https://x.example', key: 'k' },
      { v: 1, auth: 'apiKey', key: 'k' },
    ]) {
      expect(parseStoredProviderSecret(bad)).toBe(undefined)
    }
  })
})

describe('cliArgs provider commands', () => {
  it('parses auth set|status|clear --provider', () => {
    expect(parseCommandLine(['auth', 'set', '--provider', 'openrouter'])).toEqual({
      command: 'authSet',
      provider: 'openrouter',
    })
    expect(parseCommandLine(['auth', 'status', '--provider', 'openrouter'])).toEqual({
      command: 'authStatus',
      provider: 'openrouter',
    })
    expect(parseCommandLine(['auth', 'clear', '--provider', 'openrouter'])).toEqual({
      command: 'authClear',
      provider: 'openrouter',
    })
    expect(parseCommandLine(['auth', 'set'])).toEqual({ command: 'authSet' })
  })

  it('refuses a reserved or malformed provider on auth', () => {
    for (const id of ['meta', 'Meta', '', 'has space']) {
      const parsed = parseCommandLine(['auth', 'set', '--provider', id])
      expect(parsed).toMatchObject({ command: 'invalid' })
    }
  })

  it('keeps serve and login free of provider flags', () => {
    expect(parseCommandLine(['--provider', 'openrouter'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['login', '--provider', 'openrouter'])).toMatchObject({
      command: 'invalid',
    })
    expect(
      parseCommandLine(['auth', 'set', '--provider', 'openrouter', '--preset', 'x']),
    ).toMatchObject({
      command: 'invalid',
    })
  })

  it('parses providers list|test|remove', () => {
    expect(parseCommandLine(['providers', 'list'])).toEqual({ command: 'providersList' })
    expect(parseCommandLine(['providers', 'test', 'openrouter'])).toEqual({
      command: 'providersTest',
      provider: 'openrouter',
    })
    expect(parseCommandLine(['providers', 'remove', 'openrouter'])).toEqual({
      command: 'providersRemove',
      provider: 'openrouter',
    })
    expect(parseCommandLine(['providers', 'test', 'meta'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['providers', 'test'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['providers', 'frobnicate'])).toMatchObject({ command: 'invalid' })
  })

  it('parses providers add with its flags', () => {
    expect(
      parseCommandLine([
        'providers',
        'add',
        '--preset',
        'openrouter',
        '--model',
        'a',
        '--model',
        'b',
        '--privacy',
        'any',
        '--key-stdin',
      ]),
    ).toEqual({
      command: 'providersAdd',
      options: {
        preset: 'openrouter',
        models: ['a', 'b'],
        privacy: 'any',
        privateOk: false,
        keyFromStdin: true,
      },
    })
    expect(
      parseCommandLine([
        'providers',
        'add',
        '--preset',
        'custom',
        '--as',
        'gateway',
        '--address',
        'https://gw.example.com',
        '--format',
        'responses',
        '--model',
        'm',
        '--key-stdin',
        '--private-ok',
      ]),
    ).toMatchObject({
      command: 'providersAdd',
      options: { preset: 'custom', as: 'gateway', format: 'responses', privateOk: true },
    })
  })

  it('refuses providers add without a preset, with a misplaced flag, or with extras', () => {
    expect(parseCommandLine(['providers', 'add', '--model', 'a'])).toMatchObject({
      command: 'invalid',
    })
    expect(
      parseCommandLine(['providers', 'add', '--preset', 'openrouter', '--format', 'chat']),
    ).toMatchObject({ command: 'invalid' })
    expect(
      parseCommandLine(['providers', 'add', '--preset', 'groq', '--privacy', 'any']),
    ).toMatchObject({ command: 'invalid' })
    expect(
      parseCommandLine(['providers', 'add', '--preset', 'groq', '--backend', 'modelApi']),
    ).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['providers', 'add', '--preset', 'groq', 'extra'])).toMatchObject({
      command: 'invalid',
    })
  })
})

describe('execArgs --provider', () => {
  it('needs the Model API backend and a real provider id', () => {
    expect(parseExec({ provider: 'openrouter' }, ['hi'])).toMatchObject({
      ok: false,
      reason: UI_TEXT.execProviderNeedsModelApi,
    })
    expect(
      parseExec({ backend: 'modelApi', 'max-budget-usd': '1', provider: 'meta' }, ['hi']),
    ).toMatchObject({ ok: false })
  })

  it('qualifies a bare model and pins a ref to its provider', () => {
    expect(qualifyProviderModel('openrouter', 'v4')).toBe('openrouter/v4')
    expect(qualifyProviderModel('openrouter', 'openrouter/deepseek/v4')).toBe(
      'openrouter/deepseek/v4',
    )
    // A ref naming another provider is aimed elsewhere: OpenRouter's
    // author/slug models need their own `openrouter/` prefix.
    expect(qualifyProviderModel('openrouter', 'deepseek/v4')).toBe(undefined)
    expect(qualifyProviderModel('openrouter', 'groq/llama')).toBe(undefined)
    expect(qualifyProviderModel(undefined, 'muse-spark-1.3')).toBe('muse-spark-1.3')
    const parsed = parseExec(
      { backend: 'modelApi', 'max-budget-usd': '1', provider: 'openrouter', model: 'y' },
      ['hi'],
    )
    expect(parsed.ok && parsed.options.model).toBe('openrouter/y')
    expect(parsed.ok && parsed.options.provider).toBe('openrouter')
    expect(
      parseExec(
        { backend: 'modelApi', 'max-budget-usd': '1', provider: 'openrouter', model: 'groq/y' },
        ['hi'],
      ).ok,
    ).toBe(false)
  })

  it('parses exec --provider through the command line', () => {
    const parsed = parseCommandLine([
      'exec',
      '--backend',
      'modelApi',
      '--max-budget-usd',
      '1',
      '--provider',
      'openrouter',
      '--model',
      'openrouter/x',
      '--key-stdin',
      'prompt',
    ])
    expect(parsed.command).toBe('exec')
    if (parsed.command !== 'exec') throw new Error('not exec')
    expect(parsed.options.provider).toBe('openrouter')
    expect(parsed.options.model).toBe('openrouter/x')
    expect(parsed.options.keyFromStdin).toBe(true)
  })
})

describe('providers list', () => {
  it('says none are configured, and lists rows without secrets', async () => {
    const empty = fakeProviders(emptyProvidersFile())
    expect(await providersList(empty.deps)).toBe(0)
    expect(empty.printed).toEqual([UI_TEXT.providersNoneFound])

    const file: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'openrouter',
          preset: 'openrouter',
          address: 'https://openrouter.ai',
          auth: 'apiKey',
          models: ['a', 'b'],
        },
      ],
    }
    const full = fakeProviders(file, { secrets: { 'museSpark.provider.openrouter': 'x' } })
    expect(await providersList(full.deps)).toBe(0)
    expect(full.printed).toHaveLength(1)
    expect(full.printed[0]).toContain('openrouter')
    expect(full.printed[0]).toContain('OpenRouter')
    expect(full.printed[0]).not.toContain('x')
  })
})

/** A fetch scripted by URL, with no casts. */
function scriptedFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return (url, init) => Promise.resolve(handler(urlText(url), init))
}

/** A fetch input as text, without stringifying objects. */
function urlText(url: RequestInfo | URL): string {
  if (typeof url === 'string') {
    return url
  }
  return url instanceof URL ? url.href : url.url
}

/** By name, for sorted assertions. */
function byName(left: string, right: string): number {
  return left.localeCompare(right)
}

/** The init's headers as a plain record. */
function recordedHeaders(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers
  const recorded: Record<string, string> = {}
  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      recorded[name] = value
    })
  } else if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      recorded[name] = value
    }
  } else if (headers !== undefined) {
    Object.assign(recorded, headers)
  }
  return recorded
}

function openRouterFetch(): typeof fetch {
  return scriptedFetch((target) => {
    if (target === 'https://openrouter.ai/api/v1/key') {
      return Response.json({ usage: 1, limit: 10 })
    }
    return target === 'https://openrouter.ai/api/v1/models'
      ? Response.json({ data: [{ id: 'm1' }, { id: 'm2' }] })
      : new Response('no', { status: 404 })
  })
}

describe('providers add', () => {
  it('runs the wizard to done and writes the file and the secret together', async () => {
    const fake = fakeProviders(emptyProvidersFile(), { secret: OPENROUTER_KEY })
    const code = await providersAdd(fake.deps, {
      preset: 'openrouter',
      models: ['m1'],
      privateOk: false,
      keyFromStdin: true,
    })
    expect(code).toBe(0)
    expect(fake.errors).toEqual([])
    expect(fake.written).toHaveLength(1)
    const written = fake.written[0]
    expect(written === undefined ? undefined : written.providers).toHaveLength(1)
    const entry = written?.providers[0]
    expect(entry).toMatchObject({
      id: 'openrouter',
      preset: 'openrouter',
      address: 'https://openrouter.ai',
      auth: 'apiKey',
      models: ['m1'],
      routing: { privacy: 'zdr', allowFallbacks: true },
    })
    expect(written?.defaultModel).toBe('openrouter/m1')
    const stored = fake.store.get('museSpark.provider.openrouter')
    expect(stored).toBeDefined()
    const parsed = parseStoredProviderSecret(JSON.parse(stored ?? ''))
    expect(parsed?.record.origin).toBe('https://openrouter.ai')
    expect(parsed?.key).toBe(OPENROUTER_KEY)
    // The key never reaches the terminal output.
    expect([...fake.printed, ...fake.errors].join('\n')).not.toContain(OPENROUTER_KEY)
    expect(fake.printed.at(-1)).toContain('openrouter')
    // OpenRouter's attribution rides every probe request (D74).
    expect(fake.fetchCalls.length).toBeGreaterThan(0)
    for (const call of fake.fetchCalls) {
      expect(call.url.startsWith('https://openrouter.ai/')).toBe(true)
      expect(call.headers['HTTP-Referer']).toContain('github.com')
      expect(call.headers['X-OpenRouter-Title']).toContain('Muse Spark Code')
    }
  })

  it('refuses an unknown preset, a repeat, a bad shape and a missing key', async () => {
    const unknown = fakeProviders(emptyProvidersFile(), { secret: OPENROUTER_KEY })
    expect(
      await providersAdd(unknown.deps, {
        preset: 'nope',
        models: ['m'],
        privateOk: false,
        keyFromStdin: true,
      }),
    ).toBe(1)

    const file: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'groq',
          preset: 'groq',
          address: 'https://api.groq.com',
          auth: 'apiKey',
          models: ['m'],
        },
      ],
    }
    const repeat = fakeProviders(file, { secret: GROQ_KEY })
    expect(
      await providersAdd(repeat.deps, {
        preset: 'groq',
        models: ['m'],
        privateOk: false,
        keyFromStdin: true,
      }),
    ).toBe(1)
    expect(repeat.errors.join(',')).toContain('already configured')

    const shape = fakeProviders(emptyProvidersFile(), { secret: 'wrong-shape' })
    expect(
      await providersAdd(shape.deps, {
        preset: 'groq',
        models: ['m'],
        privateOk: false,
        keyFromStdin: true,
      }),
    ).toBe(1)

    const noKey = fakeProviders(emptyProvidersFile(), { secret: GROQ_KEY })
    expect(
      await providersAdd(noKey.deps, {
        preset: 'groq',
        models: ['m'],
        privateOk: false,
        keyFromStdin: false,
      }),
    ).toBe(1)
    expect(noKey.errors.join(',')).toContain('--key-stdin')
  })

  it('needs at least one ticked model, like the wizard', async () => {
    const fake = fakeProviders(emptyProvidersFile(), { secret: GROQ_KEY })
    expect(
      await providersAdd(fake.deps, {
        preset: 'groq',
        models: [],
        privateOk: false,
        keyFromStdin: true,
      }),
    ).toBe(1)
    expect(fake.written).toHaveLength(0)
    expect(fake.store.size).toBe(0)
  })

  it('asks once before a private-network address is saved', async () => {
    const viaPrivate = fakeProviders(emptyProvidersFile(), {
      secret: 'local-key-ok-1',
      resolve: () => Promise.resolve(['10.1.2.3']),
    })
    expect(
      await providersAdd(viaPrivate.deps, {
        preset: 'custom',
        as: 'gateway',
        address: 'https://gw.example.com/v1',
        format: 'chat',
        models: ['m'],
        privateOk: false,
        keyFromStdin: true,
      }),
    ).toBe(1)
    expect(viaPrivate.errors.join(',')).toContain('--private-ok')
    expect(viaPrivate.written).toHaveLength(0)
  })

  it('leaves paid-token presets to the panel', async () => {
    const fake = fakeProviders(emptyProvidersFile(), {
      secret: 'azure-key-00000000000000000001',
      resolve: () => Promise.resolve(['20.0.0.1']),
    })
    expect(
      await providersAdd(fake.deps, {
        preset: 'azure',
        address: 'myresource',
        models: ['dep'],
        privateOk: false,
        keyFromStdin: true,
      }),
    ).toBe(1)
    expect(fake.errors.join(',')).toContain('Models & Agents panel')
    expect(fake.written).toHaveLength(0)
  })
})

function openRouterFile(): ProvidersFile {
  return {
    ...emptyProvidersFile(),
    providers: [
      {
        id: 'openrouter',
        preset: 'openrouter',
        address: 'https://openrouter.ai',
        auth: 'apiKey',
        models: ['m1'],
      },
    ],
  }
}

function storedSecrets(origin: string, key: string): Record<string, string> {
  return {
    'museSpark.provider.openrouter': formatStoredProviderSecret(
      { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin },
      key,
    ),
  }
}

describe('providers test', () => {
  it('reports the free check with its model count', async () => {
    const fake = fakeProviders(openRouterFile(), {
      secrets: storedSecrets('https://openrouter.ai', OPENROUTER_KEY),
      fetch: openRouterFetch(),
    })
    expect(await providersTest(fake.deps, 'openrouter')).toBe(0)
    expect(fake.printed).toEqual([expect.stringContaining('2 models')])
  })

  it('needs the stored key, and names both origins after an edit', async () => {
    const absent = fakeProviders(openRouterFile(), { fetch: openRouterFetch() })
    expect(await providersTest(absent.deps, 'openrouter')).toBe(1)

    const moved: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'openrouter',
          preset: 'openrouter',
          address: 'https://openrouter.ai.evil.example',
          auth: 'apiKey',
          models: ['m1'],
        },
      ],
    }
    const edited = fakeProviders(moved, {
      secrets: storedSecrets('https://openrouter.ai', OPENROUTER_KEY),
      resolve: () => Promise.resolve(['93.184.216.34']),
    })
    expect(await providersTest(edited.deps, 'openrouter')).toBe(1)
    expect(edited.errors.join(',')).toContain('https://openrouter.ai')
    expect(edited.errors.join(',')).toContain('https://openrouter.ai.evil.example')
  })

  it('fails a bad HTTP answer without sending the key anywhere else', async () => {
    const fake = fakeProviders(openRouterFile(), {
      secrets: storedSecrets('https://openrouter.ai', OPENROUTER_KEY),
      fetch: scriptedFetch(() => new Response('denied', { status: 401 })),
    })
    expect(await providersTest(fake.deps, 'openrouter')).toBe(1)
    expect(fake.errors.join(',')).toContain('401')
  })
})

describe('providers remove', () => {
  it('removes the entry, its secret and a default pointing at it', async () => {
    const file: ProvidersFile = {
      ...emptyProvidersFile(),
      defaultModel: 'openrouter/m1',
      providers: [
        {
          id: 'openrouter',
          preset: 'openrouter',
          address: 'https://openrouter.ai',
          auth: 'apiKey',
          models: ['m1'],
        },
      ],
    }
    const fake = fakeProviders(file, {
      secrets: { 'museSpark.provider.openrouter': 'envelope' },
    })
    expect(await providersRemove(fake.deps, 'openrouter')).toBe(0)
    expect(fake.written).toHaveLength(1)
    expect(fake.written[0]?.providers).toEqual([])
    expect(fake.written[0]?.defaultModel).toBe(undefined)
    expect(fake.store.has('museSpark.provider.openrouter')).toBe(false)
  })

  it('refuses an unknown provider', async () => {
    const fake = fakeProviders(emptyProvidersFile())
    expect(await providersRemove(fake.deps, 'openrouter')).toBe(1)
  })
})

describe('auth --provider', () => {
  it('stores the key from stdin bound to the entry origin', async () => {
    const file: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'groq',
          preset: 'groq',
          address: 'https://api.groq.com',
          auth: 'apiKey',
          models: ['m'],
        },
      ],
    }
    const { deps, readUserFile, printed, store } = authDeps(file, GROQ_KEY)
    expect(await authSetProvider(deps, 'groq', readUserFile)).toBe(0)
    const stored = store.get('museSpark.provider.groq')
    expect(stored).toBeDefined()
    expect(parseStoredProviderSecret(JSON.parse(stored ?? ''))?.record.origin).toBe(
      'https://api.groq.com',
    )
    expect(printed.join(',')).not.toContain(GROQ_KEY)

    expect(await authStatusProvider(deps, 'groq')).toBe(0)
    expect(await authClearProvider(deps, 'groq')).toBe(0)
    expect(store.has('museSpark.provider.groq')).toBe(false)
    expect(await authStatusProvider(deps, 'groq')).toBe(1)
  })

  it('falls back to a fixed preset origin, and refuses the rest', async () => {
    const first = authDeps(emptyProvidersFile(), OPENROUTER_KEY)
    expect(await authSetProvider(first.deps, 'openrouter', first.readUserFile)).toBe(0)

    const loop = authDeps(emptyProvidersFile(), 'k')
    expect(await authSetProvider(loop.deps, 'ollama', loop.readUserFile)).toBe(1)

    const { deps: unknown } = authDeps(emptyProvidersFile(), 'k')
    const missing = authDeps(emptyProvidersFile(), 'k')
    expect(await authSetProvider(unknown, 'nope', missing.readUserFile)).toBe(1)
    expect(await authStatusProvider(unknown, 'meta')).toBe(1)
    expect(await authClearProvider(unknown, 'meta')).toBe(1)
  })
})

describe('keyTargetFor', () => {
  it('prefers the entry address and falls back to fixed origins', async () => {
    const file: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'gw',
          preset: 'custom',
          address: 'https://gw.example.com/v1',
          format: 'chat',
          auth: 'apiKey',
          models: ['m'],
        },
      ],
    }
    const fake = fakeProviders(file)
    expect(await keyTargetFor(fake.deps.readUserFile, 'gw')).toMatchObject({
      ok: true,
      origin: 'https://gw.example.com/v1',
    })
    const bare = fakeProviders(emptyProvidersFile())
    expect(await keyTargetFor(bare.deps.readUserFile, 'openrouter')).toMatchObject({
      ok: true,
      origin: 'https://openrouter.ai',
    })
    const custom = await keyTargetFor(bare.deps.readUserFile, 'custom')
    expect(custom.ok).toBe(false)
    const missing = await keyTargetFor(bare.deps.readUserFile, 'nope')
    expect(missing.ok).toBe(false)
  })
})

/** A public answer for the fixed cloud origins. */
function publicHost(): Promise<readonly string[]> {
  return Promise.resolve(['93.184.216.34'])
}

/** Gemini's captured address answer. */
function geminiHost(): Promise<readonly string[]> {
  return Promise.resolve(['142.250.0.1'])
}

/** The loopback answer, needing no network. */
function loopbackHost(): Promise<readonly string[]> {
  return Promise.resolve(['127.0.0.1'])
}

describe('resolveProvider (user file only)', () => {
  const file: ProvidersFile = {
    ...emptyProvidersFile(),
    providers: [
      {
        id: 'openrouter',
        preset: 'openrouter',
        address: 'https://openrouter.ai',
        auth: 'apiKey',
        models: ['m1'],
      },
    ],
  }

  it('resolves an entry to its pinned origin and request path', async () => {
    const resolved = await resolveProvider(file, 'openrouter', presetById, publicHost)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('unresolved')
    expect(resolved.provider.origin).toBe('https://openrouter.ai')
    expect(resolved.provider.network).toBe('public')
    expect(resolved.provider.request).toMatchObject({
      rule: { kind: 'exact', path: '/api/v1/chat/completions' },
      source: 'capture',
    })
    expect(
      allowedProviderPaths(resolved.provider).filter((rule) => rule.kind === 'exact'),
    ).toContainEqual({ kind: 'exact', path: '/api/v1/models' })
  })

  it('refuses unknown ids, meta and moved origins', async () => {
    const groq = await resolveProvider(file, 'groq', presetById, publicHost)
    expect(groq.ok).toBe(false)
    const meta = await resolveProvider(file, 'meta', presetById, publicHost)
    expect(meta.ok).toBe(false)
    const moved: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'openrouter',
          preset: 'openrouter',
          address: 'https://openrouter.ai.evil.example',
          auth: 'apiKey',
          models: ['m1'],
        },
      ],
    }
    // A name now answering inside still refuses: public names stay public.
    const rebinding = await resolveProvider(moved, 'openrouter', presetById, () =>
      Promise.resolve(['10.9.9.9']),
    )
    expect(rebinding.ok).toBe(false)
  })

  it('ignores whatever a repository file holds: only the given file counts', async () => {
    // The resolver takes the user file's content as its argument and no
    // working directory at all, so a workspace providers.json with the
    // same id cannot aim it elsewhere: this file lacks `groq`.
    const resolved = await resolveProvider(file, 'groq', presetById, publicHost)
    expect(resolved).toMatchObject({ ok: false, error: 'unknown-provider' })
  })
})

describe('pinProviderFetch (origin pin and path allowlist)', () => {
  const file: ProvidersFile = {
    ...emptyProvidersFile(),
    providers: [
      {
        id: 'openrouter',
        preset: 'openrouter',
        address: 'https://openrouter.ai',
        auth: 'apiKey',
        models: ['m1'],
      },
    ],
  }

  async function pinned(extraFetch?: typeof fetch) {
    const resolved = await resolveProvider(file, 'openrouter', presetById, publicHost)
    if (!resolved.ok) throw new Error('unresolved')
    const sent: string[] = []
    const base: typeof fetch =
      extraFetch ??
      scriptedFetch((target) => {
        sent.push(target)
        return new Response('ok')
      })
    return {
      fetch: pinProviderFetch(
        base,
        resolved.provider,
        allowedProviderPaths(resolved.provider),
        publicHost,
      ),
      sent,
    }
  }

  it('passes the codec paths and refuses everything else before sending', async () => {
    const { fetch, sent } = await pinned()
    await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' })
    await fetch('https://openrouter.ai/api/v1/models?zdr=true')
    expect(sent).toHaveLength(2)
    for (const url of [
      'https://openrouter.ai.evil.example/api/v1/models',
      'https://openrouter.ai/admin',
      'https://openrouter.ai/api/v1/chat/completions?debug=1',
      'https://openrouter.ai/api/v1/models#frag',
      'https://user@openrouter.ai/api/v1/models',
      // eslint-disable-next-line unicorn/prefer-https -- the downgraded scheme is the attack
      'http://openrouter.ai/api/v1/models',
      'not a url',
    ]) {
      await expect(fetch(url)).rejects.toThrow()
    }
    expect(sent).toHaveLength(2)
  })

  it('forces redirect error on the inner fetch', async () => {
    let seen: RequestInit | undefined
    const { fetch } = await pinned((_url, init) => {
      seen = init
      return Promise.resolve(new Response('ok'))
    })
    await fetch('https://openrouter.ai/api/v1/models')
    expect(seen?.redirect).toBe('error')
  })

  it('bounds Gemini to its call family and lets loopback stay plain HTTP', async () => {
    const gemini: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'gemini',
          preset: 'gemini',
          address: 'https://generativelanguage.googleapis.com',
          auth: 'apiKey',
          models: ['m'],
        },
      ],
    }
    const resolved = await resolveProvider(gemini, 'gemini', presetById, geminiHost)
    if (!resolved.ok) throw new Error('unresolved')
    expect(resolved.provider.request?.rule).toMatchObject({
      kind: 'family',
      prefix: '/v1beta/models/',
    })
    const sent: string[] = []
    const fetch = pinProviderFetch(
      scriptedFetch((target) => {
        sent.push(target)
        return new Response('ok')
      }),
      resolved.provider,
      allowedProviderPaths(resolved.provider),
      geminiHost,
    )
    await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse',
      { method: 'POST', body: '{}' },
    )
    await expect(
      fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?other=1',
        { method: 'POST', body: '{}' },
      ),
    ).rejects.toThrow()
    expect(sent).toHaveLength(1)

    const local: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [
        {
          id: 'ollama',
          preset: 'ollama',
          address: 'http://127.0.0.1:11434',
          auth: 'none',
          models: ['m'],
        },
      ],
    }
    const loop = await resolveProvider(local, 'ollama', presetById, loopbackHost)
    if (!loop.ok) throw new Error('unresolved')
    expect(loop.provider.network).toBe('local')
    const localSent: string[] = []
    const localFetch = pinProviderFetch(
      scriptedFetch((target) => {
        localSent.push(target)
        return new Response('ok')
      }),
      loop.provider,
      allowedProviderPaths(loop.provider),
      loopbackHost,
    )
    await localFetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: '{}' })
    await expect(
      localFetch('https://127.0.0.1:11434/api/chat', { method: 'POST', body: '{}' }),
    ).rejects.toThrow()
    expect(localSent).toHaveLength(1)
    expect(
      isPathAllowed(
        { kind: 'exact', path: '/api/chat' },
        new URL('http://127.0.0.1:11434/api/chat'),
      ),
    ).toBe(true)
  })
})

describe('readProviderKey', () => {
  const file: ProvidersFile = {
    ...emptyProvidersFile(),
    providers: [
      {
        id: 'openrouter',
        preset: 'openrouter',
        address: 'https://openrouter.ai',
        auth: 'apiKey',
        models: ['m1'],
      },
    ],
  }

  async function provider() {
    const resolved = await resolveProvider(file, 'openrouter', presetById, publicHost)
    if (!resolved.ok) throw new Error('unresolved')
    return resolved.provider
  }

  it('reads a bound key and refuses a moved one with its record', async () => {
    const { secrets } = mapSecrets({
      'museSpark.provider.openrouter': formatStoredProviderSecret(
        { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: 'https://openrouter.ai' },
        OPENROUTER_KEY,
      ),
    })
    const bound = await provider()
    expect(await readProviderKey(secrets, bound)).toMatchObject({
      ok: true,
      key: OPENROUTER_KEY,
    })
    const { secrets: empty } = mapSecrets()
    const missing = await readProviderKey(empty, bound)
    expect(missing.ok).toBe(false)

    const moved = await resolveProvider(
      {
        ...emptyProvidersFile(),
        providers: [
          {
            id: 'openrouter',
            preset: 'openrouter',
            address: 'https://openrouter.ai.evil.example',
            auth: 'apiKey',
            models: ['m1'],
          },
        ],
      },
      'openrouter',
      presetById,
      publicHost,
    )
    if (!moved.ok) throw new Error('unresolved')
    const mismatch = await readProviderKey(secrets, moved.provider)
    expect(mismatch.ok).toBe(false)
    if (mismatch.ok) throw new Error('should refuse')
    expect(mismatch.error).toBe('origin-mismatch')
    expect(mismatch.record?.origin).toBe('https://openrouter.ai')
  })
})
