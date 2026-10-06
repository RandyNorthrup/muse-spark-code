// M95 lane X (PLAN.md D74): assembling a provider run, the runExec seam,
// the ACP agent's BYO model options and the backend readiness. The turn
// itself is lane T/I's seam; these tests prove everything up to it.

import * as acp from '@agentclientprotocol/sdk'
import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import type { ModelSummary } from '../../src/core/agent/agentBackend'
import { emptyProvidersFile, type ProvidersFile } from '../../src/core/providers/providersFile'
import { CREDENTIAL_RECORD_VERSION, EXEC_EXIT, UI_TEXT } from '../../src/shared/constants'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import {
  execEventSchema,
  type ExecEvent,
  validateResult,
} from '../../src/runtime/exec/execProtocol'
import { memorySecretStoreFor, readProviderKeyLine } from '../../src/runtime/exec/keyInput'
import {
  assembleProviderRun,
  type ProviderRunInput,
  type ResolvedProvider,
} from '../../src/runtime/exec/providerExec'
import { runExec, type ExecDeps } from '../../src/runtime/exec/runExec'
import { formatStoredProviderSecret, providerSecretAccount } from '../../src/runtime/keyStore'
import { probeProvider, providersFilePath } from '../../src/runtime/providersCommands'
import { resolveProvider } from '../../src/runtime/exec/providerExec'
import { presetById } from '../../src/core/providers/presets'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { outputWriter } from './helpers/execContract'
import { memorySecrets } from './helpers/fakes'

const OPENROUTER_KEY = 'sk-or-test-key-00000000000001'
const CWD = process.platform === 'win32' ? String.raw`C:\work\app` : '/work/app'

/** A fetch scripted by URL, with no casts. */
function scriptedFetch(handler: (url: string) => Response): typeof fetch {
  return (url) => Promise.resolve(handler(urlText(url)))
}

/** A fetch input as text, without stringifying objects. */
function urlText(url: RequestInfo | URL): string {
  if (typeof url === 'string') {
    return url
  }
  return url instanceof URL ? url.href : url.url
}

