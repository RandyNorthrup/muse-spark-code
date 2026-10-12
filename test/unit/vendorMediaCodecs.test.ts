// M105 lane V R2 (RVCM1054): vendor codec media refusals across every
// encoder. No vendor outside Meta has a captured media wire (D85.1), so
// every request encoder (chat, gemini, responses, anthropic, ollama) refuses
// a held video part with the model's own translated reason instead of
// forwarding Meta's shape or dropping the part and sending the rest. The
// gate (modalityGate over the captured Meta rows) refuses first in
// production; these tests pin the codec stage, the refusal's passage
// through the production client, and the agreement between the two.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectCopilotFromClick, type CopilotPort } from '../../src/host/providers/copilotClient'
import {
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import { ChatCodecError, isChatCodecError } from '../../src/core/backends/modelapi/codecs/shared'
import { encodeGeminiRequest } from '../../src/core/backends/modelapi/codecs/gemini'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import { encodeOllamaRequest } from '../../src/core/backends/modelapi/codecs/ollama'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import {
  providerEntrySchema,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'
import { PLAN_KEY_PRESETS, PRESETS } from '../../src/core/providers/presets'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import { ChatGptSignIn, type ChatGptHostPort } from '../../src/core/providers/subscriptions/chatgpt'
import {
  createRuntimeDailyBudget,
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import { Usd } from '../../src/shared/usd'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { metaMediaCapabilities } from '../../src/core/media/metaMediaCapabilities'
import { modalityGate } from '../../src/core/media/modalityGate'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { videoFixture } from './helpers/media/fixtures'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import type {
  CreateResponseBody,
  InputContentPart,
  StreamEvent,
} from '../../src/core/backends/modelapi/schemas'

const OPENROUTER_LIKE: ChatPresetQuirks = {
  presetId: 'openrouter',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-object',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'details',
}

const VLLM_LIKE: ChatPresetQuirks = {
  presetId: 'vllm',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'none',
}

function chatBody(content: readonly InputContentPart[]): CreateResponseBody {
  return {
    model: 'test-model',
    input: [{ type: 'message', role: 'user', content }],
    instructions: 'be brief',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 100,
    prompt_cache_key: 'unused',
    prompt_cache_retention: '24h',
  }
}

function geminiBody(content: readonly InputContentPart[]): CreateResponseBody {
  return {
    ...chatBody(content),
    model: 'gemini/gemini-2.5-flash',
    tools: [],
    // Thinking off keeps the request clear of the effort record (M95 lane G).
    reasoning: { effort: 'none', summary: 'auto' },
    max_output_tokens: 1024,
  }
}

const HELD_VIDEO: InputContentPart = { type: 'input_video', file_id: 'file-abc123' }

describe('M105 lane V vendor video refusals', () => {
  it.each([
    ['openrouter', OPENROUTER_LIKE],
    ['vllm', VLLM_LIKE],
  ])('refuses a held video on the %s chat preset with the model reason', (preset, quirks) => {
    const nativeModel = preset === 'vllm' ? 'qwen2-vl' : 'some-model'
    const body = chatBody([
      { type: 'input_text', text: 'what is in this clip?' },
      { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
      HELD_VIDEO,
    ])
    expect(() =>
      encodeChatRequest(body, nativeModel, quirks, { capabilities: { vision: true } }),
    ).toThrow(`${nativeModel} is not known to take video.`)
  })

  it('refuses a video-only message on a chat preset without emitting a placeholder', () => {
    const body = chatBody([{ type: 'input_text', text: 'describe' }, HELD_VIDEO])
    expect(() =>
      encodeChatRequest(body, 'some-model', OPENROUTER_LIKE, {
        capabilities: { vision: true },
      }),
    ).toThrow('some-model is not known to take video.')
  })

  it('refuses a held video on a chat preset with no vision flag with the model reason', () => {
    const body = chatBody([{ type: 'input_text', text: 'describe' }, HELD_VIDEO])
    expect(() => encodeChatRequest(body, 'some-model', OPENROUTER_LIKE)).toThrow(
      'some-model is not known to take video.',
    )
  })

  it('refuses a held video in an assistant message on a chat preset with the typed reason', () => {
    const body: CreateResponseBody = {
      ...chatBody([{ type: 'input_text', text: 'describe' }]),
      input: [{ type: 'message', role: 'assistant', content: [HELD_VIDEO] }],
    }
    let error: unknown
    try {
      encodeChatRequest(body, 'some-model', OPENROUTER_LIKE, {
        capabilities: { vision: true },
      })
    } catch (error_) {
      error = error_
    }
    // A plain Error here would become the generic unavailable message in
    // the production client, so the type is pinned, not just the sentence.
    if (!isChatCodecError(error)) throw new Error('expected a codec refusal')
    expect(error.message).toBe('some-model is not known to take video.')
  })

  it.each([true, false, undefined])(
    'refuses a held video on Gemini (vision: %s) with the model reason',
    (vision) => {
      const body = geminiBody([{ type: 'input_text', text: 'describe' }, HELD_VIDEO])
      expect(() =>
        encodeGeminiRequest(
          body,
          'gemini-2.5-flash',
          vision === undefined ? undefined : { capabilities: { vision } },
        ),
      ).toThrow('gemini-2.5-flash is not known to take video.')
    },
  )

  it('reads the refusal from the installed table, not the module-load table', () => {
    setUiText({ ...EN, media: { ...EN.media, videoUnknown: '{model} nimmt.{model}' } }, 'de')
    try {
      expect(() =>
        encodeChatRequest(chatBody([HELD_VIDEO]), 'm', OPENROUTER_LIKE, {
          capabilities: { vision: true },
        }),
      ).toThrow('m nimmt.m')
      expect(() => encodeGeminiRequest(geminiBody([HELD_VIDEO]), 'm')).toThrow('m nimmt.m')
      expect(() =>
        createResponsesCodec({
          sendPromptCacheKey: false,
          sendPromptCacheRetention: false,
        }).encodeRequest({ ...chatBody([HELD_VIDEO]), model: 'm' }),
      ).toThrow('m nimmt.m')
      expect(() =>
        createResponsesCodec({ profile: 'chatgpt', toolNamespace: 'functions' }).encodeRequest({
          ...chatBody([HELD_VIDEO]),
          model: 'm',
        }),
      ).toThrow('m nimmt.m')
      expect(() =>
        encodeAnthropicRequest(chatBody([HELD_VIDEO]), {
          model: 'm',
          maxTokens: 1024,
          effort: 'none',
        }),
      ).toThrow('m nimmt.m')
      expect(() =>
        encodeOllamaRequest(chatBody([HELD_VIDEO]), { model: 'm', numCtx: 32_768 }),
      ).toThrow('m nimmt.m')
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('keeps image and text wire byte-identical around the refusal', () => {
    const content: readonly InputContentPart[] = [
      { type: 'input_text', text: 'hi' },
      { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
    ]
    const chat = encodeChatRequest(chatBody(content), 'm', OPENROUTER_LIKE, {
      capabilities: { vision: true },
    })
    expect(JSON.stringify(chat.body.messages)).toBe(
      '[{"role":"system","content":"be brief"},{"role":"user","content":[{"type":"text","text":"hi"},{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBOR","detail":"auto"}}]}]',
    )
    const gemini = encodeGeminiRequest(geminiBody(content), 'gemini-2.5-flash')
    expect(JSON.stringify(gemini.body)).toBe(
      '{"systemInstruction":{"parts":[{"text":"be brief"}]},"contents":[{"role":"user","parts":[{"text":"hi"},{"inlineData":{"mimeType":"image/png","data":"iVBOR"}}]}],"generationConfig":{"maxOutputTokens":1024,"thinkingConfig":{"thinkingBudget":0,"includeThoughts":true}}}',
    )
    // A video part refuses instead of encoding: this fails when either
    // refusal above is removed (the request would encode in its place).
    const withVideo: readonly InputContentPart[] = [...content, HELD_VIDEO]
    expect(() =>
      encodeChatRequest(chatBody(withVideo), 'm', OPENROUTER_LIKE, {
        capabilities: { vision: true },
      }),
    ).toThrow('m is not known to take video.')
    expect(() => encodeGeminiRequest(geminiBody(withVideo), 'gemini-2.5-flash')).toThrow(
      'gemini-2.5-flash is not known to take video.',
    )
  })

  it('composes the gate and both codecs on one sniffed clip (production stages)', () => {
    const bytes = videoFixture()
    const info = sniffMediaBytes(bytes)
    if (info === undefined) throw new Error('video fixture must sniff')
    if (info.kind !== 'video') throw new Error('video fixture must sniff as video')

    // The uncaptured vendor refuses at the gate with the named reason.
    const gate = modalityGate(info, metaMediaCapabilities('gemini-2.5-flash'))
    expect(gate.ok).toBe(false)
    if (gate.ok) throw new Error('expected a gate refusal')
    expect(gate.reason).toContain('gemini-2.5-flash')
    expect(gate.reason).toContain('not known to take video')

    // A part that still reached a vendor codec refuses with the same reason.
    const held: InputContentPart = { type: 'input_video', file_id: 'file-abc123' }
    expect(() => encodeGeminiRequest(geminiBody([held]), 'gemini-2.5-flash')).toThrow(
      'gemini-2.5-flash is not known to take video.',
    )
    expect(() =>
      encodeChatRequest(chatBody([held]), 'gemini-2.5-flash', OPENROUTER_LIKE, {
        capabilities: { vision: true },
      }),
    ).toThrow('gemini-2.5-flash is not known to take video.')

    // The captured Meta control still admits the same clip (lane changes nothing there).
    const meta = modalityGate(info, metaMediaCapabilities('muse-spark-1.3-contributor'))
    expect(meta.ok).toBe(true)
  })
})

/** Minimal chat quirks for a registry route (reasoning off: the video refuses first). */
function chatQuirksFor(route: string): ChatPresetQuirks {
  return {
    presetId: route,
    outputCap: 'max_tokens',
    reasoningParam: 'none',
    sendCacheKey: false,
    includeUsage: true,
    toolStream: false,
    toolResultName: false,
    replayField: 'none',
  }
}

/** One registry route's request encoding with a held video part (must throw, never send). */
function encodeRoute(route: string, kind: string, model: string, body: CreateResponseBody): void {
  switch (kind) {
    case 'chat': {
      encodeChatRequest(body, model, chatQuirksFor(route), { capabilities: { vision: true } })
      return
    }
    case 'gemini': {
      encodeGeminiRequest(body, model)
      return
    }
    case 'responses': {
      createResponsesCodec({
        sendPromptCacheKey: false,
        sendPromptCacheRetention: false,
      }).encodeRequest({ ...body, model })
      return
    }
    case 'chatgpt': {
      createResponsesCodec({ profile: 'chatgpt', toolNamespace: 'functions' }).encodeRequest({
        ...body,
        model,
      })
      return
    }
    case 'anthropic': {
      encodeAnthropicRequest(body, { model, maxTokens: 1024, effort: 'none' })
      return
    }
    case 'ollama': {
      encodeOllamaRequest(body, { model, numCtx: 32_768 })
      return
    }
    default: {
      throw new Error(`matrix has no encoder for kind ${kind}`)
    }
  }
}

function videoBody(model: string, content: readonly InputContentPart[]): CreateResponseBody {
  return { ...chatBody(content), model }
}

describe('M105 lane V R2 every encoder refuses on every provider route', () => {
  // R3 (RVCM1054B P3): rows come from BOTH production route registries —
  // the provider registry and the separate plan-key registry — plus the
  // ChatGPT subscription route, so adding a route exercises it here.
  const rows: readonly (readonly [string, string])[] = [
    ...PRESETS.map((preset) => [preset.id, preset.format] as const),
    ...PLAN_KEY_PRESETS.map((preset) => [preset.id, preset.format] as const),
    ['chatgpt-subscription', 'chatgpt'] as const,
  ]

  it('covers every provider format, so a new format without an encoder fails', () => {
    expect(new Set(rows.map((row) => row[1]))).toEqual(
      new Set(['anthropic', 'chat', 'chatgpt', 'gemini', 'ollama', 'responses']),
    )
  })

  // R4 (RVCM1054C P3): the full user-reachable route list, written out so
  // this guard can fail: adding a route to any production registry without
  // covering it here fails the equality below (drill D-R4-4). The Copilot
  // subscription leg has no request encoder; its row is the refusal pinned
  // through the real client in 'the refusal arrives as itself on every
  // plan leg' below, named in CLIENT_COVERED_ROUTES.
  const EXPECTED_ROUTES: readonly string[] = [
    'openai',
    'azure',
    'xai',
    'anthropic',
    'gemini',
    'openrouter',
    'groq',
    'deepseek',
    'mistral',
    'mistral-plan',
    'together',
    'fireworks',
    'huggingface',
    'zai',
    'ollama',
    'lmstudio',
    'vllm',
    'llamacpp',
    'custom',
    'chatgpt-subscription',
    'copilot-subscription',
  ]
  const CLIENT_COVERED_ROUTES: readonly string[] = ['copilot-subscription']

  it('covers every supported route, so a route without a row fails', () => {
    const covered = new Set([...rows.map((row) => row[0]), ...CLIENT_COVERED_ROUTES])
    expect(covered).toEqual(new Set(EXPECTED_ROUTES))
  })

  it('covers the named non-Meta routes', () => {
    const ids = PRESETS.map((preset) => preset.id)
    for (const route of ['openai', 'azure', 'xai', 'anthropic', 'ollama', 'openrouter', 'custom']) {
      expect(ids).toContain(route)
    }
  })

  it.each(rows)('refuses a held video on route %s with the typed model reason', (route, kind) => {
    for (const content of [
      [{ type: 'input_text', text: 'what is in this clip?' }, HELD_VIDEO] as const,
      [HELD_VIDEO] as const,
    ]) {
      const model = `${route}-model`
      let error: unknown
      try {
        encodeRoute(route, kind, model, videoBody(model, [...content]))
      } catch (error_) {
        error = error_
      }
      if (!isChatCodecError(error)) throw new Error(`expected a codec refusal for ${route}`)
      expect(error.message).toBe(`${model} is not known to take video.`)
    }
  })
})

interface ProductionFamily {
  readonly id: string
  readonly preset: string
  readonly address: string
  readonly auth: 'apiKey' | 'none'
  readonly native: string
  readonly numCtx?: number | undefined
}

/** One route per provider family through the real production client. */
const PRODUCTION_FAMILIES: readonly ProductionFamily[] = [
  {
    id: 'openrouter',
    preset: 'openrouter',
    address: 'https://openrouter.ai/api/v1',
    auth: 'apiKey',
    native: 'sao10k/l3.1-euryale-70b',
  },
  {
    id: 'gemini',
    preset: 'gemini',
    address: 'https://generativelanguage.googleapis.com',
    auth: 'apiKey',
    native: 'gemini-flash-latest',
  },
  {
    id: 'openai',
    preset: 'openai',
    address: 'https://api.openai.com',
    auth: 'apiKey',
    native: 'gpt-5.4',
  },
  {
    id: 'anthropic',
    preset: 'anthropic',
    address: 'https://api.anthropic.com',
    auth: 'apiKey',
    native: 'claude-haiku-4-5',
  },
  {
    id: 'ollama',
    preset: 'ollama',
    address: 'http://127.0.0.1:11434',
    auth: 'none',
    native: 'llama3.2',
    numCtx: 32_768,
  },
]

const roots: string[] = []

/** The fake transport's byte source (never read: the refusal throws first). */
async function* emptyBytes(): AsyncGenerator<Uint8Array> {
  yield* await Promise.resolve([new Uint8Array(0)])
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/**
 * A held video turn through the production configured-provider client:
 * rejects with the refusal's own sentence and sends zero requests.
 */
async function productionRefusal(family: ProductionFamily, expected?: string): Promise<number> {
  const root = await mkdtemp(path.join(tmpdir(), 'm105r2-vendor-'))
  roots.push(root)
  const entry = providerEntrySchema.parse({
    id: family.id,
    preset: family.preset,
    address: family.address,
    auth: family.auth,
    models: [family.native],
    ...(family.numCtx !== undefined && { numCtx: { [family.native]: family.numCtx } }),
  })
  const configFile = path.join(root, 'providers.json')
  const written = await writeProvidersFileAtomic(configFile, { v: 1, providers: [entry] })
  expect(written.ok).toBe(true)
  let sent = 0
  const services = createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
    secrets: memorySecrets(),
    resolve: () => Promise.resolve(['127.0.0.1']),
    send: () => {
      sent += 1
      return Promise.resolve({
        status: 200,
        headers: {},
        body: emptyBytes(),
        close: () => undefined,
      })
    },
  })
  const ref = `${family.id}/${family.native}`
  const body: CreateResponseBody = {
    model: ref,
    instructions: 'be brief',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'what is in this clip?' },
          { type: 'input_video', file_id: 'file-abc123' },
        ],
      },
    ],
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'none', summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 1024,
    prompt_cache_key: 'test',
    prompt_cache_retention: '24h',
  }
  await expect(
    Array.fromAsync(services.client.streamResponse(body, new AbortController().signal)),
  ).rejects.toThrow(expected ?? `${family.native} is not known to take video.`)
  return sent
}

describe('M105 lane V R2 the refusal arrives as itself through the production client', () => {
  it.each(PRODUCTION_FAMILIES.map((family) => [family.id, family] as const))(
    'family %s refuses with its own sentence and sends zero requests',
    async (_id, family) => {
      expect(await productionRefusal(family)).toBe(0)
    },
  )

  it('refuses in the installed language through the production client', async () => {
    setUiText({ ...EN, media: { ...EN.media, videoUnknown: '{model} nimmt kein Video.' } }, 'de')
    const openrouter = PRODUCTION_FAMILIES[0]
    if (openrouter === undefined) throw new Error('openrouter family must exist')
    try {
      expect(await productionRefusal(openrouter, `${openrouter.native} nimmt kein Video.`)).toBe(0)
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('plan-key route mistral-plan refuses through the real client with zero sends', async () => {
    // M105 lane V R4 (RVCM1054C P3): the plan-key registry is a second
    // production route source, so its route runs through the real
    // production client too, not only through the encoder matrix.
    expect(
      await productionRefusal({
        id: 'mistral-plan',
        preset: 'mistral-plan',
        address: 'https://api.mistral.ai',
        auth: 'apiKey',
        native: 'mistral-medium-2508',
      }),
    ).toBe(0)
  })

  it('never surfaces the generic unavailable error for a held video', async () => {
    const openrouter = PRODUCTION_FAMILIES[0]
    if (openrouter === undefined) throw new Error('openrouter family must exist')
    const root = await mkdtemp(path.join(tmpdir(), 'm105r2-vendor-'))
    roots.push(root)
    const entry = providerEntrySchema.parse({
      id: openrouter.id,
      preset: openrouter.preset,
      address: openrouter.address,
      auth: openrouter.auth,
      models: [openrouter.native],
    })
    const configFile = path.join(root, 'providers.json')
    const written = await writeProvidersFileAtomic(configFile, { v: 1, providers: [entry] })
    expect(written.ok).toBe(true)
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
      secrets: memorySecrets(),
      resolve: () => Promise.resolve(['127.0.0.1']),
      send: () =>
        Promise.resolve({ status: 200, headers: {}, body: emptyBytes(), close: () => undefined }),
    })
    const ref = `${openrouter.id}/${openrouter.native}`
    const events = services.client.streamResponse(
      {
        model: ref,
        instructions: 'be brief',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'what is in this clip?' },
              { type: 'input_video', file_id: 'file-abc123' },
            ],
          },
        ],
        tools: [],
        tool_choice: 'auto',
        reasoning: { effort: 'none', summary: 'auto' },
        stream: true,
        store: false,
        include: [],
        max_output_tokens: 1024,
        prompt_cache_key: 'test',
        prompt_cache_retention: '24h',
      },
      new AbortController().signal,
    )
    let error: unknown
    try {
      await Array.fromAsync(events)
    } catch (error_) {
      error = error_
    }
    if (!(error instanceof Error)) throw new Error('expected an Error for the held video')
    expect(error.message).not.toBe(UI_TEXT.modelsPanelUnavailable)
  })
})

