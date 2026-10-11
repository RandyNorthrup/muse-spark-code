// M105 lane V: vendor codec media refusals. No vendor outside Meta has a
// captured media wire (D85.1: Gemini Files/inline data, OpenAI input_audio
// and vLLM/SGLang video_url are all uncaptured), so the chat and Gemini
// codecs refuse video with the model's own translated reason instead of
// standing in a placeholder or emitting a foreign file id. The gate
// (modalityGate over the captured Meta rows) refuses first in production;
// these tests pin the codec stage and the agreement between the two.
import { describe, expect, it } from 'vitest'
import {
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import { encodeGeminiRequest } from '../../src/core/backends/modelapi/codecs/gemini'
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
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('keeps image and text wire byte-identical around the refusal', () => {
    const body = chatBody([
      { type: 'input_text', text: 'hi' },
      { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
    ])
    const request = encodeChatRequest(body, 'm', OPENROUTER_LIKE, {
      capabilities: { vision: true },
    })
    expect(JSON.stringify(request.body.messages)).toContain('data:image/png;base64,iVBOR')
    expect(JSON.stringify(request.body.messages)).not.toContain('input_video')
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