function openRouterFile(): ProvidersFile {
  return {
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
}

function storedSecrets(origin: string, key: string) {
  const store = memorySecrets()
  store.values.set(
    'museSpark.provider.openrouter',
    formatStoredProviderSecret({ v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin }, key),
  )
  return store
}

function assemblyInput(over: Partial<ProviderRunInput> = {}): ProviderRunInput {
  const file = openRouterFile()
  return {
    filePath: '/user/providers.json',
    readFile: () => Promise.resolve(JSON.stringify(file)),
    secrets: storedSecrets('https://openrouter.ai', OPENROUTER_KEY),
    resolveHost: () => Promise.resolve(['93.184.216.34']),
    readKey: () => Promise.resolve({ ok: true as const, key: OPENROUTER_KEY }),
    providerId: 'openrouter',
    model: 'openrouter/m1',
    keyFromStdin: false,
    baseFetch: scriptedFetch(() => new Response('ok')),
    ...over,
  }
}

describe('assembleProviderRun', () => {
  it('assembles a bound run with a pinned fetch and memory secrets', async () => {
    const assembled = await assembleProviderRun(assemblyInput())
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.run.modelRef).toBe('openrouter/m1')
    expect(assembled.run.provider.origin).toBe('https://openrouter.ai')
    expect(assembled.run.literals).toEqual([OPENROUTER_KEY])
    const account = providerSecretAccount('openrouter') ?? ''
    const envelope = await assembled.run.secrets.get(account)
    expect(envelope).toContain('https://openrouter.ai')
    // The pinned fetch passes the codec path and refuses the rest.
    await assembled.run.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })
    await expect(assembled.run.fetch('https://openrouter.ai/admin')).rejects.toThrow()
    assembled.run.memory?.clear()
    expect(await assembled.run.secrets.get(account)).toBe(undefined)
  })

  it('falls back to the default model only when it names the provider', async () => {
    const fallback = await assembleProviderRun(assemblyInput({ model: undefined }))
    expect(fallback.ok).toBe(true)
    if (!fallback.ok) throw new Error('not assembled')
    expect(fallback.run.modelRef).toBe('openrouter/m1')

    const other = await assembleProviderRun(
      assemblyInput({
        model: undefined,
        readFile: () =>
          Promise.resolve(JSON.stringify({ ...openRouterFile(), defaultModel: 'groq/m9' })),
      }),
    )
    expect(other.ok).toBe(false)
    if (other.ok) throw new Error('should fail')
    expect(other.failure).toMatchObject({ kind: 'usage', reason: UI_TEXT.execUnknownModel })

    const wrong = await assembleProviderRun(assemblyInput({ model: 'groq/m9' }))
    expect(wrong.ok).toBe(false)
  })

  it('needs --model when no default names the provider', async () => {
    const needed = await assembleProviderRun(
      assemblyInput({
        model: undefined,
        readFile: () =>
          Promise.resolve(JSON.stringify({ ...openRouterFile(), defaultModel: undefined })),
      }),
    )
    expect(needed.ok).toBe(false)
    if (needed.ok) throw new Error('should fail')
    expect(needed.failure).toMatchObject({
      kind: 'usage',
      reason: UI_TEXT.execProviderModelRequired,
    })
  })

  it('reads the key from stdin for CI, and needs one otherwise', async () => {
    const viaStdin = await assembleProviderRun(
      assemblyInput({ keyFromStdin: true, secrets: memorySecrets() }),
    )
    expect(viaStdin.ok).toBe(true)

    const missing = await assembleProviderRun(
      assemblyInput({ secrets: memorySecrets(), keyFromStdin: false }),
    )
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('should fail')
    expect(missing.failure.kind).toBe('auth')
  })

  it('maps a missing or broken user file to usage failures', async () => {
    const missing = await assembleProviderRun(
      assemblyInput({
        readFile: () => Promise.reject(Object.assign(new Error('no'), { code: 'ENOENT' })),
      }),
    )
    expect(missing).toMatchObject({ ok: false })
    const broken = await assembleProviderRun(
      assemblyInput({ readFile: () => Promise.resolve('{{{') }),
    )
    expect(broken.ok).toBe(false)
    if (broken.ok) throw new Error('should fail')
    expect(broken.failure.kind).toBe('usage')
  })

  it('refuses a rebinding found between resolving and running', async () => {
    let calls = 0
    const rebound = await assembleProviderRun(
      assemblyInput({
        resolveHost: () => Promise.resolve([calls++ === 0 ? '93.184.216.34' : '10.0.0.9']),
      }),
    )
    expect(rebound.ok).toBe(false)
    if (rebound.ok) throw new Error('should fail')
    expect(rebound.failure.reason).toContain(UI_TEXT.providerProbeRebinding)
  })

  it('F8 rechecks every assembled fetch after successful setup', async () => {
    let answers = ['93.184.216.34']
    const sent = vi.fn(() => Promise.resolve(new Response('ok')))
    const assembled = await assembleProviderRun(
      assemblyInput({
        resolveHost: () => Promise.resolve(answers),
        baseFetch: sent,
      }),
    )
    if (!assembled.ok) throw new Error('not assembled')
    try {
      await assembled.run.fetch('https://openrouter.ai/api/v1/chat/completions')
      answers = ['10.1.2.3']
      await expect(
        assembled.run.fetch('https://openrouter.ai/api/v1/chat/completions'),
      ).rejects.toThrow('rebinding')
      expect(sent).toHaveBeenCalledTimes(1)
    } finally {
      assembled.run.memory?.clear()
    }
  })
})

/** A public answer for the fixed cloud origins. */
function publicDNS(): Promise<readonly string[]> {
  return Promise.resolve(['93.184.216.34'])
}

/** The test's openRouter entry, resolved against a public answer. */
async function openRouterProvider() {
  const resolved = await resolveProvider(openRouterFile(), 'openrouter', presetById, publicDNS)
  if (!resolved.ok) throw new Error('unresolved')
  return resolved.provider
}