// M105 lane V R3 (RVCM1054B P2): the codec refusal through every production
// client and wrapper that can sit between a codec and the user. Each test
// drives the REAL client with a counting transport and asserts the refusal
// arrives as its own sentence with zero requests sent. One shared helper
// (`isChatCodecError`) decides; no client keeps its own list.
const SUBSCRIPTION_VIDEO_BODY = (model: string): CreateResponseBody => ({
  model,
  instructions: 'be brief',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'what is in this clip?' },
        { type: 'input_video', file_id: 'file-abc123' },
      ],
    },
  ],
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'none', summary: 'auto' },
  stream: true,
  store: false,
  include: [],
  max_output_tokens: 1024,
  prompt_cache_key: 'test',
  prompt_cache_retention: '24h',
})

/** A real ChatGPT sign-in whose stored grant never expires in this test. */
function chatGptSignInForTest(): ChatGptSignIn {
  const now = Date.now()
  const host: ChatGptHostPort = {
    hostId: 'test-host',
    fetch: () => Promise.reject(new Error('no sign-in network in this test')),
    now: () => now,
    openBrowser: () => Promise.reject(new Error('no browser in this test')),
    startCallback: () => Promise.reject(new Error('no callback in this test')),
    readRecord: () =>
      Promise.resolve({
        v: 1,
        auth: 'subscription',
        origin: 'https://api.openai.com',
        issuer: 'https://auth.openai.com',
        clientId: 'test-client',
        hostId: 'test-host',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: now + 3_600_000,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        nonce: 'test-nonce',
      }),
    writeRecord: () => Promise.resolve(),
    deleteRecord: () => Promise.resolve(),
    withRefreshLock: (work) => work(),
  }
  return new ChatGptSignIn(host)
}

