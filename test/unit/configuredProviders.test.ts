import { Usd } from '../../src/shared/usd'
// Offline composition over the owner's 2026-10-04 Mistral captures.
// Tool name/arguments alone are adapted to the real harness read_file tool.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type Server, type ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import * as vscode from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConfiguredProviderServices,
  type ConfiguredProviderOptions,
} from '../../src/core/providers/configured'
import * as configuredEntry from '../../src/host/backend/configuredProvidersEntry'
import { createSubscriptionFeatures } from '../../src/host/providers/subscriptionFeatures'
import { runtimeSubscriptionClient } from '../../src/runtime/chatGptProviderCommands'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import {
  providerEntrySchema,
  writeProvidersFileAtomic,
  type ProviderEntry,
} from '../../src/core/providers/providersFile'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { effortForPolicy } from '../../src/core/backends/modelapi/modelPolicy'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import * as responsesCodec from '../../src/core/backends/modelapi/codecs/responses'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import {
  MODEL_API_REQUEST_TIMEOUT_MS,
  PROVIDER_SECRET_PREFIX,
  SUBSCRIPTION_STREAM_MAX_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const ENTRY = providerEntrySchema.parse({
  id: 'mistral-plan',
  preset: 'mistral-plan',
  address: 'https://api.mistral.ai',
  format: 'chat',
  auth: 'apiKey',
  models: ['ministral-3b-latest'],
})
const REF = 'mistral-plan/ministral-3b-latest'
/** A user's own local provider at the test listener's loopback address, with no credential. */
function localEntry(server: Server) {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test listener')
  return providerEntrySchema.parse({
    ...ENTRY,
    id: 'local',
    preset: 'custom',
    auth: 'none',
    address: `http://127.0.0.1:${String(address.port)}`,
    modelLimits: { 'ministral-3b-latest': { contextTokens: 128_000, outputTokens: 128_000 } },
  })
}
const capture = async (file: string) =>
  JSON.parse(
    await readFile(path.join('docs/certification/m95-captures/mistral', file), 'utf8'),
  ) as unknown
async function stream(file: string, isAdapted = false) {
  const parsed = z
    .object({ response: z.object({ events: z.array(z.object({ data: z.json() })) }) })
    .parse(await capture(file))
  const text = parsed.response.events
    .map((event) => {
      let data = JSON.stringify(event.data)
      if (isAdapted)
        data = data
          .replaceAll('get_time', 'read_file')
          .replaceAll('timezone', 'path')
          .replaceAll('UTC', 'example.txt')
      return `data: ${data}\n\n`
    })
    .join('')
  return Buffer.from(`${text}data: [DONE]\n\n`)
}
async function deepseekStream() {
  const parsed = z
    .object({ response: z.object({ events: z.array(z.object({ data: z.json() })) }) })
    .parse(
      JSON.parse(
        await readFile(
          path.join('docs/certification/m95-captures/deepseek', '04-tool-result-stream.json'),
          'utf8',
        ),
      ),
    )
  const text = parsed.response.events
    .map((event) => `data: ${JSON.stringify(event.data)}\n\n`)
    .join('')
  return Buffer.from(`${text}data: [DONE]\n\n`)
}
function expectDisabledSwitch(wire: Record<string, unknown>) {
  expect(wire).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' } })
  expect(wire).not.toHaveProperty('reasoning_effort')
}
const response = (bytes: Uint8Array, status = 200) => ({
  status,
  headers: {},
  body: (async function* () {
    yield* await Promise.resolve([bytes])
  })(),
  close: vi.fn(),
})
async function anthropicStream() {
  const parsed = z
    .object({
      response: z.object({ events: z.array(z.object({ event: z.string(), data: z.json() })) }),
    })
    .parse(
      JSON.parse(
        await readFile(
          path.join('docs/certification/m95-captures/anthropic', '04-tool-result-stream.json'),
          'utf8',
        ),
      ),
    )
  return Buffer.from(
    parsed.response.events
      .map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
      .join(''),
  )
}

async function providerFixture(entry: ProviderEntry, payload: () => Promise<Buffer>) {
  const f = await fixture()
  await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
  await f.secrets.store(
    `${PROVIDER_SECRET_PREFIX}${entry.id}`,
    formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: new URL(entry.address ?? '').origin },
      'test-owned-key',
    ),
  )
  const sent: Record<string, unknown>[] = []
  const send: NonNullable<ConfiguredProviderOptions['send']> = async (_target, bytes) => {
    if (bytes !== undefined) sent.push(JSON.parse(bytes) as Record<string, unknown>)
    return response(await payload())
  }
  const services = createConfiguredProviderServices(undefined, {
    ...f,
    resolve: () => Promise.resolve(['8.8.8.8']),
    send,
  })
  return { services, sent }
}
/** One real ModelApiHost turn at `effort` over the configured client. */
async function hostTurn(
  services: ReturnType<typeof createConfiguredProviderServices>,
  ref: string,
  effort: string,
) {
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: services.client,
      io: memoryToolIo({}, '/workspace'),
      log: new FakeLogOutputChannel(),
      workspaceRoot: '/workspace',
    }),
    models: services.client.models,
  })
  try {
    const session = await host.startSession({
      modelId: ref,
      approvalMode: 'allowAll',
      workspaceRoot: '/workspace',
    })
    await session.setReasoningEffort(effort)
    const watch = watchSessionTurns(session)
    const done = watch.turnDone()
    await session.sendTurn([{ type: 'text', text: 'Hi.' }])
    await done
    return watch.events
  } finally {
    await host.close()
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'm95-configured-'))
  roots.push(root)
  const secrets = memorySecrets()
  const { values } = secrets
  await secrets.store(
    `${PROVIDER_SECRET_PREFIX}${ENTRY.id}`,
    formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: new URL(ENTRY.address ?? '').origin },
      'test-owned-key',
    ),
  )
  const configFile = path.join(root, 'providers.json')
  const written = await writeProvidersFileAtomic(configFile, {
    v: 1,
    providers: [ENTRY],
    defaultModel: REF,
  })
  expect(written.ok).toBe(true)
  return {
    root,
    secrets,
    values,
    configFile,
    catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
  }
}
const body = (): CreateResponseBody => ({
  model: REF,
  instructions: 'Test',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Read example.txt.' }],
    },
  ],
  tools: [],
  tool_choice: 'auto',
  stream: true,
  store: false,
  max_output_tokens: 64,
  reasoning: { effort: 'none' },
  include: [],
  prompt_cache_key: 'test-prefix',
  prompt_cache_retention: '24h',
})
async function consume(events: AsyncIterable<unknown>) {
  const result = await Array.fromAsync(events)
  return result
}

