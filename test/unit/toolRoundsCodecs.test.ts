import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import {
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import { encodeGeminiRequest } from '../../src/core/backends/modelapi/codecs/gemini'
import { encodeOllamaRequest } from '../../src/core/backends/modelapi/codecs/ollama'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_MODEL_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const WRAP: CreateResponseBody = {
  model: 'muse-spark-1.3',
  prompt_cache_key: 'wrap-up-test',
  prompt_cache_retention: 'in_memory',
  input: [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Review' }] },
    { type: 'function_call', name: 'get_goal', call_id: 'read', arguments: '{}' },
    { type: 'function_call_output', call_id: 'read', output: 'No goal' },
  ],
  instructions: fill(MODEL_API_MODEL_TEXT.turnWrapUp, { limit: 3 }),
  tools: [],
  tool_choice: 'none',
  reasoning: { effort: 'low', summary: 'auto' },
  stream: true,
  store: false,
  include: [],
  max_output_tokens: 256,
}
const CHAT: ChatPresetQuirks = {
  presetId: 'openrouter',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
  toolChoice: 'auto',
}
const object = z.record(z.string(), z.unknown())

describe('wrap-up requests across codec families', () => {
  it.each(['api', 'chatgpt'] as const)(
    'Responses %s disables tools, including namespaces',
    (profile) => {
      const codec = createResponsesCodec(
        profile === 'chatgpt'
          ? { profile, toolNamespace: 'functions' }
          : { sendPromptCacheKey: false, sendPromptCacheRetention: false },
      )
      const request = codec.encodeRequest(WRAP)
      expect(request['tool_choice']).toBe('none')
      expect(request['tools']).toEqual([])
      expect(request['instructions']).toContain('limit of 3 model calls')
    },
  )
  it.each(['auto', 'omit'] as const)('Chat respects tool-choice capability %s', (toolChoice) => {
    const request = encodeChatRequest(WRAP, 'review-model', { ...CHAT, toolChoice }).body
    expect(request.tools).toBeUndefined()
    expect(request.tool_choice).toBe(toolChoice === 'auto' ? 'none' : undefined)
    expect(JSON.stringify(request.messages)).toContain('limit of 3 model calls')
  })
  it('Anthropic omits declarations and choice while retaining tool-result history', () => {
    const request = encodeAnthropicRequest(WRAP, {
      model: 'claude-sonnet-5-5',
      maxTokens: 256,
      effort: 'low',
    }).body
    expect(request.tools).toBeUndefined()
    expect(request.tool_choice).toBeUndefined()
    expect(JSON.stringify(request)).toContain('limit of 3 model calls')
    expect(JSON.stringify(request)).toContain('No goal')
  })
  it('Gemini omits declarations and tool config', () => {
    const request = encodeGeminiRequest(WRAP, 'gemini-3.5-flash-lite').body
    expect(request['tools']).toBeUndefined()
    expect(request['toolConfig']).toBeUndefined()
    expect(JSON.stringify(request)).toContain('limit of 3 model calls')
  })
  it('Ollama omits tools and unsupported tool choice', () => {
    const request = object.parse(
      JSON.parse(
        encodeOllamaRequest(WRAP, {
          model: 'qwen3:4b-instruct-2507-q4_K_M',
          numCtx: 32_768,
          think: false,
        }).body,
      ),
    )
    expect(request['tools']).toBeUndefined()
    expect(request['tool_choice']).toBeUndefined()
    expect(JSON.stringify(request)).toContain('limit of 3 model calls')
  })
})