describe('M105 lane V R3 the refusal arrives as itself on every plan leg', () => {
  it.each([
    ['en' as const, 'gpt-6-astra is not known to take video.'],
    ['de' as const, 'gpt-6-astra nimmt kein Video.'],
  ])(
    'ChatGPT subscription route (%s) yields the refusal sentence with zero sends',
    async (language, sentence) => {
      const videoUnknown =
        language === 'de' ? '{model} nimmt kein Video.' : '{model} is not known to take video.'
      setUiText({ ...EN, media: { ...EN.media, videoUnknown } }, language)
      try {
        let sent = 0
        const api = fakeModelApi()
        const meta = fakeModelApiClient(api, new FakeLogOutputChannel())
        const subscribed = createSubscriptionClient(meta, {
          fetch: () => {
            sent += 1
            throw new Error('the codec refusal must throw before any send')
          },
          providers: () =>
            Promise.resolve({
              v: 1 as const,
              providers: [
                {
                  id: 'chatgpt',
                  preset: 'custom',
                  auth: 'subscription',
                  models: ['gpt-6-astra'],
                },
              ],
            }),
          chatgpt: () => Promise.resolve(chatGptSignInForTest()),
          accountId: () => Promise.resolve(undefined),
        })
        const events = await Array.fromAsync(
          subscribed.streamResponse(
            SUBSCRIPTION_VIDEO_BODY('chatgpt/gpt-6-astra'),
            new AbortController().signal,
          ),
        )
        expect(events).toEqual([{ type: 'error', message: sentence }])
        expect(sent).toBe(0)
        expect(api.requests).toHaveLength(0)
      } finally {
        setUiText(EN, 'en')
      }
    },
  )

  it('Copilot subscription leg yields the real client refusal with its own sentence', async () => {
    // M105 lane V R4 (RVCM1054C P2): the real Copilot client from
    // connectCopilotFromClick (a fake VS Code port only) behind the real
    // subscription client. The held video refuses before any request with
    // the model's own sentence, never the generic unavailable text.
    const sendRequest = vi.fn()
    const countTokens = vi.fn()
    const recordEstimatedUsage = vi.fn()
    const model: vscode.LanguageModelChat = {
      id: 'copilot-model',
      name: 'Copilot Model',
      vendor: 'copilot',
      family: 'copilot',
      version: '1',
      maxInputTokens: 1000,
      countTokens,
      sendRequest,
    }
    const port: CopilotPort = {
      selectChatModels: () => Promise.resolve([model]),
      user: (text: string) => ({
        role: 1,
        content: text === '' ? [] : [{ value: text }],
        name: undefined,
      }),
      assistant: (text: string) => ({
        role: 2,
        content: text === '' ? [] : [{ value: text }],
        name: undefined,
      }),
      text: (value: string) => ({ value }),
      call: (callId: string, name: string, input: object) => ({ callId, name, input }),
      result: (callId: string, content: unknown[]) => ({ callId, content }),
      cancellation: () => {
        const token: vscode.CancellationToken = {
          get isCancellationRequested() {
            return false
          },
          onCancellationRequested: () => ({ dispose: () => undefined }),
        }
        return { token, cancel: () => undefined, dispose: () => undefined }
      },
      isText: (part: unknown): part is vscode.LanguageModelTextPart =>
        typeof part === 'object' && part !== null && 'value' in part,
      isCall: (_part: unknown): _part is vscode.LanguageModelToolCallPart => false,
    }
    const clients = await connectCopilotFromClick({
      api: port,
      justification: () => 'test justification',
      failureText: (code) => {
        throw new Error(`unexpected Copilot failure ${code}`)
      },
      isConfidential: () => false,
      isUserInitiated: () => true,
      canSendRequest: () => true,
      recordEstimatedUsage,
    })
    expect(clients).toHaveLength(1)
    const api = fakeModelApi()
    const meta = fakeModelApiClient(api, new FakeLogOutputChannel())
    let sent = 0
    const subscribed = createSubscriptionClient(meta, {
      fetch: () => {
        sent += 1
        throw new Error('the codec refusal must throw before any send')
      },
      providers: () =>
        Promise.resolve({
          v: 1 as const,
          providers: [
            { id: 'copilot', preset: 'custom', auth: 'subscription', models: ['copilot-model'] },
          ],
        }),
      chatgpt: () => Promise.reject(new Error('no subscription sign-in')),
      accountId: () => Promise.resolve(undefined),
      copilot: () => new Map([['copilot-model', clients[0]!]]),
    })
    const events = await Array.fromAsync(
      subscribed.streamResponse(
        SUBSCRIPTION_VIDEO_BODY('copilot/copilot-model'),
        new AbortController().signal,
      ),
    )
    expect(events).toEqual([
      { type: 'error', message: 'copilot-model is not known to take video.' },
    ])
    expect(sent).toBe(0)
    expect(api.requests).toHaveLength(0)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(countTokens).not.toHaveBeenCalled()
    expect(recordEstimatedUsage).not.toHaveBeenCalled()
  })

  it('Meta passthrough rethrows the refusal itself with zero sends', async () => {
    // M105 lane V R4 (RVCM1054C P2 sweep): a non-plan model takes the
    // passthrough (registry.ts yield* meta, outside the plan try) into the
    // REAL configured client with a counting transport. The held video
    // refuses at encode with the model's own sentence, and the typed
    // refusal propagates unchanged (the session turns it into the turn
    // reason, as for the configured client). Nothing is sent on either leg.
    const openrouter = PRODUCTION_FAMILIES[0]
    if (openrouter === undefined) throw new Error('openrouter family must exist')
    const root = await mkdtemp(path.join(tmpdir(), 'm105r2-vendor-'))
    roots.push(root)
    const entry = providerEntrySchema.parse({
      id: openrouter.id,
      preset: openrouter.preset,
      address: openrouter.address,
      auth: openrouter.auth,
      models: [openrouter.native],
    })
    const configFile = path.join(root, 'providers.json')
    const written = await writeProvidersFileAtomic(configFile, { v: 1, providers: [entry] })
    expect(written.ok).toBe(true)
    let sent = 0
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
      secrets: memorySecrets(),
      resolve: () => Promise.resolve(['127.0.0.1']),
      send: () => {
        sent += 1
        return Promise.resolve({
          status: 200,
          headers: {},
          body: emptyBytes(),
          close: () => undefined,
        })
      },
    })
    let planSends = 0
    const subscribed = createSubscriptionClient(services.client, {
      fetch: () => {
        planSends += 1
        throw new Error('the Meta passthrough must not reach the plan fetch')
      },
      providers: () => Promise.resolve({ v: 1 as const, providers: [] }),
      chatgpt: () => Promise.reject(new Error('no subscription sign-in')),
      accountId: () => Promise.resolve(undefined),
    })
    const ref = `${openrouter.id}/${openrouter.native}`
    let error: unknown
    try {
      await Array.fromAsync(
        subscribed.streamResponse(SUBSCRIPTION_VIDEO_BODY(ref), new AbortController().signal),
      )
    } catch (error_) {
      error = error_
    }
    // Identity, not just the message: the passthrough maps nothing.
    if (!isChatCodecError(error)) throw new Error('expected the typed codec refusal')
    expect(error.message).toBe(`${openrouter.native} is not known to take video.`)
    expect(sent).toBe(0)
    expect(planSends).toBe(0)
  })
})

