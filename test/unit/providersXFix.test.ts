import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  PROVIDER_CREDENTIAL_ENV_NAMES,
  takeCredentials,
} from '../../src/runtime/credentialVariables'
import {
  providersAdd,
  providersRemove,
  providersTest,
  userFileIo,
  type ProvidersDeps,
} from '../../src/runtime/providersCommands'
import {
  allowedProviderPaths,
  pinProviderFetch,
  resolveProvider,
} from '../../src/runtime/exec/providerExec'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import {
  emptyProvidersFile,
  type ProviderEntry,
  type ProvidersFile,
} from '../../src/core/providers/providersFile'
import { presetById } from '../../src/core/providers/presets'
import { HOOK_FORBIDDEN_ENV_NAMES } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { tableProblems } from '../../src/shared/l10n/check'

const KEY = 'sk-or-test-key-00000000000001'
const ACCOUNT = 'museSpark.provider.openrouter'
const OPENROUTER: ProviderEntry = {
  id: 'openrouter',
  preset: 'openrouter',
  auth: 'apiKey',
  models: ['m'],
}

function fake(file: ProvidersFile = emptyProvidersFile()) {
  const state = { file, writeOk: true, storeFails: false, deleteFails: false }
  const secrets = new Map<string, string>()
  const calls: { url: string; headers: Headers }[] = []
  const errors: string[] = []
  const printed: string[] = []
  const deps: ProvidersDeps = {
    readUserFile: () => Promise.resolve({ ok: true, file: structuredClone(state.file) }),
    writeUserFile: (next) => {
      if (state.writeOk) state.file = structuredClone(next)
      return Promise.resolve(state.writeOk)
    },
    secrets: {
      get: (name) => Promise.resolve(secrets.get(name)),
      store: (name, value) => {
        if (state.storeFails) return Promise.reject(new Error('store unavailable'))
        secrets.set(name, value)
        return Promise.resolve()
      },
      delete: (name) => {
        if (state.deleteFails) return Promise.reject(new Error('store unavailable'))
        secrets.delete(name)
        return Promise.resolve()
      },
    },
    resolveHost: () => Promise.resolve(['93.184.216.34']),
    fetch: (url, init) => {
      let text: string
      if (typeof url === 'string') text = url
      else text = url instanceof URL ? url.href : url.url
      calls.push({ url: text, headers: new Headers(init?.headers) })
      return Promise.resolve(Response.json({ data: [{ id: 'm' }] }))
    },
    readSecret: () => Promise.resolve(KEY),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
  return { state, secrets, calls, errors, printed, deps }
}

function options(id = 'openrouter') {
  return { preset: 'openrouter', as: id, models: ['m'], privateOk: false, keyFromStdin: true }
}

function withKey() {
  const f = fake({ ...emptyProvidersFile(), defaultModel: 'openrouter/m', providers: [OPENROUTER] })
  f.secrets.set(
    ACCOUNT,
    formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: 'https://openrouter.ai' }, KEY),
  )
  return f
}

afterEach(() => {
  vi.unstubAllEnvs()
  setUiText(EN, BASE_LOCALE)
})

