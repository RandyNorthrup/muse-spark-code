// M105 lane V R2 (RVCM1054): vendor codec media refusals across every
// encoder. No vendor outside Meta has a captured media wire (D85.1), so
// every request encoder (chat, gemini, responses, anthropic, ollama) refuses
// a held video part with the model's own translated reason instead of
// forwarding Meta's shape or dropping the part and sending the rest. The
// gate (modalityGate over the captured Meta rows) refuses first in
// production; these tests pin the codec stage only, through the real
// encoders. The refusal's passage through a live client is unproven
// here (docs/real-life/unproven.md).
import { describe, expect, it } from 'vitest'
import {
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import { isChatCodecError } from '../../src/core/backends/modelapi/codecs/shared'
import { encodeGeminiRequest } from '../../src/core/backends/modelapi/codecs/gemini'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import { encodeOllamaRequest } from '../../src/core/backends/modelapi/codecs/ollama'
import { PLAN_KEY_PRESETS, PRESETS } from '../../src/core/providers/presets'
import { metaMediaCapabilities } from '../../src/core/media/metaMediaCapabilities'
import { modalityGate } from '../../src/core/media/modalityGate'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { videoFixture } from './helpers/media/fixtures'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { CreateResponseBody, InputContentPart } from '../../src/core/backends/modelapi/schemas'

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
    ...heldVideoBody('test-model'),
    input: [{ type: 'message', role: 'user', content }],
    reasoning: { effort: 'low', summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 100,
    prompt_cache_key: 'unused',
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

function heldVideoBody(model: string): CreateResponseBody {
  return {
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
  }
}