describe('M105 lane V R3 the capture recipes run as written', () => {
  it('parses every fenced JSON request body in the certification record', async () => {
    // RVCM1054B P3: the recipes once shipped unquoted property names, so no
    // body could be sent as written. Each fenced body must parse here.
    const doc = await readFile('docs/certification/m105-v-vendor-codecs.md', 'utf8')
    let count = 0
    for (const block of doc.matchAll(/```json\r?\n([\s\S]*?)```/gu)) {
      count += 1
      const body = block[1] ?? ''
      expect(() => {
        JSON.parse(body)
      }, body).not.toThrow()
    }
    expect(count).toBeGreaterThan(0)
  })
})

describe('M105 lane V R3 the refusal passes the runtime accounting wrapper untouched', () => {
  it('rejects with the refusal itself and settles nothing', async () => {
    // M105 lane V R4 (RVCM1054C P3): "settles nothing" is asserted, not
    // titled: the real wrapper over a refusing inner client reserves
    // nothing from the daily budget, admits nothing to the ledger, sends
    // zero requests, and rethrows the refusal itself.
    const refusal = new ChatCodecError('muse-spark-1.3 is not known to take video.')
    const api = fakeModelApi()
    const inner = fakeModelApiClient(api, new FakeLogOutputChannel())
    inner.streamResponse = (): AsyncGenerator<StreamEvent> => {
      // The codec refuses at encode: the transport below is never reached.
      throw refusal
    }
    const root = await mkdtemp(path.join(tmpdir(), 'm105r3-accounting-'))
    roots.push(root)
    const daily = createRuntimeDailyBudget({
      dataFolder: root,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
    const reserve = vi.spyOn(daily, 'reserve')
    const ledger = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 10 })
    const refusals: unknown[] = []
    const started: number[] = []
    const settled: unknown[] = []
    const wrapped = withRuntimeAccounting(inner, daily, {
      ledger,
      refuse: (reason) => {
        refusals.push(reason)
      },
      started: (n) => {
        started.push(n)
      },
      settled: (outcome) => {
        settled.push(outcome)
      },
    })
    let error: unknown
    try {
      await Array.fromAsync(
        wrapped.streamResponse(
          SUBSCRIPTION_VIDEO_BODY('muse-spark-1.3'),
          new AbortController().signal,
        ),
      )
    } catch (error_) {
      error = error_
    }
    // Identity, not just the message: the wrapper maps nothing.
    expect(error).toBe(refusal)
    expect(api.requests).toHaveLength(0)
    expect(reserve).not.toHaveBeenCalled()
    expect(ledger.totals().requests).toBe(0)
    expect(ledger.lastResponse).toBeNull()
    expect(refusals).toEqual([])
    expect(started).toEqual([])
    expect(settled).toEqual([])
  })
})