describe('probeProvider', () => {
  it('leaves paid-token presets to the panel and needs the key', async () => {
    const preset = presetById('azure')
    if (preset === undefined) throw new Error('no azure preset')
    // Azure has no captured request path yet, so it never resolves for a
    // run; the probe still refuses its paid test without sending anything.
    const azureProvider: ResolvedProvider = {
      entry: {
        id: 'azure',
        preset: 'azure',
        address: 'https://res.openai.azure.com/openai/v1',
        auth: 'apiKey',
        models: ['dep'],
      },
      preset,
      origin: 'https://res.openai.azure.com/openai/v1',
      network: 'public',
      request: undefined,
    }
    expect(
      await probeProvider(
        scriptedFetch(() => new Response('x')),
        azureProvider,
        'k',
        publicDNS,
      ),
    ).toMatchObject({
      ok: false,
      paid: true,
    })
    const keyless = await openRouterProvider()
    expect(
      await probeProvider(
        scriptedFetch(() => new Response('x')),
        keyless,
        undefined,
        publicDNS,
      ),
    ).toMatchObject({ ok: false, reason: 'no-key' })
  })

  it('counts OpenAI-shape lists and reports HTTP answers', async () => {
    const listed = await openRouterProvider()
    const fetch = scriptedFetch((target) =>
      target.endsWith('/api/v1/models')
        ? Response.json({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
        : Response.json({}),
    )
    expect(await probeProvider(fetch, listed, OPENROUTER_KEY, publicDNS)).toMatchObject({
      ok: true,
      modelCount: 3,
    })
    const denied = scriptedFetch(() => new Response('no', { status: 403 }))
    expect(await probeProvider(denied, listed, OPENROUTER_KEY, publicDNS)).toMatchObject({
      ok: false,
      reason: 'HTTP 403',
    })
    const garbage = scriptedFetch(() => Response.json({ nope: [] }))
    expect(await probeProvider(garbage, listed, OPENROUTER_KEY, publicDNS)).toMatchObject({
      ok: false,
      reason: 'unparseable',
    })
  })
})

describe('readProviderKeyLine and memorySecretStoreFor', () => {
  const shape = { kind: 'prefix', prefix: 'sk-or-', minLength: 20 } as const

  it('checks the preset shape and refuses anything else', async () => {
    const signal = new AbortController().signal
    expect(
      await readProviderKeyLine(Readable.from([`${OPENROUTER_KEY}\n`]), signal, shape),
    ).toEqual({ ok: true, key: OPENROUTER_KEY })
    expect(await readProviderKeyLine(Readable.from(['nope\n']), signal, shape)).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    expect(await readProviderKeyLine(Readable.from(['\n']), signal, shape)).toMatchObject({
      ok: false,
      reason: 'empty',
    })
  })

  it('holds exactly the given accounts', async () => {
    const store = memorySecretStoreFor({ 'museSpark.provider.openrouter': 'envelope' })
    expect(await store.get('museSpark.provider.openrouter')).toBe('envelope')
    expect(await store.get('museSpark.modelApiKey')).toBe(undefined)
    store.clear()
    expect(await store.get('museSpark.provider.openrouter')).toBe(undefined)
  })
})

const RUN_FOLDER = process.platform === 'win32' ? String.raw`C:\work\run` : '/work/run'

function ollamaFile(): ProvidersFile {
  return {
    ...emptyProvidersFile(),
    providers: [
      {
        id: 'ollama',
        preset: 'ollama',
        address: 'http://127.0.0.1:11434',
        auth: 'none',
        models: ['qwen3:8b'],
      },
    ],
  }
}

function testClock(): number {
  return Date.now()
}

function noSignalCleanup(): void {
  // Nothing to clean up: exec tests never signal.
}

function ignoreSignals(): () => void {
  return noSignalCleanup
}

function depsFor(changes: Partial<ExecDeps> = {}): {
  readonly deps: ExecDeps
  readonly out: ReturnType<typeof outputWriter>
} {
  const parsed = parseCommandLine([
    'exec',
    '--backend',
    'modelApi',
    '--max-budget-usd',
    '1',
    '--provider',
    'ollama',
    '--model',
    'ollama/qwen3:8b',
    '--output',
    'jsonl',
    'task',
  ])
  if (parsed.command !== 'exec') throw new Error(JSON.stringify(parsed))
  const out = outputWriter()
  const err = outputWriter()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: ExecDeps = {
    options: parsed.options,
    version: 'test',
    distDir: RUN_FOLDER,
    platform: process.platform,
    env: {},
    homeDir: RUN_FOLDER,
    processCwd: RUN_FOLDER,
    stdin: new PassThrough(),
    stdout: out,
    stderr: err,
    storeSecrets: memorySecrets(),
    runGit: () => Promise.resolve(''),
    fetch: scriptedFetch(() => new Response('ok')),
    sleep: () => Promise.resolve(),
    now: testClock,
    readFile: (file) =>
      Promise.resolve(
        Buffer.from(file.endsWith('providers.json') ? JSON.stringify(ollamaFile()) : ''),
      ),
    randomHex: () => '1',
    log,
    ...changes,
  }
  return { deps, out }
}

/** The runner's view of the pin: the codec path passes, anything else throws. */
async function pinCheck(fetch: typeof globalThis.fetch): Promise<number> {
  await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: '{}' })
  try {
    await fetch('http://127.0.0.1:11434/admin')
  } catch {
    return 0
  }
  return -1
}