describe('FIXM95X regressions', () => {
  it('F1 never restores planted credential names or provider key shapes to Muse Code', async () => {
    const names = [
      ...HOOK_FORBIDDEN_ENV_NAMES,
      ...PROVIDER_CREDENTIAL_ENV_NAMES,
      'META_API_KEY',
      'OPENAI_API_KEY',
      'AZURE_API_KEY',
      'XAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'GROQ_API_KEY',
      'DEEPSEEK_API_KEY',
      'MISTRAL_API_KEY',
      'TOGETHER_API_KEY',
      'FIREWORKS_API_KEY',
      'HF_API_KEY',
      'ZAI_API_KEY',
      'unknown_API_KEY',
    ]
    const shapes = [
      'sk-test-key-00000000000001',
      'xai-test-key-00000000000001',
      'sk-ant-test-key-00000000000001',
      'AIza-test-key-00000000000000000001',
      KEY,
      'gsk_test-key-00000000000001',
      'fw-test-key-00000000000001',
      'hf_test-key',
      '0123456789abcdef0123456789abcdef.abcdefgh',
      'opaque-test-key-00000001',
    ]
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/test',
      XDG_CONFIG_HOME: '/config',
      XDG_DATA_HOME: '/data',
      UNSAFE_UNKNOWN: KEY,
    }
    for (const name of names) {
      env[name] = shapes[names.indexOf(name) % shapes.length]
      vi.stubEnv(name, env[name])
      env[name.toLowerCase()] = KEY
    }
    takeCredentials(env)
    const command = parseCommandLine([])
    if (command.command !== 'serve') throw new Error('no serve options')
    const runtime = createRuntimeBackend({
      options: command.options,
      version: 'test',
      distDir: '/dist',
      platform: process.platform,
      env,
      homeDir: '/home/test',
      secrets: fake().deps.secrets,
      runGit: () => Promise.reject(new Error('no git')),
      fetch: fake().deps.fetch,
      sleep: () => Promise.resolve(),
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    const child = runtime.museCode.childEnvironment()
    for (const name of names) {
      expect(child[name], name).toBeUndefined()
      expect(child[name.toLowerCase()], name).toBeUndefined()
    }
    expect(child['UNSAFE_UNKNOWN']).toBeUndefined()
    expect(child['XDG_CONFIG_HOME']).toBe('/config')
    expect(child['XDG_DATA_HOME']).toBe('/data')
    expect(runtime.museCode.hasEnvironmentKey()).toBe(false)
    await runtime.close()
  })

  it('F2 leaves add retryable when secret storage rejects', async () => {
    const f = fake()
    f.state.storeFails = true
    expect(await providersAdd(f.deps, options())).toBe(1)
    expect(f.state.file).toEqual(emptyProvidersFile())
    f.state.storeFails = false
    expect(await providersAdd(f.deps, options())).toBe(0)
    expect(f.secrets.get(ACCOUNT)).toContain(KEY)
  })

  it('F2 leaves remove retryable when secret deletion rejects', async () => {
    const f = withKey()
    const before = structuredClone(f.state.file)
    f.state.deleteFails = true
    expect(await providersRemove(f.deps, 'openrouter')).toBe(1)
    expect(f.state.file).toEqual(before)
    expect(f.secrets.get(ACCOUNT)).toContain(KEY)
    f.state.deleteFails = false
    expect(await providersRemove(f.deps, 'openrouter')).toBe(0)
  })

  it('F2 restores prior secrets when file writes fail', async () => {
    const add = fake()
    add.secrets.set(ACCOUNT, 'previous-envelope')
    add.state.writeOk = false
    expect(await providersAdd(add.deps, options())).toBe(1)
    expect(add.secrets.get(ACCOUNT)).toBe('previous-envelope')
    const remove = withKey()
    const secret = remove.secrets.get(ACCOUNT)
    remove.state.writeOk = false
    expect(await providersRemove(remove.deps, 'openrouter')).toBe(1)
    expect(remove.secrets.get(ACCOUNT)).toBe(secret)
    expect(remove.state.file.providers).toEqual([OPENROUTER])
  })

  it('F3 preserves both simultaneous adds and edits made during probing', async () => {
    const f = fake()
    expect(
      await Promise.all([
        providersAdd(f.deps, options('first')),
        providersAdd(f.deps, options('second')),
      ]),
    ).toEqual([0, 0])
    expect(
      f.state.file.providers
        .map((entry) => entry.id)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['first', 'second'])
    expect(f.secrets.size).toBe(2)
    const edited = fake()
    const editedDeps = {
      ...edited.deps,
      fetch: () => {
        edited.state.file = {
          ...emptyProvidersFile(),
          defaultModel: 'other/m',
          providers: [{ ...OPENROUTER, id: 'other', pinned: ['m'] }],
        }
        return Promise.resolve(Response.json({ data: [{ id: 'm' }] }))
      },
    }
    expect(await providersAdd(editedDeps, options())).toBe(0)
    expect(edited.state.file.defaultModel).toBe('other/m')
    expect(edited.state.file.providers[0]?.pinned).toEqual(['m'])
    expect(edited.state.file.providers).toHaveLength(2)
  })

  it('F3 production locks exclude competing writers and reject stale snapshots', async () => {
    const root = path.join(process.cwd(), 'temp')
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(path.join(root, 'providers-x-fix-'))
    try {
      const target = path.join(directory, 'providers.json')
      const first = userFileIo(target)
      const second = userFileIo(target)
      await first.withUserFileLock(async () => {
        await expect(second.withUserFileLock(() => Promise.resolve(0))).rejects.toThrow()
        const changed = { ...emptyProvidersFile(), providers: [OPENROUTER] }
        await writeFile(target, JSON.stringify(changed))
        expect(await first.writeUserFile(emptyProvidersFile(), emptyProvidersFile())).toBe(false)
        expect(await second.readUserFile()).toEqual({ ok: true, file: changed })
        return 0
      })
      expect(await second.withUserFileLock(() => Promise.resolve(0))).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('F2 reports failed compensation without claiming success or printing secrets', async () => {
    const f = withKey()
    f.state.writeOk = false
    f.state.storeFails = true
    expect(await providersRemove(f.deps, 'openrouter')).toBe(1)
    expect(f.errors.join(' ')).toContain('could not be restored')
    expect(f.errors.join(' ')).not.toContain(KEY)
    expect(f.printed).toEqual([])
    expect(f.state.file.providers).toEqual([OPENROUTER])
  })

  it('F4 carries private confirmation into add resolution and later tests', async () => {
    const f = fake()
    const deps = { ...f.deps, resolveHost: () => Promise.resolve(['10.1.2.3']) }
    expect(
      await providersAdd(deps, {
        ...options('gateway'),
        preset: 'custom',
        address: 'https://gateway.example/v1',
        format: 'chat',
        privateOk: true,
      }),
    ).toBe(0)
    expect(f.state.file.providers[0]?.privateNetwork).toBe(true)
    expect(await providersTest(deps, 'gateway')).toBe(0)
    expect(f.errors).toEqual([])
  })

  it('F4 reports endpoint rebinding instead of a pending capture', async () => {
    const f = fake()
    let calls = 0
    const deps = {
      ...f.deps,
      resolveHost: () => Promise.resolve([calls++ === 0 ? '93.184.216.34' : '10.1.2.3']),
    }
    expect(await providersAdd(deps, options())).toBe(1)
    expect(f.errors.join(' ')).toContain('address changed networks')
    expect(f.errors.join(' ')).not.toContain('capture')
    expect(f.calls).toEqual([])
    expect(f.secrets.size).toBe(0)
  })

  it('F5 accepts Together captured top-level model arrays and rejects malformed rows', async () => {
    const capture: unknown = JSON.parse(
      await readFile('docs/certification/m95-captures/together/01-models-list.json', 'utf8'),
    )
    const sample = togetherSample(capture)
    const f = fake()
    const deps = { ...f.deps, fetch: () => Promise.resolve(Response.json(sample)) }
    expect(await providersAdd(deps, { ...options('together'), preset: 'together' })).toBe(0)
    expect(await providersTest(deps, 'together')).toBe(0)
    expect(f.printed.at(-1)).toContain('5 models')
    const other = withKey()
    expect(
      await providersTest(
        { ...other.deps, fetch: () => Promise.resolve(Response.json(sample)) },
        'openrouter',
      ),
    ).toBe(1)
    expect(
      await providersTest(
        { ...deps, fetch: () => Promise.resolve(Response.json([{ id: 7 }])) },
        'together',
      ),
    ).toBe(1)
  })

  it('F6 sends captured Anthropic version and custom Messages key header', async () => {
    for (const isCustom of [false, true]) {
      const f = fake()
      const deps = {
        ...f.deps,
        readSecret: () => Promise.resolve('sk-ant-test-key-00000000000001'),
      }
      expect(
        await providersAdd(deps, {
          ...options(isCustom ? 'messages' : 'anthropic'),
          preset: isCustom ? 'custom' : 'anthropic',
          ...(isCustom && {
            address: 'https://messages.example',
            format: 'anthropic' as const,
          }),
        }),
      ).toBe(0)
      expect(await providersTest(deps, isCustom ? 'messages' : 'anthropic')).toBe(0)
      for (const call of f.calls) {
        expect(call.headers.get('anthropic-version')).toBe('2023-06-01')
        expect(call.headers.get(isCustom ? 'x-api-key' : 'authorization')).toBe(
          isCustom ? 'sk-ant-test-key-00000000000001' : 'Bearer sk-ant-test-key-00000000000001',
        )
        if (isCustom) expect(call.headers.has('authorization')).toBe(false)
      }
    }
  })

  it.each(['chat', 'responses', 'anthropic'] as const)(
    'F7 preserves custom base paths and pins %s requests beneath them',
    async (format) => {
      const f = fake()
      expect(
        await providersAdd(f.deps, {
          ...options('gateway'),
          preset: 'custom',
          address: 'https://gateway.example/gateway/v2/',
          format,
        }),
      ).toBe(0)
      expect(f.state.file.providers[0]?.address).toBe('https://gateway.example/gateway/v2')
      expect(f.calls[0]?.url).toBe('https://gateway.example/gateway/v2/models')
      const resolved = await resolveProvider(
        f.state.file,
        'gateway',
        presetById,
        f.deps.resolveHost,
      )
      if (!resolved.ok) throw new Error('not resolved')
      const pinned = pinProviderFetch(
        f.deps.fetch,
        resolved.provider,
        allowedProviderPaths(resolved.provider),
        f.deps.resolveHost,
      )
      const suffix = { chat: '/chat/completions', responses: '/responses', anthropic: '/messages' }[
        format
      ]
      await pinned(`https://gateway.example/gateway/v2${suffix}`)
      await expect(pinned(`https://gateway.example/v1${suffix}`)).rejects.toThrow()
      expect(await providersTest(f.deps, 'gateway')).toBe(0)
    },
  )

  it('F8 refuses rebinding between OpenRouter key check and models request', async () => {
    const f = withKey()
    let isRebound = false
    const deps = {
      ...f.deps,
      resolveHost: () => Promise.resolve([isRebound ? '10.1.2.3' : '93.184.216.34']),
      fetch: (url: RequestInfo | URL, init?: RequestInit) => {
        isRebound = true
        return f.deps.fetch(url, init)
      },
    }
    expect(await providersTest(deps, 'openrouter')).toBe(1)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.url).toBe('https://openrouter.ai/api/v1/key')
  })

  it('F9 localizes probe failures and uses singular and plural model forms', async () => {
    const table: unknown = JSON.parse(await readFile('l10n/ui.de.json', 'utf8'))
    expect(tableProblems(EN, table, { locale: 'de', isStrict: false })).toEqual([])
    // The checked fixture is merged through the same table installer as the host.
    setUiText({ ...EN, ...tableObject(table) }, 'de')
    const f = withKey()
    expect(
      await providersTest(
        { ...f.deps, fetch: () => Promise.reject(new Error('offline')) },
        'openrouter',
      ),
    ).toBe(1)
    expect(f.errors.join(' ')).not.toContain('unreachable')
    expect(f.errors.join(' ')).toContain('erreich')
    expect(await providersTest(f.deps, 'openrouter')).toBe(0)
    expect(f.printed.at(-1)).toContain('1 Modell.')
    setUiText(EN, BASE_LOCALE)
    expect(await providersTest(f.deps, 'openrouter')).toBe(0)
    expect(f.printed.at(-1)).toBe('Key works · 1 model.')
  })
})

function tableObject(table: unknown): object {
  if (typeof table !== 'object' || table === null) throw new Error('not a table')
  return table
}

function togetherSample(capture: unknown): unknown {
  if (typeof capture !== 'object' || capture === null || !('response' in capture))
    throw new Error('no response')
  const response = capture.response
  if (typeof response !== 'object' || response === null || !('bodySummary' in response))
    throw new Error('no summary')
  const summary = response.bodySummary
  if (typeof summary !== 'object' || summary === null || !('sample' in summary))
    throw new Error('no sample')
  return summary.sample
}