describe('configured provider production transport', () => {
  it.each(['error', 'response.failed'])(
    'scrubs a canonical %s diagnostic before it can reach host events',
    async (type) => {
      const f = await fixture()
      const entry = providerEntrySchema.parse({
        ...ENTRY,
        id: 'openai',
        preset: 'openai',
        address: 'https://api.openai.com',
        format: 'responses',
        models: ['gpt-5.6-luna'],
      })
      const written = await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
      expect(written.ok).toBe(true)
      f.values.set(
        `${PROVIDER_SECRET_PREFIX}${entry.id}`,
        JSON.stringify({ v: 1, auth: 'apiKey', origin: entry.address, secret: 'test-owned-key' }),
      )
      // This is the internal canonical codec boundary, not a claimed native wire capture.
      const event: StreamEvent =
        type === 'error'
          ? { type: 'error', message: 'test-owned-key echoed' }
          : {
              type: 'response.failed',
              response: {
                id: 'canonical-failure',
                status: 'failed',
                output: [],
                error: { message: 'test-owned-key echoed' },
              },
            }
      const codec = responsesCodec.createResponsesCodec({
        sendPromptCacheRetention: false,
        sendPromptCacheKey: false,
      })
      vi.spyOn(responsesCodec, 'createResponsesCodec').mockReturnValue({
        ...codec,
        decodeStream: async function* () {
          yield* await Promise.resolve([event])
        },
      })
      const services = createConfiguredProviderServices(undefined, {
        ...f,
        resolve: () => Promise.resolve(['8.8.8.8']),
        send: () => Promise.resolve(response(Buffer.from(''))),
      })
      const model = await services.registry.resolve('openai/gpt-5.6-luna')
      await expect(
        consume(
          model.client.streamResponse(
            { ...body(), model: model.ref },
            new AbortController().signal,
          ),
        ),
      ).rejects.toThrow(UI_TEXT.modelsPanelUnavailable)
    },
  )
  it.each([
    ['openai', 'responses', '02-tool-call-stream.json', 'gpt-5.6-luna'],
    ['anthropic', 'anthropic', '03-tool-call-stream.json', 'claude-haiku-4-5-20251001'],
    ['gemini', 'gemini', '02-tool-call-stream.json', 'gemini-3.5-flash-lite'],
    ['ollama', 'ollama', '04-two-tool-stream.json', 'qwen3:4b-instruct-2507-q4_K_M'],
    ['openrouter', 'chat', '04-tool-call-stream.json', 'openai/gpt-oss-20b'],
  ])(
    'dispatches the captured %s format with native auth and model identity',
    async (preset, format, file, native) => {
      const f = await fixture()
      const receipt = z
        .object({
          request: z.object({ url: z.string() }),
          response: z.object({
            body: z.optional(z.string()),
            events: z.optional(
              z.array(z.object({ event: z.optional(z.string()), data: z.json() })),
            ),
          }),
        })
        .parse(
          JSON.parse(
            await readFile(path.join('docs/certification/m95-captures', preset, file), 'utf8'),
          ),
        )
      const bytes =
        receipt.response.body ??
        receipt.response.events
          ?.map(
            (event) =>
              `${event.event === undefined ? '' : `event: ${event.event}\n`}data: ${JSON.stringify(event.data)}\n\n`,
          )
          .join('')
      if (bytes === undefined) throw new Error('Missing captured response')
      const address = new URL(receipt.request.url).origin
      const entry = providerEntrySchema.parse({
        id: preset,
        preset,
        auth: preset === 'ollama' ? 'none' : 'apiKey',
        address,
        format,
        models: [native],
        numCtx: { [native]: 32_768 },
      })
      await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
      f.values.set(
        `${PROVIDER_SECRET_PREFIX}${preset}`,
        JSON.stringify({ v: 1, auth: 'apiKey', origin: address, secret: 'test-format-key' }),
      )
      const send = vi.fn<NonNullable<ConfiguredProviderOptions['send']>>(() =>
        Promise.resolve(response(Buffer.from(bytes))),
      )
      const services = createConfiguredProviderServices(undefined, {
        ...f,
        resolve: () => Promise.resolve(['8.8.8.8']),
        send,
      })
      const model = await services.registry.resolve(`${preset}/${native}`)
      const observe = vi.fn()
      const admit = Object.assign(() => undefined, { observe })
      const events = await consume(
        model.client.streamResponse(
          { ...body(), model: `${preset}/${native}` },
          new AbortController().signal,
          undefined,
          undefined,
          admit,
        ),
      )
      expect(events).toContainEqual(expect.objectContaining({ type: 'response.completed' }))
      expect(observe).toHaveBeenCalledWith({ headers: {} })
      const sent = send.mock.calls[0]
      expect(sent?.[0].url.href).toBe(receipt.request.url)
      const headers = sent?.[2]
      if (preset === 'openrouter') {
        expect(headers).toMatchObject({
          'HTTP-Referer': 'https://github.com/RandyNorthrup/muse-spark-code',
          'X-OpenRouter-Title': 'Muse Spark Code (Unofficial)',
          'X-OpenRouter-Categories': 'ide-extension',
        })
        expect(JSON.parse(sent?.[1] ?? '')).toMatchObject({ provider: { zdr: true } })
      }
      switch (preset) {
        case 'anthropic': {
          expect(headers).toMatchObject({
            authorization: 'Bearer test-format-key',
            'anthropic-version': '2023-06-01',
          })
          break
        }
        case 'gemini': {
          expect(headers).toMatchObject({ 'x-goog-api-key': 'test-format-key' })
          break
        }
        case 'ollama': {
          expect(headers).not.toHaveProperty('authorization')
          break
        }
        default: {
          expect(headers).toMatchObject({ authorization: 'Bearer test-format-key' })
        }
      }
    },
  )

  it('preserves bare Meta resolution with configured plan-key providers present', async () => {
    const f = await fixture()
    const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
    const services = createConfiguredProviderServices(meta, f)
    const resolved = await services.client.models?.resolve('muse-spark-1.3')
    expect(resolved?.ref).toBe('muse-spark-1.3')
    expect(resolved?.client).toBe(meta)
    expect(resolved?.policy.identity.provider).toBe('meta')
    const plan = await services.registry.resolve(REF)
    expect(plan.price.reserve({ inputTokens: 100, outputTokens: 100 })).toBe(Usd.from(0).toAmount())
    expect(plan.price.settle({ inputTokens: 100, outputTokens: 100 })).toBe(Usd.from(0).toAmount())
    const description = 'A detailed test tool description. '.repeat(4096)
    const count = await plan.client.countInputTokens({
      ...body(),
      tools: [{ type: 'function', name: 'test_tool', description, parameters: {}, strict: false }],
    })
    expect(count).toBeGreaterThanOrEqual(Buffer.byteLength(description))
  })

  it.each(['VS Code', 'ACP'])(
    'runs a captured plan-key tool turn through %s composition',
    async (platform) => {
      const f = await fixture()
      const payloads = [
        await stream('02-tool-call-stream.json', true),
        await stream('03-tool-result-stream.json'),
      ]
      const sent: { target: string; headers: Readonly<Record<string, string>>; body: unknown }[] =
        []
      const send: NonNullable<ConfiguredProviderOptions['send']> = (target, bytes, headers) => {
        sent.push({
          target: target.url.href,
          headers,
          body: bytes === undefined ? undefined : (JSON.parse(bytes) as unknown),
        })
        return Promise.resolve(response(payloads[sent.length - 1] ?? Buffer.from('')))
      }
      const realFactory = createConfiguredProviderServices
      vi.spyOn(configuredEntry, 'createConfiguredProviderServices').mockImplementation(
        (meta, options) =>
          realFactory(meta, { ...options, resolve: () => Promise.resolve(['8.8.8.8']), send }),
      )
      const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
      const state = new Map<string, unknown>()
      const features = createSubscriptionFeatures({
        ...f,
        log: new FakeLogOutputChannel(),
        globalStorageUri: vscode.Uri.file(f.root),
        l10n: { table: EN, locale: 'en' },
        globalState: {
          get: (key) => state.get(key),
          update: (key, value) => {
            state.set(key, value)
            return Promise.resolve()
          },
        },
        isRemote: false,
        isConfidential: () => false,
        access: { canSendRequest: () => true, onDidChange: () => ({ dispose: vi.fn() }) },
        connected: () => Promise.resolve(),
        disconnected: () => Promise.resolve(),
      })
      const runtime = runtimeSubscriptionClient({
        ...f,
        fetch: vi.fn(),
        openBrowser: () => Promise.resolve(),
        callbackText: () => '',
      })
      const factory = platform === 'VS Code' ? features : runtime
      expect(features.seam.catalog.get('mistral-plan')).toMatchObject({
        auth: 'apiKey',
        kind: 'subscription',
        origin: ENTRY.address,
      })
      const client = await factory.createClient(meta)
      const log = new FakeLogOutputChannel()
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({
          client,
          io: memoryToolIo({ 'example.txt': 'An example.' }, '/workspace'),
          log,
          workspaceRoot: '/workspace',
        }),
        models: client.models,
        getAccountId: factory.accountId,
        sessionBudgetUsd: () => Usd.from(0.000001).toAmount(),
      })
      try {
        const models = await host.listModels()
        expect(models).toEqual([
          expect.objectContaining({
            modelId: REF,
            pricing: 'plan',
            planLimitsUrl: expect.stringContaining('subscriptions'),
            contextLimit: 128_000,
          }),
        ])
        const session = await host.startSession({
          modelId: REF,
          approvalMode: 'allowAll',
          workspaceRoot: '/workspace',
        })
        const watch = watchSessionTurns(session)
        const done = watch.turnDone()
        await session.sendTurn([{ type: 'text', text: 'Read example.txt.' }])
        await done
        expect(watch.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'turnCompleted', terminal: 'completed' }),
            expect.objectContaining({
              type: 'itemCompleted',
              item: expect.objectContaining({ tool: 'read_file' }),
            }),
          ]),
        )
        expect(sent).toHaveLength(2)
        expect(sent[0]).toMatchObject({
          target: 'https://api.mistral.ai/v1/chat/completions',
          headers: { authorization: 'Bearer test-owned-key' },
          body: { model: 'ministral-3b-latest', stream: true },
        })
        expect(sent[1]?.body).toMatchObject({
          messages: expect.arrayContaining([expect.objectContaining({ role: 'tool' })]),
        })
        expect(host.readPlanUsage()).toMatchObject([
          { providerId: ENTRY.id, requests: 2, reported: { requests: 2 } },
        ])
        expect(JSON.stringify(watch.events)).not.toContain('test-owned-key')
        if (platform === 'VS Code')
          expect(state.get('subscriptionUsage')).toMatchObject([
            { providerId: ENTRY.id, requests: 2 },
          ])
      } finally {
        await host.close()
      }
    },
  )

  it('scans captured native capabilities and exposes the plan-key preset in the actual panel', async () => {
    const f = await fixture()
    const parsed = z
      .object({ response: z.object({ bodySummary: z.object({ sample: z.array(z.json()) }) }) })
      .parse(await capture('01-models-list.json'))
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['8.8.8.8']),
      send: () =>
        Promise.resolve(
          response(Buffer.from(JSON.stringify({ data: parsed.response.bodySummary.sample }))),
        ),
    })
    const rows = await services.scanRows(ENTRY, 'test-owned-key')
    expect(rows).toContainEqual(
      expect.objectContaining({
        toolCapable: true,
        priceFingerprint: 'plan',
        context: expect.any(Number),
      }),
    )
  })

  it('keeps normalized Gemini IDs when joining the captured model list to capabilities', async () => {
    const f = await fixture()
    const entry = providerEntrySchema.parse({
      id: 'gemini',
      preset: 'gemini',
      address: 'https://generativelanguage.googleapis.com',
      format: 'gemini',
      auth: 'apiKey',
      models: ['gemini-2.5-flash'],
    })
    const parsed = z
      .object({ response: z.object({ bodySummary: z.object({ sample: z.array(z.json()) }) }) })
      .parse(
        JSON.parse(
          await readFile('docs/certification/m95-captures/gemini/01-models-list.json', 'utf8'),
        ),
      )
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['8.8.8.8']),
      send: () =>
        Promise.resolve(
          response(Buffer.from(JSON.stringify({ models: parsed.response.bodySummary.sample }))),
        ),
    })
    const rows = await services.scanRows(entry, 'test-owned-key')
    expect(rows).toContainEqual(
      expect.objectContaining({
        id: 'gemini-2.5-flash',
        toolCapable: true,
        context: 1_048_576,
      }),
    )
    expect(rows.every((row) => !row.id.startsWith('models/'))).toBe(true)
  })

  it.each([
    'origin',
    'credential rotation',
    'config during DNS',
    'private DNS',
    'mixed DNS',
    'metadata',
    'redirect',
    'echoed error',
  ])('refuses %s at the dispatch boundary', async (condition) => {
    const f = await fixture()
    const send = vi.fn(() =>
      Promise.resolve(response(Buffer.from(''), condition === 'redirect' ? 307 : 200)),
    )
    const services = createConfiguredProviderServices(
      fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel()),
      {
        ...f,
        resolve: async () => {
          if (condition === 'config during DNS')
            await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [] })
          else if (condition === 'private DNS') return ['10.0.0.1']
          if (condition === 'mixed DNS') return ['8.8.8.8', '127.0.0.1']
          return [condition === 'metadata' ? '169.254.169.254' : '8.8.8.8']
        },
        send,
      },
    )
    const resolved = await services.registry.resolve(REF)
    const originalDigest = await resolved.client.currentKeyDigest()
    if (condition === 'origin' || condition === 'credential rotation')
      f.values.set(
        `${PROVIDER_SECRET_PREFIX}${ENTRY.id}`,
        JSON.stringify({
          v: 1,
          auth: 'apiKey',
          origin: condition === 'origin' ? 'https://other.example' : ENTRY.address,
          secret: condition === 'origin' ? 'test-owned-key' : 'rotated-test-key',
        }),
      )
    else if (condition === 'echoed error')
      send.mockImplementation(() => Promise.reject(new Error('test-owned-key echoed')))
    const confirmed = {
      modelId: REF,
      keyDigest: originalDigest,
      origin: ENTRY.address,
      isStillAllowed: () => true,
      onRequestStarted: vi.fn(),
    }
    await expect(
      consume(
        resolved.client.streamResponse(
          body(),
          new AbortController().signal,
          undefined,
          undefined,
          undefined,
          confirmed,
        ),
      ),
    ).rejects.toThrow(
      // RVCM1062H P3: a rotated key lapses the confirmation, so the run keeps
      // the helper's own guidance instead of the unavailable text.
      condition === 'credential rotation'
        ? UI_TEXT.scheduleConfirmationExpired
        : UI_TEXT.modelsPanelUnavailable,
    )
    expect(send).toHaveBeenCalledTimes(['redirect', 'echoed error'].includes(condition) ? 1 : 0)
    expect(services.client.readPlanUsage?.()).toHaveLength(
      ['redirect', 'echoed error'].includes(condition) ? 1 : 0,
    )
  })

  it('refuses a changed fixed preset origin during an unsaved free key test', async () => {
    const f = await fixture()
    const send = vi.fn(() => Promise.resolve(response(Buffer.from(''))))
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['8.8.8.8']),
      send,
    })
    await expect(
      services.scan({ ...ENTRY, address: 'https://example.com' }, 'test-owned-key'),
    ).rejects.toThrow(UI_TEXT.modelsPanelUnavailable)
    expect(send).not.toHaveBeenCalled()
  })

  it('bounds stream bytes and scrubs errors from free native model scans', async () => {
    const f = await fixture()
    const send = vi.fn<NonNullable<ConfiguredProviderOptions['send']>>(() =>
      Promise.resolve(
        response(
          Buffer.from(`{"data":[{"id":"test-model"}]}${' '.repeat(SUBSCRIPTION_STREAM_MAX_BYTES)}`),
        ),
      ),
    )
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['8.8.8.8']),
      send,
    })
    await expect(services.scan(ENTRY)).rejects.toThrow(UI_TEXT.modelsPanelUnavailable)
    send.mockImplementation(() => Promise.reject(new Error('test-owned-key echoed')))
    await expect(services.scan(ENTRY)).rejects.toThrow(UI_TEXT.modelsPanelUnavailable)
  })

  it('invalidates an existing resolution after the same model is reconfigured', async () => {
    const f = await fixture()
    const services = createConfiguredProviderServices(undefined, f)
    const old = await services.registry.resolve(REF)
    await writeProvidersFileAtomic(f.configFile, {
      v: 1,
      providers: [{ ...ENTRY, models: [...ENTRY.models, 'other'] }],
    })
    await services.registry.list?.()
    expect(old.isCurrent()).toBe(false)
  })

  describe('reasoning resolver production path (lane DSTHINK3)', () => {
    const DEEPSEEK_ENTRY = providerEntrySchema.parse({
      id: 'deepseek',
      preset: 'deepseek',
      address: 'https://api.deepseek.com',
      format: 'chat',
      auth: 'apiKey',
      models: ['deepseek-flash'],
    })
    const DEEPSEEK_REF = 'deepseek/deepseek-flash'
    const HAIKU_ENTRY = providerEntrySchema.parse({
      id: 'anthropic',
      preset: 'anthropic',
      address: 'https://api.anthropic.com',
      format: 'anthropic',
      auth: 'apiKey',
      models: ['claude-haiku-4-5'],
      // RVDSTHINK2 finding 1: a valid output ceiling below Haiku's 1,024-token
      // minimum thinking budget.
      modelLimits: { 'claude-haiku-4-5': { contextTokens: 200_000, outputTokens: 512 } },
    })
    const HAIKU_REF = 'anthropic/claude-haiku-4-5'
    const THINKING_LOCKED = {
      'deepseek-flash': {
        reasoning: {
          effortLevels: { state: 'no' },
          canDisable: { state: 'no' },
          forced: { state: 'yes', value: true },
        },
      },
    } as const
    const TOGGLE_ONLY = {
      'deepseek-flash': {
        reasoning: {
          effortLevels: { state: 'no' },
          canDisable: { state: 'yes', value: true },
        },
      },
    } as const

    const deepseekFixture = (overrides?: unknown) =>
      providerFixture(
        overrides === undefined
          ? DEEPSEEK_ENTRY
          : providerEntrySchema.parse({ ...DEEPSEEK_ENTRY, modelCapabilities: overrides }),
        deepseekStream,
      )

    const completed = expect.objectContaining({ type: 'turnCompleted', terminal: 'completed' })

    it('sends every documented DeepSeek effort as named, never a neighbour', async () => {
      // Round 2: the preset's dated record carries the thinking-mode
      // page's full vocabulary (DS-XHIGH/DS-ULTRA show `xhigh` and
      // `ultra` taken as named), so the resolver never substitutes.
      const { services, sent } = await deepseekFixture()
      for (const effort of ['minimal', 'medium', 'xhigh', 'ultra'] as const) {
        expect(await hostTurn(services, DEEPSEEK_REF, effort)).toContainEqual(completed)
      }
      expect(sent).toHaveLength(4)
      expect(sent[0]).toMatchObject({ model: 'deepseek-flash', reasoning_effort: 'minimal' })
      expect(sent[1]).toMatchObject({ model: 'deepseek-flash', reasoning_effort: 'medium' })
      expect(sent[2]).toMatchObject({ model: 'deepseek-flash', reasoning_effort: 'xhigh' })
      expect(sent[3]).toMatchObject({ model: 'deepseek-flash', reasoning_effort: 'ultra' })
      for (const body of sent) expect(body).not.toHaveProperty('thinking')
    })

    it('sends Thinking off as the switch and a listed level as named', async () => {
      const { services, sent } = await deepseekFixture()
      expect(await hostTurn(services, DEEPSEEK_REF, 'none')).toContainEqual(completed)
      expectDisabledSwitch(sent[0] ?? {})
      expect(await hostTurn(services, DEEPSEEK_REF, 'max')).toContainEqual(completed)
      expect(sent[1]).toMatchObject({ reasoning_effort: 'max' })
      expect(sent[1]).not.toHaveProperty('thinking')
    })

    it('sends the switch for a toggle-only override and nothing for Thinking on', async () => {
      // RVDSTHINK finding 2: canDisable yes with effortLevels no.
      const { services, sent } = await deepseekFixture(TOGGLE_ONLY)
      expect(await hostTurn(services, DEEPSEEK_REF, 'none')).toContainEqual(completed)
      expectDisabledSwitch(sent[0] ?? {})
      expect(sent[0]).not.toHaveProperty('reasoning')
      expect(await hostTurn(services, DEEPSEEK_REF, 'high')).toContainEqual(completed)
      for (const field of ['thinking', 'reasoning_effort', 'reasoning'])
        expect(sent[1]).not.toHaveProperty(field)
    })

    it('refuses Thinking off on a model that forbids disabling, with no dispatch', async () => {
      // RVDSTHINK2 finding 2, through the host and the resolved client.
      const { services, sent } = await deepseekFixture(THINKING_LOCKED)
      const model = await services.registry.resolve(DEEPSEEK_REF)
      expect(model.policy.reasoning.canDisable.state).toBe('no')
      const events = await hostTurn(services, DEEPSEEK_REF, 'none')
      expect(sent).toHaveLength(0)
      expect(JSON.stringify(events)).toContain(
        `${UI_TEXT.chatCodecThinkingOffUnsupported} (unsupported_reasoning_effort)`,
      )
      expect(events).not.toContainEqual(completed)
      expect(await hostTurn(services, DEEPSEEK_REF, 'high')).toContainEqual(completed)
      expect(sent[0]).not.toHaveProperty('thinking')
    })

    it('keeps the typed refusal and its translated reason through the configured client', async () => {
      // RVDSTHINK finding 3: no generic unavailable error, no dispatch.
      const { services, sent } = await deepseekFixture(THINKING_LOCKED)
      const model = await services.registry.resolve(DEEPSEEK_REF)
      let failure: unknown
      try {
        await consume(
          model.client.streamResponse(
            { ...body(), model: DEEPSEEK_REF, reasoning: { effort: 'none' } },
            new AbortController().signal,
          ),
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).name).toBe('ChatCodecError')
      expect((failure as Error).message).toBe(
        `${UI_TEXT.chatCodecThinkingOffUnsupported} (unsupported_reasoning_effort)`,
      )
      expect(sent).toHaveLength(0)
    })

    it('sends ultra as named on DeepSeek instead of remapping (DS-G01)', async () => {
      // Round 2: DS-ULTRA answers 200 to `reasoning_effort: "ultra"`,
      // so the name rides as named, never as `max`.
      const { services, sent } = await deepseekFixture()
      const model = await services.registry.resolve(DEEPSEEK_REF)
      await consume(
        model.client.streamResponse(
          { ...body(), model: DEEPSEEK_REF, reasoning: { effort: 'ultra' } },
          new AbortController().signal,
        ),
      )
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ reasoning_effort: 'ultra' })
    })

    it('keeps a short Haiku reply at the default effort working as before', async () => {
      // RVDSTHINK2 finding 1: no thinking budget is added above the 512 cap.
      const { services, sent } = await providerFixture(HAIKU_ENTRY, anthropicStream)
      const model = await services.registry.resolve(HAIKU_REF)
      expect(effortForPolicy(model.policy, 'high')).toBe('none')
      expect(await hostTurn(services, HAIKU_REF, 'high')).toContainEqual(completed)
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 512 })
      expect(sent[0]).not.toHaveProperty('thinking')
    })
  })

  it('pins a loopback HTTP request with no proxy or credential and parses a real local stream', async () => {
    const f = await fixture()
    const payload = await stream('03-tool-result-stream.json')
    const received: string[] = []
    const server = createServer((request, res) => {
      received.push(request.url ?? '')
      expect(request.headers.authorization).toBeUndefined()
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(payload)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [localEntry(server)] })
      const services = createConfiguredProviderServices(undefined, f)
      const model = await services.registry.resolve('local/ministral-3b-latest')
      const events = await consume(
        model.client.streamResponse(
          { ...body(), model: 'local/ministral-3b-latest' },
          new AbortController().signal,
        ),
      )
      expect(events).toContainEqual(expect.objectContaining({ type: 'response.completed' }))
      expect(received).toEqual(['/v1/chat/completions'])
      expect(model.price.reserve({ inputTokens: 100, outputTokens: 100 })).toBe(
        Usd.from(0).toAmount(),
      )
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        }),
      )
    }
  })
})