function testLifecycle() {
  return createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 30_000,
    now: testClock,
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: ignoreSignals,
    forceFinish: vi.fn(),
    exit: (): never => {
      throw new Error('exit')
    },
  })
}

describe('runExec --provider seam', () => {
  it('refuses a provider turn in an unavailable workspace', async () => {
    const { deps, out } = depsFor()
    const life = testLifecycle()
    try {
      const code = await runExec(life, deps)
      expect(code).toBe(EXEC_EXIT.auth)
      const events = out.chunks
        .join('')
        .trim()
        .split('\n')
        .map((line): ExecEvent => execEventSchema.parse(JSON.parse(line)))
      const record = events.find((event) => event.type === 'result')
      const result = record?.type === 'result' ? validateResult(record.result) : undefined
      expect(result?.status).toBe('backend_unavailable')
      expect(result?.error?.message ?? '').toContain('ENOENT')
    } finally {
      life.dispose()
    }
  })

  it('hands an injected runner the pinned fetch and the qualified ref', async () => {
    const seen: { readonly modelRef: string; readonly origin: string }[] = []
    const { deps } = depsFor({
      // The runner inherits the pin: the codec path passes, anything else throws.
      runProvider: (request) => {
        seen.push({ modelRef: request.run.modelRef, origin: request.run.provider.origin })
        return pinCheck(request.run.fetch)
      },
    })
    const life = testLifecycle()
    try {
      expect(await runExec(life, deps)).toBe(0)
      expect(seen).toEqual([
        {
          modelRef: 'ollama/qwen3:8b',
          origin: 'http://127.0.0.1:11434',
        },
      ])
    } finally {
      life.dispose()
    }
  })
})

/** An agent serving the given host's models (lane I wires the real host). */
function agentFor(host: FakeAgentHost) {
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const agent = createAcpAgent({
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' as const }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'model-api-key',
      name: 'key',
      description: 'key',
      args: ['auth', 'set'],
      command: 'agent auth set',
    },
    defaultCwd: CWD,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
  })
  const client = acp.client({ name: 'test-client' })
  return { agent, client }
}

