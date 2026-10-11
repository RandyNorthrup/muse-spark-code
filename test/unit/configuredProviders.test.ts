import { Usd } from '../../src/shared/usd'
// Offline composition over the owner's 2026-10-04 Mistral captures.
// Tool name/arguments alone are adapted to the real harness read_file tool.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
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
} from '../../src/core/providers/providersFile'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import * as responsesCodec from '../../src/core/backends/modelapi/codecs/responses'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'
import { EN } from '../../src/shared/l10n/en'
import {
  PROVIDER_SECRET_PREFIX,
  SUBSCRIPTION_STREAM_MAX_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

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
const response = (bytes: Uint8Array, status = 200) => ({
  status,
  headers: {},
  body: (async function* () {
    yield* await Promise.resolve([bytes])
  })(),
  close: vi.fn(),
})
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
const windowedLocalEntry = (contextTokens: number) =>
  providerEntrySchema.parse({
    id: 'llamacpp',
    preset: 'llamacpp',
    address: 'http://127.0.0.1:8080',
    auth: 'none',
    models: ['Qwen3-0.6B-Q8_0'],
    modelLimits: { 'Qwen3-0.6B-Q8_0': { contextTokens, outputTokens: contextTokens } },
  })
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
    // C-M95-4 R2: the ollama row was an uncaptured preset dispatched with
    // no capture behind it (rule 13); the captured llama.cpp row covers
    // keyless local dispatch instead.
    ['llamacpp', 'chat', '04-one-tool.json', 'Qwen3-0.6B-Q8_0'],
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
        auth: preset === 'llamacpp' ? 'none' : 'apiKey',
        address,
        format,
        models: [native],
        // C-M95-4 R3: a saved local model carries its server's reported
        // window; the request refuses without one (next test).
        ...(preset === 'llamacpp' && {
          modelLimits: { [native]: { contextTokens: 4096, outputTokens: 4096 } },
        }),
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
        case 'llamacpp': {
          expect(headers).not.toHaveProperty('authorization')
          break
        }
        default: {
          expect(headers).toMatchObject({ authorization: 'Bearer test-format-key' })
        }
      }
    },
  )

  it('refuses uncaptured local presets even when keyless (rule 13)', async () => {
    // C-M95-4 R2: the wire-capture refusal skipped `auth === 'none'`, so a
    // picked vLLM or Ollama entry sent chat with no capture behind it.
    const f = await fixture()
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['127.0.0.1']),
    })
    for (const [id, address] of [
      ['ollama', 'http://127.0.0.1:11434'],
      ['vllm', 'http://127.0.0.1:8000'],
    ] as const) {
      const entry = providerEntrySchema.parse({
        id,
        preset: id,
        address,
        auth: 'none',
        models: ['m'],
      })
      await expect(services.test(entry, 'unused-key')).rejects.toThrow(
        UI_TEXT.modelsPanelUnavailable,
      )
    }
  })

  it('fails a llama.cpp scan closed when the list carries no live window', async () => {
    // C-M95-4 R2: the quirks were captured against a build whose list
    // carries `meta.n_ctx`. A list without it is an unknown build: its
    // models stay unoffered instead of windowless (manual compact would
    // size them at Meta's window).
    const f = await fixture()
    const entry = providerEntrySchema.parse({
      id: 'llamacpp',
      preset: 'llamacpp',
      address: 'http://127.0.0.1:8080',
      auth: 'none',
      models: ['qwen3-0.6b'],
    })
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
    const rowsFor = (data: unknown) =>
      createConfiguredProviderServices(undefined, {
        ...f,
        resolve: () => Promise.resolve(['127.0.0.1']),
        send: () => Promise.resolve(response(Buffer.from(JSON.stringify(data)))),
      }).scanRows(entry)
    const good = await rowsFor({
      data: [{ id: 'qwen3-0.6b', meta: { n_ctx: 4096, n_ctx_train: 40_960 } }],
    })
    expect(good.map((row) => row.context)).toEqual([4096])
    // C-M95-4 R3: the closed-scan reason lives in the UI table (Add Model
    // Provider shows it), not in a thrown English sentence. The build names
    // the preset's `capturedBuild`, mirroring the production fill.
    await expect(
      rowsFor({ data: [{ id: 'qwen3-0.6b', meta: { n_ctx_train: 40_960 } }] }),
    ).rejects.toThrow(
      fill(UI_TEXT.llamacppScanMissingWindow, {
        build: 'b11541 (0.6.0-dev, commit f2918cabb)',
      }),
    )
  })

  it('refuses a windowless local request with a plain reason', async () => {
    // C-M95-4 R3: a scanned local model saved without its server's window
    // never reaches the wire Meta-sized; the request refuses instead.
    const f = await fixture()
    const entry = providerEntrySchema.parse({
      id: 'llamacpp',
      preset: 'llamacpp',
      address: 'http://127.0.0.1:8080',
      auth: 'none',
      models: ['Qwen3-0.6B-Q8_0'],
    })
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
    const send = vi.fn<NonNullable<ConfiguredProviderOptions['send']>>(() =>
      Promise.resolve(response(Buffer.from(''))),
    )
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['127.0.0.1']),
      send,
    })
    const ref = 'llamacpp/Qwen3-0.6B-Q8_0'
    const model = await services.registry.resolve(ref)
    await expect(
      consume(model.client.streamResponse({ ...body(), model: ref }, new AbortController().signal)),
    ).rejects.toThrow(fill(UI_TEXT.localModelWindowUnknown, { model: ref }))
    expect(send).not.toHaveBeenCalled()
  })

  it('peeks the saved local window at use time, with no listing in between', async () => {
    // C-M95-4 R5 (RVCM954C finding 1): one resolver read at use time. The
    // peek reads through to providers.json, so a Models-table edit after a
    // warm listing is what compaction and the request path size from; no
    // new listing is needed. Unlisted models and unknown windows read
    // undefined (the request refuses instead).
    const f = await fixture()
    const carried = providerEntrySchema.parse({
      id: 'llamacpp',
      preset: 'llamacpp',
      address: 'http://127.0.0.1:8080',
      auth: 'none',
      models: ['Qwen3-0.6B-Q8_0'],
      modelLimits: { 'Qwen3-0.6B-Q8_0': { contextTokens: 4096, outputTokens: 4096 } },
    })
    const bare = providerEntrySchema.parse({
      id: 'llamacpp-bare',
      preset: 'llamacpp',
      address: 'http://127.0.0.1:8080',
      auth: 'none',
      models: ['Qwen3-0.6B-Q8_0'],
    })
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [carried, bare] })
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['127.0.0.1']),
      send: () => Promise.resolve(response(Buffer.from(''))),
    })
    expect(services.client.peekContextModel?.('llamacpp/Qwen3-0.6B-Q8_0')).toEqual({
      format: 'chat',
      contextTokens: 4096,
    })
    const resolved = await services.registry.resolve('llamacpp/Qwen3-0.6B-Q8_0')
    expect(resolved.contextTokens).toBe(4096)
    await services.registry.resolve('llamacpp-bare/Qwen3-0.6B-Q8_0')
    expect(services.client.peekContextModel?.('llamacpp-bare/Qwen3-0.6B-Q8_0')).toBeUndefined()
    expect(services.client.peekContextModel?.('llamacpp/unknown')).toBeUndefined()
  })

  it('follows a providers.json window edit with no new listing', async () => {
    // C-M95-4 R5 (RVCM954C findings 1-2): the listing is warm at 4096,
    // then the file is edited. Growing and shrinking must both show up in
    // the peek at once: the next compact and send size from the new
    // window, never from a snapshot or a cached cap.
    const f = await fixture()
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [windowedLocalEntry(4096)] })
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['127.0.0.1']),
      send: () => Promise.resolve(response(Buffer.from(''))),
    })
    await services.registry.resolve('llamacpp/Qwen3-0.6B-Q8_0')
    expect(services.client.peekContextModel?.('llamacpp/Qwen3-0.6B-Q8_0')?.contextTokens).toBe(4096)
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [windowedLocalEntry(8192)] })
    expect(services.client.peekContextModel?.('llamacpp/Qwen3-0.6B-Q8_0')?.contextTokens).toBe(8192)
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [windowedLocalEntry(2048)] })
    expect(services.client.peekContextModel?.('llamacpp/Qwen3-0.6B-Q8_0')?.contextTokens).toBe(2048)
  })

  it('never replays thinking to a local server, even one that streams it', async () => {
    // C-M95-4 R2: LM Studio streams `reasoning_content` but carries no
    // version, so an older or newer build may not understand a replay.
    // The turn's thinking still displays; it just never rides the next
    // request to an unversioned server.
    const f = await fixture()
    const frame = JSON.parse(
      await readFile('docs/certification/m95-captures/lmstudio/03-one-tool.json', 'utf8'),
    ) as unknown
    const events = z
      .object({ response: z.object({ events: z.array(z.object({ data: z.json() })) }) })
      .parse(frame).response.events
    const wire = `${events.map((event) => `data: ${JSON.stringify(event.data)}\n\n`).join('')}data: [DONE]\n\n`
    const sent: string[] = []
    const entry = providerEntrySchema.parse({
      id: 'lmstudio-local',
      preset: 'lmstudio',
      address: 'http://127.0.0.1:1234',
      format: 'chat',
      auth: 'none',
      models: ['qwen3-0.6b'],
      // C-M95-4 R3: requests need a known window; the value below is
      // incidental to this replay assertion (the LM Studio list reports
      // none, so a real save carries none and refuses).
      modelLimits: { 'qwen3-0.6b': { contextTokens: 4096, outputTokens: 4096 } },
    })
    await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
    const services = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['127.0.0.1']),
      send: (_target, body) => {
        sent.push(body ?? '')
        return Promise.resolve(response(Buffer.from(wire)))
      },
    })
    const ref = 'lmstudio-local/qwen3-0.6b'
    const model = await services.registry.resolve(ref)
    await consume(
      model.client.streamResponse(
        {
          ...body(),
          model: ref,
          input: [
            {
              type: 'reasoning',
              summary: [{ type: 'summary_text', text: 'prior thinking' }],
              encrypted_content: JSON.stringify({
                chat: {
                  v: 1,
                  provider: 'lmstudio-local',
                  model: 'qwen3-0.6b',
                  text: 'prior thinking',
                },
              }),
            },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'input_text', text: 'prior answer' }],
            },
            ...body().input,
          ],
        },
        new AbortController().signal,
      ),
    )
    const messages = (
      JSON.parse(sent[0] ?? '{}') as {
        messages: { role: string; reasoning_content?: unknown; reasoning?: unknown }[]
      }
    ).messages.filter((message) => message.role === 'assistant')
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) {
      expect(message).not.toHaveProperty('reasoning_content')
      expect(message).not.toHaveProperty('reasoning')
    }
  })

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
    ).rejects.toThrow(UI_TEXT.modelsPanelUnavailable)
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
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing test listener')
      const entry = providerEntrySchema.parse({
        ...ENTRY,
        id: 'local',
        preset: 'custom',
        auth: 'none',
        address: `http://127.0.0.1:${String(address.port)}`,
        modelLimits: { 'ministral-3b-latest': { contextTokens: 128_000, outputTokens: 128_000 } },
      })
      await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry] })
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