describe('output cap minimum admission', () => {
  const withMinimum = {
    ...ENTRY,
    modelCapabilities: { 'ministral-3b-latest': { output: { minTokens: 16 } } },
  }
  it.each([0, 1, 15])(
    'rejects a provider capability cap of %s below its minimum when saved',
    async (cap) => {
      const f = await fixture()
      const written = await writeProvidersFileAtomic(f.configFile, {
        v: 1,
        providers: [
          {
            ...withMinimum,
            modelCapabilities: {
              'ministral-3b-latest': { output: { minTokens: 16, maxTokens: cap } },
            },
          },
        ],
      })
      expect(written).toMatchObject({
        ok: false,
        reason: 'invalid',
        detail: expect.stringContaining('Output cap must be at least 16 tokens.'),
      })
      expect(await readFile(f.configFile, 'utf8')).not.toContain('minTokens')
    },
  )
  it('refuses an older stored provider cap with the same minimum message', async () => {
    const f = await fixture()
    await writeFile(
      f.configFile,
      JSON.stringify({
        v: 1,
        providers: [
          {
            ...withMinimum,
            modelLimits: { 'ministral-3b-latest': { contextTokens: 8192, outputTokens: 15 } },
          },
        ],
      }),
    )
    const send = vi.fn(() => Promise.resolve(response(new Uint8Array())))
    const services = createConfiguredProviderServices(undefined, { ...f, send })
    await expect(services.client.models?.resolve(REF)).rejects.toThrow(
      'Output cap must be at least 16 tokens.',
    )
    expect(send).not.toHaveBeenCalled()
  })
  it.each([0, 1, 15])(
    'rejects custom output limit %s below the declared provider minimum',
    (cap) => {
      const parsed = providerEntrySchema.safeParse({
        ...withMinimum,
        preset: 'custom',
        modelLimits: { 'ministral-3b-latest': { contextTokens: 8192, outputTokens: cap } },
      })
      expect(parsed.success).toBe(false)
      if (!parsed.success)
        expect(parsed.error.message).toContain('Output cap must be at least 16 tokens.')
    },
  )
  it('refuses sub-minimum configured requests before send', async () => {
    const f = await fixture()
    const written = await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [withMinimum] })
    expect(written.ok).toBe(true)
    const send = vi.fn<NonNullable<ConfiguredProviderOptions['send']>>(() =>
      Promise.resolve(response(new Uint8Array())),
    )
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      send,
      resolve: () => Promise.resolve(['8.8.8.8']),
    })
    const selected = await services.client.models?.resolve(REF)
    expect(selected).toBeDefined()
    if (selected === undefined) throw new Error('missing model')
    for (const cap of [0, 1, 15]) {
      await expect(
        consume(
          selected.client.streamResponse(
            { ...body(), max_output_tokens: cap },
            new AbortController().signal,
          ),
        ),
      ).rejects.toThrow('Output cap must be at least 16 tokens.')
    }
    expect(send).not.toHaveBeenCalled()
    const payload = await stream('03-tool-result-stream.json')
    send.mockImplementation(() => Promise.resolve(response(payload)))
    await consume(
      selected.client.streamResponse(
        { ...body(), max_output_tokens: 16 },
        new AbortController().signal,
      ),
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toContain('"max_tokens":16')
  })
})