describe('ACP agent BYO model options', () => {
  const BYO_MODELS: readonly ModelSummary[] = [
    {
      modelId: 'muse-spark-1.3',
      displayLabel: 'Muse Spark 1.3',
      contextLimit: 1_000_000,
      isDefault: true,
      isActive: true,
    },
    {
      modelId: 'openrouter/deepseek/deepseek-v4-pro',
      displayLabel: 'DeepSeek V4 Pro (OpenRouter)',
      contextLimit: 128_000,
      isDefault: false,
      isActive: false,
    },
    {
      modelId: 'ollama/qwen3:8b',
      displayLabel: 'Qwen3 8B (Ollama)',
      contextLimit: 32_768,
      isDefault: false,
      isActive: false,
    },
  ]

  it('lists BYO refs beside Meta models and selects one', async () => {
    const host = new FakeAgentHost([...BYO_MODELS])
    const { agent, client } = agentFor(host)
    await client.connectWith(agent, async (connection) => {
      const created = await connection.request('session/new', { cwd: CWD, mcpServers: [] })
      const modelOption = created.configOptions?.find((option) => option.id === 'model')
      expect(modelOption?.type).toBe('select')
      if (modelOption?.type !== 'select') throw new Error('no model option')
      const values = modelOption.options.map((option) =>
        'value' in option ? option.value : undefined,
      )
      expect(values).toEqual([
        'muse-spark-1.3',
        'openrouter/deepseek/deepseek-v4-pro',
        'ollama/qwen3:8b',
      ])
      // OpenRouter's author/slug survives the round trip untouched.
      await connection.request('session/set_config_option', {
        sessionId: created.sessionId,
        configId: 'model',
        value: 'openrouter/deepseek/deepseek-v4-pro',
      })
      const session = host.sessions.at(-1)
      expect(session?.setModel).toHaveBeenCalledWith('openrouter/deepseek/deepseek-v4-pro')
    })
  })
})

/** Backend deps over a home dir, for the readiness checks. */
function backendDeps(homeDir: string, secrets: ReturnType<typeof memorySecrets>) {
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    options: {
      backend: 'modelApi' as const,
      trustWorkspace: false,
      museBinary: '',
      shellSandbox: 'off' as const,
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures: [],
      isVerbose: false,
    },
    version: 'test',
    distDir: homeDir,
    platform: process.platform,
    env: {},
    homeDir,
    secrets,
    runGit: () => Promise.resolve(''),
    fetch: globalThis.fetch,
    sleep: () => Promise.resolve(),
    log,
  }
}

describe('modelApiReadiness with providers', () => {
  it('is ready for a stored provider key or a keyless local server', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
    const { default: path } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const home = await mkdtemp(path.join(tmpdir(), 'm95x-ready-'))
    const file: ProvidersFile = {
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
    const dir = path.join(home, '.config', 'muse-spark-code')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'providers.json'), JSON.stringify(file))
    const runtime = createRuntimeBackend(backendDeps(home, memorySecrets()))
    expect(await runtime.backend.readiness(false)).toEqual({ state: 'ready' })
    await runtime.close()
  })

  it('stays signed out with no Meta key and no provider', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { default: path } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const home = await mkdtemp(path.join(tmpdir(), 'm95x-empty-'))
    const runtime = createRuntimeBackend(backendDeps(home, memorySecrets()))
    expect(await runtime.backend.readiness(false)).toMatchObject({ state: 'signedOut' })
    await runtime.close()
  })
})

describe('providersFilePath', () => {
  it('lives beside, never inside, Muse Code config and never near the repo', () => {
    const home = process.platform === 'win32' ? String.raw`C:\Users\Runner` : '/home/runner'
    const filePath = providersFilePath({
      platform: process.platform,
      homeDir: home,
      xdgConfigHome: undefined,
    })
    const segments = filePath.split(/[/\\]/)
    // Beside Muse Code's `<config home>/muse/`: our own folder, our own file.
    expect(segments).toContain('muse-spark-code')
    expect(segments).not.toContain('muse')
    expect(segments.at(-1)).toBe('providers.json')
    // No working directory goes in: the runner's user file only.
    expect(filePath).not.toContain('repo-cwd')
    expect(
      providersFilePath({ platform: process.platform, homeDir: home, xdgConfigHome: '/xdg' }),
    ).toContain('xdg')
  })
})