it('retains Meta’s captured minimum for a custom entry without a declared minimum', async () => {
  const f = await fixture()
  const model = 'muse-spark-1.3-contributor'
  const ref = `${ENTRY.id}/${model}`
  const entry = {
    ...ENTRY,
    preset: 'custom',
    address: 'https://api.meta.ai/v1',
    format: 'responses',
    models: [model],
    modelLimits: { [model]: { contextTokens: 8192, outputTokens: 64 } },
  }
  for (const cap of [0, 1, 15]) {
    const written = await writeProvidersFileAtomic(f.configFile, {
      v: 1,
      providers: [
        { ...entry, modelLimits: { [model]: { contextTokens: 8192, outputTokens: cap } } },
      ],
    })
    expect(written).toMatchObject({ ok: false, detail: 'Output cap must be at least 16 tokens.' })
    const override = await writeProvidersFileAtomic(f.configFile, {
      v: 1,
      providers: [{ ...entry, modelCapabilities: { [model]: { output: { maxTokens: cap } } } }],
    })
    expect(override).toMatchObject({ ok: false, detail: 'Output cap must be at least 16 tokens.' })
  }
  const written = await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
  expect(written.ok).toBe(true)
  const send = vi.fn(() => Promise.resolve(response(new Uint8Array())))
  const services = createConfiguredProviderServices(undefined, { ...f, send })
  const selected = await services.client.models?.resolve(ref)
  if (selected === undefined) throw new Error('missing model')
  expect(selected.policy.output.minTokens).toBe(16)
  await expect(
    consume(
      selected.client.streamResponse(
        { ...body(), model: ref, max_output_tokens: 15 },
        new AbortController().signal,
      ),
    ),
  ).rejects.toThrow('Output cap must be at least 16 tokens.')
  expect(send).not.toHaveBeenCalled()
})

it('preserves the minimum if a stored cap changes before a bound client sends', async () => {
  const f = await fixture()
  const entry = {
    ...ENTRY,
    modelCapabilities: { 'ministral-3b-latest': { output: { minTokens: 16 } } },
  }
  const written = await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
  expect(written.ok).toBe(true)
  const send = vi.fn(() => Promise.resolve(response(new Uint8Array())))
  const services = createConfiguredProviderServices(undefined, {
    ...f,
    send,
    resolve: () => Promise.resolve(['8.8.8.8']),
  })
  const selected = await services.client.models?.resolve(REF)
  if (selected === undefined) throw new Error('missing model')
  await writeFile(
    f.configFile,
    JSON.stringify({
      v: 1,
      providers: [
        {
          ...entry,
          modelLimits: { 'ministral-3b-latest': { contextTokens: 8192, outputTokens: 15 } },
        },
      ],
    }),
  )
  await expect(
    consume(selected.client.streamResponse(body(), new AbortController().signal)),
  ).rejects.toThrow('Output cap must be at least 16 tokens.')
  expect(send).not.toHaveBeenCalled()
})

// 0.17.2: an inference stream has no limit on its total time. From 0.15.0 to
// 0.17.1 the 30 s deadline of a bounded call wrapped the whole stream, so an
// answer that took longer was cut off and reported as an unavailable feature.
describe('configured provider stream limits', () => {
  const LOCAL = 'local/ministral-3b-latest'
  const IDLE_MS = 600
  const stalled = fill(UI_TEXT.modelApiStalled, { seconds: 1 })

  /** The production transport against a loopback server, as a user's own local provider. */
  async function localProvider(answer: (res: ServerResponse) => void, streamIdleMs?: number) {
    const f = await fixture()
    const server = createServer((_request, res) => {
      answer(res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [localEntry(server)] })
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      ...(streamIdleMs !== undefined && { streamIdleMs }),
    })
    const model = await services.registry.resolve(LOCAL)
    return {
      run: (signal: AbortSignal) =>
        consume(model.client.streamResponse({ ...body(), model: LOCAL }, signal)),
      close: async () => {
        server.closeAllConnections()
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        })
      },
    }
  }
  const HEADERS = { 'content-type': 'text/event-stream' }
  /** An answer that sends `parts` one at a time, `gapMs` apart, then ends. */
  const paced = (parts: readonly Uint8Array[], gapMs: number) => (res: ServerResponse) => {
    res.writeHead(200, HEADERS)
    let sent = 0
    const timer = setInterval(() => {
      const part = parts[sent]
      sent += 1
      if (part !== undefined) res.write(part)
      if (sent < parts.length) return
      clearInterval(timer)
      res.end()
    }, gapMs)
    res.on('close', () => {
      clearInterval(timer)
    })
  }
  /** An answer that sends the first frame of a real stream, then nothing. */
  async function firstFrameThenSilence() {
    const payload = await stream('03-tool-result-stream.json')
    return (res: ServerResponse) => {
      res.writeHead(200, HEADERS)
      res.write(payload.subarray(0, payload.indexOf('\n\n') + 2))
    }
  }

  it('lets a stream run past the bounded-call deadline', async () => {
    // The 30 s deadline is 100 ms here; the stream takes about 600 ms.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
      realTimeout(ms === MODEL_API_REQUEST_TIMEOUT_MS ? 100 : ms),
    )
    const payload = await stream('03-tool-result-stream.json')
    const size = Math.ceil(payload.byteLength / 6)
    const slices = Array.from({ length: 6 }, (_, index) =>
      payload.subarray(index * size, (index + 1) * size),
    )
    const local = await localProvider(paced(slices, 100))
    try {
      const started = Date.now()
      const events = await local.run(new AbortController().signal)
      expect(events).toContainEqual(expect.objectContaining({ type: 'response.completed' }))
      expect(Date.now() - started).toBeGreaterThan(400)
    } finally {
      await local.close()
    }
  })

  it('keeps a steady stream alive for several times the idle limit: the limit is on silence, not on the total', async () => {
    // One frame every 30 ms, 44 frames: about 1.3 s in total under a 300 ms
    // idle limit. Every event arrives, as when the stream is sent at once.
    const idleMs = 300
    const payload = await stream('03-tool-result-stream.json')
    const frames = payload
      .toString('utf8')
      .split('\n\n')
      .filter((frame) => frame !== '')
      .map((frame) => Buffer.from(`${frame}\n\n`))
    const whole = await localProvider(paced([payload], 1))
    const steady = await localProvider(paced(frames, 30), idleMs)
    try {
      const expected = await whole.run(new AbortController().signal)
      const started = Date.now()
      const events = await steady.run(new AbortController().signal)
      expect(Date.now() - started).toBeGreaterThan(3 * idleMs)
      const types = (list: readonly unknown[]) =>
        list.map((event) => z.object({ type: z.string() }).parse(event).type)
      expect(types(events)).toEqual(types(expected))
      expect(types(events).at(-1)).toBe('response.completed')
    } finally {
      await whole.close()
      await steady.close()
    }
  })

  it('ends a stream that goes silent at the idle limit, with the idle sentence', async () => {
    const local = await localProvider(await firstFrameThenSilence(), IDLE_MS)
    try {
      const started = Date.now()
      await expect(local.run(new AbortController().signal)).rejects.toThrow(stalled)
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      await local.close()
    }
  })

  it('ends a stream whose headers never arrive at the idle limit, with the idle sentence', async () => {
    const local = await localProvider(() => {
      // The server accepts the request and never answers.
    }, IDLE_MS)
    try {
      await expect(local.run(new AbortController().signal)).rejects.toThrow(stalled)
    } finally {
      await local.close()
    }
  })

  it('ends a stream at once when the caller stops it', async () => {
    const local = await localProvider(await firstFrameThenSilence())
    try {
      const stop = new AbortController()
      const started = Date.now()
      setTimeout(() => {
        stop.abort()
      }, 150)
      await expect(local.run(stop.signal)).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(3000)
    } finally {
      await local.close()
    }
  })
})
